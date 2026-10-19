/** Fixed-origin, bounded gateway. Custody secrets stay in the user's wallet;
 * this worker accepts public queries or signed wire bytes.
 */
import { handleMediaRequest, type MediaEnv } from './media';
export { MediaUploadQuota } from './media';
export interface Env extends MediaEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const UPSTREAM = 'https://haatz.quilibrium.com';
const MAX_MESSAGE_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const SUBMISSION_UNKNOWN = 'Submission status is unknown. Check your profile or signer state before trying again.';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' wss://relay.walletconnect.org wss://relay.walletconnect.com https://verify.walletconnect.org https://verify.walletconnect.com; frame-src https://verify.walletconnect.org https://verify.walletconnect.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // Neither data responses nor the HTML used to unlock a wallet may be cached.
  if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return secure(new Response(JSON.stringify(value), { status, headers }));
}

function failure(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}

type Rule = (value: string) => boolean;
type QueryRules = Record<string, Rule>;
const integer = (max: number, min = 1): Rule => value => /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const fid = integer(Number.MAX_SAFE_INTEGER);
const address: Rule = value => /^0x[a-fA-F0-9]{40}$/.test(value);
const hash: Rule = value => /^(?:0x)?[a-fA-F0-9]{40}$/.test(value);
const username: Rule = value => /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
const channel: Rule = value => /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const cursor: Rule = value => /^[a-zA-Z0-9_+/=:-]{1,2048}$/.test(value);
const pagination: QueryRules = { limit: integer(100), cursor };
const followPagination: QueryRules = { limit: integer(100), cursor: value => /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn };

interface Endpoint { required?: string[]; query: QueryRules }
const READ_ENDPOINTS: Record<string, Endpoint> = {
  '/v1/info': { query: {} },
  '/v1/signersByFid': { required: ['fid'], query: { fid, pageSize: integer(1000), pageToken: cursor, 'requesterFids[0]': fid } },
  '/v1/onChainIdRegistryEventByAddress': { required: ['address'], query: { address } },
  '/v1/linkById': { required: ['fid', 'link_type', 'target_fid'], query: { fid, link_type: value => value === 'follow', target_fid: fid } },
  '/v2/farcaster/user': { required: ['fid'], query: { fid } },
  '/v2/farcaster/user/by-username': { required: ['username'], query: { username } },
  '/v2/farcaster/user/custody-address': { required: ['custody_address'], query: { custody_address: address } },
  '/v2/farcaster/user/followers': { required: ['fid'], query: { ...followPagination, fid } },
  '/v2/farcaster/user/following': { required: ['fid'], query: { ...followPagination, fid } },
  '/v2/farcaster/feed/trending': { query: pagination },
  '/v2/farcaster/feed/following': { required: ['fid'], query: { ...pagination, fid } },
  '/v2/farcaster/feed/user/casts': { required: ['fid'], query: { ...pagination, fid } },
  '/v2/farcaster/feed/channels': { required: ['channel_ids'], query: { ...pagination, channel_ids: channel } },
  '/v2/farcaster/cast': { required: ['identifier'], query: { identifier: hash, type: value => value === 'hash', fid } },
  '/v2/farcaster/cast/conversation': { required: ['identifier', 'type'], query: { identifier: hash, type: value => value === 'hash', reply_depth: integer(3, 0) } },
};

function validQuery(params: URLSearchParams, endpoint: Endpoint): boolean {
  const seen = new Set<string>();
  for (const [name, value] of params) {
    const rule = endpoint.query[name];
    if (seen.has(name) || !rule || !rule(value)) return false;
    seen.add(name);
  }
  return (endpoint.required ?? []).every(name => seen.has(name));
}

class SizeLimitError extends Error {}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new SizeLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function proxy(request: Request, url: URL): Promise<Response> {
  // The path never controls the destination host. Encoded path separators,
  // alternate authorities, duplicate query keys and unknown fields are rejected.
  if (url.pathname.includes('%') || url.pathname.includes('\\')) return failure(400, 'invalid_path', 'Invalid API path.');
  const path = url.pathname.slice('/api'.length);
  const isWrite = path === '/v1/submitMessage';
  const endpoint = READ_ENDPOINTS[path];
  if (!endpoint && !isWrite) return failure(404, 'not_found', 'This API route is unavailable.');
  if (request.method !== (isWrite ? 'POST' : 'GET')) return failure(405, 'method_not_allowed', 'This method is unavailable.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure(403, 'origin_denied', 'Cross-site API requests are unavailable.');
  if (isWrite ? url.search !== '' : !validQuery(url.searchParams, endpoint)) return failure(400, 'invalid_query', 'Invalid API query.');

  let body: Uint8Array | undefined;
  if (isWrite) {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') return failure(415, 'invalid_content_type', 'Submit a signed binary Farcaster message.');
    const declaredLength = request.headers.get('Content-Length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_MESSAGE_BYTES)) return failure(413, 'message_too_large', 'Signed message exceeds 64 KiB.');
    try {
      body = await readLimited(request.body, MAX_MESSAGE_BYTES);
    } catch {
      return failure(413, 'message_too_large', 'Signed message exceeds 64 KiB.');
    }
    if (!body.byteLength) return failure(400, 'empty_message', 'A signed message is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (isWrite) headers.set('Content-Type', 'application/octet-stream');
    const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, {
      method: request.method,
      headers,
      body: body ? new Uint8Array(body).buffer : undefined,
      // Workers supports manual/follow only. A 3xx is rejected below without
      // following it, so the destination remains the fixed public node.
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!upstream.ok) {
      // Hypersnap's v1 HTTP adapter reports every gRPC error as HTTP 400.
      // Only this exact NotFound result means an absent follow; network,
      // validation, and storage failures must never appear as "not following".
      if (path === '/v1/linkById' && upstream.status === 400 && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to get link'
          && 'error_detail' in value && typeof value.error_detail === 'string' && value.error_detail.startsWith('status: NotFound,')) {
          return failure(404, 'follow_not_found', 'This follow relationship does not exist.');
        }
      }
      await upstream.body?.cancel();
      const status = [400, 401, 403, 404, 409, 422, 429].includes(upstream.status) ? upstream.status : 502;
      const messages: Record<number, string> = {
        400: isWrite ? 'The node rejected this signed message. Check your signer and try again.' : 'The node rejected this request.',
        401: 'The node could not authenticate this signed message.',
        403: 'The node did not authorize this request.',
        404: 'This profile or cast was not found on the node.',
        409: 'The node reported a conflict. Refresh and try again.',
        422: 'The node could not validate this signed message.',
        429: 'The node is busy. Wait a moment before trying again.',
        502: isWrite ? SUBMISSION_UNKNOWN : 'The Hypersnap node is temporarily unavailable. Try again.',
      };
      return failure(status, status === 429 ? 'rate_limited' : isWrite && status >= 500 ? 'submission_unknown' : 'upstream_error', messages[status]);
    }
    if (!upstream.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      await upstream.body?.cancel();
      return failure(502, isWrite ? 'submission_unknown' : 'invalid_response', isWrite ? SUBMISSION_UNKNOWN : 'The node returned an invalid response.');
    }
    const bytes = await readLimited(upstream.body, MAX_RESPONSE_BYTES);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(502, isWrite ? 'submission_unknown' : 'invalid_response', isWrite ? SUBMISSION_UNKNOWN : 'The node returned an invalid response.');
    return json(value);
  } catch (error) {
    if (isWrite) return failure(controller.signal.aborted ? 504 : 502, 'submission_unknown', SUBMISSION_UNKNOWN);
    if (controller.signal.aborted) return failure(504, 'timeout', 'The Hypersnap node took too long to respond. Try again.');
    if (error instanceof SizeLimitError) return failure(502, 'response_too_large', 'The node returned too much data. Try a smaller page.');
    return failure(502, 'upstream_unavailable', 'The Hypersnap node is temporarily unavailable. Try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/media' || url.pathname.startsWith('/media/')) return handleMediaRequest(request, env);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(request, url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'method_not_allowed', 'This method is unavailable.');
  return secure(await env.ASSETS.fetch(request));
}

export default { fetch: handleRequest };
