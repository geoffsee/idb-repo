// ────────────────────────────────────────────────
// Higher-order wrapper factory (decorator style)
// ────────────────────────────────────────────────

/*
# Usage example
// 1. Simple logging + timing
const kv = createIndexedDbKV();

const loggedKv = withKVFeatures(kv, {
  log: true,
  time: true,
});

// ────────────────────────────────────────────────

// 2. Prefix + validation + retry
const appKv = withKVFeatures(kv, {
  prefix: "app:v1:",
  validateKeys: true,
  retry: { attempts: 3, delayMs: 400 },
  onError: (method, err) => {
    // e.g. capture to Sentry, LogRocket, …
    console.error(`KV operation failed: ${method}`, err);
  }
});

// ────────────────────────────────────────────────

// 3. Metrics integration (Prometheus style, console example)
const metricsKv = withKVFeatures(kv, {
  time: true,
  metrics: (method, duration, success) => {
    console.log(
      `kv.${method} ${success ? "success" : "failure"} duration=${duration.toFixed(1)}ms`
    );
    // → send to your metrics backend here
  }
});

// ────────────────────────────────────────────────

// 4. Compose multiple wrappers
const productionKv = withKVFeatures(
  withKVFeatures(kv, {
    prefix: "prod:",
    retry: { attempts: 2 },
  }),
  {
    log: (method, ...args) => {
      if (method === "put") console.info("→ PUT", args);
    },
    time: true,
  }
);
 */

import type { KVNamespace } from "./types";
import {IndexedDbKV} from "./lib";

type KVMethodName =
    | 'get'
    | 'getWithMetadata'
    | 'put'
    | 'delete'
    | 'list';

type WrappedKV = KVNamespace & {
    // optional: expose original for testing / advanced usage
    readonly __original?: IndexedDbKV;
};

type WrapperOptions = {
    log?: boolean | ((method: KVMethodName, ...args: any[]) => void);
    time?: boolean;
    prefix?: string;                 // auto-prefix all keys
    validateKeys?: boolean;
    retry?: { attempts: number; delayMs?: number };
    onError?: (method: KVMethodName, error: unknown) => void;
    metrics?: (method: KVMethodName, durationMs: number, success: boolean) => void;
};

/**
 * Higher-order function that wraps an existing KVNamespace instance
 * and adds configurable cross-cutting behavior.
 */
export function withKVFeatures(
    base: KVNamespace,
    opts: WrapperOptions = {}
): WrappedKV {

    const {
        log       = false,
        time      = false,
        prefix    = "",
        validateKeys = true,
        retry     = { attempts: 1, delayMs: 300 },
        onError   = () => {},
        metrics   = () => {},
    } = opts;

    const shouldLog   = !!log;
    const logFn       = typeof log === "function" ? log : console.debug.bind(console);

    function prefixedKey(key: string): string {
        return prefix ? `${prefix}${key}` : key;
    }

    function wrapMethod<M extends keyof KVNamespace>(
        methodName: M
    ): KVNamespace[M] {
        const original = base[methodName] as Function;

        return (async (...args: any[]) => {
            const methodStr = String(methodName);
            let keyIndex = -1;
            if (["get", "getWithMetadata", "put", "delete"].includes(methodStr)) {
                keyIndex = 0;
            }

            const start = time ? performance.now() : 0;

            // 1. Pre-processing / validation
            let effectiveArgs = [...args];
            if (validateKeys && keyIndex >= 0) {
                const rawKey = effectiveArgs[keyIndex];
                if (typeof rawKey !== "string" || rawKey.trim() === "") {
                    throw new TypeError(`Invalid key for ${methodStr}: ${JSON.stringify(rawKey)}`);
                }
                effectiveArgs[keyIndex] = prefixedKey(rawKey);
            }

            // 2. Logging start
            if (shouldLog) {
                logFn(methodStr as KVMethodName, ...effectiveArgs);
            }

            let attempt = 0;
            let lastError: unknown;

            while (attempt < retry.attempts) {
                attempt++;

                try {
                    const result = await original.apply(base, effectiveArgs);

                    // 3. Success metrics & timing
                    if (time) {
                        const duration = performance.now() - start;
                        metrics(methodStr as KVMethodName, duration, true);
                    }

                    return result;
                } catch (err) {
                    lastError = err;

                    if (attempt === retry.attempts) {
                        if (shouldLog) {
                            console.warn(`KV ${methodStr} failed after ${attempt} attempts`, err);
                        }
                        onError(methodStr as KVMethodName, err);
                        if (time) {
                            const duration = performance.now() - start;
                            metrics(methodStr as KVMethodName, duration, false);
                        }
                        throw err;
                    }

                    // backoff
                    if (retry.delayMs) {
                        await new Promise(r => setTimeout(r, retry.delayMs));
                    }
                }
            }

            throw lastError;
        }) as any;
    }

    const wrapped = {
        get:               wrapMethod("get"),
        getWithMetadata:   wrapMethod("getWithMetadata"),
        put:               wrapMethod("put"),
        delete:            wrapMethod("delete"),
        list:              wrapMethod("list"),
        __original:        base instanceof IndexedDbKV ? base : undefined,
    } as WrappedKV;

    return wrapped;
}

