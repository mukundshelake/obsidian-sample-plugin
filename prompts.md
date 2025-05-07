## At the end of the day
Fill in the bracketed [...] sections with your day's progress and thoughts in the following and send the prompt.
```
"Hi Copilot, it's the end of my workday. Please help me update my project management files for the Obsidian Todoist Sync plugin.

**1. Summary of Work Accomplished Today:**
    *   [Briefly describe feature 1 completed/progressed, e.g., "Implemented the API call for 'item_uncomplete' in CommandManager."]
    *   [Briefly describe bug fix 1, e.g., "Fixed a null pointer when accessing taskFileCache for a non-existent task."]
    *   [Briefly describe refactoring done, e.g., "Extracted file moving logic from processPendingCommands into a helper function."]
    *   [Any other significant accomplishments.]

**2. TODO.md Updates:**
    *   **Completed Tasks:**
        *   [Copy-paste the exact line of the TODO item that was completed, e.g., "- [ ] Update Todoist API (set completed_at: null)."]
        *   [Add more completed tasks if any.]
    *   **New Tasks/Bugs/Ideas to Add:**
        *   [Describe new task 1, e.g., "New Bug: If a task is uncompleted in Obsidian and the 'Done' folder doesn't exist, the plugin throws an error instead of recreating the path or notifying."]
        *   [Describe new task 2, e.g., "New Feature Idea: Add a command palette option to manually trigger processing of pending commands."]
        *   [Categorize if possible, e.g., Bug, Feature, Refactoring, Documentation.]

**3. CHANGELOG.md Updates (for the [Unreleased] section):**
    *   **Added:**
        *   [Detail new features added, e.g., "CommandManager: Added handling for `item_uncomplete` command to revert task completion status in Todoist and Obsidian."]
    *   **Changed:**
        *   [Detail changes to existing functionality, e.g., "CommandManager: Refactored file system operations for completed tasks to use `moveFileToCustomLocation`."]
    *   **Fixed:**
        *   [Detail bug fixes, e.g., "Corrected an issue where `taskFileCache` was not properly updated after moving a completed task."]
    *   **Removed/Deprecated:** (If applicable)

**4. README.md Updates:**
    *   **Current Status section changes:** [Describe how the overall status has changed, e.g., "'item_uncomplete' functionality is now mostly implemented and under testing."]
    *   **Key Features (Implemented) section additions:** [List newly completed high-level features, e.g., "Processing of `item_uncomplete` commands."]
    *   **Key Features (Planned / In Progress) section updates:** [Update what's now in progress or completed from this list, e.g., "'Implement `item_uncomplete` command processing' is now moved to Implemented."]
    *   **Known Issues/Limitations additions:** [Add any new significant issues discovered.]

**5. Next Immediate Focus/Priorities for Tomorrow:**
    *   [What's the main thing you'll work on next? e.g., "Start implementing `item_update` for task content changes in CommandManager." or "Thoroughly test the `item_uncomplete` flow with edge cases."]

Please generate the updated content for `README.md`, `TODO.md`, and `CHANGELOG.md` based on this information. I will provide the current content of these files if you need them."
```
