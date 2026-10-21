import { useRef, useState } from 'react';
import { IconCopy, IconQuote, IconShare, IconMessages } from '@tabler/icons-react';
import type { Cast } from '../lib/api';
import { renderMentionSegments } from '../lib/content';
import { Button, Modal } from './ui';

export default function CastOptions({ cast, onClose, onShare, onQuote, onQuotes }: { cast: Cast; onClose(): void; onShare(): void; onQuote(): void; onQuotes?(): void }) {
  const text = renderMentionSegments(cast).map(segment => segment.kind === 'text' ? segment.text : `@${segment.user.username || segment.user.fid}`).join('');
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function copy() {
    setBusy(true);
    try { if (!navigator.clipboard?.writeText) throw new Error('Select manually'); await navigator.clipboard.writeText(text); setStatus('Cast text copied.'); }
    catch { field.current?.focus(); field.current?.select(); setStatus('Text selected. Use your device’s Copy command.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Cast options" onClose={onClose}><div className="cast-options"><div className="cast-options__actions"><Button variant="secondary" onClick={onShare}><IconShare size={17} />Share cast</Button><Button variant="secondary" onClick={onQuote}><IconQuote size={17} />Quote cast</Button><Button variant="secondary" disabled={!text || busy} onClick={() => void copy()}><IconCopy size={17} />Copy text</Button></div>{onQuotes && <Button variant="secondary" className="cast-options__quotes" onClick={onQuotes}><IconMessages size={17} />View quotes</Button>}<textarea ref={field} aria-label="Cast text to copy" value={text} readOnly rows={4} /><p className="muted" role="status">{status || 'You can also select the text to copy it.'}</p></div></Modal>;
}
