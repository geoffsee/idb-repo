/**
 * Abstract base class for encryption providers used by SimpleKV.
 *
 * Implementations must provide symmetric encryption/decryption that preserves
 * the exact byte length (length-preserving encryption) or clearly document
 * any length expansion (e.g. authenticated encryption with padding/IV/nonce/tag).
 *
 * All methods must be synchronous or return Promise<void>/Promise<Buffer>.
 */
export abstract class BaseEncryptionProvider {
  /**
   * A short, unique identifier for this encryption provider.
   * Used for storage format versioning and debugging.
   *
   * Recommended format: "family-version-mode", e.g. "aes256-gcm-2025", "xchacha20-poly1305"
   */
  abstract readonly providerId: string;

  /**
   * Optional version number (increment when breaking changes are made to the
   * encryption format produced by this provider).
   *
   * Default: 1
   */
  readonly formatVersion: number = 1;

  /**
   * Encrypts the given plaintext buffer.
   *
   * @param plaintext - The data to encrypt (typically JSON-serialized value)
   * @param keyId - Optional identifier of the key being used (for key rotation support)
   * @returns Promise containing the ciphertext (may include IV/nonce/auth tag)
   */
  abstract encrypt(plaintext: Uint8Array, keyId?: string): Promise<Uint8Array>;

  /**
   * Decrypts the given ciphertext buffer.
   *
   * @param ciphertext - The encrypted data (as returned by encrypt)
   * @param keyId - Optional key identifier (must match the one used during encryption if provided)
   * @returns Promise containing the original plaintext
   * @throws Error if decryption fails (wrong key, corrupted data, invalid format, etc.)
   */
  abstract decrypt(ciphertext: Uint8Array, keyId?: string): Promise<Uint8Array>;

  /**
   * Optional hook called once when the store is opened.
   * Useful for:
   * - validating key material
   * - deriving per-store sub-keys
   * - loading key from secure storage
   * - logging provider initialization
   */
  async initialize?(): Promise<void>;

  /**
   * Optional hook called before the store is closed.
   * Useful for cleaning up temporary resources, flushing caches, etc.
   */
  async shutdown?(): Promise<void>;

  /**
   * Optional: returns metadata that should be stored once (usually in a header file
   * or in the first segment) to allow future readers to select the correct provider.
   */
  getProviderMetadata?(): Record<string, unknown> {
    return {
      provider: this.providerId,
      version: this.formatVersion,
    };
  }

  /**
   * Optional: allows the provider to inspect or transform data before it's
   * serialized to JSON (e.g. to protect extremely sensitive fields differently).
   * Most implementations will not need this.
   */
  async preSerialize?(value: unknown): Promise<unknown> {
    return value;
  }

  /**
   * Optional: inverse of preSerialize — called after JSON.parse but before
   * returning the value to the application.
   */
  async postDeserialize?(raw: unknown): Promise<unknown> {
    return raw;
  }
}
