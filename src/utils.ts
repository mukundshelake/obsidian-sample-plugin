/**
 * Generates a simple pseudo-random UUID (Version 4).
 * Note: For production, consider using a more robust library like 'uuid'.
 * @returns A string representing the generated UUID.
 */
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}


/**
 * Merges an array of delta updates into a cache array based on object IDs.
 * Updates existing items, adds new ones, and keeps items not in the delta.
 * Assumes objects in both arrays have an 'id' property.
 *
 * @template T - The type of objects in the arrays, must have an 'id' property.
 * @param {T[]} cache - The current cache array.
 * @param {T[] | undefined} delta - The array of updates/new items.
 * @returns {T[]} The updated cache array.
 */
export function mergeById<T extends { id: string }>(cache: T[], delta: T[] | undefined): T[] {
    if (!delta || delta.length === 0) return cache;

    const cacheMap = new Map<string, T>(cache.map(item => [String(item.id), item]));

    delta.forEach(deltaItem => {
        cacheMap.set(String(deltaItem.id), deltaItem); // Add or overwrite item in the map
    });

    return Array.from(cacheMap.values());
}