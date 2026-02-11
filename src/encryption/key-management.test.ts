import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageKeyManager,
  KeySerializer,
} from "./key-management";
import { WasmMlKemProvider } from "./wasm/wasm-provider";

// Mock localStorage for Node.js tests
class LocalStorageMock {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// @ts-ignore
global.localStorage = new LocalStorageMock();

describe("KeySerializer", () => {
  it("should serialize and deserialize Uint8Array", () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const serialized = KeySerializer.serialize(original);
    const deserialized = KeySerializer.deserialize(serialized);

    expect(deserialized).toEqual(original);
    expect(typeof serialized).toBe("string");
  });

  it("should serialize and deserialize ML-KEM keypair", async () => {
    const provider = await WasmMlKemProvider.create();
    const { publicKey, secretKey } = provider.exportKeys();

    const serialized = KeySerializer.serializeMLKEMKeys(publicKey, secretKey);
    const { publicKey: pub2, secretKey: sec2 } =
      KeySerializer.deserializeMLKEMKeys(serialized);

    expect(pub2).toEqual(publicKey);
    expect(sec2).toEqual(secretKey);
  });

  it("should handle empty arrays", () => {
    const empty = new Uint8Array(0);
    const serialized = KeySerializer.serialize(empty);
    const deserialized = KeySerializer.deserialize(serialized);

    expect(deserialized).toEqual(empty);
    expect(deserialized.length).toBe(0);
  });
});

describe("LocalStorageKeyManager", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("AES Key Management", () => {
    it("should save and load AES key", async () => {
      const key = crypto.getRandomValues(new Uint8Array(32));

      // Save
      LocalStorageKeyManager.saveAESKey(key);
      expect(LocalStorageKeyManager.hasKey()).toBe(true);
      expect(LocalStorageKeyManager.getKeyType()).toBe("aes-256-gcm");

      // Load
      const provider = await LocalStorageKeyManager.loadAESProvider();
      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe("aes-256-gcm");

      // Test encryption/decryption works
      const plaintext = new TextEncoder().encode("test data");
      const ciphertext = await provider!.encrypt(plaintext);
      const decrypted = await provider!.decrypt(ciphertext);
      expect(decrypted).toEqual(plaintext);
    });

    it("should return null when no key is stored", async () => {
      const provider = await LocalStorageKeyManager.loadAESProvider();
      expect(provider).toBeNull();
    });
  });

  describe("PBKDF2 Salt Management", () => {
    it("should save and load PBKDF2 salt", async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const passphrase = "test-password-123";

      // Save salt
      LocalStorageKeyManager.savePBKDF2Salt(salt);
      expect(LocalStorageKeyManager.hasKey()).toBe(true);
      expect(LocalStorageKeyManager.getKeyType()).toBe("pbkdf2-salt");

      // Load with passphrase
      const provider =
        await LocalStorageKeyManager.loadPBKDF2Provider(passphrase);
      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe("aes-256-gcm-pbkdf2");

      // Verify salt matches
      expect(provider!.getSalt()).toEqual(salt);
    });

    it("should work with different passphrases on same salt", async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      LocalStorageKeyManager.savePBKDF2Salt(salt);

      const provider1 =
        await LocalStorageKeyManager.loadPBKDF2Provider("password1");
      const provider2 =
        await LocalStorageKeyManager.loadPBKDF2Provider("password2");

      // Both should initialize successfully but produce different keys
      const plaintext = new Uint8Array([1, 2, 3]);
      const ct1 = await provider1!.encrypt(plaintext);
      const ct2 = await provider2!.encrypt(plaintext);

      // Should not be able to decrypt with wrong passphrase
      await expect(provider1!.decrypt(ct2)).rejects.toThrow();
      await expect(provider2!.decrypt(ct1)).rejects.toThrow();
    });
  });

  describe("ML-KEM Key Management", () => {
    it("should save and load ML-KEM keypair", async () => {
      const originalProvider = await WasmMlKemProvider.create();
      const { publicKey, secretKey } = originalProvider.exportKeys();

      // Save
      LocalStorageKeyManager.saveMLKEMKeys(publicKey, secretKey);
      expect(LocalStorageKeyManager.hasKey()).toBe(true);
      expect(LocalStorageKeyManager.getKeyType()).toBe("ml-kem-1024");

      // Load
      const loadedProvider = await LocalStorageKeyManager.loadMLKEMProvider();
      expect(loadedProvider).not.toBeNull();
      expect(loadedProvider!.providerId).toBe("ml-kem-1024-aes256-gcm-wasm");

      // Test encryption/decryption works
      const plaintext = new TextEncoder().encode("post-quantum test");
      const ciphertext = await originalProvider.encrypt(plaintext);
      const decrypted = await loadedProvider!.decrypt(ciphertext);
      expect(decrypted).toEqual(plaintext);
    });

    it("should handle large ML-KEM keys correctly", async () => {
      const provider = await WasmMlKemProvider.create();
      const { publicKey, secretKey } = provider.exportKeys();

      expect(publicKey.length).toBe(1568);
      expect(secretKey.length).toBe(3168);

      LocalStorageKeyManager.saveMLKEMKeys(publicKey, secretKey);
      const loaded = await LocalStorageKeyManager.loadMLKEMProvider();

      const loadedKeys = loaded!.exportKeys();
      expect(loadedKeys.publicKey).toEqual(publicKey);
      expect(loadedKeys.secretKey).toEqual(secretKey);
    });
  });

  describe("General Management", () => {
    it("should clear stored keys", () => {
      const key = crypto.getRandomValues(new Uint8Array(32));
      LocalStorageKeyManager.saveAESKey(key);

      expect(LocalStorageKeyManager.hasKey()).toBe(true);

      LocalStorageKeyManager.clear();

      expect(LocalStorageKeyManager.hasKey()).toBe(false);
      expect(LocalStorageKeyManager.getKeyType()).toBeNull();
    });

    it("should correctly identify key types", () => {
      expect(LocalStorageKeyManager.getKeyType()).toBeNull();

      LocalStorageKeyManager.saveAESKey(new Uint8Array(32));
      expect(LocalStorageKeyManager.getKeyType()).toBe("aes-256-gcm");

      LocalStorageKeyManager.clear();

      LocalStorageKeyManager.savePBKDF2Salt(new Uint8Array(16));
      expect(LocalStorageKeyManager.getKeyType()).toBe("pbkdf2-salt");
    });

    it("should overwrite previous keys", async () => {
      // Save AES key
      LocalStorageKeyManager.saveAESKey(new Uint8Array(32).fill(1));
      expect(LocalStorageKeyManager.getKeyType()).toBe("aes-256-gcm");

      // Overwrite with PBKDF2 salt
      LocalStorageKeyManager.savePBKDF2Salt(new Uint8Array(16).fill(2));
      expect(LocalStorageKeyManager.getKeyType()).toBe("pbkdf2-salt");

      // Should not be able to load as AES
      const aesProvider = await LocalStorageKeyManager.loadAESProvider();
      expect(aesProvider).toBeNull();
    });
  });
});
