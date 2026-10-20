// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectAccount, { DeviceSettings } from './ConnectAccount';
import { deleteSavedSession, getSavedSessionMethod, preparePairing, unlockSavedSession, unlockSavedSessionWithPasskey, type PendingPairing, type WalletSession } from '../lib/auth';
import { approvePairingWithWallet, discoverInjectedWallets } from '../lib/wallet';
import type { PairingApproval, PairingRequest } from '../lib/pairing';
import type { User } from '../lib/api';
import { passkeysAvailable } from '../lib/passkey';

vi.mock('../lib/auth', () => ({ deleteSavedSession: vi.fn(), getSavedSessionMethod: vi.fn(), preparePairing: vi.fn(), unlockSavedSession: vi.fn(), unlockSavedSessionWithPasskey: vi.fn() }));
vi.mock('../lib/wallet', () => ({ approvePairingWithWallet: vi.fn(), approveRevocationWithWallet: vi.fn(), discoverInjectedWallets: vi.fn() }));
vi.mock('../lib/passkey', () => ({ passkeysAvailable: vi.fn() }));
vi.mock('../lib/pairing', async original => ({ ...await original<typeof import('../lib/pairing')>(), validatePairingApproval: (value: unknown) => value, verifyPairingApproval: vi.fn(), hashPairingRequest: () => 'synthetic-public-checksum' }));

const user: User = { fid: 10, username: 'isolated', custody_address: `0x${'1'.repeat(40)}`, profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
function makeSession(): WalletSession { return { fid: user.fid, user, custodyAddress: user.custody_address, publicKey: 'a'.repeat(64), scopes: [1, 3, 4], saveToDevice: vi.fn().mockResolvedValue(undefined), saveToDeviceWithPasskey: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), prepareRevocation: vi.fn() } as unknown as WalletSession; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(value => { resolve = value; }); return { promise, resolve }; }
let container: HTMLDivElement;
let root: Root;
let session: WalletSession;
let pending: PendingPairing;
let onConnect: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  vi.mocked(passkeysAvailable).mockReturnValue(true);
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('PublicKeyCredential', class {});
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: vi.fn(), get: vi.fn() } });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  session = makeSession(); onConnect = vi.fn(); onClose = vi.fn();
  const request: PairingRequest = { kind: 'arca.hypersnap.signer.request', version: 1, origin: 'https://quorum.arca.computer', requestId: 'b'.repeat(64), createdAt: Math.floor(Date.now() / 1000), fid: user.fid, custodyAddress: user.custody_address, publicKey: session.publicKey, scopes: [1, 3, 4], ttl: 604800, nonce: 1, deadline: Math.floor(Date.now() / 1000) - 1609459200 + 900 };
  const approval: PairingApproval = { kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId, requestHash: 'c'.repeat(64), custodyAddress: request.custodyAddress, custodySignature: 'd'.repeat(130), requestSignature: 'e'.repeat(130) };
  pending = { request, user, submitted: true, complete: vi.fn().mockResolvedValue(session), dispose: vi.fn() };
  vi.mocked(getSavedSessionMethod).mockResolvedValue(undefined);
  vi.mocked(preparePairing).mockResolvedValue(pending);
  vi.mocked(unlockSavedSession).mockResolvedValue(session);
  vi.mocked(unlockSavedSessionWithPasskey).mockResolvedValue(session);
  vi.mocked(discoverInjectedWallets).mockImplementation(callback => { callback([{ id: 'isolated', name: 'Rainbow', rdns: 'me.rainbow', provider: { request: vi.fn() } }]); return () => {}; });
  vi.mocked(approvePairingWithWallet).mockResolvedValue(approval);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(view = <ConnectAccount initialFid={10} onConnect={onConnect} onClose={onClose} />) { await act(async () => root.render(view)); }
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(id: string, value: string) { const input = container.querySelector<HTMLInputElement>(`#${id}`)!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function approve({ remember = true } = {}) {
  await click(button('Find my account'));
  await click(button('Connect Rainbow extension & approve'));
  if (remember) await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button('Submit approved device key'));
}

describe('explicit passkey device storage UI', () => {
  it('unlocks a saved passkey vault only after a click and does not request a password or new wallet authorization', async () => {
    vi.mocked(getSavedSessionMethod).mockResolvedValue('passkey');
    await render();
    expect(unlockSavedSessionWithPasskey).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain('A synced passkey alone does not copy it');
    await click(button('Unlock with a passkey'));
    expect(unlockSavedSessionWithPasskey).toHaveBeenCalledOnce();
    expect(onConnect).toHaveBeenCalledWith(session);
    expect(unlockSavedSession).not.toHaveBeenCalled(); expect(preparePairing).not.toHaveBeenCalled();
  });

  it('keeps password vault unlock compatible without automatically migrating it', async () => {
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password');
    await render(); await fill('device-password', 'old secure password'); await click(button('Unlock this device'));
    expect(unlockSavedSession).toHaveBeenCalledWith('old secure password', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
  });

  it('waits for a separate save click after authorization instead of automatically creating a passkey', async () => {
    await render(); await approve();
    expect(pending.complete).toHaveBeenCalledOnce();
    expect(onConnect).not.toHaveBeenCalled(); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Hypersnap confirmed this device');
    await click(button('Save with a passkey'));
    expect(session.saveToDeviceWithPasskey).toHaveBeenCalledOnce(); expect(onConnect).toHaveBeenCalledWith(session);
    expect(session.saveToDevice).not.toHaveBeenCalled();
  });

  it('keeps new sign-in in memory when remembering the device was not selected', async () => {
    await render(); await approve({ remember: false });
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
  });

  it('keeps the authorized session available after unsupported passkey encryption and requires an explicit password fallback', async () => {
    vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new Error('This passkey does not support secure key encryption.'));
    await render(); await approve(); await click(button('Save with a passkey'));
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not support');
    await click(button('Use a password instead')); await fill('new-device-password', 'new secure password'); await fill('confirm-device-password', 'new secure password'); await click(button('Save with a password'));
    expect(session.saveToDevice).toHaveBeenCalledWith('new secure password', expect.objectContaining({ signal: expect.any(AbortSignal) })); expect(onConnect).toHaveBeenCalledWith(session);
  });

  it('allows continuing in this tab after cancelled passkey creation without saving anything else', async () => {
    vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new DOMException('Passkey creation cancelled.', 'NotAllowedError'));
    await render(); await approve(); await click(button('Save with a passkey'));
    await click(button('Continue for this tab without saving'));
    expect(onConnect).toHaveBeenCalledWith(session); expect(session.saveToDevice).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled();
  });

  it('offers explicit password or tab choices when basic WebAuthn support is unavailable', async () => {
    vi.mocked(passkeysAvailable).mockReturnValue(false);
    await render(); await approve();
    expect(button('Save with a passkey').disabled).toBe(true);
    expect(container.textContent).toContain('Passkeys are unavailable in this browser');
    expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    await click(button('Continue for this tab without saving')); expect(onConnect).toHaveBeenCalledWith(session);
  });

  it('cancels a pending passkey save when closed and rejects its late session handoff', async () => {
    const saving = deferred<void>(); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(); await approve(); await click(button('Save with a passkey'));
    const options = vi.mocked(session.saveToDeviceWithPasskey).mock.calls[0][0]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!);
    expect(options.signal?.aborted).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => saving.resolve());
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalled();
  });

  it('does not reconnect from a passkey unlock that finishes after the dialog was closed', async () => {
    const unlocking = deferred<WalletSession>(); vi.mocked(getSavedSessionMethod).mockResolvedValue('passkey'); vi.mocked(unlockSavedSessionWithPasskey).mockReturnValue(unlocking.promise);
    await render(); await click(button('Unlock with a passkey'));
    const options = vi.mocked(unlockSavedSessionWithPasskey).mock.calls[0][0]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => unlocking.resolve(session));
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('migrates an unlocked password vault only after passkey saving succeeds, without a new Hypersnap authorization', async () => {
    const saving = deferred<void>(); const notify = vi.fn();
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={notify} />);
    expect(container.textContent).toContain('Encrypted key saved with a password'); expect(session.saveToDeviceWithPasskey).not.toHaveBeenCalled();
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a password');
    await act(async () => saving.resolve());
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    expect(preparePairing).not.toHaveBeenCalled(); expect(session.prepareRevocation).not.toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('No new network authorization'));
  });

  it('preserves the old password vault and active session if passkey migration fails', async () => {
    const onLock = vi.fn(); vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockRejectedValue(new Error('Passkey encryption is unsupported.'));
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={vi.fn()} />);
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a password'); expect(deleteSavedSession).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(onLock).not.toHaveBeenCalled(); expect(session.saveToDevice).not.toHaveBeenCalled();
    await click(button('Use password encryption instead')); expect(container.querySelector('#settings-device-password')).not.toBeNull();
  });

  it('does not let an earlier vault lookup overwrite a successful passkey migration', async () => {
    const storage = deferred<'password'>(); vi.mocked(getSavedSessionMethod).mockReturnValue(storage.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={vi.fn()} />);
    await click(button('Save with a passkey'));
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    await act(async () => storage.resolve('password'));
    expect(container.textContent).toContain('Encrypted key saved with a passkey');
    expect(container.textContent).not.toContain('Encrypted key saved with a password');
  });

  it('aborts password saving when the authorization dialog closes and rejects the late session handoff', async () => {
    const saving = deferred<void>(); vi.mocked(session.saveToDevice).mockReturnValue(saving.promise);
    await render(); await approve(); await click(button('Use a password instead'));
    await fill('new-device-password', 'new secure password'); await fill('confirm-device-password', 'new secure password'); await click(button('Save with a password'));
    const options = vi.mocked(session.saveToDevice).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => saving.resolve());
    expect(onConnect).not.toHaveBeenCalled(); expect(session.dispose).toHaveBeenCalled();
  });

  it('aborts password saving when device settings closes while keeping the active session connected', async () => {
    const saving = deferred<void>(); const notify = vi.fn(); vi.mocked(session.saveToDevice).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={vi.fn()} notify={notify} />);
    await click(button('Use password encryption instead')); await fill('settings-device-password', 'new secure password'); await fill('settings-confirm-password', 'new secure password'); await click(button('Save with a password'));
    const options = vi.mocked(session.saveToDevice).mock.calls[0][1]!;
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => saving.resolve());
    expect(notify).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce(); expect(session.dispose).not.toHaveBeenCalled();
  });

  it('offers explicit local recovery for an unreadable saved key while keeping wallet reconnection available', async () => {
    vi.mocked(getSavedSessionMethod).mockRejectedValue(new Error('Malformed encrypted vault.'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('saved device key could not be read');
    expect(button('Find my account').disabled).toBe(false);
    expect(deleteSavedSession).not.toHaveBeenCalled();
    await click(button('Forget unreadable saved key'));
    expect(deleteSavedSession).toHaveBeenCalledWith();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button('Forget unreadable saved key')).toBeUndefined();
    expect(preparePairing).not.toHaveBeenCalled(); expect(unlockSavedSessionWithPasskey).not.toHaveBeenCalled();
  });

  it('lets an active device explicitly forget an unreadable vault without revoking or disconnecting it', async () => {
    const onLock = vi.fn(); vi.mocked(getSavedSessionMethod).mockRejectedValue(new Error('Malformed encrypted vault.'));
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={vi.fn()} />);
    expect(container.textContent).toContain('Saved vault could not be read; active key stays in this tab');
    expect(container.textContent).toContain('account cannot be verified');
    expect(deleteSavedSession).not.toHaveBeenCalled();
    await click(button('Forget unreadable vault'));
    expect(deleteSavedSession).toHaveBeenCalledWith();
    expect(button('Save with a passkey')).toBeDefined();
    expect(onLock).not.toHaveBeenCalled(); expect(session.dispose).not.toHaveBeenCalled(); expect(session.prepareRevocation).not.toHaveBeenCalled();
  });

  it('resets pending migration and old form state when device settings receives a replacement session', async () => {
    const saving = deferred<void>(); const notify = vi.fn(); const onLock = vi.fn();
    vi.mocked(getSavedSessionMethod).mockResolvedValue('password'); vi.mocked(session.saveToDeviceWithPasskey).mockReturnValue(saving.promise);
    await render(<DeviceSettings session={session} onClose={onClose} onLock={onLock} notify={notify} />);
    await click(button('Use password encryption instead')); await fill('settings-device-password', 'old secret password'); await fill('settings-confirm-password', 'old secret password');
    await click(button('Save with a passkey'));
    const oldSignal = vi.mocked(session.saveToDeviceWithPasskey).mock.calls[0][0]!.signal;
    const replacement = { ...makeSession(), publicKey: 'f'.repeat(64), user: { ...user, username: 'replacement-device' } };
    vi.mocked(getSavedSessionMethod).mockResolvedValue(undefined);
    await render(<DeviceSettings session={replacement} onClose={onClose} onLock={onLock} notify={notify} />);
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('@replacement-device'); expect(container.textContent).toContain('Key held only in this tab');
    expect(container.querySelector('#settings-device-password')).toBeNull(); expect(button('Lock').disabled).toBe(false); expect(button('Save with a passkey').disabled).toBe(false); expect(button('Revoke').disabled).toBe(false);
    await act(async () => saving.resolve());
    expect(notify).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('Encrypted key saved with a passkey');
    expect(button('Save with a passkey').disabled).toBe(false);
    await click(button('Lock')); expect(onLock).toHaveBeenCalledOnce();
  });
});
