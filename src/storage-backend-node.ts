import type {
  KVListOptions,
  KVListResult,
  StoredRecord,
  KVListKey,
} from "./types";
import type { StorageBackend } from "./storage-backend";
import { nowMs, toEpochSeconds } from "./time-utils";
import { encodeCursor, decodeCursor } from "./internal/cursor";

// We use dynamic imports for Node-specific modules to avoid breaking browser builds
let fs: typeof import("node:fs") | undefined;
let fsp: typeof import("node:fs/promises") | undefined;
let path: typeof import("node:path") | undefined;
let crypto: typeof import("node:crypto") | undefined;

async function ensureNode() {
  if (!fs) {
    fs = await import("node:fs");
    fsp = await import("node:fs/promises");
    path = await import("node:path");
    crypto = await import("node:crypto");
  }
}

const MAGIC = 0x4b564c47; // 'KVLG'
const VERSION = 1;
const HEADER_SIZE = 24; // Increased to accommodate more fields if needed, or keep at 20 and pack
const FLAG_TOMBSTONE = 0b00000001;

/**
 * NodeFileSystemStorageBackend: High-performance persistent storage for Node.js
 * Based on the FastKV log-structured merge-tree (LSM) Proof of Concept.
 */
export class NodeFileSystemStorageBackend implements StorageBackend {
  private dir: string;
  private opened = false;
  private activeId = 1;
  private activeFd: number | null = null;
  private activeSize = 0;
  private activeOffset = 0;

  // Index stores metadata to satisfy 'list' without disk hits
  private index = new Map<
    string,
    {
      fileId: number;
      offset: number;
      size: number;
      ts: number;
      expiresAt: number | null;
      metadata: any | null;
    }
  >();

  private fdCache = new Map<number, { fd: number; last: number }>();
  private segmentMaxBytes = 32 * 1024 * 1024; // 32 MiB

  constructor(opts?: { dbName?: string; dir?: string }) {
    // Use dbName as the directory name if dir is not provided
    this.dir = opts?.dir || opts?.dbName || "kv-data";
  }

  private async ensureOpened() {
    if (this.opened) return;
    await ensureNode();

    if (!path!.isAbsolute(this.dir)) {
      this.dir = path!.join(process.cwd(), this.dir);
    }

    await fsp!.mkdir(this.dir, { recursive: true });

    const segments = await this.listSegments();
    if (segments.length === 0) {
      await this.openActiveForAppend(1);
    } else {
      await this.recoverIndex(segments);
      const newest = segments[segments.length - 1];
      if (!newest) return; // Should not happen given segments.length > 0
      this.activeId = newest.id;
      await this.openActiveForAppend(this.activeId);

      const st = await fsp!.stat(
        path!.join(this.dir, this.pad6(this.activeId) + ".kvlog"),
      );
      this.activeSize = st.size;
      this.activeOffset = st.size;

      if (this.activeSize >= this.segmentMaxBytes) {
        await this.rotate();
      }
    }
    this.opened = true;
  }

  async get(key: string): Promise<StoredRecord | undefined> {
    await this.ensureOpened();
    const meta = this.index.get(key);
    if (!meta) return undefined;

    // Check expiration
    if (meta.expiresAt && meta.expiresAt <= nowMs()) {
      // Lazy delete
      void this.delete(key);
      return undefined;
    }

    const fd = await this.getReadFd(meta.fileId);

    // Read header
    const header = Buffer.alloc(HEADER_SIZE);
    await this.fsRead(fd, header, 0, HEADER_SIZE, meta.offset);

    const keyLen = header.readUInt16LE(6);
    const valLen = header.readUInt32LE(8);
    const encodingFlag = (header[5] ?? 0) >> 1; // bits 1-4 for encoding

    const payloadLen = keyLen + valLen;
    const payload = Buffer.alloc(payloadLen);
    await this.fsRead(fd, payload, 0, payloadLen, meta.offset + HEADER_SIZE);

    const valueBuf = payload.subarray(keyLen);

    // Map encoding flag back to StoredEncoding
    const encodings: StoredRecord["encoding"][] = [
      "text",
      "json",
      "clone",
      "binary",
    ];
    const encoding = encodings[encodingFlag] || "binary";

    let value: any;
    if (encoding === "text") value = valueBuf.toString("utf8");
    else if (encoding === "json") value = JSON.parse(valueBuf.toString("utf8"));
    else if (encoding === "clone")
      value = JSON.parse(valueBuf.toString("utf8")); // Simplified for POC
    else value = new Blob([valueBuf]);

    return {
      key,
      value,
      encoding,
      expiresAt: meta.expiresAt,
      metadata: meta.metadata,
      createdAt: meta.ts, // Approximate
      updatedAt: meta.ts,
    };
  }

  async put(record: StoredRecord): Promise<void> {
    await this.ensureOpened();

    const keyBuf = Buffer.from(record.key, "utf8");
    let valBuf: Buffer;

    if (record.encoding === "text")
      valBuf = Buffer.from(record.value as string, "utf8");
    else if (record.encoding === "json" || record.encoding === "clone")
      valBuf = Buffer.from(JSON.stringify(record.value), "utf8");
    else {
      const blob = record.value as Blob;
      valBuf = Buffer.from(await blob.arrayBuffer());
    }

    const keyLen = keyBuf.length;
    const valLen = valBuf.length;
    const totalLen = HEADER_SIZE + keyLen + valLen;

    if (this.activeSize + totalLen > this.segmentMaxBytes) {
      await this.rotate();
    }

    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32LE(MAGIC, 0);
    header[4] = VERSION;

    // Pack flags: bit 0: tombstone, bits 1-4: encoding
    const encodingMap = { text: 0, json: 1, clone: 2, binary: 3 };
    const encodingFlag = encodingMap[record.encoding] << 1;
    header[5] = encodingFlag;

    header.writeUInt16LE(keyLen, 6);
    header.writeUInt32LE(valLen, 8);
    header.writeUInt32LE(record.updatedAt >>> 0, 12); // ts

    // Write expiresAt (8 bytes starting at index 16)
    if (record.expiresAt) {
      header.writeDoubleLE(record.expiresAt, 16);
    } else {
      header.writeDoubleLE(0, 16);
    }

    const writeOffset = this.activeOffset;
    await this.fsWritev(this.activeFd!, [header, keyBuf, valBuf]);

    this.activeOffset += totalLen;
    this.activeSize += totalLen;

    this.index.set(record.key, {
      fileId: this.activeId,
      offset: writeOffset,
      size: totalLen,
      ts: record.updatedAt,
      expiresAt: record.expiresAt,
      metadata: record.metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.ensureOpened();
    const meta = this.index.get(key);
    if (!meta) return;

    // Append a tombstone record
    const keyBuf = Buffer.from(key, "utf8");
    const keyLen = keyBuf.length;
    const totalLen = HEADER_SIZE + keyLen;

    if (this.activeSize + totalLen > this.segmentMaxBytes) {
      await this.rotate();
    }

    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32LE(MAGIC, 0);
    header[4] = VERSION;
    header[5] = FLAG_TOMBSTONE; // bit 0: tombstone
    header.writeUInt16LE(keyLen, 6);
    header.writeUInt32LE(0, 8); // valLen = 0
    header.writeUInt32LE(nowMs() >>> 0, 12);

    await this.fsWritev(this.activeFd!, [header, keyBuf]);

    this.activeOffset += totalLen;
    this.activeSize += totalLen;

    this.index.delete(key);
  }

  async list(options: KVListOptions): Promise<KVListResult> {
    await this.ensureOpened();
    const prefix = options.prefix ?? "";
    const limit = Math.min(Math.max(1, options.limit ?? 1000), 10000);
    const cursorRaw = options.cursor ?? null;

    let after: string | null = null;
    if (cursorRaw) {
      const decoded = decodeCursor(cursorRaw);
      if (decoded && decoded.prefix === prefix) after = decoded.after;
    }

    const now = nowMs();
    let keys = Array.from(this.index.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();

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

      const meta = this.index.get(key)!;
      if (meta.expiresAt && meta.expiresAt <= now) {
        continue;
      }

      const result: KVListKey = { name: key };
      if (meta.expiresAt) result.expiration = toEpochSeconds(meta.expiresAt);
      if (meta.metadata) result.metadata = meta.metadata;

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
    if (!this.opened) return;

    if (this.activeFd !== null) {
      fs!.closeSync(this.activeFd);
      this.activeFd = null;
    }

    for (const entry of this.fdCache.values()) {
      fs!.closeSync(entry.fd);
    }
    this.fdCache.clear();
    this.opened = false;
  }

  private async listSegments(): Promise<Array<{ id: number; path: string }>> {
    const entries = await fsp!.readdir(this.dir, { withFileTypes: true });
    const segments: { id: number; path: string }[] = [];

    for (const e of entries) {
      if (!e.isFile()) continue;
      const match = /^(\d{6})\.kvlog$/.exec(e.name);
      if (!match) continue;
      segments.push({
        id: Number(match[1]),
        path: path!.join(this.dir, e.name),
      });
    }

    segments.sort((a, b) => a.id - b.id);
    return segments;
  }

  private async openActiveForAppend(id: number) {
    const p = path!.join(this.dir, this.pad6(id) + ".kvlog");
    this.activeFd = fs!.openSync(p, "a+", 0o600);
    this.activeId = id;
  }

  private async rotate() {
    if (this.activeFd !== null) {
      fs!.closeSync(this.activeFd);
    }
    this.activeId++;
    await this.openActiveForAppend(this.activeId);
    this.activeSize = 0;
    this.activeOffset = 0;
  }

  private async recoverIndex(segments: Array<{ id: number; path: string }>) {
    for (const seg of segments) {
      const fh = await fsp!.open(seg.path, "r");
      const fd = fh.fd;
      try {
        const { size: fileSize } = await fh.stat();
        let pos = 0;
        const header = Buffer.alloc(HEADER_SIZE);

        while (pos + HEADER_SIZE <= fileSize) {
          const { bytesRead } = await fh.read(header, 0, HEADER_SIZE, pos);
          if (bytesRead !== HEADER_SIZE) break;

          const magic = header.readUInt32LE(0);
          if (magic !== MAGIC) break;

          const flags = header[5] ?? 0;
          const keyLen = header.readUInt16LE(6);
          const valLen = header.readUInt32LE(8);
          const ts = header.readUInt32LE(12);
          const expiresAt = header.readDoubleLE(16);

          const total = HEADER_SIZE + keyLen + valLen;
          if (pos + total > fileSize) break;

          const keyBuf = Buffer.alloc(keyLen);
          await fh.read(keyBuf, 0, keyLen, pos + HEADER_SIZE);
          const keyStr = keyBuf.toString("utf8");

          if (flags & FLAG_TOMBSTONE) {
            this.index.delete(keyStr);
          } else {
            // TODO: Recover metadata if we want it in the index
            // For now, metadata recovery from disk isn't implemented in this simple POC
            this.index.set(keyStr, {
              fileId: seg.id,
              offset: pos,
              size: total,
              ts,
              expiresAt: expiresAt || null,
              metadata: null, // Lossy recovery for metadata in this simple version
            });
          }

          pos += total;
        }
      } finally {
        await fh.close();
      }
    }
  }

  private async getReadFd(fileId: number): Promise<number> {
    if (fileId === this.activeId && this.activeFd !== null)
      return this.activeFd;

    let entry = this.fdCache.get(fileId);
    if (entry) {
      entry.last = performance.now();
      return entry.fd;
    }

    const p = path!.join(this.dir, this.pad6(fileId) + ".kvlog");
    const fd = fs!.openSync(p, "r");
    this.fdCache.set(fileId, { fd, last: performance.now() });
    return fd;
  }

  private pad6(n: number): string {
    return String(n).padStart(6, "0");
  }

  private fsWritev(fd: number, buffers: Buffer[]): Promise<number> {
    return new Promise((resolve, reject) => {
      fs!.writev(fd, buffers, (err, written) => {
        if (err) reject(err);
        else resolve(written);
      });
    });
  }

  private fsRead(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      fs!.read(fd, buffer, offset, length, position, (err, bytesRead) => {
        if (err) reject(err);
        else resolve(bytesRead);
      });
    });
  }
}
