// web-container.ts
import { webkit, type Browser, type Page } from "playwright";

export type WebContainerOptions = {
  headless?: boolean;
  /**
   * If you want determinism, set a fixed storage state path later.
   * For now, this container uses a blank page and IndexedDB per WebKit context.
   */
};

export class WebContainer {
  private browser!: Browser;
  private page!: Page;

  /** Becomes true once WebKit is launched and the page is initialized. */
  public ready = false;

  /** Thin IndexedDB KV facade (string keys, JSON-serializable values). */
  public indexedDB!: {
    get<T = unknown>(store: string, key: string): Promise<T | undefined>;
    set<T = unknown>(store: string, key: string, value: T): Promise<void>;
    del(store: string, key: string): Promise<void>;
  };

  private constructor() {}

  static async create(opts: WebContainerOptions = {}): Promise<WebContainer> {
    const self = new WebContainer();
    await self.init(opts);
    return self;
  }

  private async init(opts: WebContainerOptions) {
    this.browser = await webkit.launch({ headless: opts.headless ?? true });
    const context = await this.browser.newContext();

    // Route a real HTTPS origin so the page gets a secure context where
    // IndexedDB is allowed. about:blank has origin "null" (opaque) which
    // causes "SecurityError: IDBFactory.open() called in an invalid
    // security context" in WebKit.
    const origin = "https://webcontainer.local";
    await context.route(`${origin}/**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><meta charset="utf-8"><title>WebContainer</title>',
      });
    });

    this.page = await context.newPage();

    // Register helpers *before* navigation so they run via addInitScript
    // during page.goto() — no fragile evaluate-fallback needed.
    await this.page.addInitScript(`
      function reqToPromise(req) {
        return new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }

      function txDone(tx) {
        return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }

      function openDB(name, version, stores) {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(name, version);
          req.onupgradeneeded = () => {
            const db = req.result;
            for (const s of stores) {
              if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }

      window.reqToPromise = reqToPromise;
      window.txDone = txDone;
      window.openDB = openDB;
    `);

    // Navigate to the routed secure origin (fires addInitScript).
    await this.page.goto(origin);

    // Verify indexedDB is actually usable (not just present).
    const hasIDB = await this.page.evaluate(() => {
      try {
        const req = indexedDB.open("__probe", 1);
        req.onsuccess = () => req.result.close();
        return true;
      } catch {
        return false;
      }
    });
    if (!hasIDB) {
      throw new Error("IndexedDB is not available in this WebKit runtime.");
    }

    // Install the KV facade that calls into page.evaluate each time.
    this.indexedDB = {
      get: async <T>(store: string, key: string) => {
        return await this.page.evaluate(
          async ({ store, key }) => {
            const db = await openDB("webcontainer-db", 1, [store]);
            const tx = db.transaction(store, "readonly");
            const value = await reqToPromise(tx.objectStore(store).get(key));
            await txDone(tx);
            db.close();
            return value as T | undefined;
          },
          { store, key },
        );
      },

      set: async <T>(store: string, key: string, value: T) => {
        await this.page.evaluate(
          async ({ store, key, value }) => {
            const db = await openDB("webcontainer-db", 1, [store]);
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put(value as any, key);
            await txDone(tx);
            db.close();
          },
          { store, key, value },
        );
      },

      del: async (store: string, key: string) => {
        await this.page.evaluate(
          async ({ store, key }) => {
            const db = await openDB("webcontainer-db", 1, [store]);
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).delete(key);
            await txDone(tx);
            db.close();
          },
          { store, key },
        );
      },
    };

    this.ready = true;
  }

  async close(): Promise<void> {
    try {
      // Race against a timeout so a hung WebKit process doesn't block
      // test teardown indefinitely, leaving a dangling process.
      const timeout = new Promise<void>((r) => setTimeout(r, 5_000));
      await Promise.race([this.browser?.close(), timeout]);
    } catch {
      // Swallow — best-effort cleanup.
    } finally {
      this.ready = false;
    }
  }
}

// Helper declarations used inside page.evaluate
declare global {
  // eslint-disable-next-line no-var
  var reqToPromise: (req: IDBRequest) => Promise<any>;
  // eslint-disable-next-line no-var
  var txDone: (tx: IDBTransaction) => Promise<any>;
  // eslint-disable-next-line no-var
  var openDB: (
    name: string,
    version: number,
    stores: string[],
  ) => Promise<IDBDatabase>;
}

// These functions are referenced inside evaluate bodies above (for TS satisfaction)
function reqToPromise(req: IDBRequest) {
  return globalThis.reqToPromise(req);
}
function txDone(tx: IDBTransaction) {
  return globalThis.txDone(tx);
}
function openDB(name: string, version: number, stores: string[]) {
  return globalThis.openDB(name, version, stores);
}
