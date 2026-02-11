import { describe, it, expect } from "bun:test";
import { computeExpiresAtMs, isExpired } from "./ttl";
import { nowMs } from "../time-utils";

describe("ttl", () => {
  describe("computeExpiresAtMs", () => {
    it("returns null when no options", () => {
      const result = computeExpiresAtMs();
      expect(result).toBeNull();
    });

    it("returns null when options is empty object", () => {
      const result = computeExpiresAtMs({});
      expect(result).toBeNull();
    });

    it("computes expiration from expirationTtl", () => {
      const before = nowMs();
      const result = computeExpiresAtMs({ expirationTtl: 60 });
      const after = nowMs();
      expect(result).toBeDefined();
      expect(result).toBeGreaterThanOrEqual(before + 60000);
      expect(result).toBeLessThanOrEqual(after + 60000);
    });

    it("handles zero expirationTtl", () => {
      const before = nowMs();
      const result = computeExpiresAtMs({ expirationTtl: 0 });
      const after = nowMs();
      expect(result).toBeDefined();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("handles negative expirationTtl as 0", () => {
      const before = nowMs();
      const result = computeExpiresAtMs({ expirationTtl: -100 });
      const after = nowMs();
      expect(result).toBeDefined();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("computes expiration from epoch seconds", () => {
      const epochSeconds = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const result = computeExpiresAtMs({ expiration: epochSeconds });
      const expected = epochSeconds * 1000;
      expect(result).toBe(expected);
    });

    it("prefers expirationTtl over expiration", () => {
      const before = nowMs();
      const result = computeExpiresAtMs({
        expirationTtl: 60,
        expiration: Math.floor(before / 1000) + 3600,
      });
      const after = nowMs();
      // Should use expirationTtl (60 seconds from now)
      expect(result).toBeGreaterThanOrEqual(before + 60000);
      expect(result).toBeLessThanOrEqual(after + 60000);
    });

    it("handles large TTL values", () => {
      const before = nowMs();
      const result = computeExpiresAtMs({ expirationTtl: 86400 * 365 }); // 1 year
      const after = nowMs();
      const oneYear = 86400 * 365 * 1000;
      expect(result).toBeGreaterThanOrEqual(before + oneYear);
      expect(result).toBeLessThanOrEqual(after + oneYear);
    });
  });

  describe("isExpired", () => {
    it("returns false when expiresAt is null", () => {
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: null,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(false);
    });

    it("returns false for future expiration", () => {
      const future = nowMs() + 60000; // 1 minute from now
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: future,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(false);
    });

    it("returns true for past expiration", () => {
      const past = nowMs() - 1000; // 1 second ago
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: past,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(true);
    });

    it("returns true at exact expiration time", () => {
      const now = nowMs();
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: now,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(true);
    });

    it("handles very old expiration", () => {
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: 1,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(true);
    });

    it("handles far future expiration", () => {
      const rec = {
        key: "test",
        value: "data",
        encoding: "text" as const,
        expiresAt: Number.MAX_SAFE_INTEGER,
        metadata: null,
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isExpired(rec)).toBe(false);
    });
  });
});
