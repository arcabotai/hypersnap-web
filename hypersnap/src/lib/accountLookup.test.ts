import { describe, expect, it } from 'vitest';
import type { User } from './api';
import { normalizeReviewIdentity, parseAccountLookup, sameReviewIdentity } from './accountLookup';

const custody = `0x${'ab'.repeat(20)}`;
const user = { fid: 1234, username: 'alice', display_name: 'Alice', custody_address: custody } as User;

describe('public account lookup and review', () => {
  it('resolves the three supported input formats without generating or requesting any key', () => {
    expect(parseAccountLookup(' @Alice.eth ')).toEqual({ username: 'alice.eth' });
    expect(parseAccountLookup(' 001234 ')).toEqual({ fid: 1234 });
    expect(parseAccountLookup(custody.toUpperCase().replace('0X', '0x'))).toEqual({ custodyAddress: custody });
    expect(parseAccountLookup('ignored', 1234)).toEqual({ fid: 1234 });
  });
  it('rejects invalid IDs, malformed addresses and recovery-word-like input', () => {
    for (const value of ['0', '4294967296', '999999999999999999999999', '0x1234', `${custody}0`, '', 'word word word word', 'ab'.repeat(32), `0x${'ab'.repeat(32)}`, `@${'ab'.repeat(32)}`]) expect(() => parseAccountLookup(value)).toThrow();
    for (const value of [0, -1, 1.5, 4294967296, NaN]) expect(() => parseAccountLookup('', value)).toThrow();
    expect(parseAccountLookup('4294967295')).toEqual({ fid: 4294967295 });
  });
  it('only accepts the requested FID or actual custody address, never a verified-address match', () => {
    expect(normalizeReviewIdentity(user, { fid: 1234 })).toEqual({ fid: 1234, username: 'alice', displayName: 'Alice', custodyAddress: custody });
    expect(() => normalizeReviewIdentity(user, { fid: 99 })).toThrow('different identity');
    const verified = `0x${'cd'.repeat(20)}`;
    expect(() => normalizeReviewIdentity({ ...user, verified_addresses: { eth_addresses: [verified], sol_addresses: [] } }, { custodyAddress: verified })).toThrow('different identity');
    expect(normalizeReviewIdentity(user, { custodyAddress: custody.toUpperCase().replace('0X', '0x') }).custodyAddress).toBe(custody);
  });
  it('rejects malformed public authority and whitelists only reviewed fields', () => {
    for (const invalid of [{ ...user, fid: 0 }, { ...user, fid: 4294967296 }, { ...user, custody_address: '' }, { ...user, custody_address: 'not-an-address' }]) expect(() => normalizeReviewIdentity(invalid)).toThrow();
    const reviewed = normalizeReviewIdentity({ ...user, display_name: '  Alice  ', pfp_url: 'https://example.com/unrelated', unexpected: 'discarded' } as User);
    expect(reviewed).toEqual({ fid: 1234, username: 'alice', displayName: 'Alice', custodyAddress: custody });
    expect(() => normalizeReviewIdentity({ ...user, username: '<bad>' })).toThrow('invalid account username');
  });
  it('does not claim a synthetic or absent username and allows a name-proof alias to show its canonical identity', () => {
    for (const username of ['fid:1234', '', undefined]) expect(normalizeReviewIdentity({ ...user, username } as User).username).toBe('');
    expect(normalizeReviewIdentity(user, { username: 'alice.eth' }).username).toBe('alice');
  });
  it('requires re-review when the canonical username, FID, or custody changes', () => {
    const reviewed = normalizeReviewIdentity(user);
    expect(sameReviewIdentity(reviewed, { ...reviewed, displayName: 'Decorative name changed' })).toBe(true);
    for (const changed of [{ ...reviewed, fid: 1235 }, { ...reviewed, username: 'new-alice' }, { ...reviewed, custodyAddress: `0x${'cd'.repeat(20)}` }]) expect(sameReviewIdentity(reviewed, changed)).toBe(false);
  });
});
