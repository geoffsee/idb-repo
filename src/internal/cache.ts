/**
 * TinyLRU: Small, best-effort, TTL-based in-memory cache for KV reads
 * - Keeps decoded values per (key, type)
 * - Eviction: simple Map insertion order (best-effort)
 * - TTL: automatic expiration on access
 */

import { nowMs } from "../time-utils";

/**
 * Small, best-effort, TTL-based in-memory cache for reads
 * Preserves "no recency refresh" optimization: doesn't refresh cache entry on hit
 * to avoid 2 Map operations per cache hit. LRU eviction is best-effort anyway,
 * and TTL makes staleness acceptable.
 */
export class TinyLRU {
  private max: number;
  private map = new Map<string, { expiresAt: number; value: any; meta: any }>();

  constructor(maxEntries: number) {
    this.max = Math.max(0, maxEntries | 0);
  }

  /**
   * Get a value from cache
   * @returns Cached value and metadata, or null if not found or expired
   */
  get(k: string): { value: any; meta: any } | null {
    const hit = this.map.get(k);
    if (!hit) return null;
    if (hit.expiresAt <= nowMs()) {
      this.map.delete(k);
      return null;
    }
    // Note: We skip refreshing recency to avoid 2 Map ops per cache hit.
    // LRU eviction is best-effort anyway, and cache ttl makes staleness moot.
    return { value: hit.value, meta: hit.meta };
  }

  /**
   * Set a value in cache with TTL
   */
  set(k: string, value: any, meta: any, ttlSeconds: number): void {
    if (this.max <= 0) return;
    const expiresAt = nowMs() + Math.max(0, ttlSeconds) * 1000;
    this.map.set(k, { expiresAt, value, meta });
    while (this.map.size > this.max) {
      // delete oldest (first inserted)
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /**
   * Delete a specific key from cache
   */
  delete(k: string): void {
    this.map.delete(k);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.map.clear();
  }
}
