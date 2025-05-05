import { TFile, CachedMetadata } from "obsidian";
import { findTodoistIdByPath } from "../obsidian/cacheManager";
import { generateUUID } from "../utils";
import { ItemCompleteArgs } from "../todoist";
import TodoistSyncPlugin from "../../main"; // Import main plugin type

/**
 * Handles Obsidian's metadata cache change events.
 * Detects relevant changes in task files and queues commands for Todoist.
 */
export function handleMetadataChange(
    plugin: TodoistSyncPlugin, // Pass plugin instance for access to caches and commandManager
    file: TFile,
    data: string,
    cache: CachedMetadata
) {
    // Check 1: Ignore if sync is actively running
    if (plugin.isSyncing) {
        return;
    }

    // Basic check: Is it a markdown file?
    if (file.extension !== 'md') {
        return;
    }

    // Check if it's a task file managed by us (using file cache)
    const todoistId = findTodoistIdByPath(file.path, plugin.taskFileCache);
    if (!todoistId) {
        return;
    }

    // Check 2: Verify ID exists in the main task data cache
    const cachedTask = plugin.cachedTasks.find(t => String(t.id) === todoistId);
    if (!cachedTask) {
        // console.warn(`[Obsidian Change] Task ID ${todoistId} from file ${file.path} found in file cache but not in main task cache. Ignoring potentially stale event.`);
        return; // Ignore inconsistent state
    }

    // Get the *new* frontmatter state
    const newFrontmatter = cache.frontmatter;
    if (!newFrontmatter || newFrontmatter.type !== 'task') {
        return;
    }

    // --- Proceed with change detection and command queuing ---
    // (Using the 'cachedTask' variable we already found)

    // --- Detect Completion Change ---
    const wasCompleted = !!cachedTask.completed_at;
    const isNowCompleted = newFrontmatter.completed === true;
    let commandQueued = false; // Keep track if any command was queued

    if (isNowCompleted && !wasCompleted) {
        console.log(`[Obsidian Change] Detected completion for task ${todoistId} in ${file.path}`);
        plugin.commandManager.queueTodoistCommand({
            type: "item_complete",
            uuid: generateUUID(),
            temp_id: generateUUID(),
            args: { id: todoistId } as ItemCompleteArgs
        });
        commandQueued = true;
    }
    else if (!isNowCompleted && wasCompleted) {
        console.log(`[Obsidian Change] Detected re-open for task ${todoistId} in ${file.path}`);
        plugin.commandManager.queueTodoistCommand({
            type: "item_uncomplete",
            uuid: generateUUID(),
            temp_id: generateUUID(),
            args: { id: todoistId }
        });
        commandQueued = true;
    }

    // --- Detect Other Changes ---
    // Only queue update if completion wasn't handled above to avoid conflicts
    if (!commandQueued) {
        const changedFields: string[] = [];
        if (newFrontmatter.content !== cachedTask.content) changedFields.push('content');
        if (newFrontmatter.description !== cachedTask.description) changedFields.push('description');
        // Add other comparisons...

        if (changedFields.length > 0) {
             console.log(`[Obsidian Change] Detected updates for task ${todoistId} in ${file.path}: ${changedFields.join(', ')}`);
             const commandArgs: any = { id: todoistId };
             changedFields.forEach(field => {
                 commandArgs[field] = newFrontmatter[field];
                 // Add field transformations if needed
             });

             if (Object.keys(commandArgs).length > 1) {
                 plugin.commandManager.queueTodoistCommand({
                     type: "item_update",
                     args: commandArgs,
                     uuid: generateUUID()
                 });
                 // commandQueued = true; // Not strictly needed here anymore
             }
        }
    }
}