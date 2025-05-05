import { TodoistSyncSettings } from "./types"; // Import the settings interface

export const DEFAULT_SETTINGS: TodoistSyncSettings = {
    apiKey: '', // Default to empty
    baseFolder: 'Todoist',
    archiveFolder: 'Archive', // Relative to base folder
    trashFolder: 'Trash',      // Relative to base folder
    doneFolder: 'Done'
};

// You could also add other constants here later, like API URLs if desired
// export const TODOIST_SYNC_API_URL = "https://api.todoist.com/sync/v9/sync";
// export const TODOIST_REST_API_URL = "https://api.todoist.com/rest/v2";