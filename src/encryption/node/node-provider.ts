import { BaseEncryptionProvider } from "../encryption-provider";
import { webcrypto } from "node:crypto";

/**
 * Post-quantum hybrid encryption provider using ML-KEM-1024 for per-value key encapsulation
 * and AES-256-GCM for data encryption.
 *
 * Each encrypted value has ~1596 bytes of overhead:
 * - ML-KEM-1024 ciphertext: 1568 bytes
 * - AES-GCM IV: 12 bytes
 * - AES-GCM auth tag: 16 bytes (appended to ciphertext)
 *
 * This is length-expanding (not length-preserving).
 */

type MlKemSubtleCrypto = SubtleCrypto & {
  encapsulateKey(
    algorithm: { name: "ML-KEM-1024" },
    encapsulationKey: CryptoKey,
    sharedKeyAlgorithm: AesKeyGenParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<{ ciphertext: ArrayBuffer; sharedKey: CryptoKey }>;
  decapsulateKey(
    algorithm: { name: "ML-KEM-1024" },
    decapsulationKey: CryptoKey,
    ciphertext: BufferSource,
    sharedKeyAlgorithm: AesKeyGenParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
};

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

export class NodeProvider extends BaseEncryptionProvider {
  readonly providerId: string = "ml-kem-1024-aes256-gcm";
  readonly formatVersion: number = 1;

  private static readonly KEM_CT_LENGTH = 1568;
  private static readonly IV_LENGTH = 12;
  private static readonly MIN_AES_CT_LENGTH = 16; // empty plaintext -> tag only

  private publicKey: CryptoKey;
  private privateKey: CryptoKey;

  /**
   * Create a provider with an existing ML-KEM-1024 keypair.
   */
  constructor(publicKey: CryptoKey, privateKey: CryptoKey) {
    super();
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  /**
   * Convenience factory that generates a fresh ML-KEM-1024 keypair.
   */
  static async create(extractable = true): Promise<NodeProvider> {
    if (!webcrypto?.subtle?.generateKey) {
      throw new Error("Node.js version must be >= 24.7.0");
    }

    const cryptoKey = (await webcrypto.subtle.generateKey(
      { name: "ML-KEM-1024" } as AlgorithmIdentifier,
      extractable,
      ["encapsulateKey", "decapsulateKey"] as unknown as KeyUsage[],
    )) as CryptoKeyPair;

    if (!("publicKey" in cryptoKey) || !("privateKey" in cryptoKey)) {
      throw new Error("Unexpected key format");
    }

    return new NodeProvider(cryptoKey.publicKey, cryptoKey.privateKey);
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const subtle = webcrypto.subtle as MlKemSubtleCrypto;
    const { ciphertext: kemCt, sharedKey } = await subtle.encapsulateKey(
      { name: "ML-KEM-1024" },
      this.publicKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const iv = webcrypto.getRandomValues(
      new Uint8Array(NodeProvider.IV_LENGTH),
    );
    const aesCt = await webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBufferView(iv) },
      sharedKey,
      toArrayBufferView(plaintext),
    );

    const kemBytes = new Uint8Array(kemCt);
    const aesBytes = new Uint8Array(aesCt);

    const result = new Uint8Array(
      NodeProvider.KEM_CT_LENGTH + NodeProvider.IV_LENGTH + aesBytes.length,
    );
    result.set(kemBytes, 0);
    result.set(iv, NodeProvider.KEM_CT_LENGTH);
    result.set(aesBytes, NodeProvider.KEM_CT_LENGTH + NodeProvider.IV_LENGTH);

    return result;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (
      ciphertext.length <
      NodeProvider.KEM_CT_LENGTH +
        NodeProvider.IV_LENGTH +
        NodeProvider.MIN_AES_CT_LENGTH
    ) {
      throw new Error("Invalid ciphertext: too short");
    }

    const kemCt = toArrayBufferView(
      ciphertext.subarray(0, NodeProvider.KEM_CT_LENGTH),
    );
    const iv = toArrayBufferView(
      ciphertext.subarray(
        NodeProvider.KEM_CT_LENGTH,
        NodeProvider.KEM_CT_LENGTH + NodeProvider.IV_LENGTH,
      ),
    );
    const aesCt = toArrayBufferView(
      ciphertext.subarray(NodeProvider.KEM_CT_LENGTH + NodeProvider.IV_LENGTH),
    );

    const subtle = webcrypto.subtle as MlKemSubtleCrypto;
    const sharedKey = await subtle.decapsulateKey(
      { name: "ML-KEM-1024" },
      this.privateKey,
      kemCt,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const plaintext = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      aesCt,
    );

    return new Uint8Array(plaintext);
  }
}
