import type {
  KVListOptions,
  KVListResult,
  StoredRecord,
  KVListKey,
} from "./types";
import { nowMs, toEpochSeconds } from "./time-utils";
import { encodeCursor, decodeCursor } from "./internal/cursor";
import { IndexedDbConnection } from "./connection";
import { promisifyRequest, waitTx } from "./internal/idb-utils";

/**
 * Interface for low-level storage backends
 */
export interface StorageBackend {
  get(key: string): Promise<StoredRecord | undefined>;
  put(record: StoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: KVListOptions): Promise<KVListResult>;
  close(): Promise<void>;
}

/**
 * In-memory storage backend for Node.js and browser fallback
 */
export class MemoryStorageBackend implements StorageBackend {
  private data = new Map<string, StoredRecord>();

  async get(key: string): Promise<StoredRecord | undefined> {
    return this.data.get(key);
  }

  async put(record: StoredRecord): Promise<void> {
    this.data.set(record.key, { ...record });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(options: KVListOptions): Promise<KVListResult> {
    const prefix = options.prefix ?? "";
    const limit = Math.min(Math.max(1, options.limit ?? 1000), 10000);
    const cursorRaw = options.cursor ?? null;

    let after: string | null = null;
    if (cursorRaw) {
      const decoded = decodeCursor(cursorRaw);
      if (decoded && decoded.prefix === prefix) after = decoded.after;
    }

    const now = nowMs();

    // Filter and sort all keys
    let keys = Array.from(this.data.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();

    // Apply cursor
    if (after !== null) {
      const idx = keys.findIndex((k) => k > after);
      keys = idx >= 0 ? keys.slice(idx) : [];
    }

    const resultKeys: KVListKey[] = [];
    let lastKey: string | null = null;
    let listComplete = true;

    for (const key of keys) {
      if (resultKeys.length >= limit) {
        listComplete = false;
        break;
      }

      const rec = this.data.get(key);
      if (!rec) continue;

      if (rec.expiresAt && rec.expiresAt <= now) {
        // Background GC would happen here in a real store
        continue;
      }

      const result: KVListKey = { name: key };
      if (rec.expiresAt) result.expiration = toEpochSeconds(rec.expiresAt);
      if (rec.metadata) result.metadata = rec.metadata;

      resultKeys.push(result);
      lastKey = key;
    }

    if (!listComplete && lastKey !== null) {
      const nextCursor = encodeCursor({ v: 1, prefix, after: lastKey });
      return { keys: resultKeys, list_complete: false, cursor: nextCursor };
    }

    return { keys: resultKeys, list_complete: true };
  }

  async close(): Promise<void> {
    this.data.clear();
  }
}

/**
 * IndexedDB storage backend for browsers
 */
export class IndexedDbStorageBackend implements StorageBackend {
  private conn: IndexedDbConnection;
  private storeName: string;

  constructor(opts?: {
    dbName?: string;
    storeName?: string;
    version?: number;
  }) {
    const dbName = opts?.dbName ?? "kv";
    this.storeName = opts?.storeName ?? "kv";
    const version = opts?.version ?? 1;
    this.conn = new IndexedDbConnection({
      dbName,
      storeName: this.storeName,
      version,
    });
  }

  async get(key: string): Promise<StoredRecord | undefined> {
    const db = await this.conn.db;
    const tx = db.transaction(this.storeName, "readonly");
    const store = tx.objectStore(this.storeName);
    return (await promisifyRequest(store.get(key))) as StoredRecord | undefined;
  }

  async put(record: StoredRecord): Promise<void> {
    const db = await this.conn.db;
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    store.put(record);
    await waitTx(tx);
  }

  async delete(key: string): Promise<void> {
    const db = await this.conn.db;
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    store.delete(key);
    await waitTx(tx);
  }

  async list(options: KVListOptions): Promise<KVListResult> {
    const prefix = options.prefix ?? "";
    const limit = Math.min(Math.max(1, options.limit ?? 1000), 10000);
    const cursorRaw = options.cursor ?? null;

    let after: string | null = null;
    if (cursorRaw) {
      const decoded = decodeCursor(cursorRaw);
      if (decoded && decoded.prefix === prefix) after = decoded.after;
    }

    const db = await this.conn.db;
    const tx = db.transaction(this.storeName, "readonly");
    const store = tx.objectStore(this.storeName);

    const lower = prefix;
    const upper = prefix + "\uffff";
    const range = IDBKeyRange.bound(lower, upper, false, false);

    const allRecs = (await promisifyRequest(
      store.getAll(range),
    )) as StoredRecord[];

    const keys: KVListKey[] = [];
    let listComplete = true;
    let lastKey: string | null = null;

    const now = nowMs();
    const afterIdx =
      after !== null ? allRecs.findIndex((r) => r.key > after) : 0;
    const startIdx = afterIdx < 0 ? allRecs.length : afterIdx;

    for (let i = startIdx; i < allRecs.length && keys.length < limit; i++) {
      const rec = allRecs[i];
      if (!rec) continue;

      if (rec.expiresAt && rec.expiresAt <= now) {
        continue;
      }

      const result: KVListKey = { name: rec.key };
      if (rec.expiresAt) result.expiration = toEpochSeconds(rec.expiresAt);
      if (rec.metadata) result.metadata = rec.metadata;

      keys.push(result);
      lastKey = rec.key;
    }

    if (keys.length >= limit && startIdx + keys.length < allRecs.length) {
      listComplete = false;
    }

    if (!listComplete && lastKey !== null) {
      const nextCursor = encodeCursor({ v: 1, prefix, after: lastKey });
      return { keys, list_complete: false, cursor: nextCursor };
    }

    return { keys, list_complete: true };
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
