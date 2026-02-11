import { describe, it, expect } from "bun:test";
import { encodeCursor, decodeCursor } from "./cursor";

describe("cursor", () => {
  describe("encodeCursor/decodeCursor", () => {
    it("round-trips valid cursor", () => {
      const original = { v: 1 as const, prefix: "user:", after: "user:123" };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });

    it("round-trips cursor with null after", () => {
      const original = { v: 1 as const, prefix: "docs:", after: null };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });

    it("round-trips cursor with empty prefix", () => {
      const original = { v: 1 as const, prefix: "", after: "key123" };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });

    it("handles unicode in prefix", () => {
      const original = { v: 1 as const, prefix: "キー:", after: "キー:123" };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });

    it("handles special characters in after", () => {
      const original = {
        v: 1 as const,
        prefix: "",
        after: "key/with:special-chars_123",
      };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });

    it("returns null for invalid base64", () => {
      expect(decodeCursor("!!!invalid!!!")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const b64 = btoa("not json");
      expect(decodeCursor(b64)).toBeNull();
    });

    it("returns null for wrong version", () => {
      const invalid = { v: 2, prefix: "test:", after: "test:1" };
      const encoded = btoa(JSON.stringify(invalid));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it("returns null for missing prefix field", () => {
      const invalid = { v: 1, after: "test:1" };
      const encoded = btoa(JSON.stringify(invalid));
      expect(decodeCursor(encoded)).toBeNull();
    });
  });
});
