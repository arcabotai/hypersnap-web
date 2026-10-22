import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  space: undefined as undefined | {
    spaceId: string;
    spaceName: string;
    groups: { groupName: string; channels: { channelId: string; channelName: string }[] }[];
  },
  messages: { pages: [{ messages: [] as { content: { senderId: string } }[] }] },
  fetchNextPage: vi.fn(),
  fetchPreviousPage: vi.fn(),
  exportKey: vi.fn(),
  getMessages: vi.fn(),
  navigate: vi.fn(),
  enqueue: vi.fn(),
  updateSpace: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => state.navigate,
  useParams: () => ({ address: 'isolated-peer', channelId: 'channel-a' }),
}));
vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeysContext: () => ({ currentPasskeyInfo: { address: 'isolated-user' }, exportKey: state.exportKey }),
  usePasskeyFlow: () => ({
    step: 'idle', error: null, address: null, isPasskeySupported: true,
    canRetry: false, proceedWithoutPasskey: vi.fn(), startRegistration: vi.fn(),
    completeRegistration: vi.fn(), retry: vi.fn(), importKeyFile: vi.fn(),
  }),
  passkey: {},
}));
vi.mock('@/hooks/queries', () => ({
  useSpace: () => ({ data: state.space }),
  buildSpaceKey: ({ spaceId }: { spaceId: string }) => ['Space', spaceId],
}));
vi.mock('@/hooks/queries/messages/useMessages', () => ({
  useMessages: () => ({ data: state.messages, fetchNextPage: state.fetchNextPage,
    fetchPreviousPage: state.fetchPreviousPage, hasNextPage: false }),
}));
vi.mock('@/components/context/useMessageDB', () => ({
  useMessageDB: () => ({
    messageDB: { getMessages: state.getMessages }, updateSpace: state.updateSpace,
    createChannel: vi.fn(), deleteSpace: vi.fn(), actionQueueService: { enqueue: state.enqueue },
  }),
}));
vi.mock('@/components/context/useRegistrationContext', () => ({ useRegistrationContext: () => ({}) }));
vi.mock('@/hooks/ui/useConfirmation', () => ({ useConfirmation: () => ({ handleClick: vi.fn() }) }));
vi.mock('@/components/space/ChannelPreview', () => ({ default: () => null }));
vi.mock('@/hooks/business/validation', () => ({
  validateChannelName: () => undefined, validateChannelTopic: () => undefined,
  validateGroupName: () => undefined, validateDisplayName: () => undefined,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock('@/hooks/platform/user/usePasskeyAdapter', () => ({
  // Recreate the adapter and its public metadata just as the production hook
  // does. A wrapper identity change must not repeat an in-flight key export.
  usePasskeyAdapter: () => ({
    currentPasskeyInfo: { address: 'isolated-user', credentialId: 'fixture', publicKey: 'fixture-public', completedOnboarding: false },
    exportKey: state.exportKey, updateStoredPasskey: vi.fn(),
  }),
}));
vi.mock('@/components/context/QuorumApiContext', () => ({
  useQuorumApiClient: () => ({ apiClient: { getUser: vi.fn(), getUserSettings: vi.fn() } }),
}));
vi.mock('@/hooks/mutations/useUploadRegistration', () => ({ useUploadRegistration: () => vi.fn() }));
vi.mock('@/hooks/useKeyBackup', () => ({ useKeyBackup: () => ({ downloadKey: vi.fn() }) }));

import { useChannelManagement } from '@/hooks/business/channels/useChannelManagement';
import { useGroupManagement } from '@/hooks/business/channels/useGroupManagement';
import { useSpaceManagement } from '@/hooks/business/spaces/useSpaceManagement';
import { useDirectMessagesList } from '@/hooks/business/conversations/useDirectMessagesList';
import { useUnifiedOnboardingFlow } from '@/hooks/business/user/useUnifiedOnboardingFlow';
import { useKeyBackupLogic } from '@/hooks/business/files/useKeyBackupLogic';
import { useFileDownloadAdapter } from '@/hooks/platform/files/useFileDownload';

const space = (spaceId = 'space-a', title = 'Original') => ({
  spaceId, spaceName: title,
  groups: [
    { groupName: 'group-a', channels: [{ channelId: 'channel-a', channelName: title }] },
    { groupName: 'group-b', channels: [{ channelId: 'channel-b', channelName: 'Other channel' }] },
  ],
});

describe('hook dependency cleanup preserves initialization lifetimes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.space = space();
    state.messages = { pages: [{ messages: [] }] };
    state.fetchNextPage = vi.fn();
    state.fetchPreviousPage = vi.fn();
    state.getMessages.mockResolvedValue({ messages: [] });
    // No private key is generated or returned: hold the isolated lookup at its
    // first boundary so wrapper rerenders can be observed safely.
    state.exportKey.mockImplementation(() => new Promise(() => {}));
  });

  it('hydrates channel data on arrival and identity changes, preserving edits across a same-Space refresh', async () => {
    state.space = undefined;
    const { result, rerender } = renderHook(({ groupName, channelId }) =>
      useChannelManagement({ spaceId: 'space-a', groupName, channelId }), {
      initialProps: { groupName: 'group-a', channelId: 'channel-a' },
    });
    state.space = space();
    await act(async () => rerender({ groupName: 'group-a', channelId: 'channel-a' }));
    expect(result.current.channelName).toBe('Original');
    act(() => result.current.handleChannelNameChange('Unsaved channel'));
    state.space = space('space-a', 'Remote refresh');
    await act(async () => rerender({ groupName: 'group-a', channelId: 'channel-a' }));
    expect(result.current.channelName).toBe('Unsaved channel');
    await act(async () => rerender({ groupName: 'group-b', channelId: 'channel-b' }));
    expect(result.current.channelName).toBe('Other channel');
    expect(state.updateSpace).not.toHaveBeenCalled();
  });

  it('preserves group edits during refresh and initializes the next group', async () => {
    const { result, rerender } = renderHook(({ groupName }) =>
      useGroupManagement({ spaceId: 'space-a', groupName }), { initialProps: { groupName: 'group-a' } });
    act(() => result.current.handleGroupNameChange('Unsaved group'));
    state.space = space('space-a', 'Remote refresh');
    await act(async () => rerender({ groupName: 'group-a' }));
    expect(result.current.group).toBe('Unsaved group');
    await act(async () => rerender({ groupName: 'group-b' }));
    expect(result.current.group).toBe('group-b');
    expect(state.updateSpace).not.toHaveBeenCalled();
  });

  it('preserves Space settings edits across background refreshes and hydrates a different Space', () => {
    const { result, rerender } = renderHook(({ spaceId }) => useSpaceManagement({ spaceId }), {
      initialProps: { spaceId: 'space-a' },
    });
    act(() => result.current.setSpaceName('Unsaved Space'));
    state.space = space('space-a', 'Remote refresh');
    rerender({ spaceId: 'space-a' });
    expect(result.current.spaceName).toBe('Unsaved Space');
    state.space = space('space-b', 'Other Space');
    rerender({ spaceId: 'space-b' });
    expect(result.current.spaceName).toBe('Other Space');
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('loads initially empty DM pages once, without a loop when empty query pages or actions change', () => {
    const initialNext = state.fetchNextPage;
    const initialPrevious = state.fetchPreviousPage;
    const { rerender } = renderHook(() => useDirectMessagesList());
    expect(initialNext).toHaveBeenCalledTimes(1);
    expect(initialPrevious).toHaveBeenCalledTimes(1);
    state.messages = { pages: [{ messages: [] }] };
    state.fetchNextPage = vi.fn();
    state.fetchPreviousPage = vi.fn();
    rerender();
    expect(initialNext).toHaveBeenCalledTimes(1);
    expect(initialPrevious).toHaveBeenCalledTimes(1);
    expect(state.fetchNextPage).not.toHaveBeenCalled();
    expect(state.fetchPreviousPage).not.toHaveBeenCalled();
  });

  it('does not restart a returning-user credential lookup when adapter/API/callback wrappers change', () => {
    const { rerender, unmount } = renderHook(({ setUser }) => useUnifiedOnboardingFlow({ setUser }), {
      initialProps: { setUser: state.setUser },
    });
    expect(state.exportKey).toHaveBeenCalledTimes(1);
    rerender({ setUser: vi.fn() });
    rerender({ setUser: vi.fn() });
    expect(state.exportKey).toHaveBeenCalledTimes(1);
    expect(state.setUser).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps private SDK export error metadata out of the existing message-only failure surface', async () => {
    const failure = Object.assign(new Error('Fixture export unavailable'), { privateMetadata: 'fixture-never-expose' });
    state.exportKey.mockRejectedValue(failure);
    const downloadKeyFile = vi.fn();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useKeyBackupLogic({ downloadKeyFile }));
      let caught: unknown;
      await act(async () => { try { await result.current.downloadKey(); } catch (error) { caught = error; } });
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Failed to export key: Fixture export unavailable');
      expect(caught).not.toHaveProperty('cause');
      expect(caught).not.toHaveProperty('privateMetadata');
      expect(errorLog.mock.calls.flat()).not.toContain(failure);
      expect(downloadKeyFile).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('keeps download failure details message-only without attaching the original file error', async () => {
    const failure = Object.assign(new Error('Fixture file unavailable'), { privateMetadata: 'fixture-never-expose' });
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => { throw failure; });
    try {
      const { result } = renderHook(() => useFileDownloadAdapter());
      let caught: unknown;
      await act(async () => { try { await result.current.downloadKeyFile('synthetic-file-content', 'fixture.key'); } catch (error) { caught = error; } });
      expect((caught as Error).message).toBe('Failed to download file: Fixture file unavailable');
      expect(caught).not.toHaveProperty('cause');
      expect(caught).not.toHaveProperty('privateMetadata');
    } finally {
      URL.createObjectURL = original;
    }
  });
});
