# Project TODOs

## High Priority / Next Up
- [ ] **CommandManager:** Implement `item_uncomplete` command logic in `processPendingCommands`:
    - [ ] Update Todoist API (set `completed_at: null`).
    - [ ] Update local API cache (`this.plugin.cachedTasks`).
    - [ ] Update Obsidian note frontmatter (`completed: false`, `completed_at: null`).
    - [ ] Move file from "Done" folder back to its original project/section folder (or base folder).
        - Need to determine how to track the original location or if it should just go to the base task folder.
- [ ] **CommandManager:** Implement basic `item_update` command logic (e.g., for content changes from Obsidian note body).
    - [ ] Determine how to detect content changes efficiently.
    - [ ] Update Todoist API.
    - [ ] Update local API cache if necessary.

## Bugs
- [ ] Investigate: What happens if a file is moved *manually* by the user from the "Done" folder? Does `CommandManager` or `eventHandlers` handle this correctly?
- [ ] API Error Handling: Improve resilience if `postTodoistCommands` fails (e.g., network issue, invalid API key after initial setup). Consider a retry mechanism for transient errors.

## Features
- [ ] **CommandManager:** Strategy for re-queueing failed commands in `processPendingCommands` (e.g., after a temporary API outage).
- [ ] **Settings:** Add a setting to control the debounce delay for `CommandManager`.
- [ ] **SyncEngine:** Ensure `syncOrFullSyncTasks` correctly updates `this.plugin.cachedTasks` before `CommandManager` might try to access it for `item_complete` or other operations.
- [ ] **File Management:** Handle cases where the configured "Done", "Archive", or "Trash" folders don't exist. Create them? Notify user?

## Refactoring
- [ ] **CommandManager:** `processPendingCommands` - The direct access `this.plugin.cachedTasks` and `this.plugin.taskFileCache` could be encapsulated via methods on the `TodoistSyncPlugin` class to make `CommandManager` less coupled.
- [ ] **SyncEngine:** `syncOrFullSyncTasks` is very large. Explore breaking it down into smaller, more manageable functions.
- [ ] **Error Handling:** Standardize error logging and user notifications (Notices) across the plugin.

## Documentation
- [ ] Update README with detailed setup instructions.
- [ ] Add inline JSDoc/TSDoc comments for all public methods and complex private methods.

## Future / Ideas
- [ ] Support for syncing Todoist labels as Obsidian tags.
- [ ] Support for syncing task due dates.