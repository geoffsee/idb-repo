/**
 * IndexedDB KV Storage - A performant KV storage implementation using IndexedDB
 *
 * @example
 * ```ts
 * import { createIndexedDbKV } from '@indexeddb-kv/storage';
 *
 * const kv = await createIndexedDbKV({ dbName: 'my-app' });
 * await kv.put('key', 'value');
 * const value = await kv.get('key');
 * ```
 */

export {
    IndexedDbKV,
    createIndexedDbKV,
    createKV,
    kvGetText,
    kvGetJson,
    kvGetArrayBuffer,
    kvGetStream,
} from "./src/lib";

export { KVStorageAdapter } from "./src/storage-adapter";
export { MemoryStorageBackend, IndexedDbStorageBackend } from "./src/storage-backend";
export { NodeFileSystemStorageBackend } from "./src/storage-backend-node";
export type { StorageBackend } from "./src/storage-backend";

// Re-export types for convenience
export type {
    KVGetOptions,
    KVPutOptions,
    KVListOptions,
    KVListKey,
    KVListResult,
    KVNamespace,
} from "./src/types";
