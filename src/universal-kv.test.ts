import { describe, it, expect } from "bun:test";
import { createKV, IndexedDbKV } from "./kv";
import { KVStorageAdapter } from "./storage-adapter";

describe("createKV factory", () => {
  it("creates a Memory-backed KV when forced", async () => {
    const kv = createKV({ forceMemory: true });
    expect(kv).toBeInstanceOf(KVStorageAdapter);
    // It's not an IndexedDbKV because we forced memory
    expect(kv).not.toBeInstanceOf(IndexedDbKV);

    await kv.put("key", "value");
    expect(await kv.get("key")).toBe("value");
  });

  it("creates a Memory-backed KV when indexedDB is missing", async () => {
    // Mock indexedDB being undefined
    const oldIDB = globalThis.indexedDB;
    // @ts-ignore
    delete globalThis.indexedDB;

    try {
      const kv = createKV();
      expect(kv).toBeInstanceOf(KVStorageAdapter);
      expect(kv).not.toBeInstanceOf(IndexedDbKV);
    } finally {
      globalThis.indexedDB = oldIDB;
    }
  });
});
