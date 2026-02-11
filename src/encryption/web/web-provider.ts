import { BaseEncryptionProvider } from "../encryption-provider";

/**
 * A concrete implementation of BaseEncryptionProvider using AES-256-GCM
 * via the Web Crypto API. Compatible with Browsers, Node.js 19+, and Bun.
 */
export class WebCryptoEncryptionProvider extends BaseEncryptionProvider {
    readonly providerId = "aes-256-gcm";
    private cryptoKey: CryptoKey | null = null;

    constructor(private readonly keyMaterial: Uint8Array | string) {
        super();
    }

    async initialize(): Promise<void> {
        let rawKey: Uint8Array;
        if (typeof this.keyMaterial === "string") {
            const encoder = new TextEncoder();
            const data = encoder.encode(this.keyMaterial);
            const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
            rawKey = new Uint8Array(hash);
        } else {
            if (this.keyMaterial.length !== 32) {
                throw new Error("WebCryptoEncryptionProvider requires a 256-bit key (32 bytes)");
            }
            rawKey = this.keyMaterial;
        }

        this.cryptoKey = await globalThis.crypto.subtle.importKey(
            "raw",
            toArrayBuffer(rawKey),
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
        if (!this.cryptoKey) {
            throw new Error("WebCryptoEncryptionProvider not initialized. Call initialize() first.");
        }

        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await globalThis.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.cryptoKey,
            toArrayBuffer(plaintext)
        );

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
                { name: "AES-GCM", iv },
                this.cryptoKey,
                toArrayBuffer(data)
            );
            return new Uint8Array(plaintext);
        } catch (e) {
            throw new Error(`Decryption failed: ${e instanceof Error ? e.message : "Invalid key or corrupted data"}`);
        }
    }
}

/**
 * A secure version of the WebCryptoEncryptionProvider that derives the
 * encryption key from a passphrase using PBKDF2 with SHA-256.
 */
export class PassphraseEncryptionProvider extends BaseEncryptionProvider {
    readonly providerId = "aes-256-gcm-pbkdf2";
    private cryptoKey: CryptoKey | null = null;
    private readonly salt: Uint8Array;

    constructor(private readonly passphrase: string, salt?: Uint8Array) {
        super();
        this.salt = salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
    }

    async initialize(): Promise<void> {
        const encoder = new TextEncoder();
        const passphraseKey = await globalThis.crypto.subtle.importKey(
            "raw",
            toArrayBuffer(encoder.encode(this.passphrase)),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        this.cryptoKey = await globalThis.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: toArrayBuffer(this.salt),
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
            { name: "AES-GCM", iv },
            this.cryptoKey,
            toArrayBuffer(plaintext)
        );

        const combined = new Uint8Array(this.salt.length + iv.length + ciphertext.byteLength);
        combined.set(this.salt);
        combined.set(iv, this.salt.length);
        combined.set(new Uint8Array(ciphertext), this.salt.length + iv.length);
        return combined;
    }

    async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
        if (!this.cryptoKey) {
            throw new Error("PassphraseEncryptionProvider not initialized. Call initialize() first.");
        }

        const saltOffset = 16;
        const ivOffset = saltOffset + 12;

        if (ciphertext.length < ivOffset + 16) {
            throw new Error("Invalid ciphertext: too short");
        }

        const iv = ciphertext.slice(saltOffset, ivOffset);
        const data = ciphertext.slice(ivOffset);

        try {
            const plaintext = await globalThis.crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                this.cryptoKey,
                toArrayBuffer(data)
            );
            return new Uint8Array(plaintext);
        } catch (e) {
            throw new Error(`Decryption failed: ${e instanceof Error ? e.message : "Invalid passphrase or corrupted data"}`);
        }
    }

    static async create(passphrase: string, salt?: Uint8Array): Promise<PassphraseEncryptionProvider> {
        const provider = new PassphraseEncryptionProvider(passphrase, salt);
        await provider.initialize();
        return provider;
    }

    getSalt(): Uint8Array {
        return new Uint8Array(this.salt);
    }
}

function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
    const target = new ArrayBuffer(view.byteLength);
    new Uint8Array(target).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return target;
}
