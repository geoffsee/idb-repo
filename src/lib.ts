/**
 * Public API facade for IndexedDB KV storage
 * Re-exports main classes and functions for backward compatibility
 */

export {
    IndexedDbKV,
    createIndexedDbKV,
    createKV,
    kvGetText,
    kvGetJson,
    kvGetArrayBuffer,
    kvGetStream,
} from "./kv";
