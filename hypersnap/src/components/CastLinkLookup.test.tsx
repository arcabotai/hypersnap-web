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
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
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
  it('renders and opens a verified progress candidate before the history scan finishes, aborting before navigation', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    expect(container.textContent).toContain('Candidate a'); expect(container.textContent).toContain('Checking for other matches');
    expect(container.textContent).not.toContain('Finding the cast'); expect(props.onResolved).not.toHaveBeenCalled();
    const link = container.querySelector<HTMLAnchorElement>('a')!; expect(link.getAttribute('href')).toBe(`/cast/${one.hash}`);
    vi.mocked(props.onOpen).mockImplementation(() => expect(request.signal!.aborted).toBe(true));
    await click(link); expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(one);
    await act(async () => {
      request.onProgress!(result({ candidates: [two], continuation: undefined, scanned: 500 }));
      pending.resolve(result({ complete: true, continuation: undefined }));
    });
    expect(container.textContent).toContain('Candidate a'); expect(container.textContent).not.toContain('Candidate b');
    expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('keeps modified clicks as canonical full-cast links without cancelling the current scan', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(link.getAttribute('href')).toBe(`/cast/${one.hash}`);
    expect(request.signal!.aborted).toBe(false); expect(props.onOpen).not.toHaveBeenCalled(); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('waits for a final unique result before automatically resolving a progressive candidate', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    expect(props.onResolved).not.toHaveBeenCalled();
    await act(async () => pending.resolve(result({ complete: true, continuation: undefined })));
    expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
    await act(async () => request.onProgress!(result({ candidates: [two], continuation: undefined, scanned: 1250 })));
    expect(container.textContent).not.toContain('Candidate b'); expect(button('Cancel lookup')).toBeUndefined();
  });
  it('keeps progressive candidates selectable when a later match makes the final result ambiguous', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    await act(async () => request.onProgress!(result({ candidates: [one, two], continuation: undefined, scanned: 500 })));
    expect(container.textContent).toContain('Candidate a'); expect(container.textContent).toContain('Candidate b');
    expect(props.onResolved).not.toHaveBeenCalled();
    await act(async () => pending.resolve(result({ candidates: [one, two], complete: true, continuation: undefined })));
    expect(container.textContent).toContain('More than one cast matches'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('ignores malformed progress snapshots without rendering or redirecting their candidates', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const progress = vi.mocked(resolveCastAlias).mock.calls[0][0].onProgress!;
    await act(async () => {
      progress(null as unknown as CastAliasResult);
      progress(result({ complete: true, continuation: undefined }));
      progress(result({ candidates: [{ ...one, author: { ...author, fid: 30 } }], continuation: undefined }));
      progress(result({ candidates: [{ ...one, hash: `0x87654321${'a'.repeat(32)}` }], continuation: undefined }));
      progress(result({ candidates: [{ ...one, hash: '0x12345678' }], continuation: undefined }));
      progress(result({ continuation: undefined, scanned: Number.NaN }));
      progress(result());
    });
    expect(container.textContent).not.toContain('Candidate a'); expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(props.onResolved).not.toHaveBeenCalled();
    await act(async () => progress(result({ continuation: undefined, scanned: 250 })));
    expect(container.textContent).toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('keeps a progressive candidate after cancellation and ignores late progress and completion', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    await click(button('Cancel lookup')); expect(request.signal!.aborted).toBe(true);
    await act(async () => {
      request.onProgress!(result({ candidates: [two], continuation: undefined, scanned: 500 }));
      pending.resolve(result({ candidates: [two], complete: true, continuation: undefined }));
    });
    expect(container.textContent).toContain('Candidate a'); expect(container.textContent).toContain('Lookup cancelled');
    expect(container.textContent).not.toContain('Candidate b'); expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('keeps a progressive candidate when a later history page fails', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    await act(async () => pending.reject(new Error('A later history page failed.')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('A later history page failed');
    expect(container.textContent).toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
    await act(async () => request.onProgress!(result({ candidates: [two], continuation: undefined, scanned: 500 })));
    expect(container.textContent).not.toContain('Candidate b'); expect(button('Cancel lookup')).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('A later history page failed');
  });
  it('ignores previous-route progress while a different author lookup is still pending', async () => {
    const old = deferred<CastAliasResult>(); const current = deferred<CastAliasResult>();
    vi.mocked(resolveCastAlias).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await render({ authorIdentifier: 'bob' }); expect(request.signal!.aborted).toBe(true);
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    expect(container.textContent).not.toContain('Candidate a'); expect(container.textContent).toContain('bob');
    expect(props.onResolved).not.toHaveBeenCalled();
  });
  it('shows a first-page match without assuming uniqueness, then resolves only after explicit continuation exhausts history', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result()).mockResolvedValueOnce(result({ complete: true, continuation: undefined, scanned: 1500 }));
    await render(); expect(container.textContent).toContain('Candidate a'); expect(container.textContent).toContain('You can open this cast now.'); expect(container.textContent).toContain('Other matches may exist.');
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
