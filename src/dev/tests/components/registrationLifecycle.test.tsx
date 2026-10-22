import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { messages } from '@/i18n/en/messages';

const fixture = vi.hoisted(() => ({
  registered: false,
  revision: 0,
  exportKey: vi.fn(),
  getUser: vi.fn(),
  uploadRegistration: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  setKeyset: vi.fn(),
  setSelfAddress: vi.fn(),
  getDefaultUserConfig: vi.fn(),
  loadKeyDecryptData: vi.fn(),
  createKeyFromBuffer: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  encryptDataSaveKey: vi.fn(),
  constructRegistration: vi.fn(),
  newUserKeyset: vi.fn(),
  newDeviceKeyset: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useRegistration: () => ({ data: {
    registered: fixture.registered,
    registration: { device_registrations: [], revision: fixture.revision },
  } }),
}));
vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeysContext: () => ({
    // Public placeholders only. A fresh wrapper/metadata object is returned on
    // every render, while the selected credential and address stay the same.
    currentPasskeyInfo: { address: 'isolated-registration-address', credentialId: 'public-credential-fixture', publicKey: 'public-key-placeholder' },
    exportKey: (address: string) => fixture.exportKey(address),
  }),
  passkey: {
    loadKeyDecryptData: fixture.loadKeyDecryptData,
    createKeyFromBuffer: fixture.createKeyFromBuffer,
    decrypt: fixture.decrypt,
    encrypt: fixture.encrypt,
    encryptDataSaveKey: fixture.encryptDataSaveKey,
  },
  channel: {
    ConstructUserRegistration: fixture.constructRegistration,
    NewUserKeyset: fixture.newUserKeyset,
    NewDeviceKeyset: fixture.newDeviceKeyset,
  },
}));
vi.mock('@/hooks/mutations/useUploadRegistration', () => ({
  useUploadRegistration: () => (input: unknown) => fixture.uploadRegistration(input),
}));
// Use the public extensionless module contract, including after context/barrel
// extraction. No API client or transport is constructed by this fixture.
vi.mock('@/components/context/QuorumApiContext', () => ({
  useQuorumApiClient: () => ({ apiClient: { getUser: (address: string) => fixture.getUser(address) } }),
}));
vi.mock('@/components/context/useMessageDB', () => ({
  useMessageDB: () => ({
    // Intentionally minimal public markers; no private key/keyset is created.
    keyset: { userKeyset: { revision: fixture.revision }, deviceKeyset: { revision: fixture.revision } },
    getConfig: (input: unknown) => fixture.getConfig(input),
    saveConfig: (input: unknown) => fixture.saveConfig(input),
    setKeyset: (input: unknown) => fixture.setKeyset(input),
    setSelfAddress: (address: string) => fixture.setSelfAddress(address),
  }),
}));
vi.mock('@/utils', () => ({ getDefaultUserConfig: fixture.getDefaultUserConfig }));
vi.mock('@/components/primitives', () => ({
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick(): void }>) => <button onClick={onClick}>{children}</button>,
  Icon: () => null,
}));

import { RegistrationProvider } from '@/components/context/RegistrationPersister';

beforeAll(() => { i18n.load('en', messages); i18n.activate('en'); });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fixture.revision = 0;
  // Stop at the first boundary forever: no exported secret, cryptography,
  // registration upload, API request or configuration persistence can occur.
  fixture.exportKey.mockReset().mockImplementation(() => new Promise<string>(() => {}));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
function expectNoRegistrationWork() {
  for (const call of [fixture.getUser, fixture.uploadRegistration, fixture.getConfig, fixture.saveConfig,
    fixture.setKeyset, fixture.setSelfAddress, fixture.getDefaultUserConfig, fixture.loadKeyDecryptData,
    fixture.createKeyFromBuffer, fixture.decrypt, fixture.encrypt, fixture.encryptDataSaveKey,
    fixture.constructRegistration, fixture.newUserKeyset, fixture.newDeviceKeyset]) expect(call).not.toHaveBeenCalled();
}

describe('registration initialization stays one-shot across dependency refreshes', () => {
  it.each([false, true])('does not repeat an in-flight export when registration is initially %s', async registered => {
    fixture.registered = registered;
    const { rerender } = render(<RegistrationProvider><p>Child 0</p></RegistrationProvider>);
    expect(fixture.exportKey).not.toHaveBeenCalled();
    await advance(199);
    fixture.revision++;
    rerender(<RegistrationProvider><p>Child 1</p></RegistrationProvider>);
    expect(fixture.exportKey).not.toHaveBeenCalled();
    await advance(1);
    expect(fixture.exportKey).toHaveBeenCalledExactlyOnceWith('isolated-registration-address');

    // Registration snapshots, API/SDK wrappers and keyset objects all refresh,
    // before and after the delayed export starts. None is a new user attempt.
    for (let revision = 2; revision <= 4; revision++) {
      fixture.revision = revision;
      fixture.registered = revision % 2 === 0 ? !registered : registered;
      rerender(<RegistrationProvider><p>Child {revision}</p></RegistrationProvider>);
      await advance(1_000);
    }
    expect(screen.getByText('Child 4')).toBeInTheDocument();
    expect(fixture.exportKey).toHaveBeenCalledTimes(1);
    expectNoRegistrationWork();
  });

  it.each([false, true])('requires explicit Reauthorize after NotAllowedError when registration is initially %s', async registered => {
    fixture.registered = registered;
    fixture.exportKey.mockRejectedValueOnce(new DOMException('Synthetic authorization denied', 'NotAllowedError'));
    const { rerender } = render(<RegistrationProvider><p>Protected child</p></RegistrationProvider>);
    await advance(200);
    expect(screen.getByText('Session Encrypted')).toBeInTheDocument();
    expect(screen.queryByText('Protected child')).not.toBeInTheDocument();

    fixture.revision++;
    rerender(<RegistrationProvider><p>Protected child</p></RegistrationProvider>);
    await advance(1_000);
    expect(fixture.exportKey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reauthorize' }));
    expect(screen.getByText('Protected child')).toBeInTheDocument();
    await advance(199); expect(fixture.exportKey).toHaveBeenCalledTimes(1);
    await advance(1); expect(fixture.exportKey).toHaveBeenCalledTimes(2);

    fixture.revision++;
    rerender(<RegistrationProvider><p>Protected child</p></RegistrationProvider>);
    await advance(1_000);
    expect(fixture.exportKey).toHaveBeenCalledTimes(2);
    expectNoRegistrationWork();
  });
});
