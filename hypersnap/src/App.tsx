import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { IconArrowDown, IconArrowLeft, IconArrowUpRight, IconBookmark, IconChevronRight, IconCode, IconCompass, IconCopy, IconHash, IconHeart, IconHome, IconKey, IconLock, IconMessageCircle, IconMoon, IconRefresh, IconRepeat, IconSearch, IconShieldLock, IconSparkles, IconSun, IconUsers, IconWorld, IconX } from '@tabler/icons-react';
import { Button, Input, Modal } from './components/ui';
import { getFeed, getUser, getInfo, getConversation, type Cast, type User, type ConversationNode } from './lib/api';
import type { WalletSession } from './lib/auth';

const ConnectAccount = lazy(() => import('./components/ConnectAccount'));
const DeviceSettings = lazy(() => import('./components/ConnectAccount').then(module => ({ default: module.DeviceSettings })));

type View = 'discover' | 'following' | 'bookmarks' | 'channel' | 'profile';
const channels = [{ id: 'quilibrium', name: 'Quilibrium', mark: 'Q' }, { id: 'farcaster', name: 'Farcaster', mark: 'F' }, { id: 'dev', name: 'Developers', mark: '</>' }, { id: 'art', name: 'Art & creativity', mark: '✳' }, { id: 'crypto', name: 'Crypto', mark: 'Ξ' }];
const sourceUrl = 'https://github.com/arcabotai/hypersnap-web';
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const short = (value: number = 0) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function safeUrl(value?: string): string | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}
function relativeTime(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function Avatar({ user, large = false }: { user?: User; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const url = safeUrl(user?.pfp_url);
  return <span className={`avatar ${large ? 'avatar--large' : ''}`}>{url && !broken ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : (user?.display_name || user?.username || 'Q').slice(0, 2).toUpperCase()}</span>;
}
function CastText({ text }: { text: string }) {
  return <>{text.split(/(https:\/\/[^\s]+)/g).map((part, i) => part.startsWith('https://') ? <a key={i} href={safeUrl(part)} target="_blank" rel="noopener noreferrer">{part.length > 65 ? `${part.slice(0, 62)}…` : part}</a> : part)}</>;
}
function CastCard({ cast, onProfile, onThread, session, onSignIn, saved, onSave, notify }: { cast: Cast; onProfile(user: User): void; onThread(cast: Cast): void; session: WalletSession | null; onSignIn(): void; saved: boolean; onSave(cast: Cast): void; notify(text: string): void }) {
  const [liked, setLiked] = useState(false);
  const [recasted, setRecasted] = useState(false);
  const [pending, setPending] = useState(false);
  async function react(type: 'like' | 'recast') {
    if (!session) { onSignIn(); return; }
    setPending(true);
    const remove = type === 'like' ? liked : recasted;
    try { await session.react({ fid: cast.author.fid, hash: cast.hash }, type, remove); if (type === 'like') setLiked(!liked); else setRecasted(!recasted); }
    catch (error) { notify(message(error)); }
    finally { setPending(false); }
  }
  return <article className="cast">
    <Button className="avatar-button" variant="ghost" aria-label={`View ${cast.author.username}'s profile`} onClick={() => onProfile(cast.author)}><Avatar user={cast.author} /></Button>
    <div className="cast__body">
      <div className="cast__meta"><Button variant="ghost" className="author" onClick={() => onProfile(cast.author)}>{cast.author.display_name || cast.author.username || `FID ${cast.author.fid}`}</Button><span className="handle">@{cast.author.username || cast.author.fid}</span><span className="dot">·</span><time dateTime={cast.timestamp} title={new Date(cast.timestamp).toLocaleString()}>{relativeTime(cast.timestamp)}</time>{cast.channel && <span className="channel-tag">/{cast.channel.id}</span>}</div>
      <p className="cast__text"><CastText text={cast.text} /></p>
      {cast.embeds?.filter((embed): embed is { url: string } => 'url' in embed && !!safeUrl(embed.url)).slice(0, 2).map(embed => /\.(png|jpe?g|webp|gif)(\?|$)|imagedelivery\.net|imagedelivery\.cloud/i.test(embed.url) ? <a href={embed.url} key={embed.url} target="_blank" rel="noopener noreferrer" className="embed"><img src={embed.url} loading="lazy" alt="Image attached to cast" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /></a> : <a className="link-embed" key={embed.url} href={embed.url} target="_blank" rel="noopener noreferrer"><IconWorld size={18} /><span>{new URL(embed.url).hostname}<small>{embed.url.slice(0, 80)}</small></span><IconArrowUpRight size={17} /></a>)}
      <div className="cast__actions">
        <Button variant="ghost" aria-label="Open replies" onClick={() => onThread(cast)}><IconMessageCircle size={18} /><span>{short(cast.replies?.count)}</span></Button>
        <Button variant="ghost" aria-label={recasted ? 'Undo recast' : 'Recast'} aria-pressed={recasted} disabled={pending} className={recasted ? 'is-recasted' : ''} onClick={() => void react('recast')}><IconRepeat size={18} /><span>{short((cast.reactions?.recasts_count ?? 0) + Number(recasted))}</span></Button>
        <Button variant="ghost" aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked} disabled={pending} className={liked ? 'is-liked' : ''} onClick={() => void react('like')}><IconHeart size={18} fill={liked ? 'currentColor' : 'none'} /><span>{short((cast.reactions?.likes_count ?? 0) + Number(liked))}</span></Button>
        <Button variant="ghost" aria-label={saved ? 'Remove bookmark' : 'Bookmark cast'} aria-pressed={saved} className={saved ? 'is-saved' : ''} onClick={() => onSave(cast)}><IconBookmark size={18} fill={saved ? 'currentColor' : 'none'} /></Button>
        <Button variant="ghost" aria-label="Copy cast link" onClick={() => { void navigator.clipboard.writeText(`https://quorum.arca.computer/?cast=${encodeURIComponent(cast.hash)}`).then(() => notify('Cast link copied')).catch(() => notify('Could not copy the link.')); }}><IconCopy size={17} /></Button>
      </div>
    </div>
  </article>;
}
function Composer({ session, onSignIn, onPosted, parent, notify }: { session: WalletSession | null; onSignIn(): void; onPosted(): void; parent?: Cast; notify(text: string): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bytes = new TextEncoder().encode(text).length;
  async function publish() {
    if (!session) { onSignIn(); return; }
    setBusy(true);
    try { await session.cast(text, parent ? { fid: parent.author.fid, hash: parent.hash } : undefined); setText(''); notify(parent ? 'Reply submitted to Hypersnap. It may take a moment to appear.' : 'Cast submitted to Hypersnap. It may take a moment to appear.'); onPosted(); }
    catch (error) { notify(message(error)); }
    finally { setBusy(false); }
  }
  return <div className="composer"><Avatar user={session?.user} /><div className="composer__body">
    {session ? <textarea aria-label={parent ? 'Write a reply' : 'Write a cast'} placeholder={parent ? `Reply to @${parent.author.username}…` : 'What’s on your mind?'} value={text} onChange={event => setText(event.target.value)} disabled={busy} rows={3} /> : <Button variant="ghost" className="composer__prompt" onClick={onSignIn}>What’s on your mind?</Button>}
    <div className="composer__footer"><span><IconWorld size={15} /> {parent ? 'Public reply' : 'An open conversation starts here'}</span><div className="composer__submit">{session && <span className={bytes > 1024 ? 'error' : 'muted'}>{bytes}/1024</span>}<Button disabled={busy || (!!session && (!text.trim() || bytes > 1024))} onClick={() => void publish()}>{busy ? 'Publishing…' : parent ? 'Reply' : 'Cast'} <IconArrowUpRight size={16} /></Button></div></div>
  </div></div>;
}

export default function App() {
  const [view, setView] = useState<View>('discover');
  const [channel, setChannel] = useState(channels[0].id);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [deviceSettings, setDeviceSettings] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState('');
  const [thread, setThread] = useState<Cast | null>(null);
  const [conversation, setConversation] = useState<ConversationNode | null>(null);
  const [threadError, setThreadError] = useState('');
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [bookmarks, setBookmarks] = useState<Cast[]>(() => { try { return JSON.parse(localStorage.getItem('quorum.bookmarks.v1') || '[]'); } catch { return []; } });
  const [dark, setDark] = useState(() => localStorage.getItem('quorum.theme') !== 'light');
  const feedGeneration = useRef(0);
  const currentSession = useRef(session);
  currentSession.current = session;
  const notify = useCallback((text: string) => setToast(text), []);
  const openProfile = useCallback((user: User) => { setProfile(user); setView('profile'); setThread(null); }, []);
  const activeTitle = view === 'profile' ? profile?.display_name || profile?.username || 'Profile' : view === 'channel' ? channels.find(item => item.id === channel)?.name || channel : view === 'following' ? 'Following' : view === 'bookmarks' ? 'Bookmarks' : 'Discover';

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('quorum.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => currentSession.current?.dispose(), []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view, channel, profile?.fid]);
  useEffect(() => {
    const controller = new AbortController();
    getInfo(controller.signal).then(data => { setInfo(data as Record<string, unknown>); setNetworkError(false); }).catch(() => { if (!controller.signal.aborted) setNetworkError(true); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    feedGeneration.current += 1;
    setError(''); setCasts([]); setCursor(null); setLoadingMore(false);
    if (view === 'bookmarks' || (view === 'following' && !session)) { setLoading(false); return; }
    setLoading(true);
    getFeed({ kind: view === 'profile' ? 'user' : view === 'channel' ? 'channel' : view === 'following' ? 'following' : 'trending', fid: view === 'profile' ? profile?.fid : session?.fid, channel, limit: 25, signal: controller.signal })
      .then(data => { setCasts(data.casts); setCursor(data.next?.cursor || null); })
      .catch(error => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, channel, session, profile?.fid, refresh]);
  useEffect(() => {
    if (!thread) return;
    const controller = new AbortController(); setConversation(null); setThreadError('');
    getConversation(thread.hash, controller.signal).then(setConversation).catch(error => { if (!controller.signal.aborted) setThreadError(message(error)); });
    return () => controller.abort();
  }, [thread, refresh]);
  useEffect(() => {
    const hash = new URLSearchParams(location.search).get('cast');
    if (!hash) return;
    const controller = new AbortController();
    getConversation(hash, controller.signal).then(data => setThread(data.cast)).catch(error => { if (!controller.signal.aborted) notify(message(error)); });
    return () => controller.abort();
  }, [notify]);

  function lockSession(expectedSession = session, revoked = false) {
    if (!expectedSession || currentSession.current?.publicKey !== expectedSession.publicKey) return;
    expectedSession.dispose(); setSession(null); setDeviceSettings(false);
    if (!revoked) notify('This tab is locked. Network authorization remains active; unlock a saved vault or approve a new device key to reconnect.');
  }
  function save(cast: Cast) {
    const next = bookmarks.some(item => item.hash === cast.hash) ? bookmarks.filter(item => item.hash !== cast.hash) : [cast, ...bookmarks].slice(0, 200);
    setBookmarks(next); try { localStorage.setItem('quorum.bookmarks.v1', JSON.stringify(next)); } catch { notify('Browser storage is full. Bookmarks will last for this tab.'); }
  }
  async function search(event: FormEvent) {
    event.preventDefault(); if (!query.trim()) return; setSearching(true);
    const term = query.trim().replace(/^@/, '');
    try { openProfile(await getUser(/^\d+$/.test(term) ? { fid: Number(term) } : { username: term })); setQuery(''); }
    catch (error) { notify(message(error)); }
    finally { setSearching(false); }
  }
  async function loadMore() {
    if (!cursor || loadingMore) return; setLoadingMore(true);
    const generation = feedGeneration.current;
    try {
      const data = await getFeed({ kind: view === 'profile' ? 'user' : view === 'channel' ? 'channel' : view === 'following' ? 'following' : 'trending', fid: view === 'profile' ? profile?.fid : session?.fid, channel, cursor, limit: 25 });
      if (generation !== feedGeneration.current) return;
      setCasts(previous => [...previous, ...data.casts.filter(cast => !previous.some(item => item.hash === cast.hash))]); setCursor(data.next?.cursor || null);
    } catch (error) { notify(message(error)); }
    finally { if (generation === feedGeneration.current) setLoadingMore(false); }
  }
  const card = (cast: Cast) => <CastCard key={`${session?.publicKey ?? 'guest'}:${cast.hash}`} cast={cast} session={session} onSignIn={() => setSignIn(true)} onProfile={openProfile} onThread={setThread} saved={bookmarks.some(item => item.hash === cast.hash)} onSave={save} notify={notify} />;
  const visibleCasts = view === 'bookmarks' ? bookmarks : casts;
  return <div className="app">
    <aside className="rail" aria-label="App rail"><a href="/" className="rail__logo" aria-label="Quorum home"><img src="/quorum-symbol.svg" alt="" /></a><div className="rail__divider" /><Button variant="ghost" className="rail__active" aria-label="Hypersnap" onClick={() => setView('discover')}><IconWorld size={25} /></Button><a className="rail__link" href="https://hypersnap.org" target="_blank" rel="noopener noreferrer" aria-label="About Hypersnap"><IconCompass size={24} /></a><div className="rail__bottom"><Button variant="ghost" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}>{dark ? <IconSun size={23} /> : <IconMoon size={23} />}</Button><a className="rail__link" href={sourceUrl} aria-label="Source code" target="_blank" rel="noopener noreferrer"><IconCode size={23} /></a></div></aside>
    <aside className="sidebar">
      <a href="/" className="wordmark">Quorum<span>by arca</span></a>
      <div className="network-label"><span className="status-dot" /> HYPERSNAP <span className="beta">BETA</span></div>
      <nav aria-label="Main navigation">
        <Button variant="ghost" className={`nav-item ${view === 'discover' ? 'active' : ''}`} onClick={() => setView('discover')}><IconCompass size={21} />Discover <IconSparkles size={15} className="nav-spark" /></Button>
        <Button variant="ghost" className={`nav-item ${view === 'following' ? 'active' : ''}`} onClick={() => setView('following')}><IconUsers size={21} />Following</Button>
        <Button variant="ghost" className={`nav-item ${view === 'bookmarks' ? 'active' : ''}`} onClick={() => setView('bookmarks')}><IconBookmark size={21} />Bookmarks {bookmarks.length > 0 && <span className="nav-count">{bookmarks.length}</span>}</Button>
        {session && <Button variant="ghost" className={`nav-item ${view === 'profile' && profile?.fid === session.fid ? 'active' : ''}`} onClick={() => openProfile(session.user)}><Avatar user={session.user} />My profile</Button>}
      </nav>
      <div className="sidebar__section-label">EXPLORE CHANNELS <IconHash size={14} /></div>
      <nav aria-label="Channels">{channels.map(item => <Button key={item.id} variant="ghost" className={`channel-nav ${view === 'channel' && channel === item.id ? 'active' : ''}`} onClick={() => { setChannel(item.id); setView('channel'); }}><span className="channel-mark">{item.mark}</span>{item.name}</Button>)}</nav>
      <div className="sidebar__bottom">{session ? <div className="session-card"><Button variant="ghost" className="session-user" onClick={() => openProfile(session.user)}><Avatar user={session.user} /><span><strong>{session.user.display_name || session.user.username}</strong><small>@{session.user.username}</small></span></Button><Button variant="ghost" aria-label="Manage this device’s signing access" onClick={() => setDeviceSettings(true)}><IconShieldLock size={19} /></Button></div> : <><div className="sidebar-invite"><IconWorld size={21} /><p>The social web,<br /><strong>on your terms.</strong></p></div><Button className="full-width" onClick={() => setSignIn(true)}>Connect Farcaster <IconArrowUpRight size={17} /></Button></>}<p className="sidebar-foot">OPEN PROTOCOL. OPEN POSSIBILITIES.</p></div>
    </aside>
    <main className="main">
      <header className="page-header"><div><span className="eyebrow">YOUR CORNER OF THE OPEN SOCIAL WEB</span><h1>{activeTitle}<span className="title-star">✳</span></h1></div><div className="header-actions"><span className="live-pill"><span className={`status-dot ${networkError ? 'status-dot--offline' : ''}`} />{networkError ? 'Node unavailable' : info ? 'Live on Hypersnap' : 'Connecting'}</span><Button variant="ghost" aria-label="Refresh feed" onClick={() => setRefresh(n => n + 1)}><IconRefresh size={19} className={loading ? 'spin' : ''} /></Button><Button className="mobile-connect" variant="secondary" onClick={() => session ? openProfile(session.user) : setSignIn(true)}>{session ? 'My profile' : 'Connect'}</Button></div></header>
      <div className="compact-tools"><form className="search" onSubmit={search}><IconSearch size={18} /><Input aria-label="Find a username or FID" placeholder="Find a username or FID" value={query} onChange={event => setQuery(event.target.value)} disabled={searching} /><Button variant="ghost" type="submit" disabled={searching} aria-label="Find profile"><IconChevronRight size={18} /></Button></form><nav className="channel-chips" aria-label="Explore channels">{channels.map(item => <Button key={item.id} variant="ghost" className={view === 'channel' && channel === item.id ? 'active' : ''} onClick={() => { setChannel(item.id); setView('channel'); }}>/{item.id}</Button>)}</nav></div>
      {view === 'discover' && <section className="welcome"><div className="welcome__copy"><span className="eyebrow"><IconSparkles size={14} /> A LITTLE MORE OPEN</span><h2>Good conversations.<br /><span>No gatekeepers.</span></h2><p>Your people, your identity, your voice.<br />A familiar social world, on a network we all own.</p><a href="https://hypersnap.org" target="_blank" rel="noopener noreferrer">Meet Hypersnap <IconArrowUpRight size={16} /></a></div><div className="orbit" aria-hidden="true"><div className="orbit__ring orbit__ring--one" /><div className="orbit__ring orbit__ring--two" /><div className="orbit__ring orbit__ring--three" /><div className="orbit__core"><img src="/quorum-symbol.svg" alt="" /></div><span className="orbit__point orbit__point--a" /><span className="orbit__point orbit__point--b" /><span className="orbit__point orbit__point--c" /><span className="orbit__star">✳</span></div></section>}
      {view === 'profile' && profile && <section className="profile"><Button variant="ghost" onClick={() => setView('discover')}><IconArrowLeft size={17} /> Back to discover</Button><Avatar user={profile} large /><h2>{profile.display_name || profile.username}</h2><p className="muted">@{profile.username} <span>· FID {profile.fid}</span></p><p className="profile__bio">{profile.profile?.bio?.text || 'A voice on the open social web.'}</p><div className="profile__counts"><span><strong>{short(profile.following_count)}</strong> following</span><span><strong>{short(profile.follower_count)}</strong> followers</span></div>{session?.fid === profile.fid && <div className="profile-device-actions"><Button variant="secondary" className="profile-signout" onClick={() => setDeviceSettings(true)}><IconShieldLock size={17} /> Device access</Button><Button variant="ghost" className="profile-signout" onClick={() => lockSession()}><IconLock size={17} /> Lock this tab</Button></div>}</section>}
      {view !== 'bookmarks' && view !== 'profile' && view !== 'channel' && <Composer session={session} onSignIn={() => setSignIn(true)} onPosted={() => setRefresh(n => n + 1)} notify={notify} />}
      <div className="feed-heading"><div><IconHome size={17} /><span>{view === 'discover' ? 'Around the network' : view === 'bookmarks' ? 'Saved for later' : view === 'profile' ? 'Casts' : view === 'following' ? 'From your people' : `/${channel}`}</span></div><span>{view === 'discover' ? <><IconSparkles size={13} /> Trending</> : view === 'bookmarks' ? 'Stored on this device' : 'Latest casts'}</span></div>
      {loading ? <div aria-label="Loading casts" role="status" className="skeleton-list">{[0, 1, 2].map(n => <div className="skeleton-cast" key={n}><span className="skeleton-avatar" /><div><span /><span /><span /></div></div>)}<p className="muted">Finding conversations on Hypersnap…</p></div> : error ? <div className="empty"><IconWorld size={35} /><h3>The network is taking a moment.</h3><p>{error}</p><Button variant="secondary" onClick={() => setRefresh(n => n + 1)}><IconRefresh size={16} />Try again</Button></div> : view === 'following' && !session ? <div className="empty"><IconUsers size={35} /><h3>Your people are here.</h3><p>Connect your Farcaster wallet to see casts from the people you follow.</p><Button onClick={() => setSignIn(true)}>Connect Farcaster <IconArrowUpRight size={16} /></Button></div> : visibleCasts.length ? <div className="feed">{visibleCasts.map(card)}{cursor && view !== 'bookmarks' && <Button variant="secondary" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'More conversations'}<IconArrowDown size={16} /></Button>}<p className="feed-end">You’re connected to the open social web. <IconWorld size={13} /></p></div> : <div className="empty"><IconBookmark size={35} /><h3>{view === 'bookmarks' ? 'A place for the good stuff.' : 'The conversation is open.'}</h3><p>{view === 'bookmarks' ? 'Tap the bookmark on any cast to save it here.' : 'No casts returned for this feed yet. Try another channel or start a conversation.'}</p>{cursor && <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Check next page'}<IconArrowDown size={16} /></Button>}</div>}
    </main>
    <aside className="rightbar">
      <form className="search" onSubmit={search}><IconSearch size={18} /><Input aria-label="Find a Farcaster username or FID" placeholder="Find a username or FID" value={query} onChange={event => setQuery(event.target.value)} disabled={searching} /><Button variant="ghost" type="submit" disabled={searching} aria-label="Search profiles"><IconChevronRight size={18} /></Button></form>
      {!session && <section className="join-card"><span className="tiny-icon"><IconWorld size={23} /></span><h2>You already belong.</h2><p>Your Farcaster identity works here.<br />Bring your profile. Find your people.<br />Make yourself heard.</p><Button className="full-width" onClick={() => setSignIn(true)}>Connect your wallet <IconArrowUpRight size={17} /></Button><span className="join-card__note"><IconShieldLock size={13} /> Recovery words stay outside this site.</span></section>}
      <section className="network-card"><div className="card-label">A NETWORK, NOT A PLATFORM <IconWorld size={16} /></div><div className="node-status"><span className={`status-dot ${networkError ? 'status-dot--offline' : ''}`} /><strong>{networkError ? 'Node unavailable' : info ? 'Connected to Hypersnap' : 'Checking the network…'}</strong></div><p>haatz.quilibrium.com</p><div className="network-facts"><div><span>Protocol</span><strong>Farcaster-compatible</strong></div><div><span>Ownership</span><strong>Community-run</strong></div><div><span>Access</span><strong>Open to everyone <IconArrowUpRight size={12} /></strong></div></div><a href="https://hypersnap.org/docs" target="_blank" rel="noopener noreferrer">Explore the protocol <IconArrowUpRight size={15} /></a></section>
      <section className="open-card"><IconCode size={23} /><h3>Built in the open.</h3><p>A Quorum fork by Arca. Powered by Hypersnap, made for everyone.</p><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Read the source <IconArrowUpRight size={14} /></a></section>
      <footer><a href="https://hypersnap.org" target="_blank" rel="noopener noreferrer">Hypersnap</a><a href="https://www.quorummessenger.com" target="_blank" rel="noopener noreferrer">Quorum</a><a href={`${sourceUrl}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">AGPL-3.0</a><span>Made for the open internet <span className="footer-star">✳</span></span></footer>
    </aside>
    <nav className="mobile-nav" aria-label="Mobile navigation"><Button variant="ghost" aria-label="Discover" onClick={() => setView('discover')}><IconCompass /></Button><Button variant="ghost" aria-label="Following" onClick={() => setView('following')}><IconUsers /></Button><Button variant="ghost" aria-label="Bookmarks" onClick={() => setView('bookmarks')}><IconBookmark /></Button><Button variant="ghost" aria-label="Account" onClick={() => session ? openProfile(session.user) : setSignIn(true)}><IconKey /></Button></nav>
    {toast && <div className="toast" role="status"><span>{toast}</span><Button variant="ghost" aria-label="Dismiss notification" onClick={() => setToast('')}><IconX size={17} /></Button></div>}
    {signIn && <Suspense fallback={<Modal title="Connect your identity" onClose={() => setSignIn(false)}><p className="pairing-copy" role="status">Loading device sign-in…</p></Modal>}><ConnectAccount onClose={() => setSignIn(false)} onConnect={value => { session?.dispose(); setSession(value); setSignIn(false); notify(`Welcome, @${value.user.username || value.fid}. You’re connected to Hypersnap.`); }} /></Suspense>}
    {deviceSettings && session && <Suspense fallback={<Modal title="This device’s access" onClose={() => setDeviceSettings(false)}><p role="status">Loading device settings…</p></Modal>}><DeviceSettings session={session} onClose={() => setDeviceSettings(false)} onLock={revoked => lockSession(session, revoked)} notify={notify} /></Suspense>}
    {thread && <Modal title="Conversation" onClose={() => setThread(null)} wide>{card(conversation?.cast || thread)}<Composer session={session} onSignIn={() => { setThread(null); setSignIn(true); }} onPosted={() => setRefresh(n => n + 1)} parent={thread} notify={notify} />{threadError ? <p className="error">{threadError}</p> : conversation ? conversation.replies.length ? conversation.replies.map(node => card(node.cast)) : <p className="thread-empty">The first reply could be yours.</p> : <p className="thread-empty">Loading replies…</p>}</Modal>}
  </div>;
}
