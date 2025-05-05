import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { fetchTodoistData, Project, Section, Item } from "../todoist"; // API fetch and types
import { TodoistSyncSettings } from "../types";
import { mergeById } from "../utils"; // Utility
import { populateAllCaches } from "../obsidian/cacheManager"; // Cache population
import { updateObsidianProjectFile, updateObsidianSectionFile, updateObsidianTask } from "../obsidian/frontmatter"; // Frontmatter updates
import { handleMove, trashOrArchiveFileById, moveFileToCustomLocation } from "../obsidian/fileManager"; // File operations
import TodoistSyncPlugin from "../../main"; // Import the main plugin type

// Helper function to sanitize file/folder names
function sanitizeName(name: string): string {
    // Replace invalid characters with underscores or remove them
    // Example: Replace / \ : * ? " < > | with _
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

// Define a type for the caches to pass
export interface SyncCaches { // <-- Add 'export' here
    projectFileCache: Map<string, string>;
    sectionFileCache: Map<string, string>;
    taskFileCache: Map<string, string>;
    cachedProjects: Project[];
    cachedSections: Section[];
    cachedTasks: Item[];
}

export async function syncOrFullSyncTasks(
    plugin: TodoistSyncPlugin, // Keep plugin for app, settings, status bar
    isFullSync: boolean,
    isInitialLoad: boolean, // Pass initial load state
    caches: SyncCaches // Pass caches object
): Promise<{ // Return updated state
    newIsInitialLoad: boolean,
    updatedCaches: SyncCaches
}> {
    console.log("[Cache Debug] Entering syncOrFullSyncTasks. Initial caches:", JSON.stringify({
        projectFileCacheSize: caches.projectFileCache.size,
        sectionFileCacheSize: caches.sectionFileCache.size,
        taskFileCacheSize: caches.taskFileCache.size,
        cachedProjectsCount: caches.cachedProjects.length,
        cachedSectionsCount: caches.cachedSections.length,
        cachedTasksCount: caches.cachedTasks.length,
        isFullSync,
        isInitialLoad
    }, null, 2));

    // Use plugin.app, plugin.settings
    // Use caches.projectFileCache, caches.cachedProjects etc.
    // Use isInitialLoad parameter

    // Check if API key is set
    if (!plugin.settings.apiKey) {
        new Notice("Todoist API Key is not set. Please configure it in the plugin settings.");
        console.warn("[Obsidian Sync] Todoist API Key is not set.");
        // Return original state on early exit
        return { newIsInitialLoad: isInitialLoad, updatedCaches: caches };
    }

    // --- Declare variables outside try block ---
    const vault = plugin.app.vault;
    let syncErrorOccurred = false;
    let newIsInitialLoad = isInitialLoad;
    const syncType = isFullSync ? 'full' : 'incremental'; // <-- Declare and initialize here
    // --- End declarations ---

    // Update Status Bar - Start
    plugin.updateStatusBar('Todoist Sync: Syncing...', 'syncing'); // Use public method
    console.log(`[Obsidian Sync] Starting ${syncType} Todoist sync...`); // Log start
    new Notice(`Starting ${syncType} Todoist sync...`); // Notify start

    try { // Wrap main sync logic in try...finally
        // --- Declare variables here ---
        let tasksToProcess: Item[] = []; // <-- Declare tasksToProcess
        let lookupProjectsApi: Project[] = [];
        let lookupSectionsApi: Section[] = [];
        // --- End declarations ---

        // --- Check if cache is needed and empty ---
        const cachesToPopulate = { // Prepare caches object for populateAllCaches
            projectFileCache: caches.projectFileCache,
            sectionFileCache: caches.sectionFileCache,
            taskFileCache: caches.taskFileCache
        };
        console.log("[Cache Debug] Checking if initial load and caches empty. Sizes:", { p: caches.projectFileCache.size, s: caches.sectionFileCache.size, t: caches.taskFileCache.size });
        if (!isFullSync && isInitialLoad && (caches.projectFileCache.size === 0 || caches.sectionFileCache.size === 0 || caches.taskFileCache.size === 0)) {
            console.log("[Obsidian Sync] File cache is empty on first incremental sync attempt. Forcing full sync.");
            isFullSync = true; // Force full sync if caches are empty
            // Repopulate caches before proceeding with the forced full sync
            console.log("[Cache Debug] Calling populateAllCaches due to empty cache on initial incremental sync.");
            await populateAllCaches(plugin.app, plugin.settings, cachesToPopulate);
            console.log("[Cache Debug] Finished populateAllCaches. New sizes:", { p: caches.projectFileCache.size, s: caches.sectionFileCache.size, t: caches.taskFileCache.size });
        }

        // --- Fetch Data ---
        let fetchedData;
        try {
            console.log("[Cache Debug] Fetching Todoist data...");
            fetchedData = await fetchTodoistData(plugin.settings.apiKey, plugin.app, isFullSync);
            console.log("[Cache Debug] Fetched Todoist data:", fetchedData ? { projects: fetchedData.projects?.length, sections: fetchedData.sections?.length, tasks: fetchedData.tasks?.length } : "null");
        } catch (error) {
            console.error("[Obsidian Sync] Error fetching data:", error);
            new Notice("Error fetching data from Todoist. Check console.");
            syncErrorOccurred = true; // Set error flag
            // Return original state on early exit
            return { newIsInitialLoad: isInitialLoad, updatedCaches: caches };
        }
        if (!fetchedData) {
            new Notice("Failed to fetch data from Todoist. Check API key and console.");
            syncErrorOccurred = true; // Set error flag
            // Return original state on early exit
            return { newIsInitialLoad: isInitialLoad, updatedCaches: caches };
        }

        // --- Create Sets of IDs for efficient lookup ---
        const projectIdsInDelta = new Set((fetchedData.projects || []).map(p => String(p.id)));
        const sectionIdsInDelta = new Set((fetchedData.sections || []).map(s => String(s.id)));
        const taskIdsInDelta = new Set((fetchedData.tasks || []).map(t => String(t.id)));


        // --- Determine Data for Lookups and Update API Data Cache ---
        if (isFullSync) {
            console.log("[Cache Debug] Full Sync: Updating API caches directly from fetched data.");
            // Full Sync: Use fetched data directly for lookups and update cache
            lookupProjectsApi = fetchedData.projects || [];
            lookupSectionsApi = fetchedData.sections || [];
            tasksToProcess = fetchedData.tasks || [];
            // Update main caches
            caches.cachedProjects = lookupProjectsApi;
            caches.cachedSections = lookupSectionsApi;
            caches.cachedTasks = tasksToProcess;
            console.log("[Cache Debug] Full Sync: API caches updated. Counts:", { projects: caches.cachedProjects.length, sections: caches.cachedSections.length, tasks: caches.cachedTasks.length });
            newIsInitialLoad = false;
            // TODO: Consider if populateAllCaches is needed here for file caches on full sync
            console.log("[Cache Debug] Full Sync: Calling populateAllCaches for file caches.");
            await populateAllCaches(plugin.app, plugin.settings, cachesToPopulate); // Ensure file caches are up-to-date
            console.log("[Cache Debug] Full Sync: Finished populateAllCaches. File cache sizes:", { p: caches.projectFileCache.size, s: caches.sectionFileCache.size, t: caches.taskFileCache.size });

        } else {
            console.log("[Cache Debug] Incremental Sync: Merging fetched data into API caches.");
            // Incremental Sync: Merge fetched changes first
            if (fetchedData.projects && fetchedData.projects.length > 0) {
                const oldProjectCount = caches.cachedProjects.length;
                caches.cachedProjects = mergeById(caches.cachedProjects, fetchedData.projects);
                console.log(`[Cache Debug] Incremental Sync: Merged ${fetchedData.projects.length} projects. Count: ${oldProjectCount} -> ${caches.cachedProjects.length}`);
            }
            if (fetchedData.sections && fetchedData.sections.length > 0) {
                const oldSectionCount = caches.cachedSections.length;
                caches.cachedSections = mergeById(caches.cachedSections, fetchedData.sections);
                 console.log(`[Cache Debug] Incremental Sync: Merged ${fetchedData.sections.length} sections. Count: ${oldSectionCount} -> ${caches.cachedSections.length}`);
            }
            // Determine tasks to process (new or updated ones from fetch)
            tasksToProcess = fetchedData.tasks || [];
            // Merge task changes into the main cache AFTER processing them individually
            if (tasksToProcess.length > 0) {
                 const oldTaskCount = caches.cachedTasks.length;
                 caches.cachedTasks = mergeById(caches.cachedTasks, tasksToProcess);
                 console.log(`[Cache Debug] Incremental Sync: Merged ${tasksToProcess.length} tasks. Count: ${oldTaskCount} -> ${caches.cachedTasks.length}`);
            }

            // --- Assign lookup arrays AFTER merging ---
            lookupProjectsApi = caches.cachedProjects;
            lookupSectionsApi = caches.cachedSections;
            console.log("[Cache Debug] Incremental Sync: Assigned lookup arrays from merged caches.");
            // --- End fix ---

            // If any data was fetched, it's no longer the initial load state
            if (tasksToProcess.length > 0 || (fetchedData.projects && fetchedData.projects.length > 0) || (fetchedData.sections && fetchedData.sections.length > 0)) {
                newIsInitialLoad = false;
            }
        }

        // --- Create lookup maps AFTER lookup arrays are finalized ---
        const projectMap = new Map(lookupProjectsApi.map(p => [p.id, p]));
        const sectionMap = new Map(lookupSectionsApi.map(s => [s.id, s]));
        console.log(`[Cache Debug] Created lookup maps. ProjectMap size: ${projectMap.size}, SectionMap size: ${sectionMap.size}`);
        // --- End fix ---

        // --- Ensure Folders Exist ---
        const baseFolderPath = normalizePath(plugin.settings.baseFolder);
        const archiveFolderPath = normalizePath(`${baseFolderPath}/${plugin.settings.archiveFolder}`);
        const trashFolderPath = normalizePath(`${baseFolderPath}/${plugin.settings.trashFolder}`);
        const doneFolderPath = normalizePath(`${baseFolderPath}/${plugin.settings.doneFolder}`);

        if (!vault.getAbstractFileByPath(baseFolderPath)) {
            await vault.createFolder(baseFolderPath);
        }
        // No need to pre-create Archive/Trash/Done, they are created on demand by move functions

        // --- Process Projects ---
        const projectsToIterate = isFullSync ? caches.cachedProjects : (fetchedData.projects || []);
        console.log(`[Obsidian Sync] Processing ${projectsToIterate.length} Projects...`);
        for (const project of projectsToIterate) {
            const projectIdStr = String(project.id);
            // Define expected paths (needed for active projects later)
            const sanitizedProjectName = sanitizeName(project.name); // Still needed if project is active
            const expectedProjectFolderPath = normalizePath(`${baseFolderPath}/${sanitizedProjectName}`);
            const expectedProjectFilePath = normalizePath(`${expectedProjectFolderPath}/${sanitizedProjectName}.md`);

            try {
                // --- Declare file/folder variables for this project iteration ---
                let file: TFile | TFolder | null = null;
                let itemFolder: TFolder | null = null;
                let fileToDelete: TFile | null = null;
                let folderToDelete: TFolder | null = null;
                let fileToArchive: TFile | null = null;
                let folderToArchive: TFolder | null = null;

                // --- Get cached path *before* the conditional blocks ---
                const cachedProjectPath = caches.projectFileCache.get(projectIdStr);
                // --- End declarations ---


                // --- Handle Deletion or Archiving FIRST ---
                if (project.is_deleted && (isFullSync || projectIdsInDelta.has(projectIdStr))) {
                    console.log(`[Obsidian Sync] Project ${projectIdStr} (${project.name || 'Name missing?'}) marked deleted.`);
                    console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Reading projectFileCache. Path: ${cachedProjectPath}`); // Use declared variable

                    if (cachedProjectPath) { // Use declared variable
                        const itemByCache = vault.getAbstractFileByPath(cachedProjectPath); // Use declared variable
                        if (itemByCache instanceof TFile) {
                            fileToDelete = itemByCache;
                            if (itemByCache.parent instanceof TFolder) folderToDelete = itemByCache.parent;
                            console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Found file via cache (${fileToDelete.path}), parent folder is ${folderToDelete?.path}`);
                        } else if (itemByCache instanceof TFolder) {
                            // Cache points directly to the project folder
                            folderToDelete = itemByCache;
                            console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Found folder directly via cache (${folderToDelete.path})`);
                            // --- Find index file inside ---
                            const potentialIndexPath = normalizePath(`${folderToDelete.path}/${folderToDelete.name}.md`);
                            const indexFile = vault.getAbstractFileByPath(potentialIndexPath);
                            if (indexFile instanceof TFile) {
                                fileToDelete = indexFile;
                                console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Found index file inside cached folder (${fileToDelete.path})`);
                            } else {
                                console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Index file not found at ${potentialIndexPath}`);
                            }
                            // --- End find index file ---
                        } else if (itemByCache) {
                             console.warn(`[Cache Debug] Project ${projectIdStr} (Delete Check): Cache path ${cachedProjectPath} exists but is neither TFile nor TFolder.`);
                        } else {
                             console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): Cache path ${cachedProjectPath} not found in vault.`);
                        }
                    } else {
                        console.log(`[Cache Debug] Project ${projectIdStr} (Delete Check): No path found in projectFileCache. Cannot reliably locate item to delete.`);
                    }

                    // --- Update frontmatter if file exists ---
                    if (fileToDelete) {
                        try {
                            console.log(`[Obsidian Sync] Updating frontmatter is_deleted=true for project file: ${fileToDelete.path}`);
                            await plugin.app.fileManager.processFrontMatter(fileToDelete, (fm) => {
                                fm.is_deleted = true;
                            });
                        } catch (fmError) {
                            console.error(`[Obsidian Sync] Error updating frontmatter for deleted project ${projectIdStr}:`, fmError);
                        }
                    }

                    // --- Move Folder (preferred) or File ---
                    if (folderToDelete || fileToDelete) {
                        console.log(`[Obsidian Sync] Attempting move for project ${projectIdStr}. Folder: ${folderToDelete?.path}, File: ${fileToDelete?.path}`);
                        // **** ADD THIS CALL ****
                        await handleMove(plugin.app, plugin.settings, folderToDelete, fileToDelete, trashFolderPath, 'project', true);
                        console.log(`[Cache Debug] Project ${projectIdStr}: Deleting from projectFileCache after move attempt (delete).`);
                        caches.projectFileCache.delete(projectIdStr); // **** ENSURE CACHE IS CLEARED ****
                    } else {
                        console.log(`[Obsidian Sync] Deleted project ${projectIdStr} not found locally via cache. Skipping move.`);
                        console.log(`[Cache Debug] Project ${projectIdStr}: Deleting from projectFileCache (not found locally - delete).`);
                        caches.projectFileCache.delete(projectIdStr); // **** ENSURE CACHE IS CLEARED ****
                    }
                    continue; // Skip further processing for deleted items
                } else if (project.is_archived && (isFullSync || projectIdsInDelta.has(projectIdStr))) {
                    // ... existing archive handling ...
                    // Ensure handleMove and cache deletion are also present here if needed for archiving
                    console.log(`[Obsidian Sync] Project ${projectIdStr} (${project.name || 'Name missing?'}) marked archived.`);
                    console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Reading projectFileCache. Path: ${cachedProjectPath}`); // Use declared variable

                    if (cachedProjectPath) { // Use declared variable
                       const itemByCache = vault.getAbstractFileByPath(cachedProjectPath); // Use declared variable
                        if (itemByCache instanceof TFile) {
                           fileToArchive = itemByCache;
                           if (itemByCache.parent instanceof TFolder) folderToArchive = itemByCache.parent;
                           console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Found file via cache (${fileToArchive.path}), parent folder is ${folderToArchive?.path}`);
                        } else if (itemByCache instanceof TFolder) {
                           folderToArchive = itemByCache;
                           console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Found folder directly via cache (${folderToArchive.path})`);
                           // --- Find index file inside ---
                           const potentialIndexPath = normalizePath(`${folderToArchive.path}/${folderToArchive.name}.md`);
                           const indexFile = vault.getAbstractFileByPath(potentialIndexPath);
                           if (indexFile instanceof TFile) {
                               fileToArchive = indexFile;
                               console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Found index file inside cached folder (${fileToArchive.path})`);
                           } else {
                               console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Index file not found at ${potentialIndexPath}`);
                           }
                           // --- End find index file ---
                        } else if (itemByCache) {
                            console.warn(`[Cache Debug] Project ${projectIdStr} (Archive Check): Cache path ${cachedProjectPath} exists but is neither TFile nor TFolder.`);
                        } else {
                            console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): Cache path ${cachedProjectPath} not found in vault.`);
                        }
                    } else {
                        console.log(`[Cache Debug] Project ${projectIdStr} (Archive Check): No path found in projectFileCache. Cannot reliably locate item to archive.`);
                    }

                    // --- Update frontmatter if file exists ---
                    if (fileToArchive) {
                        try {
                            console.log(`[Obsidian Sync] Updating frontmatter is_archived=true for project file: ${fileToArchive.path}`);
                            await plugin.app.fileManager.processFrontMatter(fileToArchive, (fm) => {
                                fm.is_archived = true;
                            });
                        } catch (fmError) {
                            console.error(`[Obsidian Sync] Error updating frontmatter for archived project ${projectIdStr}:`, fmError);
                        }
                    }

                    // --- Move Folder (preferred) or File ---
                    if (folderToArchive || fileToArchive) {
                        console.log(`[Obsidian Sync] Attempting move for project ${projectIdStr}. Folder: ${folderToArchive?.path}, File: ${fileToArchive?.path}`);
                        // **** ADD THIS CALL ****
                        await handleMove(plugin.app, plugin.settings, folderToArchive, fileToArchive, archiveFolderPath, 'project', true); // Use archiveFolderPath
                        console.log(`[Cache Debug] Project ${projectIdStr}: Deleting from projectFileCache after move attempt (archive).`);
                        caches.projectFileCache.delete(projectIdStr); // **** ENSURE CACHE IS CLEARED ****
                    } else {
                        console.log(`[Obsidian Sync] Archived project ${projectIdStr} not found locally via cache. Skipping move.`);
                        console.log(`[Cache Debug] Project ${projectIdStr}: Deleting from projectFileCache (not found locally - archive).`);
                        caches.projectFileCache.delete(projectIdStr); // **** ENSURE CACHE IS CLEARED ****
                    }
                    continue; // Skip further processing for archived items
                }
                // --- End Deletion/Archiving Handling ---


                // --- Process Active Projects (Create/Update/Rename) ---
                // Get folder reference first
                const abstractFolder = vault.getAbstractFileByPath(expectedProjectFolderPath); // Check expected path
                if (abstractFolder instanceof TFolder) { // Check type before assignment
                    itemFolder = abstractFolder;
                } else {
                    itemFolder = null; // Ensure it's null if not a TFolder
                }


                // Ensure project folder exists
                if (!itemFolder) { // Check the correctly typed itemFolder
                    // Check if the name is valid before creating
                    if (!sanitizedProjectName) {
                         console.error(`[Obsidian Sync] Project ${projectIdStr} has an invalid/empty name. Cannot create folder.`);
                         continue; // Skip this project if name is invalid
                    }
                    console.log(`[Obsidian Sync] Creating project folder: ${expectedProjectFolderPath}`);
                    await vault.createFolder(expectedProjectFolderPath);
                    const refetchedFolder = vault.getAbstractFileByPath(expectedProjectFolderPath); // Re-fetch after creation
                    if (refetchedFolder instanceof TFolder) { // Check type again
                         itemFolder = refetchedFolder;
                    }
                    // Check again after creation attempt
                    if (!itemFolder) {
                         console.error(`[Obsidian Sync] Failed to create or find project folder: ${expectedProjectFolderPath}`);
                         continue; // Skip if folder still doesn't exist
                    }
                }

                // Get file reference using cache or expected path *after* ensuring folder exists
                const currentCachedPath = caches.projectFileCache.get(projectIdStr); // Use the same cachedProjectPath variable? No, this is specific to active projects.
                let abstractFile = currentCachedPath ? vault.getAbstractFileByPath(currentCachedPath) : null;
                 if (!abstractFile) { // If cache miss or cache path invalid, check expected path
                    abstractFile = vault.getAbstractFileByPath(expectedProjectFilePath);
                }
                // Assign to 'file' only if it's TFile or TFolder
                if (abstractFile instanceof TFile || abstractFile instanceof TFolder) {
                    file = abstractFile;
                } else {
                    file = null;
                }


                // Now 'file' and 'itemFolder' should be correctly assigned for active projects
                if (file instanceof TFile) {
                    // Existing file found, check for rename/move and update
                    let fileToUpdate: TFile = file; // file is now correctly typed as TFile here
                    if (file.path !== expectedProjectFilePath) {
                        console.log(`[Obsidian Sync] Renaming project file ${file.path} to ${expectedProjectFilePath}`);
                        try {
                            // Ensure parent exists before rename (itemFolder should be valid here)
                            await plugin.app.fileManager.renameFile(file, expectedProjectFilePath);
                            const renamedFile = vault.getAbstractFileByPath(expectedProjectFilePath);
                            if (renamedFile instanceof TFile) {
                                fileToUpdate = renamedFile;
                            } else { throw new Error("Rename failed"); }
                        } catch (renameError) {
                             console.error(`[Obsidian Sync] Error renaming project file ${file.path}:`, renameError);
                             throw renameError; // Re-throw or handle as needed
                        }
                    }
                    console.log(`[Cache Debug] Project ${projectIdStr}: Calling updateObsidianProjectFile for ${fileToUpdate.path}`);
                    await updateObsidianProjectFile(plugin.app, fileToUpdate, project);
                    console.log(`[Cache Debug] Project ${projectIdStr}: Setting projectFileCache path to ${fileToUpdate.path}`);
                    caches.projectFileCache.set(projectIdStr, fileToUpdate.path);

                } else if (file instanceof TFolder) { // Check if 'file' accidentally resolved to a folder
                    // Folder exists at the file path? Unlikely, but handle by creating index file.
                    console.warn(`[Obsidian Sync] Expected file but found folder for project ${projectIdStr} at ${file.path}. Creating index file inside.`);
                    const newFile = await vault.create(expectedProjectFilePath, `---\n---\n`);
                    console.log(`[Cache Debug] Project ${projectIdStr}: Calling updateObsidianProjectFile for new index file ${newFile.path}`);
                    await updateObsidianProjectFile(plugin.app, newFile, project);
                    console.log(`[Cache Debug] Project ${projectIdStr}: Setting projectFileCache path to ${newFile.path} (created index)`);
                    caches.projectFileCache.set(projectIdStr, newFile.path);

                } else { // file is null
                    // Create new project file
                     // Check if the name is valid before creating
                    if (!sanitizedProjectName) {
                         console.error(`[Obsidian Sync] Project ${projectIdStr} has an invalid/empty name. Cannot create index file.`);
                         continue; // Skip this project if name is invalid
                    }
                    console.log(`[Obsidian Sync] Creating new project file: ${expectedProjectFilePath}`);
                    const newFile = await vault.create(expectedProjectFilePath, `---\n---\n`);
                    console.log(`[Cache Debug] Project ${projectIdStr}: Calling updateObsidianProjectFile for new file ${newFile.path}`);
                    await updateObsidianProjectFile(plugin.app, newFile, project);
                    console.log(`[Cache Debug] Project ${projectIdStr}: Setting projectFileCache path to ${newFile.path} (created new)`);
                    caches.projectFileCache.set(projectIdStr, newFile.path);
                }

            } catch (error) {
                console.error(`[Obsidian Sync] Error processing project ${projectIdStr} (${project.name}):`, error);
                syncErrorOccurred = true;
            }
        }

        // --- Process Sections ---
        const sectionsToIterate = isFullSync ? caches.cachedSections : (fetchedData.sections || []);
        console.log(`[Obsidian Sync] Processing ${sectionsToIterate.length} Sections...`);
        for (const section of sectionsToIterate) {
            const sectionIdStr = String(section.id);

            try {
                // --- STEP 1: Check for Deletion or Archiving FIRST ---
                if (section.is_deleted && (isFullSync || sectionIdsInDelta.has(sectionIdStr))) {
                    console.log(`[Obsidian Sync] Section ${sectionIdStr} (${section.name}) marked deleted.`);

                    // --- Find potential local representations using the CACHE first ---
                    const cachedSectionPath = caches.sectionFileCache.get(sectionIdStr);
                    console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Reading sectionFileCache. Path: ${cachedSectionPath}`);

                    let folderToDelete: TFolder | null = null;
                    let fileToDelete: TFile | null = null;

                    if (cachedSectionPath) {
                        const itemByCache = vault.getAbstractFileByPath(cachedSectionPath);
                        if (itemByCache instanceof TFile) {
                            // Cache points to the index file, parent is the section folder
                            fileToDelete = itemByCache;
                            if (itemByCache.parent instanceof TFolder) { // Ensure parent is a folder
                                folderToDelete = itemByCache.parent;
                                console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Found file via cache (${fileToDelete.path}), parent folder is ${folderToDelete.path}`);
                            } else {
                                 console.warn(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Found file via cache (${fileToDelete.path}), but parent is not a folder?`);
                            }
                        } else if (itemByCache instanceof TFolder) {
                            // Cache points directly to the section folder
                            folderToDelete = itemByCache;
                            console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Found folder directly via cache (${folderToDelete.path})`);
                            // --- Find index file inside ---
                            const potentialIndexPath = normalizePath(`${folderToDelete.path}/${folderToDelete.name}.md`);
                            const indexFile = vault.getAbstractFileByPath(potentialIndexPath);
                            if (indexFile instanceof TFile) {
                                fileToDelete = indexFile;
                                console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Found index file inside cached folder (${fileToDelete.path})`);
                            } else {
                                console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Index file not found at ${potentialIndexPath}`);
                            }
                            // --- End find index file ---
                        } else if (itemByCache) {
                             console.warn(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Cache path ${cachedSectionPath} exists but is neither TFile nor TFolder.`);
                        } else {
                             console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): Cache path ${cachedSectionPath} not found in vault.`);
                        }
                    } else {
                        console.log(`[Cache Debug] Section ${sectionIdStr} (Delete Check): No path found in sectionFileCache. Cannot reliably locate item to delete.`);
                        // Attempting to find via expected path is unreliable without original project ID.
                        // We will proceed to cache cleanup but likely won't move anything.
                    }

                    // --- Update frontmatter if file exists ---
                    if (fileToDelete) {
                        try {
                            console.log(`[Obsidian Sync] Updating frontmatter is_deleted=true for section file: ${fileToDelete.path}`);
                            await plugin.app.fileManager.processFrontMatter(fileToDelete, (fm) => {
                                fm.is_deleted = true;
                            });
                        } catch (fmError) {
                            console.error(`[Obsidian Sync] Error updating frontmatter for deleted section ${sectionIdStr}:`, fmError);
                        }
                    }

                    // --- Move Folder (preferred) or File ---
                    if (folderToDelete || fileToDelete) {
                        console.log(`[Obsidian Sync] Attempting move for section ${sectionIdStr}. Folder: ${folderToDelete?.path}, File: ${fileToDelete?.path}`);
                        await handleMove(plugin.app, plugin.settings, folderToDelete, fileToDelete, trashFolderPath, 'section', true);
                        console.log(`[Cache Debug] Section ${sectionIdStr}: Deleting from sectionFileCache after move attempt (delete).`);
                        caches.sectionFileCache.delete(sectionIdStr);
                    } else {
                        console.log(`[Obsidian Sync] Deleted section ${sectionIdStr} not found locally via cache. Skipping move.`);
                        console.log(`[Cache Debug] Section ${sectionIdStr}: Deleting from sectionFileCache (not found locally - delete).`);
                        caches.sectionFileCache.delete(sectionIdStr); // Ensure removed if somehow present
                    }
                    continue; // Skip further processing for this deleted section

                } else if (section.is_archived && (isFullSync || sectionIdsInDelta.has(sectionIdStr))) {
                    // --- Similar logic for archiving, using cache first ---
                    console.log(`[Obsidian Sync] Section ${sectionIdStr} (${section.name}) marked archived.`);
                    const cachedSectionPath = caches.sectionFileCache.get(sectionIdStr);
                    console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Reading sectionFileCache. Path: ${cachedSectionPath}`);

                    let folderToArchive: TFolder | null = null;
                    let fileToArchive: TFile | null = null;

                    if (cachedSectionPath) {
                        const itemByCache = vault.getAbstractFileByPath(cachedSectionPath);
                        if (itemByCache instanceof TFile) {
                            fileToArchive = itemByCache;
                            if (itemByCache.parent instanceof TFolder) {
                                folderToArchive = itemByCache.parent;
                            }
                        } else if (itemByCache instanceof TFolder) {
                            folderToArchive = itemByCache;
                             console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Found folder directly via cache (${folderToArchive.path})`);
                            // --- Find index file inside ---
                            const potentialIndexPath = normalizePath(`${folderToArchive.path}/${folderToArchive.name}.md`);
                            const indexFile = vault.getAbstractFileByPath(potentialIndexPath);
                            if (indexFile instanceof TFile) {
                                fileToArchive = indexFile;
                                console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Found index file inside cached folder (${fileToArchive.path})`);
                            } else {
                                console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Index file not found at ${potentialIndexPath}`);
                            }
                            // --- End find index file ---
                        } else if (itemByCache) {
                             console.warn(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Cache path ${cachedSectionPath} exists but is neither TFile nor TFolder.`);
                        } else {
                             console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): Cache path ${cachedSectionPath} not found in vault.`);
                        }
                    } else {
                         console.log(`[Cache Debug] Section ${sectionIdStr} (Archive Check): No path found in sectionFileCache. Cannot reliably locate item to archive.`);
                    }

                    // Update frontmatter
                    if (fileToArchive) {
                         try {
                            console.log(`[Obsidian Sync] Updating frontmatter is_archived=true for section file: ${fileToArchive.path}`);
                            await plugin.app.fileManager.processFrontMatter(fileToArchive, (fm) => {
                                fm.is_archived = true;
                            });
                        } catch (fmError) {
                            console.error(`[Obsidian Sync] Error updating frontmatter for archived section ${sectionIdStr}:`, fmError);
                        }
                    }

                    // Move Folder (preferred) or File
                    if (folderToArchive || fileToArchive) {
                         console.log(`[Obsidian Sync] Attempting move for section ${sectionIdStr}. Folder: ${folderToArchive?.path}, File: ${fileToArchive?.path}`);
                        await handleMove(plugin.app, plugin.settings, folderToArchive, fileToArchive, archiveFolderPath, 'section', true);
                        console.log(`[Cache Debug] Section ${sectionIdStr}: Deleting from sectionFileCache after move attempt (archive).`);
                        caches.sectionFileCache.delete(sectionIdStr);
                    } else {
                        console.log(`[Obsidian Sync] Archived section ${sectionIdStr} not found locally via cache. Skipping move.`);
                        console.log(`[Cache Debug] Section ${sectionIdStr}: Deleting from sectionFileCache (not found locally - archive).`);
                        caches.sectionFileCache.delete(sectionIdStr); // Ensure removed
                    }
                    continue; // Skip further processing
                }
                // --- End Deletion/Archiving Handling ---

                // --- STEP 2: Process Active Sections - Find Parent Project ---
                console.log(`[Cache Debug] Section ${sectionIdStr}: Reading projectMap to find parent ${section.project_id}`);
                const parentProject = projectMap.get(String(section.project_id)); // Use project_id ONLY for active sections

                // Skip if parent project doesn't exist or is deleted/archived
                if (!parentProject || parentProject.is_deleted || parentProject.is_archived) {
                    console.log(`[Obsidian Sync] Skipping active section ${sectionIdStr} (${section.name}) because parent project ${section.project_id} is missing, deleted, or archived in cache.`);
                    // Ensure section is removed from cache if its parent is gone (shouldn't happen if delete check is first, but good safety)
                    if (caches.sectionFileCache.has(sectionIdStr)) {
                         console.log(`[Cache Debug] Section ${sectionIdStr}: Removing from sectionFileCache because parent project is invalid.`);
                         caches.sectionFileCache.delete(sectionIdStr);
                    }
                    continue;
                }

                // --- STEP 3: Calculate Paths and Get Local References for Active Section ---
                const sanitizedProjectName = sanitizeName(parentProject.name);
                const sanitizedSectionName = sanitizeName(section.name);
                const expectedSectionFolderPath = normalizePath(`${baseFolderPath}/${sanitizedProjectName}/${sanitizedSectionName}`);
                const expectedSectionFilePath = normalizePath(`${expectedSectionFolderPath}/${sanitizedSectionName}.md`);

                const cachedSectionPath = caches.sectionFileCache.get(sectionIdStr);
                console.log(`[Cache Debug] Section ${sectionIdStr} (Active): Reading sectionFileCache. Path: ${cachedSectionPath}`);
                let file = cachedSectionPath ? vault.getAbstractFileByPath(cachedSectionPath) : null;
                if (!file) {
                    file = vault.getAbstractFileByPath(expectedSectionFilePath); // Check expected path if cache miss
                }
                let itemFolder = vault.getAbstractFileByPath(expectedSectionFolderPath); // Check expected folder path

                // --- STEP 4: Ensure Folders Exist for Active Section ---
                const parentProjectFolder = vault.getAbstractFileByPath(normalizePath(`${baseFolderPath}/${sanitizedProjectName}`));
                 if (!(parentProjectFolder instanceof TFolder)) {
                     console.warn(`[Obsidian Sync] Parent project folder for active section ${sectionIdStr} not found at ${normalizePath(`${baseFolderPath}/${sanitizedProjectName}`)}. Skipping section.`);
                     continue; // Should not happen if project loop ran correctly
                }
                 if (!(itemFolder instanceof TFolder)) {
                    console.log(`[Obsidian Sync] Creating section folder: ${expectedSectionFolderPath}`);
                    await vault.createFolder(expectedSectionFolderPath);
                    itemFolder = vault.getAbstractFileByPath(expectedSectionFolderPath); // Re-fetch after creation
                }

                // --- STEP 5: Create/Update/Rename Active Section File ---
                // Re-fetch file reference based on cache/expected path *after* potential folder creation
                const currentCachedPath = caches.sectionFileCache.get(sectionIdStr);
                file = currentCachedPath ? vault.getAbstractFileByPath(currentCachedPath) : null;
                 if (!file) {
                    file = vault.getAbstractFileByPath(expectedSectionFilePath);
                }

                if (file instanceof TFile) {
                    // Existing file found, check for rename/move and update
                    let fileToUpdate: TFile = file;
                    if (file.path !== expectedSectionFilePath) {
                        console.log(`[Obsidian Sync] Renaming/moving section file ${file.path} to ${expectedSectionFilePath}`);
                         try {
                            await plugin.app.fileManager.renameFile(file, expectedSectionFilePath);
                            const renamedFile = vault.getAbstractFileByPath(expectedSectionFilePath);
                            if (renamedFile instanceof TFile) { fileToUpdate = renamedFile; }
                            else { throw new Error("Rename failed"); }
                        } catch (renameError) { /* ... error handling ... */ throw renameError; }
                    }
                    console.log(`[Cache Debug] Section ${sectionIdStr}: Calling updateObsidianSectionFile for ${fileToUpdate.path}`);
                    await updateObsidianSectionFile(plugin.app, fileToUpdate, section, parentProject);
                    console.log(`[Cache Debug] Section ${sectionIdStr}: Setting sectionFileCache path to ${fileToUpdate.path}`);
                    caches.sectionFileCache.set(sectionIdStr, fileToUpdate.path);

                } else if (file instanceof TFolder) {
                    // Folder exists at the file path? Create index file.
                     console.warn(`[Obsidian Sync] Expected file but found folder for section ${sectionIdStr} at ${file.path}. Creating index file inside.`);
                     const newFile = await vault.create(expectedSectionFilePath, `---\n---\n`);
                     console.log(`[Cache Debug] Section ${sectionIdStr}: Calling updateObsidianSectionFile for new index file ${newFile.path}`);
                     await updateObsidianSectionFile(plugin.app, newFile, section, parentProject);
                     console.log(`[Cache Debug] Section ${sectionIdStr}: Setting sectionFileCache path to ${newFile.path} (created index)`);
                     caches.sectionFileCache.set(sectionIdStr, newFile.path);

                } else { // file is null
                    // Create new section file
                    console.log(`[Obsidian Sync] Creating new section file: ${expectedSectionFilePath}`);
                    const newFile = await vault.create(expectedSectionFilePath, `---\n---\n`);
                    console.log(`[Cache Debug] Section ${sectionIdStr}: Calling updateObsidianSectionFile for new file ${newFile.path}`);
                    await updateObsidianSectionFile(plugin.app, newFile, section, parentProject);
                    console.log(`[Cache Debug] Section ${sectionIdStr}: Setting sectionFileCache path to ${newFile.path} (created new)`);
                    caches.sectionFileCache.set(sectionIdStr, newFile.path);
                }

            } catch (error) {
                console.error(`[Obsidian Sync] Error processing section ${sectionIdStr} (${section.name}):`, error);
                syncErrorOccurred = true;
            }
        }

        // --- Process Tasks ---
        console.log(`[Obsidian Sync] Processing ${tasksToProcess.length} Tasks from fetched data...`);
        if (tasksToProcess.length > 0) {
            const taskProcessingPromises = tasksToProcess.map(async (task) => {
                const taskIdStr = String(task.id);
                // Use the map lookup for efficiency
                const parentProject = projectMap.get(String(task.project_id)); // Use String() just in case
                const parentSection = task.section_id ? sectionMap.get(String(task.section_id)) : null; // Use String() just in case

                // --- Add Detailed Logging Here ---
                if (!parentProject) {
                    console.warn(`[Cache Debug] Task ${taskIdStr}: Parent project ${task.project_id} NOT FOUND in projectMap (size: ${projectMap.size}).`);
                    // Log first few project IDs from the map for comparison
                    const sampleProjectIds = Array.from(projectMap.keys()).slice(0, 5);
                    console.warn(`[Cache Debug] Task ${taskIdStr}: Sample project IDs in map: [${sampleProjectIds.join(', ')}]`);
                } else if (parentProject.is_deleted) {
                    console.warn(`[Cache Debug] Task ${taskIdStr}: Parent project ${task.project_id} FOUND but marked as DELETED.`);
                } else if (parentProject.is_archived) {
                    console.warn(`[Cache Debug] Task ${taskIdStr}: Parent project ${task.project_id} FOUND but marked as ARCHIVED.`);
                } else {
                    // Optional: Log success case if needed for debugging
                    // console.log(`[Cache Debug] Task ${taskIdStr}: Parent project ${task.project_id} FOUND and active.`);
                }
                // --- End Detailed Logging ---


                // Determine parent folder path
                let parentFolderPath = baseFolderPath; // Default to base if no project
                // This is the original condition causing the warning
                if (parentProject && !parentProject.is_deleted && !parentProject.is_archived) {
                    const sanitizedProjectName = sanitizeName(parentProject.name);
                    parentFolderPath = normalizePath(`${baseFolderPath}/${sanitizedProjectName}`);
                    if (parentSection && !parentSection.is_deleted && !parentSection.is_archived) {
                        const sanitizedSectionName = sanitizeName(parentSection.name);
                        parentFolderPath = normalizePath(`${parentFolderPath}/${sanitizedSectionName}`);
                    }
                } else {
                     // This log is the one you are seeing
                     console.warn(`[Obsidian Sync] Task ${taskIdStr} (${task.content.substring(0,20)}...) belongs to missing/deleted/archived project ${task.project_id}. Placing in base folder.`);
                     // Keep parentFolderPath as baseFolderPath
                }

                const sanitizedTaskName = sanitizeName(task.content);
                const taskFilePath = normalizePath(`${parentFolderPath}/${sanitizedTaskName}.md`);

                try {
                    const cachedTaskPath = caches.taskFileCache.get(taskIdStr);
                    console.log(`[Cache Debug] Task ${taskIdStr}: Reading taskFileCache. Path: ${cachedTaskPath}`);
                    let taskFile = cachedTaskPath ? vault.getAbstractFileByPath(cachedTaskPath) : null;

                    // Handle Deletion first
                    if (task.is_deleted) {
                        console.log(`[Obsidian Sync] Task ${taskIdStr} (${task.content.substring(0,20)}...) marked deleted.`);
                        if (taskFile instanceof TFile) {
                            try {
                                await plugin.app.fileManager.processFrontMatter(taskFile, (fm) => { fm.is_deleted = true; });
                                await moveFileToCustomLocation(plugin.app, taskFile, trashFolderPath, 'deleted task file');
                                console.log(`[Cache Debug] Task ${taskIdStr}: Deleting from taskFileCache after move (delete).`);
                                caches.taskFileCache.delete(taskIdStr); // Remove from cache after move
                            } catch (deleteProcessError) {
                                console.error(`[Obsidian Sync] Error processing deletion for task ${taskIdStr}:`, deleteProcessError);
                            }
                        } else {
                            console.log(`[Obsidian Sync] Deleted task ${taskIdStr} not found locally.`);
                            console.log(`[Cache Debug] Task ${taskIdStr}: Deleting from taskFileCache (not found locally - delete).`);
                            caches.taskFileCache.delete(taskIdStr); // Ensure removed from cache
                        }
                        return; // Skip further processing
                    }

                    // Handle Completion
                    if (task.completed_at) {
                        console.log(`[Obsidian Sync] Task ${taskIdStr} (${task.content.substring(0,20)}...) marked completed.`);
                        if (taskFile instanceof TFile) {
                            console.log(`[Cache Debug] Task ${taskIdStr}: Calling updateObsidianTask for completed task ${taskFile.path}`);
                            await updateObsidianTask(plugin.app, taskFile, task, caches.taskFileCache); // Pass cache for parent link lookup
                            await moveFileToCustomLocation(plugin.app, taskFile, doneFolderPath, 'completed task file');
                            console.log(`[Cache Debug] Task ${taskIdStr}: Deleting from taskFileCache after move (complete).`);
                            caches.taskFileCache.delete(taskIdStr); // Remove from cache after move
                        } else {
                             console.log(`[Obsidian Sync] Completed task ${taskIdStr} not found locally. Cannot move to Done.`);
                             console.log(`[Cache Debug] Task ${taskIdStr}: Deleting from taskFileCache (not found locally - complete).`);
                             caches.taskFileCache.delete(taskIdStr); // Ensure removed from cache if it existed somehow
                        }
                        return; // Skip further processing
                    }

                    // Handle Active Tasks (Create/Update/Move)
                    const expectedPath = taskFilePath;
                    // Get file reference using cache or expected path
                    const currentCachedPath = caches.taskFileCache.get(taskIdStr);
                    console.log(`[Cache Debug] Task ${taskIdStr}: Re-reading taskFileCache before update/create. Path: ${currentCachedPath}`);
                    let taskAbstractFile = currentCachedPath
                        ? vault.getAbstractFileByPath(currentCachedPath)
                        : vault.getAbstractFileByPath(expectedPath); // Check expected path too

                    if (taskAbstractFile instanceof TFile) {
                        let fileToUpdate: TFile = taskAbstractFile;

                        // Check for rename/move
                        if (taskAbstractFile.path !== expectedPath) {
                            console.log(`[Obsidian Sync] Renaming/moving task file ${taskAbstractFile.path} to ${expectedPath}`);
                            try {
                                const parentDir = expectedPath.substring(0, expectedPath.lastIndexOf('/'));
                                if (!vault.getAbstractFileByPath(parentDir)) {
                                    console.log(`[Obsidian Sync] Creating parent folder for task move: ${parentDir}`);
                                    await vault.createFolder(parentDir);
                                }
                                await plugin.app.fileManager.renameFile(taskAbstractFile, expectedPath);
                                const renamedFile = vault.getAbstractFileByPath(expectedPath);
                                if (renamedFile instanceof TFile) {
                                    fileToUpdate = renamedFile;
                                } else {
                                    console.error(`[Obsidian Sync] Failed to get renamed task file as TFile: ${expectedPath}`);
                                    throw new Error("Rename failed to produce TFile");
                                }
                            } catch (renameError) {
                                console.error(`[Obsidian Sync] Error during task file rename/move: ${renameError}`);
                                throw renameError;
                            }
                        }
                        // Update existing task
                        console.log(`[Cache Debug] Task ${taskIdStr}: Calling updateObsidianTask for existing task ${fileToUpdate.path}`);
                        await updateObsidianTask(plugin.app, fileToUpdate, task, caches.taskFileCache); // Pass cache for parent link lookup
                        console.log(`[Cache Debug] Task ${taskIdStr}: Setting taskFileCache path to ${fileToUpdate.path}`);
                        caches.taskFileCache.set(taskIdStr, fileToUpdate.path); // Update cache path

                    } else { // file is null or TFolder (TFolder shouldn't happen for tasks)
                        if (taskAbstractFile instanceof TFolder) {
                             console.warn(`[Obsidian Sync] Found folder instead of file for task ${taskIdStr} at ${taskAbstractFile.path}. Overwriting? Creating file.`);
                        }
                        // Create new task file
                        console.log(`[Obsidian Sync] Creating new task file: ${expectedPath}`);
                        const parentFolder = vault.getAbstractFileByPath(parentFolderPath);
                        if (!(parentFolder instanceof TFolder)) {
                            console.log(`[Obsidian Sync] Creating parent folder for new task: ${parentFolderPath}`);
                            await vault.createFolder(parentFolderPath);
                        }
                        const newFile = await vault.create(expectedPath, `---\n---\n`);
                        console.log(`[Cache Debug] Task ${taskIdStr}: Calling updateObsidianTask for new task ${newFile.path}`);
                        await updateObsidianTask(plugin.app, newFile, task, caches.taskFileCache); // Pass cache for parent link lookup
                        console.log(`[Cache Debug] Task ${taskIdStr}: Setting taskFileCache path to ${newFile.path} (created new)`);
                        caches.taskFileCache.set(taskIdStr, newFile.path); // Add to cache
                    }

                } catch (error) {
                    console.error(`[Obsidian Sync] Error processing task ${taskIdStr} (${task.content.substring(0,20)}...):`, error);
                    syncErrorOccurred = true;
                }
            });
            await Promise.allSettled(taskProcessingPromises);
        }
        // --- End Task Processing ---


        // --- Handle Deletions (Full Sync Only) ---
        if (isFullSync) {
            console.log("[Obsidian Sync] Starting cleanup phase for full sync...");
            console.log("[Cache Debug] Cleanup: Reading API caches for fetched IDs.");
            const fetchedProjectIds = new Set(caches.cachedProjects.map(p => String(p.id)));
            const fetchedSectionIds = new Set(caches.cachedSections.map(s => String(s.id)));
            const fetchedTaskIds = new Set(caches.cachedTasks.map(t => String(t.id))); // Use updated cache

            const cleanupPromises: Promise<void>[] = [];
            const cachesForCleanup = { // Prepare caches object for trashOrArchiveFileById
                projectFileCache: caches.projectFileCache,
                sectionFileCache: caches.sectionFileCache,
                taskFileCache: caches.taskFileCache
            };
            console.log("[Cache Debug] Cleanup: Prepared caches object for trashOrArchiveFileById.");

            // Check projects in cache against fetched projects
            console.log(`[Cache Debug] Cleanup: Iterating projectFileCache (size: ${caches.projectFileCache.size})`);
            for (const [projectId, filePath] of caches.projectFileCache.entries()) {
                if (!fetchedProjectIds.has(projectId)) {
                    console.log(`[Obsidian Sync] Project ${projectId} found in cache but not in full sync data. Queuing for cleanup.`);
                    console.log(`[Cache Debug] Cleanup: Calling trashOrArchiveFileById for project ${projectId} (${filePath})`);
                    cleanupPromises.push(trashOrArchiveFileById(plugin.app, plugin.settings, cachesForCleanup, projectId, 'project', filePath));
                }
            }
            // Check sections in cache against fetched sections
            console.log(`[Cache Debug] Cleanup: Iterating sectionFileCache (size: ${caches.sectionFileCache.size})`);
            for (const [sectionId, filePath] of caches.sectionFileCache.entries()) {
                 if (!fetchedSectionIds.has(sectionId)) {
                    console.log(`[Obsidian Sync] Section ${sectionId} found in cache but not in full sync data. Queuing for cleanup.`);
                    console.log(`[Cache Debug] Cleanup: Calling trashOrArchiveFileById for section ${sectionId} (${filePath})`);
                    cleanupPromises.push(trashOrArchiveFileById(plugin.app, plugin.settings, cachesForCleanup, sectionId, 'section', filePath));
                }
            }
            // Check tasks in cache against fetched tasks
            const taskIdsToCheck = Array.from(caches.taskFileCache.keys());
            console.log(`[Cache Debug] Cleanup: Iterating taskFileCache (size: ${taskIdsToCheck.length})`);
            for (const taskId of taskIdsToCheck) {
                const filePath = caches.taskFileCache.get(taskId);
                console.log(`[Cache Debug] Cleanup: Checking task ${taskId}. Path: ${filePath}. Exists in fetched: ${fetchedTaskIds.has(taskId)}`);
                // Check if the ID exists in the cache map *again* because trashOrArchiveFileById might remove it
                if (filePath && caches.taskFileCache.has(taskId) && !fetchedTaskIds.has(taskId)) {
                    console.log(`[Obsidian Sync] Task ${taskId} found in cache but not in full sync data. Queuing for cleanup.`);
                    console.log(`[Cache Debug] Cleanup: Calling trashOrArchiveFileById for task ${taskId} (${filePath})`);
                    cleanupPromises.push(trashOrArchiveFileById(plugin.app, plugin.settings, cachesForCleanup, taskId, 'task', filePath));
                }
            }

            await Promise.allSettled(cleanupPromises);
            console.log("[Obsidian Sync] Cleanup phase finished.");
            console.log("[Cache Debug] Cleanup: Final file cache sizes:", { p: caches.projectFileCache.size, s: caches.sectionFileCache.size, t: caches.taskFileCache.size });
        }
        // --- End Deletion Handling ---


        console.log(`[Obsidian Sync] ${syncType} sync finished.`);
        if (!syncErrorOccurred) { // Only show success notice if no errors occurred during processing
             new Notice(`Todoist ${syncType} sync finished.`);
        }

    } catch (mainSyncError) {
        console.error(`[Obsidian Sync] Uncaught error during ${syncType} sync:`, mainSyncError);
        new Notice(`Todoist ${syncType} sync failed. Check console.`);
        syncErrorOccurred = true; // Set error flag
    } finally {
        // Update Status Bar - End
        if (syncErrorOccurred) {
            plugin.updateStatusBar('Todoist Sync: Error', 'error'); // Use public method
        } else {
            const now = new Date();
            plugin.updateStatusBar(`Todoist Synced: ${now.toLocaleTimeString()}`, 'idle'); // Use public method
        }
        console.log("[Cache Debug] Exiting syncOrFullSyncTasks. Final caches:", JSON.stringify({
            projectFileCacheSize: caches.projectFileCache.size,
            sectionFileCacheSize: caches.sectionFileCache.size,
            taskFileCacheSize: caches.taskFileCache.size,
            cachedProjectsCount: caches.cachedProjects.length,
            cachedSectionsCount: caches.cachedSections.length,
            cachedTasksCount: caches.cachedTasks.length,
            newIsInitialLoad
        }, null, 2));
    }

    // Always return the state object, even if errors occurred during processing
    // newIsInitialLoad and caches will reflect the state at the end of the attempt
    return { newIsInitialLoad, updatedCaches: caches };

} // End syncOrFullSyncTasks