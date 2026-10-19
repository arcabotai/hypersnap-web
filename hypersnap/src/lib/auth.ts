import { ed25519 } from '@noble/curves/ed25519.js';
import { getSigners, getUser, submitMessage, type Signer, type SignersResponse, type User } from './api';
import { PAIRING_SCOPES, PAIRING_TTL_SECONDS, validatePairingRequest, verifyPairingApproval, validateRevocationRequest, verifyRevocationApproval, type PairingApproval, type PairingRequest, type RevocationRequest, type RevocationApproval } from './pairing';
import { buildSignedMessage, CastType, farcasterTimestamp, MessageType, ReactionType, SignatureScheme, type MessageDataInput } from './protocol/messageBuilder';
import { abiEncodeSignedKeyRequestMetadata, bytesToHex, hexToBytes } from './protocol/signedKeyRequest';
import { decryptSignerVault, deleteSavedVault, encryptSignerVault, readSavedVault, writeSavedVault, type VaultMetadata } from './vault';

export const SIGNER_TTL_SECONDS = PAIRING_TTL_SECONDS;
const SIGNER_SCOPE_NAMES = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
const CONFIRMATION_TIMEOUT_MS = 45_000;

export interface CastTarget { fid: number; hash: string }
export interface WriteReceipt { hash: string }
export interface ConnectOptions { signal?: AbortSignal; onProgress?: (stage: string) => void }
export interface PairingOptions extends ConnectOptions { origin: string }
export interface PendingPairing {
  readonly request: PairingRequest;
  readonly user: User;
  readonly submitted: boolean;
  /** After submission this only checks status; it never submits again. */
  complete(approval: PairingApproval, options?: ConnectOptions): Promise<WalletSession>;
  /** Completed sessions own their key; this only clears an untransferred key. */
  dispose(): void;
}
export interface PendingRevocation {
  readonly request: RevocationRequest;
  readonly submitted: boolean;
  /** Approval is required only before the first submission. */
  complete(approval?: RevocationApproval, options?: ConnectOptions): Promise<void>;
  /** Cancels this request without erasing the session's device key. */
  dispose(): void;
}

export interface WalletSession {
  readonly user: User;
  readonly fid: number;
  readonly custodyAddress: string;
  readonly publicKey: string;
  cast(text: string, parent?: CastTarget): Promise<WriteReceipt>;
  react(target: CastTarget, type: 'like' | 'recast', remove?: boolean): Promise<WriteReceipt>;
  /** Explicit opt-in: only the app signer is encrypted. */
  saveToDevice(password: string): Promise<void>;
  /** Offline custody approval works even when the node omits app nonces. */
  prepareRevocation(options?: ConnectOptions): Promise<PendingRevocation>;
  /** Self-revoke on Hypersnap, confirm removal, then clear local signer/vault. */
  revoke(options?: ConnectOptions): Promise<void>;
  /** Local sign-out leaves an opted-in encrypted vault available to unlock. */
  dispose(): void;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Sign-in cancelled.', 'AbortError');
}
function assertFid(fid: number): void {
  if (!Number.isSafeInteger(fid) || fid <= 0 || fid > 0xffffffff) throw new Error('Invalid Farcaster ID.');
}
function hashBytes(hash: string): Uint8Array {
  if (!/^(?:0x)?[0-9a-fA-F]{40}$/.test(hash)) throw new Error('Invalid cast hash.');
  return hexToBytes(hash);
}
function nonceAfter(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= 0xffffffff) throw new Error('The node did not return a usable signer nonce. Please try again later.');
  return Number(value) + 1;
}
function custodyAddress(user: User): string {
  assertFid(user.fid);
  if (!/^0x[0-9a-fA-F]{40}$/.test(user.custody_address)) throw new Error('This identity has no usable custody wallet.');
  return user.custody_address.toLowerCase();
}
function clientOrigin(origin: string): string {
  // A local development browser requests approval for the published site.
  // Vite removes this branch from production builds.
  if (import.meta.env.DEV) {
    try {
      const url = new URL(origin);
      if (origin === url.origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'https://quorum.arca.computer';
    } catch { /* The strict pairing validator supplies the user-facing error. */ }
  }
  return origin;
}
function signerIn(registry: SignersResponse, key: string): Signer | undefined {
  return registry.signers.find(signer => signer.key.replace(/^0x/i, '').toLowerCase() === key);
}
function usableSigner(signer: Signer | undefined, fid: number): boolean {
  return !!signer && signer.source === 'SIGNER_SOURCE_OFFCHAIN' && signer.requestFid === fid &&
    Number.isSafeInteger(signer.expiresAt) && Number(signer.expiresAt) > Math.floor(Date.now() / 1000) + 30 &&
    SIGNER_SCOPE_NAMES.every(scope => signer.scopes?.includes(scope));
}
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Sign-in cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
async function confirmSigner(fid: number, publicKey: string, present: boolean, options: ConnectOptions): Promise<void> {
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
  do {
    assertActive(options.signal);
    const registry = await getSigners(fid, options.signal);
    const found = signerIn(registry, publicKey);
    // The node includes expired records: revocation requires actual absence.
    if (present ? usableSigner(found, fid) : !found) return;
    await delay(1500, options.signal);
  } while (Date.now() < deadline);
  throw new Error(present
    ? 'Authorization status is still unknown. Keep this window open and check authorization status again. Do not approve a second request yet.'
    : 'Revocation is not confirmed. Keep this device key and check revocation again before forgetting it.');
}

/** Browser authentication never accepts a recovery phrase or custody private key. */
export async function preparePairing(lookup: { fid?: number; username?: string; custodyAddress?: string }, options: PairingOptions): Promise<PendingPairing> {
  assertActive(options.signal);
  options.onProgress?.('Finding your Hypersnap identity…');
  const user = await getUser(lookup, options.signal);
  const custody = custodyAddress(user);
  if ((lookup.fid !== undefined && user.fid !== lookup.fid) || (lookup.custodyAddress !== undefined && custody !== lookup.custodyAddress.toLowerCase())) throw new Error('The node returned a different identity.');
  const registry = await getSigners(user.fid, options.signal);
  assertActive(options.signal);
  if (registry.gaslessSignerLimit !== undefined && registry.gaslessSignerCount !== undefined && registry.gaslessSignerCount >= registry.gaslessSignerLimit) throw new Error('This identity has reached its app signer limit. Revoke an unused signer before connecting.');
  let privateKey: Uint8Array | undefined = crypto.getRandomValues(new Uint8Array(32));
  try {
    const createdAt = Math.floor(Date.now() / 1000);
    const request = validatePairingRequest({
      kind: 'arca.hypersnap.signer.request', version: 1, origin: clientOrigin(options.origin),
      requestId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), createdAt,
      fid: user.fid, custodyAddress: custody, publicKey: bytesToHex(ed25519.getPublicKey(privateKey)),
      scopes: [...PAIRING_SCOPES], ttl: PAIRING_TTL_SECONDS,
      nonce: nonceAfter(registry.currentUserNonce), deadline: createdAt - 1609459200 + 900,
    });
    Object.freeze(request.scopes);
    Object.freeze(request);
    let disposed = false;
    let submitted = false;
    let completing = false;
    let session: WalletSession | undefined;
    return {
      request, user,
      get submitted() { return submitted; },
      async complete(approval, completionOptions = {}) {
        if (session) return session;
        if (disposed || !privateKey) throw new Error('This authorization request has ended. Create a new request.');
        if (completing) throw new Error('Authorization is already being checked.');
        completing = true;
        try {
          assertActive(completionOptions.signal);
          if (!submitted) {
            verifyPairingApproval(request, approval);
            if (bytesToHex(ed25519.getPublicKey(privateKey)) !== request.publicKey) throw new Error('The authorization request does not match this device signer.');
            completionOptions.onProgress?.('Checking current custody and authorization nonce…');
            const [currentUser, current] = await Promise.all([getUser({ fid: request.fid }, completionOptions.signal), getSigners(request.fid, completionOptions.signal)]);
            if (currentUser.fid !== request.fid || custodyAddress(currentUser) !== request.custodyAddress) throw new Error('Account custody changed. Create a new authorization request.');
            if (nonceAfter(current.currentUserNonce) !== request.nonce) throw new Error('Account authorization changed. Create and approve a fresh request.');
            if (current.gaslessSignerLimit !== undefined && current.gaslessSignerCount !== undefined && current.gaslessSignerCount >= current.gaslessSignerLimit) throw new Error('This identity has reached its app signer limit.');
            const publicKeyBytes = hexToBytes(request.publicKey);
            const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: request.fid, requestSigner: request.custodyAddress, signature: hexToBytes(approval.requestSignature), deadline: request.deadline });
            const { envelope } = await buildSignedMessage({
              type: MessageType.KEY_ADD, fid: request.fid,
              body: { keyAddBody: { key: publicKeyBytes, custodySignature: hexToBytes(approval.custodySignature), deadline: request.deadline, nonce: request.nonce, metadata, scopes: [...PAIRING_SCOPES], ttl: PAIRING_TTL_SECONDS } },
            }, { scheme: SignatureScheme.ED25519, publicKey: publicKeyBytes, sign: async digest => ed25519.sign(digest, privateKey!) });
            assertActive(completionOptions.signal);
            if (disposed) throw new Error('This authorization request has ended.');
            completionOptions.onProgress?.('Submitting your approved device signer…');
            submitted = true; // An uncertain outcome must never retry the write.
            await submitMessage(envelope, completionOptions.signal);
          }
          completionOptions.onProgress?.('Checking signer confirmation…');
          await confirmSigner(request.fid, request.publicKey, true, completionOptions);
          const currentUser = await getUser({ fid: request.fid }, completionOptions.signal);
          assertActive(completionOptions.signal);
          if (disposed || !privateKey) throw new Error('This authorization request has ended.');
          if (currentUser.fid !== request.fid || custodyAddress(currentUser) !== request.custodyAddress) throw new Error('Account custody changed. Authorize a new device signer.');
          session = createSession(currentUser, privateKey, {
            origin: request.origin, fid: request.fid, custodyAddress: request.custodyAddress,
            publicKey: request.publicKey, requestFid: request.fid, scopes: [1, 3, 4], ttl: 604800,
          });
          privateKey = undefined; // Session now owns the key.
          return session;
        } finally { completing = false; }
      },
      dispose() { disposed = true; privateKey?.fill(0); privateKey = undefined; },
    };
  } catch (error) { privateKey?.fill(0); throw error; }
}

function savedPublicKey(saved: unknown): string | undefined {
  if (saved && typeof saved === 'object' && 'metadata' in saved && saved.metadata && typeof saved.metadata === 'object' && 'publicKey' in saved.metadata && typeof saved.metadata.publicKey === 'string') return saved.metadata.publicKey;
}
export async function hasSavedSession(publicKey?: string): Promise<boolean> {
  const saved = await readSavedVault();
  return publicKey ? savedPublicKey(saved) === publicKey : saved !== undefined;
}
export async function deleteSavedSession(publicKey?: string): Promise<void> {
  await deleteSavedVault(publicKey);
}
export async function unlockSavedSession(password: string, options: ConnectOptions & { origin?: string } = {}): Promise<WalletSession> {
  assertActive(options.signal);
  const saved = await readSavedVault();
  if (saved === undefined) throw new Error('There is no saved device signer. Authorize this device first.');
  const origin = options.origin ?? globalThis.location?.origin;
  if (!origin) throw new Error('Could not determine this website’s origin.');
  const { privateKey, metadata } = await decryptSignerVault(saved, password, clientOrigin(origin));
  let transferred = false;
  try {
    options.onProgress?.('Checking custody and saved signer authorization…');
    const [user, registry] = await Promise.all([getUser({ fid: metadata.fid }, options.signal), getSigners(metadata.fid, options.signal)]);
    assertActive(options.signal);
    if (user.fid !== metadata.fid || custodyAddress(user) !== metadata.custodyAddress) throw new Error('Account custody changed. Forget this vault and authorize a new device signer.');
    if (!usableSigner(signerIn(registry, metadata.publicKey), metadata.fid)) throw new Error('This device signer is expired or revoked. Forget this vault and authorize the device again.');
    const session = createSession(user, privateKey, metadata, true);
    transferred = true;
    return session;
  } finally { if (!transferred) privateKey.fill(0); }
}

function createSession(user: User, privateKey: Uint8Array, metadata: VaultMetadata, persisted = false): WalletSession {
  const publicKey = hexToBytes(metadata.publicKey);
  let disposed = false;
  let revoking = false;
  let revokeSubmitted = false;
  let saving: Promise<void> | undefined;
  const assertSession = () => { if (disposed || revoking || revokeSubmitted) throw new Error('Your session has ended or is being revoked. Unlock or authorize your device again.'); };
  const sign = async (digest: Uint8Array) => { if (disposed) throw new Error('Your session has ended.'); return ed25519.sign(digest, privateKey); };
  const dispose = () => { disposed = true; privateKey.fill(0); };
  const finishRevocation = async () => {
    // A save may already be committing when revocation starts. Wait for its
    // transaction before deciding whether there is a matching vault to clear.
    await saving?.catch(() => undefined);
    // A fresh ephemeral key cannot have a matching saved vault. This also
    // lets revocation work in browsers where IndexedDB is unavailable.
    if (persisted) {
      try { await deleteSavedSession(metadata.publicKey); }
      catch { throw new Error('Revocation is confirmed on Hypersnap, but the local encrypted vault could not be cleared. Check revocation status again to retry local cleanup.'); }
    }
    dispose();
  };
  const send = async (data: MessageDataInput): Promise<WriteReceipt> => {
    assertSession();
    const [currentUser, registry] = await Promise.all([getUser({ fid: metadata.fid }), getSigners(metadata.fid)]);
    assertSession();
    if (currentUser.fid !== metadata.fid || custodyAddress(currentUser) !== metadata.custodyAddress || !usableSigner(signerIn(registry, metadata.publicKey), metadata.fid)) throw new Error('This device signer is no longer authorized. Reconnect before posting.');
    const { envelope, hash } = await buildSignedMessage(data, { scheme: SignatureScheme.ED25519, publicKey, sign });
    assertSession();
    await submitMessage(envelope);
    return { hash: bytesToHex(hash) };
  };
  return {
    user, fid: metadata.fid, custodyAddress: metadata.custodyAddress, publicKey: metadata.publicKey,
    async cast(text, parent) {
      const bytes = new TextEncoder().encode(text).length;
      if (!text.trim()) throw new Error('Write something before casting.');
      if (bytes > 1024) throw new Error('Casts can contain up to 1,024 UTF-8 bytes.');
      if (parent) assertFid(parent.fid);
      return send({ type: MessageType.CAST_ADD, fid: metadata.fid, body: { castAddBody: { text, type: bytes > 320 ? CastType.LONG_CAST : CastType.CAST, ...(parent ? { parent: { castId: { fid: parent.fid, hash: hashBytes(parent.hash) } } } : {}) } } });
    },
    async react(target, type, remove = false) {
      assertFid(target.fid);
      return send({ type: remove ? MessageType.REACTION_REMOVE : MessageType.REACTION_ADD, fid: metadata.fid, body: { reactionBody: { type: type === 'like' ? ReactionType.LIKE : ReactionType.RECAST, target: { castId: { fid: target.fid, hash: hashBytes(target.hash) } } } } });
    },
    async saveToDevice(password) {
      assertSession();
      if (saving) throw new Error('This device signer is already being saved.');
      const operation = (async () => {
        try {
          const vault = await encryptSignerVault(privateKey, metadata, password);
          password = '';
          assertSession();
          await writeSavedVault(vault);
          persisted = true;
          // A close/sign-out can happen while the IndexedDB transaction commits.
          // A save that never completed must not silently survive that close.
          if (disposed) {
            await deleteSavedSession(metadata.publicKey);
            persisted = false;
          }
          assertSession();
        } finally { password = ''; }
      })();
      saving = operation;
      try { await operation; }
      finally { if (saving === operation) saving = undefined; }
    },
    async prepareRevocation(options = {}) {
      if (disposed) throw new Error('Your session has ended. Unlock this device before revoking it.');
      if (revoking) throw new Error('Revocation is already being checked.');
      assertActive(options.signal);
      options.onProgress?.('Checking current custody and signer state…');
      const [currentUser, registry] = await Promise.all([getUser({ fid: metadata.fid }, options.signal), getSigners(metadata.fid, options.signal)]);
      assertActive(options.signal);
      if (disposed) throw new Error('Your session has ended.');
      if (currentUser.fid !== metadata.fid || custodyAddress(currentUser) !== metadata.custodyAddress) throw new Error('Account custody changed. Device revocation needs approval from the current custody wallet.');
      const existing = signerIn(registry, metadata.publicKey);
      if (existing && (existing.source !== 'SIGNER_SOURCE_OFFCHAIN' || existing.requestFid !== metadata.requestFid)) throw new Error('The node returned different signer ownership. Revocation was not submitted.');
      // If a previous modal closed during an uncertain submission, or the node
      // already removed this key, a replacement request only checks status.
      if (!existing) revokeSubmitted = true;
      const createdAt = Math.floor(Date.now() / 1000);
      const request = validateRevocationRequest({
        kind: 'arca.hypersnap.signer.revoke.request', version: 1,
        origin: metadata.origin, requestId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), createdAt,
        fid: metadata.fid, custodyAddress: metadata.custodyAddress, publicKey: metadata.publicKey,
        nonce: nonceAfter(registry.currentUserNonce), deadline: createdAt - 1609459200 + 900,
      });
      Object.freeze(request);
      let ended = false;
      let completed = false;
      let completing = false;
      return {
        request,
        get submitted() { return revokeSubmitted; },
        async complete(approval, completionOptions = {}) {
          if (completed) return;
          if (ended || disposed) throw new Error('This revocation request has ended. Open device settings again.');
          if (completing || revoking) throw new Error('Revocation is already being checked.');
          completing = true;
          revoking = true;
          try {
            assertActive(completionOptions.signal);
            if (!revokeSubmitted) {
              if (!approval) throw new Error('Import the signed revocation approval from Arca Signer.');
              verifyRevocationApproval(request, approval);
              const [freshUser, freshRegistry] = await Promise.all([getUser({ fid: metadata.fid }, completionOptions.signal), getSigners(metadata.fid, completionOptions.signal)]);
              if (freshUser.fid !== metadata.fid || custodyAddress(freshUser) !== metadata.custodyAddress) throw new Error('Account custody changed. Create a fresh revocation request.');
              if (signerIn(freshRegistry, metadata.publicKey)) {
                if (nonceAfter(freshRegistry.currentUserNonce) !== request.nonce) throw new Error('Account authorization changed. Create and approve a fresh revocation request.');
                const { envelope } = await buildSignedMessage({
                  type: MessageType.KEY_REMOVE, fid: metadata.fid,
                  body: { keyRemoveBody: { key: publicKey, signature: hexToBytes(approval.custodySignature), signatureType: 1, deadline: request.deadline, nonce: request.nonce } },
                }, { scheme: SignatureScheme.ED25519, publicKey, sign });
                assertActive(completionOptions.signal);
                if (ended || disposed) throw new Error('This revocation request has ended.');
                completionOptions.onProgress?.('Submitting your approved device revocation…');
                revokeSubmitted = true;
                await submitMessage(envelope, completionOptions.signal);
              } else revokeSubmitted = true;
            }
            completionOptions.onProgress?.('Checking that Hypersnap removed this signer…');
            await confirmSigner(metadata.fid, metadata.publicKey, false, completionOptions);
            // Cancellation preserves the key so the next modal can check status.
            assertActive(completionOptions.signal);
            if (ended) throw new Error('This revocation request has ended. Check its status from device settings.');
            await finishRevocation();
            completed = true;
          } finally { completing = false; revoking = false; }
        },
        dispose() { ended = true; },
      };
    },
    async revoke(options = {}) {
      if (disposed) throw new Error('Your session has ended. Unlock this device before revoking it.');
      if (revoking) throw new Error('Revocation is already being checked.');
      revoking = true;
      try {
        assertActive(options.signal);
        const registry = await getSigners(metadata.fid, options.signal);
        const existing = signerIn(registry, metadata.publicKey);
        if (existing && !revokeSubmitted) {
          if (existing.source !== 'SIGNER_SOURCE_OFFCHAIN' || existing.requestFid !== metadata.requestFid) throw new Error('The node returned different signer ownership. Revocation was not submitted.');
          const nonce = nonceAfter(registry.requesterFidNonces?.[String(metadata.requestFid)]);
          const { envelope } = await buildSignedMessage({
            type: MessageType.KEY_REMOVE, fid: metadata.fid,
            body: { keyRemoveBody: { key: publicKey, signature: new Uint8Array(), signatureType: 2, deadline: farcasterTimestamp() + 900, nonce } },
          }, { scheme: SignatureScheme.ED25519, publicKey, sign });
          assertActive(options.signal);
          if (disposed) throw new Error('Your session has ended.');
          revokeSubmitted = true;
          options.onProgress?.('Submitting device revocation…');
          await submitMessage(envelope, options.signal);
        }
        options.onProgress?.('Checking that the node removed this signer…');
        await confirmSigner(metadata.fid, metadata.publicKey, false, options);
        await finishRevocation();
      } finally { revoking = false; }
    },
    dispose,
  };
}
