import { App, TFile, TFolder, normalizePath, Notice, Vault, MetadataCache } from "obsidian";
import { TodoistSyncSettings } from "../types";

// --- File/Folder Moving ---

/**
 * Moves a single FILE to a target parent folder, handling name conflicts.
 * Ensures the target parent folder exists.
 */
export async function moveFileToCustomLocation(
    app: App,
    fileToMove: TFile,
    targetParentPath: string,
    itemTypeDescription: string
) {
    try {
        // Ensure target parent folder exists
        if (!app.vault.getAbstractFileByPath(targetParentPath)) {
            console.log(`[Obsidian Sync] Creating target folder for move: ${targetParentPath}`);
            await app.vault.createFolder(targetParentPath);
        }

        let targetPath = normalizePath(`${targetParentPath}/${fileToMove.name}`);
        let conflictIndex = 0;
        // Handle potential name conflicts for the file
        while (app.vault.getAbstractFileByPath(targetPath)) {
            conflictIndex++;
            const nameWithoutExt = fileToMove.basename;
            targetPath = normalizePath(`${targetParentPath}/${nameWithoutExt}_${conflictIndex}.${fileToMove.extension}`);
        }
        console.log(`[Obsidian Sync] Moving ${itemTypeDescription} ${fileToMove.path} to ${targetPath}`);

        await app.fileManager.renameFile(fileToMove, targetPath);

    } catch (moveError) {
        console.error(`[Obsidian Sync] Failed to move ${itemTypeDescription} ${fileToMove.path} to ${targetParentPath}:`, moveError);
        throw moveError; // Re-throw error
    }
}

/**
 * Moves a FOLDER to a target parent folder, handling name conflicts.
 */
export async function moveFolderToCustomLocation(
    app: App,
    folderToMove: TFolder,
    targetParentPath: string,
    itemTypeDescription: string
) {
    let targetPath = normalizePath(`${targetParentPath}/${folderToMove.name}`);
    let conflictIndex = 0;
    // Handle potential name conflicts for the folder itself
    while (app.vault.getAbstractFileByPath(targetPath)) {
        conflictIndex++;
        targetPath = normalizePath(`${targetParentPath}/${folderToMove.name}_${conflictIndex}`);
    }
    console.log(`[Obsidian Sync] Moving ${itemTypeDescription} ${folderToMove.path} to ${targetPath}`);
    try {
        // Ensure target parent folder exists (might be redundant if called after file move check, but safe)
        if (!app.vault.getAbstractFileByPath(targetParentPath)) {
            console.log(`[Obsidian Sync] Creating target folder for move: ${targetParentPath}`);
            await app.vault.createFolder(targetParentPath);
        }
        await app.fileManager.renameFile(folderToMove, targetPath);
    } catch (moveError) {
        console.error(`[Obsidian Sync] Failed to move ${itemTypeDescription} ${folderToMove.path} to ${targetPath}:`, moveError);
        // Fallback? Maybe try Obsidian trash?
    }
}

/**
 * Consolidated helper for moving folder or file to a target location (Archive, Done, Trash).
 */
export async function handleMove(
    app: App,
    settings: TodoistSyncSettings,
    folderToMove: TFolder | null, // The folder (e.g., project or section folder)
    fileToMove: TFile | null,     // The specific file (e.g., index file or task file)
    destinationParentPath: string, // e.g., Trash folder path, Archive folder path
    itemType: 'project' | 'section' | 'task', // Added for logging clarity
    isSubFolder: boolean = false // Flag for sections/tasks within projects
): Promise<void> {
    const vault = app.vault;
    const fileManager = app.fileManager;
    const normalizedBaseFolderPath = normalizePath(settings.baseFolder); // Get base folder path

    try {
        // --- Ensure destination exists ---
        if (!await vault.adapter.exists(destinationParentPath)) {
            console.log(`[Obsidian Sync] Creating destination folder: ${destinationParentPath}`);
            await vault.createFolder(destinationParentPath);
        }

        // --- Prioritize moving the FOLDER if it exists ---
        if (folderToMove instanceof TFolder) {
            const destinationPath = normalizePath(`${destinationParentPath}/${folderToMove.name}`);
            console.log(`[Obsidian Sync] Moving ${itemType} FOLDER ${folderToMove.path} to ${destinationPath}`);

            // --- CRITICAL SAFETY CHECK ---
            // Prevent moving a folder into itself or a subfolder, or moving the base folder itself inappropriately
            if (destinationPath.startsWith(normalizePath(folderToMove.path + '/')) || destinationPath === folderToMove.path) {
                console.error(`[Obsidian Sync] Invalid move: Cannot move folder "${folderToMove.path}" into itself or a subfolder "${destinationPath}". Skipping move.`);
                // Optionally, trash the folder if it's not the absolute base folder
                if (folderToMove.path !== normalizedBaseFolderPath) {
                    console.warn(`[Obsidian Sync] Trashing folder ${folderToMove.path} using vault.trash() as fallback for invalid move.`);
                    await vault.trash(folderToMove, true); // Use system trash
                } else {
                    console.error(`[Obsidian Sync] Attempted invalid move/trash on the base folder "${normalizedBaseFolderPath}". Operation aborted.`);
                }
                return; // Prevent the invalid renameFile call
            }
            // --- END SAFETY CHECK ---


            // Check if destination already exists (handle potential conflicts)
            const existingDest = vault.getAbstractFileByPath(destinationPath);
            if (existingDest) {
                // Basic conflict resolution: append timestamp or delete old?
                // For now, let's log a warning and skip if it's the same type.
                // A more robust solution might involve merging or renaming.
                if (existingDest instanceof TFolder) {
                     console.warn(`[Obsidian Sync] Destination folder ${destinationPath} already exists. Skipping move for ${folderToMove.path}. Consider manual cleanup.`);
                     // Optionally delete the source if skipping: await vault.trash(folderToMove, true);
                     return; // Exit early to avoid error
                } else {
                    // If it's a file, maybe delete it? Risky. Log and skip.
                     console.warn(`[Obsidian Sync] Destination ${destinationPath} exists but is a FILE. Skipping move for folder ${folderToMove.path}.`);
                     return;
                }
            }

            try {
                 await fileManager.renameFile(folderToMove, destinationPath); // Use renameFile for moving folders too
                 console.log(`[Obsidian Sync] Successfully moved ${itemType} folder to ${destinationPath}`);
            } catch (moveError) {
                 console.error(`[Obsidian Sync] Error moving ${itemType} folder ${folderToMove.path} to ${destinationPath}:`, moveError);
                 // Fallback: Try trashing directly if move fails and it's not the base folder
                 if (folderToMove.path !== normalizedBaseFolderPath) {
                     try {
                         console.warn(`[Obsidian Sync] Move failed, attempting vault.trash() for folder ${folderToMove.path}`);
                         await vault.trash(folderToMove, true);
                     } catch (trashError) {
                         console.error(`[Obsidian Sync] Fallback trash also failed for folder ${folderToMove.path}:`, trashError);
                     }
                 }
            }
            // If the folder move was attempted, we don't need to move the file separately
            return; // Exit after folder move attempt
        }
        // --- End Folder Move Logic ---


        // --- If no folder was moved, move the FILE if it exists ---
        if (fileToMove instanceof TFile) {
            const destinationPath = normalizePath(`${destinationParentPath}/${fileToMove.name}`);
             console.log(`[Obsidian Sync] Moving ${itemType} FILE ${fileToMove.path} to ${destinationPath}`);

            // Check for conflicts at the destination file path
            const existingDest = vault.getAbstractFileByPath(destinationPath);
             if (existingDest) {
                 if (existingDest instanceof TFile) {
                     console.warn(`[Obsidian Sync] Destination file ${destinationPath} already exists. Overwriting.`);
                     // Obsidian's renameFile might handle overwrite, or we might need to delete first.
                     // Let's assume renameFile handles it or errors appropriately for now.
                     // Safer: await vault.trash(existingDest, true);
                 } else {
                     console.warn(`[Obsidian Sync] Destination ${destinationPath} exists but is a FOLDER. Skipping move for file ${fileToMove.path}.`);
                     return;
                 }
            }

            try {
                await fileManager.renameFile(fileToMove, destinationPath);
                console.log(`[Obsidian Sync] Successfully moved ${itemType} file to ${destinationPath}`);
            } catch (moveError) {
                 console.error(`[Obsidian Sync] Error moving ${itemType} file ${fileToMove.path} to ${destinationPath}:`, moveError);
                 // Fallback: Try trashing directly?
                 // await vault.trash(fileToMove, true);
            }
            return; // Exit after file move attempt
        }
        // --- End File Move Logic ---

        // If neither folder nor file was provided or found
        console.log(`[Obsidian Sync] handleMove called for ${itemType}, but no valid folder or file provided/found to move.`);

    } catch (error) {
        console.error(`[Obsidian Sync] General error in handleMove for ${itemType}:`, error);
        new Notice(`Error moving ${itemType} item. Check console.`);
    }
}

// --- Trashing / Archiving ---

/**
 * Moves a file to a specified custom "trash" folder (used as fallback).
 * Note: Might be less necessary if moveFileToCustomLocation is robust.
 */
export async function moveFileToCustomTrash(
    app: App,
    file: TFile,
    trashFolderPath: string,
    type: string
) {
    let targetTrashPath = normalizePath(`${trashFolderPath}/${file.name}`);
    let conflictIndex = 0;
    while (app.vault.getAbstractFileByPath(targetTrashPath)) {
        conflictIndex++;
        const nameWithoutExt = file.basename;
        targetTrashPath = normalizePath(`${trashFolderPath}/${nameWithoutExt}_${conflictIndex}.${file.extension}`);
    }
    console.log(`[Obsidian Sync] Moving deleted ${type} file ${file.path} to custom trash: ${targetTrashPath}`);
    try {
        // Ensure trash folder exists
        if (!app.vault.getAbstractFileByPath(trashFolderPath)) {
            await app.vault.createFolder(trashFolderPath);
        }
        await app.fileManager.renameFile(file, targetTrashPath);
    } catch (moveError) {
        console.error(`[Obsidian Sync] Failed to move deleted ${type} file ${file.path} to custom trash:`, moveError);
        // Optionally, try Obsidian trash as final fallback?
        // await app.vault.trash(file, false);
    }
}


/**
 * Handles cleanup during full sync: Moves completed tasks to Done,
 * moves other missing items (projects, sections, non-completed tasks) to Obsidian trash.
 * Needs access to caches to remove entries.
 */
export async function trashOrArchiveFileById(
    app: App,
    settings: TodoistSyncSettings,
    caches: { // Pass caches needed for removal
        projectFileCache: Map<string, string>,
        sectionFileCache: Map<string, string>,
        taskFileCache: Map<string, string>
    },
    id: string,
    type: 'project' | 'section' | 'task',
    filePath: string
) {
    let shouldTrash = true; // Default to trashing items missing from full sync
    let targetMovePath: string | null = null; // Path for moving completed tasks

    try {
        const file = app.vault.getAbstractFileByPath(filePath);

        if (file instanceof TFile) {
            // --- Check completion status for tasks during full sync cleanup ---
            if (type === 'task') {
                const metadata = app.metadataCache.getFileCache(file);
                if (metadata?.frontmatter?.completed === true) {
                    shouldTrash = false; // Don't trash completed tasks found during cleanup
                    console.log(`[Obsidian Sync] Task ${id} (cleanup) is completed. Preparing move to Done folder.`);

                    const doneFolder = normalizePath(`${settings.baseFolder}/${settings.doneFolder}`);
                    try {
                        // Ensure Done folder exists
                        if (!app.vault.getAbstractFileByPath(doneFolder)) {
                            await app.vault.createFolder(doneFolder);
                        }
                        // Calculate target path in Done folder
                        targetMovePath = normalizePath(`${doneFolder}/${file.name}`);
                        let conflictIndex = 0;
                        let uniqueDonePath = targetMovePath;
                        while (app.vault.getAbstractFileByPath(uniqueDonePath)) {
                            conflictIndex++;
                            const nameWithoutExt = file.basename;
                            uniqueDonePath = normalizePath(`${doneFolder}/${nameWithoutExt}_${conflictIndex}.${file.extension}`);
                        }
                        targetMovePath = uniqueDonePath;

                    } catch (doneError) {
                        console.error(`[Obsidian Sync] Error preparing Done location for ${filePath}:`, doneError);
                        shouldTrash = true; // Fallback to trashing if Done setup fails
                        targetMovePath = null;
                    }
                }
            }
            // --- End completion check ---

            if (shouldTrash) {
                console.log(`[Obsidian Sync] Trashing ${type} file (cleanup): ${filePath}`);
                await app.vault.trash(file, false); // Move to Obsidian trash

                // Optional: Attempt to trash parent folder for projects/sections if empty
                const parentFolder = file.parent;
                if (parentFolder && parentFolder.path !== settings.baseFolder && (type === 'project' || type === 'section')) {
                    const sanitizedNameFromFile = file.basename;
                    if (parentFolder.name === sanitizedNameFromFile) {
                         if (parentFolder.children.length === 1 && parentFolder.children[0] === file) {
                             console.log(`[Obsidian Sync] Attempting to trash empty parent folder after trashing file: ${parentFolder.path}`);
                             await app.vault.trash(parentFolder, false);
                         }
                    }
                }
            } else if (targetMovePath) {
                // Move completed task to Done folder
                console.log(`[Obsidian Sync] Moving completed task file ${filePath} (cleanup) to Done: ${targetMovePath}`);
                await app.fileManager.renameFile(file, targetMovePath);
            }

        } else if (file instanceof TFolder && (type === 'project' || type === 'section')) {
             console.warn(`[Obsidian Sync] Cache pointed directly to folder ${filePath} for ${type} ID ${id}. Attempting to trash if empty.`);
             if (file.children.length === 0) {
                await app.vault.trash(file, false);
             } else {
                console.warn(`[Obsidian Sync] Folder ${filePath} is not empty, not trashing.`);
             }
        } else {
            console.warn(`[Obsidian Sync] File/Folder not found at path ${filePath} during cleanup for ${type} ID ${id}.`);
        }
    } catch (error) {
        console.error(`[Obsidian Sync] Error during cleanup for ${type} with ID ${id} at path ${filePath}:`, error);
    } finally {
        // Always remove from the passed-in cache maps
        switch (type) {
            case 'project': caches.projectFileCache.delete(id); break;
            case 'section': caches.sectionFileCache.delete(id); break;
            case 'task': caches.taskFileCache.delete(id); break;
        }
    }
}