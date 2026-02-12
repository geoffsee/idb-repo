import { BaseEncryptionProvider } from "../encryption-provider";

/**
 * Encryption provider using Argon2id (via WASM) for key derivation
 * and AES-256-GCM for data encryption.
 *
 * Each encrypted value includes:
 * - AES-GCM IV: 12 bytes
 * - AES-GCM ciphertext + 16-byte auth tag
 *
 * The PHC string (containing salt and hash) is managed by the caller
 * or stored in metadata.
 */
export class WasmArgon2Provider extends BaseEncryptionProvider {
  readonly providerId: string = "argon2id-aes256-gcm-wasm";
  readonly formatVersion: number = 1;

  private static readonly IV_LENGTH = 12;
  private static readonly MIN_AES_CT_LENGTH = 16;

  private cryptoKey: CryptoKey | null = null;
  private wasmModule: typeof import("wasm-pqc-subtle") | null = null;
  private crypto: typeof globalThis.crypto;

  /**
   * Create a provider with a passphrase and a PHC string.
   * If phc is not provided, it must be generated using `create()`.
   */
  constructor(
    private readonly passphrase: string,
    private phc?: string,
  ) {
    super();

    // Determine crypto implementation
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      this.crypto = globalThis.crypto;
    } else if (typeof window !== "undefined" && window.crypto) {
      this.crypto = window.crypto;
    } else {
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
   * Initialize the WASM module and derive the encryption key.
   */
  async initialize(): Promise<void> {
    const wasmPqc = await import("wasm-pqc-subtle");
    await wasmPqc.default();
    this.wasmModule = wasmPqc;

    if (!this.phc) {
      const passwordBytes = new TextEncoder().encode(this.passphrase);
      this.phc = wasmPqc.argon2id_hash(passwordBytes);
    } else {
      // Verify password against PHC to ensure we derive the correct key
      const passwordBytes = new TextEncoder().encode(this.passphrase);
      if (!wasmPqc.argon2_verify(passwordBytes, this.phc)) {
        throw new Error("Invalid passphrase for the provided PHC");
      }
    }

    // Extract raw hash from PHC
    const parts = this.phc.split("$");
    const hashBase64 = parts[parts.length - 1];

    // Decode Base64 (Argon2 PHC uses no-padding Base64)
    const normalizedBase64 = hashBase64
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(hashBase64.length + ((4 - (hashBase64.length % 4)) % 4), "=");

    let hashBytes: Uint8Array;
    if (typeof Buffer !== "undefined") {
      hashBytes = new Uint8Array(Buffer.from(normalizedBase64, "base64"));
    } else {
      const binaryString = globalThis.atob(normalizedBase64);
      hashBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        hashBytes[i] = binaryString.charCodeAt(i);
      }
    }

    if (hashBytes.length !== 32) {
      throw new Error(`Invalid Argon2 hash length: expected 32 bytes, got ${hashBytes.length}`);
    }

    // Import as AES-GCM key
    this.cryptoKey = await this.crypto.subtle.importKey(
      "raw",
      hashBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Convenience factory that generates a new PHC and initializes the provider.
   */
  static async create(passphrase: string, phc?: string): Promise<WasmArgon2Provider> {
    const provider = new WasmArgon2Provider(passphrase, phc);
    await provider.initialize();
    return provider;
  }

  /**
   * Returns the PHC string used by this provider.
   */
  getPHC(): string {
    if (!this.phc) {
      throw new Error("Provider not initialized");
    }
    return this.phc;
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.cryptoKey) {
      throw new Error("WasmArgon2Provider not initialized. Call initialize() first.");
    }

    const iv = this.crypto.getRandomValues(new Uint8Array(WasmArgon2Provider.IV_LENGTH));
    const aesCt = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.cryptoKey,
      plaintext,
    );

    const aesBytes = new Uint8Array(aesCt);
    const result = new Uint8Array(WasmArgon2Provider.IV_LENGTH + aesBytes.length);
    result.set(iv, 0);
    result.set(aesBytes, WasmArgon2Provider.IV_LENGTH);

    return result;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.cryptoKey) {
      throw new Error("WasmArgon2Provider not initialized. Call initialize() first.");
    }

    if (ciphertext.length < WasmArgon2Provider.IV_LENGTH + WasmArgon2Provider.MIN_AES_CT_LENGTH) {
      throw new Error("Invalid ciphertext: too short");
    }

    const iv = ciphertext.subarray(0, WasmArgon2Provider.IV_LENGTH);
    const aesCt = ciphertext.subarray(WasmArgon2Provider.IV_LENGTH);

    try {
      const plaintext = await this.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        this.cryptoKey,
        aesCt,
      );
      return new Uint8Array(plaintext);
    } catch (e) {
      throw new Error(
        `Decryption failed: ${e instanceof Error ? e.message : "Invalid key or corrupted data"}`,
      );
    }
  }

  override getProviderMetadata(): Record<string, unknown> {
    return {
      provider: this.providerId,
      version: this.formatVersion,
      phc: this.phc,
    };
  }
}
