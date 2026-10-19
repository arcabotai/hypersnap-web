import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb';
import { ed25519 } from '@noble/curves/ed25519.js';
import { decryptSignerVault, deleteSavedVault, encryptSignerVault, readSavedVault, writeSavedVault, VAULT_ITERATIONS, type VaultMetadata, type SignerVault } from './vault';
import { bytesToHex } from './protocol/signedKeyRequest';

const PASSWORD = 'synthetic vault passphrase';
const ORIGIN = 'https://quorum.arca.computer';
const key = new Uint8Array(32).fill(19); // synthetic app key, unrelated to custody
const metadata: VaultMetadata = { origin: ORIGIN, fid: 1234, custodyAddress: `0x${'ab'.repeat(20)}`, publicKey: bytesToHex(ed25519.getPublicKey(key)), requestFid: 1234, scopes: [1, 3, 4], ttl: 604800 };

describe('versioned encrypted device posting-key vault', () => {
  it('authenticates explicit social permissions without changing legacy vault compatibility', async () => {
    const expanded = { ...metadata, scopes: [1, 3, 4, 5, 6, 11] };
    const vault = await encryptSignerVault(key, expanded, PASSWORD);
    const recovered = await decryptSignerVault(vault, PASSWORD, ORIGIN);
    expect(recovered.metadata.scopes).toEqual(expanded.scopes);
    recovered.privateKey.fill(0);
    await expect(decryptSignerVault({ ...vault, metadata }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, metadata: { ...expanded, scopes: [1, 3, 4, 5, 6, 11, 16] } }, PASSWORD, ORIGIN)).rejects.toThrow('invalid permissions');
  });
  it('encrypts only 32 app-key bytes with independent secure salt/IV and decrypts with authenticated metadata', async () => {
    const first = await encryptSignerVault(key, metadata, PASSWORD);
    const second = await encryptSignerVault(key, metadata, PASSWORD);
    expect(first.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    expect(VAULT_ITERATIONS).toBe(600000);
    expect(first.kdf.salt).toHaveLength(32);
    expect(first.cipher.iv).toHaveLength(24);
    expect(first.cipher).toMatchObject({ name: 'AES-GCM', length: 256, tagLength: 128 });
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.cipher.iv).not.toBe(second.cipher.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.ciphertext).toHaveLength(96); // 32 key bytes + 16-byte GCM tag
    expect(JSON.stringify(first)).not.toContain(bytesToHex(key));
    expect(JSON.stringify(first)).not.toContain(PASSWORD);
    const recovered = await decryptSignerVault(first, PASSWORD, ORIGIN);
    expect(recovered.privateKey).toEqual(key);
    expect(recovered.metadata).toEqual(metadata);
    recovered.privateKey.fill(0);
    expect(key[0]).toBe(19);
  });

  it('rejects wrong passwords, ciphertext tampering, and account metadata substitution', async () => {
    const vault = await encryptSignerVault(key, metadata, PASSWORD);
    await expect(decryptSignerVault(vault, 'wrong synthetic password', ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, ciphertext: `${vault.ciphertext[0] === '0' ? '1' : '0'}${vault.ciphertext.slice(1)}` }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, metadata: { ...vault.metadata, fid: 5678, requestFid: 5678 } }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, metadata: { ...vault.metadata, custodyAddress: `0x${'cd'.repeat(20)}` } }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, kdf: { ...vault.kdf, salt: '00'.repeat(16) } }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
    await expect(decryptSignerVault({ ...vault, cipher: { ...vault.cipher, iv: '00'.repeat(12) } }, PASSWORD, ORIGIN)).rejects.toThrow('Could not unlock');
  });

  it('rejects unsafe/malformed schemas before unbounded crypto work and scopes the vault to its origin', async () => {
    const vault = await encryptSignerVault(key, metadata, PASSWORD);
    await expect(decryptSignerVault(vault, PASSWORD, 'https://other.example')).rejects.toThrow('different website');
    await expect(decryptSignerVault({ ...vault, version: 2 }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, mnemonic: 'unwanted field' }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, kdf: { ...vault.kdf, iterations: 1e12 } }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, metadata: { ...metadata, scopes: [1, 3, 4, 16] } }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, metadata: { ...metadata, ttl: 0 } }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, ciphertext: 'ff'.repeat(10000) }, PASSWORD, ORIGIN)).rejects.toThrow('invalid');
    await expect(decryptSignerVault({ ...vault, metadata: { ...metadata, origin: `${ORIGIN}/path` } }, PASSWORD, ORIGIN)).rejects.toThrow('invalid origin');
  });

  it('requires a bounded device password and a key matching its claimed public key', async () => {
    await expect(encryptSignerVault(key, metadata, 'short')).rejects.toThrow('12');
    await expect(encryptSignerVault(key, metadata, 'x'.repeat(1025))).rejects.toThrow('1,024');
    await expect(encryptSignerVault(new Uint8Array(32).fill(20), metadata, PASSWORD)).rejects.toThrow('does not match');
    await expect(encryptSignerVault(new Uint8Array(64), metadata, PASSWORD)).rejects.toThrow('does not match');
  });
});

describe('atomic device vault storage', () => {
  beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function rawWrite(value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('arca-hypersnap', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('device-vault');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('device-vault', 'readwrite');
        tx.objectStore('device-vault').put(value, 'posting-signer');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }

  function storageFixture(publicKey = metadata.publicKey): SignerVault {
    // Storage schema fixture only: no private key material is present, and this
    // placeholder ciphertext is never decrypted by these transaction tests.
    return {
      kind: 'arca.hypersnap.device-vault', version: 1,
      metadata: { ...metadata, publicKey },
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_ITERATIONS, salt: '00'.repeat(16) },
      cipher: { name: 'AES-GCM', length: 256, iv: '00'.repeat(12), tagLength: 128 },
      ciphertext: '00'.repeat(48),
    };
  }

  it('deletes only the requested key and preserves a different session’s vault', async () => {
    const vault = storageFixture();
    await writeSavedVault(vault);
    await deleteSavedVault('ff'.repeat(32));
    expect(await readSavedVault()).toEqual(vault);
    await deleteSavedVault(metadata.publicKey);
    expect(await readSavedVault()).toBeUndefined();
  });

  it('preserves a new tab’s replacement saved while matching-key cleanup runs', async () => {
    const oldVault = storageFixture();
    const newVault = storageFixture('ff'.repeat(32));
    await writeSavedVault(oldVault);
    let replacement: Promise<void> | undefined;
    const originalGet = FakeIDBObjectStore.prototype.get;
    const spy = vi.spyOn(FakeIDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, query) {
      const request = originalGet.call(this, query);
      request.addEventListener('success', () => {
        // Starts another connection at the earliest point after the cleanup
        // read. IDB must serialize its write behind the same transaction's
        // conditional delete; a separate read/delete pair loses this race.
        replacement = writeSavedVault(newVault);
      }, { once: true });
      return request;
    });
    await deleteSavedVault(metadata.publicKey);
    expect(replacement).toBeDefined();
    await replacement;
    spy.mockRestore();
    expect(await readSavedVault()).toEqual(newVault);
  });

  it('allows explicit deletion of corrupt records while key-scoped cleanup preserves them', async () => {
    const corrupt = { corrupted: true };
    await rawWrite(corrupt);
    await deleteSavedVault(metadata.publicKey);
    expect(await readSavedVault()).toEqual(corrupt);
    await deleteSavedVault();
    expect(await readSavedVault()).toBeUndefined();
  });
});
