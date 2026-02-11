# idb-repo

Universal KV Storage for Browser and Node.js.

## Overview

This SDK provides a small, dependency-free abstraction for building fast, reliable key-value stores. It automatically selects the best storage engine for your environment: **IndexedDB** in the browser and a high-performance **Log-Structured Merge-Tree (LSM)** filesystem backend in Node.js.

The goal is to provide a consistent, predictable KV interface across all platforms, focusing on performance characteristics suitable for both client-side persistence and server-side edge runtimes.

## Design Principles
- **Universal** — Same API for Browser, Node.js, and Bun
- **Persistent** — Durable storage by default on all platforms
- **Zero dependencies** — No runtime bloat, no transitive risk
- **Performance-first** — In-memory LRU caching and optimized storage backends


## What This Is
- A unified repository abstraction over platform-specific storage
- A predictable KV interface with typed boundaries
- A foundation for local-first and cross-platform applications

## Installation

```bash
npm install idb-repo
```

## Usage

### Basic Setup

```typescript
import { createKV } from "idb-repo";

// Create a KV store instance - automatically picks best storage
const kv = createKV({
  dbName: "my-app",      // IndexedDB name or Node directory (default: "kv")
  cacheEntries: 2048     // In-memory LRU cache size (default: 2048)
});
```

### Environment Support

| Runtime | Storage Engine | Persistence |
| --- | --- | --- |
| **Browser** | IndexedDB | Yes |
| **Node.js / Bun** | LSM File System | Yes |
| **Testing / Fallback** | In-Memory | No (volatile) |

#### Forcing In-Memory (for tests)
```typescript
const kv = createKV({ forceMemory: true });
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
```

#### Get (Retrieve Data)

```typescript
// Get raw value (type determined by stored type)
const value = await kv.get("key1");

// Get with metadata
const { value, metadata } = await kv.getWithMetadata("session:abc");

// Helper functions for typed retrieval
import { kvGetText, kvGetJson, kvGetArrayBuffer, kvGetStream } from "idb-repo";

const text = await kvGetText(kv, "key1");
const json = await kvGetJson(kv, "user:123");
const buffer = await kvGetArrayBuffer(kv, "binary-key");
const stream = await kvGetStream(kv, "large-file");
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
// { keys: [{ name: "key1" }, { name: "user:123" }], list_complete: true }

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
// Clean up resources (closes DB connections / file handles)
await kv.close();
```

### Advanced Usage

#### Metadata and Type Hints

```typescript
// Store data with custom metadata
await kv.put("document:42", documentData, {
  metadata: {
    userId: "user:123",
    createdAt: new Date().toISOString()
  },
  expirationTtl: 86400 // 24 hours
});

// Retrieve and use metadata
const { value, metadata } = await kv.getWithMetadata("document:42");
```

#### Performance Patterns

- **In-memory LRU cache** speeds up repeated reads (controlled via `cacheEntries`).
- **Log-Structured Storage** in Node.js ensures fast appends and robust persistence.
- **Lazy Expiration**: Expired records are identified during read/list and cleaned up to ensure consistent performance.

### API Reference

#### `createKV(opts?)`
The primary entry point for creating a storage instance.
- `dbName` (string): Storage identifier (IndexedDB name or Node directory).
- `cacheEntries` (number): LRU cache size (default: 2048).
- `forceMemory` (boolean): Force usage of volatile in-memory storage.

#### `KVNamespace` Interface
- `get(key, options?)` → Promise
- `getWithMetadata(key, options?)` → Promise
- `put(key, value, options?)` → Promise
- `delete(key)` → Promise
- `list(options?)` → Promise
- `close()` → Promise

## License

MIT
