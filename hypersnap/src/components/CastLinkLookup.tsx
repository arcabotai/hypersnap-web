import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconArrowUpRight, IconRefresh } from '@tabler/icons-react';
import { resolveCastAlias, type Cast, type CastAliasContinuation, type CastAliasResult } from '../lib/api';
import { castPath } from '../lib/navigation';
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

export default function CastLinkLookup({ authorIdentifier, hashPrefix, renderCast, onOpen, onResolved }: CastLinkLookupProps) {
  const key = `${authorIdentifier}:${hashPrefix}`;
  const activeKey = useRef(key); activeKey.current = key;
  const callbacks = useRef({ onOpen, onResolved }); callbacks.current = { onOpen, onResolved };
  const [state, setState] = useState<LookupState>(() => emptyState(key));
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const loading = useRef(false);
  const lastAttempt = useRef<CastAliasContinuation | undefined>(undefined);

  async function load(continuation?: CastAliasContinuation) {
    if (loading.current) return;
    loading.current = true; lastAttempt.current = continuation;
    const run = ++generation.current; const capturedKey = key;
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    setState(current => ({ key, result: continuation && current.key === key ? current.result : null, busy: true, error: '', cancelled: false }));
    try {
      const result = await resolveCastAlias({ authorIdentifier, hashPrefix, continuation, signal: request.signal });
      if (request.signal.aborted || run !== generation.current || activeKey.current !== capturedKey) return;
      // Never let a malformed response turn a scoped short link into another
      // author's cast or an unrelated hash, even before explicit selection.
      if (!Number.isSafeInteger(result.author?.fid) || result.author.fid < 1 || !Array.isArray(result.candidates)
        || result.candidates.some(cast => !/^(?:0x)?[a-fA-F0-9]{40}$/.test(cast.hash) || cast.author?.fid !== result.author.fid
          || !`0x${cast.hash.replace(/^0x/i, '').toLowerCase()}`.startsWith(hashPrefix.toLowerCase()))) {
        throw new Error('The node returned a cast that does not match this link.');
      }
      setState({ key, result, busy: false, error: '', cancelled: false });
      if (result.complete && result.candidates.length === 1) callbacks.current.onResolved(result.candidates[0]);
    } catch (cause) {
      if (!request.signal.aborted && run === generation.current && activeKey.current === capturedKey) setState(current => ({ ...current, busy: false, error: cause instanceof Error ? cause.message.slice(0, 300) : 'This cast link could not be checked. Try again.', cancelled: false }));
    } finally { if (run === generation.current) loading.current = false; }
  }
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); loading.current = false;
    setState(emptyState(key)); void load();
    return () => { generation.current += 1; controller.current?.abort(); loading.current = false; };
  }, [key]);
  function cancel() {
    generation.current += 1; controller.current?.abort(); loading.current = false;
    setState(current => ({ ...current, busy: false, cancelled: true, error: '' }));
  }
  function open(event: MouseEvent<HTMLAnchorElement>, cast: Cast) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); callbacks.current.onOpen(cast);
  }
  const visible = state.key === key ? state : emptyState(key);
  const result = visible.result;
  return <section className="cast-link-lookup" aria-label="Resolve cast link">
    <div className="cast-link-lookup__intro"><h3>Finding the full cast</h3><p>This link names <strong>{authorIdentifier}</strong> and a hash beginning <code>{hashPrefix}</code>. We check that author’s available history on Hypersnap.</p></div>
    {result && <div className="cast-link-lookup__status" role="status">
      {!result.complete && <p>Checked {result.scanned.toLocaleString()} history messages. Older history has not all been checked, so this short link is not yet known to be unique.</p>}
      {result.complete && result.candidates.length > 1 && <p>More than one cast matches this short link. Choose a full cast below.</p>}
      {result.complete && !result.candidates.length && <p>No cast matched this link in the available history returned by this Hypersnap node.</p>}
      {!result.complete && !result.candidates.length && <p>No match in the history checked so far.</p>}
      {result.limited && <p>This lookup reached its history limit. Use a full cast link, or choose a matching cast below.</p>}
    </div>}
    {result?.candidates.map(cast => <section className="cast-link-lookup__candidate" key={cast.hash.toLowerCase()} aria-label="Matching cast candidate">{renderCast(cast)}<a className="button button--secondary" href={castPath(cast.hash)} onClick={event => open(event, cast)}>Open full cast <IconArrowUpRight size={16} /></a></section>)}
    {visible.busy && <div className="cast-link-lookup__loading" role="status"><span><IconRefresh size={17} className="spin" />{result ? 'Searching older history…' : 'Checking this cast link on Hypersnap…'}</span><Button variant="ghost" onClick={cancel}>Cancel lookup</Button></div>}
    {visible.error && <div className="cast-link-lookup__error"><p role="alert">{visible.error}</p><Button variant="secondary" onClick={() => void load(lastAttempt.current)}>Try again</Button></div>}
    {visible.cancelled && <div className="cast-link-lookup__status" role="status"><p>Lookup cancelled. Any matches already shown remain candidates.</p><Button variant="secondary" onClick={() => void load(lastAttempt.current)}>Resume lookup</Button></div>}
    {!visible.busy && !visible.error && !visible.cancelled && result && !result.complete && result.continuation && <Button variant="secondary" className="cast-link-lookup__more" onClick={() => void load(result.continuation)}>Search older casts</Button>}
    {!visible.busy && <Button variant="ghost" className="cast-link-lookup__restart" onClick={() => void load()}>Start lookup again</Button>}
  </section>;
}
