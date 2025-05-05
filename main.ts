import { Plugin, TFile, Notice, normalizePath, TAbstractFile, TFolder, App, PluginSettingTab, Setting, Vault, CachedMetadata } from "obsidian"; // Add MetadataCache, Vault
// Import the new function and command interface
import { fetchTodoistData, postTodoistCommands, Project, Section, Item, getSyncTokenFilePath, TodoistCommand, ItemCompleteArgs } from "src/todoist";
import * as path from "path";
import { DEFAULT_SETTINGS } from "./src/constants"; // <-- Add this import
import { TodoistSyncSettings } from "./src/types";
import { generateUUID, mergeById } from "./src/utils";
import { TodoistSyncSettingTab } from "./src/settingsTab";
import { moveFileToCustomLocation, handleMove, trashOrArchiveFileById } from "./src/obsidian/fileManager";
// Import cache manager functions
import { populateAllCaches, findTodoistIdByPath } from "./src/obsidian/cacheManager";
// Import frontmatter update functions
import { updateObsidianProjectFile, updateObsidianSectionFile, updateObsidianTask } from "./src/obsidian/frontmatter";
// Import sync engine function and type
import { syncOrFullSyncTasks, SyncCaches } from "./src/sync/syncEngine"; // <-- Add SyncCaches here
import { CommandManager } from "./src/sync/commandManager"; // <-- Import CommandManager
import { handleMetadataChange } from "./src/sync/eventHandlers"; // <-- Import event handler

export default class TodoistSyncPlugin extends Plugin {
    settings: TodoistSyncSettings;
    // Keep caches private
    public projectFileCache: Map<string, string> = new Map(); // Made public for CommandManager access (consider alternatives later)
    public sectionFileCache: Map<string, string> = new Map(); // Made public for CommandManager access
    public taskFileCache: Map<string, string> = new Map();    // Made public for CommandManager access
    public cachedProjects: Project[] = []; // Made public for CommandManager access
    public cachedSections: Section[] = []; // Made public for CommandManager access
    public cachedTasks: Item[] = [];       // Made public for CommandManager access
    public isInitialLoad: boolean = true;
    // Status bar element remains private
    private statusBarItemEl: HTMLElement | null = null;
    // Command Manager instance
    public commandManager: CommandManager; // <-- Add instance variable
    // Syncing flag (make public for event handler access)
    public isSyncing: boolean = false; // <-- Add this flag

    async onload() {
        console.log("[Todoist Plugin] Loading...");
        await this.loadSettings();

        // Instantiate CommandManager
        this.commandManager = new CommandManager(this); // <-- Instantiate here

        // Register settings tab
        this.addSettingTab(new TodoistSyncSettingTab(this.app, this));

        // Add Status Bar Item - this returns HTMLElement
        this.statusBarItemEl = this.addStatusBarItem();
        this.updateStatusBar('Todoist Sync: Ready', 'idle'); // Initial state

        // --- Add Commands ---
        this.addCommand({
            id: "sync-todoist-tasks",
            name: "Sync with Todoist",
            callback: async () => {
                if (this.isSyncing) {
                    new Notice("Sync already in progress.");
                    return;
                }
                this.isSyncing = true;
                try {
                    const currentCaches: SyncCaches = { // Pass current state
                        projectFileCache: this.projectFileCache,
                        sectionFileCache: this.sectionFileCache,
                        taskFileCache: this.taskFileCache,
                        cachedProjects: this.cachedProjects,
                        cachedSections: this.cachedSections,
                        cachedTasks: this.cachedTasks
                    };
                    const result = await syncOrFullSyncTasks(this, false, this.isInitialLoad, currentCaches);

                    // --- Update plugin state with results ---
                    this.isInitialLoad = result.newIsInitialLoad;
                    this.projectFileCache = result.updatedCaches.projectFileCache;
                    this.sectionFileCache = result.updatedCaches.sectionFileCache;
                    this.taskFileCache = result.updatedCaches.taskFileCache;
                    this.cachedProjects = result.updatedCaches.cachedProjects;
                    this.cachedSections = result.updatedCaches.cachedSections;
                    this.cachedTasks = result.updatedCaches.cachedTasks;
                    console.log("[Cache Debug] main.ts: Updated plugin caches after incremental sync.");
                    // --- End update ---

                } catch (error) {
                    console.error("[Obsidian Sync Command] Error during incremental sync:", error);
                    new Notice("Sync failed. Check console.");
                } finally {
                    this.isSyncing = false;
                }
            },
        });

        this.addCommand({
            id: "full-sync-todoist-tasks",
            name: "Full Sync with Todoist",
             callback: async () => {
                 if (this.isSyncing) {
                    new Notice("Sync already in progress.");
                    return;
                }
                this.isSyncing = true;
                try {
                     const currentCaches: SyncCaches = { // Pass current state
                        projectFileCache: this.projectFileCache,
                        sectionFileCache: this.sectionFileCache,
                        taskFileCache: this.taskFileCache,
                        cachedProjects: this.cachedProjects,
                        cachedSections: this.cachedSections,
                        cachedTasks: this.cachedTasks
                    };
                    const result = await syncOrFullSyncTasks(this, true, this.isInitialLoad, currentCaches);

                    // --- Update plugin state with results ---
                    this.isInitialLoad = result.newIsInitialLoad;
                    this.projectFileCache = result.updatedCaches.projectFileCache;
                    this.sectionFileCache = result.updatedCaches.sectionFileCache;
                    this.taskFileCache = result.updatedCaches.taskFileCache;
                    this.cachedProjects = result.updatedCaches.cachedProjects;
                    this.cachedSections = result.updatedCaches.cachedSections;
                    this.cachedTasks = result.updatedCaches.cachedTasks;
                    console.log("[Cache Debug] main.ts: Updated plugin caches after full sync.");
                    // --- End update ---

                } catch (error) {
                    console.error("[Obsidian Sync Command] Error during full sync:", error);
                    new Notice("Full sync failed. Check console.");
                } finally {
                    this.isSyncing = false;
                }
            },
        });

        // --- Register Metadata Cache Change Listener ---
        this.registerEvent(
            // Use the imported CachedMetadata type directly
            this.app.metadataCache.on('changed', (file: TFile, data: string, cache: CachedMetadata) =>
                // Call the imported handler function, passing the plugin instance ('this')
                handleMetadataChange(this, file, data, cache)
            )
        );

        // --- Register Vault Change Listeners (for future use, e.g., delete/rename) ---
        // this.registerEvent(this.app.vault.on('delete', this.handleVaultDelete.bind(this)));
        // this.registerEvent(this.app.vault.on('rename', this.handleVaultRename.bind(this)));

        // --- Initial Cache Population on Load ---
        // Populate file caches on startup if they are empty
        if (this.projectFileCache.size === 0 || this.sectionFileCache.size === 0 || this.taskFileCache.size === 0) {
             console.log("[Cache Debug] main.ts: Initial file caches empty, populating on load...");
             const cachesToPopulate = {
                 projectFileCache: this.projectFileCache,
                 sectionFileCache: this.sectionFileCache,
                 taskFileCache: this.taskFileCache
             };
             await populateAllCaches(this.app, this.settings, cachesToPopulate);
             console.log("[Cache Debug] main.ts: Finished initial cache population.");
        } else {
             console.log("[Cache Debug] main.ts: Initial file caches already populated.");
        }
        // Note: API data caches (cachedProjects etc.) are populated by the first sync.

        console.log("[Todoist Plugin] Loaded successfully.");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // Reset caches if they exist from a previous load (optional, but safer)
        this.projectFileCache = new Map();
        this.sectionFileCache = new Map();
        this.taskFileCache = new Map();
        this.cachedProjects = [];
        this.cachedSections = [];
        this.cachedTasks = [];
        this.isInitialLoad = true; // Reset initial load flag on settings load
        console.log("[Cache Debug] main.ts: Caches reset during loadSettings.");
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        console.log("[Todoist Plugin] Unloading...");
        // Call cleanup method on the command manager instance
        if (this.commandManager) {
            this.commandManager.cleanup();
        }
    }

    public updateStatusBar(text: string, state: 'idle' | 'syncing' | 'error') {
        if (this.statusBarItemEl) {
            this.statusBarItemEl.setText(text);
            this.statusBarItemEl.removeClass('status-bar-syncing', 'status-bar-error'); // Remove previous states
            if (state === 'syncing') {
                this.statusBarItemEl.addClass('status-bar-syncing');
            } else if (state === 'error') {
                 this.statusBarItemEl.addClass('status-bar-error');
            }
        }
    }

} // End of class TodoistSyncPlugin
