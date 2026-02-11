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

export { 
    BaseEncryptionProvider, 
    WebCryptoEncryptionProvider, 
    PassphraseEncryptionProvider 
} from "./src/encryption/encryption-provider";

// Re-export types for convenience
export type {
    KVGetOptions,
    KVPutOptions,
    KVListOptions,
    KVListKey,
    KVListResult,
    KVNamespace,
} from "./src/types";
