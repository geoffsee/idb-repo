# Key Recovery and Persistence Guide

## The Problem

**When users need to recover encrypted storage, they MUST have access to their encryption keys.**

Without the correct keys:
- ❌ All encrypted data is **permanently unrecoverable**
- ❌ There is no "forgot password" recovery option
- ❌ Even the database administrator cannot decrypt the data

This guide shows you how to properly persist and recover encryption keys.

---

## Quick Reference: What to Save

| Provider | What Must Be Saved | Size | Recovery Method |
|----------|-------------------|------|-----------------|
| **WebCryptoEncryptionProvider** | 32-byte AES key | 32 bytes | Re-initialize with same key |
| **PassphraseEncryptionProvider** | 16-byte salt + user remembers passphrase | 16 bytes | User enters passphrase |
| **WasmMlKemProvider** | Public key (1568 bytes) + Secret key (3168 bytes) | 4736 bytes | Import saved keys |
| **NodeProvider** | Public key (1568 bytes) + Secret key (3168 bytes) | 4736 bytes | Import saved keys |

---

## Built-in Key Management Utilities

### LocalStorageKeyManager (Simple, Browser-Only)

**Best for:** Development, prototypes, single-device apps
**Security:** ⚠️ Vulnerable to XSS attacks

```typescript
import { LocalStorageKeyManager, createKV } from "idb-repo";

// AES Key Management
const key = crypto.getRandomValues(new Uint8Array(32));
LocalStorageKeyManager.saveAESKey(key);

// Later...
const provider = await LocalStorageKeyManager.loadAESProvider();
const kv = createKV({ encryptionProvider: provider });
```

**Available Methods:**
- `saveAESKey(key)` / `loadAESProvider()`
- `savePBKDF2Salt(salt)` / `loadPBKDF2Provider(passphrase)`
- `saveMLKEMKeys(pub, sec)` / `loadMLKEMProvider()`
- `hasKey()` - Check if any key is stored
- `getKeyType()` - Get type of stored key
- `clear()` - Remove all keys (logout)

### KeySerializer (Universal)

**Best for:** Custom storage backends, cross-platform apps

```typescript
import { KeySerializer } from "idb-repo";

// Serialize any key to base64 string
const encoded = KeySerializer.serialize(keyBytes);

// Save to your backend, file, etc.
await saveToBackend(encoded);

// Later, deserialize
const keyBytes = KeySerializer.deserialize(encoded);
```

### BackendKeyManager (Production-Ready Template)

**Best for:** Production apps with secure backend

```typescript
import { BackendKeyManager } from "idb-repo";

const manager = new BackendKeyManager(
  "https://api.example.com",
  authToken
);

// Save
await manager.saveKey("user-123", {
  type: "ml-kem-1024",
  publicKey: "...",
  secretKey: "..."
});

// Load
const stored = await manager.loadKey("user-123");
```

---

## Recovery Workflows by Provider

### 1. WebCryptoEncryptionProvider (AES-256-GCM)

**Use Case:** Fast, general-purpose encryption

#### Initial Setup
```typescript
import { LocalStorageKeyManager, createKV } from "idb-repo";

// Generate random key
const key = crypto.getRandomValues(new Uint8Array(32));

// Save it
LocalStorageKeyManager.saveAESKey(key);

// Create KV
const provider = await LocalStorageKeyManager.loadAESProvider();
const kv = createKV({ encryptionProvider: provider });
```

#### Recovery
```typescript
// User returns to app
if (!LocalStorageKeyManager.hasKey()) {
  alert("No encryption key found! Please create a new account.");
  // Handle new user setup
}

const provider = await LocalStorageKeyManager.loadAESProvider();
const kv = createKV({ encryptionProvider: provider });
// ✅ All encrypted data now accessible
```

#### Key Backup (Recommended)
```typescript
// Export key for backup
const key = /* your original 32-byte key */;
const backup = KeySerializer.serialize(key);

// Show to user to write down (like a recovery phrase)
console.log("BACKUP CODE:", backup);

// User can restore later
const restored = KeySerializer.deserialize(backup);
LocalStorageKeyManager.saveAESKey(restored);
```

---

### 2. PassphraseEncryptionProvider (PBKDF2 + AES-256-GCM)

**Use Case:** User password-based encryption

#### Initial Setup
```typescript
import { PassphraseEncryptionProvider, LocalStorageKeyManager, createKV } from "idb-repo";

// User creates account with password
const passphrase = prompt("Create a strong password:");
const provider = await PassphraseEncryptionProvider.create(passphrase);

// Save salt (NOT the passphrase!)
LocalStorageKeyManager.savePBKDF2Salt(provider.getSalt());

const kv = createKV({ encryptionProvider: provider });
```

#### Recovery
```typescript
// User returns and enters password
const passphrase = prompt("Enter your password:");

const provider = await LocalStorageKeyManager.loadPBKDF2Provider(passphrase);

if (!provider) {
  alert("Invalid password or no account found!");
  return;
}

const kv = createKV({ encryptionProvider: provider });
// ✅ Data decrypted if password is correct
```

#### Important Notes
- ✅ Salt is stored automatically in localStorage
- ✅ Users must remember their passphrase
- ❌ No way to recover if user forgets passphrase
- ⚠️ Slow initialization (~100ms due to PBKDF2)

---

### 3. WasmMlKemProvider (Post-Quantum)

**Use Case:** Future-proof, quantum-resistant encryption

#### Initial Setup
```typescript
import { WasmMlKemProvider, LocalStorageKeyManager, createKV } from "idb-repo";

// Generate ML-KEM keypair
const provider = await WasmMlKemProvider.create();
const { publicKey, secretKey } = provider.exportKeys();

// Save keys
LocalStorageKeyManager.saveMLKEMKeys(publicKey, secretKey);

const kv = createKV({ encryptionProvider: provider });
```

#### Recovery
```typescript
// User returns to app
const provider = await LocalStorageKeyManager.loadMLKEMProvider();

if (!provider) {
  alert("Encryption keys not found! Data cannot be recovered.");
  return;
}

const kv = createKV({ encryptionProvider: provider });
// ✅ Post-quantum encrypted data now accessible
```

#### Production Setup (Secure Backend)
```typescript
import { BackendKeyManager, KeySerializer } from "idb-repo";

const keyManager = new BackendKeyManager(API_URL, userAuthToken);

// Initial setup
const provider = await WasmMlKemProvider.create();
const { publicKey, secretKey } = provider.exportKeys();

await keyManager.saveKey(userId, {
  type: "ml-kem-1024",
  publicKey: KeySerializer.serialize(publicKey),
  secretKey: KeySerializer.serialize(secretKey)
});

// Recovery
const stored = await keyManager.loadKey(userId);
const pub = KeySerializer.deserialize(stored.publicKey);
const sec = KeySerializer.deserialize(stored.secretKey);

const provider = await WasmMlKemProvider.fromKeys(pub, sec);
const kv = createKV({ encryptionProvider: provider });
```

---

## Security Best Practices

### ✅ DO

1. **Backup Keys in Multiple Secure Locations**
   - Encrypted cloud backup
   - Hardware security module (HSM)
   - Encrypted file on separate device
   - Recovery codes given to user

2. **Use Secure Storage**
   - Production: Backend API with authentication
   - Desktop: OS keychain (macOS Keychain, Windows Credential Manager)
   - Mobile: Secure enclave / keystore
   - Development: localStorage (with warnings to users)

3. **Rotate Keys Periodically**
   ```typescript
   // Generate new key
   const newKey = crypto.getRandomValues(new Uint8Array(32));

   // Re-encrypt all data with new key
   // (implementation depends on your app)

   // Save new key
   LocalStorageKeyManager.saveAESKey(newKey);
   ```

4. **Handle User Logout**
   ```typescript
   function logout() {
     // Clear encryption keys
     LocalStorageKeyManager.clear();

     // Close KV store
     await kv.close();

     // Clear session
     sessionStorage.clear();
   }
   ```

### ❌ DON'T

1. **Never hardcode keys in source code**
   ```typescript
   // ❌ BAD
   const key = new Uint8Array([1, 2, 3, ...]);

   // ✅ GOOD
   const key = crypto.getRandomValues(new Uint8Array(32));
   ```

2. **Never send unencrypted keys over HTTP**
   ```typescript
   // ❌ BAD
   await fetch("http://api.example.com/keys", {
     body: JSON.stringify({ key })
   });

   // ✅ GOOD
   await fetch("https://api.example.com/keys", { // HTTPS!
     body: JSON.stringify({ key: KeySerializer.serialize(key) })
   });
   ```

3. **Never store keys in Git**
   ```bash
   # Add to .gitignore
   echo "*.key" >> .gitignore
   echo ".env.local" >> .gitignore
   ```

4. **Never assume users remember passphrases**
   - Provide password reset flow (requires re-encryption)
   - Offer recovery codes during setup
   - Warn users about consequences of losing passphrase

---

## Testing Your Recovery Flow

Create a test to ensure recovery works:

```typescript
import { LocalStorageKeyManager } from "idb-repo";

async function testRecovery() {
  // 1. Create provider and save keys
  const provider = await WasmMlKemProvider.create();
  const { publicKey, secretKey } = provider.exportKeys();
  LocalStorageKeyManager.saveMLKEMKeys(publicKey, secretKey);

  // 2. Encrypt some test data
  const testData = new TextEncoder().encode("test");
  const encrypted = await provider.encrypt(testData);

  // 3. Simulate app restart - clear provider from memory
  // (In real app, this happens when user closes/reopens)

  // 4. Recover provider from storage
  const recovered = await LocalStorageKeyManager.loadMLKEMProvider();

  // 5. Verify we can decrypt
  const decrypted = await recovered.decrypt(encrypted);

  // 6. Verify data matches
  if (new TextDecoder().decode(decrypted) === "test") {
    console.log("✅ Recovery works!");
  } else {
    console.error("❌ Recovery failed!");
  }
}
```

---

## Multi-Device Sync

For apps that need to work across multiple devices:

1. **Save keys to authenticated backend**
   ```typescript
   const keyManager = new BackendKeyManager(API_URL, userToken);
   await keyManager.saveKey(userId, keys);
   ```

2. **Load keys on new device**
   ```typescript
   // User logs in on new device
   const stored = await keyManager.loadKey(userId);
   const provider = await WasmMlKemProvider.fromKeys(
     KeySerializer.deserialize(stored.publicKey),
     KeySerializer.deserialize(stored.secretKey)
   );
   ```

3. **Consider key rotation on device change**
   - Old device: Mark key as "migrated"
   - New device: Generate new key, re-encrypt data
   - Prevents compromised old devices from accessing new data

---

## Common Issues

### "Cannot decrypt data" Error

**Cause:** Key mismatch
**Solutions:**
- Verify you're loading the correct key
- Check if key was overwritten (wrong provider type)
- Ensure salt matches for PBKDF2

### "Key not found" Error

**Cause:** Keys not persisted
**Solutions:**
- Check `LocalStorageKeyManager.hasKey()` before loading
- Verify localStorage isn't being cleared
- Ensure keys were saved during setup

### "Data lost after reinstall"

**Cause:** Keys stored in localStorage (cleared on uninstall)
**Solution:** Use backend storage for production apps

---

## Summary

| Scenario | Recommended Approach |
|----------|---------------------|
| **Prototype/Demo** | `LocalStorageKeyManager` |
| **Production Web App** | `BackendKeyManager` with HTTPS API |
| **Multi-device App** | Backend storage + authenticated sync |
| **Password-based** | `PassphraseEncryptionProvider` + salt backup |
| **Maximum Security** | ML-KEM provider + HSM storage |
| **Offline-first** | Encrypted file export + QR code backup |

**The golden rule:** If you can't recover the keys, you can't recover the data. Plan accordingly! 🔐
