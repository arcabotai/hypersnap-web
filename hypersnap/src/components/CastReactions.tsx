import { useEffect, useRef, useState } from 'react';
import { IconHeart, IconRepeat } from '@tabler/icons-react';
import { ApiError, getReactionStatus, type Cast } from '../lib/api';
import type { WalletSession } from '../lib/auth';
import { Button } from './ui';

// Reaction receipts are independent reads. Bound the number in flight across
// all visible cards, including the conversation layered over a feed.
let active = 0;
const queue: Array<() => void> = [];
function boundedRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let started = false;
    const abort = () => {
      if (!started) { const index = queue.indexOf(start); if (index >= 0) queue.splice(index, 1); }
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const start = () => {
      if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
      started = true; active += 1;
      Promise.resolve().then(read).then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort); active -= 1; queue.shift()?.(); });
    };
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (active < 4) start(); else queue.push(start);
  });
}
const short = (value: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, value));
type State = { liked: boolean; recasted: boolean; likes: number; recasts: number };

export default function CastReactions({ cast, session, onSignIn, notify }: { cast: Cast; session: WalletSession | null; onSignIn(): void; notify(text: string): void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const activeSession = useRef(session); activeSession.current = session;
  const sessionFid = session?.fid;
  const sessionPublicKey = session?.publicKey;
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError(false); setUncertain(false);
    // Capture the current identity's methods for this read. Display metadata
    // updates must not clear status or an uncertain-write quarantine.
    const readSession = activeSession.current;
    if (readSession && readSession.fid === sessionFid && readSession.publicKey === sessionPublicKey) {
      void Promise.all((['like', 'recast'] as const).map(type => boundedRead(() => readSession.reactionStatus
        ? readSession.reactionStatus({ fid: cast.author.fid, hash: cast.hash }, type, controller.signal)
        : getReactionStatus(readSession.fid, { fid: cast.author.fid, hash: cast.hash }, type, controller.signal), controller.signal)))
        .then(([liked, recasted]) => { if (!controller.signal.aborted) setState({ liked, recasted, likes: cast.reactions?.likes_count ?? 0, recasts: cast.reactions?.recasts_count ?? 0 }); })
        .catch(cause => { if (!controller.signal.aborted) { setError(true); setUncertain(cause instanceof ApiError && cause.code === 'submission_unknown'); } });
    }
    return () => controller.abort();
  }, [sessionFid, sessionPublicKey, cast.hash, cast.author.fid, cast.reactions?.likes_count, cast.reactions?.recasts_count, retry]);
  async function react(type: 'like' | 'recast') {
    if (!session) { onSignIn(); return; }
    if (!state || submitting.current) return;
    submitting.current = true; setPending(true);
    const key = session.publicKey;
    const remove = type === 'like' ? state.liked : state.recasted;
    try {
      await session.react({ fid: cast.author.fid, hash: cast.hash }, type, remove);
      if (mounted.current && activeSession.current?.publicKey === key) setState(current => current ? type === 'like'
        ? { ...current, liked: !remove, likes: Math.max(0, current.likes + (remove ? -1 : 1)) }
        : { ...current, recasted: !remove, recasts: Math.max(0, current.recasts + (remove ? -1 : 1)) } : null);
    } catch (cause) {
      // A timeout can follow an accepted write. Re-read before allowing another
      // toggle; never turn an unknown outcome into an automatic replay.
      if (mounted.current && activeSession.current?.publicKey === key) {
        setState(null); setRetry(value => value + 1);
        notify(cause instanceof Error ? cause.message : 'Reaction could not be confirmed.');
      }
    } finally { submitting.current = false; if (mounted.current && activeSession.current?.publicKey === key) setPending(false); }
  }
  return <>
    <Button variant="ghost" aria-label={state?.recasted ? 'Undo recast' : 'Recast'} aria-pressed={state?.recasted ?? false} disabled={pending || Boolean(session && !state)} className={state?.recasted ? 'is-recasted' : ''} onClick={() => void react('recast')}><IconRepeat size={18} /><span>{short(state?.recasts ?? cast.reactions?.recasts_count ?? 0)}</span></Button>
    <Button variant="ghost" aria-label={state?.liked ? 'Unlike' : 'Like'} aria-pressed={state?.liked ?? false} disabled={pending || Boolean(session && !state)} className={state?.liked ? 'is-liked' : ''} onClick={() => void react('like')}><IconHeart size={18} fill={state?.liked ? 'currentColor' : 'none'} /><span>{short(state?.likes ?? cast.reactions?.likes_count ?? 0)}</span></Button>
    {session && !state && <span className="reaction-status" role="status">{error ? <>{uncertain && 'Waiting for confirmation. '}<Button variant="ghost" onClick={() => setRetry(value => value + 1)}>{uncertain ? 'Check pending reaction' : 'Retry reaction status'}</Button></> : 'Checking reactions…'}</span>}
  </>;
}
