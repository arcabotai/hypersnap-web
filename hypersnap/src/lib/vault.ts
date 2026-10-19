import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from './protocol/signedKeyRequest';
import { validatePairingScopes } from './pairing';

// Platform-agnostic crypto/schema are candidates for a future shared signer
// package; IndexedDB intentionally stays in this browser adapter.
export const VAULT_ITERATIONS = 600_000;
const KIND = 'arca.hypersnap.device-vault';
const DATABASE = 'arca-hypersnap';
const STORE = 'device-vault';
const RECORD = 'posting-signer';

export interface VaultMetadata {
  origin: string;
  fid: number;
  custodyAddress: string;
  publicKey: string;
  requestFid: number;
  scopes: number[];
  ttl: 604800;
}

export interface SignerVault {
  kind: typeof KIND;
  version: 1;
  metadata: VaultMetadata;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: typeof VAULT_ITERATIONS; salt: string };
  cipher: { name: 'AES-GCM'; length: 256; iv: string; tagLength: 128 };
  ciphertext: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validateMetadata(value: unknown): VaultMetadata {
  if (!object(value) || !exact(value, ['origin', 'fid', 'custodyAddress', 'publicKey', 'requestFid', 'scopes', 'ttl']) ||
    typeof value.origin !== 'string' || value.origin.length > 200 ||
    !Number.isSafeInteger(value.fid) || Number(value.fid) < 1 || value.requestFid !== value.fid ||
    typeof value.custodyAddress !== 'string' || !/^0x[0-9a-f]{40}$/.test(value.custodyAddress) ||
    typeof value.publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(value.publicKey) ||
    !Array.isArray(value.scopes) || value.ttl !== 604800) {
    throw new Error('The saved device vault is invalid. You can forget it and authorize a new device.');
  }
  let origin: URL;
  try { origin = new URL(value.origin); } catch { throw new Error('The saved device vault has an invalid origin.'); }
  if (origin.origin !== value.origin || origin.protocol !== 'https:') throw new Error('The saved device vault has an invalid origin.');
  let scopes: number[];
  try { scopes = validatePairingScopes(value.scopes); } catch { throw new Error('The saved device vault has invalid permissions.'); }
  return {
    origin: value.origin, fid: value.fid as number, custodyAddress: value.custodyAddress,
    publicKey: value.publicKey, requestFid: value.fid as number, scopes, ttl: 604800,
  };
}

function validateVault(value: unknown): SignerVault {
  if (!object(value) || !exact(value, ['kind', 'version', 'metadata', 'kdf', 'cipher', 'ciphertext']) ||
    value.kind !== KIND || value.version !== 1 || !object(value.kdf) || !object(value.cipher) ||
    !exact(value.kdf, ['name', 'hash', 'iterations', 'salt']) || !exact(value.cipher, ['name', 'length', 'iv', 'tagLength']) ||
    value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== VAULT_ITERATIONS ||
    typeof value.kdf.salt !== 'string' || !/^[0-9a-f]{32}$/.test(value.kdf.salt) ||
    value.cipher.name !== 'AES-GCM' || value.cipher.length !== 256 || value.cipher.tagLength !== 128 ||
    typeof value.cipher.iv !== 'string' || !/^[0-9a-f]{24}$/.test(value.cipher.iv) ||
    typeof value.ciphertext !== 'string' || !/^[0-9a-f]{96}$/.test(value.ciphertext)) {
    throw new Error('The saved device vault is invalid. You can forget it and authorize a new device.');
  }
  return { kind: KIND, version: 1, metadata: validateMetadata(value.metadata), kdf: value.kdf as SignerVault['kdf'], cipher: value.cipher as SignerVault['cipher'], ciphertext: value.ciphertext };
}

export function validateVaultPassword(password: string): void {
  if (password.length < 12 || password.length > 1024) throw new Error('Use a device password of 12 to 1,024 characters.');
}

function cryptoProvider(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error('Secure device storage is unavailable in this browser.');
  return globalThis.crypto;
}

function aad(vault: Omit<SignerVault, 'ciphertext'>): ArrayBuffer {
  // Reconstructed, fixed-order metadata authenticates account, permissions,
  // origin, algorithm choices, salt and IV alongside the encrypted key.
  return new TextEncoder().encode(JSON.stringify({
    kind: KIND, version: 1,
    metadata: validateMetadata(vault.metadata),
    kdf: { name: vault.kdf.name, hash: vault.kdf.hash, iterations: vault.kdf.iterations, salt: vault.kdf.salt },
    cipher: { name: vault.cipher.name, length: vault.cipher.length, iv: vault.cipher.iv, tagLength: vault.cipher.tagLength },
  })).buffer;
}

async function passwordKey(password: string, salt: string): Promise<CryptoKey> {
  validateVaultPassword(password);
  const crypto = cryptoProvider();
  const bytes = new TextEncoder().encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes.buffer, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_ITERATIONS, salt: hexToBytes(salt).buffer as ArrayBuffer }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}

/** Encrypt exactly one random app signer; custody keys and phrases are never accepted. */
export async function encryptSignerVault(privateKey: Uint8Array, metadata: VaultMetadata, password: string): Promise<SignerVault> {
  validateVaultPassword(password);
  const checked = validateMetadata(metadata);
  if (privateKey.length !== 32 || bytesToHex(ed25519.getPublicKey(privateKey)) !== checked.publicKey) throw new Error('The device signer does not match its public key.');
  const crypto = cryptoProvider();
  const header: Omit<SignerVault, 'ciphertext'> = {
    kind: KIND, version: 1, metadata: checked,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_ITERATIONS, salt: bytesToHex(crypto.getRandomValues(new Uint8Array(16))) },
    cipher: { name: 'AES-GCM', length: 256, iv: bytesToHex(crypto.getRandomValues(new Uint8Array(12))), tagLength: 128 },
  };
  const plaintext = new Uint8Array(privateKey);
  try {
    const key = await passwordKey(password, header.kdf.salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: hexToBytes(header.cipher.iv).buffer as ArrayBuffer, tagLength: 128, additionalData: aad(header) }, key, plaintext.buffer);
    return { ...header, ciphertext: bytesToHex(new Uint8Array(encrypted)) };
  } finally { plaintext.fill(0); }
}

export async function decryptSignerVault(value: unknown, password: string, origin: string): Promise<{ metadata: VaultMetadata; privateKey: Uint8Array }> {
  validateVaultPassword(password);
  const vault = validateVault(value);
  if (vault.metadata.origin !== origin) throw new Error('This device vault belongs to a different website.');
  const key = await passwordKey(password, vault.kdf.salt);
  let plaintext: Uint8Array | undefined;
  try {
    const decrypted = await cryptoProvider().subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(vault.cipher.iv).buffer as ArrayBuffer, tagLength: 128, additionalData: aad(vault) }, key, hexToBytes(vault.ciphertext).buffer as ArrayBuffer);
    plaintext = new Uint8Array(decrypted);
    if (plaintext.length !== 32 || bytesToHex(ed25519.getPublicKey(plaintext)) !== vault.metadata.publicKey) throw new Error('Invalid signer.');
    return { metadata: vault.metadata, privateKey: plaintext };
  } catch {
    plaintext?.fill(0);
    throw new Error('Could not unlock the device vault. Check your password, or forget a damaged vault and authorize again.');
  }
}

async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('Device storage is unavailable in this browser.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open device storage.'));
    request.onblocked = () => reject(new Error('Close other Arca tabs to open device storage.'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Could not access device storage.')); };
  });
}

export async function readSavedVault(): Promise<unknown> { return transaction('readonly', store => store.get(RECORD)); }
export async function writeSavedVault(vault: SignerVault): Promise<void> { await transaction('readwrite', store => store.put(validateVault(vault), RECORD)); }
/**
 * A matching-key deletion is one readwrite transaction, so a different tab
 * cannot replace the record between comparison and deletion. An unqualified
 * user-requested deletion still clears corrupt records without parsing them.
 */
export async function deleteSavedVault(expectedPublicKey?: string): Promise<void> {
  if (expectedPublicKey === undefined) {
    await transaction('readwrite', store => store.delete(RECORD));
    return;
  }
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(RECORD);
    request.onsuccess = () => {
      const saved: unknown = request.result;
      if (object(saved) && object(saved.metadata) && saved.metadata.publicKey === expectedPublicKey) store.delete(RECORD);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Could not access device storage.')); };
  });
}
