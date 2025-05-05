import { App, PluginSettingTab, Setting } from "obsidian";
import TodoistSyncPlugin from "../main"; // Import the main plugin class type
import { DEFAULT_SETTINGS } from "./constants"; // Import defaults

export class TodoistSyncSettingTab extends PluginSettingTab {
    plugin: TodoistSyncPlugin;

    constructor(app: App, plugin: TodoistSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Todoist Sync Settings' });

        // API Key Setting
        new Setting(containerEl)
            .setName('Todoist API Key')
            .setDesc('Your Todoist API token. Find it in Todoist Settings -> Integrations -> Developer.')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Base Folder Setting
        new Setting(containerEl)
            .setName('Base Folder')
            .setDesc('The main folder where Todoist data will be synced.')
            .addText(text => text
                .setPlaceholder('e.g., Todoist')
                .setValue(this.plugin.settings.baseFolder)
                .onChange(async (value) => {
                    this.plugin.settings.baseFolder = value || DEFAULT_SETTINGS.baseFolder;
                    await this.plugin.saveSettings();
                }));

        // Archive Folder Setting
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

        // Trash Folder Setting
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

        // Done Folder Setting
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