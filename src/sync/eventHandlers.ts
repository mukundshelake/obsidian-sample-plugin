import { TFile, CachedMetadata, Notice } from "obsidian";
import { findTodoistIdByPath } from "../obsidian/cacheManager";
import { generateUUID } from "../utils";
import { ItemCompleteArgs, ItemArgs } from "../todoist"; 
import TodoistSyncPlugin from "../../main";

/**
 * Sets up all event handlers for the plugin.
 */
export function setupEventHandlers(plugin: TodoistSyncPlugin) {
    console.log("[EventHandlers] setupEventHandlers called. Plugin instance:", plugin ? "Exists" : "MISSING"); // <<< DEBUG LOG

    plugin.registerEvent(
        plugin.app.metadataCache.on('changed', (file, data, cache) => {
            console.log(`[EventHandlers] metadataCache.on('changed') triggered for: ${file.path}`); // <<< DEBUG LOG
            handleMetadataChange(plugin, file, data, cache);
        })
    );

    plugin.registerEvent(
        plugin.app.vault.on('rename', async (file, oldPath) => {
            console.log(`[EventHandlers] vault.on('rename') triggered for: ${file.path} (old: ${oldPath})`); // <<< DEBUG LOG
            if (!(file instanceof TFile)) return;
            if (plugin.isSyncing) {
                console.log("[EventHandlers-Rename] Ignoring rename during active sync.");
                return;
            }

            const fileFrontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fileFrontmatter || !fileFrontmatter.task_id || fileFrontmatter.type !== 'task') {
                // console.log(`[EventHandlers-Rename] File ${file.basename} is not a synced task or missing task_id/type.`);
                return;
            }

            const taskId = String(fileFrontmatter.task_id);
            const cachedTask = plugin.cachedTasks.find(t => t.id === taskId);
            if (!cachedTask) {
                console.warn(`[EventHandlers-Rename] Task ${taskId} from renamed file ${file.path} not found in main task cache.`);
                return;
            }

            // Only use filename as content if frontmatter.content is empty, null, or not defined
            const frontmatterContent = fileFrontmatter.content;
            if (frontmatterContent === undefined || frontmatterContent === null || String(frontmatterContent).trim() === "") {
                const newContentFromFilename = file.basename;
                if (newContentFromFilename !== cachedTask.content) {
                    console.log(`[EventHandlers-Rename] File rename for task ${taskId}. New content from filename: '${newContentFromFilename}'`);
                    plugin.commandManager.queueTodoistCommand({
                        type: "item_update",
                        uuid: generateUUID(),
                        args: {
                            id: taskId,
                            content: newContentFromFilename,
                        } as ItemArgs // Cast to a suitable args type
                    });
                }
            }
        })
    );
}


/**
 * Handles Obsidian's metadata cache change events.
 * Detects relevant changes in task files and queues commands for Todoist.
 */
export function handleMetadataChange(
    plugin: TodoistSyncPlugin,
    file: TFile,
    data: string, 
    cache: CachedMetadata
) {
    console.log(`[EventHandlers] handleMetadataChange called for: ${file.path}. Plugin instance:`, plugin ? "Exists" : "MISSING"); // <<< DEBUG LOG
    if (!plugin) {
        console.error("[EventHandlers] CRITICAL: Plugin instance is null in handleMetadataChange!");
        return;
    }

    if (plugin.isSyncing) {
        console.log("[EventHandlers] Ignoring metadata change during active sync for file:", file.path); // <<< DEBUG LOG
        return;
    }

    if (file.extension !== 'md') {
        return;
    }

    const todoistId = findTodoistIdByPath(file.path, plugin.taskFileCache);
    console.log(`[EventHandlers] todoistId from findTodoistIdByPath for ${file.path}:`, todoistId); // <<< DEBUG LOG
    if (!todoistId) {
        // Not a task file we are tracking via its path in taskFileCache
        return;
    }

    const cachedTask = plugin.cachedTasks.find(t => String(t.id) === todoistId);
    console.log(`[EventHandlers] cachedTask for ID ${todoistId} from plugin.cachedTasks:`, cachedTask ? "Found" : "NOT Found"); // <<< DEBUG LOG
    if (!cachedTask) {
        // console.warn(`[EventHandlers] Task ID ${todoistId} from file ${file.path} found in file cache but not in main task cache. Ignoring potentially stale event.`);
        return;
    }

    const newFrontmatter = cache.frontmatter;
    console.log(`[EventHandlers] newFrontmatter for ${file.path}:`, newFrontmatter); // <<< DEBUG LOG
    if (!newFrontmatter || newFrontmatter.type !== 'task') {
        // console.log(`[EventHandlers] File ${file.path} (Task ID: ${todoistId}) is not of type 'task' or has no frontmatter.`);
        return;
    }

    // --- Detect Completion Change (Priority) ---
    // Note: Todoist API uses is_completed (boolean) and completed_at (timestamp string)
    // cachedTask.is_completed should be the source of truth from Todoist
    const wasCompletedInCache = cachedTask.is_completed;
    const isNowCompletedInFrontmatter = newFrontmatter.completed === true;
    let completionCommandQueued = false;

    if (isNowCompletedInFrontmatter && !wasCompletedInCache) {
        console.log(`[EventHandlers] Detected completion for task ${todoistId} in ${file.path}`);
        plugin.commandManager.queueTodoistCommand({
            type: "item_complete",
            uuid: generateUUID(),
            args: { id: todoistId, completed_at: new Date().toISOString() } as ItemCompleteArgs // Ensure completed_at is sent
        });
        completionCommandQueued = true;
    } else if (!isNowCompletedInFrontmatter && wasCompletedInCache && newFrontmatter.completed === false) { // Explicitly check for completed: false
        console.log(`[EventHandlers] Detected re-open for task ${todoistId} in ${file.path}`);
        plugin.commandManager.queueTodoistCommand({
            type: "item_uncomplete", // Assumes you have this command type in CommandManager
            uuid: generateUUID(),
            args: { id: todoistId }
        });
        completionCommandQueued = true;
    }

    // --- Detect Other Changes (Only if not a completion/uncompletion event) ---
    if (!completionCommandQueued) {
        const updateArgs: ItemArgs = { id: todoistId }; // Use a typed object
        let changed = false;

        // Content: Use frontmatter.content if present, otherwise filename (if frontmatter.content is empty/null/undefined)
        let currentContentInObsidian = newFrontmatter.content;
        if (currentContentInObsidian === undefined || currentContentInObsidian === null || String(currentContentInObsidian).trim() === "") {
            currentContentInObsidian = file.basename; // Fallback to filename
        }

        if (currentContentInObsidian !== cachedTask.content) {
            updateArgs.content = currentContentInObsidian;
            changed = true;
            console.log(`[EventHandlers] Content change for ${todoistId}: '${currentContentInObsidian}' (was: '${cachedTask.content}')`);
        }

        // Description
        if (newFrontmatter.description !== undefined && newFrontmatter.description !== cachedTask.description) {
            updateArgs.description = newFrontmatter.description;
            changed = true;
            console.log(`[EventHandlers] Description change for ${todoistId}: '${newFrontmatter.description}' (was: '${cachedTask.description}')`);
        }

        // Priority
        // Ensure priority is treated as a number. Todoist API expects integer 1-4.
        const newPriority = newFrontmatter.priority !== undefined ? Number(newFrontmatter.priority) : undefined;
        if (newPriority !== undefined && newPriority !== cachedTask.priority) {
            if (newPriority >= 1 && newPriority <= 4) { // Basic validation
                updateArgs.priority = newPriority;
                changed = true;
                console.log(`[EventHandlers] Priority change for ${todoistId}: ${newPriority} (was: ${cachedTask.priority})`);
            } else {
                console.warn(`[EventHandlers] Invalid priority value ${newPriority} for task ${todoistId}. Must be 1-4.`);
            }
        }

        // Due String
        // Compare with cachedTask.due?.string to handle cases where due might be null in cache
        const newDueString = newFrontmatter.due_string;
        const cachedDueString = cachedTask.due ? cachedTask.due.string : null;
        if (newDueString !== undefined && newDueString !== cachedDueString) {
            updateArgs.due_string = newDueString; // CommandManager will pass this to Todoist
            changed = true;
            console.log(`[EventHandlers] Due_string change for ${todoistId}: '${newDueString}' (was: '${cachedDueString}')`);
        }
        
        // Add other fields like 'labels' if you manage them
        // if (newFrontmatter.labels !== undefined && !areArraysEqual(newFrontmatter.labels, cachedTask.labels)) {
        //    updateArgs.labels = newFrontmatter.labels;
        //    changed = true;
        // }


        if (changed) {
            console.log(`[EventHandlers] Queuing item_update for task ${todoistId} with args:`, updateArgs);
            plugin.commandManager.queueTodoistCommand({
                type: "item_update",
                args: updateArgs,
                uuid: generateUUID()
            });
        }
    }
}