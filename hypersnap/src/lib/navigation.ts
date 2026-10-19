// These helpers are platform independent and can move to a shared Hypersnap
// client package when a mobile client needs the same public URL contract.
export type AppRoute =
  | { kind: 'discover' }
  | { kind: 'following' }
  | { kind: 'bookmarks' }
  | { kind: 'channel'; channel: string }
  | { kind: 'profile'; identifier?: string }
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
  if (pathname === '/profile') return { kind: 'profile' };

  const segments = pathname.split('/');
  if (segments.length !== 3) return { kind: 'not-found' };
  const [, kind, identifier] = segments;
  if (kind === 'profile' && validIdentifier(identifier)) return { kind: 'profile', identifier };
  if (kind === 'channel' && CHANNEL.test(identifier)) return { kind: 'channel', channel: identifier };
  if (kind === 'cast') {
    const hash = normalizedHash(identifier);
    if (hash) return { kind: 'cast', hash };
  }
  return { kind: 'not-found' };
}

/** Stable profile links use the FID, so a later username change keeps working. */
export function profilePath(fid: number): string {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid profile FID.');
  return `/profile/${fid}`;
}

export function castPath(hash: string): string {
  const normalized = normalizedHash(hash);
  if (!normalized) throw new Error('Invalid cast hash.');
  return `/cast/${normalized}`;
}

/** Public share links always use our canonical origin, including on previews. */
export function publicUrl(path: string): string {
  if (parseRoute({ pathname: path, search: '' }).kind === 'not-found') throw new Error('Invalid public path.');
  return `${PUBLIC_ORIGIN}${path}`;
}
