import { App, Notice, TFile, normalizePath, FrontMatterCache } from "obsidian";
import { TodoistCommand, postTodoistCommands, Item, Due } from "../todoist"; // Changed DueDate to Due
import { TodoistSyncSettings } from "../types";
import { moveFileToCustomLocation } from "../obsidian/fileManager";
import TodoistSyncPlugin from "../../main";

interface CommandSyncCaches {
    taskFileCache: Map<string, string>;
    cachedTasks: Item[]; // Use Item[]
}

export class CommandManager {
    private plugin: TodoistSyncPlugin;
    private pendingCommands: Map<string, TodoistCommand> = new Map();
    private obsidianChangeTimeout: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_DELAY = 2000; // Increased debounce for safety
    private isProcessing = false;

    constructor(plugin: TodoistSyncPlugin) {
        this.plugin = plugin;
    }

    public queueTodoistCommand(command: TodoistCommand) {
        const commandKey = command.args.id ? String(command.args.id) : command.uuid;
        
        if (this.pendingCommands.has(commandKey)) {
            const existingCommand = this.pendingCommands.get(commandKey)!;
            if (existingCommand.type === "item_update" && command.type === "item_update") {
                existingCommand.args = { ...existingCommand.args, ...command.args };
                console.log(`[CommandManager] Merged item_update command for ID ${commandKey}`);
                this.scheduleProcessPendingCommands();
                return; 
            } else if (command.type === "item_complete" && (existingCommand.type === "item_update" || existingCommand.type === "item_uncomplete")) {
                // If completing, item_complete takes precedence over update/uncomplete for the same item in the queue
                this.pendingCommands.set(commandKey, command);
                console.log(`[CommandManager] item_complete overwrote pending ${existingCommand.type} for ID ${commandKey}`);
                this.scheduleProcessPendingCommands();
                return;
            } else if (command.type === "item_uncomplete" && existingCommand.type === "item_update") {
                 // If uncompleting, item_uncomplete takes precedence
                this.pendingCommands.set(commandKey, command);
                console.log(`[CommandManager] item_uncomplete overwrote pending ${existingCommand.type} for ID ${commandKey}`);
                this.scheduleProcessPendingCommands();
                return;
            }
            // Other conflicts? For now, let the new command overwrite if not specifically handled.
        }
        
        this.pendingCommands.set(commandKey, command);
        console.log(`[CommandManager] Queued command: ${command.type} for ID ${commandKey || command.temp_id}`);
        this.scheduleProcessPendingCommands();
    }

    private scheduleProcessPendingCommands() {
        if (this.obsidianChangeTimeout) {
            clearTimeout(this.obsidianChangeTimeout);
        }
        this.obsidianChangeTimeout = setTimeout(async () => {
            if (this.isProcessing) {
                console.log("[CommandManager] Already processing, will re-schedule.");
                this.scheduleProcessPendingCommands(); // Re-schedule if already processing
                return;
            }
            await this.processPendingCommands();
        }, this.DEBOUNCE_DELAY);
    }

    public async processPendingCommands(): Promise<void> {
        if (this.isProcessing || this.pendingCommands.size === 0) {
            if (this.pendingCommands.size === 0) {
                console.log("[CommandManager] No pending commands to process.");
            }
            return;
        }

        this.isProcessing = true;
        new Notice("Syncing local changes to Todoist...");
        console.log(`[CommandManager] Starting to process ${this.pendingCommands.size} pending commands.`);

        const commandsToProcess = Array.from(this.pendingCommands.values());
        this.pendingCommands.clear();

        const batchedTodoistCommands: TodoistCommand[] = [];
        // Store commands that need file operations AFTER API call
        const postApiFileOps: { command: TodoistCommand, originalFile?: TFile, newPath?: string | null }[] = [];


        for (const command of commandsToProcess) {
            batchedTodoistCommands.push(command); // All commands go to API first
            if (command.type === "item_complete") {
                 const taskId = String(command.args.id);
                 const filePath = this.plugin.taskFileCache.get(taskId);
                 if (filePath) {
                     const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                     if (file instanceof TFile) {
                         postApiFileOps.push({ command, originalFile: file });
                     }
                 }
            }
            // item_update might also lead to file moves if project/section changes, handle post-API
            if (command.type === "item_update" && (command.args.project_id || command.args.section_id)) {
                const taskId = String(command.args.id);
                const filePath = this.plugin.taskFileCache.get(taskId);
                if (filePath) {
                    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        postApiFileOps.push({ command, originalFile: file }); // Mark for potential move
                    }
                }
            }
        }

        if (batchedTodoistCommands.length > 0) {
            try {
                console.log("[CommandManager] Sending batched commands to Todoist:", batchedTodoistCommands.map(c => ({type: c.type, id: c.args.id, temp_id: c.temp_id })));
                
                const apiResult = await postTodoistCommands(
                    this.plugin.app, // Pass app instance
                    this.plugin.settings.apiKey, // Corrected settings key
                    batchedTodoistCommands
                );

                if (apiResult.success) {
                    new Notice("Local changes synced to Todoist.");
                    // Update caches based on successful commands and API response
                    for (const command of batchedTodoistCommands) {
                        const commandSuccess = apiResult.syncStatus && apiResult.syncStatus[command.uuid] === "ok";
                        if (!commandSuccess && command.type !== "item_add") { // item_add success is via temp_id_mapping
                            console.warn(`[CommandManager] Command ${command.uuid} (${command.type}) for ${command.args.id} failed or status not 'ok'. Skipping cache update for this command.`);
                            continue;
                        }

                        const taskId = String(command.args.id); // This might be a temp_id for new items
                        let realTaskId = taskId;

                        if (command.type === "item_add" && command.temp_id && apiResult.tempIdMapping && apiResult.tempIdMapping[command.temp_id]) {
                            realTaskId = apiResult.tempIdMapping[command.temp_id];
                            console.log(`[CommandManager] Mapped temp_id ${command.temp_id} to real_id ${realTaskId}`);
                            // Update taskFileCache for the new item if a file was pre-created
                            const tempFilePath = this.plugin.taskFileCache.get(command.temp_id);
                            if (tempFilePath) {
                                this.plugin.taskFileCache.set(realTaskId, tempFilePath);
                                this.plugin.taskFileCache.delete(command.temp_id);
                            }
                            // Update frontmatter of the new file with the real task_id
                            // This needs the file path, which should be associated with temp_id
                        }


                        const taskInCache = this.plugin.cachedTasks.find(t => t.id === realTaskId);

                        if (command.type === "item_complete") {
                            if (taskInCache) {
                                taskInCache.is_completed = true;
                                taskInCache.completed_at = command.args.completed_at || new Date().toISOString();
                            }
                            const op = postApiFileOps.find(p => p.command.uuid === command.uuid);
                            if (op) op.command.args.id = realTaskId; // Ensure real ID for file op
                        } else if (command.type === "item_update") {
                            if (taskInCache) {
                                if (command.args.content !== undefined) taskInCache.content = command.args.content;
                                if (command.args.due_string !== undefined) {
                                    if (!taskInCache.due) {
                                        taskInCache.due = { string: command.args.due_string, date: "", is_recurring: false }; // Basic init
                                    } else {
                                        taskInCache.due.string = command.args.due_string;
                                    }
                                    // Ideally, parse due_string or get full Due object from API response if available
                                }
                                if (command.args.priority !== undefined) taskInCache.priority = command.args.priority;
                                if (command.args.project_id !== undefined) taskInCache.project_id = command.args.project_id;
                                if (command.args.section_id !== undefined) taskInCache.section_id = command.args.section_id;
                                console.log(`[CommandManager] item_update for task ${realTaskId} cache updated.`);
                            }
                             const op = postApiFileOps.find(p => p.command.uuid === command.uuid);
                             if (op) op.command.args.id = realTaskId; // Ensure real ID for file op
                        }
                        // Add item_uncomplete cache updates here if/when implemented
                    }
                } else {
                    new Notice("Some local changes failed to sync to Todoist.");
                    // Re-queue failed commands? More complex logic needed here.
                    console.warn("[CommandManager] API call to postTodoistCommands reported failure for some commands.", apiResult.syncStatus);
                }

            } catch (error) {
                console.error("[CommandManager] Error sending commands to Todoist:", error);
                new Notice("Error sending changes to Todoist. See console.");
                // Re-queue all commands? Or selective re-queue?
            }
        }

        // Post-API File Operations
        for (const op of postApiFileOps) {
            const { command, originalFile } = op;
            if (!originalFile) continue;

            const realTaskId = String(command.args.id); // Should be real ID now

            if (command.type === "item_complete") {
                try {
                    await this.plugin.app.fileManager.processFrontMatter(originalFile, (fm: FrontMatterCache) => {
                        fm.completed = true;
                        fm.completed_at = command.args.completed_at || new Date().toISOString();
                        fm.task_id = realTaskId; // Ensure real task_id
                    });
                    const doneFolderPath = normalizePath(`${this.plugin.settings.baseFolder}/${this.plugin.settings.doneFolder}`);
                    const newPath = await moveFileToCustomLocation(
                        this.plugin.app,
                        originalFile,
                        doneFolderPath,
                        "completed task" 
                    );
                    if (newPath) {
                        this.plugin.taskFileCache.set(realTaskId, newPath);
                        console.log(`[CommandManager] Task ${realTaskId} file moved to Done folder: ${newPath}`);
                    } else {
                        console.warn(`[CommandManager] Failed to move file for completed task ${realTaskId} to Done folder.`);
                        // If move fails, taskFileCache might still point to old location.
                        // Depending on desired behavior, you might delete it or leave it.
                        // For now, leave it, as the file still exists at originalFile.path
                    }
                } catch (fileOpError) {
                    console.error(`[CommandManager] Error during file operations for completed task ${realTaskId}:`, fileOpError);
                    new Notice(`Error processing file for completed task ${realTaskId}.`);
                }
            }
            // TODO: Handle file moves for item_update if project_id/section_id changed
            // This would involve:
            // 1. Get the task from cachedTasks using realTaskId.
            // 2. Determine the new target path based on taskInCache.project_id and taskInCache.section_id.
            //    (You'll need a helper function to get the folder path for a project/section).
            // 3. Call moveFileToCustomLocation.
            // 4. Update taskFileCache.
        }

        this.isProcessing = false;
        console.log("[CommandManager] Finished processing pending commands.");
        if (this.pendingCommands.size > 0) {
            this.scheduleProcessPendingCommands();
        }
    }

    public cleanup() {
        if (this.obsidianChangeTimeout) {
            clearTimeout(this.obsidianChangeTimeout);
            this.obsidianChangeTimeout = null;
        }
        this.pendingCommands.clear();
        this.isProcessing = false; // Reset processing flag on cleanup
        console.log("[CommandManager] Cleaned up pending commands and timeout.");
    }
}