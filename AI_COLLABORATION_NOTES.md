// filepath: c:\Users\Asus\Documents\plugin_maker\.obsidian\plugins\obsidian-sample-plugin\AI_COLLABORATION_NOTES.md
# Project Directives for AI Collaboration

## Core Principles & Constraints:
*   **Todoist Parity:** Strive for parity with Todoist features where sensible. For example, use the same priority structure as Todoist (P1, P2, P3, P4). Do not define or implement a custom priority system.
*   **Simplicity:** Prefer simpler solutions and avoid over-engineering unless necessary for a core requirement.
*   **Obsidian Integration:** Ensure solutions are idiomatic to Obsidian plugin development (e.g., use Obsidian API for file operations, notices, etc.).
*   **Cache Management:** Be mindful of `taskFileCache`, `projectFileCache`, `sectionFileCache`, and the API data caches (`cachedTasks`, `cachedProjects`, `cachedSections`) in `main.ts` and `commandManager.ts`. Updates to data should likely involve cache updates.

## Code Style Preferences:
*   [Add any specific code style preferences here, e.g., "Prefer arrow functions for callbacks."]