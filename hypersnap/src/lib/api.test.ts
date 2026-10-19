import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConversation, getFeed, getFollows, getFollowStatus, getSigners, getUser, submitMessage, type Cast } from './api';

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('browser API client', () => {
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
    expect(await getFollowStatus(1234, 3)).toBe(false);
    for (const value of [{ code: 'upstream_error', message: 'Not found' }, { code: 'follow_not_found', message: 'Wrong status' }]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(value), { status: value.code === 'upstream_error' ? 404 : 400 }));
      await expect(getFollowStatus(1234, 3)).rejects.toThrow();
    }
    fetch.mockResolvedValueOnce(response({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 1234, linkBody: { type: 'follow', targetFid: 4 } } }));
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

  it.each(['5b6e756c6c2c6e756c6c5d', 'previous'])('stops exhausted or non-advancing feed cursors: %s', async cursor => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ casts: [], next: { cursor } })));
    const feed = await getFeed({ kind: 'channel', channel: 'quilibrium', cursor: 'previous' });
    expect(feed.next.cursor).toBeNull();
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
