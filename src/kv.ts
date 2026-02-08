/**
 * IndexedDbKV: High-performance KV over IndexedDB
 */

import type { KVGetOptions, KVListOptions, KVListResult, KVListKey, KVNamespace, KVPutOptions, KVValue, StoredRecord } from "./types";
import { IndexedDbConnection } from "./connection";
import { TinyLRU } from "./internal/cache";
import { decodeCursor, encodeCursor } from "./internal/cursor";
import { blobToArrayBuffer, blobToJson, blobToText, decodeValue, normalizePutValue } from "./internal/value-codec";
import { promisifyRequest, waitTx } from "./internal/idb-utils";
import { assertKey } from "./internal/validation";
import { computeExpiresAtMs, isExpired } from "./internal/ttl";
import { nowMs, toEpochSeconds } from "./time-utils";

/**
 * High-performance KV implementation over IndexedDB
 */
export class IndexedDbKV implements KVNamespace {
    private conn: IndexedDbConnection;
    private storeName: string;
    private cache: TinyLRU;

    constructor(opts?: {
        dbName?: string;
        storeName?: string;
        version?: number;
        cacheEntries?: number;
    }) {
        const dbName = opts?.dbName ?? "kv";
        this.storeName = opts?.storeName ?? "kv";
        const version = opts?.version ?? 1;
        this.conn = new IndexedDbConnection({ dbName, storeName: this.storeName, version });
        this.cache = new TinyLRU(opts?.cacheEntries ?? 2048);
    }

    private invalidateCache(key: string): void {
        this.cache.delete(`${key}::text`);
        this.cache.delete(`${key}::json`);
        this.cache.delete(`${key}::arrayBuffer`);
        this.cache.delete(`${key}::stream`);
    }

    async get(key: string, options?: KVGetOptions): Promise<string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null> {
        const { value } = await this.getWithMetadata(key, options);
        return value;
    }

    async getWithMetadata<T = unknown>(
        key: string,
        options?: KVGetOptions
    ): Promise<{ value: string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null; metadata: T | null }> {
        assertKey(key);

        const wantType = options?.type ?? "text";
        const cacheTtl = options?.cacheTtl ?? 0;
        const cacheKey = cacheTtl > 0 ? `${key}::${wantType}` : null;

        if (cacheKey) {
            const hit = this.cache.get(cacheKey);
            if (hit) return { value: hit.value, metadata: hit.meta as T };
        }

        const db = await this.conn.db;
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);

        const rec = (await promisifyRequest(store.get(key))) as StoredRecord | undefined;
        if (!rec) return { value: null, metadata: null };

        if (isExpired(rec)) {
            void this.delete(key);
            return { value: null, metadata: null };
        }

        let decoded = decodeValue(rec, wantType);

        if (rec.encoding === "binary") {
            const blob = decoded as unknown as Blob;
            if (wantType === "stream") {
                decoded = (blob.stream() as ReadableStream<Uint8Array>) ?? null;
            } else if (wantType === "arrayBuffer") {
                decoded = await blobToArrayBuffer(blob);
            } else if (wantType === "json") {
                decoded = await blobToJson(blob);
            } else {
                decoded = await blobToText(blob);
            }
        }

        const meta = (rec.metadata ?? null) as T | null;

        if (cacheKey) this.cache.set(cacheKey, decoded, meta, cacheTtl);

        return { value: decoded, metadata: meta };
    }

    async put(key: string, value: KVValue, options?: KVPutOptions): Promise<void> {
        assertKey(key);

        const { encoding, stored } = await normalizePutValue(value);
        const expiresAt = computeExpiresAtMs(options);

        const db = await this.conn.db;
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);

        const t = nowMs();
        const rec: StoredRecord = {
            key,
            value: stored,
            encoding,
            expiresAt,
            metadata: options?.metadata ?? null,
            createdAt: t,
            updatedAt: t,
        };

        store.put(rec);
        this.invalidateCache(key);
        await waitTx(tx);
    }

    async delete(key: string): Promise<void> {
        assertKey(key);

        const db = await this.conn.db;
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        store.delete(key);

        this.invalidateCache(key);
        await waitTx(tx);
    }

    async list(options?: KVListOptions): Promise<KVListResult> {
        const prefix = options?.prefix ?? "";
        const limit = Math.min(Math.max(1, options?.limit ?? 1000), 10000);
        const cursorRaw = options?.cursor ?? null;

        let after: string | null = null;
        if (cursorRaw) {
            const decoded = decodeCursor(cursorRaw);
            if (decoded && decoded.prefix === prefix) after = decoded.after;
        }

        const db = await this.conn.db;
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);

        const lower = prefix;
        const upper = prefix + "\uffff";
        const range = IDBKeyRange.bound(lower, upper, false, false);

        const allRecs = (await promisifyRequest(store.getAll(range))) as StoredRecord[];

        const keys: KVListKey[] = [];
        let listComplete = true;
        let lastKey: string | null = null;

        const now = nowMs();
        const afterIdx = after !== null ? allRecs.findIndex((r) => r.key > after) : 0;
        const startIdx = afterIdx < 0 ? allRecs.length : afterIdx;

        for (let i = startIdx; i < allRecs.length && keys.length < limit; i++) {
            const rec = allRecs[i];
            if (!rec) continue;

            if (rec.expiresAt && rec.expiresAt <= now) {
                continue;
            }

            const result: KVListKey = { name: rec.key };
            if (rec.expiresAt) result.expiration = toEpochSeconds(rec.expiresAt);
            if (rec.metadata) result.metadata = rec.metadata;

            keys.push(result);
            lastKey = rec.key;
        }

        if (keys.length >= limit && startIdx + keys.length < allRecs.length) {
            listComplete = false;
        }

        if (!listComplete && lastKey !== null) {
            const nextCursor = encodeCursor({ v: 1, prefix, after: lastKey });
            return { keys, list_complete: false, cursor: nextCursor };
        }

        return { keys, list_complete: true };
    }

    async close(): Promise<void> {
        await this.conn.close();
        this.cache.clear();
    }
}

export function createIndexedDbKV(opts?: ConstructorParameters<typeof IndexedDbKV>[0]): KVNamespace {
    return new IndexedDbKV(opts);
}

export async function kvGetText(kv: KVNamespace, key: string, cacheTtl?: number): Promise<string | null> {
    return (await kv.get(key, { type: "text", cacheTtl })) as string | null;
}

export async function kvGetJson<T>(kv: KVNamespace, key: string, cacheTtl?: number): Promise<T | null> {
    return (await kv.get(key, { type: "json", cacheTtl })) as T | null;
}

export async function kvGetArrayBuffer(kv: KVNamespace, key: string, cacheTtl?: number): Promise<ArrayBuffer | null> {
    return (await kv.get(key, { type: "arrayBuffer", cacheTtl })) as ArrayBuffer | null;
}

export async function kvGetStream(
    kv: KVNamespace,
    key: string,
    cacheTtl?: number
): Promise<ReadableStream<Uint8Array> | null> {
    return (await kv.get(key, { type: "stream", cacheTtl })) as ReadableStream<Uint8Array> | null;
}
