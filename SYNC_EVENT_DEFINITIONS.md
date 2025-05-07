# Synchronization Event Definitions

This document outlines the various synchronization events (commands/checks) handled by the Obsidian Todoist Sync plugin. It details the data flow and actions for each event.

* Current development:


**Legend:**
*   **O -> T:** Data flows from Obsidian to Todoist.
*   **T -> O:** Data flows from Todoist to Obsidian.
*   **Status:**
    *   `Planned`: Definition outlined, not yet implemented.
    *   `In Development (vX.Y)`: Currently being implemented or revised.
    *   `Implemented (vX.Y)`: Implemented and considered stable for this version.
    *   `Needs Review (vX.Y)`: Implemented but requires further testing or refinement.

---

## 1. Task Events

### 1.1. Item Complete

*   **Event Name:** `item_complete`
*   **Direction:** O -> T / T -> O (Bidirectional, but initiated from either side)
*   **Trigger (O -> T):**
    *   User checks the `completed` checkbox in Obsidian frontmatter.
    *   Obsidian `metadata_change` event for `completed: true`.
*   **Trigger (T -> O):**
    *   Task marked complete in Todoist (detected during API sync).
*   **Data Payload (O -> T):**
    *   `command_type: item_complete`
    *   `task_id: <Todoist Task ID>`
    *   `completed_at: <ISO Timestamp>` (Plugin can generate this, Todoist API also sets its own if not provided)
*   **Data Payload (T -> O):**
    *   Full task object from Todoist API, with `is_completed: true` and `completed_at` set.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Update frontmatter: `completed: true`, `completed_at: <timestamp from Todoist or generated>`.
    *   Move note to "Done" folder (if configured).
    *   Update `taskFileCache` (remove entry or mark as complete/archived).
    *   Update `cachedTasks` (set `completed_at`, `is_completed: true`).
*   **Todoist Action (if O -> T):**
    *   Mark task as complete via API (`POST /tasks/{task_id}/close`).
*   **Status:** `Implemented (v0.1)` for O -> T (via CommandManager). `Implemented (v0.1)` for T -> O (via SyncEngine).
*   **Notes:** Ensure `completed_at` timestamps are handled consistently. Todoist API uses `is_completed` (boolean) and `completed_at` (string, nullable ISO 8601).

### 1.2. Item Uncomplete

*   **Event Name:** `item_uncomplete` (Reopen Task)
*   **Direction:** O -> T / T -> O
*   **Trigger (O -> T):**
    *   User unchecks the `completed` checkbox in Obsidian frontmatter.
    *   Obsidian `metadata_change` event for `completed: false`.
*   **Trigger (T -> O):**
    *   Task reopened in Todoist.
*   **Data Payload (O -> T):**
    *   `command_type: item_uncomplete` (or `item_reopen`)
    *   `task_id: <Todoist Task ID>`
*   **Data Payload (T -> O):**
    *   Full task object from Todoist API, with `is_completed: false` and `completed_at: null`.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Update frontmatter: `completed: false`, `completed_at: null`.
    *   Move note from "Done" folder back to original/base task folder.
    *   Update `taskFileCache` (re-add or update entry, ensure it's marked as active).
    *   Update `cachedTasks` (set `completed_at: null`, `is_completed: false`).
*   **Todoist Action (if O -> T):**
    *   Reopen task via API (`POST /tasks/{task_id}/reopen`).
*   **Status:** `In Development (v0.2)` for O -> T. `Planned` for T -> O.
*   **Notes:** Need to determine how to reliably find the "original" folder if moving back from "Done". Store original path in frontmatter? Or always move to project/section root?

### 1.3. Item Add (New Task)

*   **Event Name:** `item_add`
*   **Direction:** O -> T / T -> O
*   **Trigger (O -> T):**
    *   User creates a new note with specific frontmatter (e.g., `todoist_task_content: "New task"`, optionally `todoist_project_name: "Shopping"` or `todoist_project_id: "..."`, `todoist_due: "tomorrow"`).
    *   (Alternative) Command Palette: "Create new Todoist task from this note".
*   **Trigger (T -> O):**
    *   New task detected in Todoist during API sync (not previously seen by ID).
*   **Data Payload (O -> T):**
    *   `command_type: item_add`
    *   `content: <Task Content from Obsidian note body or frontmatter>`
    *   `project_id: <Optional Project ID from frontmatter/context>`
    *   `section_id: <Optional Section ID from frontmatter/context>`
    *   `due_string: <Optional Due Date string from frontmatter, e.g., "tomorrow at 5pm">`
    *   `priority: <Optional Priority (1-4) from frontmatter>`
*   **Data Payload (T -> O):**
    *   Full new task object from Todoist API.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   If T->O: Create new Obsidian note with appropriate frontmatter (content, due, priority, project_id, section_id, task_id).
    *   If O->T (successful): Update existing Obsidian note's frontmatter with the `id` (task_id), `project_id`, `section_id`, `due` (object), `priority` received from Todoist. Clear any temporary "new task" flags.
    *   Add to `taskFileCache` and `cachedTasks`.
*   **Todoist Action (if O -> T):**
    *   Create new task via API (`POST /tasks`).
*   **Status:** `Planned`
*   **Notes:** Define clear frontmatter keys for new task properties. Handle mapping `todoist_project_name` to `project_id` if name is provided.

### 1.4. Item Update (Content, Due Date, Priority, Project, Section)

*   **Event Name:** `item_update`
*   **Direction:** O -> T / T -> O
*   **Trigger (O -> T):**
    *   User modifies relevant frontmatter (e.g., `content`, `due_string`, `priority`, `project_id`, `section_id`) or the main content of the task note in Obsidian.
    *   Obsidian `metadata_change` or `modify` event.
*   **Trigger (T -> O):**
    *   Task properties changed in Todoist.
*   **Data Payload (O -> T):**
    *   `command_type: item_update`
    *   `task_id: <Todoist Task ID>`
    *   `content: <Optional Updated Content>`
    *   `due_string: <Optional Updated Due Date string>` (or `due_date`, `due_datetime`, `due_lang`)
    *   `priority: <Optional Updated Priority (1-4)>`
    *   `project_id: <Optional new Project ID>`
    *   `section_id: <Optional new Section ID>` (Note: moving to a section also implies moving to its project)
*   **Data Payload (T -> O):**
    *   Full updated task object from Todoist API.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Update corresponding frontmatter and/or note content.
    *   If `project_id` or `section_id` changed, move the file to the new corresponding folder structure.
    *   Update `cachedTasks`.
*   **Todoist Action (if O -> T):**
    *   Update task via API (`POST /tasks/{task_id}`).
*   **Status:** `In Development (v0.2)` for O -> T (basic content). `Planned` for other fields and T->O.
*   **Notes:** Debouncing changes from Obsidian is important. Moving files due to project/section changes needs robust path management. Todoist API uses P1 (priority 4) to P4 (priority 1).

### 1.5. Item Delete

*   **Event Name:** `item_delete`
*   **Direction:** O -> T / T -> O
*   **Trigger (O -> T):**
    *   User deletes the Obsidian note associated with a task.
    *   (Alternative) User sets `todoist_deleted: true` in frontmatter or uses a "Delete Todoist Task" command.
*   **Trigger (T -> O):**
    *   Task deleted in Todoist (task ID no longer appears in sync, or specific webhook if used).
*   **Data Payload (O -> T):**
    *   `command_type: item_delete`
    *   `task_id: <Todoist Task ID>`
*   **Data Payload (T -> O):**
    *   Notification of deletion (e.g., task ID missing from full sync).
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Move Obsidian note to "Trash" folder (if configured) or delete it.
    *   Remove from `taskFileCache` and `cachedTasks`.
*   **Todoist Action (if O -> T):**
    *   Delete task via API (`DELETE /tasks/{task_id}`).
*   **Status:** `Planned`
*   **Notes:** Deletion is destructive. Consider a setting for "soft delete" (move to Obsidian trash) vs. "hard delete".

---

## 2. Project Events

### 2.1. Project Add

*   **Direction:** T -> O (Primarily). O -> T (Less common, e.g., "Create new Todoist project from this folder").
*   **Trigger (T -> O):** New project detected in Todoist API sync.
*   **Trigger (O -> T):** User action in Obsidian (e.g., command on a folder, specific frontmatter in a "project meta" file).
*   **Data Payload (T -> O):** Full project object from Todoist API (`id`, `name`, `color`, `is_favorite`, `order`, etc.).
*   **Data Payload (O -> T):** `name`, `color` (optional), `is_favorite` (optional).
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Create a new folder representing the project.
    *   Potentially create a `_project_meta.md` file within the folder for project-specific settings/frontmatter.
    *   Update `projectFileCache` and `cachedProjects`.
*   **Todoist Action (if O -> T):** Create new project via API (`POST /projects`).
*   **Status:** `Implemented (v0.1)` for T -> O. `Planned` for O -> T.
*   **Notes:** Mapping Obsidian folder structure to Todoist projects.

### 2.2. Project Update (Name, Color, Favorite, Order)

*   **Direction:** T -> O (Primarily). O -> T (e.g., rename folder, change meta file frontmatter).
*   **Trigger (T -> O):** Project properties changed in Todoist.
*   **Trigger (O -> T):** Obsidian folder rename, or changes in a `_project_meta.md` file.
*   **Data Payload (T -> O):** Full updated project object.
*   **Data Payload (O -> T):** `project_id`, and changed fields (`name`, `color`, `is_favorite`, `order`).
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Rename project folder if name changed.
    *   Update `_project_meta.md` frontmatter.
    *   Update `projectFileCache` and `cachedProjects`.
*   **Todoist Action (if O -> T):** Update project via API (`POST /projects/{project_id}`).
*   **Status:** `Implemented (v0.1)` for T -> O (name). `Planned` for other fields and O -> T.
*   **Notes:** Syncing `order` can be complex. Color sync requires mapping Todoist color names/IDs to Obsidian.

### 2.3. Project Archive / Delete

*   **Direction:** T -> O (Primarily). O -> T (e.g., delete folder, command "Archive this project").
*   **Trigger (T -> O):** Project archived or deleted in Todoist. (API usually shows `is_archived: true` or project is missing).
*   **Trigger (O -> T):** Deletion of project folder in Obsidian, or a specific command/frontmatter.
*   **Data Payload (T -> O):** Notification of archival/deletion (e.g., `is_archived: true` or ID missing).
*   **Data Payload (O -> T):** `project_id`.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Move project folder to "Archive" or "Trash" folder (if configured), or remove it.
    *   Update `projectFileCache` and `cachedProjects`.
*   **Todoist Action (if O -> T):**
    *   Archive project: `POST /projects/{project_id}` with `is_archived: true` (if API supports direct archive, else might need to use `DELETE`).
    *   Delete project: `DELETE /projects/{project_id}`.
*   **Status:** `Implemented (v0.1)` for T -> O (archived projects are typically just filtered out). `Planned` for O -> T.
*   **Notes:** Distinguish between archive (reversible) and delete (permanent). Plugin should probably default to archive from Obsidian.

---

## 3. Section Events

### 3.1. Section Add

*   **Direction:** T -> O (Primarily). O -> T (e.g., command "Create new section 'X' in current project").
*   **Trigger (T -> O):** New section detected in Todoist API sync.
*   **Trigger (O -> T):** User action in Obsidian (e.g., command).
*   **Data Payload (T -> O):** Full section object (`id`, `project_id`, `order`, `name`).
*   **Data Payload (O -> T):** `name`, `project_id`, `order` (optional).
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Create a subfolder for the section within its project folder (if sections are mapped to subfolders).
    *   Update `sectionFileCache` and `cachedSections`.
*   **Todoist Action (if O -> T):** Create new section via API (`POST /sections`).
*   **Status:** `Implemented (v0.1)` for T -> O. `Planned` for O -> T.
*   **Notes:** How sections are represented in Obsidian (subfolders, headings in a project file?).

### 3.2. Section Update (Name, Order)

*   **Direction:** T -> O (Primarily). O -> T (e.g., rename section subfolder).
*   **Trigger (T -> O):** Section properties changed in Todoist.
*   **Trigger (O -> T):** Renaming section subfolder (if applicable).
*   **Data Payload (T -> O):** Full updated section object.
*   **Data Payload (O -> T):** `section_id`, and changed fields (`name`, `order`).
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Rename section subfolder.
    *   Update `sectionFileCache` and `cachedSections`.
*   **Todoist Action (if O -> T):** Update section via API (`POST /sections/{section_id}`).
*   **Status:** `Implemented (v0.1)` for T -> O (name). `Planned` for other fields and O -> T.

### 3.3. Section Delete

*   **Direction:** T -> O (Primarily). O -> T (e.g., delete section subfolder).
*   **Trigger (T -> O):** Section deleted in Todoist.
*   **Trigger (O -> T):** Deletion of section subfolder.
*   **Data Payload (T -> O):** Notification of deletion (ID missing).
*   **Data Payload (O -> T):** `section_id`.
*   **Obsidian Action (if T -> O or successful O -> T):**
    *   Remove section subfolder. Tasks within might be moved to the project root folder.
    *   Update `sectionFileCache` and `cachedSections`.
*   **Todoist Action (if O -> T):** Delete section via API (`DELETE /sections/{section_id}`).
*   **Status:** `Implemented (v0.1)` for T -> O. `Planned` for O -> T.
*   **Notes:** When a section is deleted in Todoist, its tasks are typically moved to the parent project (no section_id). The plugin should replicate this behavior for tasks in Obsidian.

---

