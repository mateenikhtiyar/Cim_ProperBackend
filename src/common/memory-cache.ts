/**
 * Tiny in-memory TTL cache. Zero dependencies.
 *
 * Use for short-lived (30s–5min) caching of expensive read-only computations
 * where eventual consistency is acceptable. On serverless (Vercel) this is
 * per-instance and per-region, which is fine for short TTLs.
 *
 * DO NOT use for:
 *  - per-user data (leaks across users via shared process)
 *  - data that must be immediately consistent after a write
 *  - data where staleness could cause incorrect business decisions
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

// Opportunistic cleanup — runs on every get/set, no setInterval (serverless-safe).
function prune(): void {
  if (store.size < 100) return
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key)
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    store.delete(key)
    return undefined
  }
  return entry.value
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  prune()
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Invalidate a single key or all keys matching a prefix.
 * Call after writes to keep cached reads reasonably fresh.
 */
export function cacheInvalidate(keyOrPrefix: string, isPrefix = false): void {
  if (!isPrefix) {
    store.delete(keyOrPrefix)
    return
  }
  for (const key of store.keys()) {
    if (key.startsWith(keyOrPrefix)) store.delete(key)
  }
}

/**
 * Wrapper: return cached value if present, else compute, cache, and return.
 */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key)
  if (hit !== undefined) return hit
  const value = await compute()
  cacheSet(key, value, ttlMs)
  return value
}
