import { describe, it, expect } from "bun:test";
import { NodeFileSystemStorageBackend } from "./storage-backend-node";
import { KVStorageAdapter } from "./storage-adapter";
import fsp from "node:fs/promises";
import path from "node:path";

describe("NodeFileSystemStorageBackend Persistence", () => {
  const testDir = "test-kv-data";

  it("persists data across restarts", async () => {
    // Cleanup
    await fsp.rm(testDir, { recursive: true, force: true });

    // First session
    {
      const backend = new NodeFileSystemStorageBackend({ dir: testDir });
      const kv = new KVStorageAdapter(backend);
      await kv.put("persistent-key", "I survived!");
      await kv.put("json-key", { a: 1 });
      await kv.close();
    }

    // Second session
    {
      const backend = new NodeFileSystemStorageBackend({ dir: testDir });
      const kv = new KVStorageAdapter(backend);

      const val = await kv.get("persistent-key");
      expect(val).toBe("I survived!");

      const jsonVal = await kv.get("json-key", { type: "json" });
      expect(jsonVal).toEqual({ a: 1 });

      await kv.close();
    }
  });

  it("handles deletions permanently", async () => {
    const backend = new NodeFileSystemStorageBackend({ dir: testDir });
    const kv = new KVStorageAdapter(backend);

    await kv.put("to-delete", "gone");
    await kv.delete("to-delete");
    expect(await kv.get("to-delete")).toBeNull();

    await kv.close();

    // Re-open
    const backend2 = new NodeFileSystemStorageBackend({ dir: testDir });
    const kv2 = new KVStorageAdapter(backend2);
    expect(await kv2.get("to-delete")).toBeNull();
    await kv2.close();
  });

  it("lists keys correctly after recovery", async () => {
    const backend = new NodeFileSystemStorageBackend({ dir: testDir });
    const kv = new KVStorageAdapter(backend);

    await kv.put("p/1", "v1");
    await kv.put("p/2", "v2");
    await kv.close();

    const backend2 = new NodeFileSystemStorageBackend({ dir: testDir });
    const kv2 = new KVStorageAdapter(backend2);
    const result = await kv2.list({ prefix: "p/" });
    expect(result.keys.length).toBe(2);
    expect(result.keys.map((k) => k.name)).toContain("p/1");
    expect(result.keys.map((k) => k.name)).toContain("p/2");
    await kv2.close();
  });
});
