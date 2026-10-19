import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { getSigners, getUser, submitMessage, type Signer, type User } from './api';
import {
  buildSignedMessage,
  CastType,
  FarcasterNetwork,
  MessageType,
  ReactionType,
  SignatureScheme,
  type MessageDataInput,
} from './protocol/messageBuilder';
import {
  addressFromCustodyPrivateKey,
  buildSignedKeyRequestMetadata,
  bytesToHex,
  hexToBytes,
  keyAddDigest,
  signEip712Digest,
} from './protocol/signedKeyRequest';

export const CUSTODY_DERIVATION_PATH = "m/44'/60'/0'/0/0";
export const SIGNER_TTL_SECONDS = 90 * 24 * 60 * 60;
// Stable across devices and local previews. Domain separation prevents this
// Ed25519 key from being a reused Ethereum custody key. No secret is persisted.
const SIGNER_DOMAIN = 'https://quorum.arca.computer/hypersnap-signer/v1';
const SIGNER_SCOPES = [MessageType.CAST_ADD, MessageType.REACTION_ADD, MessageType.REACTION_REMOVE];
const SIGNER_SCOPE_NAMES = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
const SIGNER_CONFIRMATION_TIMEOUT_MS = 45_000;

export interface CastTarget { fid: number; hash: string }
export interface WriteReceipt { hash: string }

export interface WalletSession {
  readonly user: User;
  readonly fid: number;
  readonly custodyAddress: string;
  /** Public Ed25519 signer key; safe to display. */
  readonly publicKey: string;
  cast(text: string, parent?: CastTarget): Promise<WriteReceipt>;
  react(target: CastTarget, type: 'like' | 'recast', remove?: boolean): Promise<WriteReceipt>;
  /** Clear the session's mutable signer buffer and disable further signing. */
  dispose(): void;
}

export interface ConnectOptions {
  signal?: AbortSignal;
  /** Clear the input field once local derivation finishes (also on failure). */
  onDerived?: () => void;
  onProgress?: (stage: string) => void;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Sign-in cancelled.', 'AbortError');
}

function normalizePhrase(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ');
}

function deriveCustody(phrase: string): Uint8Array {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Enter a valid English Farcaster recovery phrase (12, 15, 18, 21, or 24 words).');
  }
  const seed = mnemonicToSeedSync(normalized);
  let root: HDKey | undefined;
  let account: HDKey | undefined;
  try {
    root = HDKey.fromMasterSeed(seed);
    account = root.derive(CUSTODY_DERIVATION_PATH);
    if (!account.privateKey) throw new Error('Could not derive the custody wallet.');
    return new Uint8Array(account.privateKey);
  } finally {
    seed.fill(0);
    root?.wipePrivateData();
    account?.wipePrivateData();
  }
}

function deriveSigner(custody: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  return hkdf(sha256, custody, encoder.encode(SIGNER_DOMAIN), encoder.encode('Ed25519 signing key'), 32);
}

function hashBytes(hash: string): Uint8Array {
  if (!/^(?:0x)?[0-9a-fA-F]{40}$/.test(hash)) throw new Error('Invalid cast hash.');
  return hexToBytes(hash);
}

function assertFid(fid: number): void {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid Farcaster ID.');
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Sign-in cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The phrase and custody wallet stay in this local call. The server receives
 * only a public custody address and signed protocol messages. JS strings cannot
 * be reliably zeroed; callers must clear their input using onDerived.
 *
 * Signing in authorizes a least-privilege, gasless app signer if none is active.
 * We confirm registration through the unified signer registry before returning.
 */
export async function connectWithSeedPhrase(phrase: string, options: ConnectOptions = {}): Promise<WalletSession> {
  let custody: Uint8Array | undefined;
  let signer: Uint8Array | undefined;
  let connected = false;
  try {
    assertActive(options.signal);
    options.onProgress?.('Deriving your wallet locally…');
    try {
      custody = deriveCustody(phrase);
    } finally {
      // Drop this call's reference before the first network request.
      phrase = '';
      options.onDerived?.();
    }
    signer = deriveSigner(custody);
    const publicKeyBytes = ed25519.getPublicKey(signer);
    const publicKey = bytesToHex(publicKeyBytes);
    const custodyAddress = addressFromCustodyPrivateKey(custody);
    options.onProgress?.('Finding your Farcaster identity…');
    const user = await getUser({ custodyAddress }, options.signal);
    assertFid(user.fid);
    // A lookup response must match the actual locally derived custody wallet.
    if (user.custody_address?.toLowerCase() !== custodyAddress.toLowerCase()) {
      throw new Error('This recovery phrase does not control the returned Farcaster identity.');
    }
    assertActive(options.signal);
    options.onProgress?.('Checking your app signer…');
    const registry = await getSigners(user.fid, options.signal);
    const findKey = (keys: Signer[]) => keys.find(({ key }) => key.replace(/^0x/i, '').toLowerCase() === publicKey);
    const usableKey = (key: Signer | undefined) => {
      if (!key) return false;
      // The unified endpoint includes stored gasless records whose sliding TTL
      // has already expired. Presence alone does not prove this key can sign.
      if (key.expiresAt !== undefined && (!Number.isSafeInteger(key.expiresAt) || key.expiresAt < Math.floor(Date.now() / 1000) + 60)) return false;
      if (key.source === 'SIGNER_SOURCE_OFFCHAIN' && !SIGNER_SCOPE_NAMES.every(scope => key.scopes?.includes(scope))) return false;
      return true;
    };
    const existingKey = findKey(registry.signers);

    if (!usableKey(existingKey)) {
      // Upserting this FID's existing key consumes no additional signer slot.
      if (!existingKey && registry.gaslessSignerLimit !== undefined && registry.gaslessSignerCount !== undefined && registry.gaslessSignerCount >= registry.gaslessSignerLimit) {
        throw new Error('This identity has reached its app signer limit. Revoke an unused signer before connecting.');
      }
      if (!Number.isInteger(registry.currentUserNonce) || registry.currentUserNonce < 0 || registry.currentUserNonce >= 0xffffffff) {
        throw new Error('The node did not return a usable signer nonce. Please try again later.');
      }
      const nonce = registry.currentUserNonce + 1;
      // Deadlines in KeyAddBody use Farcaster epoch seconds, matching the proto.
      const deadline = Math.floor(Date.now() / 1000) - 1609459200 + 3600;
      const { metadata } = buildSignedKeyRequestMetadata({ requestFid: user.fid, signerPublicKey: publicKeyBytes, deadline, custodyPrivateKey: custody });
      const custodySignature = signEip712Digest(keyAddDigest({ fid: user.fid, key: publicKeyBytes, keyType: 1, scopes: SIGNER_SCOPES, ttl: SIGNER_TTL_SECONDS, nonce, deadline }), custody);
      const { envelope } = await buildSignedMessage({
        type: MessageType.KEY_ADD,
        fid: user.fid,
        network: FarcasterNetwork.MAINNET,
        body: { keyAddBody: { key: publicKeyBytes, custodySignature, deadline, nonce, metadata, scopes: SIGNER_SCOPES, ttl: SIGNER_TTL_SECONDS } },
      }, {
        scheme: SignatureScheme.ED25519,
        publicKey: publicKeyBytes,
        sign: async (hash) => ed25519.sign(hash, signer!),
      });
      custody.fill(0);
      custody = undefined;
      assertActive(options.signal);
      options.onProgress?.('Authorizing your app signer…');
      // Never retry an uncertain write. Follow this one submission with reads.
      await submitMessage(envelope, options.signal);
      options.onProgress?.('Waiting for signer confirmation…');
      const expires = Date.now() + SIGNER_CONFIRMATION_TIMEOUT_MS;
      let confirmed = false;
      while (Date.now() < expires) {
        assertActive(options.signal);
        const current = await getSigners(user.fid, options.signal);
        if (usableKey(findKey(current.signers))) { confirmed = true; break; }
        await delay(1500, options.signal);
      }
      if (!confirmed) throw new Error('The signer was submitted but is not confirmed yet. Wait a minute, then connect again. No cast has been sent.');
    }
    assertActive(options.signal);
    const session = createSession(user, custodyAddress, signer, publicKeyBytes);
    options.onProgress?.('Connected. Your recovery phrase stays on this device.');
    connected = true;
    return session;
  } finally {
    custody?.fill(0);
    if (!connected) signer?.fill(0);
  }
}

function createSession(user: User, custodyAddress: string, privateKey: Uint8Array, publicKey: Uint8Array): WalletSession {
  const fid = user.fid;
  let disposed = false;
  const send = async (data: MessageDataInput): Promise<WriteReceipt> => {
    if (disposed) throw new Error('Your session has ended. Connect your wallet again.');
    const { envelope, hash } = await buildSignedMessage(data, {
      scheme: SignatureScheme.ED25519,
      publicKey,
      sign: async (digest) => {
        if (disposed) throw new Error('Your session has ended. Connect your wallet again.');
        return ed25519.sign(digest, privateKey);
      },
    });
    if (disposed) throw new Error('Your session has ended. Connect your wallet again.');
    await submitMessage(envelope);
    return { hash: bytesToHex(hash) };
  };
  return {
    user, fid, custodyAddress, publicKey: bytesToHex(publicKey),
    async cast(text, parent) {
      const bytes = new TextEncoder().encode(text).length;
      if (!text.trim()) throw new Error('Write something before casting.');
      if (bytes > 1024) throw new Error('Casts can contain up to 1,024 UTF-8 bytes.');
      if (parent) assertFid(parent.fid);
      return send({
        type: MessageType.CAST_ADD, fid,
        body: { castAddBody: { text, type: bytes > 320 ? CastType.LONG_CAST : CastType.CAST, ...(parent ? { parent: { castId: { fid: parent.fid, hash: hashBytes(parent.hash) } } } : {}) } },
      });
    },
    async react(target, type, remove = false) {
      assertFid(target.fid);
      return send({
        type: remove ? MessageType.REACTION_REMOVE : MessageType.REACTION_ADD, fid,
        body: { reactionBody: { type: type === 'like' ? ReactionType.LIKE : ReactionType.RECAST, target: { castId: { fid: target.fid, hash: hashBytes(target.hash) } } } },
      });
    },
    dispose() {
      disposed = true;
      privateKey.fill(0);
    },
  };
}
