/**
 * Key Management Utilities
 *
 * Helper functions for persisting and recovering encryption keys.
 * SECURITY WARNING: These examples use localStorage for convenience,
 * but production apps should use secure backend storage.
 */

import { WebCryptoEncryptionProvider } from "./web/web-provider";
import { PassphraseEncryptionProvider } from "./web/web-provider";
import { WasmMlKemProvider } from "./wasm/wasm-provider";

export interface StoredAESKey {
  type: "aes-256-gcm";
  key: string; // base64-encoded
}

export interface StoredPBKDF2Salt {
  type: "pbkdf2-salt";
  salt: string; // base64-encoded
}

export interface StoredMLKEMKeys {
  type: "ml-kem-1024";
  publicKey: string; // base64-encoded
  secretKey: string; // base64-encoded
}

export type StoredKey = StoredAESKey | StoredPBKDF2Salt | StoredMLKEMKeys;

/**
 * Utilities for browser localStorage persistence (convenient but less secure)
 */
export class LocalStorageKeyManager {
  private static readonly STORAGE_KEY = "idb-repo-encryption-key";

  /**
   * Save AES-256-GCM key to localStorage
   */
  static saveAESKey(key: Uint8Array): void {
    const stored: StoredAESKey = {
      type: "aes-256-gcm",
      key: btoa(String.fromCharCode(...key)),
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
  }

  /**
   * Load AES-256-GCM key from localStorage and create provider
   */
  static async loadAESProvider(): Promise<WebCryptoEncryptionProvider | null> {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return null;

    const parsed: StoredKey = JSON.parse(stored);
    if (parsed.type !== "aes-256-gcm") return null;

    const key = Uint8Array.from(atob(parsed.key), (c) => c.charCodeAt(0));
    const provider = new WebCryptoEncryptionProvider(key);
    await provider.initialize();
    return provider;
  }

  /**
   * Save PBKDF2 salt to localStorage
   */
  static savePBKDF2Salt(salt: Uint8Array): void {
    const stored: StoredPBKDF2Salt = {
      type: "pbkdf2-salt",
      salt: btoa(String.fromCharCode(...salt)),
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
  }

  /**
   * Load PBKDF2 salt and create provider from passphrase
   */
  static async loadPBKDF2Provider(
    passphrase: string,
  ): Promise<PassphraseEncryptionProvider | null> {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return null;

    const parsed: StoredKey = JSON.parse(stored);
    if (parsed.type !== "pbkdf2-salt") return null;

    const salt = Uint8Array.from(atob(parsed.salt), (c) => c.charCodeAt(0));
    return await PassphraseEncryptionProvider.create(passphrase, salt);
  }

  /**
   * Save ML-KEM keypair to localStorage
   */
  static saveMLKEMKeys(publicKey: Uint8Array, secretKey: Uint8Array): void {
    const stored: StoredMLKEMKeys = {
      type: "ml-kem-1024",
      publicKey: btoa(String.fromCharCode(...publicKey)),
      secretKey: btoa(String.fromCharCode(...secretKey)),
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
  }

  /**
   * Load ML-KEM keypair from localStorage and create provider
   */
  static async loadMLKEMProvider(): Promise<WasmMlKemProvider | null> {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return null;

    const parsed: StoredKey = JSON.parse(stored);
    if (parsed.type !== "ml-kem-1024") return null;

    const publicKey = Uint8Array.from(atob(parsed.publicKey), (c) =>
      c.charCodeAt(0),
    );
    const secretKey = Uint8Array.from(atob(parsed.secretKey), (c) =>
      c.charCodeAt(0),
    );

    return await WasmMlKemProvider.fromKeys(publicKey, secretKey);
  }

  /**
   * Clear all stored keys (use when user logs out)
   */
  static clear(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Check if any key is stored
   */
  static hasKey(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }

  /**
   * Get the type of stored key
   */
  static getKeyType(): string | null {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return null;

    const parsed: StoredKey = JSON.parse(stored);
    return parsed.type;
  }
}

/**
 * Generic key serialization utilities (for custom storage backends)
 */
export class KeySerializer {
  /**
   * Serialize any Uint8Array key to base64 string
   */
  static serialize(key: Uint8Array): string {
    return btoa(String.fromCharCode(...key));
  }

  /**
   * Deserialize base64 string back to Uint8Array
   */
  static deserialize(encoded: string): Uint8Array {
    return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  }

  /**
   * Serialize ML-KEM keypair to JSON
   */
  static serializeMLKEMKeys(
    publicKey: Uint8Array,
    secretKey: Uint8Array,
  ): string {
    return JSON.stringify({
      pub: this.serialize(publicKey),
      sec: this.serialize(secretKey),
    });
  }

  /**
   * Deserialize ML-KEM keypair from JSON
   */
  static deserializeMLKEMKeys(json: string): {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } {
    const { pub, sec } = JSON.parse(json);
    return {
      publicKey: this.deserialize(pub),
      secretKey: this.deserialize(sec),
    };
  }
}

/**
 * Example: Secure backend storage adapter
 * (You would implement this with your actual backend API)
 */
export class BackendKeyManager {
  constructor(private apiUrl: string, private authToken: string) {}

  /**
   * Save key to secure backend
   */
  async saveKey(userId: string, key: StoredKey): Promise<void> {
    const response = await fetch(`${this.apiUrl}/keys/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(key),
    });

    if (!response.ok) {
      throw new Error(`Failed to save key: ${response.statusText}`);
    }
  }

  /**
   * Load key from secure backend
   */
  async loadKey(userId: string): Promise<StoredKey | null> {
    const response = await fetch(`${this.apiUrl}/keys/${userId}`, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to load key: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Delete key from backend (when user requests data deletion)
   */
  async deleteKey(userId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/keys/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete key: ${response.statusText}`);
    }
  }
}
