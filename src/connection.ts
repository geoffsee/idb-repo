/**
 * IndexedDB connection management
 */

import { promisifyRequest, waitTx } from "./internal/idb-utils";

/**
 * Configuration for opening an IndexedDB database
 */
type OpenConfig = {
  dbName: string;
  storeName: string;
  version: number;
};

/**
 * Manages lifecycle of an IndexedDB connection
 * - Lazy initialization (opens on first access)
 * - Version change handling
 * - Automatic schema creation/migration
 */
export class IndexedDbConnection {
  private cfg: OpenConfig;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(cfg: OpenConfig) {
    this.cfg = cfg;
  }

  /**
   * Get or open the database
   */
  get db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = this.open();
    return this.dbPromise;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      db.close();
    } finally {
      this.dbPromise = null;
    }
  }

  /**
   * Open the database with automatic schema creation/migration
   */
  private open(): Promise<IDBDatabase> {
    const { dbName, version, storeName } = this.cfg;

    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, version);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "key" });
          // Index for prefix/range scans and expiration housekeeping.
          store.createIndex("key", "key", { unique: true });
          store.createIndex("expiresAt", "expiresAt", { unique: false });
        } else {
          const store = req.transaction!.objectStore(storeName);
          if (!store.indexNames.contains("expiresAt"))
            store.createIndex("expiresAt", "expiresAt", { unique: false });
          if (!store.indexNames.contains("key"))
            store.createIndex("key", "key", { unique: true });
        }
      };

      req.onsuccess = () => {
        const db = req.result;

        // If another tab upgrades, we close and let caller re-open.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* noop */
          }
        };

        resolve(db);
      };

      req.onerror = () =>
        reject(req.error ?? new Error("Failed to open IndexedDB"));
      req.onblocked = () => {
        // Avoid hanging forever; still allow caller to retry.
        reject(
          new Error(
            "IndexedDB open blocked (another context has the DB open during upgrade)",
          ),
        );
      };
    });
  }
}
