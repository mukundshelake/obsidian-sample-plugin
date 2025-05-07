# Obsidian Todoist Sync Plugin

## Project Overview

This plugin provides two-way synchronization between Todoist and Obsidian. It aims to:
*   Fetch projects, sections, and tasks from Todoist.
*   Create and update corresponding notes in Obsidian with relevant frontmatter.
*   Handle full and incremental synchronization.
*   Process changes made in Obsidian (e.g., task completion) and sync them back to Todoist.

## Current Status

*   **Alpha/Development:** Core synchronization logic for fetching from Todoist is in place.
*   Actively developing the `CommandManager` to handle changes originating from Obsidian and sync them to Todoist.
*   `item_complete` command processing (including cache updates and file management) is implemented.
*   Debouncing mechanism for local changes is functional.

## Key Features

### Implemented
*   Fetching Todoist projects, sections, and tasks.
*   Creating/updating Obsidian notes for Todoist items.
*   Local file and API data caching.
*   `CommandManager` for queueing and debouncing Obsidian-originated changes.
*   Processing of `item_complete` commands:
    *   Updates Todoist via API.
    *   Updates local API cache.
    *   Updates Obsidian note frontmatter (`completed: true`, `completed_at`).
    *   Moves completed task notes to the configured "Done" folder.
*   Status bar updates for sync status.

### Planned / In Progress
*   Implement `item_uncomplete` command processing.
*   Implement `item_update` command processing (e.g., content changes, due date changes from Obsidian).
*   Robust error handling and potential re-queueing for failed commands.
*   Settings UI for API key and folder configurations.
*   Conflict resolution strategy.

## Setup/Installation

*(Placeholder: Add instructions on how to install and configure the plugin, including API key setup and folder settings in Obsidian.)*

1.  Install the plugin.
2.  Obtain a Todoist API key.
3.  Configure the plugin settings in Obsidian:
    *   Todoist API Key
    *   Base Folder for Todoist Notes
    *   Done Folder Name
    *   Archive Folder Name (if applicable)
    *   Trash Folder Name (if applicable)

## Known Issues/Limitations

*   Cache coherency between various local caches and API data is complex and needs ongoing attention.
*   Error handling for all edge cases during sync and command processing is still under development.
*   Conflict resolution for simultaneous changes in Todoist and Obsidian is not yet implemented.

## Roadmap/Goals

*   **Short Term:**
    *   Complete implementation of `item_uncomplete` in `CommandManager`.
    *   Implement `item_update` for core task fields in `CommandManager`.
    *   Improve error reporting and user notifications for sync/command failures.
*   **Medium Term:**
    *   Refine caching strategies for better performance and reliability.
    *   Develop a strategy for handling API rate limits more gracefully.
    *   Explore options for resolving sync conflicts.
*   **Long Term:**
    *   Support for syncing task comments or descriptions.
    *   More granular control over what gets synced.

## Contributing

*(Placeholder: Add guidelines if you plan to accept contributions.)*

