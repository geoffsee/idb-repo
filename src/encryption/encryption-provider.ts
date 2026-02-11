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

/**
 * A concrete implementation of BaseEncryptionProvider using AES-256-GCM.
 * This provider uses the Web Crypto API, making it compatible with modern
 * browsers, Node.js 19+, and Bun.
 */
export class WebCryptoEncryptionProvider extends BaseEncryptionProvider {
    readonly providerId = "aes-256-gcm";
    private cryptoKey: CryptoKey | null = null;

    /**
     * @param keyMaterial - A 256-bit (32 byte) key or a string to be hashed into a key.
     *                      If a string is provided, it is SHA-256 hashed to produce the key.
     *                      For better security with passphrases, use a provider that implements PBKDF2.
     */
    constructor(private readonly keyMaterial: Uint8Array | string) {
        super();
    }

    async initialize(): Promise<void> {
        let rawKey: Uint8Array;
        if (typeof this.keyMaterial === "string") {
            const encoder = new TextEncoder();
            const data = encoder.encode(this.keyMaterial);
            const hash = await globalThis.crypto.subtle.digest("SHA-256", data as any);
            rawKey = new Uint8Array(hash);
        } else {
            if (this.keyMaterial.length !== 32) {
                throw new Error("WebCryptoEncryptionProvider requires a 256-bit key (32 bytes)");
            }
            rawKey = this.keyMaterial;
        }

        this.cryptoKey = await globalThis.crypto.subtle.importKey(
            "raw",
            rawKey as any,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
        if (!this.cryptoKey) {
            throw new Error("WebCryptoEncryptionProvider not initialized. Call initialize() first.");
        }

        // AES-GCM standard IV length is 12 bytes
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await globalThis.crypto.subtle.encrypt(
            { name: "AES-GCM", iv } as any,
            this.cryptoKey,
            plaintext as any
        );

        // Result is IV + Ciphertext (which includes the 16-byte auth tag at the end)
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return combined;
    }

    async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
        if (!this.cryptoKey) {
            throw new Error("WebCryptoEncryptionProvider not initialized. Call initialize() first.");
        }

        if (ciphertext.length < 12 + 16) {
            throw new Error("Invalid ciphertext: too short");
        }

        const iv = ciphertext.slice(0, 12);
        const data = ciphertext.slice(12);

        try {
            const plaintext = await globalThis.crypto.subtle.decrypt(
                { name: "AES-GCM", iv } as any,
                this.cryptoKey,
                data as any
            );
            return new Uint8Array(plaintext);
        } catch (e) {
            throw new Error(`Decryption failed: ${e instanceof Error ? e.message : "Invalid key or corrupted data"}`);
        }
    }
}


/**
 * A more secure version of the AesGcmEncryptionProvider that derives the
 * encryption key from a passphrase using PBKDF2 with SHA-256.
 *
 * This includes a random salt that is stored with the ciphertext.
 */
export class PassphraseEncryptionProvider extends BaseEncryptionProvider {
    readonly providerId = "aes-256-gcm-pbkdf2";
    private cryptoKey: CryptoKey | null = null;
    private readonly salt: Uint8Array;

    /**
     * @param passphrase - The secret passphrase used to derive the key.
     * @param salt - Optional salt (16 bytes). If not provided, a random one will be generated.
     *               Note: For a single store, you usually want to use the same salt
     *               so the same passphrase always derives the same key.
     */
    constructor(private readonly passphrase: string, salt?: Uint8Array) {
        super();
        this.salt = salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
    }

    async initialize(): Promise<void> {
        const encoder = new TextEncoder();
        const passphraseKey = await globalThis.crypto.subtle.importKey(
            "raw",
            encoder.encode(this.passphrase),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        this.cryptoKey = await globalThis.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: this.salt as any,
                iterations: 100000,
                hash: "SHA-256",
            },
            passphraseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
        if (!this.cryptoKey) {
            throw new Error("PassphraseEncryptionProvider not initialized. Call initialize() first.");
        }

        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await globalThis.crypto.subtle.encrypt(
            { name: "AES-GCM", iv } as any,
            this.cryptoKey,
            plaintext as any
        );

        // Result: Salt (16) + IV (12) + Ciphertext (N + 16 tag)
        const combined = new Uint8Array(this.salt.length + iv.length + ciphertext.byteLength);
        combined.set(this.salt);
        combined.set(iv, this.salt.length);
        combined.set(new Uint8Array(ciphertext), this.salt.length + iv.length);
        return combined;
    }

    async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
        // For decryption, we might need to re-initialize if we're using the salt from the ciphertext.
        // However, this provider assumes the key is already derived.
        // If we want to support salt-in-ciphertext, we'd need a more complex initialize().
        
        if (!this.cryptoKey) {
            throw new Error("PassphraseEncryptionProvider not initialized. Call initialize() first.");
        }

        const saltOffset = 16;
        const ivOffset = saltOffset + 12;

        if (ciphertext.length < ivOffset + 16) {
            throw new Error("Invalid ciphertext: too short");
        }

        // We ignore the salt in the ciphertext for now and use the one we were initialized with.
        // In a more robust implementation, we might allow rotating salts.
        const iv = ciphertext.slice(saltOffset, ivOffset);
        const data = ciphertext.slice(ivOffset);

        try {
            const plaintext = await globalThis.crypto.subtle.decrypt(
                { name: "AES-GCM", iv } as any,
                this.cryptoKey,
                data as any
            );
            return new Uint8Array(plaintext);
        } catch (e) {
            throw new Error(`Decryption failed: ${e instanceof Error ? e.message : "Invalid passphrase or corrupted data"}`);
        }
    }

    /**
     * Helper to create a provider and initialize it in one step.
     */
    static async create(passphrase: string, salt?: Uint8Array): Promise<PassphraseEncryptionProvider> {
        const provider = new PassphraseEncryptionProvider(passphrase, salt);
        await provider.initialize();
        return provider;
    }

    getSalt(): Uint8Array {
        return new Uint8Array(this.salt);
    }
}