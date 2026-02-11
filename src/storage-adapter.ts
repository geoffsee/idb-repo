import type {
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

  constructor(
    private backend: StorageBackend,
    opts?: { cacheEntries?: number },
  ) {
    this.cache = new TinyLRU(opts?.cacheEntries ?? 2048);
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

    let decoded = decodeValue(rec, wantType);

    if (rec.encoding === "binary") {
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

    if (cacheKey) this.cache.set(cacheKey, decoded, meta, cacheTtl);

    return { value: decoded, metadata: meta };
  }

  async put(
    key: string,
    value: KVValue,
    options?: KVPutOptions,
  ): Promise<void> {
    assertKey(key);

    const { encoding, stored } = await normalizePutValue(value);
    const expiresAt = computeExpiresAtMs(options);

    const t = nowMs();
    const rec: StoredRecord = {
      key,
      value: stored,
      encoding,
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
    await this.backend.close();
    this.cache.clear();
  }
}
