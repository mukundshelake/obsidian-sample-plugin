import { Plugin, TFile, Notice, normalizePath, TAbstractFile, TFolder, App, PluginSettingTab, Setting } from "obsidian"; // Import App, PluginSettingTab, Setting
// Import interfaces and functions from todoist.ts
import { fetchTodoistData, Project, Section, Item, getSyncTokenFilePath } from "src/todoist"; // Add imports
import * as path from "path";
// Remove fs import if not used elsewhere in main.ts
// import * as fs from 'fs';

// Helper function to merge updates into a cache based on ID
function mergeById<T extends { id: string }>(cache: T[], delta: T[] | undefined): T[] {
    // ... (implementation remains the same)
    if (!delta || delta.length === 0) return cache;
    const cacheMap = new Map(cache.map(item => [item.id, item]));
    delta.forEach(item => { cacheMap.set(item.id, item); });
    console.log(`[Cache] Merged ${delta.length} items. New cache size: ${cacheMap.size}`);
    return Array.from(cacheMap.values());
}

interface TodoistSyncSettings {
    apiKey: string;
    baseFolder: string;
    archiveFolder: string; // For items archived in Todoist
    trashFolder: string;   // For items deleted in Todoist
    doneFolder: string;    // For items completed in Todoist
}

const DEFAULT_SETTINGS: TodoistSyncSettings = {
    apiKey: '', // Default to empty
    baseFolder: 'Todoist',
    archiveFolder: 'Archive', // Relative to base folder
    trashFolder: 'Trash',      // Relative to base folder
    doneFolder: 'Done' // Add default for Done folder
}

export default class TodoistSyncPlugin extends Plugin {
    settings: TodoistSyncSettings; // Add settings property
    // Caches for API data
    private cachedProjects: Project[] = [];
    private cachedSections: Section[] = [];

    // Caches mapping Todoist ID to Obsidian File Path
    private projectFileCache: Map<string, string> = new Map();
    private sectionFileCache: Map<string, string> = new Map();
    private taskFileCache: Map<string, string> = new Map(); // Keep task cache

    private isInitialLoad: boolean = true;

    async onload() {
        console.log("[Todoist Plugin] Loading...");
        await this.loadSettings(); // Load settings first

        // Register settings tab
        this.addSettingTab(new TodoistSyncSettingTab(this.app, this));

        // Populate caches after loading settings (uses baseFolder setting)
        await this.populateAllCaches();

        this.addCommand({
            id: "sync-todoist-tasks",
            name: "Sync with Todoist",
            callback: () => this.syncOrFullSyncTasks(false),
        });

        this.addCommand({
            id: "full-sync-todoist-tasks",
            name: "Full Sync with Todoist",
            callback: () => this.syncOrFullSyncTasks(true),
        });

        this.isInitialLoad = true;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async populateAllCaches() {
        console.log("[Cache] Populating ID -> File Path caches...");
        this.projectFileCache.clear();
        this.sectionFileCache.clear();
        this.taskFileCache.clear();

        const files = this.app.vault.getMarkdownFiles();
        let projectCount = 0;
        let sectionCount = 0;
        let taskCount = 0;

        // Use settings for base folder path
        const baseFolderPrefix = `${this.settings.baseFolder}/`;

        for (const file of files) {
            // Only scan files within the configured base Todoist folder
            if (!file.path.startsWith(baseFolderPrefix)) {
                continue;
            }
            try {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                const todoistId = fm?.todoist_id;
                const type = fm?.type; // Get the type field

                if (todoistId && type) {
                    const idStr = String(todoistId);
                    let cache: Map<string, string> | null = null;
                    let counterIncrement: () => void = () => {};

                    switch (type) {
                        case 'project':
                            cache = this.projectFileCache;
                            counterIncrement = () => projectCount++;
                            break;
                        case 'section':
                            cache = this.sectionFileCache;
                            counterIncrement = () => sectionCount++;
                            break;
                        case 'task':
                            cache = this.taskFileCache;
                            counterIncrement = () => taskCount++;
                            break;
                        default:
                            // console.warn(`[Cache] Unknown type "${type}" in file ${file.path}`);
                            break; // Ignore files with unknown types
                    }

                    if (cache) {
                        if (cache.has(idStr)) {
                            console.warn(`[Cache] Duplicate Todoist ID ${idStr} (type: ${type}) found. File ${file.path} conflicts with ${cache.get(idStr)}. Keeping the first one found.`);
                        } else {
                            cache.set(idStr, file.path);
                            counterIncrement();
                        }
                    }
                }
            } catch (e) {
                console.error(`[Cache] Error processing frontmatter for file ${file.path}:`, e);
            }
        }
        console.log(`[Cache] Caches populated. Projects: ${projectCount}, Sections: ${sectionCount}, Tasks: ${taskCount}.`);
    }

    onunload() {
        console.log("[Todoist Plugin] Unloading...");
        // TODO: Consider saving caches to a file here
    }


    // Combined function for sync and full sync
    async syncOrFullSyncTasks(isFullSync: boolean) {
        // Check if API key is set
        if (!this.settings.apiKey) {
            new Notice("Todoist API Key not set. Please configure it in the plugin settings.");
            console.error("[Obsidian Sync] Aborting sync: API Key not set.");
            return;
        }

        const syncType = isFullSync ? 'full' : 'incremental';
        console.log(`[Obsidian Sync] Starting ${syncType} Todoist sync...`);
        new Notice(`Starting ${syncType} Todoist sync...`);

        const vault = this.app.vault;

        // --- Check if cache is needed and empty ---
        // Force full sync if any cache is empty on first load
        if (!isFullSync && this.isInitialLoad && (this.projectFileCache.size === 0 || this.sectionFileCache.size === 0 || this.taskFileCache.size === 0)) {
            console.warn("[Obsidian Sync] Incremental sync attempted without cached data. Performing initial full sync first.");
            new Notice("Performing initial full sync first...");
            isFullSync = true;
            await this.populateAllCaches(); // Ensure caches are populated
        }

        // --- Fetch Data ---
        let fetchedData;
        try {
            // Call fetchTodoistData directly, passing apiKey and app
            fetchedData = await fetchTodoistData(this.settings.apiKey, this.app, isFullSync);
        }
        catch (error) {
            console.error("[Obsidian Sync] Error fetching data:", error);
            new Notice("Error fetching data from Todoist. Check console.");
            return;
        }
        if (!fetchedData) {
             new Notice("Failed to fetch data from Todoist. Check API key and console.");
             return;
        }

        // --- Create Sets of IDs from fetched data for quick lookup (only for incremental) ---
        const projectIdsInDelta = new Set<string>();
        const sectionIdsInDelta = new Set<string>();
        if (!isFullSync) {
            fetchedData.projects?.forEach(p => projectIdsInDelta.add(p.id));
            fetchedData.sections?.forEach(s => sectionIdsInDelta.add(s.id));
            console.log(`[Obsidian Sync] Incremental delta includes ${projectIdsInDelta.size} projects and ${sectionIdsInDelta.size} sections.`);
        }

        // --- Determine Data for Lookups and Update API Data Cache ---
        // We still need the API data cache for incremental merges
        let lookupProjectsApi: Project[];
        let lookupSectionsApi: Section[];
        const tasksToProcess: Item[] = fetchedData.tasks;

        if (isFullSync) {
            lookupProjectsApi = fetchedData.projects;
            lookupSectionsApi = fetchedData.sections;
            this.cachedProjects = lookupProjectsApi; // Update API data cache
            this.cachedSections = lookupSectionsApi; // Update API data cache
            this.isInitialLoad = false;
            console.log(`[Cache] Full sync: Updated API data cache with ${this.cachedProjects.length} projects, ${this.cachedSections.length} sections.`);
            // Repopulate file caches after full sync for maximum accuracy
            await this.populateAllCaches();
        } else {
            // Use existing API data cache for lookups before merging
            lookupProjectsApi = this.cachedProjects;
            lookupSectionsApi = this.cachedSections;
            // Merge changes into the API data cache
            if (fetchedData.projects.length > 0) { this.cachedProjects = mergeById(this.cachedProjects, fetchedData.projects); }
            if (fetchedData.sections.length > 0) { this.cachedSections = mergeById(this.cachedSections, fetchedData.sections); }
            // Re-assign lookups to potentially updated API cache
            lookupProjectsApi = this.cachedProjects;
            lookupSectionsApi = this.cachedSections;
            console.log(`[Cache] Incremental sync: Using ${lookupProjectsApi.length} projects, ${lookupSectionsApi.length} sections from API data cache.`);
        }

        // --- Ensure Base, Trash, Archive, and Done Folders Exist ---
        const baseFolderPath = this.settings.baseFolder;
        const trashFolderPath = normalizePath(`${baseFolderPath}/${this.settings.trashFolder}`);
        const archiveFolderPath = normalizePath(`${baseFolderPath}/${this.settings.archiveFolder}`);
        const doneFolderPath = normalizePath(`${baseFolderPath}/${this.settings.doneFolder}`); // Define Done folder path
        try {
            // Ensure Base folder
            if (!vault.getAbstractFileByPath(baseFolderPath)) {
                await vault.createFolder(baseFolderPath);
                console.log(`[Obsidian Sync] Created base folder: ${baseFolderPath}`);
            }
            // Ensure Trash folder
            if (!vault.getAbstractFileByPath(trashFolderPath)) {
                await vault.createFolder(trashFolderPath);
                console.log(`[Obsidian Sync] Created custom trash folder: ${trashFolderPath}`);
            }
            // Ensure Archive folder
            if (!vault.getAbstractFileByPath(archiveFolderPath)) {
                await vault.createFolder(archiveFolderPath);
                console.log(`[Obsidian Sync] Created custom archive folder: ${archiveFolderPath}`);
            }
            // Ensure Done folder (Add this)
            if (!vault.getAbstractFileByPath(doneFolderPath)) {
                await vault.createFolder(doneFolderPath);
                console.log(`[Obsidian Sync] Created custom done folder: ${doneFolderPath}`);
            }
        } catch (error) {
            console.error("[Obsidian Sync] Error ensuring base/trash/archive/done folders exist:", error);
            new Notice("Error creating base/trash/archive/done folders. Sync aborted.");
            return;
        }
        // --- End Folder Existence Checks ---


        // --- Process Projects (Files and Folders) ---
        console.log("[Obsidian Sync] Processing Projects...");
        const finalProjectPaths = new Map<string, string>();
        // Use a copy for iteration if modifying the source cache during loop
        const projectsToIterate = [...lookupProjectsApi];
        for (const project of projectsToIterate) { // Iterate over a copy
            try {
                const projectIdStr = String(project.id);
                const existingFilePath = this.projectFileCache.get(projectIdStr);
                let file: TFile | null = null;
                let itemFolder: TFolder | null = null; // Use TFolder | null

                if (existingFilePath) {
                    const abstractFile = vault.getAbstractFileByPath(existingFilePath);
                    if (abstractFile instanceof TFile) {
                        file = abstractFile;
                        if (file.parent instanceof TFolder) { // Ensure parent is TFolder
                           itemFolder = file.parent;
                        }
                    } else {
                        console.warn(`[Cache] Project file not found at ${existingFilePath}. Cache inconsistent.`);
                        // Attempt to find folder by name if file is missing? Maybe too complex.
                    }
                }

                let handled = false; // Flag to indicate if deleted/archived

                // --- Handle Deleted Projects First ---
                // Only process delete/archive if full sync OR item is in the delta
                if (project.is_deleted && (isFullSync || projectIdsInDelta.has(projectIdStr))) {
                    console.log(`[Obsidian Sync] Project ${projectIdStr} marked as deleted by API.`);
                    // ... move folder/file to trash ...
                    await this.handleMove(itemFolder, file, trashFolderPath, 'project');
                    this.projectFileCache.delete(projectIdStr);
                    // Remove from API cache to prevent reprocessing
                    this.cachedProjects = this.cachedProjects.filter(p => p.id !== projectIdStr);
                    handled = true;
                }
                // --- Handle Archived Projects ---
                else if (project.is_archived && (isFullSync || projectIdsInDelta.has(projectIdStr))) {
                    console.log(`[Obsidian Sync] Project ${projectIdStr} marked as archived by API.`);
                    // ... move folder/file to archive ...
                    await this.handleMove(itemFolder, file, archiveFolderPath, 'project');
                    this.projectFileCache.delete(projectIdStr);
                    // Remove from API cache to prevent reprocessing
                    this.cachedProjects = this.cachedProjects.filter(p => p.id !== projectIdStr);
                    handled = true;
                }

                // If handled (deleted/archived), skip normal processing
                if (handled) {
                    finalProjectPaths.delete(projectIdStr); // Ensure it's not used by children
                    continue;
                }
                // --- End Handle Deleted/Archived Projects ---


                // --- Proceed with Normal Create/Update/Rename for non-deleted/archived projects ---
                const sanitizedName = project.name.toString().replace(/[<>:"/\\|?*]/g, '_');
                const expectedFolderPath = normalizePath(`${baseFolderPath}/${sanitizedName}`);
                const expectedFilePath = normalizePath(`${expectedFolderPath}/${sanitizedName}.md`); // Project file path

                let currentFolderPath = expectedFolderPath; // Assume expected path initially
                const folderAtExpectedPath = vault.getAbstractFileByPath(expectedFolderPath);
                const existingFolderPath = itemFolder?.path; // Use itemFolder

                // 2. Ensure Folder Exists / Handle Rename
                if (itemFolder && existingFolderPath && existingFolderPath !== expectedFolderPath) {
                    // Folder path needs changing
                    if (!folderAtExpectedPath) {
                        console.log(`[Obsidian Sync] Renaming project folder from ${existingFolderPath} to ${expectedFolderPath}`);
                        await this.app.fileManager.renameFile(itemFolder, expectedFolderPath); // Rename itemFolder
                        currentFolderPath = expectedFolderPath;
                    } else {
                        console.warn(`[Obsidian Sync] Cannot rename project folder ${existingFolderPath} to ${expectedFolderPath}, target exists. Using target.`);
                        currentFolderPath = expectedFolderPath; // Use existing target folder
                    }
                } else if (!(folderAtExpectedPath instanceof TFolder)) {
                    // Folder doesn't exist at expected path, and wasn't found via cache/rename logic
                    console.log(`[Obsidian Sync] Creating project folder ${currentFolderPath}`);
                    await vault.createFolder(currentFolderPath);
                }
                finalProjectPaths.set(projectIdStr, currentFolderPath); // Store the final folder path

                // 3. Process Project .md File (Conditional Update)
                if (file) { // Found via cache
                    // Check if file needs rename (due to folder rename or project name change)
                    if (file.path !== expectedFilePath) {
                        console.log(`[Obsidian Sync] Renaming project file from ${file.path} to ${expectedFilePath}`);
                        try {
                            // Ensure parent folder exists before renaming project file
                            const parentFolder = expectedFilePath.substring(0, expectedFilePath.lastIndexOf('/'));
                            if (!vault.getAbstractFileByPath(parentFolder)) {
                                await vault.createFolder(parentFolder);
                            }
                            await this.app.fileManager.renameFile(file, expectedFilePath);
                            this.projectFileCache.set(projectIdStr, expectedFilePath); // Update cache
                            file = vault.getAbstractFileByPath(expectedFilePath) as TFile; // Get new ref
                        } catch (renameError) {
                            console.error(`[Obsidian Sync] Failed to rename project file ${file.path}:`, renameError);
                            // Continue with update at old path? Or skip? Let's skip update if rename fails.
                            continue;
                        }
                    }
                    // Only update if it's a full sync OR this project was in the delta
                    if (isFullSync || projectIdsInDelta.has(projectIdStr)) {
                        await this.updateObsidianProjectFile(project, file);
                    } else {
                         // console.log(`[Obsidian Sync] Skipping file update for project ${projectIdStr} (not in delta)`);
                    }
                } else { // Create new file (always needs content)
                    console.log(`[Obsidian Sync] Creating project file: ${expectedFilePath}`);
                    try {
                        const newFile = await vault.create(expectedFilePath, "");
                        await this.updateObsidianProjectFile(project, newFile);
                        this.projectFileCache.set(projectIdStr, newFile.path); // Add to cache
                    } catch (createError) {
                        console.error(`[Obsidian Sync] Failed to create project file ${expectedFilePath}:`, createError);
                    }
                }

            } catch (error) {
                console.error(`[Obsidian Sync] Error processing project ${project.name} (ID: ${project.id}):`, error);
            }
        }
        // Update lookupProjectsApi if cache was modified (important for subsequent section processing)
        lookupProjectsApi = this.cachedProjects;


        // --- Process Sections (Files and Folders) ---
        console.log("[Obsidian Sync] Processing Sections...");
        const finalSectionPaths = new Map<string, string>();
        // Use a copy for iteration
        const sectionsToIterate = [...lookupSectionsApi];
        for (const section of sectionsToIterate) { // Iterate over a copy
             try {
                const sectionIdStr = String(section.id);
                const projectIdStr = String(section.project_id);
                const existingFilePath = this.sectionFileCache.get(sectionIdStr);
                let file: TFile | null = null;
                let itemFolder: TFolder | null = null; // Use TFolder | null

                if (existingFilePath) {
                    const abstractFile = vault.getAbstractFileByPath(existingFilePath);
                    if (abstractFile instanceof TFile) {
                        file = abstractFile;
                         if (file.parent instanceof TFolder) {
                           itemFolder = file.parent;
                        }
                    } else {
                        console.warn(`[Cache] Stale section cache: File not found at ${existingFilePath} for ID ${sectionIdStr}. Removing.`);
                        this.sectionFileCache.delete(sectionIdStr);
                    }
                }

                let handled = false; // Flag

                // --- Handle Deleted Sections First ---
                if (section.is_deleted && (isFullSync || sectionIdsInDelta.has(sectionIdStr))) {
                    console.log(`[Obsidian Sync] Section ${sectionIdStr} marked as deleted by API.`);
                    // ... move folder/file to trash ...
                    await this.handleMove(itemFolder, file, trashFolderPath, 'section', true); // Pass checkName=true
                    this.sectionFileCache.delete(sectionIdStr);
                    // Remove from API cache
                    this.cachedSections = this.cachedSections.filter(s => s.id !== sectionIdStr);
                    handled = true;
                }
                // --- Handle Archived Sections ---
                else if (section.is_archived && (isFullSync || sectionIdsInDelta.has(sectionIdStr))) {
                     console.log(`[Obsidian Sync] Section ${sectionIdStr} marked as archived by API.`);
                     // ... move folder/file to archive ...
                     await this.handleMove(itemFolder, file, archiveFolderPath, 'section', true); // Pass checkName=true
                     this.sectionFileCache.delete(sectionIdStr);
                     // Remove from API cache
                     this.cachedSections = this.cachedSections.filter(s => s.id !== sectionIdStr);
                     handled = true;
                }

                // If handled, skip normal processing
                if (handled) {
                    finalSectionPaths.delete(sectionIdStr); // Ensure not used by tasks
                    continue;
                }
                // --- End Handle Deleted/Archived Sections ---


                // --- Proceed with Normal Create/Update/Rename ---
                const parentProjectPath = finalProjectPaths.get(projectIdStr); // Get final path of parent project

                if (!parentProjectPath) {
                    console.warn(`[Obsidian Sync] Skipping section ${section.name} (ID: ${sectionIdStr}): Parent project folder path not found.`);
                    continue;
                }

                const sanitizedName = section.name.toString().replace(/[<>:"/\\|?*]/g, '_');
                const expectedFolderPath = normalizePath(`${parentProjectPath}/${sanitizedName}`);
                const expectedFilePath = normalizePath(`${expectedFolderPath}/${sanitizedName}.md`); // Section file path

                let currentFolderPath = expectedFolderPath;
                const folderAtExpectedPath = vault.getAbstractFileByPath(expectedFolderPath);
                const existingFolderPath = itemFolder?.path;

                // 2. Ensure Folder Exists / Handle Rename (Similar to projects)
                if (itemFolder && existingFolderPath && existingFolderPath !== expectedFolderPath) {
                    const folderAtOldPath = vault.getAbstractFileByPath(existingFolderPath);
                    if (folderAtOldPath instanceof TFolder) {
                        if (!folderAtExpectedPath) {
                            console.log(`[Obsidian Sync] Renaming section folder from ${existingFolderPath} to ${expectedFolderPath}`);
                            await this.app.fileManager.renameFile(itemFolder, expectedFolderPath);
                            currentFolderPath = expectedFolderPath;
                             // TODO: Update paths in task cache? Defer.
                        } else {
                            console.warn(`[Obsidian Sync] Cannot rename section folder ${existingFolderPath} to ${expectedFolderPath}, target exists. Using target.`);
                            currentFolderPath = expectedFolderPath;
                            // TODO: Merge/move files? Defer.
                        }
                    } else {
                         console.warn(`[Obsidian Sync] Old section folder ${existingFolderPath} not found for rename. Assuming ${expectedFolderPath}.`);
                         currentFolderPath = expectedFolderPath;
                         if (!(folderAtExpectedPath instanceof TFolder)) {
                             console.log(`[Obsidian Sync] Creating section folder ${currentFolderPath}`);
                             await vault.createFolder(currentFolderPath);
                         }
                    }
                } else if (!(folderAtExpectedPath instanceof TFolder)) {
                    console.log(`[Obsidian Sync] Creating section folder ${currentFolderPath}`);
                    await vault.createFolder(currentFolderPath);
                }
                finalSectionPaths.set(sectionIdStr, currentFolderPath); // Store final folder path

                // 3. Process Section .md File (Conditional Update)
                if (file) { // Found via cache
                    if (file.path !== expectedFilePath) {
                         console.log(`[Obsidian Sync] Renaming section file from ${file.path} to ${expectedFilePath}`);
                         try {
                             // Ensure parent folder exists before renaming section file
                             const parentFolder = expectedFilePath.substring(0, expectedFilePath.lastIndexOf('/'));
                             if (!vault.getAbstractFileByPath(parentFolder)) {
                                 await vault.createFolder(parentFolder);
                             }
                             await this.app.fileManager.renameFile(file, expectedFilePath);
                             this.sectionFileCache.set(sectionIdStr, expectedFilePath);
                             file = vault.getAbstractFileByPath(expectedFilePath) as TFile;
                         } catch (renameError) { /* ... error handling ... */ return; }
                    }
                    // Only update if it's a full sync OR this section was in the delta
                    if (isFullSync || sectionIdsInDelta.has(sectionIdStr)) {
                        await this.updateObsidianSectionFile(section, file);
                    } else {
                         // console.log(`[Obsidian Sync] Skipping file update for section ${sectionIdStr} (not in delta)`);
                    }
                } else { // Create new file (always needs content)
                    console.log(`[Obsidian Sync] Creating section file: ${expectedFilePath}`);
                    try {
                        const newFile = await vault.create(expectedFilePath, "");
                        await this.updateObsidianSectionFile(section, newFile);
                        this.sectionFileCache.set(sectionIdStr, newFile.path);
                    } catch (createError) { /* ... error handling ... */ }
                }

            } catch (error) {
                console.error(`[Obsidian Sync] Error processing section ${section.name} (ID: ${section.id}):`, error);
            }
        }
         // Update lookupSectionsApi if cache was modified
        lookupSectionsApi = this.cachedSections;


        // --- Process Tasks ---
        console.log("[Obsidian Sync] Processing Tasks...");
        if (!tasksToProcess || tasksToProcess.length === 0) { /* ... log no tasks ... */ }
        else {
            const taskProcessingPromises = tasksToProcess.map(async (task) => {
                try {
                    const taskIdStr = String(task.id);
                    const existingFilePath = this.taskFileCache.get(taskIdStr);
                    let taskFile: TFile | null = null;

                    // --- Handle Deleted Tasks First ---
                    if (task.is_deleted) {
                        console.log(`[Obsidian Sync] Task ${taskIdStr} marked as deleted by API.`);
                        if (existingFilePath) {
                            const file = this.app.vault.getAbstractFileByPath(existingFilePath);
                            if (file instanceof TFile) {
                                try {
                                    // 1. Update frontmatter to mark as deleted
                                    console.log(`[Obsidian Sync] Updating frontmatter for deleted task ${taskIdStr} before moving.`);
                                    await this.app.fileManager.processFrontMatter(file, (fm) => {
                                        fm['is_deleted'] = true; // Add/update the deleted flag
                                        // Optionally add a timestamp
                                        // fm['deleted_at'] = new Date().toISOString();
                                        // Ensure other fields are NOT overwritten by minimal task data
                                    });

                                    // 2. Move the updated file to Trash folder
                                    await this.moveFileToCustomLocation(file, trashFolderPath, 'deleted task file');

                                } catch (deleteProcessError) {
                                     console.error(`[Obsidian Sync] Error processing deletion (update/move) for task ${taskIdStr} at ${existingFilePath}:`, deleteProcessError);
                                     // Decide if we should still remove from cache even if move failed
                                }
                            } else {
                                console.warn(`[Obsidian Sync] File for deleted task ${taskIdStr} not found at cached path ${existingFilePath}.`);
                            }
                            // 3. Remove from cache after handling deletion attempt
                            this.taskFileCache.delete(taskIdStr);
                        } else {
                            console.log(`[Obsidian Sync] Deleted task ${taskIdStr} not found in cache. No file action needed.`);
                        }
                        return; // Stop processing this task further
                    }
                    // --- End Handle Deleted Tasks ---

                    // --- Find Existing File (needed for both completed and active tasks) ---
                    if (existingFilePath) {
                        const file = vault.getAbstractFileByPath(existingFilePath);
                        if (file instanceof TFile) {
                            taskFile = file;
                        } else {
                            console.warn(`[Cache] Stale task cache: File not found at ${existingFilePath} for ID ${taskIdStr}. Removing.`);
                            this.taskFileCache.delete(taskIdStr);
                            // taskFile remains null
                        }
                    }

                    // --- Handle Completed Tasks ---
                    if (task.completed_at) {
                        console.log(`[Obsidian Sync] Task ${taskIdStr} marked as completed by API.`);
                        if (taskFile) { // Check if we found the file
                            console.log(`[Obsidian Sync] Updating frontmatter for completed task ${taskIdStr} before moving.`);
                            // 1. Update frontmatter first
                            await this.updateObsidianTask(task, taskFile);

                            console.log(`[Obsidian Sync] Moving completed task ${taskIdStr} to Done folder.`);
                            // 2. Move the updated file to Done folder
                            await this.moveFileToCustomLocation(taskFile, doneFolderPath, 'completed task file');

                            // 3. Remove from cache after successful update and move attempt
                            this.taskFileCache.delete(taskIdStr);

                        } else {
                            console.log(`[Obsidian Sync] Completed task ${taskIdStr} has no corresponding file in vault/cache. No file action needed.`);
                            // Remove from cache if it somehow existed but file didn't
                            if (existingFilePath) this.taskFileCache.delete(taskIdStr);
                        }
                        return; // Stop processing this task further (don't attempt regular update/rename)
                    }
                    // --- End Handle Completed Tasks ---


                    // --- Proceed with Normal Create/Update/Rename for non-deleted, non-completed tasks ---

                    // 2. Calculate expected path (moved this down, only needed for active tasks)
                    const sanitizedContent = (task.content || `Untitled Task ${taskIdStr}`).replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
                    let parentFolderPath: string | undefined;
                    if (task.section_id) {
                        parentFolderPath = finalSectionPaths.get(String(task.section_id));
                    }
                    if (!parentFolderPath && task.project_id) {
                        parentFolderPath = finalProjectPaths.get(String(task.project_id));
                    }
                    // Fallback to base folder if no parent project/section path found (should be rare)
                    if (!parentFolderPath) {
                        console.warn(`[Obsidian Sync] Task ${taskIdStr} has no parent project/section path. Using base folder.`);
                        parentFolderPath = baseFolderPath;
                    }
                    const expectedFilePath = normalizePath(`${parentFolderPath}/${sanitizedContent}.md`);


                    // 3. Process Task .md File (Rename/Update/Create) - Only if NOT completed
                    if (taskFile) { // Found via cache and not completed
                        if (taskFile.path !== expectedFilePath) {
                            console.log(`[Obsidian Sync] Renaming task file from ${taskFile.path} to ${expectedFilePath}`);
                            try {
                                // Ensure parent folder exists before renaming task file
                                const parentFolder = expectedFilePath.substring(0, expectedFilePath.lastIndexOf('/'));
                                if (!vault.getAbstractFileByPath(parentFolder)) {
                                    await vault.createFolder(parentFolder);
                                }
                                await this.app.fileManager.renameFile(taskFile, expectedFilePath);
                                this.taskFileCache.set(taskIdStr, expectedFilePath); // Update cache
                                taskFile = vault.getAbstractFileByPath(expectedFilePath) as TFile; // Get new ref
                            } catch (renameError) {
                                console.error(`[Obsidian Sync] Failed to rename task file ${taskFile.path}:`, renameError);
                                return; // Skip update if rename fails
                            }
                        }
                        // Update existing file (only if not completed/deleted)
                        await this.updateObsidianTask(task, taskFile);

                    } else { // Create new task file (only if not completed/deleted)
                        console.log(`[Obsidian Sync] Creating task file: ${expectedFilePath}`);
                        try {
                            // Ensure parent folder exists before creating task file
                            const parentFolder = expectedFilePath.substring(0, expectedFilePath.lastIndexOf('/'));
                            if (!vault.getAbstractFileByPath(parentFolder)) {
                                await vault.createFolder(parentFolder);
                            }
                            const newFile = await vault.create(expectedFilePath, "");
                            await this.updateObsidianTask(task, newFile);
                            this.taskFileCache.set(taskIdStr, newFile.path); // Add to cache
                        } catch (createError) {
                            console.error(`[Obsidian Sync] Failed to create task file ${expectedFilePath}:`, createError);
                        }
                    }

                } catch (taskError) {
                    console.error(`[Obsidian Sync] Error processing task ID ${task.id}:`, taskError);
                }
            });
            await Promise.allSettled(taskProcessingPromises);
        }
        // --- End Task Processing ---


        // --- Handle Deletions (Full Sync Only - Keep for robustness) ---
        // This can remain as a fallback for items missed by incremental deletion markers
        if (isFullSync) {
            console.log("[Obsidian Sync] Performing full sync cleanup (checking for items missed by incremental deletes)...");
            const fetchedProjectIds = new Set(lookupProjectsApi.map(p => p.id));
            const fetchedSectionIds = new Set(lookupSectionsApi.map(s => s.id));
            const fetchedTaskIds = new Set(tasksToProcess.map(t => t.id));

            // Clean up projects (Trashing is likely appropriate here)
            for (const [projectId, filePath] of this.projectFileCache.entries()) {
                if (!fetchedProjectIds.has(projectId)) {
                    console.log(`[Obsidian Sync] Project ID ${projectId} not found in full sync data. Trashing file and potentially folder: ${filePath}`);
                    // Use a modified trash function or handle folder deletion carefully
                    await this.trashOrArchiveFileById(projectId, 'project', filePath);
                }
            }

            // Clean up sections (Trashing is likely appropriate here)
            for (const [sectionId, filePath] of this.sectionFileCache.entries()) {
                if (!fetchedSectionIds.has(sectionId)) {
                    console.log(`[Obsidian Sync] Section ID ${sectionId} not found in full sync data. Trashing file and potentially folder: ${filePath}`);
                    await this.trashOrArchiveFileById(sectionId, 'section', filePath);
                }
            }

            // Clean up tasks (Distinguish between completed and deleted)
            for (const [taskId, filePath] of this.taskFileCache.entries()) {
                // Check if task still exists in cache (might have been removed by is_deleted handler)
                if (this.taskFileCache.has(taskId) && !fetchedTaskIds.has(taskId)) {
                    console.log(`[Obsidian Sync] Task ID ${taskId} not found in full sync data. Checking completion status for file: ${filePath}`);
                    await this.trashOrArchiveFileById(taskId, 'task', filePath); // This handles completion check
                }
            }
            console.log("[Obsidian Sync] Deletion/Completion cleanup finished.");
        }
        // --- End Deletion Handling ---


        console.log(`[Obsidian Sync] Todoist ${syncType} sync processing completed.`);
        new Notice(`Todoist ${syncType} sync finished.`);
    }

    // Renamed and modified helper function for full sync cleanup
    async trashOrArchiveFileById(id: string, type: 'project' | 'section' | 'task', filePath: string) {
        let shouldTrash = true; // Default to trashing items missing from full sync
        let targetMovePath: string | null = null; // Renamed from targetPathForArchive

        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);

            if (file instanceof TFile) {
                // --- Check completion status for tasks during full sync cleanup ---
                // This acts as a fallback if the incremental move failed
                if (type === 'task') {
                    const metadata = this.app.metadataCache.getFileCache(file);
                    if (metadata?.frontmatter?.completed === true) {
                        shouldTrash = false; // Don't trash completed tasks found during cleanup
                        console.log(`[Obsidian Sync] Task ${id} (cleanup) is completed. Moving to Done folder.`);

                        // Define Done path using settings
                        const doneFolder = normalizePath(`${this.settings.baseFolder}/${this.settings.doneFolder}`);
                        try {
                            // Ensure Done folder exists (redundant check, but safe)
                            if (!this.app.vault.getAbstractFileByPath(doneFolder)) {
                                await this.app.vault.createFolder(doneFolder);
                            }
                            // Calculate target path in Done folder
                            targetMovePath = normalizePath(`${doneFolder}/${file.name}`); // Use existing name

                            // Handle potential name conflicts in Done folder
                            let conflictIndex = 0;
                            let uniqueDonePath = targetMovePath;
                            while (this.app.vault.getAbstractFileByPath(uniqueDonePath)) {
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
                    console.log(`[Obsidian Sync] Trashing ${type} file: ${filePath}`);
                    await this.app.vault.trash(file, false); // Move to Obsidian trash

                    // Optional: Attempt to trash parent folder for projects/sections if empty
                    const parentFolder = file.parent;
                    if (parentFolder && parentFolder.path !== this.settings.baseFolder && (type === 'project' || type === 'section')) {
                        const sanitizedNameFromFile = file.basename; // Use basename (name without extension)
                        if (parentFolder.name === sanitizedNameFromFile) {
                            // Check children *after* potential file trash
                            // Need a slight delay or re-check? Let's assume trash is fast enough for now.
                             if (parentFolder.children.length === 1 && parentFolder.children[0] === file) { // Check if only this file was in it
                                 console.log(`[Obsidian Sync] Attempting to trash empty parent folder after trashing file: ${parentFolder.path}`);
                                 await this.app.vault.trash(parentFolder, false);
                             }
                        }
                    }
                } else if (targetMovePath) {
                    // Move to Done folder (previously Archive)
                    console.log(`[Obsidian Sync] Moving completed task file ${filePath} (cleanup) to Done: ${targetMovePath}`);
                    await this.app.fileManager.renameFile(file, targetMovePath);
                }

            } else if (file instanceof TFolder && (type === 'project' || type === 'section')) {
                 // Handle case where cache points to a folder (should be rare) - Trash if empty
                 console.warn(`[Obsidian Sync] Cache pointed directly to folder ${filePath} for ${type} ID ${id}. Attempting to trash if empty.`);
                 if (file.children.length === 0) {
                    await this.app.vault.trash(file, false);
                 } else {
                    console.warn(`[Obsidian Sync] Folder ${filePath} is not empty, not trashing.`);
                 }
            } else {
                console.warn(`[Obsidian Sync] File/Folder not found at path ${filePath} during cleanup for ${type} ID ${id}.`);
            }
        } catch (error) {
            console.error(`[Obsidian Sync] Error during cleanup for ${type} with ID ${id} at path ${filePath}:`, error);
        } finally {
            // Always remove from cache
            switch (type) {
                case 'project': this.projectFileCache.delete(id); break;
                case 'section': this.sectionFileCache.delete(id); break;
                case 'task': this.taskFileCache.delete(id); break;
            }
        }
    }

    // Helper to update Project .md file frontmatter
    async updateObsidianProjectFile(project: Project, file: TFile) {
        console.log(`[Obsidian Sync] Updating frontmatter for project file ${file.path}`);
        const frontmatter = {
            type: 'project', // Add type field
            todoist_id: project.id,
            name: project.name, // Store name for reference
            // Add other project fields if needed (e.g., color, view_style from API)
        };
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                Object.assign(fm, frontmatter);
                // Clean up null/undefined if necessary
            });
        } catch (error) {
            console.error(`[Obsidian Sync] Error processing frontmatter for project file ${file.path}:`, error);
        }
    }

    // Helper to update Section .md file frontmatter
    async updateObsidianSectionFile(section: Section, file: TFile) {
        console.log(`[Obsidian Sync] Updating frontmatter for section file ${file.path}`);
        const frontmatter = {
            type: 'section', // Add type field
            todoist_id: section.id,
            project_id: section.project_id, // Store parent project ID
            name: section.name, // Store name for reference
            // Add other section fields if needed (e.g., order from API)
        };
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                Object.assign(fm, frontmatter);
                // Clean up null/undefined if necessary
            });
        } catch (error) {
            console.error(`[Obsidian Sync] Error processing frontmatter for section file ${file.path}:`, error);
        }
    }

    async updateObsidianTask(task: Item, file: TFile) {
        console.log(`[Obsidian Sync] Updating frontmatter for task file ${file.path}`);

        // --- Find parent task link ---
        let parentLink: string | null = null;
        if (task.parent_id) {
            const parentFilePath = this.taskFileCache.get(String(task.parent_id));
            if (parentFilePath) {
                const parentFile = this.app.vault.getAbstractFileByPath(parentFilePath);
                if (parentFile instanceof TFile) {
                    // Create Obsidian link [[filename]] without the .md extension
                    parentLink = `[[${parentFile.basename}]]`;
                    console.log(`[Obsidian Sync] Found parent task ${task.parent_id} at ${parentFilePath}, creating link: ${parentLink}`);
                } else {
                    console.warn(`[Obsidian Sync] Parent task file for ${task.id} (parent ID: ${task.parent_id}) not found at cached path ${parentFilePath}, although cache entry exists.`);
                }
            } else {
                console.log(`[Obsidian Sync] Parent task ${task.parent_id} for task ${task.id} not found in file cache. Parent might be synced later or is inaccessible.`);
                // Parent might not be synced yet, or might be deleted/archived itself.
                // We could potentially store the ID here and try to resolve the link later,
                // but for simplicity, we'll just leave it null for now.
            }
        }
        // --- End Find parent task link ---

        // --- Convert Labels to Tags ---
        let obsidianTags: string[] = [];
        if (task.labels && task.labels.length > 0) {
            obsidianTags = task.labels.map(label => {
                // Basic sanitization: replace spaces with hyphens, remove special chars, prepend #
                // You might want more robust sanitization depending on your label naming conventions
                const sanitizedLabel = label
                    .toLowerCase()
                    .replace(/\s+/g, '-') // Replace spaces with hyphens
                    .replace(/[^a-z0-9-]/g, ''); // Remove non-alphanumeric characters except hyphens
                return `#${sanitizedLabel}`; // Prepend #
            }).filter(tag => tag !== '#'); // Filter out empty tags if sanitization resulted in just '#'
            console.log(`[Obsidian Sync] Converted labels ${JSON.stringify(task.labels)} to tags ${JSON.stringify(obsidianTags)}`);
        }
        // --- End Convert Labels to Tags ---

        const frontmatter = {
            type: 'task',
            todoist_id: task.id,
            project_id: task.project_id,
            section_id: task.section_id || null,
            due_date: task.due ? task.due.date : null,
            priority: task.priority,
            completed: !!task.completed_at,
            completed_at: task.completed_at || null,
            // labels: task.labels || [], // Keep original labels? Or replace with tags? Let's use tags.
            tags: obsidianTags, // Add the converted tags here
            added_at: task.added_at,
            parent_id: task.parent_id || null,
            parent_link: parentLink,
            url: task.url,
            description: task.description || "",
        };

        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                Object.assign(fm, frontmatter);
                // Clean up null/undefined, except for specific keys
                for (const key in frontmatter) {
                    const typedKey = key as keyof typeof frontmatter;
                    if (frontmatter[typedKey] === null || frontmatter[typedKey] === undefined) {
                        if (['completed_at', 'section_id', 'parent_id', 'parent_link', 'due_date'].includes(key)) {
                             fm[key] = null;
                        } else {
                             delete fm[key];
                        }
                    }
                    if (key === 'description' && frontmatter.description === "") {
                         fm[key] = "";
                    }
                }
                // Ensure boolean 'completed' is present
                if (!fm.completed) fm.completed = false;
                // Ensure tags array is present, even if empty
                if (!fm.tags) fm.tags = [];
                // Remove the old 'labels' field if it exists from previous versions
                delete fm.labels;
            });
        } catch (error) {
            console.error(`[Obsidian Sync] Error updating frontmatter for ${file.path}:`, error);
            new Notice(`Error updating frontmatter for ${file.basename}`);
        }
    }

    // Helper function to move a FOLDER to a custom location (Trash or Archive)
    async moveFolderToCustomLocation(folderToMove: TFolder, targetParentPath: string, itemTypeDescription: string) {
        let targetPath = normalizePath(`${targetParentPath}/${folderToMove.name}`);
        let conflictIndex = 0;
        // Handle potential name conflicts for the folder itself
        while (this.app.vault.getAbstractFileByPath(targetPath)) {
            conflictIndex++;
            targetPath = normalizePath(`${targetParentPath}/${folderToMove.name}_${conflictIndex}`);
        }
        console.log(`[Obsidian Sync] Moving ${itemTypeDescription} ${folderToMove.path} to ${targetPath}`);
        try {
            await this.app.fileManager.renameFile(folderToMove, targetPath);
        } catch (moveError) {
            console.error(`[Obsidian Sync] Failed to move ${itemTypeDescription} ${folderToMove.path} to ${targetPath}:`, moveError);
            // Fallback? Maybe try Obsidian trash?
            // console.log(`[Obsidian Sync] Fallback: Trashing ${itemTypeDescription} ${folderToMove.path}`);
            // await this.app.vault.trash(folderToMove, false);
        }
    }

    // Helper function to move a single FILE to custom location (Trash or Archive)
    async moveFileToCustomLocation(fileToMove: TFile, targetParentPath: string, itemTypeDescription: string) {
        let targetPath = normalizePath(`${targetParentPath}/${fileToMove.name}`);
        let conflictIndex = 0;
        // Handle potential name conflicts for the file
        while (this.app.vault.getAbstractFileByPath(targetPath)) {
            conflictIndex++;
            const nameWithoutExt = fileToMove.basename;
            targetPath = normalizePath(`${targetParentPath}/${nameWithoutExt}_${conflictIndex}.${fileToMove.extension}`);
        }
        console.log(`[Obsidian Sync] Moving ${itemTypeDescription} ${fileToMove.path} to ${targetPath}`);
        try {
            await this.app.fileManager.renameFile(fileToMove, targetPath);
        } catch (moveError) {
            console.error(`[Obsidian Sync] Failed to move ${itemTypeDescription} ${fileToMove.path} to ${targetPath}:`, moveError);
            // Fallback? Maybe try Obsidian trash?
            // console.log(`[Obsidian Sync] Fallback: Trashing ${itemTypeDescription} ${fileToMove.path}`);
            // await this.app.vault.trash(fileToMove, false);
        }
    }

    // Helper function to move a single file to custom trash (used as fallback)
    async moveFileToCustomTrash(file: TFile, trashFolderPath: string, type: string) {
        let targetTrashPath = normalizePath(`${trashFolderPath}/${file.name}`);
        let conflictIndex = 0;
        while (this.app.vault.getAbstractFileByPath(targetTrashPath)) {
            conflictIndex++;
            const nameWithoutExt = file.basename;
            targetTrashPath = normalizePath(`${trashFolderPath}/${nameWithoutExt}_${conflictIndex}.${file.extension}`);
        }
        console.log(`[Obsidian Sync] Moving deleted ${type} file ${file.path} to custom trash: ${targetTrashPath}`);
        try {
            await this.app.fileManager.renameFile(file, targetTrashPath);
        } catch (moveError) {
            console.error(`[Obsidian Sync] Failed to move deleted ${type} file ${file.path} to custom trash:`, moveError);
            // Optionally, try Obsidian trash as final fallback?
            // await this.app.vault.trash(file, false);
        }
    }

    // Consolidated helper for moving folder or file
    async handleMove(itemFolder: TFolder | null, itemFile: TFile | null, targetParentPath: string, itemType: string, checkFolderNameMatchesFile: boolean = false) {
        if (itemFolder && itemFolder.path !== this.settings.baseFolder) {
            // For sections, optionally check if folder name matches file base name before moving folder
            if (!checkFolderNameMatchesFile || (itemFile && itemFolder.name === itemFile.basename)) {
                await this.moveFolderToCustomLocation(itemFolder, targetParentPath, `${itemType} folder`);
                return; // Folder moved, includes file
            }
        }
        // Fallback: If folder wasn't moved (or didn't exist), move just the file
        if (itemFile) {
            await this.moveFileToCustomLocation(itemFile, targetParentPath, `${itemType} file`);
        } else {
            console.log(`[Obsidian Sync] Cannot move ${itemType}: Neither folder nor file found in vault.`);
        }
    }
} // End of class TodoistSyncPlugin

// --- Settings Tab Class ---
class TodoistSyncSettingTab extends PluginSettingTab {
    plugin: TodoistSyncPlugin;

    constructor(app: App, plugin: TodoistSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Todoist Sync Settings' });

        new Setting(containerEl)
            .setName('Todoist API Key')
            .setDesc('Enter your Todoist API key')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Base Folder')
            .setDesc('Base folder for Todoist items')
            .addText(text => text
                .setPlaceholder('Enter base folder')
                .setValue(this.plugin.settings.baseFolder)
                .onChange(async (value) => {
                    this.plugin.settings.baseFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Archive Folder Name')
            .setDesc('Folder name (inside Base Folder) for items archived in Todoist.')
            .addText(text => text
                .setPlaceholder('e.g., Archive')
                .setValue(this.plugin.settings.archiveFolder)
                .onChange(async (value) => {
                    this.plugin.settings.archiveFolder = value || DEFAULT_SETTINGS.archiveFolder;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Trash Folder Name')
            .setDesc('Folder name (inside Base Folder) for items deleted in Todoist.')
            .addText(text => text
                .setPlaceholder('e.g., Trash')
                .setValue(this.plugin.settings.trashFolder)
                .onChange(async (value) => {
                    this.plugin.settings.trashFolder = value || DEFAULT_SETTINGS.trashFolder;
                    await this.plugin.saveSettings();
                }));

        // Done Folder Setting... (Add this)
        new Setting(containerEl)
            .setName('Done Folder Name')
            .setDesc('Folder name (inside Base Folder) for tasks completed in Todoist.')
            .addText(text => text
                .setPlaceholder('e.g., Done')
                .setValue(this.plugin.settings.doneFolder)
                .onChange(async (value) => {
                    this.plugin.settings.doneFolder = value || DEFAULT_SETTINGS.doneFolder;
                    await this.plugin.saveSettings();
                }));
    }
}
