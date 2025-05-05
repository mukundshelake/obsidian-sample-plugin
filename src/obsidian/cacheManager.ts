import { App, TFile, normalizePath, MetadataCache } from "obsidian";
import { TodoistSyncSettings } from "../types";

/**
 * Populates the file caches by scanning the vault based on frontmatter.
 * Clears existing caches before populating.
 */
export async function populateAllCaches(
    app: App,
    settings: TodoistSyncSettings,
    caches: { // Pass cache maps to modify
        projectFileCache: Map<string, string>,
        sectionFileCache: Map<string, string>,
        taskFileCache: Map<string, string>
    }
) {
    console.log("[Cache] Populating all file caches from vault...");
    caches.projectFileCache.clear();
    caches.sectionFileCache.clear();
    caches.taskFileCache.clear();

    const files = app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
        // Check if the file is within the base folder to potentially speed up
        if (!file.path.startsWith(settings.baseFolder + '/')) {
            continue;
        }

        const metadata = app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;

        if (frontmatter && frontmatter.todoist_id) {
            const idStr = String(frontmatter.todoist_id);
            const type = frontmatter.type; // project, section, task

            if (type === 'project') {
                caches.projectFileCache.set(idStr, file.path);
                count++;
            } else if (type === 'section') {
                caches.sectionFileCache.set(idStr, file.path);
                count++;
            } else if (type === 'task') {
                caches.taskFileCache.set(idStr, file.path);
                count++;
            }
        }
    }
    console.log(`[Cache] Finished populating file caches. Found ${count} items.`);
}


/**
 * Helper to find Todoist ID from the task file path cache.
 */
export function findTodoistIdByPath(
    filePath: string,
    taskFileCache: Map<string, string> // Pass the specific cache needed
): string | null {
    for (const [id, path] of taskFileCache.entries()) {
        if (path === filePath) {
            return id;
        }
    }
    return null;
}

// You could potentially add findProjectIdByPath and findSectionIdByPath here too if needed.