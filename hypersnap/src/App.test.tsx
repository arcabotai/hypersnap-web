// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getChannel, getChannels, getConversation, getFeed, getFollowStatus, getInfo, getProfileFeed, getReactionStatus, getSuggestedUsers, getChannelMembers, getCastQuotes, getUser, searchCasts, searchUsers, type Cast, type User } from './lib/api';
import type { WalletSession } from './lib/auth';
import { uploadMedia } from './lib/media';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES } from './lib/pairing';

const wallet = vi.hoisted(() => ({ next: null as WalletSession | null }));
vi.mock('./components/ConnectAccount', () => ({
  default: ({ onConnect, onClose, requestedScopes }: { onConnect(value: WalletSession): void; onClose(): void; requestedScopes?: readonly number[] }) => <div data-testid="synthetic-wallet"><p data-testid="requested-scopes">{requestedScopes?.join(',') || 'posting'}</p><button onClick={() => { if (wallet.next) onConnect(wallet.next); }}>Approve synthetic wallet</button><button onClick={onClose}>Cancel synthetic wallet</button></div>,
  DeviceSettings: () => <div>Synthetic device settings</div>,
}));
vi.mock('./lib/media', () => ({ uploadMedia: vi.fn() }));
vi.mock('./lib/api', async original => ({ ...await original<typeof import('./lib/api')>(), getCast: vi.fn(), getChannel: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getFollowStatus: vi.fn(), getInfo: vi.fn(), getProfileFeed: vi.fn(), getReactionStatus: vi.fn(), getSuggestedUsers: vi.fn(), getChannelMembers: vi.fn(), getCastQuotes: vi.fn(), getUser: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn() }));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '0x1111111111111111111111111111111111111111', profile: { bio: { text: 'An isolated public profile' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, authorFid: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(authorFid), text, timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const ownCast = cast('a', 10, 'My isolated cast');
const otherCast = cast('b', 20, 'Someone else’s isolated cast');
function session(scopes: readonly number[], key = '1'): WalletSession {
  return { fid: 10, user: person(10), custodyAddress: person(10).custody_address, publicKey: key.repeat(64), scopes, cast: vi.fn().mockResolvedValue({ hash: `0x${'c'.repeat(40)}` }), deleteCast: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), react: vi.fn(), follow: vi.fn(), updateProfile: vi.fn(), refreshProfile: vi.fn(), authorizeMediaUpload: vi.fn() } as unknown as WalletSession;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((value, error) => { resolve = value; reject = error; }); return { promise, resolve, reject }; }
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); localStorage.clear(); wallet.next = null;
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getProfileFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-test' });
  vi.mocked(getReactionStatus).mockResolvedValue(false);
  vi.mocked(getSuggestedUsers).mockResolvedValue({ users: [person(30)] });
  vi.mocked(getChannelMembers).mockResolvedValue({ users: [person(20)], next: {} });
  vi.mocked(getCastQuotes).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 10));
  vi.mocked(getFollowStatus).mockResolvedValue(false);
  vi.mocked(getConversation).mockResolvedValue({ cast: otherCast, replies: [] });
  vi.mocked(getCast).mockResolvedValue(otherCast);
  vi.mocked(searchCasts).mockResolvedValue({ casts: [otherCast], next: {} });
  vi.mocked(searchUsers).mockResolvedValue({ users: [person(42)] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function start(path = '/') { history.replaceState(null, '', path); await act(async () => root.render(<App />)); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function button(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!; }
function dialog(title: string) { return [...container.querySelectorAll<HTMLDialogElement>('dialog')].find(item => item.querySelector('h2')?.textContent === title)!; }
async function connect(value: WalletSession) { wallet.next = value; await click(button('Connect Farcaster')); await click(button('Approve synthetic wallet')); }
async function traverse(direction: 'back' | 'forward') {
  await act(async () => { history[direction](); await new Promise(resolve => setTimeout(resolve, 10)); });
}

describe('isolated App feature integration', () => {
  it('preserves query and result kind through profile navigation and Back/Forward', async () => {
    await start('/search?q=person&type=users');
    expect((container.querySelector('main input[type="search"]') as HTMLInputElement).value).toBe('person');
    await click(container.querySelector('main a[href="/profile/42"]')!);
    expect(location.pathname).toBe('/profile/42');
    await traverse('back');
    expect(location.pathname + location.search).toBe('/search?q=person&type=users');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('People');
    expect((container.querySelector('main input[type="search"]') as HTMLInputElement).value).toBe('person');
    await traverse('forward'); expect(location.pathname).toBe('/profile/42');
  });

  it('keeps search query in conversation background history and restores it when the thread closes', async () => {
    await start('/search?q=cosmos');
    await click(container.querySelector('main a[aria-label="Open cast"]')!);
    expect(history.state.quorumBackground).toBe('/search?q=cosmos');
    expect(dialog('Conversation')).toBeDefined();
    await traverse('back');
    expect(location.pathname + location.search).toBe('/search?q=cosmos');
    expect(dialog('Conversation')).toBeUndefined();
    await traverse('forward'); expect(dialog('Conversation')).toBeDefined();
    await click(dialog('Conversation').querySelector('button[aria-label="Close dialog"]')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(location.pathname + location.search).toBe('/search?q=cosmos');
  });

  it('cancels an old profile tab request and ignores a delayed response after switching to Photos', async () => {
    const replies = deferred<{ casts: Cast[]; next: {} }>();
    const photos = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(getProfileFeed).mockImplementation(options => options.tab === 'replies' ? replies.promise : photos.promise);
    await start('/profile/10?tab=replies');
    const first = vi.mocked(getProfileFeed).mock.calls.find(([options]) => options.tab === 'replies')![0];
    await click(container.querySelector('nav[aria-label="Profile content"] a[href="/profile/10?tab=media"]')!);
    expect(first.signal?.aborted).toBe(true); expect(location.search).toBe('?tab=media');
    await act(async () => photos.resolve({ casts: [cast('c', 10, 'Current photo result')], next: {} }));
    await act(async () => replies.resolve({ casts: [cast('d', 10, 'Stale reply result')], next: {} }));
    expect(container.textContent).toContain('Current photo result'); expect(container.textContent).not.toContain('Stale reply result');
  });

  it('cancels profile pagination after changing tabs and suppresses a late error from the old page', async () => {
    const next = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(getProfileFeed).mockImplementation(options => options.tab === 'media'
      ? Promise.resolve({ casts: [cast('e', 10, 'New photo tab')], next: {} })
      : options.cursor ? next.promise : Promise.resolve({ casts: [cast('d', 10, 'Existing reply')], next: { cursor: 'next-replies' } }));
    await start('/profile/10?tab=replies');
    await click(button('More conversations'));
    const oldPage = vi.mocked(getProfileFeed).mock.calls.find(([options]) => options.cursor === 'next-replies')![0];
    await click(container.querySelector('nav[aria-label="Profile content"] a[href="/profile/10?tab=media"]')!);
    expect(oldPage.signal?.aborted).toBe(true);
    await act(async () => next.reject(new Error('Old reply page failed after navigation')));
    expect(container.textContent).toContain('New photo tab');
    expect(container.textContent).not.toContain('Old reply page failed after navigation');
  });

  it('passes the channel record’s actual parent URL into the signed cast options', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/alias', parent_url: 'https://example.com/real-namespace/isolated', member_count: 2 };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated'); const connected = session(FULL_CLIENT_SCOPES); await connect(connected);
    const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a cast"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(field, 'An isolated channel cast'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(button('Cast', container.querySelector('main')!));
    expect(connected.cast).toHaveBeenCalledWith('An isolated channel cast', undefined, expect.objectContaining({ parentUrl: channel.parent_url }));
  });

  it('reserves one of the two embed slots for a quote and allows only one attached image', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    const connected = session(FULL_CLIENT_SCOPES);
    vi.mocked(uploadMedia).mockResolvedValue({ url: `https://quorum.arca.computer/media/${'e'.repeat(64)}` });
    await start(); await connect(connected);
    await click(container.querySelector('button[aria-label="Quote cast"]')!);
    const quote = dialog('Quote cast');
    expect(connected.cast).not.toHaveBeenCalled();
    const field = quote.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(field, 'files', { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], 'isolated.png', { type: 'image/png' })] });
    await act(async () => { field.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('Add image', quote).disabled).toBe(true); expect(quote.textContent).toContain('1/1 images');
    await click(button('Quote', quote));
    expect(connected.cast).toHaveBeenCalledWith('', undefined, expect.objectContaining({ embeds: [{ url: `https://quorum.arca.computer/media/${'e'.repeat(64)}` }, { castId: { fid: otherCast.author.fid, hash: otherCast.hash } }] }));
    expect(dialog('Quote cast')).toBeUndefined();
  });

  it('keeps a newer quote draft open when a previously closed quote receives its late posting receipt', async () => {
    const secondCast = cast('f', 30, 'Another isolated cast to quote');
    const receipt = deferred<{ hash: string }>();
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast, secondCast], next: {} });
    const connected = session(FULL_CLIENT_SCOPES);
    vi.mocked(connected.cast).mockReturnValueOnce(receipt.promise);
    await start(); await connect(connected);
    await click(container.querySelectorAll('main button[aria-label="Quote cast"]')[0]);
    await click(button('Quote', dialog('Quote cast')));
    expect(connected.cast).toHaveBeenCalledOnce();
    await click(dialog('Quote cast').querySelector('button[aria-label="Close dialog"]')!);
    await click(container.querySelectorAll('main button[aria-label="Quote cast"]')[1]);
    const newer = dialog('Quote cast');
    expect(newer.textContent).toContain(secondCast.text);
    const field = newer.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a quote"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(field, 'Keep this newer quote draft'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => receipt.resolve({ hash: `0x${'e'.repeat(40)}` }));
    expect(dialog('Quote cast')).toBeDefined();
    expect(dialog('Quote cast').textContent).toContain(secondCast.text);
    expect(dialog('Quote cast').querySelector('textarea')?.value).toBe('Keep this newer quote draft');
    expect(connected.cast).toHaveBeenCalledOnce();
  });

  it('merges channel pages chronologically, deduplicates normalized hashes and preserves trending ranking', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    const item = (letter: string, time: number) => ({ ...cast(letter, 20, `Channel time ${time}`), timestamp: new Date(1_000_000 + time * 1_000).toISOString() });
    const hundred = item('a', 100); const ninety = item('b', 90); const forty = item('c', 40); const thirty = item('d', 30);
    const eighty = item('e', 80); const seventy = item('f', 70);
    vi.mocked(getFeed).mockImplementation(async options => options.kind === 'channel'
      ? options.cursor ? { casts: [{ ...hundred, hash: 'A'.repeat(40) }, eighty, seventy], next: {} } : { casts: [hundred, ninety, forty, thirty], next: { cursor: 'channel-next' } }
      : { casts: [thirty, hundred], next: {} });
    await start('/channel/isolated');
    await click(button('More conversations'));
    const texts = () => [...container.querySelectorAll('main .feed .cast__text')].map(element => element.textContent);
    expect(texts()).toEqual([100, 90, 80, 70, 40, 30].map(time => `Channel time ${time}`));
    await click(button('Discover'));
    expect(texts()).toEqual(['Channel time 30', 'Channel time 100']);
  });

  it('offers deletion only for the connected account and requires a separate confirmation after permission approval', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast, otherCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    expect(container.querySelectorAll('button[aria-label="Delete cast"]')).toHaveLength(1);
    await click(container.querySelector('button[aria-label="Delete cast"]')!);
    expect(dialog('Delete cast').textContent).toContain(ownCast.text);
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    await click(button('Enable deletion', dialog('Delete cast')));
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe(FULL_CLIENT_SCOPES.join(','));
    const upgraded = session(FULL_CLIENT_SCOPES, '2'); wallet.next = upgraded;
    await click(button('Approve synthetic wallet'));
    expect(upgraded.deleteCast).not.toHaveBeenCalled();
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    expect(dialog('Delete cast')).toBeDefined();
    await click(dialog('Delete cast').querySelector('.delete-cast-confirm')!);
    expect(upgraded.deleteCast).toHaveBeenCalledOnce();
    expect(upgraded.deleteCast).toHaveBeenCalledWith({ fid: ownCast.author.fid, hash: ownCast.hash });
    expect(dialog('Delete cast')).toBeUndefined();
  });

  it('keeps the existing device connected when a deletion permission review is cancelled', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    await click(container.querySelector('button[aria-label="Delete cast"]')!);
    await click(button('Enable deletion', dialog('Delete cast')));
    await click(button('Cancel synthetic wallet'));
    expect(button('Enable deletion', dialog('Delete cast'))).toBeDefined();
    expect(legacy.dispose).not.toHaveBeenCalled();
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Person 10');
  });

  it('opens image attachments in the viewer and preserves modified-click links', async () => {
    const photo = { ...otherCast, embeds: [{ url: 'https://example.org/a.png' }, { url: 'https://example.org/b.png' }] };
    vi.mocked(getFeed).mockResolvedValue({ casts: [photo], next: {} });
    await start();
    await click(container.querySelector('a[aria-label="View attached image"]')!);
    expect(dialog('Cast images').querySelector('img')?.src).toBe('https://example.org/a.png');
    await click(dialog('Cast images').querySelector('button[aria-label="Next image"]')!);
    expect(dialog('Cast images').querySelector('img')?.src).toBe('https://example.org/b.png');
    await click(dialog('Cast images').querySelector('button[aria-label="Close dialog"]')!);
    expect(container.querySelector('a[aria-label="View attached image"]')?.getAttribute('target')).toBe('_blank');
    expect(dialog('Cast images')).toBeUndefined();
  });

  it('saves a channel shortcut in the sidebar and restores it after remount without a protocol write', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.org/channels/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated');
    await click(button('Save channel'));
    expect(container.querySelector('nav[aria-label="Saved channels"]')?.textContent).toContain('Isolated channel');
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await act(async () => root.render(<App />));
    expect(container.querySelector('nav[aria-label="Saved channels"]')?.textContent).toContain('Isolated channel');
    expect(button('Saved on this browser')).toBeDefined();
  });

  it('shows shareable Likes tabs, profile links and cast text options', async () => {
    vi.mocked(getProfileFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    await start('/profile/10?tab=likes');
    expect(vi.mocked(getProfileFeed).mock.calls.some(([options]) => options.tab === 'likes')).toBe(true);
    expect(container.querySelector('nav[aria-label="Profile content"] a[aria-current="page"]')?.textContent).toBe('Likes');
    await click(button('Share profile'));
    expect(dialog('Share profile').querySelector<HTMLInputElement>('input')?.value).toBe('https://quorum.arca.computer/profile/10');
    await click(dialog('Share profile').querySelector('button[aria-label="Close dialog"]')!);
    await click(container.querySelector('button[aria-label="More cast options"]')!);
    expect(dialog('Cast options').querySelector('textarea')?.value).toBe(otherCast.text);
    await click(button('Quote cast', dialog('Cast options')));
    expect(dialog('Cast options')).toBeUndefined(); expect(dialog('Quote cast')).toBeDefined();
  });

  it('opens actual channel participants and clears the dialog on profile navigation', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.org/channels/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated');
    await click(button('View participants'));
    expect(getChannelMembers).toHaveBeenCalledWith('isolated', expect.anything());
    const people = dialog('Participants · /Isolated channel'); expect(people).toBeDefined();
    await click(people.querySelector('a[href="/profile/20"]')!);
    expect(location.pathname).toBe('/profile/20'); expect(dialog('Participants · /Isolated channel')).toBeUndefined();
  });

});
