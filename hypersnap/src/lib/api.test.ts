import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChannel, getChannels, getConversation, getFeed, getFollows, getFollowStatus, getNotifications, getProfileFeed, getSigners, getUser, hasImageEmbed, searchCasts, searchUsers, submitMessage, type Cast, type User } from './api';

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const user = (fid: number): User => ({ fid, username: `alice${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, extra: Partial<Cast> = {}): Cast => ({ hash: letter.repeat(40), author: user(3), text: 'test', timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 }, ...extra });
afterEach(() => vi.unstubAllGlobals());

describe('browser API client', () => {
  it('loads ranked public user search and drops node fid:0 placeholders', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [user(0), user(3)] }));
    vi.stubGlobal('fetch', fetch);
    expect(await searchUsers({ query: ' @ali ', limit: 10 })).toEqual({ users: [user(3)] });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/user/search?limit=10&q=%40ali');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  });

  it('hydrates real search metadata, deduplicates hashes and filters only verified deleted hits', async () => {
    const match = cast('a');
    const hydrated = { ...match, text: 'authoritative body', embeds: [{ cast_id: { fid: 3, hash: 'c'.repeat(40) } }], reactions: { likes_count: 7, recasts_count: 2 } };
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [match, { ...match, hash: `0x${match.hash}` }, cast('b', { author: user(0) }), cast('c')], next: { cursor: 'ignored' } } }))
      .mockResolvedValueOnce(response({ cast: hydrated }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'cast_not_found', message: 'Cast deleted' }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect(await searchCasts({ query: 'hello world', limit: 5 })).toEqual({ casts: [hydrated], next: { cursor: null } });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/cast/search?limit=5&q=hello+world');
    expect(fetch.mock.calls[1][0]).toBe(`/api/v2/farcaster/cast?identifier=${match.hash}&type=hash`);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 404, code: 'upstream_error' }, { status: 400, code: 'cast_not_found' }, { status: 502, code: 'upstream_error' },
  ])('propagates hydration failures rather than returning misleading empty results: %j', async error => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [cast('a')], next: {} } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...error, message: 'Unavailable' }), { status: error.status }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject(error);
  });

  it('rejects a hydrated cast whose author or identity differs from the search hit', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [cast('a')], next: {} } }))
      .mockResolvedValueOnce(response({ cast: cast('a', { author: user(4) }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds hydration to 25 casts and four concurrent reads while preserving ranking', async () => {
    const hits = Array.from({ length: 30 }, (_, index) => cast(index.toString(16).padStart(40, '0').slice(0, 1), { hash: index.toString(16).padStart(40, '0') }));
    let active = 0, maximum = 0;
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/cast/search?')) return response({ result: { casts: hits, next: {} } });
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      const hash = new URL(url, 'https://quorum.arca.computer').searchParams.get('identifier');
      return response({ cast: hits.find(hit => hit.hash === hash) });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await searchCasts({ query: 'hello', limit: 100 });
    expect(result.casts.map(cast => cast.hash)).toEqual(hits.slice(0, 25).map(cast => cast.hash));
    expect(maximum).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(26);
    expect(fetch.mock.calls[0][0]).toContain('limit=25');
  });

  it('cancels in-flight hydration and schedules no later hits after the caller aborts', async () => {
    const hits = ['a', 'b', 'c', 'd', 'e'].map(letter => cast(letter));
    const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes('/cast/search?')) return response({ result: { casts: hits, next: {} } });
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = searchCasts({ query: 'hello', signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.slice(1).every(call => call[1].signal.aborted)).toBe(true);
  });

  it('bounds the complete search and hydration to one 25-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        if (url.includes('/cast/search?')) return response({ result: { casts: [cast('a')], next: {} } });
        return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      });
      vi.stubGlobal('fetch', fetch);
      const pending = searchCasts({ query: 'hello' });
      const assertion = expect(pending).rejects.toMatchObject({ status: 504, code: 'timeout' });
      await vi.advanceTimersByTimeAsync(25_001);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it.each([' ', 'a\nb', '\u0000', '🙂'.repeat(65)])('rejects empty, control-containing or oversized search before fetching: %j', async query => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(searchUsers({ query })).rejects.toThrow('search query');
    await expect(searchCasts({ query })).rejects.toThrow('search query');
    await expect(getChannels({ kind: 'search', query })).rejects.toThrow('search query');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves disabled-index failures instead of showing a successful empty search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'feature_unavailable', message: 'Cast search is not enabled on this Hypersnap node.' }), { status: 503 })));
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject({ status: 503, code: 'feature_unavailable' });
  });

  it('scans profile replies across actual pages, classifies channel roots correctly and never drops overflow', async () => {
    const root = cast('a', { parent_url: 'https://warpcast.com/~/channel/test' });
    const reply = cast('b', { parent_hash: 'c'.repeat(40) });
    const second = cast('d', { parent_hash: 'c'.repeat(40) });
    const fetch = vi.fn().mockResolvedValueOnce(response({ casts: [root, reply], next: { cursor: 'aa' } }))
      .mockResolvedValueOnce(response({ casts: [second], next: { cursor: 'bb' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getProfileFeed({ fid: 3, tab: 'replies', limit: 2 })).toEqual({ casts: [reply, second], next: { cursor: 'bb' } });
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/feed/user/casts?limit=1&cursor=aa&fid=3');
    fetch.mockResolvedValueOnce(response({ casts: [root, reply], next: {} }));
    expect((await getProfileFeed({ fid: 3, tab: 'casts', limit: 2 })).casts).toEqual([root]);
  });

  it('bounds sparse profile scans and preserves a continuation even when no images match', async () => {
    let cursor = 0;
    const fetch = vi.fn().mockImplementation(async () => response({ casts: [cast('a')], next: { cursor: String(++cursor) } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getProfileFeed({ fid: 3, tab: 'media', limit: 20 })).toEqual({ casts: [], next: { cursor: '5' } });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('recognizes our uploaded images and supported image delivery paths without accepting spoofed hostnames', () => {
    for (const url of ['https://quorum.arca.computer/media/' + 'a'.repeat(64), 'https://imagedelivery.net/id/original', 'https://example.com/photo.PNG?size=2']) {
      expect(hasImageEmbed(cast('a', { embeds: [{ url }] }))).toBe(true);
    }
    for (const url of ['https://imagedelivery.net.attacker.test/id/original', 'https://example.com/imagedelivery.net', 'javascript:photo.png', 'https://example.com/page']) {
      expect(hasImageEmbed(cast('a', { embeds: [{ url }] }))).toBe(false);
    }
  });

  it('normalizes activity honestly when the node collapses recasts into likes and mentions into replies', async () => {
    const target = cast('a');
    const reply = cast('b', { parent_hash: target.hash, parent_author: { fid: 7 } });
    const mention = cast('c', { mentioned_profiles: [user(7)] });
    const timestamp = '2026-10-19T12:00:00.000Z';
    const rows = [
      { type: 'likes', user: user(3), cast: target, timestamp },
      { type: 'follows', user: user(4), cast: null, timestamp },
      { type: 'reply', user: user(3), cast: reply, timestamp },
      { type: 'reply', user: user(3), cast: mention, timestamp },
    ];
    const fetch = vi.fn().mockResolvedValue(response({ notifications: [...rows, rows[0]], next: { cursor: 'abc=' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await getNotifications({ fid: 7, limit: 10 });
    expect(result.notifications.map(item => item.type)).toEqual(['reactions', 'follows', 'replies', 'mentions']);
    expect(result.notifications[0].actors).toEqual([user(3)]);
    expect(result.notifications[2].targetHash).toBe(reply.hash);
    expect(result.next.cursor).toBe('abc=');
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/notifications?limit=10&fid=7');
  });

  it('loads named channels while keeping the real cursor across non-channel parent namespaces', async () => {
    const channel = { id: 'test', name: 'test', url: 'https://warpcast.com/~/channel/test', member_count: 3 };
    const fetch = vi.fn().mockResolvedValueOnce(response({ channels: [{ id: 'eip155:8453/erc20:foo', name: 'token', url: 'eip155:8453/erc20:foo' }, channel], next: { cursor: 'abcd' } }))
      .mockResolvedValueOnce(response({ channel }));
    vi.stubGlobal('fetch', fetch);
    expect(await getChannels({ kind: 'all', limit: 5 })).toEqual({ channels: [channel], next: { cursor: 'abcd' } });
    expect(await getChannel('test')).toEqual(channel);
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/channel?id=test&type=id');
    await expect(getChannels({ kind: 'trending', cursor: 'abc' })).rejects.toThrow('does not support pagination');
    await expect(getChannel('https://attacker.test')).rejects.toThrow('Invalid channel');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a different valid channel ID before a composer can use its destination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ channel: { id: 'different', name: 'different', url: 'https://warpcast.com/~/channel/different' } })));
    await expect(getChannel('test')).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });

  it('rejects malformed search/activity responses and unsafe continuation cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: 'invalid' } }))
      .mockResolvedValueOnce(response({ notifications: [{ type: 'follows', user: user(3), timestamp: 'not-a-date' }], next: {} }))
      .mockResolvedValueOnce(response({ channels: [], next: { cursor: 'https://attacker.test' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toThrow('invalid search');
    await expect(getNotifications({ fid: 3 })).rejects.toThrow('invalid activity');
    await expect(getChannels({ kind: 'all' })).rejects.toThrow('invalid pagination');
  });
  it('loads paginated public follower lists without inventing viewer context', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [{ fid: 3 }], next: { cursor: '10' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollows({ fid: 1234, kind: 'followers', cursor: '5', limit: 10 })).toEqual({ users: [{ fid: 3 }], next: { cursor: '10' } });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/user/followers?limit=10&cursor=5&fid=1234');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
    await expect(getFollows({ fid: 0, kind: 'following' })).rejects.toThrow('ID');
    await expect(getFollows({ fid: 3, kind: 'following', cursor: 'abc' })).rejects.toThrow('cursor');
    await expect(getFollows({ fid: 3, kind: 'following', cursor: '18446744073709551616' })).rejects.toThrow('cursor');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('checks actual follow messages and treats only the specific absence code as false', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 1234, linkBody: { type: 'follow', targetFid: 3 } } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollowStatus(1234, 3)).toBe(true);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'follow_not_found', message: 'Absent' }), { status: 404 }));
    fetch.mockResolvedValueOnce(response({ users: [], next: {} }));
    expect(await getFollowStatus(1234, 3)).toBe(false);
    for (const value of [{ code: 'upstream_error', message: 'Not found' }, { code: 'follow_not_found', message: 'Wrong status' }]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(value), { status: value.code === 'upstream_error' ? 404 : 400 }));
      await expect(getFollowStatus(1234, 3)).rejects.toThrow();
    }
    fetch.mockResolvedValueOnce(response({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 1234, linkBody: { type: 'follow', targetFid: 4 } } }));
    await expect(getFollowStatus(1234, 3)).rejects.toThrow('invalid follow relationship');
  });

  it('finds compact-state follows with a single effective-index seek and honors removals', async () => {
    const absent = () => new Response(JSON.stringify({ code: 'follow_not_found' }), { status: 404 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 3 }], next: { cursor: '3' } }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 8 }], next: {} }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollowStatus(1234, 3)).toBe(true);
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/user/following?limit=1&cursor=2&fid=1234');
    expect(await getFollowStatus(1234, 3)).toBe(false);
    expect(await getFollowStatus(1234, 1)).toBe(false);
    expect(fetch.mock.calls[5][0]).toContain('cursor=0');
  });

  it('keeps compact follow state unknown when the effective index fails or violates its seek', async () => {
    const absent = () => new Response(JSON.stringify({ code: 'follow_not_found' }), { status: 404 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 2 }], next: {} }));
    vi.stubGlobal('fetch', fetch);
    await expect(getFollowStatus(1234, 3)).rejects.toMatchObject({ status: 503 });
    await expect(getFollowStatus(1234, 3)).rejects.toThrow('invalid follow relationship');
  });

  it('rejects malformed follow pages and stops repeated cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ users: [], next: { cursor: '10' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await getFollows({ fid: 3, kind: 'following', cursor: '10' })).next.cursor).toBeNull();
    fetch.mockResolvedValueOnce(response({ users: [{ fid: -1 }], next: {} }));
    await expect(getFollows({ fid: 3, kind: 'following' })).rejects.toThrow('invalid follow list');
    fetch.mockResolvedValueOnce(response({ users: [], next: { cursor: 'https://example.com' } }));
    await expect(getFollows({ fid: 3, kind: 'following' })).rejects.toThrow('invalid follow cursor');
  });
  it('uses same-origin feeds with bounded pagination and no credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ casts: [], next: { cursor: '2' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await getFeed({ kind: 'following', fid: 3, limit: 10, cursor: '1' });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/feed/following?limit=10&cursor=1&fid=3');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
    expect(result.next.cursor).toBe('2');
  });

  it('looks up custody addresses without submitting recovery material', async () => {
    const user = { fid: 3, username: 'alice' };
    const fetch = vi.fn().mockResolvedValue(response({ user }));
    vi.stubGlobal('fetch', fetch);
    expect(await getUser({ custodyAddress: `0x${'a'.repeat(40)}` })).toEqual(user);
    expect(fetch.mock.calls[0][0]).toBe(`/api/v2/farcaster/user/custody-address?custody_address=0x${'a'.repeat(40)}`);
  });

  it('normalizes the real nested conversation wire shape', async () => {
    const root = { hash: 'a'.repeat(40), text: 'root' } as Cast;
    const reply = { hash: 'b'.repeat(40), text: 'reply' } as Cast;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ conversation: { cast: { ...root, direct_replies: [{ ...reply, direct_replies: [] }] } } })));
    expect(await getConversation(root.hash)).toEqual({ cast: root, replies: [{ cast: reply, replies: [] }] });
  });

  it('continues signer pagination instead of treating an incomplete page as absence', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ signers: [{ key: 'a' }], currentUserNonce: 3, nextPageToken: 'YWJj' }))
      .mockResolvedValueOnce(response({ signers: [{ key: 'b' }], currentUserNonce: 3 }));
    vi.stubGlobal('fetch', fetch);
    expect((await getSigners(3)).signers.map(signer => signer.key)).toEqual(['a', 'b']);
    expect(fetch.mock.calls[0][0]).toContain('requesterFids%5B0%5D=3');
    expect(fetch.mock.calls[1][0]).toContain('pageToken=YWJj');
  });

  it('submits the binary payload once and never retries an uncertain write', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network connection lost'));
    vi.stubGlobal('fetch', fetch);
    await expect(submitMessage(new Uint8Array([8, 1, 16, 3]))).rejects.toThrow('Submission status is unknown. Check your profile or signer state before trying again.');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/submitMessage');
    expect(new Uint8Array(options.body)).toEqual(new Uint8Array([8, 1, 16, 3]));
  });

  it.each(['5b6e756c6c5d', '5b6e756c6c2c6e756c6c5d', '5b6e756c6c2c6e756c6c2c6e756c6c5d', 'previous'])('stops exhausted or non-advancing feed cursors: %s', async cursor => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ casts: [], next: { cursor } })));
    const feed = await getFeed({ kind: 'channel', channel: 'quilibrium', cursor: 'previous' });
    expect(feed.next.cursor).toBeNull();
  });

  it('merges and sorts complete channel shard batches without truncating unseen casts', async () => {
    const newer = cast('b', { timestamp: '2026-10-19T13:00:00Z' });
    const older = cast('a');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ casts: [older, newer, { ...newer, hash: `0x${newer.hash}` }], next: { cursor: 'abcd' } })));
    const feed = await getFeed({ kind: 'channel', channel: 'test', limit: 1 });
    expect(feed.casts.map(value => value.hash.replace(/^0x/, ''))).toEqual([newer.hash, older.hash]);
    expect(feed.next.cursor).toBe('abcd');
  });

  it('propagates cancellation to an in-flight read', async () => {
    const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = getFeed({ kind: 'trending', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });
});
