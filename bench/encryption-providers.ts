/**
 * Encryption Provider Performance Benchmark
 *
 * Compares performance of different encryption providers:
 * - WebCryptoEncryptionProvider (AES-256-GCM)
 * - WasmMlKemProvider (ML-KEM-1024 + AES-256-GCM)
 *
 * Usage: bun run bench/encryption-providers.ts
 */

import { WebCryptoEncryptionProvider } from "../src/encryption/web/web-provider";
import { WasmMlKemProvider } from "../src/encryption/wasm/wasm-provider";

interface BenchResult {
  provider: string;
  operation: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
  overhead: number;
}

function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    avg: sum / times.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

async function benchmark(
  name: string,
  operation: string,
  fn: () => Promise<void>,
  iterations: number,
  warmup = 10,
): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Measure
  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const total = performance.now() - start;
  const s = stats(times);

  return {
    provider: name,
    operation,
    iterations,
    totalMs: total,
    avgMs: s.avg,
    medianMs: s.median,
    minMs: s.min,
    maxMs: s.max,
    opsPerSec: Math.round(1000 / s.avg),
    overhead: 0, // Will be set separately
  };
}

function printResults(results: BenchResult[]) {
  console.log("\n" + "=".repeat(100));
  console.log("ENCRYPTION PROVIDER PERFORMANCE BENCHMARK");
  console.log("=".repeat(100) + "\n");

  // Group by operation
  const operations = [...new Set(results.map((r) => r.operation))];

  for (const op of operations) {
    const group = results.filter((r) => r.operation === op);

    console.log(`\n${op}`);
    console.log("-".repeat(100));
    console.log(
      [
        "Provider".padEnd(30),
        "Avg (ms)".padStart(12),
        "Median".padStart(12),
        "Min".padStart(12),
        "Max".padStart(12),
        "ops/sec".padStart(12),
      ].join(" | "),
    );
    console.log("-".repeat(100));

    // Find fastest
    const fastest = group.reduce((a, b) => (a.avgMs < b.avgMs ? a : b));

    for (const r of group) {
      const isFastest = r === fastest;
      const speedup =
        r !== fastest
          ? ` (${(r.avgMs / fastest.avgMs).toFixed(2)}x slower)`
          : " ★ FASTEST";

      console.log(
        [
          (r.provider + speedup).padEnd(30),
          r.avgMs.toFixed(3).padStart(12),
          r.medianMs.toFixed(3).padStart(12),
          r.minMs.toFixed(3).padStart(12),
          r.maxMs.toFixed(3).padStart(12),
          r.opsPerSec.toString().padStart(12),
        ].join(" | "),
      );
    }
  }

  // Overhead comparison
  console.log("\n\nENCRYPTION OVERHEAD");
  console.log("-".repeat(100));
  const overheadResults = results.filter((r) => r.overhead > 0);
  if (overheadResults.length > 0) {
    console.log(
      ["Provider".padEnd(40), "Overhead (bytes)".padStart(20)].join(" | "),
    );
    console.log("-".repeat(100));
    for (const r of overheadResults) {
      console.log(
        [r.provider.padEnd(40), r.overhead.toString().padStart(20)].join(
          " | ",
        ),
      );
    }
  }

  console.log("\n" + "=".repeat(100) + "\n");
}

async function main() {
  console.log("Initializing encryption providers...");

  // Create providers
  const aesProvider = new WebCryptoEncryptionProvider(
    new Uint8Array(32).fill(42),
  );
  await aesProvider.initialize();

  const wasmProvider = await WasmMlKemProvider.create();

  const results: BenchResult[] = [];

  // Test data of various sizes
  const testData = {
    small: new TextEncoder().encode("Hello, World!"), // 13 bytes
    medium: new TextEncoder().encode("x".repeat(1024)), // 1 KB
    large: new TextEncoder().encode("x".repeat(10240)), // 10 KB
  };

  console.log("Running benchmarks...\n");

  // ===== Small Data (13 bytes) =====
  console.log("📊 Testing small data (13 bytes)...");

  let aesCiphertext: Uint8Array;
  results.push(
    await benchmark(
      "AES-256-GCM",
      "Encrypt (13 bytes)",
      async () => {
        aesCiphertext = await aesProvider.encrypt(testData.small);
      },
      1000,
    ),
  );

  let wasmCiphertext: Uint8Array;
  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Encrypt (13 bytes)",
      async () => {
        wasmCiphertext = await wasmProvider.encrypt(testData.small);
      },
      1000,
    ),
  );

  // Decrypt benchmarks
  results.push(
    await benchmark(
      "AES-256-GCM",
      "Decrypt (13 bytes)",
      async () => {
        await aesProvider.decrypt(aesCiphertext!);
      },
      1000,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Decrypt (13 bytes)",
      async () => {
        await wasmProvider.decrypt(wasmCiphertext!);
      },
      1000,
    ),
  );

  // Calculate overhead for small data
  results[results.length - 4]!.overhead =
    aesCiphertext!.length - testData.small.length; // AES overhead
  results[results.length - 3]!.overhead =
    wasmCiphertext!.length - testData.small.length; // WASM overhead

  // ===== Medium Data (1 KB) =====
  console.log("📊 Testing medium data (1 KB)...");

  results.push(
    await benchmark(
      "AES-256-GCM",
      "Encrypt (1 KB)",
      async () => {
        aesCiphertext = await aesProvider.encrypt(testData.medium);
      },
      500,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Encrypt (1 KB)",
      async () => {
        wasmCiphertext = await wasmProvider.encrypt(testData.medium);
      },
      500,
    ),
  );

  results.push(
    await benchmark(
      "AES-256-GCM",
      "Decrypt (1 KB)",
      async () => {
        await aesProvider.decrypt(aesCiphertext!);
      },
      500,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Decrypt (1 KB)",
      async () => {
        await wasmProvider.decrypt(wasmCiphertext!);
      },
      500,
    ),
  );

  // ===== Large Data (10 KB) =====
  console.log("📊 Testing large data (10 KB)...");

  results.push(
    await benchmark(
      "AES-256-GCM",
      "Encrypt (10 KB)",
      async () => {
        aesCiphertext = await aesProvider.encrypt(testData.large);
      },
      200,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Encrypt (10 KB)",
      async () => {
        wasmCiphertext = await wasmProvider.encrypt(testData.large);
      },
      200,
    ),
  );

  results.push(
    await benchmark(
      "AES-256-GCM",
      "Decrypt (10 KB)",
      async () => {
        await aesProvider.decrypt(aesCiphertext!);
      },
      200,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Decrypt (10 KB)",
      async () => {
        await wasmProvider.decrypt(wasmCiphertext!);
      },
      200,
    ),
  );

  // ===== Provider Initialization =====
  console.log("📊 Testing provider initialization...");

  results.push(
    await benchmark(
      "AES-256-GCM",
      "Provider Initialization",
      async () => {
        const p = new WebCryptoEncryptionProvider(new Uint8Array(32).fill(1));
        await p.initialize();
      },
      50,
    ),
  );

  results.push(
    await benchmark(
      "ML-KEM-1024 + AES-256-GCM",
      "Provider Initialization",
      async () => {
        await WasmMlKemProvider.create();
      },
      50,
    ),
  );

  printResults(results);

  console.log("Summary:");
  console.log(
    `  • AES-256-GCM: 28 bytes overhead, ~${results.find((r) => r.provider === "AES-256-GCM" && r.operation === "Encrypt (13 bytes)")?.avgMs.toFixed(2)}ms avg encrypt`,
  );
  console.log(
    `  • ML-KEM-1024: 1596 bytes overhead, ~${results.find((r) => r.provider === "ML-KEM-1024 + AES-256-GCM" && r.operation === "Encrypt (13 bytes)")?.avgMs.toFixed(2)}ms avg encrypt`,
  );
  console.log(
    "\n  Use AES-256-GCM for performance, ML-KEM-1024 for post-quantum security.\n",
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
