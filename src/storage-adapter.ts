import type {
  KVAdapterOptions,
  KVGetOptions,
  KVListOptions,
  KVListResult,
  KVNamespace,
  KVPutOptions,
  KVValue,
  StoredRecord,
} from "./types";
import type { StorageBackend } from "./storage-backend";
import { TinyLRU } from "./internal/cache";
import { assertKey } from "./internal/validation";
import { computeExpiresAtMs, isExpired } from "./internal/ttl";
import { nowMs } from "./time-utils";
import {
  decodeValue,
  normalizePutValue,
  blobToArrayBuffer,
  blobToJson,
  blobToText,
} from "./internal/value-codec";

/**
 * KVStorageAdapter implements KVNamespace over any StorageBackend.
 * It provides caching, TTL handling, and value encoding/decoding.
 */
export class KVStorageAdapter implements KVNamespace {
  private cache: TinyLRU;
  private encryptionProvider?: KVAdapterOptions["encryptionProvider"];
  private encryptionKeyId?: string;
  private encryptionReady: Promise<void> | null = null;

  constructor(
    private backend: StorageBackend,
    private opts?: KVAdapterOptions,
  ) {
    this.cache = new TinyLRU(opts?.cacheEntries ?? 2048);
    this.encryptionProvider = opts?.encryptionProvider;
    this.encryptionKeyId = opts?.encryptionKeyId;
  }

  private async ensureEncryptionReady(): Promise<void> {
    if (!this.encryptionProvider?.initialize) return;
    if (!this.encryptionReady) {
      this.encryptionReady = this.encryptionProvider.initialize();
    }
    await this.encryptionReady;
  }

  private async encodeForEncryption(
    encoding: StoredRecord["encoding"],
    storedValue: unknown,
  ): Promise<Uint8Array> {
    const header = new Uint8Array(2);
    header[0] = 1;
    header[1] = this.encodingToFlag(encoding);

    let payload: Uint8Array;
    if (encoding === "binary") {
      const buf = await blobToArrayBuffer(storedValue as Blob);
      payload = new Uint8Array(buf);
    } else if (encoding === "clone") {
      const json = JSON.stringify(storedValue);
      if (json === undefined) {
        throw new TypeError("Stored value cannot be represented as JSON text");
      }
      payload = new TextEncoder().encode(json);
    } else {
      payload = new TextEncoder().encode(String(storedValue));
    }

    const plaintext = new Uint8Array(header.length + payload.length);
    plaintext.set(header, 0);
    plaintext.set(payload, header.length);
    return plaintext;
  }

  private decodeEncryptedPayload(plaintext: Uint8Array): {
    encoding: StoredRecord["encoding"];
    value: unknown;
  } {
    if (plaintext.length < 2 || plaintext[0] !== 1) {
      throw new Error("Invalid encrypted payload");
    }

    const encoding = this.flagToEncoding(plaintext[1] ?? 255);
    const payload = plaintext.subarray(2);

    if (encoding === "binary") {
      return { encoding, value: new Blob([Uint8Array.from(payload)]) };
    }

    const text = new TextDecoder().decode(payload);
    if (encoding === "clone") {
      return { encoding, value: JSON.parse(text) };
    }
    return { encoding, value: text };
  }

  private encodingToFlag(encoding: StoredRecord["encoding"]): number {
    if (encoding === "text") return 0;
    if (encoding === "json") return 1;
    if (encoding === "clone") return 2;
    return 3;
  }

  private flagToEncoding(flag: number): StoredRecord["encoding"] {
    if (flag === 0) return "text";
    if (flag === 1) return "json";
    if (flag === 2) return "clone";
    if (flag === 3) return "binary";
    throw new Error("Unknown encrypted encoding flag");
  }

  private invalidateCache(key: string): void {
    this.cache.delete(`${key}::text`);
    this.cache.delete(`${key}::json`);
    this.cache.delete(`${key}::arrayBuffer`);
    this.cache.delete(`${key}::stream`);
  }

  async get(
    key: string,
    options?: KVGetOptions,
  ): Promise<
    string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null
  > {
    const { value } = await this.getWithMetadata(key, options);
    return value;
  }

  async getWithMetadata<T = unknown>(
    key: string,
    options?: KVGetOptions,
  ): Promise<{
    value: string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null;
    metadata: T | null;
  }> {
    assertKey(key);

    const wantType = options?.type ?? "text";
    const cacheTtl = options?.cacheTtl ?? 0;
    const cacheKey = cacheTtl > 0 ? `${key}::${wantType}` : null;

    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit) return { value: hit.value, metadata: hit.meta as T };
    }

    const rec = await this.backend.get(key);
    if (!rec) return { value: null, metadata: null };

    if (isExpired(rec)) {
      void this.delete(key);
      return { value: null, metadata: null };
    }

    let effectiveRecord = rec;
    if (this.encryptionProvider) {
      await this.ensureEncryptionReady();

      if (effectiveRecord.encoding !== "binary") {
        throw new Error("Encrypted records must be stored as binary");
      }

      const encrypted = await blobToArrayBuffer(effectiveRecord.value as Blob);
      const plaintext = await this.encryptionProvider.decrypt(
        new Uint8Array(encrypted),
        this.encryptionKeyId,
      );
      const decrypted = this.decodeEncryptedPayload(plaintext);
      effectiveRecord = {
        ...effectiveRecord,
        encoding: decrypted.encoding,
        value: decrypted.value,
      };
    }

    let decoded = decodeValue(effectiveRecord, wantType);

    if (effectiveRecord.encoding === "binary") {
      const blob = decoded as unknown as Blob;
      if (wantType === "stream") {
        decoded = (blob.stream() as ReadableStream<Uint8Array>) ?? null;
      } else if (wantType === "arrayBuffer") {
        decoded = await blobToArrayBuffer(blob);
      } else if (wantType === "json") {
        decoded = await blobToJson(blob);
      } else {
        decoded = await blobToText(blob);
      }
    }

    const meta = (rec.metadata ?? null) as T | null;

    if (
      this.encryptionProvider?.postDeserialize &&
      wantType === "json" &&
      decoded !== null
    ) {
      decoded = await this.encryptionProvider.postDeserialize(decoded);
    }

    if (cacheKey) this.cache.set(cacheKey, decoded, meta, cacheTtl);

    return { value: decoded, metadata: meta };
  }

  async put(
    key: string,
    value: KVValue,
    options?: KVPutOptions,
  ): Promise<void> {
    assertKey(key);

    await this.ensureEncryptionReady();

    const valueToStore = this.encryptionProvider?.preSerialize
      ? await this.encryptionProvider.preSerialize(value)
      : value;

    const { encoding, stored } = await normalizePutValue(valueToStore);
    const expiresAt = computeExpiresAtMs(options);

    const t = nowMs();
    let recordEncoding = encoding;
    let recordValue = stored;
    if (this.encryptionProvider) {
      const plaintext = await this.encodeForEncryption(encoding, stored);
      const ciphertext = await this.encryptionProvider.encrypt(
        plaintext,
        this.encryptionKeyId,
      );
      recordEncoding = "binary";
      recordValue = new Blob([Uint8Array.from(ciphertext)]);
    }

    const rec: StoredRecord = {
      key,
      value: recordValue,
      encoding: recordEncoding,
      expiresAt,
      metadata: options?.metadata ?? null,
      createdAt: t,
      updatedAt: t,
    };

    await this.backend.put(rec);
    this.invalidateCache(key);
  }

  async delete(key: string): Promise<void> {
    assertKey(key);

    await this.backend.delete(key);
    this.invalidateCache(key);
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    return this.backend.list(options ?? {});
  }

  async close(): Promise<void> {
    if (this.encryptionProvider?.shutdown) {
      await this.encryptionProvider.shutdown();
    }
    await this.backend.close();
    this.cache.clear();
  }
}
