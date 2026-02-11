/**
 * IndexedDbKV: High-performance KV over IndexedDB
 */

import type { KVGetOptions, KVListOptions, KVListResult, KVNamespace, KVPutOptions, KVValue } from "./types";
import { KVStorageAdapter } from "./storage-adapter";
import { IndexedDbStorageBackend, MemoryStorageBackend } from "./storage-backend";

/**
 * High-performance KV implementation over IndexedDB
 */
export class IndexedDbKV extends KVStorageAdapter {
    constructor(opts?: {
        dbName?: string;
        storeName?: string;
        version?: number;
        cacheEntries?: number;
    }) {
        const backend = new IndexedDbStorageBackend(opts);
        super(backend, opts);
    }
}

export function createIndexedDbKV(opts?: {
    dbName?: string;
    storeName?: string;
    version?: number;
    cacheEntries?: number;
}): KVNamespace {
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

type CreateKVOptions = ConstructorParameters<typeof IndexedDbKV>[0] & { forceMemory?: boolean };

function adapterOptions(opts?: CreateKVOptions) {
    return { cacheEntries: opts?.cacheEntries };
}

export function createKV(opts?: CreateKVOptions): KVNamespace {
    if (opts?.forceMemory) {
        return new KVStorageAdapter(new MemoryStorageBackend(), adapterOptions(opts));
    }

    if (typeof globalThis.indexedDB === "undefined") {
        return new KVStorageAdapter(new MemoryStorageBackend(), adapterOptions(opts));
    }

    return new IndexedDbKV(opts);
}
