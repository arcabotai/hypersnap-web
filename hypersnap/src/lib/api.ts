/** The deliberately small portion of Hypersnap's public API used by this client.
 * Field names follow the node's wire format (src/api/types.rs upstream).
 * Mobile clients can reuse this module; it has no dependency on the Quorum relay.
 */
export interface User {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
  custody_address: string;
  registered_at?: string;
  profile: { bio: { text: string }; banner?: { url?: string } };
  follower_count: number;
  following_count: number;
  verified_addresses?: { eth_addresses: string[]; sol_addresses: string[] };
  viewer_context?: { following: boolean; followed_by: boolean };
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  parent_url?: string;
  image_url?: string;
  description?: string;
  follower_count?: number;
}

export interface Cast {
  hash: string;
  author: User;
  text: string;
  timestamp: string;
  parent_hash?: string;
  parent_url?: string;
  root_parent_url?: string;
  parent_author?: { fid?: number | null };
  embeds: Array<{ url: string } | { cast_id: { fid: number; hash: string } }>;
  reactions: { likes_count: number; recasts_count: number };
  replies: { count: number };
  mentioned_profiles?: User[];
  mentioned_profiles_ranges?: Array<{ start: number; end: number }>;
  channel?: Channel;
  viewer_context?: { liked: boolean; recasted: boolean };
}

export interface FeedResponse {
  casts: Cast[];
  next: { cursor?: string | null };
}

export interface FollowsResponse { users: User[]; next: { cursor?: string | null } }

export interface ConversationNode {
  cast: Cast;
  replies: ConversationNode[];
}

export interface Signer {
  key: string;
  fid?: number;
  source?: string;
  expiresAt?: number;
  scopes?: string[];
  requestFid?: number;
  nonce?: number;
}

export interface SignersResponse {
  signers: Signer[];
  currentUserNonce: number;
  gaslessSignerCount?: number;
  gaslessSignerLimit?: number;
  requesterFidNonces?: Record<string, number>;
  nextPageToken?: string;
}

export interface NodeInfo {
  [key: string]: unknown;
  version: string;
  numShards?: number;
  peer_id?: string;
  dbStats?: { numMessages: number; numFidRegistrations: number; approxSize: number };
  shardInfos?: Array<{ shardId?: number; numMessages?: number; blockDelay?: number }>;
}

export interface SubmitMessageResponse {
  hash?: string;
  data?: { fid?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = 'api_error') {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 25_000;
const SUBMISSION_UNKNOWN = 'Submission status is unknown. Check your profile or signer state before trying again.';
const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function fidValue(fid: number | undefined): string {
  if (!Number.isSafeInteger(fid) || Number(fid) < 1) throw new Error('Enter a valid Farcaster ID.');
  return String(fid);
}

function hashValue(hash: string): string {
  if (!HASH.test(hash)) throw new Error('Invalid cast hash.');
  return hash.replace(/^0x/, '').toLowerCase();
}

function addressValue(address: string): string {
  if (!ADDRESS.test(address)) throw new Error('Invalid wallet address.');
  return address;
}

function pageParams(cursor?: string | null, limit = 20): URLSearchParams {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Feed limit must be between 1 and 100.');
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    if (!/^[a-zA-Z0-9_+/=:-]{1,2048}$/.test(cursor)) throw new Error('Invalid pagination cursor.');
    params.set('cursor', cursor);
  }
  return params;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function requestJson<T>(path: string, params?: URLSearchParams, signal?: AbortSignal, body?: Uint8Array): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const query = params?.toString();
    const response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: body ? new Uint8Array(body).buffer : undefined,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // The local worker supplies bounded, non-sensitive errors. Never surface
      // arbitrary HTML or an upstream response that may echo submitted data.
      const code = isObject(result) && typeof result.code === 'string' ? result.code : 'api_error';
      const message = isObject(result) && typeof result.message === 'string'
        ? result.message.slice(0, 240)
        : `The node returned HTTP ${response.status}.`;
      throw new ApiError(message, response.status, code);
    }
    if (!isObject(result)) throw new ApiError('The node returned an invalid response.', 502, 'invalid_response');
    return result as T;
  } catch (error) {
    if (body && !(error instanceof ApiError && error.status < 500)) {
      throw new ApiError(SUBMISSION_UNKNOWN, error instanceof ApiError ? error.status : 502, 'submission_unknown');
    }
    if (controller.signal.aborted && !signal?.aborted) throw new ApiError('The node took too long to respond. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export interface FeedOptions {
  kind: 'trending' | 'following' | 'channel' | 'user';
  fid?: number;
  channel?: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export async function getFeed(options: FeedOptions): Promise<FeedResponse> {
  const params = pageParams(options.cursor, options.limit);
  let path: string;
  switch (options.kind) {
    case 'following':
      path = '/v2/farcaster/feed/following';
      params.set('fid', fidValue(options.fid));
      break;
    case 'user':
      path = '/v2/farcaster/feed/user/casts';
      params.set('fid', fidValue(options.fid));
      break;
    case 'channel':
      if (!options.channel || !/^[a-zA-Z0-9_-]{1,64}$/.test(options.channel)) throw new Error('Invalid channel.');
      path = '/v2/farcaster/feed/channels';
      params.set('channel_ids', options.channel);
      break;
    default:
      path = '/v2/farcaster/feed/trending';
  }
  const response = await requestJson<FeedResponse>(path, params, options.signal);
  if (!Array.isArray(response.casts)) throw new ApiError('The node returned an invalid feed.', 502, 'invalid_response');
  const next = response.next?.cursor;
  // The current node can emit the exhausted dual-index token `[null,null]`.
  // Also stop a repeated cursor instead of presenting an endless More button.
  return { casts: response.casts, next: { cursor: next === options.cursor || next === '5b6e756c6c2c6e756c6c5d' ? null : next } };
}

export async function getUser(lookup: { fid?: number; username?: string; custodyAddress?: string }, signal?: AbortSignal): Promise<User> {
  if (Object.values(lookup).filter(value => value !== undefined).length !== 1) throw new Error('Use one profile identifier.');
  let path = '/v2/farcaster/user';
  const params = new URLSearchParams();
  if (lookup.custodyAddress !== undefined) {
    path += '/custody-address';
    params.set('custody_address', addressValue(lookup.custodyAddress));
  } else if (lookup.username !== undefined) {
    const username = lookup.username.replace(/^@/, '');
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(username)) throw new Error('Enter a valid Farcaster username.');
    path += '/by-username';
    params.set('username', username);
  } else {
    params.set('fid', fidValue(lookup.fid));
  }
  const response = await requestJson<{ user: User }>(path, params, signal);
  if (!isObject(response.user) || !Number.isSafeInteger(response.user.fid)) throw new ApiError('The node returned an invalid profile.', 502, 'invalid_response');
  return response.user;
}

/** Public social graph data; a wallet connection is not API authentication. */
export async function getFollows(options: { fid: number; kind: 'followers' | 'following'; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FollowsResponse> {
  if (options.kind !== 'followers' && options.kind !== 'following') throw new Error('Invalid follow list.');
  const validCursor = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
  if (options.cursor && !validCursor(options.cursor)) throw new Error('Invalid follow pagination cursor.');
  const params = pageParams(options.cursor, options.limit);
  params.set('fid', fidValue(options.fid));
  const response = await requestJson<FollowsResponse>(`/v2/farcaster/user/${options.kind}`, params, options.signal);
  if (!Array.isArray(response.users) || response.users.some(user => !isObject(user) || !Number.isSafeInteger(user.fid) || user.fid < 1)) throw new ApiError('The node returned an invalid follow list.', 502, 'invalid_response');
  const next = response.next?.cursor;
  if (next !== undefined && next !== null && !validCursor(next)) throw new ApiError('The node returned an invalid follow cursor.', 502, 'invalid_response');
  return { users: response.users, next: { cursor: next === options.cursor ? null : next } };
}

export async function getFollowStatus(viewerFid: number, targetFid: number, signal?: AbortSignal): Promise<boolean> {
  const params = new URLSearchParams({ fid: fidValue(viewerFid), link_type: 'follow', target_fid: fidValue(targetFid) });
  try {
    const result = await requestJson<{ data?: { type?: string; fid?: number; linkBody?: { type?: string; targetFid?: number } } }>('/v1/linkById', params, signal);
    if (result.data?.type !== 'MESSAGE_TYPE_LINK_ADD' || result.data.fid !== viewerFid || result.data.linkBody?.type !== 'follow' || result.data.linkBody.targetFid !== targetFid) throw new ApiError('The node returned an invalid follow relationship.', 502, 'invalid_response');
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === 'follow_not_found') return false;
    throw error;
  }
}

export async function getCast(hash: string, signal?: AbortSignal): Promise<Cast> {
  const response = await requestJson<{ cast: Cast }>('/v2/farcaster/cast', new URLSearchParams({ identifier: hashValue(hash), type: 'hash' }), signal);
  if (!isObject(response.cast)) throw new ApiError('The cast could not be loaded.', 502, 'invalid_response');
  return response.cast;
}

export async function getConversation(hash: string, signal?: AbortSignal): Promise<ConversationNode> {
  type NestedCast = Cast & { direct_replies?: NestedCast[] };
  const response = await requestJson<{ conversation?: { cast?: NestedCast }; cast?: Cast; replies?: ConversationNode[] }>(
    '/v2/farcaster/cast/conversation',
    new URLSearchParams({ identifier: hashValue(hash), type: 'hash', reply_depth: '2' }),
    signal,
  );
  const normalize = (cast: NestedCast, depth = 0): ConversationNode => {
    const { direct_replies, ...plainCast } = cast;
    return { cast: plainCast, replies: depth < 5 && Array.isArray(direct_replies) ? direct_replies.map(reply => normalize(reply, depth + 1)) : [] };
  };
  if (response.conversation?.cast) return normalize(response.conversation.cast);
  if (response.cast) return { cast: response.cast, replies: response.replies ?? [] };
  throw new ApiError('The node returned an invalid conversation.', 502, 'invalid_response');
}

export function getInfo(signal?: AbortSignal): Promise<NodeInfo> {
  return requestJson('/v1/info', undefined, signal);
}

export async function getSigners(fid: number, signal?: AbortSignal): Promise<SignersResponse> {
  // Rust's query decoder expects an indexed sequence, not a scalar string.
  const params = new URLSearchParams({ fid: fidValue(fid), pageSize: '1000', 'requesterFids[0]': String(fid) });
  const result = await requestJson<SignersResponse>('/v1/signersByFid', params, signal);
  if (!Array.isArray(result.signers) || !Number.isSafeInteger(result.currentUserNonce)) throw new ApiError('The node returned invalid signer state.', 502, 'invalid_response');
  // Do not mistake a truncated active signer list for a missing signer.
  const seenTokens = new Set<string>();
  while (result.nextPageToken) {
    if (result.signers.length >= 10_000 || seenTokens.size >= 10) throw new ApiError('This account has too many signers to inspect safely.', 502, 'signer_limit');
    if (seenTokens.has(result.nextPageToken)) throw new ApiError('The node returned invalid signer pagination.', 502, 'invalid_response');
    seenTokens.add(result.nextPageToken);
    params.set('pageToken', result.nextPageToken);
    const page = await requestJson<SignersResponse>('/v1/signersByFid', params, signal);
    if (!Array.isArray(page.signers) || page.nextPageToken === result.nextPageToken) throw new ApiError('The node returned invalid signer pagination.', 502, 'invalid_response');
    result.signers.push(...page.signers);
    result.nextPageToken = page.nextPageToken;
  }
  return result;
}

export function getCustodyEvents(address: string, signal?: AbortSignal): Promise<{ fid: number; [key: string]: unknown }> {
  return requestJson('/v1/onChainIdRegistryEventByAddress', new URLSearchParams({ address: addressValue(address) }), signal);
}

export function submitMessage(bytes: Uint8Array, signal?: AbortSignal): Promise<SubmitMessageResponse> {
  if (bytes.byteLength < 1 || bytes.byteLength > 65_536) throw new Error('Signed message must be between 1 byte and 64 KiB.');
  return requestJson('/v1/submitMessage', undefined, signal, bytes);
}
