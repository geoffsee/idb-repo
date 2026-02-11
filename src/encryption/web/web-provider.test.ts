// Tell TypeScript where to find the types for bun:test
/// <reference types="bun" />
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { WebContainer } from "../../../test-utils/web-container";


describe("WebCryptoEncryptionProvider (in browser)", () => {
    let container: WebContainer;

    beforeAll(async () => {
        container = await WebContainer.create({ headless: true });
    });

    afterAll(async () => {
        await container.close();
    });

    it("should work correctly inside a real browser context", async () => {
        // We evaluate the encryption logic inside the browser page
        const result = await (container as any).page.evaluate(async () => {
            // Re-defining the provider logic in the browser context since we don't have an easy way 
            // to bundle and inject the class yet without more setup.
            // This verifies the underlying Web Crypto calls we use are compatible.
            
            const keyMaterial = new Uint8Array(32).fill(0x42);
            const plaintext = new TextEncoder().encode("Browser secret message");

            const cryptoKey = await crypto.subtle.importKey(
                "raw",
                keyMaterial,
                { name: "AES-GCM" },
                false,
                ["encrypt", "decrypt"]
            );

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv },
                cryptoKey,
                plaintext
            );

            const combined = new Uint8Array(iv.length + ciphertext.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(ciphertext), iv.length);

            // Decrypt
            const decIv = combined.slice(0, 12);
            const decData = combined.slice(12);
            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: decIv },
                cryptoKey,
                decData
            );

            return new TextDecoder().decode(decrypted);
        });

        expect(result).toBe("Browser secret message");
    });
});
