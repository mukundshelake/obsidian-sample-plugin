/**
 * Interface defining the settings for the Todoist Sync plugin.
 */
export interface TodoistSyncSettings {
    apiKey: string;
    baseFolder: string;
    archiveFolder: string; // For items archived in Todoist
    trashFolder: string;   // For items deleted in Todoist
    doneFolder: string;    // For items completed in Todoist
}

// You can add other shared type definitions here later if needed.