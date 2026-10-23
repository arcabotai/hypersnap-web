import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconArrowUpRight, IconRefresh } from '@tabler/icons-react';
import { resolveCastAlias, type Cast, type CastAliasContinuation, type CastAliasResult } from '../lib/api';
import { castPermalink } from '../lib/navigation';
import { Button } from './ui';
import '../cast-link.scss';

export interface CastLinkLookupProps {
  authorIdentifier: string;
  hashPrefix: string;
  renderCast(cast: Cast): ReactNode;
  onOpen(cast: Cast): void;
  onResolved(cast: Cast): void;
}
type LookupState = { key: string; result: CastAliasResult | null; busy: boolean; error: string; cancelled: boolean };
const emptyState = (key: string): LookupState => ({ key, result: null, busy: true, error: '', cancelled: false });
function matchesLink(result: CastAliasResult, hashPrefix: string): boolean {
  return Number.isSafeInteger(result.author?.fid) && result.author.fid > 0
    && Number.isSafeInteger(result.scanned) && result.scanned >= 0 && Array.isArray(result.candidates)
    && result.candidates.every(cast => cast && typeof cast.hash === 'string' && /^(?:0x)?[a-fA-F0-9]{40}$/.test(cast.hash)
      && cast.author?.fid === result.author.fid
      && `0x${cast.hash.replace(/^0x/i, '').toLowerCase()}`.startsWith(hashPrefix.toLowerCase()));
}

export default function CastLinkLookup({ authorIdentifier, hashPrefix, renderCast, onOpen, onResolved }: CastLinkLookupProps) {
  const key = `${authorIdentifier}:${hashPrefix}`;
  const activeKey = useRef(key); activeKey.current = key;
  const callbacks = useRef({ onOpen, onResolved }); callbacks.current = { onOpen, onResolved };
  const [state, setState] = useState<LookupState>(() => emptyState(key));
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const loading = useRef(false);
  const lastAttempt = useRef<CastAliasContinuation | undefined>(undefined);

  const load = useCallback(async (continuation?: CastAliasContinuation) => {
    if (loading.current) return;
    loading.current = true; lastAttempt.current = continuation;
    const run = ++generation.current; const capturedKey = key;
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    setState(current => ({ key, result: continuation && current.key === key ? current.result : null, busy: true, error: '', cancelled: false }));
    let acceptingProgress = true;
    try {
      const result = await resolveCastAlias({ authorIdentifier, hashPrefix, continuation, signal: request.signal, onProgress: snapshot => {
        if (!acceptingProgress || request.signal.aborted || run !== generation.current || activeKey.current !== capturedKey
          || !snapshot || snapshot.complete !== false || snapshot.continuation !== undefined || !matchesLink(snapshot, hashPrefix)) return;
        setState({ key, result: snapshot, busy: true, error: '', cancelled: false });
      } });
      if (request.signal.aborted || run !== generation.current || activeKey.current !== capturedKey) return;
      // Never let a malformed response turn a scoped short link into another
      // author's cast or an unrelated hash, even before explicit selection.
      if (!matchesLink(result, hashPrefix)) {
        throw new Error('The node returned a cast that does not match this link.');
      }
      setState({ key, result, busy: false, error: '', cancelled: false });
      if (result.complete && result.candidates.length === 1) callbacks.current.onResolved(result.candidates[0]);
    } catch (cause) {
      if (!request.signal.aborted && run === generation.current && activeKey.current === capturedKey) setState(current => ({ ...current, busy: false, error: cause instanceof Error ? cause.message.slice(0, 300) : 'This cast link could not be checked. Try again.', cancelled: false }));
    } finally { acceptingProgress = false; if (run === generation.current) loading.current = false; }
  }, [authorIdentifier, hashPrefix, key]);
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); loading.current = false;
    setState(emptyState(key)); void load();
    return () => { generation.current += 1; controller.current?.abort(); loading.current = false; };
  }, [key, load]);
  function cancel() {
    generation.current += 1; controller.current?.abort(); loading.current = false;
    setState(current => ({ ...current, busy: false, cancelled: true, error: '' }));
  }
  function open(event: MouseEvent<HTMLAnchorElement>, cast: Cast) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); cancel(); callbacks.current.onOpen(cast);
  }
  const visible = state.key === key ? state : emptyState(key);
  const result = visible.result;
  const hasCandidates = Boolean(result?.candidates.length);
  return <section className="cast-link-lookup" aria-label="Resolve cast link">
    {!hasCandidates && <div className="cast-link-lookup__intro"><h3>Finding the cast</h3><p>Looking for a cast from <strong>{authorIdentifier}</strong> on Hypersnap.</p></div>}
    {result?.candidates.map(cast => <section className="cast-link-lookup__candidate" key={cast.hash.toLowerCase()} aria-label="Matching cast candidate">{renderCast(cast)}<a className="button button--secondary" href={castPermalink(cast, { fullHash: true })} onClick={event => open(event, cast)}>Open full cast <IconArrowUpRight size={16} /></a></section>)}
    {result && <div className="cast-link-lookup__status" role="status">
      {!result.complete && hasCandidates && <p>{result.candidates.length === 1 ? 'You can open this cast now.' : 'Choose a cast to open.'} Other matches may exist.</p>}
      {result.complete && result.candidates.length > 1 && <p>More than one cast matches this short link. Choose a full cast to open.</p>}
      {result.complete && !result.candidates.length && <p>No cast matched this link in the available history returned by this Hypersnap node.</p>}
      {!result.complete && !hasCandidates && <p>No match in the {result.scanned.toLocaleString()} history messages checked so far.</p>}
      {result.limited && <p>This lookup reached its history limit. Use a full cast link, or open a matching cast.</p>}
    </div>}
    {visible.busy && <div className="cast-link-lookup__loading" role="status"><span><IconRefresh size={17} className="spin" />{hasCandidates ? 'Checking for other matches…' : result ? 'Searching older history…' : 'Checking this cast link on Hypersnap…'}</span><Button variant="ghost" onClick={cancel}>Cancel lookup</Button></div>}
    {visible.error && <div className="cast-link-lookup__error"><p role="alert">{visible.error}</p><Button variant="secondary" onClick={() => void load(lastAttempt.current)}>Try again</Button></div>}
    {visible.cancelled && <div className="cast-link-lookup__status" role="status"><p>Lookup cancelled. Any matches already shown remain candidates.</p><Button variant="secondary" onClick={() => void load(lastAttempt.current)}>Resume lookup</Button></div>}
    {!visible.busy && !visible.error && !visible.cancelled && result && !result.complete && result.continuation && <Button variant="secondary" className="cast-link-lookup__more" onClick={() => void load(result.continuation)}>Search older casts</Button>}
    {!visible.busy && <Button variant="ghost" className="cast-link-lookup__restart" onClick={() => void load()}>Start lookup again</Button>}
  </section>;
}
