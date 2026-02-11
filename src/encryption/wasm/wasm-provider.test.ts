import { describe, it, expect, beforeAll } from "vitest";
import { WasmMlKemProvider } from "./wasm-provider";

describe("WasmMlKemProvider", () => {
  let provider: WasmMlKemProvider;

  beforeAll(async () => {
    provider = await WasmMlKemProvider.create();
  });

  describe("initialization", () => {
    it("should create a provider with generated keypair", async () => {
      const p = await WasmMlKemProvider.create();
      expect(p.providerId).toBe("ml-kem-1024-aes256-gcm-wasm");
      expect(p.formatVersion).toBe(1);
    });

    it("should fail to encrypt/decrypt if not initialized", async () => {
      const keys = provider.exportKeys();
      const uninitializedProvider = new WasmMlKemProvider(
        keys.publicKey,
        keys.secretKey,
      );

      const plaintext = new Uint8Array([1, 2, 3]);

      await expect(uninitializedProvider.encrypt(plaintext)).rejects.toThrow(
        "not initialized",
      );
    });

    it("should support manual initialization", async () => {
      const keys = provider.exportKeys();
      const p = new WasmMlKemProvider(keys.publicKey, keys.secretKey);
      await p.initialize();

      const plaintext = new Uint8Array([1, 2, 3]);
      const ciphertext = await p.encrypt(plaintext);
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);
    });
  });

  describe("key management", () => {
    it("should export and import keys", async () => {
      const keys = provider.exportKeys();

      expect(keys.publicKey).toBeInstanceOf(Uint8Array);
      expect(keys.secretKey).toBeInstanceOf(Uint8Array);
      expect(keys.publicKey.length).toBe(1568); // ML-KEM-1024 public key size
      expect(keys.secretKey.length).toBe(3168); // ML-KEM-1024 secret key size

      // Create new provider from exported keys
      const restored = await WasmMlKemProvider.fromKeys(
        keys.publicKey,
        keys.secretKey,
      );

      const plaintext = new Uint8Array([4, 5, 6]);
      const ciphertext = await restored.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe("encryption and decryption", () => {
    it("should encrypt and decrypt successfully", async () => {
      const plaintext = new TextEncoder().encode("Hello, post-quantum world!");
      const ciphertext = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(decrypted).toEqual(plaintext);
      expect(new TextDecoder().decode(decrypted)).toBe(
        "Hello, post-quantum world!",
      );
    });

    it("should produce different ciphertexts for same plaintext", async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const ct1 = await provider.encrypt(plaintext);
      const ct2 = await provider.encrypt(plaintext);

      // Should be different due to random IV and KEM encapsulation
      expect(ct1).not.toEqual(ct2);

      // But both should decrypt to same plaintext
      const pt1 = await provider.decrypt(ct1);
      const pt2 = await provider.decrypt(ct2);
      expect(pt1).toEqual(plaintext);
      expect(pt2).toEqual(plaintext);
    });

    it("should handle empty plaintext", async () => {
      const plaintext = new Uint8Array(0);
      const ciphertext = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(decrypted).toEqual(plaintext);
      expect(decrypted.length).toBe(0);
    });

    it("should handle large plaintext", async () => {
      const plaintext = new Uint8Array(1024 * 100); // 100 KB
      crypto.getRandomValues(plaintext);

      const ciphertext = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(decrypted).toEqual(plaintext);
    });

    it("should have expected overhead", async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const ciphertext = await provider.encrypt(plaintext);

      // Overhead: 1568 (KEM CT) + 12 (IV) + 16 (AES tag) = 1596 bytes
      const overhead = ciphertext.length - plaintext.length;
      expect(overhead).toBe(1596);
    });
  });

  describe("error handling", () => {
    it("should fail to decrypt corrupted ciphertext", async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const ciphertext = await provider.encrypt(plaintext);

      // Corrupt the ciphertext
      const corrupted = new Uint8Array(ciphertext);
      corrupted[corrupted.length - 1] ^= 0xff;

      await expect(provider.decrypt(corrupted)).rejects.toThrow(
        "Decryption failed",
      );
    });

    it("should fail to decrypt ciphertext that is too short", async () => {
      const tooShort = new Uint8Array(100); // Much smaller than minimum

      await expect(provider.decrypt(tooShort)).rejects.toThrow(
        "Invalid ciphertext: too short",
      );
    });

    it("should fail to decrypt with wrong key", async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const ciphertext = await provider.encrypt(plaintext);

      // Create a different provider with different keys
      const wrongProvider = await WasmMlKemProvider.create();

      await expect(wrongProvider.decrypt(ciphertext)).rejects.toThrow();
    });
  });

  describe("format compatibility", () => {
    it("should match NodeProvider format structure", async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const ciphertext = await provider.encrypt(plaintext);

      // Verify structure: KEM_CT (1568) || IV (12) || AES_CT (plaintext + 16)
      expect(ciphertext.length).toBe(1568 + 12 + plaintext.length + 16);

      // Extract and verify component sizes
      const kemCt = ciphertext.subarray(0, 1568);
      const iv = ciphertext.subarray(1568, 1580);
      const aesCt = ciphertext.subarray(1580);

      expect(kemCt.length).toBe(1568);
      expect(iv.length).toBe(12);
      expect(aesCt.length).toBe(plaintext.length + 16); // plaintext + auth tag
    });
  });

  describe("provider metadata", () => {
    it("should provide correct metadata", () => {
      const metadata = provider.getProviderMetadata?.();
      expect(metadata).toEqual({
        provider: "ml-kem-1024-aes256-gcm-wasm",
        version: 1,
      });
    });
  });

  describe("unicode and binary data", () => {
    it("should handle unicode text", async () => {
      const text = "Hello 世界 🌍 🔒";
      const plaintext = new TextEncoder().encode(text);
      const ciphertext = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(new TextDecoder().decode(decrypted)).toBe(text);
    });

    it("should handle binary data with all byte values", async () => {
      const plaintext = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        plaintext[i] = i;
      }

      const ciphertext = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(ciphertext);

      expect(decrypted).toEqual(plaintext);
    });
  });
});
