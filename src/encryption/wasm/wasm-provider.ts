import { BaseEncryptionProvider } from "../encryption-provider";
import type { KemKeyPair, CiphertextAndSharedSecret } from "wasm-pqc-subtle";

/**
 * Post-quantum hybrid encryption provider using ML-KEM-1024 (via WASM) for
 * per-value key encapsulation and AES-256-GCM for data encryption.
 *
 * Works in browsers, Node.js, Bun, and Deno via WebAssembly.
 *
 * Each encrypted value has ~1596 bytes of overhead:
 * - ML-KEM-1024 ciphertext: 1568 bytes
 * - AES-GCM IV: 12 bytes
 * - AES-GCM auth tag: 16 bytes (appended to ciphertext)
 *
 * This is length-expanding (not length-preserving).
 */
export class WasmMlKemProvider extends BaseEncryptionProvider {
  readonly providerId: string = "ml-kem-1024-aes256-gcm-wasm";
  readonly formatVersion: number = 1;

  private static readonly KEM_CT_LENGTH = 1568;
  private static readonly IV_LENGTH = 12;
  private static readonly MIN_AES_CT_LENGTH = 16; // empty plaintext -> tag only

  private publicKey: Uint8Array;
  private secretKey: Uint8Array;
  private wasmModule: typeof import("wasm-pqc-subtle") | null = null;
  private crypto: typeof globalThis.crypto;

  /**
   * Create a provider with an existing ML-KEM-1024 keypair.
   */
  constructor(publicKey: Uint8Array, secretKey: Uint8Array) {
    super();
    this.publicKey = publicKey;
    this.secretKey = secretKey;

    // Determine crypto implementation (browser or Node.js)
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      this.crypto = globalThis.crypto;
    } else if (typeof window !== "undefined" && window.crypto) {
      this.crypto = window.crypto;
    } else {
      // Node.js
      try {
        const { webcrypto } = require("node:crypto");
        this.crypto = webcrypto as typeof globalThis.crypto;
      } catch {
        throw new Error(
          "No crypto implementation available. Requires browser, Node.js 15+, or Bun.",
        );
      }
    }
  }

  /**
   * Initialize the WASM module. Must be called before encrypt/decrypt.
   */
  async initialize(): Promise<void> {
    const wasmPqc = await import("wasm-pqc-subtle");
    await wasmPqc.default(); // Initialize WASM
    this.wasmModule = wasmPqc;
  }

  /**
   * Convenience factory that generates a fresh ML-KEM-1024 keypair.
   */
  static async create(): Promise<WasmMlKemProvider> {
    const wasmPqc = await import("wasm-pqc-subtle");
    await wasmPqc.default(); // Initialize WASM

    const keypair = wasmPqc.ml_kem_1024_generate_keypair();
    const provider = new WasmMlKemProvider(
      keypair.public_key,
      keypair.secret_key,
    );
    provider.wasmModule = wasmPqc;

    return provider;
  }

  /**
   * Create a provider from exported key bytes (for persistence/loading).
   */
  static async fromKeys(
    publicKey: Uint8Array,
    secretKey: Uint8Array,
  ): Promise<WasmMlKemProvider> {
    const provider = new WasmMlKemProvider(publicKey, secretKey);
    await provider.initialize();
    return provider;
  }

  /**
   * Export keys for storage/transfer.
   */
  exportKeys(): { publicKey: Uint8Array; secretKey: Uint8Array } {
    return {
      publicKey: new Uint8Array(this.publicKey),
      secretKey: new Uint8Array(this.secretKey),
    };
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.wasmModule) {
      throw new Error(
        "WasmMlKemProvider not initialized. Call initialize() first.",
      );
    }

    // 1. Encapsulate: generate shared secret + KEM ciphertext
    const { ciphertext: kemCt, shared_secret: sharedSecret } =
      this.wasmModule.ml_kem_1024_encapsulate(this.publicKey);

    // 2. Import shared secret as AES-256-GCM key
    const aesKey = await this.crypto.subtle.importKey(
      "raw",
      new Uint8Array(sharedSecret),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    // 3. Generate random IV
    const iv = this.crypto.getRandomValues(
      new Uint8Array(WasmMlKemProvider.IV_LENGTH),
    );

    // 4. Encrypt plaintext with AES-GCM
    const aesCt = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      aesKey,
      new Uint8Array(plaintext),
    );

    const aesBytes = new Uint8Array(aesCt);

    // 5. Concatenate: KEM_CT || IV || AES_CT
    const result = new Uint8Array(
      WasmMlKemProvider.KEM_CT_LENGTH +
        WasmMlKemProvider.IV_LENGTH +
        aesBytes.length,
    );
    result.set(kemCt, 0);
    result.set(iv, WasmMlKemProvider.KEM_CT_LENGTH);
    result.set(
      aesBytes,
      WasmMlKemProvider.KEM_CT_LENGTH + WasmMlKemProvider.IV_LENGTH,
    );

    return result;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.wasmModule) {
      throw new Error(
        "WasmMlKemProvider not initialized. Call initialize() first.",
      );
    }

    // Validate minimum length
    if (
      ciphertext.length <
      WasmMlKemProvider.KEM_CT_LENGTH +
        WasmMlKemProvider.IV_LENGTH +
        WasmMlKemProvider.MIN_AES_CT_LENGTH
    ) {
      throw new Error("Invalid ciphertext: too short");
    }

    // 1. Extract components: KEM_CT || IV || AES_CT
    const kemCt = ciphertext.subarray(0, WasmMlKemProvider.KEM_CT_LENGTH);
    const iv = ciphertext.subarray(
      WasmMlKemProvider.KEM_CT_LENGTH,
      WasmMlKemProvider.KEM_CT_LENGTH + WasmMlKemProvider.IV_LENGTH,
    );
    const aesCt = ciphertext.subarray(
      WasmMlKemProvider.KEM_CT_LENGTH + WasmMlKemProvider.IV_LENGTH,
    );

    // 2. Decapsulate: recover shared secret from KEM ciphertext
    const sharedSecret = this.wasmModule.ml_kem_1024_decapsulate(
      this.secretKey,
      kemCt,
    );

    // 3. Import shared secret as AES-256-GCM key
    const aesKey = await this.crypto.subtle.importKey(
      "raw",
      new Uint8Array(sharedSecret),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    // 4. Decrypt AES-GCM ciphertext
    try {
      const plaintext = await this.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        aesKey,
        new Uint8Array(aesCt),
      );

      return new Uint8Array(plaintext);
    } catch (e) {
      throw new Error(
        `Decryption failed: ${e instanceof Error ? e.message : "Invalid key or corrupted data"}`,
      );
    }
  }
}
