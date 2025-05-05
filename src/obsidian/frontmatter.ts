import { App, TFile } from "obsidian";
import { Project, Section, Item } from "../todoist"; // Assuming API types are in todoist.ts or a shared types file

/**
 * Updates the frontmatter of an Obsidian project file.
 */
export async function updateObsidianProjectFile(
    app: App,
    file: TFile,
    project: Project
) {
    await app.fileManager.processFrontMatter(file, (fm) => {
        fm.type = 'project';
        fm.todoist_id = project.id;
        fm.name = project.name;
        fm.is_archived = project.is_archived ?? false;
        fm.is_deleted = project.is_deleted ?? false; // Add deleted flag
        // Add other relevant project metadata if needed
    });
}

/**
 * Updates the frontmatter of an Obsidian section file.
 */
export async function updateObsidianSectionFile(
    app: App,
    file: TFile,
    section: Section,
    project: Project | undefined // Pass the parent project for context if available
) {
    await app.fileManager.processFrontMatter(file, (fm) => {
        fm.type = 'section';
        fm.todoist_id = section.id;
        fm.name = section.name;
        fm.project_id = section.project_id;
        fm.project_name = project?.name; // Add project name for context
        fm.is_archived = section.is_archived ?? false;
        fm.is_deleted = section.is_deleted ?? false; // Add deleted flag
        // Add other relevant section metadata if needed
    });
}

/**
 * Updates the frontmatter of an Obsidian task file.
 */
export async function updateObsidianTask(
    app: App,
    file: TFile,
    task: Item,
    taskFileCache: Map<string, string> // Pass cache for parent link lookup
) {
    await app.fileManager.processFrontMatter(file, (fm) => {
        fm.type = 'task';
        fm.todoist_id = task.id;
        fm.content = task.content;
        fm.description = task.description;
        fm.project_id = task.project_id;
        fm.section_id = task.section_id;
        fm.created_at = task.created_at;
        fm.due_date = task.due?.date;
        fm.due_string = task.due?.string;
        fm.priority = task.priority;
        fm.completed = !!task.completed_at; // Use boolean
        fm.completed_at = task.completed_at; // Keep timestamp if present
        fm.labels = task.labels; // Store labels as array
        fm.url = task.url;
        fm.parent_id = task.parent_id; // Add parent ID
        // Add parent link if parent exists in cache
        fm.parent_link = task.parent_id && taskFileCache.has(String(task.parent_id))
            ? `[[${app.vault.getAbstractFileByPath(taskFileCache.get(String(task.parent_id))!)?.name}]]`
            : null;
        // Remove null parent_link if parent_id is null
        if (!fm.parent_id) delete fm.parent_link;
        // Add is_deleted flag (although usually handled by moving)
        fm.is_deleted = task.is_deleted ?? false;
    });
}