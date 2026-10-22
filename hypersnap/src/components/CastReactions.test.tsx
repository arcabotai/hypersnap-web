// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CastReactions from './CastReactions';
import { ApiError, getReactionStatus, type Cast } from '../lib/api';
import type { WalletSession } from '../lib/auth';
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getReactionStatus: vi.fn() }));
const cast = { hash: `0x${'a'.repeat(40)}`, author: { fid: 20 }, reactions: { likes_count: 5, recasts_count: 2 } } as Cast;
const makeSession = (fid = 10) => ({ fid, publicKey: String(fid), react: vi.fn().mockResolvedValue({}) }) as unknown as WalletSession;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function click(item: Element) { await act(async () => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
describe('verified connected-user reactions', () => {
  it('loads existing protocol reactions and removes a like without adding it again', async () => {
    vi.mocked(getReactionStatus).mockImplementation(async (_fid, _target, kind) => kind === 'like');
    const session = makeSession();
    await act(async () => root.render(<CastReactions cast={cast} session={session} onSignIn={vi.fn()} notify={vi.fn()} />));
    expect(button('Unlike').textContent).toBe('5'); expect(button('Recast').textContent).toBe('2');
    await click(button('Unlike'));
    expect(session.react).toHaveBeenCalledWith({ fid: 20, hash: cast.hash }, 'like', true);
    expect(button('Like').textContent).toBe('4');
  });
  it('never guesses an absent reaction after an unavailable read, then permits explicit read retry', async () => {
    vi.mocked(getReactionStatus).mockRejectedValue(new Error('Node unavailable'));
    const session = makeSession();
    await act(async () => root.render(<CastReactions cast={cast} session={session} onSignIn={vi.fn()} notify={vi.fn()} />));
    expect(button('Like').disabled).toBe(true); expect(button('Recast').disabled).toBe(true);
    expect(session.react).not.toHaveBeenCalled();
    vi.mocked(getReactionStatus).mockResolvedValue(false);
    await click([...host.querySelectorAll('button')].find(item => item.textContent === 'Retry reaction status')!);
    expect(button('Like').disabled).toBe(false);
  });
  it('reconciles an uncertain write by reading, without replaying it', async () => {
    vi.mocked(getReactionStatus).mockResolvedValue(false);
    const session = makeSession(); vi.mocked(session.react).mockRejectedValue(new Error('Submission status is unknown'));
    const notify = vi.fn();
    await act(async () => root.render(<CastReactions cast={cast} session={session} onSignIn={vi.fn()} notify={notify} />));
    vi.mocked(getReactionStatus).mockImplementation(async (_fid, _target, kind) => kind === 'like');
    await click(button('Like'));
    expect(session.react).toHaveBeenCalledTimes(1); expect(button('Unlike')).toBeDefined(); expect(button('Unlike').textContent).toBe('5');
    expect(notify).toHaveBeenCalledWith('Submission status is unknown');
  });
  it('discards late status from an old account and keeps reads bounded to four', async () => {
    const pending: Array<{ resolve(value: boolean): void; signal?: AbortSignal }> = [];
    vi.mocked(getReactionStatus).mockImplementation((_fid, _target, _kind, signal) => new Promise(resolve => pending.push({ resolve, signal })));
    const old = makeSession(); const next = makeSession(11);
    await act(async () => root.render(<CastReactions cast={cast} session={old} onSignIn={vi.fn()} notify={vi.fn()} />));
    await act(async () => root.render(<CastReactions cast={cast} session={next} onSignIn={vi.fn()} notify={vi.fn()} />));
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => { pending[0].resolve(true); pending[1].resolve(true); });
    expect(button('Like').disabled).toBe(true);
    await act(async () => { for (const item of pending.slice(2)) item.resolve(false); });
    expect(button('Like').disabled).toBe(false); expect(button('Unlike')).toBeNull();
  });
  it('keeps pending reactions disabled until the session resolves an uncertain attempt', async () => {
    const session = makeSession();
    session.reactionStatus = vi.fn().mockRejectedValue(new ApiError('Waiting for inclusion', 504, 'submission_unknown'));
    await act(async () => root.render(<CastReactions cast={cast} session={session} onSignIn={vi.fn()} notify={vi.fn()} />));
    expect(button('Like').disabled).toBe(true); expect(host.textContent).toContain('Waiting for confirmation.');
    expect(session.react).not.toHaveBeenCalled(); expect(getReactionStatus).not.toHaveBeenCalled();
    vi.mocked(session.reactionStatus).mockResolvedValue(true);
    const metadataUpdate = { ...session, user: { ...session.user, display_name: 'Updated display name' } };
    await act(async () => root.render(<CastReactions cast={{ ...cast, author: { ...cast.author, display_name: 'Updated author' } }} session={metadataUpdate} onSignIn={vi.fn()} notify={vi.fn()} />));
    // Changing display metadata must not retry a quarantined write's status or
    // silently enable another toggle, even if the next read could confirm it.
    expect(session.reactionStatus).toHaveBeenCalledTimes(2);
    expect(button('Like').disabled).toBe(true); expect(host.textContent).toContain('Waiting for confirmation.');
    await click([...host.querySelectorAll('button')].find(item => item.textContent === 'Check pending reaction')!);
    expect(button('Unlike').disabled).toBe(false); expect(session.react).not.toHaveBeenCalled();
  });

});
