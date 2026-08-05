/**
 * LRU Cache Utilities
 *
 * Provides utilities to prevent unbounded memory growth in React state caches.
 * All caches should use LRU eviction to limit the number of stored entries.
 */

const DEFAULT_MAX_ENTRIES = 10;

/**
 * Creates an updater function that adds a new entry with LRU eviction.
 *
 * When the cache exceeds maxEntries, the oldest entries (by insertion order)
 * are removed to make room for the new entry.
 *
 * @param {string} key - The cache key
 * @param {any} data - The data to store
 * @param {number} [maxEntries=10] - Maximum entries before eviction
 * @returns {function} A function to pass to setState(prev => withLRU(prev, key, data, maxEntries))
 *
 * @example
 * // Instead of:
 * setCache(prev => ({ ...prev, [key]: data }))
 *
 * // Use:
 * setCache(prev => withLRU(prev, key, data, 10))
 */
export function withLRU(prev, key, data, maxEntries = DEFAULT_MAX_ENTRIES) {
    if (!prev || typeof prev !== 'object') {
        return { [key]: data };
    }

    // If key already exists, just update it (move to end = most recently used)
    if (key in prev) {
        const { [key]: _, ...rest } = prev;
        return { ...rest, [key]: data };
    }

    // New key: add to end, evict oldest if over limit
    const newCache = { ...prev, [key]: data };
    const entries = Object.keys(newCache);

    if (entries.length > maxEntries) {
        // Remove oldest entries (first N keys)
        const toRemove = entries.length - maxEntries;
        const keysToRemove = entries.slice(0, toRemove);
        const result = { ...newCache };
        keysToRemove.forEach(k => delete result[k]);
        return result;
    }

    return newCache;
}

/**
 * Wraps a cache setter to automatically apply LRU eviction.
 * Use this to wrap setters from useState.
 *
 * @param {function} setCache - The setState function from useState
 * @param {number} [maxEntries=10] - Maximum entries before eviction
 * @returns {function} A wrapped setter that applies LRU eviction automatically
 *
 * @example
 * const [cache, setCache] = useState({});
 * const safeSetCache = wrapWithLRU(setCache, 10);
 *
 * // Now this will automatically evict oldest entries when over limit:
 * safeSetCache(prev => ({ ...prev, [key]: data }));
 *
 * // Or simply:
 * setCache(prev => withLRU(prev, key, data, 10));
 */
export function wrapWithLRU(setCache, maxEntries = DEFAULT_MAX_ENTRIES) {
    return (updater) => {
        setCache(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            const key = Object.keys(next).find(k => !(prev && k in prev));
            if (!key) return next;
            return withLRU(prev, key, next[key], maxEntries);
        });
    };
}
