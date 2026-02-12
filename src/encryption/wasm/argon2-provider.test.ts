import { describe, expect, it } from "vitest";
import { WasmArgon2Provider } from "./argon2-provider";

describe("WasmArgon2Provider", () => {
  it("should encrypt and decrypt correctly", async () => {
    const passphrase = "correct-passphrase";
    const plaintext = new TextEncoder().encode("Hello, Argon2!");

    const provider = await WasmArgon2Provider.create(passphrase);
    const ciphertext = await provider.encrypt(plaintext);

    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext.length).toBe(12 + plaintext.length + 16); // IV + Plaintext + Tag

    const decrypted = await provider.decrypt(ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("Hello, Argon2!");
  });

  it("should decrypt with the same PHC and passphrase", async () => {
    const passphrase = "stable-passphrase";
    const plaintext = new TextEncoder().encode("Persistent secret");

    const provider1 = await WasmArgon2Provider.create(passphrase);
    const phc = provider1.getPHC();
    const ciphertext = await provider1.encrypt(plaintext);

    const provider2 = await WasmArgon2Provider.create(passphrase, phc);
    const decrypted = await provider2.decrypt(ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe("Persistent secret");
  });

  it("should fail with wrong passphrase during initialization", async () => {
    const passphrase = "correct";
    const wrongPassphrase = "wrong";
    
    const provider1 = await WasmArgon2Provider.create(passphrase);
    const phc = provider1.getPHC();

    await expect(WasmArgon2Provider.create(wrongPassphrase, phc)).rejects.toThrow("Invalid passphrase for the provided PHC");
  });

  it("should have correct provider metadata", async () => {
    const provider = await WasmArgon2Provider.create("pass");
    const metadata = provider.getProviderMetadata();
    
    expect(metadata.provider).toBe("argon2id-aes256-gcm-wasm");
    expect(metadata.phc).toBe(provider.getPHC());
  });
});
