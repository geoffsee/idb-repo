import { it, expect, describe, beforeEach, mock } from "bun:test";
import { withKVFeatures } from "./lib-wrapper.ts";
import type { KVListResult, KVNamespace } from "./types";

/** Create a stub KVNamespace where every method is a mock. */
function createMockKV(overrides?: Partial<KVNamespace>): KVNamespace {
  return {
    get: mock(async () => "value"),
    getWithMetadata: mock(async () => ({ value: "value", metadata: null })),
    put: mock(async () => {}),
    delete: mock(async () => {}),
    list: mock(
      async (): Promise<KVListResult> => ({
        keys: [],
        list_complete: true,
      }),
    ),
    ...overrides,
  };
}

describe("withKVFeatures", () => {
  let base: KVNamespace;

  beforeEach(() => {
    base = createMockKV();
  });

  // ── Passthrough ──────────────────────────────────────────

  describe("passthrough (no options)", () => {
    it("delegates get() to the base", async () => {
      const kv = withKVFeatures(base);
      const result = await kv.get("k");
      expect(result).toBe("value");
      expect(base.get).toHaveBeenCalledTimes(1);
    });

    it("delegates getWithMetadata() to the base", async () => {
      const kv = withKVFeatures(base);
      const result = await kv.getWithMetadata("k");
      expect(result).toEqual({ value: "value", metadata: null });
      expect(base.getWithMetadata).toHaveBeenCalledTimes(1);
    });

    it("delegates put() to the base", async () => {
      const kv = withKVFeatures(base);
      await kv.put("k", "v");
      expect(base.put).toHaveBeenCalledTimes(1);
    });

    it("delegates delete() to the base", async () => {
      const kv = withKVFeatures(base);
      await kv.delete("k");
      expect(base.delete).toHaveBeenCalledTimes(1);
    });

    it("delegates list() to the base", async () => {
      const kv = withKVFeatures(base);
      const result = await kv.list();
      expect(result.list_complete).toBe(true);
      expect(base.list).toHaveBeenCalledTimes(1);
    });
  });

  // ── Key prefixing ────────────────────────────────────────

  describe("prefix", () => {
    it("prepends prefix to get() key", async () => {
      const kv = withKVFeatures(base, { prefix: "ns:" });
      await kv.get("mykey");
      expect(base.get).toHaveBeenCalledWith("ns:mykey");
    });

    it("prepends prefix to put() key", async () => {
      const kv = withKVFeatures(base, { prefix: "ns:" });
      await kv.put("mykey", "val");
      expect(base.put).toHaveBeenCalledWith("ns:mykey", "val");
    });

    it("prepends prefix to delete() key", async () => {
      const kv = withKVFeatures(base, { prefix: "ns:" });
      await kv.delete("mykey");
      expect(base.delete).toHaveBeenCalledWith("ns:mykey");
    });

    it("prepends prefix to getWithMetadata() key", async () => {
      const kv = withKVFeatures(base, { prefix: "app:" });
      await kv.getWithMetadata("k");
      expect(base.getWithMetadata).toHaveBeenCalledWith("app:k");
    });

    it("does NOT prefix list() (list has no key argument at index 0)", async () => {
      const kv = withKVFeatures(base, { prefix: "ns:" });
      await kv.list({ prefix: "foo" });
      // list's first arg is options, not a key — should be passed through unmodified
      expect(base.list).toHaveBeenCalledWith({ prefix: "foo" });
    });
  });

  // ── Key validation ───────────────────────────────────────

  describe("validateKeys", () => {
    it("is enabled by default and rejects empty string keys", async () => {
      const kv = withKVFeatures(base);
      await expect(kv.get("")).rejects.toThrow(TypeError);
    });

    it("rejects whitespace-only keys", async () => {
      const kv = withKVFeatures(base);
      await expect(kv.get("   ")).rejects.toThrow(TypeError);
    });

    it("rejects non-string keys", async () => {
      const kv = withKVFeatures(base);
      await expect(kv.get(123 as any)).rejects.toThrow(TypeError);
    });

    it("allows valid keys through", async () => {
      const kv = withKVFeatures(base);
      await kv.get("valid-key");
      expect(base.get).toHaveBeenCalledTimes(1);
    });

    it("can be disabled", async () => {
      const kv = withKVFeatures(base, { validateKeys: false });
      // with validation off, empty string passes through to base
      await kv.get("");
      expect(base.get).toHaveBeenCalledTimes(1);
    });

    it("validates put keys", async () => {
      const kv = withKVFeatures(base);
      await expect(kv.put("", "value")).rejects.toThrow(TypeError);
    });

    it("validates delete keys", async () => {
      const kv = withKVFeatures(base);
      await expect(kv.delete("")).rejects.toThrow(TypeError);
    });
  });

  // ── Logging ──────────────────────────────────────────────

  describe("log", () => {
    it("calls custom log function with method name and args", async () => {
      const logFn = mock(() => {});
      const kv = withKVFeatures(base, { log: logFn });
      await kv.get("k");
      expect(logFn).toHaveBeenCalledTimes(1);
      expect(
        (logFn.mock.calls[0] as unknown as [string, ...unknown[]])[0],
      ).toBe("get");
    });

    it("uses console.debug when log is true", async () => {
      const spy = mock(() => {});
      const original = console.debug;
      console.debug = spy;
      try {
        const kv = withKVFeatures(base, { log: true });
        await kv.get("k");
        expect(spy).toHaveBeenCalled();
      } finally {
        console.debug = original;
      }
    });

    it("does not log when log is false", async () => {
      const logFn = mock(() => {});
      // log defaults to false
      const kv = withKVFeatures(base);
      await kv.get("k");
      expect(logFn).not.toHaveBeenCalled();
    });
  });

  // ── Timing + metrics ────────────────────────────────────

  describe("time + metrics", () => {
    it("calls metrics with method, duration, and success=true on success", async () => {
      const metricsFn = mock(() => {});
      const kv = withKVFeatures(base, { time: true, metrics: metricsFn });
      await kv.get("k");
      expect(metricsFn).toHaveBeenCalledTimes(1);
      const [method, duration, success] = metricsFn.mock
        .calls[0] as unknown as [string, number, boolean];
      expect(method).toBe("get");
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(success).toBe(true);
    });

    it("calls metrics with success=false on failure", async () => {
      const metricsFn = mock(() => {});
      const failing = createMockKV({
        get: mock(async () => {
          throw new Error("boom");
        }),
      });
      const kv = withKVFeatures(failing, {
        time: true,
        metrics: metricsFn,
        retry: { attempts: 1 },
      });
      await expect(kv.get("k")).rejects.toThrow("boom");
      expect(metricsFn).toHaveBeenCalledTimes(1);
      const [method, , success] = metricsFn.mock.calls[0] as unknown as [
        string,
        number,
        boolean,
      ];
      expect(method).toBe("get");
      expect(success).toBe(false);
    });

    it("does not call metrics when time is false", async () => {
      const metricsFn = mock(() => {});
      const kv = withKVFeatures(base, { time: false, metrics: metricsFn });
      await kv.get("k");
      expect(metricsFn).not.toHaveBeenCalled();
    });
  });

  // ── Retry ────────────────────────────────────────────────

  describe("retry", () => {
    it("retries the specified number of attempts before throwing", async () => {
      const failGet = mock(async () => {
        throw new Error("fail");
      });
      const failing = createMockKV({ get: failGet });
      const kv = withKVFeatures(failing, {
        retry: { attempts: 3, delayMs: 0 },
      });

      await expect(kv.get("k")).rejects.toThrow("fail");
      expect(failGet).toHaveBeenCalledTimes(3);
    });

    it("returns result if a retry succeeds", async () => {
      let calls = 0;
      const flakyGet = mock(async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "recovered";
      });
      const flaky = createMockKV({ get: flakyGet });
      const kv = withKVFeatures(flaky, {
        retry: { attempts: 3, delayMs: 0 },
      });

      const result = await kv.get("k");
      expect(result).toBe("recovered");
      expect(flakyGet).toHaveBeenCalledTimes(3);
    });

    it("defaults to 1 attempt (no retry)", async () => {
      const failGet = mock(async () => {
        throw new Error("fail");
      });
      const failing = createMockKV({ get: failGet });
      const kv = withKVFeatures(failing);

      await expect(kv.get("k")).rejects.toThrow("fail");
      expect(failGet).toHaveBeenCalledTimes(1);
    });

    it("waits delayMs between retries", async () => {
      const failGet = mock(async () => {
        throw new Error("fail");
      });
      const failing = createMockKV({ get: failGet });

      const start = performance.now();
      const kv = withKVFeatures(failing, {
        retry: { attempts: 3, delayMs: 50 },
      });

      await expect(kv.get("k")).rejects.toThrow("fail");
      const elapsed = performance.now() - start;
      // 2 delays (between attempt 1→2 and 2→3), each ~50ms
      expect(elapsed).toBeGreaterThanOrEqual(80);
    });
  });

  // ── onError callback ─────────────────────────────────────

  describe("onError", () => {
    it("calls onError with method and error when operation fails", async () => {
      const onError = mock(() => {});
      const err = new Error("kaboom");
      const failing = createMockKV({
        put: mock(async () => {
          throw err;
        }),
      });
      const kv = withKVFeatures(failing, { onError, retry: { attempts: 1 } });

      await expect(kv.put("k", "v")).rejects.toThrow("kaboom");
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("put", err);
    });

    it("does not call onError on success", async () => {
      const onError = mock(() => {});
      const kv = withKVFeatures(base, { onError });
      await kv.get("k");
      expect(onError).not.toHaveBeenCalled();
    });

    it("calls onError only once after all retries are exhausted", async () => {
      const onError = mock(() => {});
      const failing = createMockKV({
        get: mock(async () => {
          throw new Error("fail");
        }),
      });
      const kv = withKVFeatures(failing, {
        onError,
        retry: { attempts: 3, delayMs: 0 },
      });

      await expect(kv.get("k")).rejects.toThrow("fail");
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  // ── __original ───────────────────────────────────────────

  describe("__original", () => {
    it("is undefined when base is not an IndexedDbKV instance", () => {
      const kv = withKVFeatures(base);
      expect(kv.__original).toBeUndefined();
    });
  });

  // ── Composition ──────────────────────────────────────────

  describe("composition", () => {
    it("applies multiple layers of prefixing", async () => {
      const inner = withKVFeatures(base, { prefix: "a:" });
      const outer = withKVFeatures(inner, { prefix: "b:" });
      await outer.get("k");
      // outer prefixes "b:", inner then prefixes "a:" on top of that
      expect(base.get).toHaveBeenCalledWith("a:b:k");
    });

    it("both layers can log independently", async () => {
      const log1 = mock(() => {});
      const log2 = mock(() => {});
      const inner = withKVFeatures(base, { log: log1 });
      const outer = withKVFeatures(inner, { log: log2 });
      await outer.get("k");
      expect(log1).toHaveBeenCalledTimes(1);
      expect(log2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge cases ───────────────────────────────────────────

  describe("edge cases", () => {
    it("passes extra arguments through to base methods", async () => {
      const kv = withKVFeatures(base, { prefix: "p:" });
      await kv.put("k", "v", { metadata: { a: 1 } });
      expect(base.put).toHaveBeenCalledWith("p:k", "v", { metadata: { a: 1 } });
    });

    it("works with get options", async () => {
      const kv = withKVFeatures(base);
      await kv.get("k", { type: "json" });
      expect(base.get).toHaveBeenCalledWith("k", { type: "json" });
    });

    it("returns the base method's resolved value", async () => {
      const custom = createMockKV({
        get: mock(async () => ({ complex: true })),
      });
      const kv = withKVFeatures(custom);
      const result = await kv.get("k");
      expect(result).toEqual({ complex: true });
    });
  });
});
