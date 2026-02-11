import { BaseEncryptionProvider } from "../encryption-provider";
/**
 * A concrete implementation of BaseEncryptionProvider using AES-256-GCM
 * via the Web Crypto API. Compatible with Browsers, Node.js 19+, and Bun.
 */
export declare class WebCryptoEncryptionProvider extends BaseEncryptionProvider {
    private readonly keyMaterial;
    readonly providerId = "aes-256-gcm";
    private cryptoKey;
    constructor(keyMaterial: Uint8Array | string);
    initialize(): Promise<void>;
    encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
    decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
}
/**
 * A secure version of the WebCryptoEncryptionProvider that derives the
 * encryption key from a passphrase using PBKDF2 with SHA-256.
 */
export declare class PassphraseEncryptionProvider extends BaseEncryptionProvider {
    private readonly passphrase;
    readonly providerId = "aes-256-gcm-pbkdf2";
    private cryptoKey;
    private readonly salt;
    constructor(passphrase: string, salt?: Uint8Array);
    initialize(): Promise<void>;
    encrypt(plaintext: Uint8Array): Promise<Uint8Array>;
    decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
    static create(passphrase: string, salt?: Uint8Array): Promise<PassphraseEncryptionProvider>;
    getSalt(): Uint8Array;
}
//# sourceMappingURL=web-provider.d.ts.map