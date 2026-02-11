import { describe, it, expect } from "bun:test";
import { isArrayBufferView, assertKey } from "./validation";

describe("validation", () => {
  describe("isArrayBufferView", () => {
    it("returns true for Uint8Array", () => {
      expect(isArrayBufferView(new Uint8Array(10))).toBe(true);
    });

    it("returns true for Int32Array", () => {
      expect(isArrayBufferView(new Int32Array(5))).toBe(true);
    });

    it("returns true for DataView", () => {
      const buf = new ArrayBuffer(16);
      expect(isArrayBufferView(new DataView(buf))).toBe(true);
    });

    it("returns false for ArrayBuffer", () => {
      expect(isArrayBufferView(new ArrayBuffer(10))).toBe(false);
    });

    it("returns false for string", () => {
      expect(isArrayBufferView("hello")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isArrayBufferView(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isArrayBufferView(undefined)).toBe(false);
    });

    it("returns false for plain object", () => {
      expect(isArrayBufferView({})).toBe(false);
    });

    it("returns false for Blob", () => {
      expect(isArrayBufferView(new Blob())).toBe(false);
    });

    it("returns false for ReadableStream", () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      expect(isArrayBufferView(stream)).toBe(false);
    });
  });

  describe("assertKey", () => {
    it("accepts non-empty string", () => {
      expect(() => assertKey("valid-key")).not.toThrow();
    });

    it("rejects empty string", () => {
      expect(() => assertKey("")).toThrow(TypeError);
    });

    it("rejects non-string", () => {
      expect(() => assertKey(123 as any)).toThrow(TypeError);
    });

    it("rejects null", () => {
      expect(() => assertKey(null as any)).toThrow(TypeError);
    });

    it("rejects undefined", () => {
      expect(() => assertKey(undefined as any)).toThrow(TypeError);
    });

    it("accepts string with special characters", () => {
      expect(() => assertKey("key:with/special-chars_123")).not.toThrow();
    });

    it("accepts single character", () => {
      expect(() => assertKey("a")).not.toThrow();
    });

    it("accepts long string", () => {
      expect(() => assertKey("a".repeat(10000))).not.toThrow();
    });

    it("accepts unicode string", () => {
      expect(() => assertKey("key_日本語_🚀")).not.toThrow();
    });

    it("rejects object", () => {
      expect(() => assertKey({} as any)).toThrow(TypeError);
    });
  });
});
