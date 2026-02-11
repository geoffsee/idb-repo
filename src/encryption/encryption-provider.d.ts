/**
 * Abstract base class for encryption providers used by SimpleKV.
 *
 * Implementations must provide symmetric encryption/decryption that preserves
 * the exact byte length (length-preserving encryption) or clearly document
 * any length expansion (e.g. authenticated encryption with padding/IV/nonce/tag).
 *
 * All methods must be synchronous or return Promise<void>/Promise<Buffer>.
 */
export declare abstract class BaseEncryptionProvider {
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
  readonly formatVersion: number;
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
  initialize?(): Promise<void>;
  /**
   * Optional hook called before the store is closed.
   * Useful for cleaning up temporary resources, flushing caches, etc.
   */
  shutdown?(): Promise<void>;
  /**
   * Optional: returns metadata that should be stored once (usually in a header file
   * or in the first segment) to allow future readers to select the correct provider.
   */
  getProviderMetadata?(): Record<string, unknown>;
  /**
   * Optional: allows the provider to inspect or transform data before it's
   * serialized to JSON (e.g. to protect extremely sensitive fields differently).
   * Most implementations will not need this.
   */
  preSerialize?(value: unknown): Promise<unknown>;
  /**
   * Optional: inverse of preSerialize — called after JSON.parse but before
   * returning the value to the application.
   */
  postDeserialize?(raw: unknown): Promise<unknown>;
}
/**
 * A concrete implementation of BaseEncryptionProvider using AES-256-GCM.
 * This provider uses the Web Crypto API, making it compatible with modern
 * browsers, Node.js 19+, and Bun.
 */
export declare class WebCryptoEncryptionProvider extends BaseEncryptionProvider {
  private readonly keyMaterial;
  readonly providerId = "aes-256-gcm";
  private cryptoKey;
  /**
   * @param keyMaterial - A 256-bit (32 byte) key or a string to be hashed into a key.
   *                      If a string is provided, it is SHA-256 hashed to produce the key.
   *                      For better security with passphrases, use a provider that implements PBKDF2.
   */
  constructor(keyMaterial: Uint8Array | string);
  initialize(): Promise<void>;
  encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
}
/**
 * A more secure version of the AesGcmEncryptionProvider that derives the
 * encryption key from a passphrase using PBKDF2 with SHA-256.
 *
 * This includes a random salt that is stored with the ciphertext.
 */
export declare class PassphraseEncryptionProvider extends BaseEncryptionProvider {
  private readonly passphrase;
  readonly providerId = "aes-256-gcm-pbkdf2";
  private cryptoKey;
  private readonly salt;
  /**
   * @param passphrase - The secret passphrase used to derive the key.
   * @param salt - Optional salt (16 bytes). If not provided, a random one will be generated.
   *               Note: For a single store, you usually want to use the same salt
   *               so the same passphrase always derives the same key.
   */
  constructor(passphrase: string, salt?: Uint8Array);
  initialize(): Promise<void>;
  encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
  /**
   * Helper to create a provider and initialize it in one step.
   */
  static create(
    passphrase: string,
    salt?: Uint8Array,
  ): Promise<PassphraseEncryptionProvider>;
  getSalt(): Uint8Array;
}
//# sourceMappingURL=encryption-provider.d.ts.map
