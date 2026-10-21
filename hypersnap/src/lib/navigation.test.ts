import { describe, expect, it } from 'vitest';
import { castPath, parseRoute, profilePath, publicUrl, routePath, searchPath, parseLocalPath, connectReturnPath } from './navigation';

const hash = '0x0123456789abcdef0123456789abcdef01234567';
const route = (pathname: string, search = '') => parseRoute({ pathname, search });

describe('public Hypersnap routes', () => {
  it('distinguishes feed and own-profile routes', () => {
    expect(route('/')).toEqual({ kind: 'discover' });
    expect(route('/following')).toEqual({ kind: 'following' });
    expect(route('/bookmarks')).toEqual({ kind: 'bookmarks' });
    expect(route('/profile')).toEqual({ kind: 'profile' });
    expect(route('/connect')).toEqual({ kind: 'connect' });
  });

  it('accepts bounded usernames and positive safe FIDs without looking them up', () => {
    for (const identifier of ['1234', String(Number.MAX_SAFE_INTEGER), 'alice', 'alice.eth', 'alice-base_1']) {
      expect(route(`/profile/${identifier}`)).toEqual({ kind: 'profile', identifier });
    }
    expect(route(`/profile/${'a'.repeat(128)}`).kind).toBe('profile');
  });

  it('requires full cast hashes and normalizes uppercase hex and an optional 0x prefix', () => {
    expect(route(`/cast/${hash}`)).toEqual({ kind: 'cast', hash });
    expect(route(`/cast/${hash.slice(2).toUpperCase()}`)).toEqual({ kind: 'cast', hash });
  });

  it('preserves old shared cast links while rejecting ambiguous or invalid legacy hashes', () => {
    expect(route('/', `?cast=${hash}`)).toEqual({ kind: 'cast', hash });
    expect(route('/', `?utm_source=share&cast=${hash.slice(2).toUpperCase()}`)).toEqual({ kind: 'cast', hash });
    for (const search of ['?cast=', '?cast=0x1234', `?cast=${hash}&cast=${hash}`, '?cast=%2f', '?cast=%']) {
      expect(route('/', search)).toEqual({ kind: 'not-found' });
    }
    // A query on another route must not replace its explicit path target.
    expect(route('/profile/1234', `?cast=${hash}`)).toEqual({ kind: 'profile', identifier: '1234' });
  });

  it('supports the same bounded channel identifiers as the Hypersnap API', () => {
    for (const channel of ['quilibrium', 'art_2026', 'client-dev', 'A'.repeat(64)]) {
      expect(route(`/channel/${channel}`)).toEqual({ kind: 'channel', channel });
    }
    for (const channel of ['', 'a'.repeat(65), 'a.b', '@art', 'a/b']) {
      expect(route(`/channel/${channel}`)).toEqual({ kind: 'not-found' });
    }
  });

  it('preserves feature routes and profile tabs across direct loads and thread backgrounds', () => {
    expect(route('/notifications')).toEqual({ kind: 'notifications' });
    expect(route('/channels')).toEqual({ kind: 'channels' });
    expect(route('/devlog')).toEqual({ kind: 'devlog' });
    expect(routePath(parseLocalPath('/devlog'))).toBe('/devlog');
    expect(publicUrl('/devlog')).toBe('https://quorum.arca.computer/devlog');
    expect(route('/profile/1234', '?tab=replies')).toEqual({ kind: 'profile', identifier: '1234', tab: 'replies' });
    expect(route('/profile', '?tab=media')).toEqual({ kind: 'profile', tab: 'media' });
    expect(route('/profile/1234', '?tab=other').kind).toBe('not-found');
    expect(route('/profile/1234', '?tab=media&tab=casts').kind).toBe('not-found');
    expect(profilePath(1234, 'media')).toBe('/profile/1234?tab=media');
    const search = searchPath('hello 🌱', 'users');
    expect(parseLocalPath(search)).toEqual({ kind: 'search', query: 'hello 🌱', searchKind: 'users' });
    expect(routePath(parseLocalPath(search))).toBe(search);
    expect(routePath(parseLocalPath('/profile/1234?tab=media'))).toBe('/profile/1234?tab=media');
    for (const tab of ['likes', 'recasts'] as const) {
      expect(route('/profile', `?tab=${tab}`)).toEqual({ kind: 'profile', tab });
      expect(route('/profile/1234', `?tab=${tab}`)).toEqual({ kind: 'profile', identifier: '1234', tab });
      expect(profilePath(1234, tab)).toBe(`/profile/1234?tab=${tab}`);
      expect(routePath(parseLocalPath(profilePath(1234, tab)))).toBe(`/profile/1234?tab=${tab}`);
      expect(route('/profile/1234', `?tab=${tab}&tab=casts`).kind).toBe('not-found');
    }
  });

  it('bounds search input and refuses ambiguous or unsupported search modes', () => {
    expect(route('/search')).toEqual({ kind: 'search', query: '', searchKind: 'casts' });
    for (const query of ['?q=a&q=b', '?type=wallets', '?type=casts&type=users', '?q=%00', `?q=${'a'.repeat(257)}`]) expect(route('/search', query).kind).toBe('not-found');
    expect(() => searchPath('😀'.repeat(65))).toThrow('Invalid search');
    expect(() => publicUrl('/profile/1234?tab=bad')).toThrow();
  });

  it('rejects malformed or oversized targets before an API can be selected', () => {
    for (const pathname of [
      '', 'profile/1234', '//evil.example', '/unknown', '/following/extra', '/following/',
      '/profile/', '/profile/0', '/profile/000', '/profile/9007199254740992',
      '/profile/1234/extra', `/profile/${'a'.repeat(129)}`, '/profile/@alice',
      '/profile/.', '/profile/..', '/profile/alice%2fcast', '/profile/alice%5Ccast',
      '/profile/alice%252fcast', '/profile/alice%', '/profile/alice\\cast',
      '/profile/alice?cast=x', '/profile/alice#cast', '/profile/alice smith',
      '/profile/alice\n', '/profile/álîce', '/profile/😀',
      '/cast/0x1234', `/cast/0x${'z'.repeat(40)}`, `/cast/${hash}0`,
      `/${'a'.repeat(300)}`,
    ]) expect(route(pathname), pathname).toEqual({ kind: 'not-found' });
    expect(route('/', `?tracking=${'a'.repeat(2048)}`)).toEqual({ kind: 'not-found' });
    expect(route('/', 'cast=value')).toEqual({ kind: 'not-found' });
    expect(route('/', '?tracking=\u0000')).toEqual({ kind: 'not-found' });
  });
});

describe('sign-in navigation', () => {
  it('keeps sign-in URLs independent of account, permission and redirect query parameters', () => {
    expect(route('/connect', '?fid=1234&scopes=1,2,11&return=https://example.org')).toEqual({ kind: 'connect' });
    expect(routePath(route('/connect', '?fid=1234'))).toBe('/connect');
  });

  it('accepts only canonical recognized local return pages and prevents sign-in loops', () => {
    expect(connectReturnPath('/search?q=hello%20world&type=users')).toBe('/search?q=hello+world&type=users');
    expect(connectReturnPath(`/cast/${hash}`)).toBe(`/cast/${hash}`);
    expect(connectReturnPath('/profile/1234?tab=likes')).toBe('/profile/1234?tab=likes');
    for (const value of [undefined, null, {}, 'https://example.org', '//example.org', '/\\example.org', '/connect', '/connect?return=/following', '/unknown', '/profile%2falice', '/following#x', '/search?q=%00']) expect(connectReturnPath(value)).toBe('/');
  });
});

describe('share link construction', () => {
  it('produces stable FID and full normalized hash paths at the canonical domain', () => {
    expect(profilePath(1234)).toBe('/profile/1234');
    expect(castPath(hash.slice(2).toUpperCase())).toBe(`/cast/${hash}`);
    expect(publicUrl(profilePath(1234))).toBe('https://quorum.arca.computer/profile/1234');
    expect(publicUrl(castPath(hash))).toBe(`https://quorum.arca.computer/cast/${hash}`);
    expect(publicUrl('/profile')).toBe('https://quorum.arca.computer/profile');
  });

  it('does not create external, malformed, or ambiguous share destinations', () => {
    for (const fid of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => profilePath(fid)).toThrow('Invalid profile FID');
    }
    for (const value of ['', '0x1234', `${hash}0`, `https://evil.example/${hash}`]) {
      expect(() => castPath(value)).toThrow('Invalid cast hash');
    }
    for (const path of ['https://evil.example', '//evil.example', '/profile/../following', '/profile%2falice', '/?cast=x', '/profile#x']) {
      expect(() => publicUrl(path)).toThrow('Invalid public path');
    }
  });
});
