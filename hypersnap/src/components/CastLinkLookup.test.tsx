// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CastLinkLookup, { type CastLinkLookupProps } from './CastLinkLookup';
import { resolveCastAlias, type Cast, type CastAliasContinuation, type CastAliasResult, type User } from '../lib/api';

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), resolveCastAlias: vi.fn() }));
const author: User = { fid: 20, username: 'alice', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
const candidate = (suffix: string): Cast => ({ hash: `0x12345678${suffix.repeat(32)}`, author, text: `Candidate ${suffix}`, timestamp: '2026-10-22T12:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const one = candidate('a'); const two = candidate('b');
const continuation: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: '0x12345678', fid: 20, cursor: 'bmV4dA==', seenCursors: [], hashes: [one.hash], scanned: 1000 };
const result = (overrides: Partial<CastAliasResult> = {}): CastAliasResult => ({ author, candidates: [one], complete: false, scanned: 1000, continuation, ...overrides });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let container: HTMLDivElement; let root: Root; let props: CastLinkLookupProps;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  props = { authorIdentifier: 'alice', hashPrefix: '0x12345678', renderCast: cast => <p>{cast.text}</p>, onOpen: vi.fn(), onResolved: vi.fn() };
  vi.mocked(resolveCastAlias).mockResolvedValue(result()); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(overrides: Partial<CastLinkLookupProps> = {}) { await act(async () => root.render(<CastLinkLookup {...props} {...overrides} />)); }
async function click(value: Element) { await act(async () => value.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); }
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === label)!;

describe('bounded author-scoped cast link lookup UI', () => {
  it('shows a first-page match without assuming uniqueness, then resolves only after explicit continuation exhausts history', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result()).mockResolvedValueOnce(result({ complete: true, continuation: undefined, scanned: 1500 }));
    await render(); expect(container.textContent).toContain('Candidate a'); expect(container.textContent).toContain('1,000 history messages'); expect(container.textContent).toContain('not yet known to be unique');
    expect(props.onResolved).not.toHaveBeenCalled(); await click(button('Search older casts'));
    expect(vi.mocked(resolveCastAlias).mock.calls[1][0].continuation).toBe(continuation); expect(props.onResolved).toHaveBeenCalledWith(one);
  });
  it('requires an explicit full-cast choice when complete history contains multiple matching hashes', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ candidates: [one, two], complete: true, continuation: undefined }));
    await render(); expect(container.textContent).toContain('More than one cast matches'); expect(props.onResolved).not.toHaveBeenCalled();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')]; expect(links.map(link => link.getAttribute('href'))).toEqual([`/cast/${one.hash}`, `/cast/${two.hash}`]);
    await click(links[1]); expect(props.onOpen).toHaveBeenCalledWith(two); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('cancels a continuation, retries exactly that attempt and ignores its older late completion', async () => {
    const old = deferred<CastAliasResult>();
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result()).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result({ candidates: [one, two], complete: true, continuation: undefined, scanned: 1800 }));
    await render(); await click(button('Search older casts')); const signal = vi.mocked(resolveCastAlias).mock.calls[1][0].signal!;
    await click(button('Cancel lookup')); expect(signal.aborted).toBe(true); expect(container.textContent).toContain('Candidate a');
    await click(button('Resume lookup')); expect(vi.mocked(resolveCastAlias).mock.calls[2][0].continuation).toBe(continuation);
    await act(async () => old.resolve(result({ candidates: [one], complete: true, continuation: undefined })));
    expect(container.textContent).toContain('Candidate b'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('aborts a previous route lookup and never displays its late candidate under a new author', async () => {
    const old = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result({ author: { ...author, fid: 30, username: 'bob' }, candidates: [], complete: true, continuation: undefined }));
    await render(); const signal = vi.mocked(resolveCastAlias).mock.calls[0][0].signal!; await render({ authorIdentifier: 'bob' }); expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(result({ complete: true, continuation: undefined })));
    expect(container.textContent).not.toContain('Candidate a'); expect(container.textContent).toContain('No cast matched'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('keeps the same lookup in flight across callback rerenders and delivers only to the current completion handler', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const signal = vi.mocked(resolveCastAlias).mock.calls[0][0].signal!;
    const onResolved = vi.fn();
    await render({ onResolved, renderCast: item => <p>Updated card: {item.text}</p> });
    expect(resolveCastAlias).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve(result({ complete: true, continuation: undefined })));
    expect(onResolved).toHaveBeenCalledExactlyOnceWith(one); expect(props.onResolved).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Updated card: Candidate a');
  });
  it('retains matching candidates on a continuation failure and retries the failed page', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('The Hypersnap node is temporarily unavailable.')).mockResolvedValueOnce(result({ candidates: [one, two], complete: true, continuation: undefined }));
    await render(); await click(button('Search older casts'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable'); expect(container.textContent).toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
    await click(button('Try again')); expect(vi.mocked(resolveCastAlias).mock.calls[2][0].continuation).toBe(continuation); expect(container.textContent).toContain('Candidate b');
  });
  it('discloses a terminal history cap without pretending that one partial candidate is unique', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ limited: true, continuation: undefined, scanned: 100000 }));
    await render(); expect(container.textContent).toContain('reached its history limit'); expect(button('Search older casts')).toBeUndefined(); expect(container.textContent).toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('rejects a candidate from a different author before rendering or resolving it', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ candidates: [{ ...one, author: { ...author, fid: 30 } }], complete: true, continuation: undefined }));
    await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match this link'); expect(container.textContent).not.toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
  });
});
