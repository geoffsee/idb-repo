export type KVGetType = "text" | "json" | "arrayBuffer" | "stream";
export type KVValue = string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array> | unknown;


export interface KVGetOptions {
    type?: KVGetType;
    cacheTtl?: number; // seconds; best-effort in-memory cache
}

export interface KVPutOptions {
    expiration?: number; // epoch seconds
    expirationTtl?: number; // seconds from now
    metadata?: unknown;
}

export interface KVListOptions {
    prefix?: string;
    limit?: number; // default 1000
    cursor?: string; // opaque cursor returned from list()
}

export interface KVListKey {
    name: string;
    expiration?: number; // epoch seconds
    metadata?: unknown;
}

export interface KVListResult {
    keys: KVListKey[];
    list_complete: boolean;
    cursor?: string;
}

export interface KVNamespace {
    get(key: string, options?: KVGetOptions): Promise<string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null>;
    getWithMetadata<T = unknown>(
        key: string,
        options?: KVGetOptions
    ): Promise<{ value: string | ArrayBuffer | ReadableStream<Uint8Array> | unknown | null; metadata: T | null }>;

    put(key: string, value: KVValue, options?: KVPutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVListOptions): Promise<KVListResult>;
}

export type StoredEncoding = "text" | "json" | "clone" | "binary";

export type StoredRecord = {
    key: string;
    // We store either:
    // - text: string
    // - json: string (legacy JSON payload)
    // - clone: structured-clone payload
    // - binary: Blob
    value: unknown;
    encoding: StoredEncoding;
    // expiration in ms epoch, or null
    expiresAt: number | null;
    // optional metadata (structured clone)
    metadata: unknown | null;
    // timestamps for diagnostics / future GC strategies
    createdAt: number;
    updatedAt: number;
};

export type InternalListCursor = {
    v: 1;
    // prefix from original request (used to validate)
    prefix: string;
    // last key returned (exclusive start for next page)
    after: string | null;
};

export type OpenConfig = {
    dbName: string;
    storeName: string;
    version: number;
};
