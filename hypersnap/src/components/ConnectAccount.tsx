import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { IconArrowDown, IconArrowLeft, IconArrowUpRight, IconCheck, IconCode, IconDeviceDesktop, IconFileCheck, IconKey, IconLock, IconRefresh, IconShieldLock, IconTrash, IconWallet } from '@tabler/icons-react';
import { Button, Input, Modal } from './ui';
import { deleteSavedSession, hasSavedSession, preparePairing, unlockSavedSession, type PendingPairing, type PendingRevocation, type WalletSession } from '../lib/auth';
import { hashPairingRequest, hashRevocationRequest, validatePairingApproval, verifyPairingApproval, validateRevocationApproval, verifyRevocationApproval, type PairingApproval, type PairingRequest, type RevocationApproval, type RevocationRequest } from '../lib/pairing';
import { approvePairingWithWallet, approveRevocationWithWallet, discoverInjectedWallets, type InjectedWallet } from '../lib/wallet';

const sourceUrl = 'https://github.com/arcabotai/hypersnap-web';
const releaseTag = 'arca-signer-v0.2.0';
const signerUrl = `${sourceUrl}/releases/download/${releaseTag}/Arca-Signer-mac-arm64.zip`;
const approvalLimitBytes = 16 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This action could not be completed.';
const fingerprint = (key: string) => key.match(/.{1,8}/g)?.join(' ') ?? key;

const mobileWalletUrl = 'https://link.metamask.io/dapp/quorum.arca.computer/';

function MobileWalletHelp({ compact = false }: { compact?: boolean }) {
  return <div className={`wallet-mobile-help ${compact ? 'wallet-mobile-help--compact' : ''}`}>
    <p>On mobile, open this site in a compatible wallet app’s browser. Select your Farcaster custody account; import it into your trusted wallet app first if needed. Brave Wallet in the Brave browser is another compatible option. Never enter recovery words on this website.</p>
    <a href={mobileWalletUrl}><IconArrowUpRight size={15} />Open in MetaMask’s browser</a>
    <small>This opens a new browser session. Find your account again there to create a fresh device key.</small>
  </div>;
}

function WalletApproval({ request, disabled, onApproved, onBusy, onError }: {
  request: PairingRequest | RevocationRequest;
  disabled: boolean;
  onApproved(approval: PairingApproval | RevocationApproval, walletName: string): void;
  onBusy(value: boolean): void;
  onError(value: string): void;
}) {
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [waiting, setWaiting] = useState('');
  const [progress, setProgress] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => discoverInjectedWallets(setWallets), [refresh]);
  useEffect(() => () => { generation.current += 1; controller.current?.abort(); }, [request.requestId]);
  async function approve(wallet: InjectedWallet) {
    if (disabled || waiting) return;
    const run = ++generation.current; controller.current?.abort(); controller.current = new AbortController(); setWaiting(wallet.id); setProgress('Connecting your custody wallet…'); onBusy(true); onError('');
    const options = { signal: controller.current.signal, onProgress: (text: string) => { if (run === generation.current) setProgress(text); } };
    try {
      const value = request.kind === 'arca.hypersnap.signer.request'
        ? await approvePairingWithWallet(request, wallet.provider, options)
        : await approveRevocationWithWallet(request, wallet.provider, options);
      if (run === generation.current) onApproved(value, wallet.name);
    } catch (cause) { if (run === generation.current) onError(errorMessage(cause)); }
    finally { if (run === generation.current) { setWaiting(''); onBusy(false); } }
  }
  return <section className="wallet-approval">
    <h3><IconWallet size={19} />Approve with your wallet</h3>
    <p>{request.kind === 'arca.hypersnap.signer.request' ? 'Connect the wallet account that owns this identity, then approve two signature requests for this device’s posting key.' : 'Connect the custody wallet and approve the signature request to revoke this device’s posting key.'} Review the FID, key, permissions, and deadline. No transaction fee is required.</p>
    {wallets.length ? <div className="wallet-list">{wallets.map(wallet => <Button key={wallet.id} variant="secondary" disabled={disabled || !!waiting} onClick={() => void approve(wallet)}>{waiting === wallet.id ? <IconRefresh size={17} className="spin" /> : <IconWallet size={17} />}<span>{waiting === wallet.id ? 'Check your wallet…' : `Connect ${wallet.name} & approve`}</span><IconArrowUpRight size={15} /></Button>)}</div> : <div className="wallet-not-found"><strong>No wallet detected in this browser.</strong><p>On desktop, enable a compatible wallet extension that supports typed-data signatures. On mobile, use the wallet’s browser.</p><Button variant="secondary" disabled={disabled} onClick={() => setRefresh(value => value + 1)}><IconRefresh size={15} />Refresh wallets</Button><MobileWalletHelp compact /></div>}
    {waiting && <><p className="pairing-copy" role="status">{progress}</p><p className="pairing-release">If you close this dialog, reject any pending request in your wallet. This website cannot close the wallet popup.</p></>}
    <p className="pairing-release">Select Ethereum Mainnet in your wallet for signing (chain ID 1). These signatures use the historical “Farcaster KeyAdd” domain to authorize this key on Hypersnap. No Farcaster login, ETH, or wallet transaction is required.</p>
    <p className="pairing-release">The connected address must match <span className="pairing-mono">{request.custodyAddress}</span>. A verified wallet address alone does not grant account access. Wallet support depends on its provider and signing capabilities.</p>
  </section>;
}

function AccountFacts({ request }: { request: PairingRequest }) {
  return <dl className="pairing-facts">
    <div><dt>Account</dt><dd>FID {request.fid}</dd></div>
    <div><dt>Custody wallet</dt><dd className="pairing-mono">{request.custodyAddress}</dd></div>
    <div><dt>Device key fingerprint</dt><dd className="pairing-mono">{fingerprint(request.publicKey)}</dd></div>
    <div><dt>Request checksum</dt><dd className="pairing-mono">{hashPairingRequest(request)}</dd></div>
    <div><dt>Permission</dt><dd>Publish casts and add or remove reactions</dd></div>
    <div><dt>Inactivity expiry</dt><dd>7 days, renewed by signing activity</dd></div>
    <div><dt>Approve before</dt><dd>{new Date((request.deadline + 1609459200) * 1000).toLocaleString()}</dd></div>
    <div><dt>Website label</dt><dd className="pairing-mono">{request.origin}<small>Self-reported; this label does not authenticate the website.</small></dd></div>
  </dl>;
}

export default function ConnectAccount({ onClose, onConnect }: { onClose(): void; onConnect(session: WalletSession): void }) {
  const [identifier, setIdentifier] = useState('');
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [approval, setApproval] = useState<PairingApproval | null>(null);
  const [approvalName, setApprovalName] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const [remember, setRemember] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef<PendingPairing | null>(null);
  const provisionalSession = useRef<WalletSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileReadGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const initialGeneration = generation.current;
    hasSavedSession().then(value => { if (active) { setSaved(value); if (generation.current === initialGeneration) setUnlock(value); } }).catch(() => { if (active) setError('Device storage could not be opened. You can connect for this tab.'); });
    return () => { active = false; generation.current += 1; controller.current?.abort(); pending.current?.dispose(); provisionalSession.current?.dispose(); };
  }, []);
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request]);
  const expired = request !== null && Math.floor(now / 1000) >= request.deadline + 1609459200;
  const passwordValid = password.length >= 12 && password === confirmation;

  function reset() {
    generation.current += 1;
    controller.current?.abort(); pending.current?.dispose(); pending.current = null;
    provisionalSession.current?.dispose(); provisionalSession.current = null;
    setRequest(null); setApproval(null); setApprovalName(''); setAttempted(false); setConnected(false);
    setPassword(''); setConfirmation(''); setError(''); setStage(''); setBusy(false);
  }
  function close() { reset(); onClose(); }
  function acceptSession(session: WalletSession, run: number) {
    if (run !== generation.current) { session.dispose(); return; }
    provisionalSession.current = null;
    setPassword(''); setConfirmation(''); onConnect(session);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const term = identifier.trim().replace(/^@/, '');
    const lookup = /^0x[\da-f]{40}$/i.test(term) ? { custodyAddress: term } : /^\d+$/.test(term) ? { fid: Number(term) } : { username: term };
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Looking up your public account…');
    try {
      const value = await preparePairing(lookup, { origin: location.origin, signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { value.dispose(); return; }
      pending.current = value; setRequest(value.request); setNow(Date.now());
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }
  function downloadRequest() {
    if (!request) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'arca-authorization-request.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importApproval(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy || attempted) return;
    const run = generation.current;
    const fileRun = ++fileReadGeneration.current;
    setError(''); setApproval(null); setApprovalName('');
    try {
      if (file.size > approvalLimitBytes) throw new Error('Approval files must be smaller than 16 KiB. Choose the JSON exported by Arca Signer.');
      const text = await file.text();
      if (run !== generation.current || fileRun !== fileReadGeneration.current) return;
      const value = validatePairingApproval(JSON.parse(text) as unknown);
      if (!request) return;
      verifyPairingApproval(request, value);
      setApproval(value); setApprovalName(file.name.slice(0, 100));
    } catch (cause) { if (run === generation.current && fileRun === fileReadGeneration.current) setError(cause instanceof SyntaxError ? 'Invalid approval file. Choose the public approval JSON exported by Arca Signer, up to 16 KiB. Never import your recovery phrase here.' : errorMessage(cause)); }
  }
  async function complete(event: FormEvent) {
    event.preventDefault();
    if (busy || !pending.current || !approval || (remember && !passwordValid && (!attempted || connected))) return;
    const run = generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setAttempted(true);
    try {
      const session = provisionalSession.current ?? await pending.current.complete(approval, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { session.dispose(); return; }
      provisionalSession.current = session; setConnected(true);
      if (remember) {
        if (!passwordValid) { setError('Authorization is confirmed. Enter and confirm a new device vault password to save this key, or continue for this tab.'); return; }
        setStage('Encrypting this device’s posting key…'); await session.saveToDevice(password);
      }
      acceptSession(session, run);
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setAttempted(pending.current?.submitted ?? false); setBusy(false); setStage(''); setPassword(''); setConfirmation(''); } }
  }
  async function unlockDevice(event: FormEvent) {
    event.preventDefault(); if (busy || !password) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Unlocking your device key…');
    try { const session = await unlockSavedSession(password, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } }); acceptSession(session, run); }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setPassword(''); } }
  }
  async function forget() {
    if (busy) return;
    const run = generation.current; setBusy(true); setError('');
    try { await deleteSavedSession(); if (run === generation.current) { setSaved(false); setUnlock(false); setPassword(''); } }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }

  return <Modal title={unlock ? 'Welcome back.' : 'Your identity. Safer sign-in.'} onClose={close}>
    <div className="pairing-hero"><span className="pairing-symbol"><IconShieldLock size={27} /></span><div><strong>Your recovery phrase stays out of this website.</strong><p>Approve a separate device key in your own wallet app.</p></div></div>
    {unlock ? <form onSubmit={unlockDevice}>
      <p className="pairing-copy">Your posting key is encrypted on this device. Unlock it to reconnect; your custody wallet is not needed.</p>
      <label className="field-label" htmlFor="device-password">Device vault password</label>
      <Input id="device-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={busy} required />
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" className="full-width pairing-submit" disabled={busy || !password}>{busy ? <><IconRefresh size={17} className="spin" />{stage}</> : <><IconLock size={17} />Unlock this device</>}</Button>
      <div className="pairing-actions"><Button variant="ghost" disabled={busy} onClick={() => { reset(); setUnlock(false); }}>Connect another account</Button><Button variant="ghost" disabled={busy} onClick={() => void forget()}><IconTrash size={15} />Forget saved key</Button></div>
      <p className="fine-print">Forgetting deletes this browser’s encrypted key. It does not revoke its network authorization. Unlock first to revoke this device.</p>
    </form> : <>
      <ol className="pairing-steps" aria-label="Connection steps"><li className={!request ? 'active' : 'complete'}><span>{request ? <IconCheck size={13} /> : '1'}</span>Find account</li><li className={request && !approval ? 'active' : approval ? 'complete' : ''}><span>{approval ? <IconCheck size={13} /> : '2'}</span>Approve key</li><li className={approval ? 'active' : ''}><span>3</span>Connect</li></ol>
      {!request ? <form onSubmit={prepare}>
        <p className="pairing-copy">Use a compatible wallet extension on desktop or a wallet app’s browser on mobile. Find your public account to create this browser’s separate posting key.</p>
        <MobileWalletHelp />
        <label className="field-label" htmlFor="account-identifier">Username, FID, or custody wallet address</label>
        <Input id="account-identifier" placeholder="@username, 1234, or 0x…" value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} disabled={busy} required />
        <p className="fine-print">Use your account’s custody wallet, which may differ from a verified wallet. Do not enter your recovery words.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" className="full-width" disabled={busy || !identifier.trim()}>{busy ? <><IconRefresh size={17} className="spin" />{stage}</> : <>Find my account <IconArrowUpRight size={17} /></>}</Button>
        {saved && <Button className="full-width pairing-back" variant="ghost" disabled={busy} onClick={() => { reset(); setUnlock(true); }}><IconLock size={16} />Unlock saved device instead</Button>}
      </form> : <>
        <AccountFacts request={request} />
        {!attempted && <WalletApproval request={request} disabled={busy || expired} onBusy={value => { setBusy(value); setStage(value ? 'Check your wallet for approval…' : ''); if (value) { setApproval(null); setApprovalName(''); } }} onError={setError} onApproved={(value, name) => { setApproval(validatePairingApproval(value)); setApprovalName(name); }} />}
        {approval && <div className="wallet-approved" role="status"><IconCheck size={18} /><span>Posting key approved{approvalName ? ` · ${approvalName}` : ''}. Submit below to register it on Hypersnap.</span></div>}
        {!attempted && <details className="pairing-advanced"><summary>Advanced: approve offline with Arca Signer</summary>
          <section className="pairing-offline"><h3><IconDeviceDesktop size={18} />Optional offline approval</h3><p>If you prefer a separate offline signer, download this public request and open it in Arca Signer. Compare the FID, custody address, complete device fingerprint, and request checksum. Enter your 24 words only in the downloaded signer, then import its public approval file below.</p>
            <div className="pairing-downloads"><Button variant="secondary" onClick={downloadRequest} disabled={busy || expired}><IconArrowDown size={16} />Download request</Button><a href={signerUrl} className="pairing-download-link"><IconArrowDown size={16} />Arca Signer for macOS</a></div>
            <p className="pairing-release">Optional v0.2.0 · macOS Apple Silicon only · <a href={`${sourceUrl}/releases/tag/${releaseTag}`} target="_blank" rel="noopener noreferrer">Release & verification</a></p>
            <p className="pairing-release">Developer ID signed beta. Apple notarization pending. Independent security audit pending. <a href={`${sourceUrl}/tree/${releaseTag}/hypersnap/signer`} target="_blank" rel="noopener noreferrer">Source & build instructions</a></p>
          </section>
          <Input ref={fileInput} type="file" accept="application/json,.json" aria-label="Import public approval JSON" className="pairing-file-input" tabIndex={-1} onChange={event => void importApproval(event)} disabled={busy || expired} />
          <Button className="full-width pairing-import" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy || expired}><IconFileCheck size={17} />Import offline public approval JSON</Button>
          <p className="pairing-release">Only the signer’s public approval JSON belongs here. It contains signatures, never recovery words or a private key.</p>
        </details>}
        <form onSubmit={complete}>
          {!attempted && <label className="pairing-remember"><Input type="checkbox" checked={remember} onChange={event => { setRemember(event.target.checked); setPassword(''); setConfirmation(''); }} disabled={busy} /><span><strong>Remember this device</strong><small>Opt in to encrypt and save only this device’s posting key.{saved ? ' Saving replaces this browser’s previous vault; its network authorization remains active.' : ''}</small></span></label>}
          {remember && <div className="pairing-passwords"><label className="field-label" htmlFor="new-device-password">New device vault password · at least 12 characters</label><Input id="new-device-password" type="password" autoComplete="new-password" value={password} minLength={12} onChange={event => setPassword(event.target.value)} disabled={busy} required /><label className="field-label" htmlFor="confirm-device-password">Confirm password</label><Input id="confirm-device-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required />{confirmation && password !== confirmation && <p className="error">Passwords do not match.</p>}<p className="fine-print">Keep this password somewhere safe. It cannot be recovered. Anyone who can unlock this vault can post as you until you revoke this key.</p></div>}
          {expired && !attempted && <p className="error" role="alert">This request expired. Start again for a fresh device key and approval.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {attempted && error && !connected && <p className="fine-print">A submission may already be registered. Check its status using the same approval. This check will not submit it again. Closing or starting again erases this tab’s device key.</p>}
          <Button type="submit" formNoValidate={attempted && !connected} className="full-width pairing-submit" disabled={busy || !approval || (expired && !attempted) || (remember && !passwordValid && (!attempted || connected))}>{busy ? <><IconRefresh size={17} className="spin" />{stage || 'Checking authorization…'}</> : connected ? 'Save encrypted key and continue' : attempted ? 'Check authorization status' : <>Submit approved device key <IconArrowUpRight size={17} /></>}</Button>
          {connected && !busy && <Button variant="ghost" className="full-width pairing-back" onClick={() => { const value = provisionalSession.current; if (value) acceptSession(value, generation.current); }}>Continue for this tab without saving</Button>}
        </form>
        <p className="pairing-release">Closing this dialog erases this tab’s pending key. A network authorization already submitted may remain active.</p>
        <Button variant="ghost" className="pairing-back" disabled={busy} onClick={reset}><IconArrowLeft size={15} />{attempted ? 'Discard local key and start again' : 'Use another account'}</Button>
      </>}
    </>}
    <a className="source-note" href={`${sourceUrl}/blob/main/hypersnap/SIGNER.md`} target="_blank" rel="noopener noreferrer"><IconCode size={15} /> How signing, storage, and revocation work <IconArrowUpRight size={13} /></a>
  </Modal>;
}

export function DeviceSettings({ session, onClose, onLock, notify }: { session: WalletSession; onClose(): void; onLock(revoked?: boolean): void; notify(text: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [stage, setStage] = useState('');
  const [request, setRequest] = useState<RevocationRequest | null>(null);
  const [approval, setApproval] = useState<RevocationApproval | null>(null);
  const [approvalName, setApprovalName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<PendingRevocation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileReadGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    hasSavedSession(session.publicKey).then(value => { if (active) setSaved(value); }).catch(() => { if (active) setError('Device storage is unavailable.'); });
    return () => { active = false; generation.current += 1; controller.current?.abort(); pending.current?.dispose(); pending.current = null; };
  }, [session.publicKey]);
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request]);
  const expired = request !== null && Math.floor(now / 1000) >= request.deadline + 1609459200;

  function resetRevocation() {
    generation.current += 1; controller.current?.abort(); pending.current?.dispose(); pending.current = null;
    setRequest(null); setApproval(null); setApprovalName(''); setAttempted(false); setBusy(false); setStage(''); setError('');
  }
  function close() { resetRevocation(); onClose(); }
  async function forget() {
    if (busy || request) return;
    const run = generation.current; setBusy(true); setError('');
    try { await deleteSavedSession(session.publicKey); if (run === generation.current) { setSaved(false); notify('Saved encrypted key deleted. This tab is still connected.'); } }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }
  async function prepareRevocation() {
    if (busy || request) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Preparing public revocation request…');
    try {
      const value = await session.prepareRevocation({ signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { value.dispose(); return; }
      pending.current = value; setRequest(value.request); setAttempted(value.submitted); setNow(Date.now());
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  function downloadRevocation() {
    if (!request || busy || expired) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'arca-revocation-request.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importRevocation(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !request || busy || attempted || expired) return;
    const run = generation.current; const fileRun = ++fileReadGeneration.current;
    setApproval(null); setApprovalName(''); setError('');
    try {
      if (file.size > approvalLimitBytes) throw new Error('Revocation approval files must be smaller than 16 KiB. Choose the public JSON exported by Arca Signer.');
      const text = await file.text();
      if (run !== generation.current || fileRun !== fileReadGeneration.current) return;
      const value = validateRevocationApproval(JSON.parse(text) as unknown);
      verifyRevocationApproval(request, value);
      setApproval(value); setApprovalName(file.name.slice(0, 100));
    } catch (cause) { if (run === generation.current && fileRun === fileReadGeneration.current) setError(cause instanceof SyntaxError ? 'Invalid revocation approval. Import the public revocation approval JSON from Arca Signer. Never import your recovery phrase here.' : errorMessage(cause)); }
  }
  async function completeRevocation(event: FormEvent) {
    event.preventDefault();
    if (busy || !pending.current || (!approval && !attempted) || (expired && !attempted)) return;
    const run = generation.current;
    controller.current = new AbortController(); setBusy(true); setError('');
    try {
      await pending.current.complete(approval ?? undefined, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      // Parent compares this session's key with the active session, so a late
      // confirmed revocation cannot lock an unrelated replacement session.
      onLock(true);
      notify('This device’s network authorization was revoked and its saved key was deleted.');
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setAttempted(pending.current?.submitted ?? false); setBusy(false); setStage(''); } }
  }
  return <Modal title="This device’s access" onClose={close}>
    <div className="pairing-hero"><span className="pairing-symbol"><IconKey size={27} /></span><div><strong>@{session.user.username || session.fid}</strong><p>FID {session.fid} · casting and reactions</p></div></div>
    <dl className="pairing-facts"><div><dt>Device key fingerprint</dt><dd className="pairing-mono">{fingerprint(session.publicKey)}</dd></div><div><dt>Storage</dt><dd>{saved ? 'Encrypted key saved in this browser' : 'Key held only in this tab'}</dd></div><div><dt>Inactivity expiry</dt><dd>7 days, renewed by signing activity</dd></div></dl>
    {!request && <>
      <div className="device-action"><div><strong>Lock this tab</strong><p>Clear its active signing key. A saved vault can be unlocked again. Network authorization remains active.</p></div><Button variant="secondary" onClick={() => onLock()} disabled={busy}><IconLock size={16} />Lock</Button></div>
      {saved && <div className="device-action"><div><strong>Forget saved key</strong><p>Delete this browser’s encrypted copy. This tab stays connected; network authorization remains active.</p></div><Button variant="secondary" onClick={() => void forget()} disabled={busy}><IconTrash size={16} />Forget</Button></div>}
      <div className="device-action device-action--revoke"><div><strong>Revoke this device</strong><p>Approve its removal in your custody wallet. We confirm removal on Hypersnap before clearing this key. Other device keys and legacy beta keys are unaffected.</p></div><Button variant="secondary" disabled={busy} onClick={() => void prepareRevocation()}>{busy ? <IconRefresh size={16} className="spin" /> : <IconShieldLock size={16} />}Revoke</Button></div>
    </>}
    {request && <section className="revocation-panel">
      <h3><IconShieldLock size={18} />{attempted ? 'Confirm this device’s removal' : 'Approve this device’s removal'}</h3>
      {!attempted && <p className="pairing-copy">Check the <strong>Revoke device</strong> action, FID, custody wallet, and complete key fingerprint before approving removal in your wallet app.</p>}
      <dl className="pairing-facts"><div><dt>Action</dt><dd>Revoke this device’s casting and reaction permissions</dd></div><div><dt>FID</dt><dd>{request.fid}</dd></div><div><dt>Custody wallet</dt><dd className="pairing-mono">{request.custodyAddress}</dd></div><div><dt>Key to revoke</dt><dd className="pairing-mono">{fingerprint(request.publicKey)}</dd></div><div><dt>Request checksum</dt><dd className="pairing-mono">{hashRevocationRequest(request)}</dd></div><div><dt>Approve before</dt><dd>{new Date((request.deadline + 1609459200) * 1000).toLocaleString()}</dd></div><div><dt>Website label</dt><dd className="pairing-mono">{request.origin}<small>Self-reported; this label does not authenticate the website.</small></dd></div></dl>
      {!attempted && <WalletApproval request={request} disabled={busy || expired} onBusy={value => { setBusy(value); setStage(value ? 'Check your wallet for approval…' : ''); if (value) { setApproval(null); setApprovalName(''); } }} onError={setError} onApproved={(value, name) => { setApproval(validateRevocationApproval(value)); setApprovalName(name); }} />}
      {approval && !attempted && <div className="wallet-approved" role="status"><IconCheck size={18} /><span>Removal approved{approvalName ? ` · ${approvalName}` : ''}. Submit below to revoke this device on Hypersnap.</span></div>}
      {!attempted && <details className="pairing-advanced"><summary>Advanced: approve revocation offline</summary>
        <p className="pairing-copy">Download the public revocation request and open it in Arca Signer. Compare its action, FID, custody address, device key, and checksum. Import the signer’s public approval below. Enter recovery words only in the downloaded signer.</p>
        <div className="pairing-downloads"><Button variant="secondary" disabled={busy || expired} onClick={downloadRevocation}><IconArrowDown size={16} />Download revocation request</Button><a href={signerUrl} className="pairing-download-link"><IconArrowDown size={16} />Arca Signer for macOS</a></div>
        <p className="pairing-release">Optional v0.2.0 · macOS Apple Silicon only · Developer ID signed beta. Apple notarization and independent security audit pending. <a href={`${sourceUrl}/releases/tag/${releaseTag}`} target="_blank" rel="noopener noreferrer">Release & verification</a></p>
        <Input ref={fileInput} type="file" accept="application/json,.json" aria-label="Import public revocation approval JSON" className="pairing-file-input" tabIndex={-1} onChange={event => void importRevocation(event)} disabled={busy || expired} />
        <Button variant="secondary" className="full-width pairing-import" disabled={busy || expired} onClick={() => fileInput.current?.click()}><IconFileCheck size={17} />Import offline revocation approval JSON</Button>
        <p className="pairing-release">Only the signer’s public approval JSON belongs here. It contains a signature, never recovery words or a private key.</p>
      </details>}
      <form onSubmit={completeRevocation}>
        {expired && !attempted && <p className="error" role="alert">This revocation request expired. Cancel it and prepare a new request; your device remains connected.</p>}
        {attempted && <p className="fine-print">The removal was already submitted, or the node reports that the key is absent. This check reads network status; no second submission is sent. Your key and saved vault stay available until removal is confirmed.</p>}
        <Button className="full-width pairing-submit" type="submit" disabled={busy || (!approval && !attempted) || (expired && !attempted)}>{busy ? <><IconRefresh size={16} className="spin" />{stage || 'Checking revocation…'}</> : attempted ? 'Check revocation status' : 'Submit revocation and confirm removal'}</Button>
      </form>
      <Button className="full-width pairing-back" variant="ghost" disabled={busy} onClick={resetRevocation}>{attempted ? 'Close request; keep local key' : 'Cancel revocation; keep this device'}</Button>
      <p className="pairing-release">Closing a request does not undo a network submission. If its outcome is uncertain, keep the local key and check status before creating another request.</p>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && !request && <p className="pairing-copy" role="status">{stage}</p>}
    <a className="source-note" href={`${sourceUrl}/blob/main/hypersnap/SIGNER.md`} target="_blank" rel="noopener noreferrer"><IconCode size={15} /> How device revocation works <IconArrowUpRight size={13} /></a>
  </Modal>;
}
