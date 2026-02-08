/**
 * TTL utilities for KV storage
 */

import type { KVPutOptions, StoredRecord } from "../types";
import { fromEpochSeconds, nowMs } from "../time-utils";

/**
 * Compute expiration timestamp in milliseconds from KV put options
 * @returns Expiration time in ms since epoch, or null if no expiration set
 */
export function computeExpiresAtMs(options?: KVPutOptions): number | null {
    if (!options) return null;
    if (typeof options.expirationTtl === "number") {
        const ttlMs = Math.max(0, options.expirationTtl) * 1000;
        return nowMs() + ttlMs;
    }
    if (typeof options.expiration === "number") {
        return fromEpochSeconds(options.expiration);
    }
    return null;
}

/**
 * Check if a stored record has expired
 */
export function isExpired(rec: StoredRecord): boolean {
    return rec.expiresAt !== null && rec.expiresAt <= nowMs();
}
