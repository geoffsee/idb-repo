import { describe, it, expect } from "bun:test";
import { IndexedDbConnection } from "./connection";

describe("IndexedDbConnection", () => {
    it("creates a new connection", () => {
        const conn = new IndexedDbConnection({
            dbName: "test-db",
            storeName: "test-store",
            version: 1,
        });
        expect(conn).toBeInstanceOf(IndexedDbConnection);
    });

    it("exposes db getter", () => {
        const conn = new IndexedDbConnection({
            dbName: "test-db",
            storeName: "test-store",
            version: 1,
        });
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(conn), "db");
        expect(descriptor?.get).toBeDefined();
    });

    it("can be constructed with various configs", () => {
        const configs = [
            { dbName: "db1", storeName: "store1", version: 1 },
            { dbName: "db2", storeName: "store2", version: 5 },
        ];

        configs.forEach((cfg) => {
            const conn = new IndexedDbConnection(cfg);
            expect(conn).toBeInstanceOf(IndexedDbConnection);
        });
    });

    it("has a close method", () => {
        const conn = new IndexedDbConnection({
            dbName: "test-db",
            storeName: "test-store",
            version: 1,
        });
        expect(typeof conn.close).toBe("function");
    });
});
