import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { NodeProvider } from "./node-provider.js"; // adjust path as needed

describe("NodeProvider", async function () {
  let provider: NodeProvider;

  before(async function () {
    provider = await NodeProvider.create(false); // non-extractable is fine for tests
  });

  after(async function () {
    // Optional cleanup if shutdown is ever added
  });

  test("can be instantiated via static create()", async function () {
    const p = await NodeProvider.create(true);
    assert(p instanceof NodeProvider);
    assert.strictEqual(p.providerId, "ml-kem-1024-aes256-gcm");
    assert.strictEqual(p.formatVersion, 1);
  });

  test("encrypt → decrypt round-trip preserves original plaintext", async function () {
    const original = new TextEncoder().encode(
      "post-quantum hello world! 🌍🔐 2026",
    );

    const ciphertext = await provider.encrypt(original);
    assert(ciphertext.length > original.length + 1500); // ~1596 overhead

    const decrypted = await provider.decrypt(ciphertext);
    assert.deepStrictEqual(decrypted, original);
  });

  test("decrypt fails on corrupted ciphertext (wrong kemCt)", async function (t) {
    const msg = new TextEncoder().encode("tamper me");
    const ct = await provider.encrypt(msg);

    const badCt = new Uint8Array(ct);
    // @ts-ignore - is wrong for test
    badCt[0] ^= 0xff; // corrupt first byte of KEM ciphertext

    await assert.rejects(
      provider.decrypt(badCt),
      /decapsulation|operationError|invalid/i,
    );
  });

  test("decrypt fails when AES-GCM tag is corrupted", async function (t) {
    const msg = new TextEncoder().encode("tag tamper test");
    const ct = await provider.encrypt(msg);

    const badCt = new Uint8Array(ct);
    const tagStart = ct.length - 16;

    badCt[tagStart]! ^= 0x42;

    await assert.rejects(
      provider.decrypt(badCt),
      /authentication|operationError|tag/i,
    );
  });

  test("decrypt fails on too-short ciphertext", async function () {
    const tooShort = new Uint8Array(1500); // < 1568 + 12 + 16
    await assert.rejects(provider.decrypt(tooShort), /too short|invalid/i);
  });

  test("multiple encryptions produce different ciphertexts (semantic security)", async function () {
    const msg = new TextEncoder().encode("same message");

    const ct1 = await provider.encrypt(msg);
    const ct2 = await provider.encrypt(msg);

    assert.notDeepEqual(ct1, ct2);

    await assert.doesNotReject(provider.decrypt(ct1), { value: msg });
    await assert.doesNotReject(provider.decrypt(ct2), { value: msg });
  });

  test("empty plaintext encrypts and decrypts correctly", async function () {
    const empty = new Uint8Array(0);
    const ct = await provider.encrypt(empty);
    const recovered = await provider.decrypt(ct);

    assert.strictEqual(recovered.length, 0);
    assert.deepStrictEqual(recovered, empty);
  });

  test("large plaintext (> 64 KiB) round-trips successfully", async function (t) {
    const large = new Uint8Array(128 * 1024);
    const maxChunk = 65536;
    for (let offset = 0; offset < large.length; offset += maxChunk) {
      const end = Math.min(offset + maxChunk, large.length);
      crypto.getRandomValues(large.subarray(offset, end));
    }

    const ct = await provider.encrypt(large);
    const recovered = await provider.decrypt(ct);

    assert.deepStrictEqual(recovered, large);
  });
});
