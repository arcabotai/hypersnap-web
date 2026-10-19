import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createMediaUploadGrant, MAX_MEDIA_BYTES, MEDIA_UPLOAD_HEADER, mediaGrantPayload, parseMediaUploadGrant, sha256Hex, type MediaUploadGrant } from '../src/lib/media';
import { bytesToHex, hexToBytes } from '../src/lib/protocol/signedKeyRequest';
import { handleMediaRequest, MediaUploadQuota, validateImage, type MediaEnv } from './media';

const BASE = 'https://quorum.arca.computer';
// Synthetic, unregistered test identity. It never signs a live account action.
const key = new Uint8Array(32).fill(31);
const publicKey = bytesToHex(ed25519.getPublicKey(key));
const png = new Uint8Array(readFileSync(new URL('../public/unknown-dark.png', import.meta.url)));

class MemoryQuotaStorage {
  values = new Map<string, unknown>();
  alarm = 0;
  private pending: Promise<unknown> = Promise.resolve();
  async get<T>(name: string): Promise<T | undefined> { return structuredClone(this.values.get(name)) as T | undefined; }
  async put(name: string, value: unknown): Promise<void> { this.values.set(name, structuredClone(value)); }
  async transaction<T>(callback: (txn: MemoryQuotaStorage) => Promise<T>): Promise<T> {
    const operation = this.pending.then(() => callback(this));
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  async setAlarm(time: number): Promise<void> { this.alarm = time; }
  async deleteAll(): Promise<void> { this.values.clear(); }
}

function environment() {
  const storage = new MemoryQuotaStorage();
  const quota = new MediaUploadQuota({ storage });
  const images = new Map<string, { bytes: Uint8Array; type: string }>();
  const put = vi.fn(async (hash: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => {
    if (!images.has(hash)) images.set(hash, { bytes: new Uint8Array(value), type: options.httpMetadata.contentType });
  });
  const image = (hash: string) => {
    const value = images.get(hash);
    return value ? { size: value.bytes.length, httpEtag: `"${hash}"`, httpMetadata: { contentType: value.type }, body: new Response(new Uint8Array(value.bytes).buffer).body! } : null;
  };
  const env: MediaEnv = {
    MEDIA_BUCKET: { get: async hash => image(hash), head: async hash => image(hash), put },
    MEDIA_QUOTA: { idFromName: name => name, get: () => quota },
  };
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ signers: [{
    key: publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ['MESSAGE_TYPE_CAST_ADD'],
  }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return { env, fetch, put, images, storage, quota };
}
async function grantFor(bytes = png): Promise<MediaUploadGrant> {
  return createMediaUploadGrant({ origin: BASE, sha256: await sha256Hex(bytes), size: bytes.length, contentType: 'image/png' }, { fid: 1234, publicKey }, async payload => ed25519.sign(payload, key));
}
function upload(grant: MediaUploadGrant, bytes = png, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/media/upload`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': grant.contentType, [MEDIA_UPLOAD_HEADER]: JSON.stringify(grant), ...headers }, body: new Uint8Array(bytes).buffer });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('authenticated media uploads', () => {
  it('stores only signed, active-signer, bounded images and serves immutable inert content', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    const response = await handleMediaRequest(upload(grant), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${BASE}/media/${grant.sha256}` });
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/signersByFid?fid=1234&pageSize=1000&requesterFids%5B0%5D=1234');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', cache: 'no-store' });
    expect(put.mock.calls[0][2]).toMatchObject({ onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'image/png' } });
    const image = await handleMediaRequest(new Request(`${BASE}/media/${grant.sha256}`), env);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(image.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(image.headers.get('Cache-Control')).toContain('immutable');
    expect(image.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    const cached = await handleMediaRequest(new Request(`${BASE}/media/${grant.sha256}`, { headers: { 'If-None-Match': `"${grant.sha256}"` } }), env);
    expect(cached.status).toBe(304);
  });

  it('rejects unsigned, foreign-origin and tampered grants before registry or storage', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    for (const request of [
      new Request(`${BASE}/media/upload`, { method: 'POST', headers: { Origin: BASE } }),
      upload(grant, png, { Origin: 'https://attacker.example' }),
      upload({ ...grant, fid: 4321 }),
      upload({ ...grant, sha256: 'f'.repeat(64) }),
      upload({ ...grant, publicKey: 'a'.repeat(64) }),
    ]) expect((await handleMediaRequest(request, env)).status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses replay with an atomic nonce reservation, including concurrent attempts', async () => {
    const { env, put } = environment();
    const grant = await grantFor();
    const responses = await Promise.all([handleMediaRequest(upload(grant), env), handleMediaRequest(upload(grant), env)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(put).toHaveBeenCalledOnce();
  });

  it('denies expired, wrong-owner, wrong-scope and truncated signer registries', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    for (const signer of [
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: 1, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 777, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_REACTION_ADD'] },
      { source: 'SIGNER_SOURCE_ONCHAIN', requestFid: 1234, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [{ key: publicKey, ...signer }] }), { headers: { 'Content-Type': 'application/json' } }));
      expect((await handleMediaRequest(upload(grant), env)).status).toBe(403);
    }
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [], nextPageToken: 'more' }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await handleMediaRequest(upload(grant), env)).status).toBe(503);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects mismatched bytes, forged file types and oversize streams without storing them', async () => {
    const { env, put } = environment();
    const grant = await grantFor();
    const changed = new Uint8Array(png); changed[changed.length - 1] ^= 1;
    expect((await handleMediaRequest(upload(grant, changed), env)).status).toBe(400);
    const html = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await handleMediaRequest(upload(await grantFor(html), html), env)).status).toBe(415);
    expect((await handleMediaRequest(upload(grant, new Uint8Array(MAX_MEDIA_BYTES + 1)), env)).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('rechecks revocation after the image transfer before reserving storage', async () => {
    const { env, fetch, put, storage } = environment();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [{ key: publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ['MESSAGE_TYPE_CAST_ADD'] }] }), { headers: { 'Content-Type': 'application/json' } }));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [] }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(403);
    expect(put).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('enforces daily account quota and clears nonce/account state only after grants expire', async () => {
    const { env, storage, quota, put } = environment();
    for (let i = 0; i < 10; i++) expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(200);
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(429);
    expect(put).toHaveBeenCalledTimes(10);
    expect(storage.alarm).toBeGreaterThan(Date.now() + 120000);
    await quota.alarm();
    expect(storage.values.size).toBe(0);
  });

  it('fails closed when infrastructure or the fixed Hypersnap registry is unavailable', async () => {
    expect((await handleMediaRequest(upload(await grantFor()), {})).status).toBe(503);
    const { env, fetch, put } = environment();
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }));
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(503);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps grants separate from cast signatures and rejects extra fields, unsupported hosts and expiry extension', async () => {
    const grant = await grantFor();
    const payload = mediaGrantPayload(grant);
    expect(new TextDecoder().decode(payload)).toMatch(/^arca\.hypersnap\.media\.upload\.v1\n/);
    expect(ed25519.verify(hexToBytes(grant.signature), payload, ed25519.getPublicKey(key), { zip215: false })).toBe(true);
    expect(() => parseMediaUploadGrant({ ...grant, seed: 'forbidden' })).toThrow();
    expect(() => parseMediaUploadGrant({ ...grant, origin: 'https://attacker.example' })).toThrow();
    expect(() => parseMediaUploadGrant({ ...grant, expiresAt: grant.issuedAt + 121 })).toThrow();
    expect(() => parseMediaUploadGrant(grant, grant.expiresAt)).toThrow();
  });

  it('checks image dimensions as well as MIME signatures', () => {
    expect(() => validateImage(png, 'image/png')).not.toThrow();
    const huge = new Uint8Array(png); new DataView(huge.buffer).setUint32(16, 9000);
    expect(() => validateImage(huge, 'image/png')).toThrow();
    expect(() => validateImage(png, 'image/jpeg')).toThrow();
    expect(() => validateImage(new Uint8Array(), 'image/png')).toThrow();
  });
});
