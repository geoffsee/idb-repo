export {
    IndexedDbKV,
    createIndexedDbKV,
    kvGetText,
    kvGetJson,
    kvGetArrayBuffer,
    kvGetStream,
} from "./src/lib";

export { KVStorageAdapter } from "./src/storage-adapter";
export { MemoryStorageBackend, IndexedDbStorageBackend } from "./src/storage-backend";
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
