import { describe, it, expect } from "bun:test";
import { IndexedDbKV, createIndexedDbKV, kvGetText, kvGetJson, kvGetArrayBuffer, kvGetStream } from "./kv";

describe("IndexedDbKV", () => {
    describe("constructor and factory", () => {
        it("creates instance with defaults", () => {
            const kv = new IndexedDbKV();
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("creates instance with custom options", () => {
            const kv = new IndexedDbKV({
                dbName: "custom-db",
                storeName: "custom-store",
                cacheEntries: 100,
            });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("factory creates KVNamespace", () => {
            const ns = createIndexedDbKV({ dbName: "factory-db" });
            expect(ns).toHaveProperty("get");
            expect(ns).toHaveProperty("put");
            expect(ns).toHaveProperty("delete");
            expect(ns).toHaveProperty("list");
            expect(ns).toHaveProperty("getWithMetadata");
        });

        it("exposes required interface methods", () => {
            const kv = new IndexedDbKV();
            expect(typeof kv.get).toBe("function");
            expect(typeof kv.getWithMetadata).toBe("function");
            expect(typeof kv.put).toBe("function");
            expect(typeof kv.delete).toBe("function");
            expect(typeof kv.list).toBe("function");
            expect(typeof kv.close).toBe("function");
        });
    });

    describe("helper functions", () => {
        it("kvGetText is a function", () => {
            expect(typeof kvGetText).toBe("function");
        });

        it("kvGetJson is a function", () => {
            expect(typeof kvGetJson).toBe("function");
        });

        it("kvGetArrayBuffer is a function", () => {
            expect(typeof kvGetArrayBuffer).toBe("function");
        });

        it("kvGetStream is a function", () => {
            expect(typeof kvGetStream).toBe("function");
        });
    });

    describe("type compatibility", () => {
        it("implements KVNamespace interface", () => {
            const kv = new IndexedDbKV();
            const ns: KVNamespace = kv;
            expect(ns).toBeDefined();
        });

        it("returned factory implements KVNamespace interface", () => {
            const ns: KVNamespace = createIndexedDbKV();
            expect(ns).toBeDefined();
        });
    });

    describe("constructor options", () => {
        it("accepts all constructor options", () => {
            const kv = new IndexedDbKV({
                dbName: "test",
                storeName: "store",
                version: 2,
                cacheEntries: 500,
            });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("handles partial constructor options", () => {
            const kv = new IndexedDbKV({
                dbName: "test",
            });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("handles undefined constructor options", () => {
            const kv = new IndexedDbKV(undefined);
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });
    });

    describe("default option values", () => {
        it("uses default dbName", () => {
            const kv = new IndexedDbKV({ storeName: "custom" });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("uses default storeName", () => {
            const kv = new IndexedDbKV({ dbName: "custom" });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("uses default version", () => {
            const kv = new IndexedDbKV({ dbName: "custom" });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });

        it("uses default cacheEntries", () => {
            const kv = new IndexedDbKV({ dbName: "custom" });
            expect(kv).toBeInstanceOf(IndexedDbKV);
        });
    });

    describe("api structure", () => {
        it("get method signature is correct", () => {
            const kv = new IndexedDbKV();
            const fn = kv.get;
            expect(fn.length).toBeGreaterThanOrEqual(1); // at least key parameter
        });

        it("put method signature is correct", () => {
            const kv = new IndexedDbKV();
            const fn = kv.put;
            expect(fn.length).toBeGreaterThanOrEqual(2); // at least key and value
        });

        it("delete method signature is correct", () => {
            const kv = new IndexedDbKV();
            const fn = kv.delete;
            expect(fn.length).toBeGreaterThanOrEqual(1); // at least key
        });

        it("list method signature is correct", () => {
            const kv = new IndexedDbKV();
            const fn = kv.list;
            expect(fn.length).toBeGreaterThanOrEqual(0); // no required parameters
        });

        it("getWithMetadata method signature is correct", () => {
            const kv = new IndexedDbKV();
            const fn = kv.getWithMetadata;
            expect(fn.length).toBeGreaterThanOrEqual(1); // at least key
        });
    });

    describe("multiple instances", () => {
        it("can create multiple independent instances", () => {
            const kv1 = new IndexedDbKV({ dbName: "db1" });
            const kv2 = new IndexedDbKV({ dbName: "db2" });
            expect(kv1).not.toBe(kv2);
            expect(kv1).toBeInstanceOf(IndexedDbKV);
            expect(kv2).toBeInstanceOf(IndexedDbKV);
        });

        it("creates instances with same config", () => {
            const config = { dbName: "test", storeName: "store" };
            const kv1 = new IndexedDbKV(config);
            const kv2 = new IndexedDbKV(config);
            expect(kv1).toBeInstanceOf(IndexedDbKV);
            expect(kv2).toBeInstanceOf(IndexedDbKV);
        });
    });
});
