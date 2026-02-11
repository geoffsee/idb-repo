import { 
    IndexedDbKV,
    KVNamespace,
    KVStorageAdapter,
    MemoryStorageBackend
} from "./index";
import { NodeFileSystemStorageBackend } from "./src/storage-backend-node";

export * from "./index";
export { NodeFileSystemStorageBackend };

/**
 * Universal KV for Node.js - defaults to FileSystem
 */
export function createKV(opts?: ConstructorParameters<typeof IndexedDbKV>[0] & { forceMemory?: boolean }): KVNamespace {
    if (opts?.forceMemory) {
        return new KVStorageAdapter(new MemoryStorageBackend(), opts);
    }
    return new KVStorageAdapter(new NodeFileSystemStorageBackend(opts), opts);
}
