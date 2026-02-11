import { describe, it, expect } from "bun:test";
import { KVStorageAdapter } from "./storage-adapter";
import { MemoryStorageBackend } from "./storage-backend";
import { kvGetText, kvGetJson } from "./kv";
import { BaseEncryptionProvider } from "./encryption/encryption-provider";

class TestEncryptionProvider extends BaseEncryptionProvider {
  readonly providerId = "test-provider";

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const out = new Uint8Array(plaintext.length);
    for (let i = 0; i < plaintext.length; i++) {
      out[i] = (plaintext[i] ?? 0) ^ 0xaa;
    }
    return out;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.encrypt(ciphertext);
  }
}

describe("KVStorageAdapter with MemoryStorageBackend", () => {
  it("can put and get text", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    await kv.put("test-key", "hello world");
    const val = await kv.get("test-key", { type: "text" });
    expect(val).toBe("hello world");
  });

  it("can put and get JSON", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    const data = { foo: "bar", num: 42 };
    await kv.put("json-key", data);
    const val = await kv.get("json-key", { type: "json" });
    expect(val).toEqual(data);
  });

  it("handles TTL correctly", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    await kv.put("ttl-key", "temporary", { expirationTtl: 1 });
    const val = await kv.get("ttl-key");
    expect(val).toBe("temporary");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const expiredVal = await kv.get("ttl-key");
    expect(expiredVal).toBeNull();
  });

  it("lists keys with prefix", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    await kv.put("a/1", "val1");
    await kv.put("a/2", "val2");
    await kv.put("b/1", "val3");

    const result = await kv.list({ prefix: "a/" });
    expect(result.keys.length).toBe(2);
    expect(result.keys.map((k) => k.name)).toContain("a/1");
    expect(result.keys.map((k) => k.name)).toContain("a/2");
    expect(result.list_complete).toBe(true);
  });

  it("handles pagination with cursor", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    for (let i = 0; i < 10; i++) {
      await kv.put(`key/${i}`, `value ${i}`);
    }

    const page1 = await kv.list({ limit: 4 });
    expect(page1.keys.length).toBe(4);
    expect(page1.list_complete).toBe(false);
    expect(page1.cursor).toBeDefined();

    const page2 = await kv.list({ limit: 4, cursor: page1.cursor });
    expect(page2.keys.length).toBe(4);
    expect(page2.list_complete).toBe(false);

    const page3 = await kv.list({ limit: 4, cursor: page2.cursor });
    expect(page3.keys.length).toBe(2);
    expect(page3.list_complete).toBe(true);
  });

  it("works with helper functions", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend);

    await kv.put("text", "some text");
    const textValue = await kvGetText(kv, "text");
    expect(textValue).toBe("some text");

    await kv.put("json", { a: 1 });
    const jsonValue = await kvGetJson<{ a: number }>(kv, "json");
    expect(jsonValue).toEqual({ a: 1 });
  });

  it("supports pluggable encryption providers via BaseEncryptionProvider", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend, {
      encryptionProvider: new TestEncryptionProvider(),
    });

    await kv.put("secret", "top-secret-value");

    const raw = await backend.get("secret");
    expect(raw?.encoding).toBe("binary");
    const rawText = await (raw?.value as Blob).text();
    expect(rawText).not.toContain("top-secret-value");

    const decrypted = await kv.get("secret", { type: "text" });
    expect(decrypted).toBe("top-secret-value");
  });

  it("round-trips JSON values with encryption enabled", async () => {
    const backend = new MemoryStorageBackend();
    const kv = new KVStorageAdapter(backend, {
      encryptionProvider: new TestEncryptionProvider(),
    });

    const input = { team: "idb-repo", year: 2026 };
    await kv.put("json-secret", input);
    const output = await kv.get("json-secret", { type: "json" });
    expect(output).toEqual(input);
  });
});
