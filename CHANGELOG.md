# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial structure for `CommandManager` to queue and process commands from Obsidian to Todoist.
- Debounce mechanism for `queueTodoistCommand` to batch outgoing API calls.
- Implementation for `item_complete` command:
    - Sends `item_complete` to Todoist API.
    - Updates local `cachedTasks` by marking task as completed.
    - Updates frontmatter of corresponding Obsidian note (`completed: true`, `completed_at`).
    - Moves completed task note to the configured "Done" folder.
    - Removes task from `taskFileCache` after successful move.
- Status bar updates for sync operations initiated by `CommandManager`.

### Changed
- `CommandManager` constructor now takes `TodoistSyncPlugin` instance for access to settings, app, and caches.
- `processPendingCommands` now accesses `taskFileCache` and `cachedTasks` via the `plugin` reference.

### Fixed
- (Add any bug fixes here as you make them)

## [0.1.0] - YYYY-MM-DD (Example: First conceptual version)

### Added
- Basic fetching of projects, sections, and tasks from Todoist.
- Creation of Obsidian notes based on fetched Todoist items.
- Initial caching mechanism for API responses and file paths.
- Settings panel for API key and base folder.