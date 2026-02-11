export {
  createKV,
  IndexedDbKV,
  createIndexedDbKV,
  kvGetText,
  kvGetJson,
  kvGetArrayBuffer,
  kvGetStream,
} from "./src/lib";

export { KVStorageAdapter } from "./src/storage-adapter";
export {
  MemoryStorageBackend,
  IndexedDbStorageBackend,
} from "./src/storage-backend";
export type { StorageBackend } from "./src/storage-backend";

export { BaseEncryptionProvider } from "./src/encryption/encryption-provider";

export {
  WebCryptoEncryptionProvider,
  PassphraseEncryptionProvider,
} from "./src/encryption/web/web-provider";

export { WasmMlKemProvider } from "./src/encryption/wasm/wasm-provider";

// Key management utilities
export {
  LocalStorageKeyManager,
  KeySerializer,
  BackendKeyManager,
} from "./src/encryption/key-management";

export type {
  StoredAESKey,
  StoredPBKDF2Salt,
  StoredMLKEMKeys,
  StoredKey,
} from "./src/encryption/key-management";

// Re-export types for convenience
export type {
  KVGetOptions,
  KVPutOptions,
  KVListOptions,
  KVListKey,
  KVListResult,
  KVNamespace,
} from "./src/types";
