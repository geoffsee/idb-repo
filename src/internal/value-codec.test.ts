import { describe, it, expect } from "bun:test";
import { normalizePutValueSync, normalizePutValue, decodeValue, blobToText, blobToArrayBuffer, blobToJson } from "./value-codec";

describe("value-codec", () => {
    describe("normalizePutValueSync", () => {
        it("encodes string as text", () => {
            const result = normalizePutValueSync("hello");
            expect(result).toEqual({ encoding: "text", stored: "hello" });
        });

        it("encodes Blob as binary", () => {
            const blob = new Blob(["data"]);
            const result = normalizePutValueSync(blob);
            expect(result?.encoding).toBe("binary");
            expect(result?.stored).toBeInstanceOf(Blob);
        });

        it("encodes ArrayBuffer as binary blob", () => {
            const buffer = new ArrayBuffer(4);
            const result = normalizePutValueSync(buffer);
            expect(result?.encoding).toBe("binary");
            expect(result?.stored).toBeInstanceOf(Blob);
        });

        it("encodes Uint8Array as binary blob", () => {
            const arr = new Uint8Array([1, 2, 3]);
            const result = normalizePutValueSync(arr);
            expect(result?.encoding).toBe("binary");
            expect(result?.stored).toBeInstanceOf(Blob);
        });

        it("encodes DataView as binary blob", () => {
            const buffer = new ArrayBuffer(8);
            const view = new DataView(buffer);
            const result = normalizePutValueSync(view);
            expect(result?.encoding).toBe("binary");
            expect(result?.stored).toBeInstanceOf(Blob);
        });

        it("returns null for ReadableStream (requires async)", () => {
            const stream = new ReadableStream({
                start(controller) {
                    controller.close();
                },
            });
            const result = normalizePutValueSync(stream);
            expect(result).toBeNull();
        });

        it("encodes object as structured clone", () => {
            const obj = { foo: "bar", num: 42 };
            const result = normalizePutValueSync(obj);
            expect(result?.encoding).toBe("clone");
            expect(result?.stored).toEqual(obj);
        });

        it("encodes array as structured clone", () => {
            const arr = [1, 2, 3];
            const result = normalizePutValueSync(arr);
            expect(result?.encoding).toBe("clone");
            expect(result?.stored).toEqual(arr);
        });

        it("encodes null as structured clone", () => {
            const result = normalizePutValueSync(null);
            expect(result?.encoding).toBe("clone");
            expect(result?.stored).toBeNull();
        });

        it("encodes boolean as structured clone", () => {
            const result = normalizePutValueSync(true);
            expect(result?.encoding).toBe("clone");
            expect(result?.stored).toBe(true);
        });

        it("encodes number as structured clone", () => {
            const result = normalizePutValueSync(42);
            expect(result?.encoding).toBe("clone");
            expect(result?.stored).toBe(42);
        });
    });

    describe("normalizePutValue", () => {
        it("encodes string synchronously", async () => {
            const result = await normalizePutValue("hello");
            expect(result).toEqual({ encoding: "text", stored: "hello" });
        });

        it("encodes ReadableStream as binary blob", async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });
            const result = await normalizePutValue(stream);
            expect(result.encoding).toBe("binary");
            expect(result.stored).toBeInstanceOf(Blob);
        });

        it("encodes object as structured clone", async () => {
            const obj = { foo: "bar" };
            const result = await normalizePutValue(obj);
            expect(result).toEqual({ encoding: "clone", stored: obj });
        });
    });

    describe("decodeValue", () => {
        it("decodes text to text", () => {
            const rec = {
                encoding: "text" as const,
                value: "hello",
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "text");
            expect(result).toBe("hello");
        });

        it("decodes text as json", () => {
            const rec = {
                encoding: "text" as const,
                value: '{"foo":"bar"}',
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "json");
            expect(result).toEqual({ foo: "bar" });
        });

        it("decodes text as arrayBuffer", () => {
            const rec = {
                encoding: "text" as const,
                value: "hello",
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "arrayBuffer");
            expect(result).toBeInstanceOf(ArrayBuffer);
        });

        it("decodes text as stream", () => {
            const rec = {
                encoding: "text" as const,
                value: "hello",
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "stream");
            expect(result).toBeInstanceOf(ReadableStream);
        });

        it("decodes json to json", () => {
            const rec = {
                encoding: "json" as const,
                value: '{"foo":"bar"}',
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "json");
            expect(result).toEqual({ foo: "bar" });
        });

        it("decodes json as text", () => {
            const rec = {
                encoding: "json" as const,
                value: '{"foo":"bar"}',
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "text");
            expect(result).toBe('{"foo":"bar"}');
        });

        it("decodes clone to json", () => {
            const obj = { foo: "bar", num: 42 };
            const rec = {
                encoding: "clone" as const,
                value: obj,
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "json");
            expect(result).toEqual(obj);
        });

        it("decodes clone as text", () => {
            const obj = { foo: "bar" };
            const rec = {
                encoding: "clone" as const,
                value: obj,
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "text");
            expect(result).toBe('{"foo":"bar"}');
        });

        it("defaults to text when type not specified", () => {
            const rec = {
                encoding: "text" as const,
                value: "hello",
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, undefined);
            expect(result).toBe("hello");
        });

        it("returns blob sentinel for binary stream", () => {
            const blob = new Blob(["data"]);
            const rec = {
                encoding: "binary" as const,
                value: blob,
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "stream");
            expect(result).toBeInstanceOf(ReadableStream);
        });

        it("returns blob sentinel for binary arrayBuffer", () => {
            const blob = new Blob(["data"]);
            const rec = {
                encoding: "binary" as const,
                value: blob,
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            const result = decodeValue(rec, "arrayBuffer");
            expect(result).toBeInstanceOf(Blob);
        });

        it("throws for clone that can't be JSON stringified", () => {
            const circularObj = { a: 1 } as any;
            circularObj.self = circularObj; // circular reference
            const rec = {
                encoding: "clone" as const,
                value: circularObj,
                expiresAt: null,
                metadata: null,
                key: "test",
                createdAt: 0,
                updatedAt: 0,
            };
            expect(() => decodeValue(rec, "text")).toThrow();
        });
    });

    describe("blob conversion helpers", () => {
        it("blobToText converts blob to string", async () => {
            const blob = new Blob(["hello world"]);
            const result = await blobToText(blob);
            expect(result).toBe("hello world");
        });

        it("blobToArrayBuffer converts blob to ArrayBuffer", async () => {
            const blob = new Blob([new Uint8Array([1, 2, 3])]);
            const result = await blobToArrayBuffer(blob);
            expect(result).toBeInstanceOf(ArrayBuffer);
        });

        it("blobToJson converts blob to parsed JSON", async () => {
            const blob = new Blob(['{"foo":"bar"}']);
            const result = await blobToJson(blob);
            expect(result).toEqual({ foo: "bar" });
        });

        it("blobToJson throws on invalid JSON", async () => {
            const blob = new Blob(["not json"]);
            await expect(blobToJson(blob)).rejects.toThrow();
        });
    });
});
