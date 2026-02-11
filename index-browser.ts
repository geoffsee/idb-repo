import { 
    IndexedDbKV,
    KVStorageAdapter,
    MemoryStorageBackend
} from "./index";
import type { KVNamespace } from "./index";

export * from "./index";

/**
 * Universal KV for Browser - defaults to IndexedDB
 */
export function createKV(opts?: ConstructorParameters<typeof IndexedDbKV>[0] & { forceMemory?: boolean }): KVNamespace {
    if (opts?.forceMemory) {
        return new KVStorageAdapter(new MemoryStorageBackend(), opts);
    }
    return new IndexedDbKV(opts);
}
