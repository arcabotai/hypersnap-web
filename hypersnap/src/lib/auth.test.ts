import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { getSigners, getUser, submitMessage, type SignersResponse, type User } from './api';
import { connectWithSeedPhrase } from './auth';
import { blake3_20 } from './protocol/messageBuilder';
import { bytesToHex, hexToBytes } from './protocol/signedKeyRequest';

vi.mock('./api', () => ({ getSigners: vi.fn(), getUser: vi.fn(), submitMessage: vi.fn() }));

const TEST_PHRASE = 'test test test test test test test test test test test junk';
const CUSTODY = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const user = { fid: 1234, username: 'test', display_name: 'Test', custody_address: CUSTODY } as User;
const encoder = new TextEncoder();
const privateKey = hkdf(sha256, hexToBytes('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'), encoder.encode('https://quorum.arca.computer/hypersnap-signer/v1'), encoder.encode('Ed25519 signing key'), 32);
const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
const scopes = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
const active: SignersResponse = { signers: [{ key: `0x${publicKey}`, source: 'SIGNER_SOURCE_OFFCHAIN', scopes, expiresAt: Math.floor(Date.now() / 1000) + 86400 }], currentUserNonce: 4, gaslessSignerCount: 1, gaslessSignerLimit: 1000 };
const empty = { ...active, signers: [], gaslessSignerCount: 0 };

// Small read-only decoder for assertions against the real protobuf bytes.
function fields(bytes: Uint8Array): Map<number, Uint8Array | number> {
  let offset = 0;
  const result = new Map<number, Uint8Array | number>();
  const varint = () => {
    let n = 0, shift = 0, byte: number;
    do { byte = bytes[offset++]; n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return n;
  };
  while (offset < bytes.length) {
    const tag = varint();
    if ((tag & 7) === 0) result.set(tag >> 3, varint());
    else if ((tag & 7) === 2) { const length = varint(); result.set(tag >> 3, bytes.slice(offset, offset += length)); }
    else throw new Error('Unexpected wire type');
  }
  return result;
}

describe('local Farcaster wallet session', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getUser).mockResolvedValue(user);
    vi.mocked(getSigners).mockResolvedValue(active);
    vi.mocked(submitMessage).mockResolvedValue({});
  });

  it('derives the standard custody address, clears the input before requests, and reuses its active deterministic signer', async () => {
    const onDerived = vi.fn();
    vi.mocked(getUser).mockImplementation(async () => {
      expect(onDerived).toHaveBeenCalledOnce();
      return user;
    });
    const session = await connectWithSeedPhrase(`  ${TEST_PHRASE.toUpperCase()}\n`, { onDerived });
    expect(getUser).toHaveBeenCalledWith({ custodyAddress: CUSTODY }, undefined);
    expect(session.publicKey).toBe(publicKey);
    expect(session.fid).toBe(1234);
    expect(submitMessage).not.toHaveBeenCalled();
    expect(Object.keys(session)).not.toContain('privateKey');
    session.dispose();
  });

  it('registers only required scopes and waits for confirmed registry inclusion', async () => {
    vi.mocked(getSigners).mockResolvedValueOnce(empty).mockResolvedValueOnce(active);
    const session = await connectWithSeedPhrase(TEST_PHRASE);
    expect(getSigners).toHaveBeenCalledTimes(2);
    expect(submitMessage).toHaveBeenCalledOnce();
    const envelope = vi.mocked(submitMessage).mock.calls[0][0];
    const decoded = fields(envelope);
    const data = fields(decoded.get(1) as Uint8Array);
    expect(data.get(1)).toBe(16);
    const keyAdd = fields(data.get(19) as Uint8Array);
    expect(keyAdd.get(5)).toBe(5); // network nonce + 1
    expect(Array.from(keyAdd.get(9) as Uint8Array)).toEqual([1, 3, 4]);
    const deadline = keyAdd.get(4) as number;
    expect(deadline).toBeGreaterThan(Math.floor(Date.now() / 1000) - 1609459200);
    expect(deadline).toBeLessThan(Math.floor(Date.now() / 1000) - 1609459200 + 3602);
    expect(new TextDecoder().decode(envelope)).not.toContain(TEST_PHRASE);
    session.dispose();
  });

  it('does not submit a second message after an uncertain registration request fails', async () => {
    vi.mocked(getSigners).mockResolvedValueOnce(empty);
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Network timeout'));
    await expect(connectWithSeedPhrase(TEST_PHRASE)).rejects.toThrow('Network timeout');
    expect(submitMessage).toHaveBeenCalledOnce();
  });

  it('renews an expired stored key even at the signer cap, and does not mistake its old record for confirmation', async () => {
    const expired = { ...active, gaslessSignerCount: 1000, signers: [{ ...active.signers[0], expiresAt: 1 }] };
    vi.mocked(getSigners).mockResolvedValueOnce(expired).mockResolvedValueOnce(expired).mockResolvedValueOnce(active);
    const session = await connectWithSeedPhrase(TEST_PHRASE);
    expect(submitMessage).toHaveBeenCalledOnce();
    expect(getSigners).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('reauthorizes a signer missing required message scopes', async () => {
    const restricted = { ...active, signers: [{ ...active.signers[0], scopes: ['MESSAGE_TYPE_CAST_ADD'] }] };
    vi.mocked(getSigners).mockResolvedValueOnce(restricted).mockResolvedValueOnce(active);
    const session = await connectWithSeedPhrase(TEST_PHRASE);
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('cancels after a submitted registration without creating a usable session or retrying', async () => {
    const controller = new AbortController();
    vi.mocked(getSigners).mockResolvedValueOnce(empty);
    vi.mocked(submitMessage).mockImplementationOnce(async () => { controller.abort(); return {}; });
    await expect(connectWithSeedPhrase(TEST_PHRASE, { signal: controller.signal })).rejects.toThrow('Sign-in cancelled');
    expect(getSigners).toHaveBeenCalledTimes(1);
    expect(submitMessage).toHaveBeenCalledOnce();
  });

  it('rejects an unusable nonce without signing or submitting a registration', async () => {
    vi.mocked(getSigners).mockResolvedValueOnce({ ...empty, currentUserNonce: Number.NaN });
    await expect(connectWithSeedPhrase(TEST_PHRASE)).rejects.toThrow('usable signer nonce');
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('validates checksum before networking and clears an invalid phrase from the input', async () => {
    const onDerived = vi.fn();
    await expect(connectWithSeedPhrase('test '.repeat(12), { onDerived })).rejects.toThrow('valid English');
    expect(onDerived).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('rejects mismatched custody and full signer registries without registering', async () => {
    vi.mocked(getUser).mockResolvedValueOnce({ ...user, custody_address: '0x0000000000000000000000000000000000000001' });
    await expect(connectWithSeedPhrase(TEST_PHRASE)).rejects.toThrow('does not control');
    expect(getSigners).not.toHaveBeenCalled();
    vi.mocked(getSigners).mockResolvedValueOnce({ ...empty, gaslessSignerCount: 1000 });
    await expect(connectWithSeedPhrase(TEST_PHRASE)).rejects.toThrow('signer limit');
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('signs valid cast and reaction envelopes and disables signing on logout', async () => {
    const session = await connectWithSeedPhrase(TEST_PHRASE);
    const receipt = await session.cast('Hello Hypersnap');
    const envelope = vi.mocked(submitMessage).mock.calls[0][0];
    const decoded = fields(envelope);
    const hash = decoded.get(2) as Uint8Array;
    expect(bytesToHex(blake3_20(decoded.get(7) as Uint8Array))).toBe(receipt.hash);
    expect(ed25519.verify(decoded.get(4) as Uint8Array, hash, decoded.get(6) as Uint8Array)).toBe(true);
    await session.react({ fid: 3, hash: 'ab'.repeat(20) }, 'like');
    const reactionData = fields(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(1) as Uint8Array);
    expect(reactionData.get(1)).toBe(3);
    session.dispose();
    await expect(session.cast('After logout')).rejects.toThrow('session has ended');
    expect(submitMessage).toHaveBeenCalledTimes(2);
  });

  it('uses UTF-8 byte limits and LONG_CAST for text above 320 bytes', async () => {
    const session = await connectWithSeedPhrase(TEST_PHRASE);
    await expect(session.cast('😀'.repeat(257))).rejects.toThrow('1,024 UTF-8 bytes');
    expect(submitMessage).not.toHaveBeenCalled();
    await session.cast('😀'.repeat(100));
    const data = fields(fields(vi.mocked(submitMessage).mock.calls[0][0]).get(1) as Uint8Array);
    expect(fields(data.get(5) as Uint8Array).get(8)).toBe(1);
    await expect(session.react({ fid: 3, hash: 'bad' }, 'recast')).rejects.toThrow('Invalid cast hash');
    session.dispose();
  });
});
