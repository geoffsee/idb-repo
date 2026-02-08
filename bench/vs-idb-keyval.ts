/**
 * bench/vs-idb-keyval.ts
 *
 * Performance comparison: idb-repo (IndexedDbKV) vs idb-keyval
 *
 * Runs in a real browser via Playwright so IndexedDB is available.
 * Both libraries are bundled for the browser and injected into the page.
 *
 * Usage:
 *   bun run bench/vs-idb-keyval.ts
 */

import { chromium } from "playwright";
import { join } from "path";
import { unlinkSync } from "fs";

const ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// Bundling
// ---------------------------------------------------------------------------

async function bundleForBrowser(code: string, label: string): Promise<string> {
    const entry = join(ROOT, `bench/.tmp-${label}.ts`);
    await Bun.write(entry, code);
    try {
        const result = await Bun.build({
            entrypoints: [entry],
            target: "browser",
            format: "esm",
        });
        if (!result.success) {
            console.error(result.logs);
            throw new Error(`Failed to bundle ${label}`);
        }
        return await result.outputs[0]!.text();
    } finally {
        try {
            unlinkSync(entry);
        } catch {}
    }
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

interface BenchRow {
    operation: string;
    library: string;
    avgMs: number;
    medianMs: number;
    p95Ms: number;
    opsSec: number;
}

function printResults(rows: BenchRow[]) {
    // Group rows into pairs by operation
    const ops = [...new Set(rows.map((r) => r.operation))];

    const COL = {
        op: 28,
        lib: 14,
        avg: 12,
        med: 12,
        p95: 12,
        ops: 12,
    };

    const pad = (s: string, n: number) => s.padEnd(n);
    const rpad = (s: string, n: number) => s.padStart(n);
    const sep = "-".repeat(COL.op + COL.lib + COL.avg + COL.med + COL.p95 + COL.ops + 5);

    console.log();
    console.log(
        [
            pad("Operation", COL.op),
            pad("Library", COL.lib),
            rpad("Avg (ms)", COL.avg),
            rpad("Median (ms)", COL.med),
            rpad("p95 (ms)", COL.p95),
            rpad("ops/sec", COL.ops),
        ].join(" | ")
    );
    console.log(sep);

    for (const op of ops) {
        const group = rows.filter((r) => r.operation === op);

        // Determine winner (lowest avg)
        const best = group.reduce((a, b) => (a.avgMs < b.avgMs ? a : b));

        for (const row of group) {
            const winner = group.length > 1 && row === best ? " *" : "";
            console.log(
                [
                    pad(row.operation, COL.op),
                    pad(row.library + winner, COL.lib),
                    rpad(row.avgMs.toFixed(3), COL.avg),
                    rpad(row.medianMs.toFixed(3), COL.med),
                    rpad(row.p95Ms.toFixed(3), COL.p95),
                    rpad(String(row.opsSec), COL.ops),
                ].join(" | ")
            );
        }
        console.log(sep);
    }

    console.log("\n  * = faster\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log("Bundling libraries for browser...");

    const [repoBundle, keyvalBundle] = await Promise.all([
        bundleForBrowser(
            [
                `import { IndexedDbKV } from '${ROOT}/src/lib.ts';`,
                `(globalThis as any).IndexedDbKV = IndexedDbKV;`,
            ].join("\n"),
            "idb-repo"
        ),
        bundleForBrowser(
            [
                `import { get, set, del, keys, getMany, setMany, clear, createStore } from 'idb-keyval';`,
                `(globalThis as any).idbKeyval = { get, set, del, keys, getMany, setMany, clear, createStore };`,
            ].join("\n"),
            "idb-keyval"
        ),
    ]);

    console.log("Launching browser...");
    const browser = await chromium.launch();
    const ctx = await browser.newContext();

    // Serve a blank page on a proper origin (IndexedDB needs non-opaque origin)
    await ctx.route("https://bench.local/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!DOCTYPE html><html><body></body></html>",
        })
    );

    await ctx.addInitScript({ content: repoBundle });
    await ctx.addInitScript({ content: keyvalBundle });

    const page = await ctx.newPage();
    await page.goto("https://bench.local/");

    console.log("Running benchmarks...\n");

    // Run all benchmarks inside the browser page
    const results: BenchRow[] = await page.evaluate(async () => {
        // ----- helpers -----
        function median(arr: number[]) {
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
        }
        function p95(arr: number[]) {
            const s = [...arr].sort((a, b) => a - b);
            return s[Math.floor(s.length * 0.95)]!;
        }
        function avg(arr: number[]) {
            return arr.reduce((a, b) => a + b, 0) / arr.length;
        }

        async function bench(
            operation: string,
            library: string,
            fn: () => Promise<void>,
            iterations: number,
            warmup = Math.min(10, iterations)
        ) {
            // warmup
            for (let i = 0; i < warmup; i++) await fn();

            const times: number[] = [];
            for (let i = 0; i < iterations; i++) {
                const t0 = performance.now();
                await fn();
                times.push(performance.now() - t0);
            }
            return {
                operation,
                library,
                avgMs: +avg(times).toFixed(4),
                medianMs: +median(times).toFixed(4),
                p95Ms: +p95(times).toFixed(4),
                opsSec: Math.round(1000 / avg(times)),
            };
        }

        // Delete databases from any previous run
        await Promise.all(
            ["bench-repo", "bench-repo-cached", "bench-keyval"].map(
                (name) =>
                    new Promise<void>((res) => {
                        const r = indexedDB.deleteDatabase(name);
                        r.onsuccess = r.onerror = () => res();
                    })
            )
        );

        // ----- setup -----
        const G = globalThis as any;
        const kv = new G.IndexedDbKV({
            dbName: "bench-repo",
            storeName: "kv",
            cacheEntries: 0, // disable cache for fair comparison
        });
        const kvStore = G.idbKeyval.createStore("bench-keyval", "kv");
        const { get, set, del, keys, getMany, setMany, clear } = G.idbKeyval;

        const SINGLE = 500;
        const BATCH = 100;
        const LIST_N = 500;

        const testObj = {
            user: "alice",
            age: 30,
            tags: ["admin", "user"],
            meta: { created: 1700000000 },
        };

        const rows: any[] = [];

        // ===== Single Write =====
        let idx = 0;
        rows.push(
            await bench(
                "put / set  (single)",
                "idb-repo",
                async () => {
                    await kv.put(`w-${idx++}`, testObj);
                },
                SINGLE
            )
        );
        idx = 0;
        rows.push(
            await bench(
                "put / set  (single)",
                "idb-keyval",
                async () => {
                    await set(`w-${idx++}`, testObj, kvStore);
                },
                SINGLE
            )
        );

        // ===== Single Read =====
        await kv.put("read-key", testObj);
        await set("read-key", testObj, kvStore);

        rows.push(
            await bench(
                "get  (single, json)",
                "idb-repo",
                async () => {
                    await kv.get("read-key", { type: "json" });
                },
                SINGLE
            )
        );
        rows.push(
            await bench(
                "get  (single, json)",
                "idb-keyval",
                async () => {
                    await get("read-key", kvStore);
                },
                SINGLE
            )
        );

        // ===== Single Read (text) =====
        await kv.put("read-text", "hello world");

        rows.push(
            await bench(
                "get  (single, text)",
                "idb-repo",
                async () => {
                    await kv.get("read-text");
                },
                SINGLE
            )
        );
        rows.push(
            await bench(
                "get  (single, text)",
                "idb-keyval",
                async () => {
                    await get("read-text", kvStore);
                },
                SINGLE
            )
        );

        // ===== Batch Write (sequential txns) =====
        rows.push(
            await bench(
                `put x${BATCH}  (sequential)`,
                "idb-repo",
                async () => {
                    for (let i = 0; i < BATCH; i++)
                        await kv.put(`bw-${i}`, testObj);
                },
                10
            )
        );
        rows.push(
            await bench(
                `put x${BATCH}  (sequential)`,
                "idb-keyval",
                async () => {
                    for (let i = 0; i < BATCH; i++)
                        await set(`bw-${i}`, testObj, kvStore);
                },
                10
            )
        );

        // ===== Batch Write (idb-keyval setMany — single txn) =====
        rows.push(
            await bench(
                `setMany x${BATCH}  (1 txn)`,
                "idb-keyval",
                async () => {
                    const entries: [string, any][] = [];
                    for (let i = 0; i < BATCH; i++)
                        entries.push([`bwm-${i}`, testObj]);
                    await setMany(entries, kvStore);
                },
                10
            )
        );

        // ===== Batch Read (sequential) =====
        for (let i = 0; i < BATCH; i++) {
            await kv.put(`br-${i}`, testObj);
            await set(`br-${i}`, testObj, kvStore);
        }

        rows.push(
            await bench(
                `get x${BATCH}  (sequential)`,
                "idb-repo",
                async () => {
                    for (let i = 0; i < BATCH; i++)
                        await kv.get(`br-${i}`, { type: "json" });
                },
                10
            )
        );
        rows.push(
            await bench(
                `get x${BATCH}  (sequential)`,
                "idb-keyval",
                async () => {
                    for (let i = 0; i < BATCH; i++)
                        await get(`br-${i}`, kvStore);
                },
                10
            )
        );

        // ===== Batch Read (idb-keyval getMany — single txn) =====
        rows.push(
            await bench(
                `getMany x${BATCH}  (1 txn)`,
                "idb-keyval",
                async () => {
                    const ks = Array.from(
                        { length: BATCH },
                        (_, i) => `br-${i}`
                    );
                    await getMany(ks, kvStore);
                },
                10
            )
        );

        // ===== Delete =====
        rows.push(
            await bench(
                "delete / del",
                "idb-repo",
                async () => {
                    await kv.delete("read-key");
                },
                SINGLE
            )
        );
        rows.push(
            await bench(
                "delete / del",
                "idb-keyval",
                async () => {
                    await del("read-key", kvStore);
                },
                SINGLE
            )
        );

        // ===== List / Keys =====
        for (let i = 0; i < LIST_N; i++) {
            const k = `list-${String(i).padStart(4, "0")}`;
            await kv.put(k, testObj);
            await set(k, testObj, kvStore);
        }

        rows.push(
            await bench(
                `list / keys  (${LIST_N} items)`,
                "idb-repo",
                async () => {
                    await kv.list({ prefix: "list-" });
                },
                20
            )
        );
        rows.push(
            await bench(
                `list / keys  (${LIST_N} items)`,
                "idb-keyval",
                async () => {
                    await keys(kvStore);
                },
                20
            )
        );

        // ===== Cached Read (idb-repo only) =====
        const kvCached = new G.IndexedDbKV({
            dbName: "bench-repo-cached",
            storeName: "kv",
            cacheEntries: 2048,
        });
        await kvCached.put("ck", testObj);
        // prime the cache
        await kvCached.get("ck", { type: "json", cacheTtl: 60 });

        rows.push(
            await bench(
                "get  (cached hit)",
                "idb-repo",
                async () => {
                    await kvCached.get("ck", { type: "json", cacheTtl: 60 });
                },
                SINGLE
            )
        );

        // cleanup
        kv.close();
        kvCached.close();

        return rows;
    });

    printResults(results);

    console.log("Notes:");
    console.log("  - idb-repo values now use structured clone (legacy JSON records still decode)");
    console.log("  - idb-keyval setMany/getMany batch into a single IDB transaction");
    console.log("  - idb-repo opens one transaction per put/get (no batch API yet)");
    console.log("  - 'cached hit' bypasses IndexedDB entirely (in-memory LRU)");
    console.log("  - Browser: Chromium (Playwright headless)");
    console.log();

    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
