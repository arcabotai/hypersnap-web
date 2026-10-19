import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';

const BASE = 'https://quorum.arca.computer';
const env: Env = {
  ASSETS: { fetch: async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }) },
};
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the fixed Hypersnap gateway', () => {
  it('forwards only bounded public follow reads to the existing Hypersnap node', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ users: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    for (const kind of ['followers', 'following']) expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster/user/${kind}?fid=1234&limit=20`), env)).status).toBe(200);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://haatz.quilibrium.com/v2/farcaster/user/followers?fid=1234&limit=20', 'https://haatz.quilibrium.com/v2/farcaster/user/following?fid=1234&limit=20']);
    for (const query of ['fid=1234&target_fid=3&link_type=block', 'fid=1234&link_type=follow', 'fid=0&target_fid=3&link_type=follow']) {
      expect((await handleRequest(new Request(`${BASE}/api/v1/linkById?${query}`), env)).status).toBe(400);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const cursor of ['abc', '18446744073709551616']) expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster/user/following?fid=1234&cursor=${cursor}`), env)).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('normalizes only the verified v1 follow NotFound response without echoing upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to get link', error_detail: 'status: NotFound, message: "cast not found", details: []' }, 400)));
    const response = await handleRequest(new Request(`${BASE}/api/v1/linkById?fid=1234&target_fid=3&link_type=follow`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'follow_not_found', message: 'This follow relationship does not exist.' });
  });

  it('does not present validation or storage failures as an absent follow', async () => {
    for (const error of [{ error: 'Failed to get link', error_detail: 'status: Internal, message: db failure' }, { error: 'Other failure', error_detail: 'status: NotFound, message: wrong endpoint' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(error, 400)));
      const response = await handleRequest(new Request(`${BASE}/api/v1/linkById?fid=1234&target_fid=3&link_type=follow`), env);
      expect(response.status).toBe(400);
      expect((await response.json() as { code: string }).code).toBe('upstream_error');
    }
  });
  it('forwards only an allowlisted read to the fixed node and drops credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ casts: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=20`, {
      headers: { Cookie: 'private-session', Authorization: 'secret' },
    }), env);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://haatz.quilibrium.com/v2/farcaster/feed/trending?limit=20');
    expect(options.headers.get('Authorization')).toBeNull();
    expect(options.headers.get('Cookie')).toBeNull();
    expect(options.redirect).toBe('manual');
    expect(options.cache).toBe('no-store');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects upstream redirects without following their destination', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(response.headers.get('Location')).toBeNull();
  });

  it.each([
    '/api/https://attacker.example/',
    '/api/v1/submitBulkMessages',
    '/api/v2/farcaster/feed/trending?url=https://attacker.example',
    '/api/v2/farcaster/feed/trending?limit=1&limit=100',
    '/api/v2/farcaster/feed/trending?limit=100000',
    '/api/v2/farcaster/user?fid=-1',
    '/api/v2/farcaster/user?fid=3&seed=never-send-this',
    '/api/v2/farcaster/cast?identifier=https://attacker.example&type=url',
    '/api/v2/farcaster/feed/channels?channel_ids=https://attacker.example',
    '/api/v2%2ffarcaster/user?fid=3',
    '/api/v1/signersByFid?fid=3&requesterFids=3',
  ])('rejects unexpected paths and queries before any upstream fetch: %s', async path => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}${path}`), env);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts indexed signer-nonce parameters understood by the node', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ signers: [], currentUserNonce: 0 }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/signersByFid?fid=3&pageSize=1000&requesterFids%5B0%5D=3`), env);
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/signersByFid?fid=3&pageSize=1000&requesterFids%5B0%5D=3');
  });

  it('rejects cross-site signed-message submission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://attacker.example' }, body: new Uint8Array([1, 2]),
    }), env);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'POST', path: '/v2/farcaster/user?fid=3', contentType: 'application/json', body: '{}' },
    { method: 'GET', path: '/v1/submitMessage', contentType: 'application/octet-stream', body: undefined },
    { method: 'POST', path: '/v1/submitMessage', contentType: 'application/json', body: '{"seed":"never-submit"}' },
    { method: 'POST', path: '/v1/submitMessage?upstream=other', contentType: 'application/octet-stream', body: 'bytes' },
  ])('rejects unsupported methods, write queries and JSON bodies', async test => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api${test.path}`, {
      method: test.method, headers: { 'Content-Type': test.contentType }, body: test.body,
    }), env);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces the binary size limit even without a Content-Length header', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(65_537),
    }), env);
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards the exact signed bytes once, without caching the write', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ hash: 'abc' }));
    vi.stubGlobal('fetch', fetch);
    const body = new Uint8Array([8, 1, 18, 2, 255, 0]);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: BASE }, body,
    }), env);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://haatz.quilibrium.com/v1/submitMessage');
    expect(new Uint8Array(options.body)).toEqual(body);
    expect(options.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not echo upstream errors or forwarded content', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'private echoed payload <script>bad()</script>' }, 400));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/user?fid=3`), env);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private echoed payload');
  });

  it('marks failed write transport as uncertain instead of recommending a blind retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Connection lost after submission'));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]),
    }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'submission_unknown', message: 'Submission status is unknown. Check your profile or signer state before trying again.' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds unexpectedly large upstream responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(502);
    expect((await response.json() as { code: string }).code).toBe('response_too_large');
  });

  it('aborts a slow node and returns a controlled timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = handleRequest(new Request(`${BASE}/api/v1/info`), env);
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending;
    expect(response.status).toBe(504);
  });

  it('sets a restrictive CSP and no-referrer policy on the wallet HTML', async () => {
    const response = await handleRequest(new Request(BASE), env);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('wss://relay.walletconnect.org');
    expect(csp).toContain('frame-src https://verify.walletconnect.org https://verify.walletconnect.com;');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('pulse.walletconnect');
    expect(csp).not.toMatch(/(?:connect-src|frame-src)[^;]*\*/);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
