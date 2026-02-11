import { describe, it, expect } from "bun:test";
import { TinyLRU } from "./cache";
import { nowMs } from "../time-utils";

describe("TinyLRU", () => {
  it("stores and retrieves values", () => {
    const cache = new TinyLRU(10);
    cache.set("key1", "value1", { foo: "bar" }, 60);
    const hit = cache.get("key1");
    expect(hit).toEqual({ value: "value1", meta: { foo: "bar" } });
  });

  it("returns null for missing keys", () => {
    const cache = new TinyLRU(10);
    const hit = cache.get("missing");
    expect(hit).toBeNull();
  });

  it("returns null for expired entries", (done) => {
    const cache = new TinyLRU(10);
    cache.set("key1", "value1", null, 0); // 0 second TTL
    setTimeout(() => {
      const hit = cache.get("key1");
      expect(hit).toBeNull();
      done();
    }, 50);
  });

  it("deletes keys", () => {
    const cache = new TinyLRU(10);
    cache.set("key1", "value1", null, 60);
    cache.delete("key1");
    const hit = cache.get("key1");
    expect(hit).toBeNull();
  });

  it("clears all entries", () => {
    const cache = new TinyLRU(10);
    cache.set("key1", "value1", null, 60);
    cache.set("key2", "value2", null, 60);
    cache.clear();
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBeNull();
  });

  it("respects max size limit", () => {
    const cache = new TinyLRU(3);
    cache.set("key1", "value1", null, 60);
    cache.set("key2", "value2", null, 60);
    cache.set("key3", "value3", null, 60);
    cache.set("key4", "value4", null, 60); // Exceeds limit
    // Oldest entry should be evicted
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key4")).not.toBeNull();
  });

  it("handles zero max entries", () => {
    const cache = new TinyLRU(0);
    cache.set("key1", "value1", null, 60);
    const hit = cache.get("key1");
    expect(hit).toBeNull(); // Cache disabled
  });

  it("handles negative max entries as zero", () => {
    const cache = new TinyLRU(-5);
    cache.set("key1", "value1", null, 60);
    const hit = cache.get("key1");
    expect(hit).toBeNull(); // Cache disabled
  });

  it("stores and retrieves metadata", () => {
    const cache = new TinyLRU(10);
    const meta = { created: 123, user: "test" };
    cache.set("key1", "value1", meta, 60);
    const hit = cache.get("key1");
    expect(hit?.meta).toEqual(meta);
  });

  it("handles various value types", () => {
    const cache = new TinyLRU(20);
    const values = [
      "string",
      123,
      { obj: "value" },
      [1, 2, 3],
      true,
      null,
      undefined,
    ];
    values.forEach((val, i) => {
      cache.set(`key${i}`, val, null, 60);
      const hit = cache.get(`key${i}`);
      expect(hit?.value).toEqual(val);
    });
  });
});
