// @vitest-environment happy-dom
// Real discovery, wallet adapter, signature verification and auth orchestration.
// Only the node boundary and saved-vault lookup are replaced; no live identity.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashTypedData } from 'viem';
import ConnectAccount from './ConnectAccount';
import { getSigners, getUser, submitMessage, type SignersResponse, type User } from '../lib/api';
import { readSavedVault } from '../lib/vault';
import type { WalletSession } from '../lib/auth';
import type { WalletProvider } from '../lib/wallet';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, signEip712Digest } from '../lib/protocol/signedKeyRequest';

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getSigners: vi.fn(), getUser: vi.fn(), submitMessage: vi.fn() }));
vi.mock('../lib/vault', async original => ({ ...await original<typeof import('../lib/vault')>(), readSavedVault: vi.fn() }));

const key = hexToBytes('01'.repeat(32)); // Public synthetic test fixture only.
const custody = addressFromCustodyPrivateKey(key);
const unrelated = addressFromCustodyPrivateKey(hexToBytes('02'.repeat(32)));
const user: User = { fid: 1234, username: 'isolated-wallet', custody_address: custody, profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
let container: HTMLDivElement;
let root: Root;
let registry: SignersResponse;
let onConnect: ReturnType<typeof vi.fn>;
let connected: WalletSession | undefined;

function fields(bytes: Uint8Array): Map<number, Uint8Array | number> {
  let offset = 0;
  const result = new Map<number, Uint8Array | number>();
  const varint = () => { let n = 0, shift = 0, byte: number; do { byte = bytes[offset++]; n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return n; };
  while (offset < bytes.length) {
    const tag = varint();
    if ((tag & 7) === 0) result.set(tag >> 3, varint());
    else if ((tag & 7) === 2) { const length = varint(); result.set(tag >> 3, bytes.slice(offset, offset += length)); }
    else throw new Error('Unexpected synthetic wire type');
  }
  return result;
}
function wallet() {
  let accounts = [custody];
  const payloads: Record<string, unknown>[] = [];
  const request = vi.fn<WalletProvider['request']>(async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return accounts;
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_signTypedData_v4') {
      const [address, json] = params as readonly unknown[];
      expect(address).toBe(custody);
      const typed = JSON.parse(json as string);
      expect(['KeyAdd', 'SignedKeyRequest']).toContain(typed.primaryType);
      payloads.push(typed);
      return `0x${bytesToHex(signEip712Digest(hexToBytes(hashTypedData(typed)), key))}`;
    }
    throw new Error(`Unexpected wallet request: ${method}`);
  });
  return { provider: { request, isCoinbaseWallet: true }, request, payloads, setAccounts(value: string[]) { accounts = value; } };
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === text);
  expect(found, `Button ${text}`).toBeDefined(); return found!;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function waitFor(check: () => void) { await vi.waitFor(async () => { await act(async () => {}); check(); }, { timeout: 2000, interval: 10 }); }
async function start(coinbase: ReturnType<typeof wallet>, secondary = true) {
  const rainbow = { isRainbow: true, request: vi.fn<WalletProvider['request']>() };
  vi.stubGlobal('ethereum', secondary ? { ...rainbow, providers: [rainbow, coinbase.provider] } : coinbase.provider);
  vi.stubGlobal('coinbaseWalletExtension', coinbase.provider);
  await act(async () => root.render(<ConnectAccount initialFid={user.fid} onConnect={onConnect} onClose={vi.fn()} />));
  await click(button('Find my account'));
  await act(async () => window.dispatchEvent(new Event('ethereum#initialized')));
  await waitFor(() => expect(container.querySelector('select')).not.toBeNull());
  const select = container.querySelector<HTMLSelectElement>('select')!;
  const option = [...select.options].find(value => value.textContent?.includes('Coinbase'))!;
  expect(option).toBeDefined();
  await act(async () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  return rainbow;
}
function assertReadOnlyWalletMethods(request: ReturnType<typeof wallet>['request']) {
  expect(request.mock.calls.every(([args]) => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(args.method))).toBe(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { origin: 'https://quorum.arca.computer' });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  registry = { signers: [], currentUserNonce: 4, gaslessSignerCount: 0, gaslessSignerLimit: 1000 };
  vi.mocked(getUser).mockImplementation(async () => structuredClone(user));
  vi.mocked(getSigners).mockImplementation(async () => structuredClone(registry));
  vi.mocked(readSavedVault).mockResolvedValue(undefined);
  vi.mocked(submitMessage).mockImplementation(async envelope => {
    const data = fields(fields(envelope).get(1) as Uint8Array);
    expect(data.get(1)).toBe(16); // Hypersnap KEY_ADD, never an Ethereum transaction.
    const body = fields(data.get(19) as Uint8Array);
    const names: Record<number, string> = { 1: 'MESSAGE_TYPE_CAST_ADD', 2: 'MESSAGE_TYPE_CAST_REMOVE', 3: 'MESSAGE_TYPE_REACTION_ADD', 4: 'MESSAGE_TYPE_REACTION_REMOVE', 5: 'MESSAGE_TYPE_LINK_ADD', 6: 'MESSAGE_TYPE_LINK_REMOVE', 11: 'MESSAGE_TYPE_USER_DATA_ADD' };
    registry = { ...registry, currentUserNonce: 5, gaslessSignerCount: 1, signers: [{ key: bytesToHex(body.get(1) as Uint8Array), source: 'SIGNER_SOURCE_OFFCHAIN', scopes: Array.from(body.get(9) as Uint8Array, scope => names[scope]), requestFid: user.fid, expiresAt: Math.floor(Date.now() / 1000) + 604800 }] };
    return {};
  });
  onConnect = vi.fn((session: WalletSession) => { connected = session; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); connected?.dispose(); connected = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('isolated browser-wallet sign-in across the real UI and protocol adapter', () => {
  it('finds Coinbase beside another legacy wallet, rejects an unrelated account and completes after an explicit custody-account retry', async () => {
    const cb = wallet(); cb.setAccounts([unrelated]);
    const other = await start(cb);
    await click(button('Connect Coinbase Wallet (legacy) & approve'));
    await waitFor(() => expect(container.textContent).toContain('A different verified wallet cannot authorize'));
    expect(cb.payloads).toHaveLength(0); expect(submitMessage).not.toHaveBeenCalled();
    cb.setAccounts([unrelated, custody]);
    await click(button('Retry Coinbase Wallet (legacy) approval'));
    await waitFor(() => expect(button('Submit approved device key').disabled).toBe(false));
    expect(cb.payloads.map(value => value.primaryType)).toEqual(['KeyAdd', 'SignedKeyRequest']);
    expect(submitMessage).not.toHaveBeenCalled(); // Signing alone does not register a key.
    expect(other.request).not.toHaveBeenCalled();
    await click(button('Submit approved device key'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledOnce());
    expect(connected?.fid).toBe(user.fid); expect(submitMessage).toHaveBeenCalledOnce(); assertReadOnlyWalletMethods(cb.request);
  });

  it('cancels a pending signature locally and ignores its late result while a fresh retry completes', async () => {
    const cb = wallet(); await start(cb, false);
    const original = cb.request.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    cb.request.mockImplementationOnce(args => original(args));
    cb.request.mockImplementationOnce(args => original(args));
    cb.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click(button('Connect Coinbase Wallet (legacy) & approve'));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await click(button('Cancel wallet approval'));
    expect(button('Retry Coinbase Wallet (legacy) approval').disabled).toBe(false);
    await click(button('Retry Coinbase Wallet (legacy) approval'));
    await waitFor(() => expect(button('Submit approved device key').disabled).toBe(false));
    await act(async () => finish('0xlate-result-ignored'));
    expect(container.textContent).not.toContain('invalid signature'); expect(submitMessage).not.toHaveBeenCalled();
    await click(button('Submit approved device key'));
    await waitFor(() => expect(onConnect).toHaveBeenCalledOnce());
    expect(submitMessage).toHaveBeenCalledOnce(); assertReadOnlyWalletMethods(cb.request);
  });
});
