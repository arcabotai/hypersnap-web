import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConversation, getFeed, getSigners, getUser, submitMessage, type Cast } from './api';

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('browser API client', () => {
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
