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
  dbName: "my-app", // IndexedDB name or Node directory (default: "kv")
  cacheEntries: 2048, // In-memory LRU cache size (default: 2048)
});
```

### Environment Support

| Runtime                | Storage Engine  | Persistence   |
| ---------------------- | --------------- | ------------- |
| **Browser**            | IndexedDB       | Yes           |
| **Node.js / Bun**      | LSM File System | Yes           |
| **Testing / Fallback** | In-Memory       | No (volatile) |

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
await kv.put(
  "session:abc",
  { token: "xyz" },
  {
    metadata: { userId: "123" },
    expirationTtl: 3600, // expires in 1 hour
  },
);

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
  cursor: "previous-cursor",
});

// List with key prefix filter
const userKeys = await kv.list({
  prefix: "user:",
  limit: 50,
});
```

#### Close

```typescript
// Clean up resources (closes DB connections / file handles)
await kv.close();
```

### Advanced Usage

#### Pluggable Encryption

`idb-repo` supports transparent encryption of all stored values using pluggable encryption providers.

##### Built-in Encryption Providers

| Provider                         | Algorithm                 | Use Case                            | Overhead    | Performance              | Browser | Node.js    | Post-Quantum |
| -------------------------------- | ------------------------- | ----------------------------------- | ----------- | ------------------------ | ------- | ---------- | ------------ |
| **WebCryptoEncryptionProvider**  | AES-256-GCM               | General purpose, high performance   | 28 bytes    | ⚡⚡⚡ Fastest (~0.01ms) | ✅      | ✅         | ❌           |
| **PassphraseEncryptionProvider** | PBKDF2 + AES-256-GCM      | User password-based encryption      | 44 bytes    | ⚡ Slow (~100ms init)    | ✅      | ✅         | ❌           |
| **WasmMlKemProvider**            | ML-KEM-1024 + AES-256-GCM | Future-proof, post-quantum security | 1,596 bytes | ⚡⚡ Fast (~0.08ms)      | ✅      | ✅         | ✅           |
| **NodeProvider**                 | ML-KEM-1024 + AES-256-GCM | Node.js-only post-quantum           | 1,596 bytes | ⚡⚡⚡ Fastest (~0.05ms) | ❌      | ✅ (24.7+) | ✅           |

##### Quick Start Examples

**Standard Encryption (AES-256-GCM)**

```typescript
import { createKV, WebCryptoEncryptionProvider } from "idb-repo";

const provider = new WebCryptoEncryptionProvider(
  new Uint8Array(32).fill(42), // Your 256-bit encryption key
);
await provider.initialize();

const kv = createKV({ encryptionProvider: provider });
```

**Password-Based Encryption**

```typescript
import { PassphraseEncryptionProvider } from "idb-repo";

const provider =
  await PassphraseEncryptionProvider.create("my-strong-password");
const kv = createKV({ encryptionProvider: provider });
```

**Post-Quantum Encryption (Universal - Browser + Node.js)**

```typescript
import { WasmMlKemProvider } from "idb-repo";

const provider = await WasmMlKemProvider.create();
const kv = createKV({ encryptionProvider: provider });

// Save keys for later use
const { publicKey, secretKey } = provider.exportKeys();
localStorage.setItem(
  "mlkem-keys",
  JSON.stringify({
    pub: Array.from(publicKey),
    sec: Array.from(secretKey),
  }),
);
```

**Post-Quantum Encryption (Node.js Only)**

```typescript
import { NodeProvider } from "idb-repo";

// Node.js 24.7+ only - uses native ML-KEM implementation
const provider = await NodeProvider.create();
const kv = createKV({ encryptionProvider: provider });
```

##### How to Choose an Encryption Provider

**Use `WebCryptoEncryptionProvider` when:**

- ✅ You need strong encryption with minimal overhead
- ✅ Performance is critical (28 bytes overhead, ~0.01ms)
- ✅ Standard AES-256-GCM security is sufficient
- ✅ You want maximum compatibility

**Use `PassphraseEncryptionProvider` when:**

- ✅ Users need to unlock their data with a password
- ✅ You want secure key derivation from human-memorable passwords
- ⚠️ You can accept slower initialization (~100ms for PBKDF2)

**Use `WasmMlKemProvider` when:**

- ✅ You need post-quantum security (resistant to quantum attacks)
- ✅ You want universal compatibility (browser + Node.js + Bun)
- ✅ You're storing data that must remain secure for 10+ years
- ⚠️ You can accept larger overhead (1,596 bytes per value)
- ⚠️ Performance ~7x slower than AES, but still fast (~12,000 ops/sec)

**Use `NodeProvider` when:**

- ✅ You need post-quantum security in Node.js only
- ✅ You have Node.js 24.7 or later
- ✅ You want the fastest ML-KEM implementation available
- ❌ Browser support is not required

##### Custom Encryption Provider

You can also implement your own encryption provider:

```typescript
import { createKV, BaseEncryptionProvider } from "idb-repo";

class MyEncryptionProvider extends BaseEncryptionProvider {
  readonly providerId = "my-provider-v1";

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    // your implementation
    return plaintext;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    // your implementation
    return ciphertext;
  }
}

const kv = createKV({
  encryptionProvider: new MyEncryptionProvider(),
  // optional key selector passed to encrypt/decrypt:
  encryptionKeyId: "tenant-a",
});
```

##### Key Persistence and Recovery

**Critical:** If you lose your encryption keys, your data is **permanently unrecoverable**. Always persist keys securely.

**Recovery Strategy by Provider:**

| Provider                         | What to Save                                      | Recovery Process            | Storage Recommendation                           |
| -------------------------------- | ------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| **WebCryptoEncryptionProvider**  | 32-byte key                                       | Re-initialize with same key | Secure backend, env vars, encrypted localStorage |
| **PassphraseEncryptionProvider** | Passphrase only (salt is auto-saved)              | User enters passphrase      | User's memory, password manager                  |
| **WasmMlKemProvider**            | Public key (1568 bytes) + Secret key (3168 bytes) | Import saved keys           | Secure backend, encrypted localStorage           |
| **NodeProvider**                 | CryptoKey objects or raw bytes                    | Re-generate or import       | Secure backend, filesystem (encrypted)           |

**Example: Persisting and Recovering AES Keys (Easy Way)**

Using the built-in `LocalStorageKeyManager`:

```typescript
import { LocalStorageKeyManager, createKV } from "idb-repo";

// --- First Time Setup ---
const key = crypto.getRandomValues(new Uint8Array(32));
LocalStorageKeyManager.saveAESKey(key);

const provider = await LocalStorageKeyManager.loadAESProvider();
const kv = createKV({ encryptionProvider: provider });

// --- Subsequent Sessions ---
if (!LocalStorageKeyManager.hasKey()) {
  throw new Error("No encryption key found!");
}

const provider = await LocalStorageKeyManager.loadAESProvider();
const kv = createKV({ encryptionProvider: provider });
```

**Manual Approach (More Control):**

```typescript
import { WebCryptoEncryptionProvider, KeySerializer } from "idb-repo";

// --- First Time Setup ---
const key = crypto.getRandomValues(new Uint8Array(32));

// Save to your secure backend
await fetch("/api/save-key", {
  method: "POST",
  body: JSON.stringify({ key: KeySerializer.serialize(key) }),
});

const provider = new WebCryptoEncryptionProvider(key);
await provider.initialize();

// --- Recovery / Subsequent Sessions ---
const response = await fetch("/api/load-key");
const { key: encodedKey } = await response.json();
const recoveredKey = KeySerializer.deserialize(encodedKey);

const recoveredProvider = new WebCryptoEncryptionProvider(recoveredKey);
await recoveredProvider.initialize();

const kv = createKV({ encryptionProvider: recoveredProvider });
```

**Example: Persisting and Recovering Passphrase-Based Encryption (Easy Way)**

```typescript
import {
  LocalStorageKeyManager,
  PassphraseEncryptionProvider,
  createKV,
} from "idb-repo";

// --- First Time Setup ---
const provider = await PassphraseEncryptionProvider.create("user-password");
LocalStorageKeyManager.savePBKDF2Salt(provider.getSalt());

const kv = createKV({ encryptionProvider: provider });

// --- Subsequent Sessions ---
const userPassword = prompt("Enter your password:");
const provider = await LocalStorageKeyManager.loadPBKDF2Provider(userPassword);

if (!provider) {
  throw new Error("Invalid password or salt not found!");
}

const kv = createKV({ encryptionProvider: provider });
```

**Example: Persisting and Recovering ML-KEM Keys (Easy Way)**

```typescript
import { LocalStorageKeyManager, createKV } from "idb-repo";

// --- First Time Setup ---
const provider = await WasmMlKemProvider.create();
const { publicKey, secretKey } = provider.exportKeys();

LocalStorageKeyManager.saveMLKEMKeys(publicKey, secretKey);

const kv = createKV({ encryptionProvider: provider });

// --- Subsequent Sessions ---
const provider = await LocalStorageKeyManager.loadMLKEMProvider();

if (!provider) {
  throw new Error("ML-KEM keys not found! Data is unrecoverable.");
}

const kv = createKV({ encryptionProvider: provider });
```

**Secure Backend Storage (Recommended for Production):**

```typescript
import { BackendKeyManager, KeySerializer } from "idb-repo";

// Initialize backend manager with your API
const keyManager = new BackendKeyManager(
  "https://api.example.com",
  "your-auth-token",
);

// --- First Time Setup ---
const provider = await WasmMlKemProvider.create();
const { publicKey, secretKey } = provider.exportKeys();

await keyManager.saveKey("user-123", {
  type: "ml-kem-1024",
  publicKey: KeySerializer.serialize(publicKey),
  secretKey: KeySerializer.serialize(secretKey),
});

// --- Recovery ---
const stored = await keyManager.loadKey("user-123");
if (!stored || stored.type !== "ml-kem-1024") {
  throw new Error("Keys not found!");
}

const pubKey = KeySerializer.deserialize(stored.publicKey);
const secKey = KeySerializer.deserialize(stored.secretKey);

const provider = await WasmMlKemProvider.fromKeys(pubKey, secKey);
const kv = createKV({ encryptionProvider: provider });
```

##### Security Considerations

- **Key Management**: Always store encryption keys securely. Never hardcode keys in source code.
- **Backup Keys**: Keep encrypted backups of your keys in multiple secure locations.
- **Key Loss = Data Loss**: There is no "forgot password" recovery for encryption. Lost keys mean permanently lost data.
- **Post-Quantum**: If you're storing data that must remain secret beyond 2030, consider post-quantum encryption (WasmMlKemProvider or NodeProvider).
- **Overhead**: Encryption adds overhead to each value. ML-KEM adds ~1.5 KB per value due to per-value key encapsulation.
- **Performance**: All providers are fast enough for most use cases. Even ML-KEM achieves ~12,000-14,000 operations/sec.
- **localStorage Security**: Storing keys in localStorage is convenient but vulnerable to XSS attacks. For production, use:
  - Secure backend storage with authentication
  - Hardware security modules (HSM)
  - Operating system keychains (Keychain on macOS, Credential Manager on Windows)
  - Encrypted environment variables for server-side

For detailed benchmarks, see `bench/encryption-providers.ts`.

#### Metadata and Type Hints

```typescript
// Store data with custom metadata
await kv.put("document:42", documentData, {
  metadata: {
    userId: "user:123",
    createdAt: new Date().toISOString(),
  },
  expirationTtl: 86400, // 24 hours
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
- `encryptionProvider` (`BaseEncryptionProvider`): Optional provider used to encrypt/decrypt values at rest.
- `encryptionKeyId` (string): Optional key identifier passed to provider `encrypt`/`decrypt`.

#### `KVNamespace` Interface

- `get(key, options?)` → Promise
- `getWithMetadata(key, options?)` → Promise
- `put(key, value, options?)` → Promise
- `delete(key)` → Promise
- `list(options?)` → Promise
- `close()` → Promise

## License

MIT 2026 Copyright © Seemueller
