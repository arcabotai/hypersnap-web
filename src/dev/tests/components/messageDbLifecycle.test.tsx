import React, { useContext } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  databases: [] as any[], messages: [] as any[], queues: [] as any[], syncs: [] as any[],
  handlers: [] as ((message: any) => Promise<void>)[],
  reconnects: [] as (() => Promise<void>)[],
  producers: [] as (() => Promise<string[]>)[],
  navigate: vi.fn(),
  apiClient: {},
  setMessageHandler: vi.fn((handler: (message: any) => Promise<void>) => { state.handlers.push(handler); }),
  setResubscribe: vi.fn((callback: () => Promise<void>) => { state.reconnects.push(callback); }),
  enqueueOutbound: vi.fn((producer: () => Promise<string[]>) => { state.producers.push(producer); }),
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
}));

vi.mock('@/db/messages', () => ({
  MessageDB: class {
    getSpaces = vi.fn(async () => [{ spaceId: 'fixture-space', defaultChannelId: 'fixture-channel' }]);
    getUserConfig = vi.fn(async () => ({ spaceIds: ['fixture-space'] }));
    getAllEncryptionStates = vi.fn(async () => [{ inboxId: 'existing-fixture-inbox' }]);
    setSelfAddressForDiagnostics = vi.fn();
    constructor() { state.databases.push(this); }
  },
}));
vi.mock('@/services', () => ({
  ConfigService: class {}, EncryptionService: class {}, InvitationService: class {}, SpaceService: class {},
  SyncService: class {
    requestSync = vi.fn(async () => true);
    constructor() { state.syncs.push(this); }
  },
  MessageService: class {
    setActionQueueService = vi.fn();
    setReceiptService = vi.fn();
    setTypingService = vi.fn();
    handleNewMessage = vi.fn(async () => {});
    rebroadcastProfileToAllDMsOnConnect = vi.fn(async () => {});
    announceProfileToAllSpacesOnConnect = vi.fn(async () => {});
    announceDeviceKeys = vi.fn(async () => {});
    submitChannelMessage = vi.fn(async () => {});
    broadcastProfileToAllDMs = vi.fn(async () => {});
    constructor() { state.messages.push(this); }
  },
  ActionQueueService: class {
    keyset: unknown;
    setHandlers = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    setUserKeyset = vi.fn((keyset: unknown) => { this.keyset = keyset; });
    getUserKeyset = () => this.keyset;
    constructor() { state.queues.push(this); }
  },
  ActionQueueHandlers: class {},
}));
vi.mock('@quilibrium/quorum-shared', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
  ReceiptService: class { destroy = vi.fn(); },
  TypingService: class { destroy = vi.fn(); },
  advanceReadWatermark: vi.fn(), isReadAckTimestampValid: vi.fn(),
  resolveDeliveryAckPatch: vi.fn(), resolveReadAckPatch: vi.fn(),
}));
vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({ channel_raw: {}, channel: {} }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => state.queryClient }));
vi.mock('react-router', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/components/context/QuorumApiContext', () => ({ useQuorumApiClient: () => ({ apiClient: state.apiClient }) }));
vi.mock('@/components/context/WebsocketProvider', () => ({
  useWebSocket: () => ({ setMessageHandler: state.setMessageHandler,
    setResubscribe: state.setResubscribe, enqueueOutbound: state.enqueueOutbound }),
}));
vi.mock('@/components/context/ActionQueueContext', () => ({
  ActionQueueProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/hooks', () => ({ buildConversationsKey: () => ['Conversations'] }));
vi.mock('@/hooks/queries/conversation/useInvalidateConversation', () => ({ useInvalidateConversation: () => invalidateConversation }));
const invalidateConversation = vi.fn();
vi.mock('@/utils/crypto', () => ({ sha256: { digest: vi.fn() }, base58btc: { baseEncode: vi.fn() } }));

import { MessageDBContext, MessageDBProvider } from '@/components/context/MessageDB';

type ContextValue = React.ContextType<typeof MessageDBContext>;
let current: ContextValue;
function Capture() {
  const value = useContext(MessageDBContext);
  React.useEffect(() => { current = value; }, [value]);
  return null;
}
const tree = () => <MessageDBProvider><Capture /></MessageDBProvider>;

// Public fixture identifiers only; no real signing/decryption material exists.
const keyset = (label: string) => ({
  userKeyset: { user_key: { public_key: [1] } },
  deviceKeyset: { identity_key: {}, inbox_keyset: { inbox_address: `inbox-${label}` } },
}) as unknown as ContextValue['keyset'];
const latest = <T,>(items: T[]) => items[items.length - 1];
async function boot(label = 'a') {
  const view = render(tree());
  await act(async () => {
    current.setSelfAddress(`identity-${label}`);
    current.setKeyset(keyset(label));
  });
  return view;
}

describe('MessageDB identity-scoped connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.databases = []; state.messages = []; state.queues = []; state.syncs = [];
    state.handlers = []; state.reconnects = []; state.producers = [];
    state.navigate = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).__messageDB;
    delete (window as any).__actionQueue;
  });

  it('does not re-listen or duplicate startup announcements after a navigation/service rerender', async () => {
    const view = await boot();
    expect(vi.getTimerCount()).toBe(4);
    expect(state.setMessageHandler).toHaveBeenCalledTimes(1);
    expect(state.setResubscribe).toHaveBeenCalledTimes(1);
    const previousService = latest(state.messages);
    state.navigate = vi.fn();
    view.rerender(tree());
    const service = latest(state.messages);
    expect(service).not.toBe(previousService);
    expect(vi.getTimerCount()).toBe(4);
    expect(state.setMessageHandler).toHaveBeenCalledTimes(1);
    expect(state.setResubscribe).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(state.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(previousService.rebroadcastProfileToAllDMsOnConnect).not.toHaveBeenCalled();
    expect(service.rebroadcastProfileToAllDMsOnConnect).toHaveBeenCalledTimes(1);
    expect(service.announceProfileToAllSpacesOnConnect).toHaveBeenCalledTimes(1);
    expect(service.announceDeviceKeys).toHaveBeenCalledTimes(1);
    expect(latest(state.syncs).requestSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces pending reconnect pushes when the socket flaps, retaining original startup timers', async () => {
    await boot();
    const reconnect = latest(state.reconnects);
    await act(async () => { await reconnect(); await reconnect(); });
    expect(vi.getTimerCount()).toBe(6); // four startup timers + two coalesced reconnect pushes
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(latest(state.messages).rebroadcastProfileToAllDMsOnConnect).toHaveBeenCalledTimes(1);
    expect(latest(state.messages).announceProfileToAllSpacesOnConnect).toHaveBeenCalledTimes(1);
  });

  it('cancels every owned timer and deactivates retained reconnect/inbound callbacks on unmount', async () => {
    const view = await boot();
    const reconnect = latest(state.reconnects);
    const handler = latest(state.handlers);
    const service = latest(state.messages);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await reconnect(); await handler({ fixture: true });
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(state.enqueueOutbound).not.toHaveBeenCalled();
    expect(service.handleNewMessage).not.toHaveBeenCalled();
    expect(service.rebroadcastProfileToAllDMsOnConnect).not.toHaveBeenCalled();
    expect(service.announceProfileToAllSpacesOnConnect).not.toHaveBeenCalled();
  });

  it('drops queued producers from an old identity and listens only on the replacement identity', async () => {
    await boot();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const oldProducer = latest(state.producers);
    const oldReconnect = latest(state.reconnects);
    const oldHandler = latest(state.handlers);
    await act(async () => {
      current.setSelfAddress('identity-b'); current.setKeyset(keyset('b'));
    });
    await expect(oldProducer()).resolves.toEqual([]);
    const service = latest(state.messages);
    await act(async () => { await oldReconnect(); await oldHandler({ fixture: true }); });
    expect(service.handleNewMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    const payload = JSON.parse((await latest(state.producers)())[0]);
    expect(payload.inbox_addresses).toEqual(['existing-fixture-inbox', 'inbox-b']);
    expect(service.rebroadcastProfileToAllDMsOnConnect).toHaveBeenCalledWith('identity-b', current.keyset);
    expect(service.announceDeviceKeys).toHaveBeenCalledWith('fixture-space', current.keyset);
  });

  it('does not resume obsolete startup sync after an IndexedDB read finishes during an identity change', async () => {
    await boot();
    let finishRead!: (spaces: { spaceId: string; defaultChannelId: string }[]) => void;
    latest(state.databases).getSpaces.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    await act(async () => {
      current.setSelfAddress('identity-b'); current.setKeyset(keyset('b'));
    });
    await act(async () => { finishRead([{ spaceId: 'obsolete-space', defaultChannelId: 'obsolete-channel' }]); });
    expect(latest(state.syncs).requestSync).not.toHaveBeenCalled();
    expect(latest(state.messages).announceDeviceKeys).not.toHaveBeenCalled();
  });

  it('uses the current message service when an explicit profile update follows navigation', async () => {
    const view = await boot();
    const previousService = latest(state.messages);
    state.navigate = vi.fn();
    view.rerender(tree());
    const service = latest(state.messages);
    await act(async () => {
      await current.updateUserProfile('Fixture name', 'fixture-avatar', {
        address: 'identity-a', credentialId: 'fixture', publicKey: 'fixture-public', completedOnboarding: true,
      });
    });
    expect(previousService.submitChannelMessage).not.toHaveBeenCalled();
    expect(service.submitChannelMessage).toHaveBeenCalledOnce();
    expect(service.submitChannelMessage.mock.calls[0][2]).toMatchObject({
      type: 'update-profile', senderId: 'identity-a', globalDisplayName: 'Fixture name', globalUserIcon: 'fixture-avatar',
    });
  });
});
