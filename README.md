# idb-repo

Edge KV Storage.

## Overview

This SDK provides a small, dependency-free abstraction over IndexedDB for building fast, reliable key-value stores in browser and edge-like environments. It focuses on predictable behavior, minimal surface area, and performance characteristics suitable for long-lived client applications.

The goal is not to hide IndexedDB, but to make it practical: sane defaults, explicit structure, and a repository pattern that enforces consistency without adding unnecessary complexity.

## Design Principles
SOLID PRINCIPLES w/
- **Zero dependencies** — no runtime bloat, no transitive risk


## What This Is
- A thin repository abstraction over IndexedDB
- A predictable KV interface with typed boundaries
- A foundation for local-first and offline-capable systems

## What This Is Not

- An ORM
- A sync engine
- A framework replacement
- A polyfill for non-browser runtimes

## Use Cases

- Edge-adjacent web apps (Workers + WebViews)
- Local-first applications
- Durable client caches
- Structured persistence for complex frontends
- Performance-sensitive UI state storage

## Installation

```bash
npm install idb-repo
```

## Usage

### Basic Setup

```typescript
import { createIndexedDbKV } from "idb-repo";

// Create a KV store instance
const kv = createIndexedDbKV({
  dbName: "my-app",      // IndexedDB database name (default: "kv")
  storeName: "cache",    // Object store name (default: "kv")
  version: 1,            // Schema version for migrations
  cacheEntries: 2048     // In-memory LRU cache size (default: 2048)
});
```

### Core Operations

#### Put (Store Data)

```typescript
// Store a string
await kv.put("key1", "value");

// Store JSON
await kv.put("user:123", { id: 123, name: "Alice" });

// Store with metadata and expiration
await kv.put("session:abc", { token: "xyz" }, {
  metadata: { userId: "123" },
  expirationTtl: 3600  // expires in 1 hour
});

// Store ArrayBuffer/binary data
const buffer = new TextEncoder().encode("binary data");
await kv.put("binary-key", buffer);

// Store File or Blob objects
const file = document.querySelector("input[type=file]")!.files![0];
await kv.put("files/myfile", file);
```

#### Get (Retrieve Data)

```typescript
// Get raw value (type determined by stored type)
const value = await kv.get("key1");

// Get with metadata
const { value, metadata } = await kv.getWithMetadata("session:abc");

// Helper functions for typed retrieval
const text = await kvGetText(kv, "key1");
const json = await kvGetJson(kv, "user:123");
const buffer = await kvGetArrayBuffer(kv, "binary-key");
const stream = await kvGetStream(kv, "large-file");

// Get with custom cache TTL (bypasses storage expiration)
const cached = await kvGetJson(kv, "user:123", 300); // 5 min cache
```

#### Delete

```typescript
// Delete a key
await kv.delete("key1");
```

#### List (Enumerate Keys)

```typescript
// List all keys
const result = await kv.list();
// { keys: ["key1", "user:123", ...], cursor: "..." }

// List with pagination
const page = await kv.list({
  limit: 10,
  cursor: "previous-cursor"
});

// List with key prefix filter
const userKeys = await kv.list({
  prefix: "user:",
  limit: 50
});
```

#### Close

```typescript
// Clean up resources
await kv.close();
```

### Advanced Usage

#### Metadata and Type Hints

```typescript
// Store data with custom metadata
await kv.put("document:42", documentData, {
  metadata: {
    userId: "user:123",
    createdAt: new Date().toISOString(),
    contentType: "application/json"
  },
  expirationTtl: 86400 // 24 hours
});

// Retrieve and use metadata
const { value, metadata } = await kv.getWithMetadata("document:42");
if (metadata?.userId === "user:123") {
  // Process owned document
}
```

#### Performance Patterns

```typescript
// Batch operations use getAll() internally for ~3-5x better throughput
const result = await kv.list({ limit: 1000 });

// In-memory LRU cache speeds up repeated reads
// First read: ~5-10ms (IndexedDB)
// Subsequent reads of same key: ~0.1ms (memory)
for (let i = 0; i < 100; i++) {
  const user = await kvGetJson(kv, "user:123"); // Cache hit after first call
}

// Readonly transactions for lists are faster than readwrite
// Expired records are lazily deleted on read (not on list)
```

#### Storing Files

```typescript
// Store a File object (from file input)
const fileInput = document.querySelector("input[type=file]") as HTMLInputElement;
const file = fileInput.files![0];
await kv.put(`uploads/${file.name}`, file);

// Store a Blob
const blob = new Blob(["Hello, world!"], { type: "text/plain" });
await kv.put("greeting.txt", blob);

// Store binary ArrayBuffer
const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
await kv.put("binary-data", uint8Array);

// Store a ReadableStream (useful for large files or streaming uploads)
const stream = response.body; // from fetch()
await kv.put("large-file", stream);

// Retrieve files
const file = await kv.get("uploads/myfile.pdf") as ArrayBuffer;
const fileBlob = await kvGetArrayBuffer(kv, "uploads/myfile.pdf");

// Stream large files efficiently
const largeFile = await kvGetStream(kv, "large-file");
await largeFile.pipeTo(writableStream);

// List all stored files with metadata
const result = await kv.list({ prefix: "uploads/" });
for (const file of result.keys) {
  console.log(`${file.name} - uploaded at ${file.metadata?.uploadedAt}`);
}
```

#### Building Local-First Features

```typescript
// Store user preferences
await kv.put("settings:display", {
  theme: "dark",
  fontSize: 14,
  sidebarCollapsed: true
});

// Cache API responses
await kv.put("posts:feed", postsData, {
  expirationTtl: 300, // 5 minute cache
  metadata: { fetchedAt: Date.now() }
});

// Store offline queue
await kv.put(`pending:create:${uuid()}`, actionPayload, {
  metadata: { type: "create", priority: 1 }
});

// Enumerate pending actions
const { keys } = await kv.list({ prefix: "pending:" });
for (const key of keys) {
  const action = await kvGetJson(kv, key);
  await syncAction(action);
}
```

## API Reference

### `IndexedDbKV` Class

- **`constructor(opts?)`** — Create a new KV store instance
  - `dbName` (string): IndexedDB database name
  - `storeName` (string): Object store name
  - `version` (number): Schema version
  - `cacheEntries` (number): LRU cache size

- **`get(key, options?)`** → Promise — Retrieve a value
- **`getWithMetadata(key, options?)`** → Promise — Retrieve value and metadata
- **`put(key, value, options?)`** → Promise — Store a value
- **`delete(key)`** → Promise — Delete a key
- **`list(options?)`** → Promise — Enumerate keys with pagination
- **`close()`** → Promise — Close database connection

### Helper Functions

- **`kvGetText(kv, key, cacheTtl?)`** — Get value as string
- **`kvGetJson(kv, key, cacheTtl?)`** — Get value as JSON
- **`kvGetArrayBuffer(kv, key, cacheTtl?)`** — Get value as ArrayBuffer
- **`kvGetStream(kv, key, cacheTtl?)`** — Get value as ReadableStream

## Status

This project is intentionally small and opinionated. APIs are stable where exposed, but evolution is expected as real-world constraints surface.

## License

MIT