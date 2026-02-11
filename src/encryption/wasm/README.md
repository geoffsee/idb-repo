# WasmMlKemProvider

Post-quantum hybrid encryption provider using **ML-KEM-1024** (NIST's standardized post-quantum key encapsulation mechanism) via WebAssembly, combined with **AES-256-GCM** for data encryption.

## Features

✅ **Post-quantum secure** - Uses NIST-standardized ML-KEM-1024
✅ **Universal** - Works in browsers, Node.js, Bun, and Deno
✅ **WASM-powered** - No native dependencies required
✅ **Hybrid encryption** - ML-KEM for key exchange + AES-256-GCM for data
✅ **Compatible** - Same format as NodeProvider (~1596 bytes overhead)

## Installation

```bash
npm install wasm-pqc-subtle
```

## Usage

### Basic Usage

```typescript
import { WasmMlKemProvider } from "idb-repo";

// Create provider with auto-generated keypair
const provider = await WasmMlKemProvider.create();

// Encrypt data
const plaintext = new TextEncoder().encode("Secret message");
const ciphertext = await provider.encrypt(plaintext);

// Decrypt data
const decrypted = await provider.decrypt(ciphertext);
console.log(new TextDecoder().decode(decrypted)); // "Secret message"
```

### With KV Storage

```typescript
import { IndexedDbKV, WasmMlKemProvider } from "idb-repo";

const provider = await WasmMlKemProvider.create();

const kv = new IndexedDbKV({
  dbName: "secure-storage",
  encryptionProvider: provider,
});

// All data is now encrypted with post-quantum security
await kv.put("secret", { password: "123456" });
const data = await kv.get("secret");
```

### Key Persistence

```typescript
// Export keys for storage
const provider = await WasmMlKemProvider.create();
const { publicKey, secretKey } = provider.exportKeys();

// Save keys to localStorage, file, etc.
localStorage.setItem("mlkem-pub", btoa(String.fromCharCode(...publicKey)));
localStorage.setItem("mlkem-sec", btoa(String.fromCharCode(...secretKey)));

// Later, restore from saved keys
const pubKeyBytes = Uint8Array.from(
  atob(localStorage.getItem("mlkem-pub")!),
  (c) => c.charCodeAt(0),
);
const secKeyBytes = Uint8Array.from(
  atob(localStorage.getItem("mlkem-sec")!),
  (c) => c.charCodeAt(0),
);

const restored = await WasmMlKemProvider.fromKeys(pubKeyBytes, secKeyBytes);
```

## Browser Support

Works in all modern browsers via WebAssembly:

- Chrome 89+
- Firefox 90+
- Safari 15+
- Edge 89+

## How It Works

### Encryption Process

1. **Key Encapsulation** - ML-KEM-1024 generates a random shared secret + ciphertext
2. **Key Derivation** - Shared secret is imported as AES-256-GCM key
3. **Data Encryption** - AES-256-GCM encrypts the plaintext with random IV
4. **Output Format** - `KEM_CT (1568) || IV (12) || AES_CT (plaintext + 16)`

### Decryption Process

1. **Parse Components** - Extract KEM ciphertext, IV, and AES ciphertext
2. **Key Decapsulation** - ML-KEM-1024 recovers shared secret from KEM ciphertext
3. **Key Import** - Shared secret imported as AES-256-GCM key
4. **Data Decryption** - AES-256-GCM decrypts using recovered key and IV

## Overhead

Each encrypted value adds **1596 bytes**:

- ML-KEM-1024 ciphertext: 1568 bytes
- AES-GCM IV: 12 bytes
- AES-GCM authentication tag: 16 bytes

## Security Properties

- **Post-quantum secure** - Resistant to quantum computer attacks
- **IND-CCA2 secure** - ML-KEM provides chosen-ciphertext attack resistance
- **Authenticated encryption** - AES-GCM provides confidentiality + authenticity
- **Fresh keys** - New shared secret per encryption (no key reuse)
- **Random IVs** - New random IV per encryption

## Comparison with Other Providers

| Provider                       | Algorithm                 | Overhead   | Post-Quantum | Browser | Node.js    |
| ------------------------------ | ------------------------- | ---------- | ------------ | ------- | ---------- |
| `WebCryptoEncryptionProvider`  | AES-256-GCM               | 28 bytes   | ❌           | ✅      | ✅         |
| `PassphraseEncryptionProvider` | PBKDF2 + AES-256-GCM      | 44 bytes   | ❌           | ✅      | ✅         |
| `NodeProvider`                 | ML-KEM-1024 + AES-256-GCM | 1596 bytes | ✅           | ❌      | ✅ (24.7+) |
| `WasmMlKemProvider`            | ML-KEM-1024 + AES-256-GCM | 1596 bytes | ✅           | ✅      | ✅         |

## Performance

ML-KEM operations via WASM are fast:

- Key generation: ~1ms
- Encapsulation: ~0.5ms
- Decapsulation: ~0.5ms
- Total encryption overhead: ~1-2ms (including AES-GCM)

## When to Use

**Use WasmMlKemProvider when:**

- You need post-quantum security
- You want browser compatibility
- You're storing data that must remain secure for 10+ years

**Use WebCryptoEncryptionProvider when:**

- Post-quantum isn't required
- You want minimal overhead (28 bytes vs 1596 bytes)
- Performance is critical

## References

- [NIST ML-KEM Specification](https://csrc.nist.gov/pubs/fips/203/final)
- [wasm-pqc-subtle on npm](https://www.npmjs.com/package/wasm-pqc-subtle)
- [Modern Algorithms in Web Crypto API (Draft)](https://wicg.github.io/webcrypto-modern-algos/)

## License

MIT
