import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getSigners, getUser, submitMessage, type SignersResponse, type User } from './api';
import { deleteSavedSession, hasSavedSession, preparePairing, unlockSavedSession, type PendingPairing, type PendingRevocation } from './auth';
import { hashPairingRequest, hashRevocationRequest, type PairingApproval, type RevocationApproval } from './pairing';
import { blake3_20 } from './protocol/messageBuilder';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest, signEip712Digest } from './protocol/signedKeyRequest';
import { deleteSavedVault, readSavedVault, writeSavedVault } from './vault';

vi.mock('./api', () => ({ getSigners: vi.fn(), getUser: vi.fn(), submitMessage: vi.fn() }));
vi.mock('./vault', async importOriginal => ({ ...await importOriginal<typeof import('./vault')>(), readSavedVault: vi.fn(), writeSavedVault: vi.fn(), deleteSavedVault: vi.fn() }));

const ORIGIN = 'https://quorum.arca.computer';
const CUSTODY_KEY = hexToBytes('01'.repeat(32)); // synthetic test fixture; no real account
const CUSTODY = addressFromCustodyPrivateKey(CUSTODY_KEY);
const user = { fid: 1234, username: 'test', display_name: 'Test', custody_address: CUSTODY } as User;
const scopes = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
let registry: SignersResponse;

function approvalFor(pending: PendingPairing): PairingApproval {
  const request = pending.request;
  const key = hexToBytes(request.publicKey);
  return {
    kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId,
    requestHash: hashPairingRequest(request), custodyAddress: CUSTODY,
    custodySignature: bytesToHex(signEip712Digest(keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: [1, 3, 4], ttl: 604800, nonce: request.nonce, deadline: request.deadline }), CUSTODY_KEY)),
    requestSignature: bytesToHex(signEip712Digest(signedKeyRequestDigest({ requestFid: request.fid, key, deadline: request.deadline }), CUSTODY_KEY)),
  };
}
function revocationApprovalFor(pending: PendingRevocation): RevocationApproval {
  const request = pending.request;
  return {
    kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId,
    requestHash: hashRevocationRequest(request), custodyAddress: CUSTODY, signatureType: 1,
    custodySignature: bytesToHex(signEip712Digest(keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline }), CUSTODY_KEY)),
  };
}

function fields(bytes: Uint8Array): Map<number, Uint8Array | number> {
  let offset = 0;
  const result = new Map<number, Uint8Array | number>();
  const varint = () => { let n = 0, shift = 0, byte: number; do { byte = bytes[offset++]; n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return n; };
  while (offset < bytes.length) {
    const tag = varint();
    if ((tag & 7) === 0) result.set(tag >> 3, varint());
    else if ((tag & 7) === 2) { const length = varint(); result.set(tag >> 3, bytes.slice(offset, offset += length)); }
    else throw new Error('Unexpected wire type');
  }
  return result;
}

async function connect() {
  const pending = await preparePairing({ fid: user.fid }, { origin: ORIGIN });
  const approval = approvalFor(pending);
  const session = await pending.complete(approval);
  return { pending, approval, session };
}

describe('offline approved per-device authentication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registry = { signers: [], currentUserNonce: 4, gaslessSignerCount: 0, gaslessSignerLimit: 1000, requesterFidNonces: { '1234': 8 } };
    vi.mocked(getUser).mockResolvedValue(user);
    vi.mocked(getSigners).mockImplementation(async () => structuredClone(registry));
    vi.mocked(readSavedVault).mockResolvedValue(undefined);
    vi.mocked(writeSavedVault).mockImplementation(async vault => { vi.mocked(readSavedVault).mockResolvedValue(vault); });
    vi.mocked(submitMessage).mockImplementation(async envelope => {
      const data = fields(fields(envelope).get(1) as Uint8Array);
      if (data.get(1) === 16) {
        const key = fields(data.get(19) as Uint8Array).get(1) as Uint8Array;
        registry = { ...registry, currentUserNonce: 5, gaslessSignerCount: 1, signers: [{ key: bytesToHex(key), source: 'SIGNER_SOURCE_OFFCHAIN', scopes, requestFid: user.fid, expiresAt: Math.floor(Date.now() / 1000) + 604800 }] };
      } else if (data.get(1) === 17) registry = { ...registry, signers: [], gaslessSignerCount: 0 };
      return {};
    });
  });

  it('creates independent random keys and immutable public requests without writes or persistence', async () => {
    const first = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const second = await preparePairing({ username: 'test' }, { origin: ORIGIN });
    expect(first.request.publicKey).not.toBe(second.request.publicKey);
    expect(first.request.requestId).not.toBe(second.request.requestId);
    expect(Object.isFrozen(first.request)).toBe(true);
    expect(Object.isFrozen(first.request.scopes)).toBe(true);
    expect(first.request.ttl).toBe(604800);
    expect(first.request.nonce).toBe(5);
    expect(submitMessage).not.toHaveBeenCalled();
    expect(writeSavedVault).not.toHaveBeenCalled();
    expect(Object.keys(first)).toEqual(['request', 'user', 'submitted', 'complete', 'dispose']);
    first.dispose(); second.dispose();
  });

  it('verifies real synthetic custody signatures and submits scoped KEY_ADD, then waits for confirmed inclusion', async () => {
    const { session, pending } = await connect();
    const envelope = vi.mocked(submitMessage).mock.calls[0][0];
    const decoded = fields(envelope);
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    const data = fields(decoded.get(1) as Uint8Array);
    const body = fields(data.get(19) as Uint8Array);
    expect(data.get(1)).toBe(16);
    expect(body.get(5)).toBe(5);
    expect(Array.from(body.get(9) as Uint8Array)).toEqual([1, 3, 4]);
    expect(body.get(10)).toBe(604800);
    expect(getSigners).toHaveBeenCalledTimes(3);
    expect(writeSavedVault).not.toHaveBeenCalled();
    pending.dispose(); // transferred key survives UI cleanup
    await session.cast('Hello Hypersnap');
    const cast = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    expect(bytesToHex(blake3_20(cast.get(7) as Uint8Array))).toBe(bytesToHex(cast.get(2) as Uint8Array));
    expect(ed25519.verify(cast.get(4) as Uint8Array, cast.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    session.dispose();
    await expect(session.cast('After logout')).rejects.toThrow('session has ended');
  });

  it('rejects altered approvals, stale nonces, and custody changes without sending any message', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    await expect(pending.complete({ ...approval, requestHash: '00'.repeat(32) })).rejects.toThrow();
    registry.currentUserNonce = 5;
    await expect(pending.complete(approval)).rejects.toThrow('fresh request');
    registry.currentUserNonce = 4;
    vi.mocked(getUser).mockResolvedValueOnce({ ...user, custody_address: `0x${'12'.repeat(20)}` });
    await expect(pending.complete(approval)).rejects.toThrow('custody changed');
    expect(submitMessage).not.toHaveBeenCalled();
    pending.dispose();
  });

  it('keeps the pending key after unknown submission and subsequent completion performs reads only', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(pending.complete(approval)).rejects.toThrow('unknown');
    registry.signers = [{ key: pending.request.publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', scopes, requestFid: 1234, expiresAt: Math.floor(Date.now() / 1000) + 604800 }];
    const session = await pending.complete(approval);
    expect(session.publicKey).toBe(pending.request.publicKey);
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('accepts posts only while custody and the signer registry remain valid', async () => {
    const { session } = await connect();
    registry.signers[0].expiresAt = 1;
    await expect(session.cast('Expired')).rejects.toThrow('no longer authorized');
    expect(submitMessage).toHaveBeenCalledOnce();
    registry.signers[0].expiresAt = Math.floor(Date.now() / 1000) + 604800;
    await session.react({ fid: 3, hash: 'ab'.repeat(20) }, 'like');
    expect(fields(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(1) as Uint8Array).get(1)).toBe(3);
    await expect(session.cast('😀'.repeat(257))).rejects.toThrow('1,024 UTF-8 bytes');
    await expect(session.react({ fid: 3, hash: 'bad' }, 'recast')).rejects.toThrow('Invalid cast hash');
    session.dispose();
  });

  it('persists only with explicit encryption opt-in, unlocks against current custody, and keeps vault on signout', async () => {
    const { session } = await connect();
    await expect(session.saveToDevice('short')).rejects.toThrow('12');
    expect(writeSavedVault).not.toHaveBeenCalled();
    await session.saveToDevice('synthetic-device-password');
    const saved = vi.mocked(writeSavedVault).mock.calls[0][0];
    expect(saved.metadata.publicKey).toBe(session.publicKey);
    expect(saved.ciphertext).toHaveLength(96);
    expect(JSON.stringify(saved)).not.toContain('synthetic-device-password');
    session.dispose();
    expect(deleteSavedVault).not.toHaveBeenCalled();
    expect(await hasSavedSession(session.publicKey)).toBe(true);
    expect(await hasSavedSession('00'.repeat(32))).toBe(false);
    const unlocked = await unlockSavedSession('synthetic-device-password', { origin: ORIGIN });
    expect(unlocked.publicKey).toBe(session.publicKey);
    unlocked.dispose();
    registry.signers = [];
    await expect(unlockSavedSession('synthetic-device-password', { origin: ORIGIN })).rejects.toThrow('expired or revoked');
  });

  it('self-revokes with app nonce and verifies actual removal before deleting the matching vault', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    await session.revoke();
    const decoded = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    const data = fields(decoded.get(1) as Uint8Array);
    const remove = fields(data.get(20) as Uint8Array);
    expect(data.get(1)).toBe(17);
    expect(remove.get(3)).toBe(2);
    expect(remove.get(5)).toBe(9); // app namespace, not custody nonce
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    expect(deleteSavedVault).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('does not retry uncertain revocation or destroy its recovery key', async () => {
    const { session } = await connect();
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(session.revoke()).rejects.toThrow('unknown');
    expect(deleteSavedVault).not.toHaveBeenCalled();
    registry.signers = [];
    await session.revoke();
    expect(submitMessage).toHaveBeenCalledTimes(2); // KEY_ADD plus one KEY_REMOVE
  });

  it('does not mistake an expired registry record for a confirmed revocation', async () => {
    const { session } = await connect();
    registry.signers[0].expiresAt = 1;
    vi.mocked(submitMessage).mockResolvedValueOnce({}); // node has not merged removal
    const controller = new AbortController();
    let reads = 0;
    vi.mocked(getSigners).mockImplementation(async () => {
      if (++reads === 2) controller.abort();
      return structuredClone(registry);
    });
    await expect(session.revoke({ signal: controller.signal })).rejects.toThrow('cancelled');
    expect(deleteSavedVault).not.toHaveBeenCalled();
    expect(registry.signers).toHaveLength(1);
    session.dispose();
  });

  it('rejects wrong returned identities and never submits after pending disposal', async () => {
    vi.mocked(getUser).mockResolvedValueOnce({ ...user, fid: 4321 });
    await expect(preparePairing({ fid: 1234 }, { origin: ORIGIN })).rejects.toThrow('different identity');
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    pending.dispose();
    await expect(pending.complete(approval)).rejects.toThrow('request has ended');
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('delegates matching-key deletion atomically and can explicitly forget corrupt vaults', async () => {
    vi.mocked(readSavedVault).mockResolvedValue({ corrupt: true });
    expect(await hasSavedSession()).toBe(true);
    await deleteSavedSession('ab'.repeat(32));
    expect(deleteSavedVault).toHaveBeenLastCalledWith('ab'.repeat(32));
    await deleteSavedSession();
    expect(deleteSavedVault).toHaveBeenLastCalledWith(undefined);
    expect(deleteSavedVault).toHaveBeenCalledTimes(2);
  });

  it('uses offline custody-approved revocation when the live node omits app nonces', async () => {
    const { session } = await connect();
    delete registry.requesterFidNonces;
    await expect(session.revoke()).rejects.toThrow('usable signer nonce');
    expect(submitMessage).toHaveBeenCalledOnce();
    const pending = await session.prepareRevocation();
    expect(pending.request.nonce).toBe(6); // KEY_ADD advanced the custody namespace
    expect(pending.submitted).toBe(false);
    expect(Object.isFrozen(pending.request)).toBe(true);
    await pending.complete(revocationApprovalFor(pending));
    const decoded = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    const data = fields(decoded.get(1) as Uint8Array);
    const body = fields(data.get(20) as Uint8Array);
    expect(data.get(1)).toBe(17);
    expect(body.get(3)).toBe(1);
    expect(body.get(5)).toBe(6);
    expect((body.get(2) as Uint8Array).length).toBe(65);
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    expect(pending.submitted).toBe(true);
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
    pending.dispose();
  });

  it('rejects mismatched or stale offline revocation approvals before writing', async () => {
    const { session } = await connect();
    const pending = await session.prepareRevocation();
    const approval = revocationApprovalFor(pending);
    await expect(pending.complete({ ...approval, requestHash: '00'.repeat(32) })).rejects.toThrow();
    registry.currentUserNonce = 6;
    await expect(pending.complete(approval)).rejects.toThrow('fresh revocation request');
    expect(pending.submitted).toBe(false);
    expect(submitMessage).toHaveBeenCalledOnce();
    pending.dispose();
    await expect(pending.complete(approval)).rejects.toThrow('request has ended');
    session.dispose();
  });

  it('resumes unknown offline revocation using only reads even after its modal closes', async () => {
    const { session } = await connect();
    const first = await session.prepareRevocation();
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(first.complete(revocationApprovalFor(first))).rejects.toThrow('unknown');
    expect(first.submitted).toBe(true);
    first.dispose();
    const recovered = await session.prepareRevocation();
    expect(recovered.submitted).toBe(true);
    registry.signers = [];
    await recovered.complete();
    expect(submitMessage).toHaveBeenCalledTimes(2);
    expect(deleteSavedVault).not.toHaveBeenCalled(); // ephemeral key had no saved vault
  });

  it('retries failed local cleanup after confirmed offline revocation without another submission', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    const pending = await session.prepareRevocation();
    vi.mocked(deleteSavedVault).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(pending.complete(revocationApprovalFor(pending))).rejects.toThrow('Revocation is confirmed on Hypersnap');
    expect(pending.submitted).toBe(true);
    expect(registry.signers).toHaveLength(0);
    await pending.complete();
    expect(submitMessage).toHaveBeenCalledTimes(2);
    expect(deleteSavedVault).toHaveBeenCalledTimes(2);
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('clears an already removed key using read-only confirmation without custody import', async () => {
    const { session } = await connect();
    registry.signers = [];
    const pending = await session.prepareRevocation();
    expect(pending.submitted).toBe(true);
    await pending.complete();
    expect(submitMessage).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('waits for a committing save before clearing its vault after revocation', async () => {
    const { session } = await connect();
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
    vi.mocked(writeSavedVault).mockImplementationOnce(async vault => {
      writeStarted();
      await blocked;
      vi.mocked(readSavedVault).mockResolvedValue(vault);
    });
    const saving = session.saveToDevice('synthetic-device-password');
    // Attach the rejection handler before a concurrent revocation invalidates it.
    const rejectedSave = expect(saving).rejects.toThrow('session has ended');
    await started;
    const pending = await session.prepareRevocation();
    const revoking = pending.complete(revocationApprovalFor(pending));
    await vi.waitFor(() => expect(submitMessage).toHaveBeenCalledTimes(2));
    expect(deleteSavedVault).not.toHaveBeenCalled();
    releaseWrite();
    await rejectedSave;
    await revoking;
    expect(deleteSavedVault).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('removes a save that commits after the session was disposed', async () => {
    const { session } = await connect();
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
    vi.mocked(writeSavedVault).mockImplementationOnce(async vault => {
      writeStarted();
      await blocked;
      vi.mocked(readSavedVault).mockResolvedValue(vault);
    });
    const saving = session.saveToDevice('synthetic-device-password');
    const rejectedSave = expect(saving).rejects.toThrow('session has ended');
    await started;
    session.dispose();
    releaseWrite();
    await rejectedSave;
    expect(deleteSavedVault).toHaveBeenCalledOnce();
  });
});
