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

/**
 * Universal KV that picks the best storage for the environment
 */
export function createKV(opts?: ConstructorParameters<typeof IndexedDbKV>[0] & { forceMemory?: boolean }): KVNamespace {
    const isBrowser = typeof indexedDB !== "undefined";
    
    if (opts?.forceMemory) {
        return new KVStorageAdapter(new MemoryStorageBackend(), opts);
    }

    if (isBrowser) {
        return new IndexedDbKV(opts);
    }
    
    // Node.js environment
    try {
        // Use NodeFileSystemStorageBackend for persistence in Node
        // We use a "require" or dynamic import approach that works in Bun/Node
        // but can be optimized out or ignored in browser builds.
        const { NodeFileSystemStorageBackend } = require("./storage-backend-node");
        return new KVStorageAdapter(new NodeFileSystemStorageBackend(opts), opts);
    } catch (e) {
        // Fallback to memory if persistence fails or is unavailable
        return new KVStorageAdapter(new MemoryStorageBackend(), opts);
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
