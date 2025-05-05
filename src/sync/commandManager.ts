import { App, Notice, TFile, normalizePath } from "obsidian";
import { TodoistCommand, postTodoistCommands } from "../todoist";
import { TodoistSyncSettings } from "../types";
import { moveFileToCustomLocation } from "../obsidian/fileManager";
import TodoistSyncPlugin from "../../main"; // Import main plugin type for context

// Define a type for the caches needed by command processing
interface CommandSyncCaches {
    taskFileCache: Map<string, string>;
    cachedTasks: { id: string; completed_at?: string | null }[]; // Simplified cache type needed here
}

export class CommandManager {
    private plugin: TodoistSyncPlugin; // Keep reference to plugin for settings, app, caches etc.
    private pendingCommands: Map<string, TodoistCommand> = new Map();
    private obsidianChangeTimeout: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_DELAY = 1000; // milliseconds

    constructor(plugin: TodoistSyncPlugin) {
        this.plugin = plugin;
    }

    /**
     * Queues a command to be sent to Todoist, debouncing the actual processing.
     */
    public queueTodoistCommand(command: TodoistCommand) {
        // Use task ID as the key to ensure only the latest change for a task is queued
        const commandKey = command.args.id ? String(command.args.id) : command.uuid;

        console.log(`[Obsidian Change] Queuing command: ${command.type} for ID ${commandKey}`);
        this.pendingCommands.set(commandKey, command);

        // Clear existing timeout if there is one
        if (this.obsidianChangeTimeout) {
            clearTimeout(this.obsidianChangeTimeout);
        }

        // Set a new timeout
        this.obsidianChangeTimeout = setTimeout(() => {
            this.processPendingCommands();
        }, this.DEBOUNCE_DELAY);
    }

    /**
     * Processes the queued commands by sending them to the Todoist Sync API.
     * Updates local state (cache, files) based on successful commands.
     */
    private async processPendingCommands() {
        if (this.pendingCommands.size === 0) {
            return; // Nothing to process
        }

        // Get commands and clear the pending map and timeout reference
        const commandsToProcess = Array.from(this.pendingCommands.values());
        this.pendingCommands.clear();
        this.obsidianChangeTimeout = null;

        console.log(`[Obsidian Change] Processing ${commandsToProcess.length} queued command(s).`);
        this.plugin.updateStatusBar('Todoist Sync: Sending...', 'syncing'); // Use plugin's public method

        const result = await postTodoistCommands(this.plugin.app, this.plugin.settings.apiKey, commandsToProcess);

        if (result.success) {
            console.log("[Obsidian Change] Commands processed successfully by Todoist.");
            // --- Update internal cache AND local files based on successful commands ---
            if (result.syncStatus) {
                const updatePromises = commandsToProcess.map(async (cmd) => {
                    const status = result.syncStatus![cmd.uuid];
                    if (status === "ok") {
                        const taskId = String(cmd.args.id); // Ensure string ID

                        // --- Handle Successful Item Completion ---
                        if (cmd.type === "item_complete") {
                            // 1. Update internal API cache (passed via plugin reference)
                            // Note: This assumes syncEngine has updated the main cache arrays.
                            // For robustness, CommandManager could hold its own simplified cache or
                            // have methods passed to update the main plugin cache.
                            // Let's assume direct access for now, but mark as potential refactor point.
                            const taskIndex = this.plugin.cachedTasks.findIndex(t => String(t.id) === taskId);
                            if (taskIndex !== -1) {
                                this.plugin.cachedTasks[taskIndex].completed_at = new Date().toISOString(); // Mark as completed locally
                                console.log(`[Cache Update] Marked task ${taskId} as completed in local API cache.`);
                            }

                            // 2. Update local file (frontmatter and move)
                            const filePath = this.plugin.taskFileCache.get(taskId); // Access via plugin
                            if (filePath) {
                                const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                                if (file instanceof TFile) {
                                    try {
                                        console.log(`[Obsidian Change] Updating frontmatter for locally completed task ${taskId} at ${filePath}`);
                                        await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
                                            fm.completed = true;
                                            fm.completed_at = new Date().toISOString();
                                        });

                                        console.log(`[Obsidian Change] Moving locally completed task ${taskId} to Done folder.`);
                                        const doneFolderPath = normalizePath(`${this.plugin.settings.baseFolder}/${this.plugin.settings.doneFolder}`);
                                        // Use imported file manager function
                                        await moveFileToCustomLocation(this.plugin.app, file, doneFolderPath, 'locally completed task file');

                                        // 3. Remove from file cache after successful move
                                        this.plugin.taskFileCache.delete(taskId); // Access via plugin

                                    } catch (fileError) {
                                        console.error(`[Obsidian Change] Error updating/moving file for completed task ${taskId} at ${filePath}:`, fileError);
                                    }
                                } else {
                                    console.warn(`[Obsidian Change] File for completed task ${taskId} not found at cached path ${filePath} during post-command update.`);
                                    this.plugin.taskFileCache.delete(taskId); // Remove stale cache entry
                                }
                            } else {
                                console.warn(`[Obsidian Change] File path for completed task ${taskId} not found in cache during post-command update.`);
                            }
                        }
                        // --- Add logic for other command types (item_uncomplete, item_update, etc.) here ---
                        // Example: If item_uncomplete succeeds, update cache, update frontmatter (completed: false, completed_at: null), move file back from Done folder?
                    } else {
                         console.warn(`[Obsidian Change] Command ${cmd.uuid} (${cmd.type} for ${cmd.args.id}) failed with status: ${status}`);
                         // Optionally re-queue failed commands? Or just notify user?
                         new Notice(`Failed to apply change for task ${cmd.args.id} to Todoist.`);
                    }
                });
                // Wait for all file operations to settle
                await Promise.allSettled(updatePromises);
            }
            this.plugin.updateStatusBar(`Todoist Synced: ${new Date().toLocaleTimeString()}`, 'idle'); // Update status bar on success

        } else {
            console.error("[Obsidian Change] Failed to process commands via Todoist API:", result.error);
            new Notice("Failed to send changes to Todoist. Check console.");
            this.plugin.updateStatusBar('Todoist Sync: Error', 'error'); // Update status bar on failure
            // Consider re-queueing commands?
            // commandsToProcess.forEach(cmd => this.pendingCommands.set(cmd.args.id ? String(cmd.args.id) : cmd.uuid, cmd));
        }
    }

    /**
     * Cleans up resources used by the CommandManager, like pending timeouts.
     */
    public cleanup() {
        if (this.obsidianChangeTimeout) {
            clearTimeout(this.obsidianChangeTimeout);
            this.obsidianChangeTimeout = null;
            console.log("[CommandManager] Cleared pending command timeout.");
        }
        // Add any other cleanup needed
    }
}