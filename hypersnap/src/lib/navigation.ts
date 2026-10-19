// These helpers are platform independent and can move to a shared Hypersnap
// client package when a mobile client needs the same public URL contract.
export type ProfileTab = 'casts' | 'replies' | 'media';
export type SearchKind = 'casts' | 'users';
export type AppRoute =
  | { kind: 'discover' }
  | { kind: 'following' }
  | { kind: 'bookmarks' }
  | { kind: 'notifications' }
  | { kind: 'channels' }
  | { kind: 'search'; query: string; searchKind: SearchKind }
  | { kind: 'channel'; channel: string }
  | { kind: 'profile'; identifier?: string; tab?: ProfileTab }
  | { kind: 'cast'; hash: string }
  | { kind: 'not-found' };

const PUBLIC_ORIGIN = 'https://quorum.arca.computer';
const MAX_PATH_LENGTH = 256;
const MAX_SEARCH_LENGTH = 2048;
const USERNAME = /^[a-zA-Z0-9_.-]{1,128}$/;
const CHANNEL = /^[a-zA-Z0-9_-]{1,64}$/;
const HASH = /^(?:0x)?([a-fA-F0-9]{40})$/;

function normalizedHash(hash: string): string | undefined {
  const match = HASH.exec(hash);
  return match ? `0x${match[1].toLowerCase()}` : undefined;
}

function validIdentifier(identifier: string): boolean {
  if (!USERNAME.test(identifier) || identifier === '.' || identifier === '..') return false;
  if (!/^\d+$/.test(identifier)) return true;
  const fid = Number(identifier);
  return Number.isSafeInteger(fid) && fid > 0;
}

/** Parse only the public client routes; malformed identifiers never reach an API. */
export function parseRoute({ pathname, search }: { pathname: string; search: string }): AppRoute {
  // Route identifiers have an ASCII wire format, so percent escapes are neither
  // needed nor accepted. This also rejects encoded and double-encoded slashes.
  if (pathname.length > MAX_PATH_LENGTH || search.length > MAX_SEARCH_LENGTH
    || !pathname.startsWith('/') || /[%\\?#\s\u0000-\u001f\u007f]/.test(pathname)
    || (search !== '' && !search.startsWith('?')) || /[\u0000-\u001f\u007f]/.test(search)) {
    return { kind: 'not-found' };
  }

  if (pathname === '/') {
    const params = new URLSearchParams(search);
    if (!params.has('cast')) return { kind: 'discover' };
    const hashes = params.getAll('cast');
    const hash = hashes.length === 1 ? normalizedHash(hashes[0]) : undefined;
    return hash ? { kind: 'cast', hash } : { kind: 'not-found' };
  }
  if (pathname === '/following') return { kind: 'following' };
  if (pathname === '/bookmarks') return { kind: 'bookmarks' };
  if (pathname === '/notifications') return { kind: 'notifications' };
  if (pathname === '/channels') return { kind: 'channels' };
  if (pathname === '/search') {
    const params = new URLSearchParams(search);
    const query = params.get('q')?.trim() ?? '';
    const kind = params.get('type') ?? 'casts';
    if (params.getAll('q').length > 1 || params.getAll('type').length > 1 || !['casts', 'users'].includes(kind)
      || new TextEncoder().encode(query).length > 256 || /[\u0000-\u001f\u007f]/.test(query)) return { kind: 'not-found' };
    return { kind: 'search', query, searchKind: kind as SearchKind };
  }
  const tabs = new URLSearchParams(search).getAll('tab');
  const tab = tabs[0];
  const validTab = tabs.length < 2 && (tab === undefined || ['casts', 'replies', 'media'].includes(tab));
  if (pathname === '/profile') return validTab ? { kind: 'profile', ...(tab && tab !== 'casts' ? { tab: tab as ProfileTab } : {}) } : { kind: 'not-found' };

  const segments = pathname.split('/');
  if (segments.length !== 3) return { kind: 'not-found' };
  const [, kind, identifier] = segments;
  if (kind === 'profile' && validIdentifier(identifier) && validTab) return { kind: 'profile', identifier, ...(tab && tab !== 'casts' ? { tab: tab as ProfileTab } : {}) };
  if (kind === 'channel' && CHANNEL.test(identifier)) return { kind: 'channel', channel: identifier };
  if (kind === 'cast') {
    const hash = normalizedHash(identifier);
    if (hash) return { kind: 'cast', hash };
  }
  return { kind: 'not-found' };
}

/** Stable profile links use the FID, so a later username change keeps working. */
export function profilePath(fid: number, tab: ProfileTab = 'casts'): string {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid profile FID.');
  if (!['casts', 'replies', 'media'].includes(tab)) throw new Error('Invalid profile tab.');
  return `/profile/${fid}${tab === 'casts' ? '' : `?tab=${tab}`}`;
}

export function searchPath(query = '', kind: SearchKind = 'casts'): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (kind !== 'casts') params.set('type', kind);
  const path = `/search${params.size ? `?${params}` : ''}`;
  if (parseLocalPath(path).kind !== 'search') throw new Error('Invalid search.');
  return path;
}

/** Only split local route paths; callers never resolve a supplied host. */
export function parseLocalPath(path: string): AppRoute {
  const separator = path.indexOf('?');
  return parseRoute({ pathname: separator < 0 ? path : path.slice(0, separator), search: separator < 0 ? '' : path.slice(separator) });
}

export function routePath(route: AppRoute): string {
  if (route.kind === 'cast') return castPath(route.hash);
  if (route.kind === 'channel') return `/channel/${route.channel}`;
  if (route.kind === 'search') return searchPath(route.query, route.searchKind);
  if (route.kind === 'profile') return `${route.identifier ? `/profile/${route.identifier}` : '/profile'}${route.tab && route.tab !== 'casts' ? `?tab=${route.tab}` : ''}`;
  return route.kind === 'discover' || route.kind === 'not-found' ? '/' : `/${route.kind}`;
}

export function castPath(hash: string): string {
  const normalized = normalizedHash(hash);
  if (!normalized) throw new Error('Invalid cast hash.');
  return `/cast/${normalized}`;
}

/** Public share links always use our canonical origin, including on previews. */
export function publicUrl(path: string): string {
  if (parseLocalPath(path).kind === 'not-found') throw new Error('Invalid public path.');
  return `${PUBLIC_ORIGIN}${path}`;
}
