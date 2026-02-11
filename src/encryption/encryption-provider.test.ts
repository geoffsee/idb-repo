import { describe, expect, it, beforeAll } from "bun:test";
import { WebCryptoEncryptionProvider, PassphraseEncryptionProvider } from "./encryption-provider";

describe("WebCryptoEncryptionProvider", () => {
    let provider: WebCryptoEncryptionProvider;
    const testKey = new Uint8Array(32).fill(0x42);
    const testPlaintext = new TextEncoder().encode("Hello, World! This is a secret message.");

    beforeAll(async () => {
        provider = new WebCryptoEncryptionProvider(testKey);
        await provider.initialize();
    });

    it("should have the correct providerId", () => {
        expect(provider.providerId).toBe("aes-256-gcm");
    });

    it("should encrypt and decrypt correctly", async () => {
        const ciphertext = await provider.encrypt(testPlaintext);
        expect(ciphertext).not.toEqual(testPlaintext);
        expect(ciphertext.length).toBeGreaterThan(testPlaintext.length);

        const decrypted = await provider.decrypt(ciphertext);
        expect(decrypted).toEqual(testPlaintext);
        expect(new TextDecoder().decode(decrypted)).toBe("Hello, World! This is a secret message.");
    });

    it("should produce different ciphertext for the same plaintext (unique IVs)", async () => {
        const ciphertext1 = await provider.encrypt(testPlaintext);
        const ciphertext2 = await provider.encrypt(testPlaintext);

        expect(ciphertext1).not.toEqual(ciphertext2);

        const decrypted1 = await provider.decrypt(ciphertext1);
        const decrypted2 = await provider.decrypt(ciphertext2);

        expect(decrypted1).toEqual(testPlaintext);
        expect(decrypted2).toEqual(testPlaintext);
    });

    it("should initialize from a string passphrase (simple hash)", async () => {
        const stringProvider = new WebCryptoEncryptionProvider("my-secret-passphrase");
        await stringProvider.initialize();

        const ciphertext = await stringProvider.encrypt(testPlaintext);
        const decrypted = await stringProvider.decrypt(ciphertext);

        expect(decrypted).toEqual(testPlaintext);
    });

    it("should throw error if decrypting with wrong key", async () => {
        const provider1 = new WebCryptoEncryptionProvider(new Uint8Array(32).fill(0x01));
        await provider1.initialize();
        
        const provider2 = new WebCryptoEncryptionProvider(new Uint8Array(32).fill(0x02));
        await provider2.initialize();

        const ciphertext = await provider1.encrypt(testPlaintext);
        
        await expect(provider2.decrypt(ciphertext)).rejects.toThrow("Decryption failed");
    });

    it("should throw error if ciphertext is tampered with", async () => {
        const ciphertext = await provider.encrypt(testPlaintext);
        const tampered = new Uint8Array(ciphertext);
        const indexValue = tampered[20] ?? 0;
        tampered[20] = indexValue ^ 0x01;

        await expect(provider.decrypt(tampered)).rejects.toThrow("Decryption failed");
    });

    it("should throw error if ciphertext is too short", async () => {
        const tooShort = new Uint8Array(10);
        await expect(provider.decrypt(tooShort)).rejects.toThrow("Invalid ciphertext: too short");
    });

    it("should throw if not initialized", async () => {
        const uninit = new WebCryptoEncryptionProvider(testKey);
        // Skip initialize()
        await expect(uninit.encrypt(testPlaintext)).rejects.toThrow("not initialized");
    });

    it("should validate key length if Uint8Array provided", async () => {
        const invalidKey = new Uint8Array(16); // 128-bit key not supported by our implementation (expects 256)
        const badProvider = new WebCryptoEncryptionProvider(invalidKey);
        await expect(badProvider.initialize()).rejects.toThrow("requires a 256-bit key (32 bytes)");
    });
});

describe("PassphraseEncryptionProvider", () => {
    const passphrase = "correct horse battery staple";
    const testPlaintext = new TextEncoder().encode("Secret message derived from PBKDF2");

    it("should have the correct providerId", async () => {
        const provider = new PassphraseEncryptionProvider(passphrase);
        expect(provider.providerId).toBe("aes-256-gcm-pbkdf2");
    });

    it("should encrypt and decrypt with a derived key", async () => {
        const provider = await PassphraseEncryptionProvider.create(passphrase);
        const ciphertext = await provider.encrypt(testPlaintext);
        
        const decrypted = await provider.decrypt(ciphertext);
        expect(decrypted).toEqual(testPlaintext);
    });

    it("should use a consistent salt if provided", async () => {
        const salt = new Uint8Array(16).fill(0x07);
        const provider1 = await PassphraseEncryptionProvider.create(passphrase, salt);
        const provider2 = await PassphraseEncryptionProvider.create(passphrase, salt);

        const ciphertext = await provider1.encrypt(testPlaintext);
        const decrypted = await provider2.decrypt(ciphertext);
        
        expect(decrypted).toEqual(testPlaintext);
    });

    it("should fail to decrypt with wrong passphrase", async () => {
        const salt = new Uint8Array(16).fill(0x07);
        const provider1 = await PassphraseEncryptionProvider.create(passphrase, salt);
        const provider2 = await PassphraseEncryptionProvider.create("wrong passphrase", salt);

        const ciphertext = await provider1.encrypt(testPlaintext);
        await expect(provider2.decrypt(ciphertext)).rejects.toThrow("Decryption failed");
    });

    it("should generate a random salt if not provided", async () => {
        const provider1 = new PassphraseEncryptionProvider(passphrase);
        const provider2 = new PassphraseEncryptionProvider(passphrase);
        
        expect(provider1.getSalt()).not.toEqual(provider2.getSalt());
    });
});
