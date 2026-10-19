import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  hashPairingRequest, hashRevocationRequest, validatePairingRequest, validateRevocationRequest,
  verifyPairingApproval, verifyRevocationApproval,
  type PairingRequest, type PairingApproval, type RevocationRequest, type RevocationApproval,
} from './pairing';
import {
  bytesToHex, hexToBytes, KEY_DOMAIN_NAME, KEY_DOMAIN_VERSION, SIGNED_KEY_REQUEST_CHAIN_ID,
  keyAddDigest, keyRemoveDigest,
} from './protocol/signedKeyRequest';

/** EIP-1193 transport only: wallet keys never enter this interface. */
export interface WalletProvider {
  request(args: { readonly method: string; readonly params?: readonly unknown[] | object }): Promise<unknown>;
}
export interface InjectedWallet { readonly id: string; readonly name: string; readonly provider: WalletProvider }
export interface WalletApprovalOptions { signal?: AbortSignal; onProgress?: (stage: string) => void }
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WALLETS = 16;
const ACCOUNT_TIMEOUT_MS = 30_000;
const SIGN_TIMEOUT_MS = 120_000;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isProvider(value: unknown): value is WalletProvider {
  try { return object(value) && typeof value.request === 'function'; } catch { return false; }
}

/** Wallet names are self-asserted labels. No untrusted icon or HTML is rendered. */
export function discoverInjectedWallets(onWallets: (wallets: InjectedWallet[]) => void): () => void {
  if (typeof window === 'undefined') { onWallets([]); return () => {}; }
  const discovered = new Map<string, InjectedWallet>();
  let closed = false;
  const publish = () => { if (!closed) onWallets([...discovered.values()]); };
  const announce = (event: Event) => {
    try {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!object(detail) || !object(detail.info) || !isProvider(detail.provider)) return;
      const { uuid, name } = detail.info;
      if (typeof uuid !== 'string' || !UUID.test(uuid) || typeof name !== 'string' || name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) return;
      const id = uuid.toLowerCase();
      // A conflicting UUID must never replace an already selected provider.
      if (discovered.has(id)) return;
      const duplicate = [...discovered.entries()].find(([, wallet]) => wallet.provider === detail.provider);
      if (duplicate && duplicate[0] !== 'injected-fallback') return;
      if (duplicate) discovered.delete(duplicate[0]);
      if (discovered.size >= MAX_WALLETS) return;
      discovered.set(id, Object.freeze({ id, name: name.trim() || 'Browser wallet', provider: detail.provider }));
      publish();
    } catch { /* An announcement is untrusted extension/page input. */ }
  };
  const fallback = () => {
    if (closed || discovered.size) return;
    try {
      const provider: unknown = (window as Window & { ethereum?: unknown }).ethereum;
      if (isProvider(provider)) { discovered.set('injected-fallback', Object.freeze({ id: 'injected-fallback', name: 'Browser wallet', provider })); publish(); }
    } catch { /* A provider getter may be unavailable or reject access. */ }
  };
  window.addEventListener('eip6963:announceProvider', announce);
  window.addEventListener('ethereum#initialized', fallback);
  publish();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // EIP-6963 is preferred; legacy window.ethereum is only a fallback.
  const timer = setTimeout(fallback, 300);
  return () => { closed = true; clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', announce); window.removeEventListener('ethereum#initialized', fallback); discovered.clear(); };
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Wallet approval cancelled.', 'AbortError');
}
function rpcError(error: unknown): Error {
  const code = object(error) ? error.code : undefined;
  if (code === 4001) return new Error('You declined the wallet request. No authorization was submitted.');
  if (code === 4100) return new Error('Allow this website to connect to the custody account in your wallet.');
  if (code === 4200 || code === -32601) return new Error('This wallet does not support the required EIP-712 typed-data signatures.');
  if (code === -32002) return new Error('A wallet request is already open. Finish or reject it in your wallet before trying again.');
  return new Error('The wallet could not complete the request. Check its connection and selected custody account.');
}

function transport(provider: WalletProvider, options: WalletApprovalOptions) {
  if (!isProvider(provider)) throw new Error('Choose an available browser wallet.');
  const request = provider.request.bind(provider);
  return async (method: string, params?: readonly unknown[], timeout = ACCOUNT_TIMEOUT_MS): Promise<unknown> => {
    assertActive(options.signal);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error: Error | null, value?: unknown) => {
        if (done) return;
        done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(new DOMException('Wallet approval cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('The wallet took too long. Finish or reject its open request before trying again. No authorization was submitted.')), timeout);
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        const pending: unknown = request({ method, ...(params ? { params } : {}) });
        if (!pending || (typeof pending !== 'object' && typeof pending !== 'function') || typeof (pending as { then?: unknown }).then !== 'function') { finish(new Error('The wallet returned an invalid response.')); return; }
        Promise.resolve(pending).then(value => finish(null, value), error => finish(rpcError(error)));
      } catch (error) { finish(rpcError(error)); }
    });
  };
}

function requireCustodyAccount(value: unknown, custody: string): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 || !value.every(account => typeof account === 'string' && ADDRESS.test(account))) throw new Error('The wallet returned invalid connected accounts.');
  if (!value.some(account => (account as string).toLowerCase() === custody)) throw new Error('Connect the custody address shown for this identity in your wallet. A different verified wallet cannot authorize this account.');
}
function requireSigningChain(value: unknown): void {
  if (typeof value !== 'string' || value.length > 66 || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error('The wallet returned an invalid network ID.');
  if (BigInt(value) !== 1n) throw new Error('Select Ethereum Mainnet in your wallet, then try again. No transaction or ETH is needed.');
}

function signature(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value)) throw new Error('The wallet returned an invalid typed-data signature.');
  const bytes = hexToBytes(value);
  if (bytes[64] === 0 || bytes[64] === 1) bytes[64] += 27;
  if (bytes[64] !== 27 && bytes[64] !== 28) throw new Error('The wallet returned an invalid signature recovery ID.');
  return bytesToHex(bytes);
}

function verifyCustodySignature(signatureHex: string, digest: Uint8Array, custody: string): void {
  try {
    const bytes = hexToBytes(signatureHex);
    const sig = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), 'compact').addRecoveryBit(bytes[64] - 27);
    if (sig.hasHighS()) throw new Error('Noncanonical signature');
    const key = sig.recoverPublicKey(digest).toBytes(false);
    const recovered = `0x${bytesToHex(keccak_256(key.subarray(1)).subarray(12))}`;
    if (recovered !== custody) throw new Error('Wrong custody');
  } catch { throw new Error('The wallet signature does not match the account’s custody address.'); }
}

const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }];
const DOMAIN = { name: KEY_DOMAIN_NAME, version: KEY_DOMAIN_VERSION, chainId: SIGNED_KEY_REQUEST_CHAIN_ID };
function typedData(primaryType: string, fields: Array<{ name: string; type: string }>, message: Record<string, unknown>): string {
  return JSON.stringify({ types: { EIP712Domain: DOMAIN_TYPES, [primaryType]: fields }, primaryType, domain: DOMAIN, message });
}
const KEY_ADD_TYPES = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'keyType', type: 'uint32' }, { name: 'scopes', type: 'uint32[]' }, { name: 'ttl', type: 'uint32' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];
const KEY_REQUEST_TYPES = [{ name: 'requestFid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'deadline', type: 'uint256' }];
const KEY_REMOVE_TYPES = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];

/** Two explicit wallet signatures; no wallet transactions or hosted login service. */
export async function approvePairingWithWallet(requestValue: PairingRequest, provider: WalletProvider, options: WalletApprovalOptions = {}): Promise<PairingApproval> {
  const request = validatePairingRequest(requestValue);
  const rpc = transport(provider, options);
  options.onProgress?.('Connect the custody account in your wallet…');
  requireCustodyAccount(await rpc('eth_requestAccounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validatePairingRequest(request);
  const key = hexToBytes(request.publicKey);
  options.onProgress?.('Approve the posting-key permissions in your wallet (1 of 2)…');
  const custodySignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('KeyAdd', KEY_ADD_TYPES, { fid: String(request.fid), key: `0x${request.publicKey}`, keyType: 1, scopes: [...request.scopes], ttl: request.ttl, nonce: request.nonce, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  verifyCustodySignature(custodySignature, keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: request.deadline }), request.custodyAddress);
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validatePairingRequest(request);
  options.onProgress?.('Approve the Hypersnap key request in your wallet (2 of 2)…');
  const requestSignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('SignedKeyRequest', KEY_REQUEST_TYPES, { requestFid: String(request.fid), key: `0x${request.publicKey}`, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  const approval: PairingApproval = { kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId, requestHash: hashPairingRequest(request), custodyAddress: request.custodyAddress, custodySignature, requestSignature };
  verifyPairingApproval(request, approval);
  assertActive(options.signal);
  return approval;
}

/** Custody-approved removal also works through desktop and mobile wallet providers. */
export async function approveRevocationWithWallet(requestValue: RevocationRequest, provider: WalletProvider, options: WalletApprovalOptions = {}): Promise<RevocationApproval> {
  const request = validateRevocationRequest(requestValue);
  const rpc = transport(provider, options);
  options.onProgress?.('Connect the custody account in your wallet…');
  requireCustodyAccount(await rpc('eth_requestAccounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validateRevocationRequest(request);
  options.onProgress?.('Approve removal of this posting key in your wallet…');
  const custodySignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('KeyRemove', KEY_REMOVE_TYPES, { fid: String(request.fid), key: `0x${request.publicKey}`, nonce: request.nonce, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  verifyCustodySignature(custodySignature, keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline }), request.custodyAddress);
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  const approval: RevocationApproval = { kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId, requestHash: hashRevocationRequest(request), custodyAddress: request.custodyAddress, custodySignature, signatureType: 1 };
  verifyRevocationApproval(request, approval);
  assertActive(options.signal);
  return approval;
}
