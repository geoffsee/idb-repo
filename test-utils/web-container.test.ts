// Tell TypeScript where to find the types for bun:test
/// <reference types="bun" />
import { it, expect, describe, afterAll, beforeAll } from "bun:test";
import { WebContainer } from "./web-container";

describe("WebContainer", () => {
  let container: WebContainer | null = null;

  beforeAll(async () => {
    container = await WebContainer.create({ headless: true });
  });

  afterAll(async () => {
    await container?.close();
    container = null;
  });

  it("should start without crashing", () => {
    expect(container!.ready).toBeTrue();
  });

  it("should expose IndexedDB", async () => {
    expect(container!.indexedDB).toBeDefined();

    await container!.indexedDB.set("kv", "hello", { x: 1 });
    const v = await container!.indexedDB.get<{ x: number }>("kv", "hello");
    expect(v?.x).toBe(1);
  });
});
