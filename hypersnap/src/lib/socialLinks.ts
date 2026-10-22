import { castAliasPath, castPath, parseRoute, routePath } from './navigation';

// Platform-independent migration candidate for a future shared Hypersnap client.
const SOURCE_AUTHORITY = /^(?:www\.)?(?:farcaster\.xyz|warpcast\.com)(?::443)?$/i;
const RAW_HTTPS_URL = /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i;

/** Recognize public Farcaster links without resolving or normalizing their URL.
 * Call with the original text: URL constructors can erase hostile dot segments.
 * Unsupported links retain their existing external behavior at the call site.
 */
export function quorumSocialPath(value: string): string | undefined {
  if (/[\s\p{Cc}\\]/u.test(value)) return;
  const source = RAW_HTTPS_URL.exec(value);
  if (!source || !SOURCE_AUTHORITY.test(source[1])) return;
  let path = source[2] ?? '/';
  if (path.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return;
  if (path.endsWith('/')) path = path.slice(0, -1);
  // Farcaster's Conversation.tsx uses this full-hash fallback for a cast
  // without a username. A short hash here has no author scope and is unsafe.
  const conversation = /^\/~\/conversations\/(0x[a-fA-F0-9]{40})$/.exec(path);
  if (conversation) return castPath(conversation[1]);
  const segments = path.split('/');
  const route = parseRoute({ pathname: path, search: '' });
  if (segments.length === 2 && route.kind === 'profile' && route.identifier) return routePath(route);
  if (segments.length === 3 && route.kind === 'cast-alias') return castAliasPath(route.authorIdentifier, route.hashPrefix);
}
