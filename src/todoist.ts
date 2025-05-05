import fetch from "node-fetch"; // Assuming node-fetch is needed and installed
// Remove direct fs import if only used for sync token
// import * as fs from "fs";
import * as path from "path"; // Keep for path.dirname
import { App, normalizePath, Notice, FileSystemAdapter } from "obsidian"; // Import App, Notice

const TODOIST_SYNC_API_URL = "https://api.todoist.com/sync/v9/sync";
const TODOIST_REST_API_URL = "https://api.todoist.com/rest/v2";

// --- Interfaces for Todoist API Responses ---
export interface Project { // Add export
    id: string;
    name: string;
    is_deleted?: boolean; // Add this
    is_archived?: boolean; // Add this
    // Add other project properties if needed
}

export interface Section { // Add export
    id: string;
    name: string;
    project_id: string;
    is_deleted?: boolean; // Add this
    is_archived?: boolean; // Add this
    // Add other section properties if needed
}

export interface Item { // Add export - Todoist calls tasks "items" in the Sync API
    id: string;
    content?: string; // Make optional as deleted items might lack it
    description?: string; // Make optional
    project_id?: string; // Make optional
    section_id?: string | null; // Make optional
    completed_at?: string | null; // Make optional
    labels?: string[]; // Make optional
    priority?: number; // Make optional
    due?: { date: string; } | null; // Make optional
    url?: string; // Make optional
    added_at?: string; // Make optional
    parent_id?: string | null; // Make optional
    is_deleted?: boolean; // Add this optional field
    // Add other item properties if needed
}

// Interface for the main Sync API response structure
// Make this exportable as it's used by the exported syncTodoist function
export interface SyncResponse {
    sync_token: string;
    full_sync: boolean; // Added based on potential API response
    projects?: Project[];
    sections?: Section[];
    items?: Item[];
    // Remove completed_info unless you specifically handle it from the API
    // completed_info?: any[];
}

// Make this local (remove export) as getProjectData is local
interface ProjectDataResponse {
    // Content based on the REST API response for a single project
    id: string;
    name: string;
    comment_count: number;
    order: number;
    color: string;
    is_shared: boolean;
    is_favorite: boolean;
    is_inbox_project?: boolean;
    is_team_inbox?: boolean;
    view_style: string;
    url: string;
    parent_id: string | null;
}
// --- End Interfaces ---


// Function to get the sync token file path
export function getSyncTokenFilePath(app: App): string {
    // Use app.vault.configDir which points to the .obsidian folder
    return normalizePath(`${app.vault.configDir}/plugins/obsidian-sample-plugin/sync_token.txt`);
}

// --- Helper to get relative path for adapter ---
function getSyncTokenFileRelativePath(app: App): string {
    const absolutePath = getSyncTokenFilePath(app);
    let vaultBasePath = "/"; // Default base path

    // Check if the adapter is FileSystemAdapter
    if (app.vault.adapter instanceof FileSystemAdapter) {
        vaultBasePath = app.vault.adapter.getBasePath();
    } else {
        // Handle cases where it might not be a standard file system (e.g., mobile)
        // This fallback might not be perfect for all scenarios.
        console.warn("[Todoist Sync] Vault adapter is not FileSystemAdapter. Relative path calculation might be less reliable.");
        // We can often still proceed assuming the absolute path starts with the vault name or similar structure
        // that substring can handle, but getBasePath is safer.
    }

    let relativePath = absolutePath;
     // Use normalizePath to handle separators consistently
     const normalizedAbsolutePath = normalizePath(absolutePath);
     const normalizedBasePath = normalizePath(vaultBasePath);

     // Check if the absolute path starts with the base path + separator
     if (normalizedAbsolutePath.startsWith(normalizedBasePath + '/')) {
         // Get substring after the base path and the separator
         relativePath = normalizedAbsolutePath.substring(normalizedBasePath.length + 1);
     } else if (normalizedAbsolutePath === normalizedBasePath) {
         // Handle case where the path IS the base path (unlikely for our file)
         relativePath = ".";
     } else {
         console.warn(`[Todoist Sync] Absolute path "${normalizedAbsolutePath}" does not seem to be inside base path "${normalizedBasePath}". Using absolute path as fallback relative path.`);
         // Fallback might cause issues if adapter expects truly relative paths
         relativePath = normalizedAbsolutePath; // Use the original absolute path as a risky fallback
     }


     // Ensure it's within the .obsidian directory structure for safety
     if (!relativePath.startsWith('.obsidian/')) {
         console.warn(`[Todoist Sync] Calculated relative path "${relativePath}" seems incorrect (expected to start with .obsidian/). Using default fallback.`);
         // Provide a fallback default relative path
         return normalizePath('.obsidian/plugins/obsidian-sample-plugin/sync_token.txt');
     }
     console.log(`[Todoist Sync] Calculated relative path for token file: ${relativePath}`);
     return relativePath;
}

// Modify syncTodoist to accept app
export async function syncTodoist(app: App, apiKey: string, resourceTypes: string[], syncToken: string = "*", SYNC_TOKEN_FILE_ABS: string): Promise<SyncResponse | null> {
    if (!apiKey) {
        console.error("[Todoist Sync] API Key is missing. Please configure it in settings.");
        // Optionally throw an error or return null immediately
        return null;
    }
    console.log(`[Todoist Sync] Calling syncTodoist with token: ${syncToken === "*" ? "'*'" : syncToken.substring(0, 10) + "..."} for types: ${JSON.stringify(resourceTypes)}`);
    try {
        const requestBody = new URLSearchParams({
            sync_token: syncToken,
            resource_types: JSON.stringify(resourceTypes)
        });
        console.log(`[Todoist Sync] Sending POST request to ${TODOIST_SYNC_API_URL}`);
        const response = await fetch(TODOIST_SYNC_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`, // Use passed apiKey
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: requestBody
        });

        console.log(`[Todoist Sync] Received response status: ${response.status}`);
        if (!response.ok) {
            console.error("[Todoist Sync] Sync API request failed:", response.status, response.statusText);
            try {
                 const errorBody = await response.text();
                 console.error("[Todoist Sync] Error body:", errorBody);
            } catch (e) {
                 console.error("[Todoist Sync] Could not read error body.");
            }
            return null;
        }

        // Type the response data
        const data = await response.json() as SyncResponse;

        // --- Add this log ---
        console.log("[Todoist Sync] Raw API Response Data:", JSON.stringify(data, null, 2));
        // --- End added log ---

        console.log(`[Todoist Sync] Sync API response processed. New sync token: ${data?.sync_token ? data.sync_token.substring(0, 10) + "..." : "N/A"}. Projects: ${data?.projects?.length ?? 0}, Sections: ${data?.sections?.length ?? 0}, Items: ${data?.items?.length ?? 0}`);

        // Check if sync_token exists before writing
        if (data && data.sync_token) {
            const new_syncToken = data.sync_token;
            const relativePath = getSyncTokenFileRelativePath(app); // Get relative path
            console.log(`[Todoist Sync] Attempting to write sync token via adapter to relative path: ${relativePath}`);
            try {
                // Ensure directory exists using adapter
                const relativeDir = path.dirname(relativePath);
                 if (relativeDir && relativeDir !== '.' && !(await app.vault.adapter.exists(relativeDir))) {
                     console.log(`[Todoist Sync] Relative directory ${relativeDir} does not exist. Creating...`);
                     await app.vault.adapter.mkdir(relativeDir);
                 }

                // Use adapter.write with the relative path
                await app.vault.adapter.write(relativePath, new_syncToken);
                console.log(`[Todoist Sync] Successfully wrote sync token via adapter to ${relativePath}`);
            } catch (writeError) {
                 console.error(`[Todoist Sync] Error writing sync token via adapter to ${relativePath}:`, writeError);
                 new Notice("Error saving Todoist sync token. Check console.");
                 // Fail the sync if token saving fails, otherwise next sync might be wrong
                 return null;
            }
        }
        return data;
    } catch (error) {
        console.error("[Todoist Sync] Network or parsing error during syncTodoist:", error);
        new Notice("Network error during Todoist sync. Check console.");
        return null;
    }
}

// Modify fetchTodoistData to use adapter.read and pass app to syncTodoist
export async function fetchTodoistData(apiKey: string, app: App, isFullSync: boolean): Promise<{ projects: Project[], sections: Section[], tasks: Item[] } | null> {
    console.log(`[Todoist Sync] Starting fetchTodoistData (Full Sync: ${isFullSync})`);
    const SYNC_TOKEN_FILE_ABS = getSyncTokenFilePath(app); // Absolute path for logging
    const SYNC_TOKEN_FILE_REL = getSyncTokenFileRelativePath(app); // Relative path for adapter
    let syncToken = "*";

    console.log(`[Todoist Sync] Sync token absolute path: ${SYNC_TOKEN_FILE_ABS}`);
    console.log(`[Todoist Sync] Sync token relative path: ${SYNC_TOKEN_FILE_REL}`);


    if (!isFullSync) {
        try {
            // Use adapter.exists and adapter.read with the relative path
            if (await app.vault.adapter.exists(SYNC_TOKEN_FILE_REL)) {
                syncToken = await app.vault.adapter.read(SYNC_TOKEN_FILE_REL);
                if (syncToken && syncToken.trim() !== "") {
                    console.log(`[Todoist Sync] Found sync token via adapter: ${syncToken.substring(0, 10)}...`);
                } else {
                     console.warn("[Todoist Sync] Sync token file exists but is empty, performing full sync.");
                     syncToken = "*";
                }
            } else {
                console.log("[Todoist Sync] Sync token file not found via adapter, performing full sync instead.");
                syncToken = "*";
            }
        } catch (error) {
            console.error("[Todoist Sync] Error reading sync token via adapter, performing full sync:", error);
            syncToken = "*";
        }
    } else {
         console.log("[Todoist Sync] Full sync requested. Using '*' sync token.");
         syncToken = "*";
    }

    const resourceTypes = ["projects", "sections", "items"];
    console.log(`[Todoist Sync] Requesting resource types: ${JSON.stringify(resourceTypes)}`);

    // Pass app to syncTodoist, use absolute path for logging consistency in syncTodoist
    const data = await syncTodoist(app, apiKey, resourceTypes, syncToken, SYNC_TOKEN_FILE_ABS);

    if (!data) {
        console.error("[Todoist Sync] fetchTodoistData received null data from syncTodoist.");
        // Return null to match the function's return type annotation
        return null;
        // Remove incorrect return: return { projects: [], sections: [], tasks: [], completed_info: [] };
    }

    const result = {
        projects: data.projects || [],
        sections: data.sections || [],
        tasks: data.items || [] // Map items to tasks
        // Remove completed_info: data.completed_info || []
    };
    console.log(`[Todoist Sync] fetchTodoistData finished. Returning ${result.projects.length} projects, ${result.sections.length} sections, ${result.tasks.length} tasks.`);
    return result;
    // Remove incorrect return: return { projects: [], sections: [], tasks: [], completed_info: [] };
}


// Define the structure returned by getProjectData
// This isn't strictly needed if getProjectData remains local
// export interface FetchedProjectData { ... }

// Modify getProjectData to accept apiKey
async function getProjectData(apiKey: string, projectId: string): Promise<ProjectDataResponse | null> {
    if (!apiKey) {
        console.error("[Todoist Sync] API Key is missing for getProjectData.");
        return null;
    }
    const url = `${TODOIST_REST_API_URL}/projects/${projectId}`; // Use REST URL
    console.log(`[Todoist Sync] Sending GET request to ${url}`);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`, // Use passed apiKey
            }
        });
        if (!response.ok) {
            console.error(`[Todoist Sync] Failed to get project data for ${projectId}:`, response.status, response.statusText);
            return null;
        }
        const data = await response.json() as ProjectDataResponse;
        return data;
    } catch (error) {
        console.error(`[Todoist Sync] Error fetching project data for ${projectId}:`, error);
        return null;
    }
}


