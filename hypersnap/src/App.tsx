import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { IconSettings, IconKeyboard, IconBell, IconQuote, IconDots, IconTrash, IconArrowDown, IconArrowLeft, IconArrowUpRight, IconBookmark, IconChevronRight, IconCode, IconCompass, IconHash, IconHeart, IconHistory, IconHome, IconKey, IconLock, IconMessageCircle, IconMoon, IconRefresh, IconRepeat, IconSearch, IconShare, IconShieldLock, IconSparkles, IconSun, IconUsers, IconWorld, IconX } from '@tabler/icons-react';
import { Button, Input, Modal } from './components/ui';
import { getFeed, getProfileFeed, hasImageEmbed, getCast, getChannels, getChannel, getUser, getInfo, getConversation, type Channel, type Cast, type User, type ConversationNode } from './lib/api';
import type { WalletSession } from './lib/auth';
import { castPath, parseRoute, parseLocalPath, routePath, searchPath, profilePath, publicUrl, type AppRoute } from './lib/navigation';
import { ShareCastDialog } from './components/ShareCast';
import FollowButton from './components/FollowButton';
import FollowListDialog from './components/FollowListDialog';
import EditProfileDialog from './components/EditProfileDialog';
import { getFollows, getFollowStatus } from './lib/api';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES } from './lib/pairing';
import { uploadMedia } from './lib/media';
import { renderMentionSegments } from './lib/content';
import { SearchView, NotificationsView, ChannelsView, ChannelHeader, ProfileTabs } from './components/FeaturePanels';
import DeleteCastDialog from './components/DeleteCastDialog';
import Composer from './components/Composer';
import CastReactions from './components/CastReactions';
import MediaViewer, { type CastImage } from './components/MediaViewer';
import CastOptions from './components/CastOptions';
import { SuggestedPeople, ChannelPeopleDialog, CastQuotesDialog } from './components/CommunityPanels';
import { ProfileDetails, ShareProfileDialog } from './components/ProfileDetails';
import { readChannelPins, writeChannelPins, toggleChannelPin } from './lib/channelPins';
import BookmarkTools from './components/BookmarkTools';
import { readBookmarks, saveBookmarks, toggleBookmark, filterBookmarks, bookmarkHash, type BookmarkSort } from './lib/bookmarks';
import { contentPreferencesKey, emptyContentPreferences, readContentPreferences, writeContentPreferences, getContentFilterReason, hideCast, muteAccount, type ContentPreferences } from './lib/contentPreferences';
import { useNavigationShortcuts } from './lib/useNavigationShortcuts';
import { textLinks } from './lib/textLinks';
import './familiar.scss';
import './cast-features.scss';

const ContentSettings = lazy(() => import('./components/ContentSettings'));
const CastReactionPeople = lazy(() => import('./components/CastReactionPeople'));
const ContentControls = createContext<{ preferences: ContentPreferences; revealed: ReadonlySet<string>; reveal(hash: string): void }>({ preferences: emptyContentPreferences(), revealed: new Set(), reveal() {} });
const DevLog = lazy(() => import('./components/DevLog'));
const ConnectAccount = lazy(() => import('./components/ConnectAccount'));
const DeviceSettings = lazy(() => import('./components/ConnectAccount').then(module => ({ default: module.DeviceSettings })));

type FeedRoute = Exclude<AppRoute, { kind: 'cast' }>;
function backgroundLocation(): FeedRoute {
  const path: unknown = history.state?.quorumBackground;
  if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) {
    const parsed = parseLocalPath(path);
    if (parsed.kind !== 'cast' && parsed.kind !== 'not-found') return parsed;
  }
  return { kind: 'discover' };
}
function localClick(event: MouseEvent<HTMLAnchorElement>, action: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); action();
}
const sourceUrl = 'https://github.com/arcabotai/hypersnap-web';
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const short = (value: number = 0) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function safeUrl(value?: string): string | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function relativeTime(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function Avatar({ user, large = false }: { user?: User; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState('');
  const url = safeUrl(user?.pfp_url);
  return <span className={`avatar ${large ? 'avatar--large' : ''}`}>{url && failedUrl !== url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : (user?.display_name || user?.username || 'Q').slice(0, 2).toUpperCase()}</span>;
}
function LinkedText({ text }: { text: string }) {
  return <>{textLinks(text).map((part, i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text.length > 65 ? `${part.text.slice(0, 62)}…` : part.text}</a> : part.text)}</>;
}
function CastText({ cast, onProfile }: { cast: Cast; onProfile(user: User): void }) {
  return <>{renderMentionSegments(cast).map((segment, index) => segment.kind === 'text' ? <LinkedText key={index} text={segment.text} /> : <a className="cast-mention" key={index} href={profilePath(segment.user.fid)} onClick={event => localClick(event, () => onProfile(segment.user))}>@{segment.user.username || segment.user.fid}</a>)}</>;
}
function ConversationReplies({ nodes, renderCard }: { nodes: ConversationNode[]; renderCard(cast: Cast): ReactNode }) {
  let remaining = 150;
  const render = (items: ConversationNode[], depth: number): ReactNode => items.slice(0, 150).map(node => {
    if (remaining-- <= 0) return null;
    return <section key={node.cast.hash} className="conversation-reply">{renderCard(node.cast)}{depth < 5 && node.replies?.length > 0 && <div className="conversation-children">{render(node.replies, depth + 1)}</div>}</section>;
  });
  return <div className="conversation-replies" aria-label="Conversation replies">{render(nodes, 0)}<p className="thread-empty">Open a reply to continue its conversation.</p></div>;
}
function QuotedCast({ target, onThread }: { target: { fid: number; hash: string }; onThread(cast: Cast): void }) {
  const controls = useContext(ContentControls);
  const [cast, setCast] = useState<Cast | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setCast(null); setUnavailable(false);
    getCast(target.hash, controller.signal).then(value => {
      if (!controller.signal.aborted) { if (value.author.fid === target.fid) setCast(value); else setUnavailable(true); }
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [target.hash, target.fid]);
  const reason = cast && !controls.revealed.has(bookmarkHash(cast.hash)!) ? getContentFilterReason(cast, controls.preferences) : undefined;
  if (reason) return <div className="filtered-cast"><p>Quoted cast filtered: {reason}</p><Button variant="ghost" onClick={() => controls.reveal(cast!.hash)}>Show this quote for this view</Button></div>;
  return <a className="quoted-cast" href={castPath(target.hash)} onClick={event => { if (cast) localClick(event, () => onThread(cast)); }}>
    {cast ? <><strong>{cast.author.display_name || cast.author.username || `FID ${target.fid}`}</strong><span>{cast.text || 'Cast with attachments'}</span><small>Open quoted cast</small></> : <span>{unavailable ? 'Quoted cast unavailable or deleted' : 'Loading quoted cast…'}</span>}
  </a>;
}
function CastCard({ cast, onProfile, onThread, onShare, onQuote, onDelete, reactionActor, onCastHash, onImages, onOptions, session, onSignIn, saved, onSave, notify }: { cast: Cast; onProfile(user: User): void; onThread(cast: Cast): void; onShare(cast: Cast): void; onQuote(cast: Cast): void; onDelete(cast: Cast): void; reactionActor?: User; onCastHash(hash: string): void; onImages(images: CastImage[], initialIndex: number): void; onOptions(cast: Cast): void; session: WalletSession | null; onSignIn(): void; saved: boolean; onSave(cast: Cast): void; notify(text: string): void }) {
  const urls = cast.embeds?.filter((embed): embed is { url: string } => 'url' in embed && !!safeUrl(embed.url)).slice(0, 2) ?? [];
  const isImage = (url: string) => hasImageEmbed({ ...cast, embeds: [{ url }] });
  const images = urls.filter(embed => isImage(embed.url)).map((embed, index) => ({ url: embed.url, alt: `Image ${index + 1} attached to cast by @${cast.author.username || cast.author.fid}` }));
  return <article className="cast">
    <a className="button button--ghost avatar-button" href={profilePath(cast.author.fid)} aria-label={`View ${cast.author.username}'s profile`} onClick={event => localClick(event, () => onProfile(cast.author))}><Avatar user={cast.author} /></a>
    <div className="cast__body">
      {cast.reaction_context && <div className="cast-activity">{cast.reaction_context.type === 'like' ? <IconHeart size={14} aria-hidden="true" /> : <IconRepeat size={14} aria-hidden="true" />}<a href={profilePath(cast.reaction_context.fid)} onClick={event => { if (reactionActor) localClick(event, () => onProfile(reactionActor)); }}>{reactionActor?.display_name || reactionActor?.username || `FID ${cast.reaction_context.fid}`}</a>{cast.reaction_context.type === 'like' ? 'liked' : 'recasted'}<time dateTime={cast.reaction_context.timestamp} title={new Date(cast.reaction_context.timestamp).toLocaleString()}>{relativeTime(cast.reaction_context.timestamp)}</time></div>}
      <div className="cast__meta"><a className="button button--ghost author" href={profilePath(cast.author.fid)} onClick={event => localClick(event, () => onProfile(cast.author))}>{cast.author.display_name || cast.author.username || `FID ${cast.author.fid}`}</a><span className="handle">@{cast.author.username || cast.author.fid}</span><span className="dot">·</span><a className="cast-permalink" href={castPath(cast.hash)} aria-label="Open cast" onClick={event => localClick(event, () => onThread(cast))}><time dateTime={cast.timestamp} title={new Date(cast.timestamp).toLocaleString()}>{relativeTime(cast.timestamp)}</time></a>{cast.channel && <span className="channel-tag">/{cast.channel.id}</span>}</div>
      <p className="cast__text"><CastText cast={cast} onProfile={onProfile} /></p>
      {cast.parent_hash && /^(?:0x)?[a-fA-F0-9]{40}$/.test(cast.parent_hash) && <a className="cast-parent" href={castPath(cast.parent_hash)} onClick={event => localClick(event, () => onCastHash(cast.parent_hash!))}>View parent cast<IconArrowUpRight size={13} /></a>}
      {urls.map(embed => isImage(embed.url) ? <a href={embed.url} key={embed.url} target="_blank" rel="noopener noreferrer" className="embed" aria-label="View attached image" onClick={event => localClick(event, () => onImages(images, images.findIndex(image => image.url === embed.url)))}><img src={embed.url} loading="lazy" alt="Image attached to cast" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /></a> : <a className="link-embed" key={embed.url} href={embed.url} target="_blank" rel="noopener noreferrer"><IconWorld size={18} /><span>{new URL(embed.url).hostname}<small>{embed.url.slice(0, 80)}</small></span><IconArrowUpRight size={17} /></a>)}
      {cast.embeds?.filter((embed): embed is { cast_id: { fid: number; hash: string } } => 'cast_id' in embed && !!embed.cast_id && Number.isSafeInteger(embed.cast_id.fid) && embed.cast_id.fid > 0 && /^(?:0x)?[a-fA-F0-9]{40}$/.test(embed.cast_id.hash)).slice(0, 2).map(embed => <QuotedCast key={embed.cast_id.hash} target={embed.cast_id} onThread={onThread} />)}
      <div className="cast__actions">
        <Button variant="ghost" aria-label="Open replies" onClick={() => onThread(cast)}><IconMessageCircle size={18} /><span>{short(cast.replies?.count)}</span></Button>
        <CastReactions cast={cast} session={session} onSignIn={onSignIn} notify={notify} />
        <Button variant="ghost" aria-label={saved ? 'Remove bookmark' : 'Bookmark cast'} aria-pressed={saved} className={saved ? 'is-saved' : ''} onClick={() => onSave(cast)}><IconBookmark size={18} fill={saved ? 'currentColor' : 'none'} /></Button>
        <Button variant="ghost" aria-label="Quote cast" onClick={() => onQuote(cast)}><IconQuote size={18} /></Button>
        {session?.fid === cast.author.fid && <Button variant="ghost" aria-label="Delete cast" onClick={() => onDelete(cast)}><IconTrash size={18} /></Button>}
        <Button variant="ghost" aria-label="Share cast" onClick={() => onShare(cast)}><IconShare size={18} /></Button><Button variant="ghost" aria-label="More cast options" onClick={() => onOptions(cast)}><IconDots size={18} /></Button>
      </div>
    </div>
  </article>;
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(location));
  const [background, setBackground] = useState<FeedRoute>(() => backgroundLocation());
  const base = route.kind === 'cast' ? background : route;
  const view = base.kind;
  const channel = base.kind === 'channel' ? base.channel : '';
  const profileTab = base.kind === 'profile' ? base.tab ?? 'casts' : 'casts';
  const featureView = view === 'search' || view === 'notifications' || view === 'channels' || view === 'devlog' || view === 'settings';
  const [channels, setChannels] = useState<Channel[]>([]);
  const [savedChannels, setSavedChannels] = useState<Channel[]>(readChannelPins);
  const [channelInfo, setChannelInfo] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState('');
  const channelCache = useRef(new Map<string, Channel>());
  const profileIdentifier = base.kind === 'profile' ? base.identifier : undefined;
  const [session, setSession] = useState<WalletSession | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [signInScopes, setSignInScopes] = useState<readonly number[] | undefined>();
  const [editProfile, setEditProfile] = useState(false);
  const [followList, setFollowList] = useState<'followers' | 'following' | null>(null);
  const [followingProfile, setFollowingProfile] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followRefresh, setFollowRefresh] = useState(0);
  const afterSocialConnect = useRef<'edit' | 'follow' | null>(null);
  const [deviceSettings, setDeviceSettings] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const profileRead = useRef<AbortController | null>(null);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [thread, setThread] = useState<Cast | null>(null);
  const [conversation, setConversation] = useState<ConversationNode | null>(null);
  const [threadError, setThreadError] = useState('');
  const [sharedCast, setSharedCast] = useState<Cast | null>(null);
  const [sharedProfile, setSharedProfile] = useState<User | null>(null);
  const [imageViewer, setImageViewer] = useState<{ images: CastImage[]; initialIndex: number } | null>(null);
  const [castOptions, setCastOptions] = useState<Cast | null>(null);
  const [castQuotes, setCastQuotes] = useState<Cast | null>(null);
  const [reactionPeople, setReactionPeople] = useState<Cast | null>(null);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const [trendingWindow, setTrendingWindow] = useState<'1h' | '6h' | '12h' | '24h' | '7d'>('24h');
  const [channelPeople, setChannelPeople] = useState<Channel | null>(null);
  const quoteGeneration = useRef(0);
  const quoteVersion = quoteGeneration.current;
  const [quotedCast, setQuotedCast] = useState<Cast | null>(null);
  const [deletedCast, setDeletedCast] = useState<Cast | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [bookmarks, setBookmarks] = useState<Cast[]>(readBookmarks);
  const [bookmarkQuery, setBookmarkQuery] = useState('');
  const [bookmarkSort, setBookmarkSort] = useState<BookmarkSort>('newest');
  const preferenceScope = contentPreferencesKey(session?.fid);
  const storedPreferences = useMemo(() => readContentPreferences(session?.fid), [session?.fid]);
  const [preferenceCache, setPreferenceCache] = useState(() => new Map([[contentPreferencesKey(), readContentPreferences()]]));
  const preferences = preferenceCache.get(preferenceScope) ?? storedPreferences;
  const [revealState, setRevealState] = useState(() => ({ scope: contentPreferencesKey(), hashes: new Set<string>() }));
  const revealed = revealState.scope === preferenceScope ? revealState.hashes : new Set<string>();
  const controls = { preferences, revealed, reveal(hash: string) { const normalized = bookmarkHash(hash); if (normalized) setRevealState(current => ({ scope: preferenceScope, hashes: new Set([...(current.scope === preferenceScope ? current.hashes : []), normalized]) })); } };
  useEffect(() => {
    setPreferenceCache(current => current.has(preferenceScope) ? current : new Map([...current, [preferenceScope, storedPreferences]]));
    setRevealState({ scope: preferenceScope, hashes: new Set() });
  }, [preferenceScope, storedPreferences]);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('quorum.theme') !== 'light'; } catch { return true; } });
  const feedGeneration = useRef(0);
  const feedMoreRead = useRef<AbortController | null>(null);
  const currentSession = useRef(session);
  const currentProfile = useRef(profile);
  const currentRoute = useRef(route);
  const currentBase = useRef(base);
  const profileCache = useRef(new Map<string, User>());
  const threadCache = useRef(new Map<string, Cast>());
  currentSession.current = session;
  currentProfile.current = profile;
  currentRoute.current = route;
  currentBase.current = base;
  const notify = useCallback((text: string) => setToast(text), []);
  const navigate = useCallback((path: string, replace = false) => {
    const next = parseLocalPath(path);
    const previous = currentRoute.current;
    const isThread = next.kind === 'cast';
    const state = isThread ? { quorumThread: previous.kind !== 'cast' || !!history.state?.quorumThread, quorumBackground: routePath(currentBase.current) } : null;
    if (path !== location.pathname + location.search) {
      if (replace || (isThread && previous.kind === 'cast')) history.replaceState(state, '', path);
      else history.pushState(state, '', path);
    }
    currentRoute.current = next;
    setRoute(next); setSharedCast(null); setSharedProfile(null); setImageViewer(null); setCastOptions(null); setCastQuotes(null); setReactionPeople(null); setShortcutHelp(false); setRevealState(current => ({ ...current, hashes: new Set() })); setChannelPeople(null); quoteGeneration.current += 1; setQuotedCast(null); setDeletedCast(null); setFollowList(null); setEditProfile(false);
    if (next.kind === 'cast') setBackground(currentBase.current);
    else { setBackground(next); setThread(null); }
  }, []);
  const openProfile = useCallback((user: User) => {
    profileCache.current.set(String(user.fid), user);
    if (user.username) profileCache.current.set(user.username, user);
    setProfile(user); navigate(profilePath(user.fid));
  }, [navigate]);
  const openThread = useCallback((cast: Cast) => {
    threadCache.current.set(castPath(cast.hash), cast); setThread(cast); navigate(castPath(cast.hash));
  }, [navigate]);
  const closeThread = useCallback(() => {
    setSharedCast(null);
    if (history.state?.quorumThread) history.back();
    else navigate(routePath(currentBase.current), true);
  }, [navigate]);
  function requestSignIn(scopes?: readonly number[]) { setSignInScopes(scopes); setSignIn(true); }
  function enableSocialFeatures(action: 'edit' | 'follow') {
    afterSocialConnect.current = action;
    requestSignIn(FULL_SOCIAL_SCOPES);
  }
  async function followProfile() {
    if (!profile || followBusy) return;
    if (!session || ![5, 6].every(scope => session.scopes.includes(scope))) { enableSocialFeatures('follow'); return; }
    if (followingProfile === null) return;
    const target = profile.fid; const remove = followingProfile;
    const key = session.publicKey;
    const stillCurrent = () => currentBase.current.kind === 'profile' && currentProfile.current?.fid === target && currentSession.current?.publicKey === key;
    setFollowBusy(true); setFollowError('');
    try {
      await session.follow(target, remove);
      if (stillCurrent()) setFollowingProfile(!remove);
      notify(remove ? 'Unfollow submitted to Hypersnap.' : 'Follow submitted to Hypersnap.');
    } catch (error) { if (stillCurrent()) { setFollowError(message(error)); setFollowingProfile(null); } else notify(message(error)); }
    finally { setFollowBusy(false); }
  }
  const activeTitle = view === 'profile' ? profile?.display_name || profile?.username || 'Profile' : view === 'channel' ? channelInfo?.name || channel : view === 'following' ? 'Following' : view === 'bookmarks' ? 'Bookmarks' : view === 'not-found' ? 'Page not found' : view === 'notifications' ? 'Notifications' : view === 'search' ? 'Search' : view === 'channels' ? 'Channels' : view === 'devlog' ? 'Dev log' : view === 'settings' ? 'Settings' : 'Discover';

  useEffect(() => {
    setFollowingProfile(null); setFollowError('');
    if (view !== 'profile' || !profile || !session || profile.fid === session.fid) return;
    const controller = new AbortController();
    getFollowStatus(session.fid, profile.fid, controller.signal)
      .then(value => { if (!controller.signal.aborted) setFollowingProfile(value); })
      .catch(error => { if (!controller.signal.aborted) setFollowError(message(error)); });
    return () => controller.abort();
  }, [view, profile?.fid, session?.fid, followRefresh, refresh]);
  useEffect(() => {
    const pop = () => {
      const next = parseRoute(location); currentRoute.current = next; setRoute(next); setSharedCast(null); setSharedProfile(null); setImageViewer(null); setCastOptions(null); setCastQuotes(null); setReactionPeople(null); setShortcutHelp(false); setRevealState(current => ({ ...current, hashes: new Set() })); setChannelPeople(null); quoteGeneration.current += 1; setQuotedCast(null); setDeletedCast(null); setFollowList(null); setEditProfile(false);
      if (next.kind === 'cast') setBackground(backgroundLocation());
      else { setBackground(next); setThread(null); }
    };
    window.addEventListener('popstate', pop);
    const initial = parseRoute(location);
    if (initial.kind === 'cast' && location.search) history.replaceState(history.state, '', castPath(initial.hash));
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (view !== 'profile') { setProfile(null); setProfileError(''); return; }
    const controller = new AbortController(); profileRead.current = controller; setProfileError('');
    if (!profileIdentifier && !session) { setProfile(null); setProfileLoading(false); return; }
    const identifier = profileIdentifier ?? String(session!.fid);
    const cached = profileCache.current.get(identifier) ?? (session && identifier === String(session.fid) ? session.user : null);
    setProfile(cached); setProfileLoading(!cached);
    getUser(/^\d+$/.test(identifier) ? { fid: Number(identifier) } : { username: identifier }, controller.signal)
      .then(user => { if (controller.signal.aborted) return; profileCache.current.set(String(user.fid), user); if (user.username) profileCache.current.set(user.username, user); setProfile(user); })
      .catch(error => { if (!controller.signal.aborted) setProfileError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setProfileLoading(false); });
    return () => controller.abort();
    // Updating the session's display fields must not trigger a second profile
    // read or reset the feed. Reads follow identity changes or explicit refresh.
  }, [view, profileIdentifier, session?.fid, session?.publicKey, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    getChannels({ kind: 'trending', limit: 25, signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      for (const item of data.channels) channelCache.current.set(item.id, item);
      setChannels(data.channels.slice(0, 5));
    }).catch(() => {});
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setChannelError('');
    if (view !== 'channel') { setChannelInfo(null); return; }
    const controller = new AbortController(); setChannelInfo(channelCache.current.get(channel) ?? null);
    getChannel(channel, controller.signal).then(data => {
      if (!controller.signal.aborted) { channelCache.current.set(data.id, data); setChannelInfo(data); }
    }).catch(error => { if (!controller.signal.aborted) { setChannelInfo(null); setChannelError(message(error)); } });
    return () => controller.abort();
  }, [view, channel, refresh]);
  useEffect(() => { document.title = route.kind === 'cast' ? 'Conversation · Quorum' : `${activeTitle} · Quorum`; }, [route.kind, activeTitle]);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('quorum.theme', dark ? 'dark' : 'light'); } catch { /* Theme still works for this tab. */ } }, [dark]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => currentSession.current?.dispose(), []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view, channel, profile?.fid, profileTab]);
  useEffect(() => {
    const controller = new AbortController();
    getInfo(controller.signal).then(data => { setInfo(data as Record<string, unknown>); setNetworkError(false); }).catch(() => { if (!controller.signal.aborted) setNetworkError(true); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    feedGeneration.current += 1; feedMoreRead.current?.abort();
    setError(''); setCasts([]); setCursor(null); setLoadingMore(false);
    if (featureView || view === 'bookmarks' || view === 'not-found' || (view === 'profile' && !profile) || (view === 'following' && !session)) { setLoading(false); return; }
    setLoading(true);
    const request = view === 'profile' && profile ? getProfileFeed({ fid: profile.fid, tab: profileTab, limit: 25, signal: controller.signal }) : getFeed({ kind: view === 'channel' ? 'channel' : view === 'following' ? 'following' : 'trending', fid: session?.fid, channel, ...(view === 'discover' ? { timeWindow: trendingWindow } : {}), limit: 25, signal: controller.signal });
    request
      .then(data => { if (!controller.signal.aborted) { setCasts(data.casts); setCursor(data.next?.cursor || null); } })
      .catch(error => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); feedMoreRead.current?.abort(); };
  }, [view, channel, session?.fid, session?.publicKey, profile?.fid, profileTab, trendingWindow, refresh]);
  useEffect(() => {
    if (route.kind !== 'cast') { setThread(null); setConversation(null); setThreadError(''); return; }
    const controller = new AbortController(); setConversation(null); setThreadError('');
    setThread(threadCache.current.get(castPath(route.hash)) ?? null);
    getConversation(route.hash, controller.signal).then(data => { if (controller.signal.aborted) return; setConversation(data); setThread(data.cast); threadCache.current.set(castPath(route.hash), data.cast); }).catch(error => { if (!controller.signal.aborted) setThreadError(message(error)); });
    return () => controller.abort();
  }, [route.kind === 'cast' ? route.hash : null, refresh]);

  function lockSession(expectedSession = session, revoked = false) {
    if (!expectedSession || currentSession.current?.publicKey !== expectedSession.publicKey) return;
    expectedSession.dispose(); setSession(null); setDeviceSettings(false);
    if (!revoked) notify('This tab is locked. Network authorization remains active; unlock a saved vault or approve a new device key to reconnect.');
  }
  function save(cast: Cast) {
    try {
      const next = toggleBookmark(bookmarks, cast);
      setBookmarks(next); if (!saveBookmarks(next)) notify('Browser storage is unavailable. Bookmarks will last for this tab.');
    } catch (cause) { notify(message(cause)); }
  }
  function search(event: FormEvent) {
    event.preventDefault(); if (!query.trim()) return;
    try { navigate(searchPath(query.replace(/^@/, ''), query.startsWith('@') ? 'users' : 'casts')); }
    catch (error) { notify(message(error)); }
  }
  useEffect(() => { if (base.kind === 'search') setQuery(base.query); }, [base.kind === 'search' ? base.query : null]);
  function toggleSavedChannel(item: Channel) {
    let next: Channel[];
    try { next = toggleChannelPin(savedChannels, item); } catch (error) { notify(message(error)); return; }
    setSavedChannels(next);
    if (!writeChannelPins(next)) notify('Channel shortcuts will last for this tab. Browser storage is unavailable.');
  }
  function openChannel(item: Channel) { channelCache.current.set(item.id, item); navigate(`/channel/${item.id}`); }
  async function loadMore() {
    if (!cursor || loadingMore) return; setLoadingMore(true);
    const generation = feedGeneration.current;
    const controller = new AbortController(); feedMoreRead.current?.abort(); feedMoreRead.current = controller;
    try {
      const data = await (view === 'profile' && profile ? getProfileFeed({ fid: profile.fid, tab: profileTab, cursor, limit: 25, signal: controller.signal }) : getFeed({ kind: view === 'channel' ? 'channel' : view === 'following' ? 'following' : 'trending', fid: session?.fid, channel, ...(view === 'discover' ? { timeWindow: trendingWindow } : {}), cursor, limit: 25, signal: controller.signal }));
      if (generation !== feedGeneration.current || controller.signal.aborted) return;
      setCasts(previous => {
        const merged = new Map(previous.map(cast => [cast.hash.replace(/^0x/i, '').toLowerCase(), cast]));
        for (const cast of data.casts) merged.set(cast.hash.replace(/^0x/i, '').toLowerCase(), cast);
        const values = [...merged.values()];
        return view === 'channel' ? values.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.hash.localeCompare(b.hash)) : values;
      }); setCursor(data.next?.cursor || null);
    } catch (error) { if (generation === feedGeneration.current && !controller.signal.aborted) notify(message(error)); }
    finally { if (generation === feedGeneration.current) setLoadingMore(false); }
  }
  function updatePreferences(next: ContentPreferences) {
    setPreferenceCache(current => new Map([...current, [preferenceScope, next]])); setRevealState(current => ({ ...current, hashes: new Set() }));
    const persisted = writeContentPreferences(next, session?.fid);
    if (!persisted) notify('Content controls will last for this tab. Browser storage is unavailable.');
    return persisted;
  }
  useNavigationShortcuts({ onSearch() { navigate('/search'); setSearchFocus(value => value + 1); }, onHelp() { setShortcutHelp(true); } });
  const card = (cast: Cast) => {
    const reason = !revealed.has(bookmarkHash(cast.hash)!) && getContentFilterReason(cast, preferences);
    if (reason) return <div className="filtered-cast" key={cast.hash}><p>Cast filtered: {reason}</p><Button variant="secondary" onClick={() => controls.reveal(cast.hash)}>Show this cast for this view</Button><Button variant="ghost" onClick={() => navigate('/settings')}>Manage content controls</Button></div>;
    return <CastCard key={`${session?.publicKey ?? 'guest'}:${cast.hash}`} cast={cast} reactionActor={view === 'profile' && profile && profile.fid === cast.reaction_context?.fid ? profile : undefined} session={session} onSignIn={() => requestSignIn()} onProfile={openProfile} onThread={openThread} onShare={setSharedCast} onCastHash={hash => navigate(castPath(hash))} onImages={(images, initialIndex) => setImageViewer({ images, initialIndex })} onOptions={setCastOptions} onQuote={cast => { quoteGeneration.current += 1; setQuotedCast(cast); }} onDelete={setDeletedCast} saved={bookmarks.some(item => bookmarkHash(item.hash) === bookmarkHash(cast.hash))} onSave={save} notify={notify} />;
  };
  const feedCandidates = view === 'bookmarks' ? filterBookmarks(bookmarks, bookmarkQuery, bookmarkSort) : casts;
  const visibleCasts = feedCandidates.filter(cast => revealed.has(bookmarkHash(cast.hash)!) || !getContentFilterReason(cast, preferences));
  const filteredCount = feedCandidates.length - visibleCasts.length;
  return <ContentControls.Provider value={controls}><div className="app">
    <aside className="rail" aria-label="App rail"><a href="/" onClick={event => localClick(event, () => navigate('/'))} className="rail__logo" aria-label="Quorum home"><img src="/quorum-symbol.svg" alt="" /></a><div className="rail__divider" /><Button variant="ghost" className="rail__active" aria-label="Hypersnap" onClick={() => navigate('/')}><IconWorld size={25} /></Button><a className="rail__link" href="https://hypersnap.org" target="_blank" rel="noopener noreferrer" aria-label="About Hypersnap"><IconCompass size={24} /></a><div className="rail__bottom"><Button variant="ghost" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}>{dark ? <IconSun size={23} /> : <IconMoon size={23} />}</Button><a className="rail__link" href={sourceUrl} aria-label="Source code" target="_blank" rel="noopener noreferrer"><IconCode size={23} /></a></div></aside>
    <aside className="sidebar">
      <a href="/" onClick={event => localClick(event, () => navigate('/'))} className="wordmark">Quorum<span>by arca</span></a>
      <div className="network-label"><span className="status-dot" /> HYPERSNAP <span className="beta">BETA</span></div>
      <nav aria-label="Main navigation">
        <Button variant="ghost" className={`nav-item ${view === 'discover' ? 'active' : ''}`} onClick={() => navigate('/')}><IconCompass size={21} />Discover <IconSparkles size={15} className="nav-spark" /></Button>
        <Button variant="ghost" className={`nav-item ${view === 'following' ? 'active' : ''}`} onClick={() => navigate('/following')}><IconUsers size={21} />Following</Button>
        <Button variant="ghost" className={`nav-item ${view === 'bookmarks' ? 'active' : ''}`} onClick={() => navigate('/bookmarks')}><IconBookmark size={21} />Bookmarks {bookmarks.length > 0 && <span className="nav-count">{bookmarks.length}</span>}</Button>
        <Button variant="ghost" className={`nav-item ${view === 'notifications' ? 'active' : ''}`} onClick={() => navigate('/notifications')}><IconBell size={21} />Notifications</Button>
        <Button variant="ghost" className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => navigate('/search')}><IconSearch size={21} />Search</Button>
        <Button variant="ghost" className={`nav-item ${view === 'channels' ? 'active' : ''}`} onClick={() => navigate('/channels')}><IconHash size={21} />Channels</Button>
        <a className={`button button--ghost nav-item ${view === 'devlog' ? 'active' : ''}`} href="/devlog" aria-current={view === 'devlog' ? 'page' : undefined} onClick={event => localClick(event, () => navigate('/devlog'))}><IconHistory size={21} />Dev log</a>
        <a className={`button button--ghost nav-item ${view === 'settings' ? 'active' : ''}`} href="/settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={event => localClick(event, () => navigate('/settings'))}><IconSettings size={21} />Settings</a>
        {session && <Button variant="ghost" className={`nav-item ${view === 'profile' && profile?.fid === session.fid ? 'active' : ''}`} onClick={() => navigate('/profile')}><Avatar user={session.user} />My profile</Button>}
      </nav>
      {savedChannels.length > 0 && <><div className="sidebar__section-label">SAVED ON THIS BROWSER <IconBookmark size={14} /></div><nav aria-label="Saved channels">{savedChannels.slice(0, 8).map(item => <Button key={item.id} variant="ghost" className={`channel-nav ${view === 'channel' && channel === item.id ? 'active' : ''}`} onClick={() => openChannel(item)}><span className="channel-mark"><IconHash size={17} /></span>{item.name || item.id}</Button>)}</nav></>}
      <div className="sidebar__section-label">EXPLORE CHANNELS <IconHash size={14} /></div>
      <nav aria-label="Channels">{channels.map(item => <Button key={item.id} variant="ghost" className={`channel-nav ${view === 'channel' && channel === item.id ? 'active' : ''}`} onClick={() => openChannel(item)}><span className="channel-mark"><IconHash size={17} /></span>{item.name}</Button>)}</nav>
      <div className="sidebar__bottom">{session ? <div className="session-card"><Button variant="ghost" className="session-user" onClick={() => navigate('/profile')}><Avatar user={session.user} /><span><strong>{session.user.display_name || session.user.username}</strong><small>@{session.user.username}</small></span></Button><Button variant="ghost" aria-label="Manage this device’s signing access" onClick={() => setDeviceSettings(true)}><IconShieldLock size={19} /></Button></div> : <><div className="sidebar-invite"><IconWorld size={21} /><p>The social web,<br /><strong>on your terms.</strong></p></div><Button className="full-width" onClick={() => requestSignIn()}>Connect Farcaster <IconArrowUpRight size={17} /></Button></>}<p className="sidebar-foot">OPEN PROTOCOL. OPEN POSSIBILITIES.</p></div>
    </aside>
    <main className="main">
      <header className="page-header"><div><span className="eyebrow">YOUR CORNER OF THE OPEN SOCIAL WEB</span><h1>{activeTitle}<span className="title-star">✳</span></h1></div><div className="header-actions">{view !== 'devlog' && view !== 'settings' && <><span className="live-pill"><span className={`status-dot ${networkError ? 'status-dot--offline' : ''}`} />{networkError ? 'Node unavailable' : info ? 'Live on Hypersnap' : 'Connecting'}</span><Button variant="ghost" aria-label="Refresh feed" onClick={() => setRefresh(n => n + 1)}><IconRefresh size={19} className={loading ? 'spin' : ''} /></Button></>}{view !== 'devlog' && <a className="button button--secondary header-devlog" href="/devlog" aria-label="Dev log" onClick={event => localClick(event, () => navigate('/devlog'))}><IconHistory size={17} /><span>Dev log</span></a>}<Button variant="ghost" className="header-content-settings" aria-label="Settings" onClick={() => navigate('/settings')}><IconSettings size={19} /></Button><Button className="mobile-connect" variant="secondary" onClick={() => session ? navigate('/profile') : requestSignIn()}>{session ? 'My profile' : 'Connect'}</Button></div></header>
      {view !== 'devlog' && view !== 'settings' && <div className="compact-tools"><form className="search" onSubmit={search}><IconSearch size={18} /><Input aria-label="Search casts or people" placeholder="Search casts or @people" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="ghost" type="submit" aria-label="Search"><IconChevronRight size={18} /></Button></form><nav className="channel-chips" aria-label="Explore channels">{channels.map(item => <Button key={item.id} variant="ghost" className={view === 'channel' && channel === item.id ? 'active' : ''} onClick={() => navigate(`/channel/${item.id}`)}>/{item.id}</Button>)}<Button variant="ghost" onClick={() => navigate('/channels')}>All channels</Button></nav></div>}
      {(view === 'discover' || view === 'following') && <nav className="feature-tabs home-feed-tabs" aria-label="Home feeds"><a href="/" aria-current={view === 'discover' ? 'page' : undefined} onClick={event => localClick(event, () => navigate('/'))}>Discover</a><a href="/following" aria-current={view === 'following' ? 'page' : undefined} onClick={event => localClick(event, () => navigate('/following'))}>Following</a></nav>}
      {view === 'discover' && !session && <section className="welcome"><div className="welcome__copy"><span className="eyebrow"><IconSparkles size={14} /> A LITTLE MORE OPEN</span><h2>Good conversations.<br /><span>No gatekeepers.</span></h2><p>Your people, your identity, your voice.<br />A familiar social world, on a network we all own.</p><a href="https://hypersnap.org" target="_blank" rel="noopener noreferrer">Meet Hypersnap <IconArrowUpRight size={16} /></a></div><div className="orbit" aria-hidden="true"><div className="orbit__ring orbit__ring--one" /><div className="orbit__ring orbit__ring--two" /><div className="orbit__ring orbit__ring--three" /><div className="orbit__core"><img src="/quorum-symbol.svg" alt="" /></div><span className="orbit__point orbit__point--a" /><span className="orbit__point orbit__point--b" /><span className="orbit__point orbit__point--c" /><span className="orbit__star">✳</span></div></section>}
      {view === 'profile' && profile && <section className="profile">
        <Button variant="ghost" onClick={() => navigate('/')}><IconArrowLeft size={17} />Back to discover</Button>
        {safeUrl(profile.profile?.banner?.url) && <img className="profile-banner" src={safeUrl(profile.profile.banner?.url)} alt="Profile banner" referrerPolicy="no-referrer" />}
        <Avatar user={profile} large /><h2>{profile.display_name || profile.username}</h2><p className="muted">@{profile.username} <span>· FID {profile.fid}</span></p>
        <ProfileDetails user={profile} />
        <Button variant="secondary" onClick={() => setSharedProfile(profile)}><IconShare size={16} />Share profile</Button>
        <p className="profile__bio"><LinkedText text={profile.profile?.bio?.text || 'A voice on the open social web.'} /></p>
        <a className="profile-public-link" href={profilePath(profile.fid)} onClick={event => localClick(event, () => navigate(profilePath(profile.fid)))}>{publicUrl(profilePath(profile.fid))}</a>
        <div className="profile__counts"><Button variant="ghost" onClick={() => setFollowList('following')}><strong>{short(profile.following_count)}</strong> following</Button><Button variant="ghost" onClick={() => setFollowList('followers')}><strong>{short(profile.follower_count)}</strong> followers</Button></div>
        {session?.fid !== profile.fid && <div className="profile-follow"><FollowButton following={session ? followingProfile : false} pending={followBusy} onClick={() => void followProfile()} />{followError && <div><p className="error" role="alert">{followError}</p><Button variant="secondary" onClick={() => setFollowRefresh(value => value + 1)}>Check follow status</Button></div>}</div>}
        {session?.fid === profile.fid && <div className="profile-device-actions"><Button variant="secondary" onClick={() => session.scopes.includes(11) ? setEditProfile(true) : enableSocialFeatures('edit')}>{session.scopes.includes(11) ? 'Edit profile' : 'Enable profile editing'}</Button><Button variant="secondary" className="profile-signout" onClick={() => setDeviceSettings(true)}><IconShieldLock size={17} />Device access</Button><Button variant="ghost" className="profile-signout" onClick={() => lockSession()}><IconLock size={17} />Lock this tab</Button></div>}
        {session && ![5, 6, 11].every(scope => session.scopes.includes(scope)) && <p className="profile-upgrade">Follows and profile editing require additional device permissions. Your wallet will show the permissions before you approve a new key.</p>}
        {profileError && <p className="error" role="alert">{profileError}</p>}
      </section>}
      {view === 'profile' && profile && <ProfileTabs fid={profile.fid} tab={profileTab} onChange={tab => navigate(profilePath(profile.fid, tab))} />}
      {view === 'channel' && (channelInfo ? <ChannelHeader channel={channelInfo} saved={savedChannels.some(item => item.id === channelInfo.id)} onToggleSave={toggleSavedChannel} /> : <p className="channel-status" role={channelError ? 'alert' : 'status'}>{channelError || 'Loading channel…'}</p>)}
      {view === 'channel' && channelInfo && <div className="channel-detail-actions"><Button variant="secondary" onClick={() => setChannelPeople(channelInfo)}><IconUsers size={16} />View participants</Button></div>}
      {view === 'channel' && channelInfo && safeUrl(channelInfo.parent_url || channelInfo.url) && <Composer key={`${session?.publicKey ?? 'guest'}:${channel}`} session={session} onSignIn={() => requestSignIn()} parentUrl={channelInfo.parent_url || channelInfo.url} onPosted={() => setRefresh(n => n + 1)} notify={notify} />}
      {view === 'search' && base.kind === 'search' && <SearchView key={refresh} query={base.query} kind={base.searchKind} focusRequest={searchFocus} onSearch={(query, kind) => navigate(searchPath(query, kind))} onProfile={openProfile} renderCast={card} />}
      {view === 'notifications' && <NotificationsView key={refresh} isActivityFiltered={item => item.actors.some(actor => preferences.mutedAccounts.some(person => person.fid === actor.fid)) || Boolean(item.cast && getContentFilterReason(item.cast, preferences)) || Boolean(item.targetHash && preferences.hiddenCasts.includes(item.targetHash.replace(/^0x/, '').toLowerCase()))} fid={session?.fid} onConnect={() => requestSignIn()} onProfile={openProfile} onCast={hash => navigate(castPath(hash))} />}
      {view === 'settings' && <><Suspense fallback={<p className="devlog-loading" role="status">Loading content controls…</p>}><ContentSettings key={preferenceScope} fid={session?.fid} preferences={preferences} onChange={updatePreferences} /></Suspense><section className="settings-shortcuts"><h2>Quick navigation</h2><p><kbd>⌘ / Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> opens search. Press <kbd>?</kbd> for shortcuts.</p><Button variant="secondary" onClick={() => setShortcutHelp(true)}><IconKeyboard size={17} />Keyboard shortcuts</Button></section></>}
      {view === 'devlog' && <Suspense fallback={<p className="devlog-loading" role="status">Loading the project story…</p>}><DevLog /></Suspense>}
      {view === 'channels' && <ChannelsView key={refresh} onChannel={openChannel} savedChannels={savedChannels} onToggleSave={toggleSavedChannel} />}
      {!featureView && <>
      {(view === 'discover' || view === 'following') && <Composer key={session?.publicKey ?? 'guest'} session={session} onSignIn={() => requestSignIn()} onPosted={() => setRefresh(n => n + 1)} notify={notify} />}
      {view === 'discover' && <div className="trending-window"><label htmlFor="trending-window">Trending over</label><select id="trending-window" aria-label="Trending time window" value={trendingWindow} onChange={event => setTrendingWindow(event.target.value as typeof trendingWindow)}>{([['1h', '1 hour'], ['6h', '6 hours'], ['12h', '12 hours'], ['24h', '24 hours'], ['7d', '7 days']] as const).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span>Ranked by Hypersnap</span></div>}
      {view === 'bookmarks' && <BookmarkTools query={bookmarkQuery} onQueryChange={setBookmarkQuery} sort={bookmarkSort} onSortChange={setBookmarkSort} count={visibleCasts.length} total={bookmarks.length} onClear={() => { setBookmarks([]); setBookmarkQuery(''); if (!saveBookmarks([])) notify('Bookmarks cleared for this tab. Browser storage is unavailable.'); }} />}
      {filteredCount > 0 && <div className="content-filter-summary" role="status"><span>{filteredCount} loaded {filteredCount === 1 ? 'cast is' : 'casts are'} filtered on this browser.</span><Button variant="ghost" onClick={() => navigate('/settings')}>Manage controls</Button><Button variant="ghost" onClick={() => setRevealState(current => ({ scope: preferenceScope, hashes: new Set([...(current.scope === preferenceScope ? current.hashes : []), ...feedCandidates.map(cast => bookmarkHash(cast.hash)!)]) }))}>Show for this view</Button></div>}
      <div className="feed-heading"><div><IconHome size={17} /><span>{view === 'discover' ? 'Around the network' : view === 'bookmarks' ? 'Saved for later' : view === 'profile' ? profileTab === 'replies' ? 'Replies' : profileTab === 'media' ? 'Photos' : profileTab === 'likes' ? 'Likes' : profileTab === 'recasts' ? 'Recasts' : 'Casts' : view === 'following' ? 'From your people' : `/${channel}`}</span></div><span>{view === 'discover' ? <><IconSparkles size={13} /> Trending</> : view === 'bookmarks' ? 'Stored on this device' : view === 'profile' && (profileTab === 'likes' || profileTab === 'recasts') ? 'Most recently reacted' : 'Latest casts'}</span></div>
      {view === 'not-found' ? <div className="empty"><IconCompass size={35} /><h3>That page does not exist.</h3><p>Check the profile or cast link, or return to Discover.</p><Button onClick={() => navigate('/')}>Open Discover</Button></div> : view === 'profile' && !profile ? <div className="empty" role={profileLoading ? 'status' : undefined}><IconUsers size={35} /><h3>{profileLoading ? 'Loading profile…' : profileError ? 'Profile unavailable' : 'Your profile on Hypersnap'}</h3><p>{profileError || (profileLoading ? 'Finding this public identity on Hypersnap.' : 'Connect your account to open your profile, or search for a username or FID.')}</p>{profileError ? <Button variant="secondary" onClick={() => setRefresh(n => n + 1)}>Try again</Button> : !profileLoading && <Button onClick={() => requestSignIn()}>Connect your account</Button>}</div> : loading ? <div aria-label="Loading casts" role="status" className="skeleton-list">{[0, 1, 2].map(n => <div className="skeleton-cast" key={n}><span className="skeleton-avatar" /><div><span /><span /><span /></div></div>)}<p className="muted">Finding conversations on Hypersnap…</p></div> : error ? <div className="empty"><IconWorld size={35} /><h3>The network is taking a moment.</h3><p>{error}</p><Button variant="secondary" onClick={() => setRefresh(n => n + 1)}><IconRefresh size={16} />Try again</Button></div> : view === 'following' && !session ? <div className="empty"><IconUsers size={35} /><h3>Your people are here.</h3><p>Connect your Farcaster wallet to see casts from the people you follow.</p><Button onClick={() => requestSignIn()}>Connect Farcaster <IconArrowUpRight size={16} /></Button></div> : visibleCasts.length ? <div className="feed">{visibleCasts.map(card)}{cursor && view !== 'bookmarks' && <Button variant="secondary" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'More conversations'}<IconArrowDown size={16} /></Button>}<p className="feed-end">You’re connected to the open social web. <IconWorld size={13} /></p></div> : <div className="empty"><IconBookmark size={35} /><h3>{filteredCount ? 'Your content controls are active.' : view === 'bookmarks' && bookmarkQuery.trim() ? 'No saved casts match.' : view === 'bookmarks' ? 'A place for the good stuff.' : 'The conversation is open.'}</h3><p>{filteredCount ? 'Manage your filters or reveal the loaded casts for this view.' : view === 'bookmarks' && bookmarkQuery.trim() ? 'Try another word, person or channel.' : view === 'bookmarks' ? 'Tap the bookmark on any cast to save it here.' : 'No casts returned for this feed yet. Try another channel or start a conversation.'}</p>{cursor && <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Check next page'}<IconArrowDown size={16} /></Button>}</div>}
      {view === 'following' && session && <SuggestedPeople fid={session.fid} onProfile={openProfile} />}
      </>}
    </main>
    <aside className="rightbar">
      <form className="search" onSubmit={search}><IconSearch size={18} /><Input aria-label="Search casts or people" placeholder="Search casts or @people" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="ghost" type="submit" aria-label="Search"><IconChevronRight size={18} /></Button></form>
      {!session && <section className="join-card"><span className="tiny-icon"><IconWorld size={23} /></span><h2>You already belong.</h2><p>Your Farcaster identity works here.<br />Bring your profile. Find your people.<br />Make yourself heard.</p><Button className="full-width" onClick={() => requestSignIn()}>Connect your wallet <IconArrowUpRight size={17} /></Button><span className="join-card__note"><IconShieldLock size={13} /> Recovery words stay outside this site.</span></section>}
      {session && view !== 'following' && <SuggestedPeople fid={session.fid} onProfile={openProfile} />}
      <section className="network-card"><div className="card-label">A NETWORK, NOT A PLATFORM <IconWorld size={16} /></div><div className="node-status"><span className={`status-dot ${networkError ? 'status-dot--offline' : ''}`} /><strong>{networkError ? 'Node unavailable' : info ? 'Connected to Hypersnap' : 'Checking the network…'}</strong></div><p>haatz.quilibrium.com</p><div className="network-facts"><div><span>Protocol</span><strong>Farcaster-compatible</strong></div><div><span>Ownership</span><strong>Community-run</strong></div><div><span>Access</span><strong>Open to everyone <IconArrowUpRight size={12} /></strong></div></div><a href="https://hypersnap.org/docs" target="_blank" rel="noopener noreferrer">Explore the protocol <IconArrowUpRight size={15} /></a></section>
      <section className="open-card"><IconCode size={23} /><h3>Built in the open.</h3><p>A Quorum fork by Arca. Powered by Hypersnap, made for everyone.</p><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Read the source <IconArrowUpRight size={14} /></a></section>
      <footer><a href="/devlog" onClick={event => localClick(event, () => navigate('/devlog'))}>Dev log</a><a href="https://hypersnap.org" target="_blank" rel="noopener noreferrer">Hypersnap</a><a href="https://www.quorummessenger.com" target="_blank" rel="noopener noreferrer">Quorum</a><a href={`${sourceUrl}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">AGPL-3.0</a><span>Made for the open internet <span className="footer-star">✳</span></span></footer>
    </aside>
    <nav className="mobile-nav" aria-label="Mobile navigation"><Button variant="ghost" aria-label="Discover" onClick={() => navigate('/')}><IconCompass /></Button><Button variant="ghost" aria-label="Following" onClick={() => navigate('/following')}><IconUsers /></Button><Button variant="ghost" aria-label="Bookmarks" onClick={() => navigate('/bookmarks')}><IconBookmark /></Button><Button variant="ghost" aria-label="Search" onClick={() => navigate('/search')}><IconSearch /></Button><Button variant="ghost" aria-label="Notifications" onClick={() => navigate('/notifications')}><IconBell /></Button><Button variant="ghost" aria-label="Channels" onClick={() => navigate('/channels')}><IconHash /></Button><Button variant="ghost" aria-label="Account" onClick={() => session ? navigate('/profile') : requestSignIn()}><IconKey /></Button></nav>
    {toast && <div className="toast" role="status"><span>{toast}</span><Button variant="ghost" aria-label="Dismiss notification" onClick={() => setToast('')}><IconX size={17} /></Button></div>}
    {signIn && <Suspense fallback={<Modal title="Connect your identity" onClose={() => setSignIn(false)}><p className="pairing-copy" role="status">Loading device sign-in…</p></Modal>}><ConnectAccount requestedScopes={signInScopes} initialFid={session?.fid} onClose={() => { setSignIn(false); setSignInScopes(undefined); afterSocialConnect.current = null; }} onConnect={value => { session?.dispose(); setSession(value); setSignIn(false); setSignInScopes(undefined); if (afterSocialConnect.current === 'edit' && profile?.fid === value.fid) setEditProfile(true); afterSocialConnect.current = null; notify(`Welcome, @${value.user.username || value.fid}. You’re connected to Hypersnap.`); }} /></Suspense>}
    {deviceSettings && session && <Suspense fallback={<Modal title="This device’s access" onClose={() => setDeviceSettings(false)}><p role="status">Loading device settings…</p></Modal>}><DeviceSettings session={session} onClose={() => setDeviceSettings(false)} onLock={revoked => lockSession(session, revoked)} notify={notify} /></Suspense>}
    {route.kind === 'cast' && <Modal title="Conversation" onClose={closeThread} wide>{thread && card(thread)}{threadError ? <div className="empty"><p className="error">{threadError}</p><Button variant="secondary" onClick={() => setRefresh(n => n + 1)}>Try again</Button></div> : conversation && thread ? <><Composer key={`${session?.publicKey ?? 'guest'}:${thread.hash}`} session={session} onSignIn={() => requestSignIn()} onPosted={() => setRefresh(n => n + 1)} parent={thread} notify={notify} />{conversation.replies.length ? <ConversationReplies nodes={conversation.replies} renderCard={card} /> : <p className="thread-empty">The first reply could be yours.</p>}</> : <p className="thread-empty" role="status">Loading conversation…</p>}</Modal>}
    {followList && profile && <FollowListDialog key={`${profile.fid}:${followList}`} user={profile} kind={followList} loadPage={getFollows} onProfile={openProfile} onClose={() => setFollowList(null)} />}
    {editProfile && session && profile?.fid === session.fid && <EditProfileDialog key={profile.fid} user={profile} onSave={patch => session.updateProfile(patch)} onUpload={(file, signal) => uploadMedia(file, input => session.authorizeMediaUpload(input), signal)} onReload={() => session.refreshProfile()} onSaved={patch => {
      // An older profile read can finish after the session confirms this edit.
      // Cancel it before publishing the confirmed values to the profile cache.
      profileRead.current?.abort(); setProfileLoading(false); setProfileError('');
      const updated: User = { ...profile, ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}), ...(patch.pfpUrl !== undefined ? { pfp_url: patch.pfpUrl } : {}), profile: { ...profile.profile, bio: { text: patch.bio ?? profile.profile?.bio?.text ?? '' } } };
      profileCache.current.set(String(updated.fid), updated); if (updated.username) profileCache.current.set(updated.username, updated);
      setProfile(updated); setSession(current => current?.publicKey === session.publicKey ? { ...current, user: updated } : current);
    }} onClose={() => setEditProfile(false)} />}
    {quotedCast && !signIn && <Modal title="Quote cast" onClose={() => { quoteGeneration.current += 1; setQuotedCast(null); }} wide><Composer key={`${session?.publicKey ?? 'guest'}:${quotedCast.hash}`} session={session} quote={quotedCast} onSignIn={() => requestSignIn()} onPosted={() => { if (quoteVersion === quoteGeneration.current && currentSession.current?.publicKey === session?.publicKey) setQuotedCast(null); setRefresh(n => n + 1); }} notify={notify} /></Modal>}
    {deletedCast && !signIn && <DeleteCastDialog cast={deletedCast} session={session} onEnable={() => requestSignIn(FULL_CLIENT_SCOPES)} onClose={() => setDeletedCast(null)} onDeleted={cast => {
      setDeletedCast(null); setCasts(current => current.filter(item => item.hash !== cast.hash));
      const saved = bookmarks.filter(item => bookmarkHash(item.hash) !== bookmarkHash(cast.hash)); setBookmarks(saved); if (!saveBookmarks(saved)) notify('The bookmark was removed for this tab. Browser storage is unavailable.');
      threadCache.current.delete(castPath(cast.hash));
      if (currentRoute.current.kind === 'cast' && currentRoute.current.hash === cast.hash) navigate(routePath(currentBase.current), true);
      setRefresh(value => value + 1); notify('Cast deletion confirmed by Hypersnap.');
    }} />}
    {channelPeople && <ChannelPeopleDialog channel={channelPeople} onProfile={openProfile} onClose={() => setChannelPeople(null)} />}
    {castQuotes && <CastQuotesDialog cast={castQuotes} renderCast={card} onClose={() => setCastQuotes(null)} />}
    {sharedProfile && <ShareProfileDialog user={sharedProfile} onClose={() => setSharedProfile(null)} />}
    {imageViewer && <MediaViewer {...imageViewer} onClose={() => setImageViewer(null)} />}
    {shortcutHelp && <Modal title="Keyboard shortcuts" onClose={() => setShortcutHelp(false)}><dl className="shortcut-list"><div><dt>Search</dt><dd><kbd>⌘ / Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd></dd></div><div><dt>This help</dt><dd><kbd>?</kbd></dd></div><div><dt>Publish from the composer</dt><dd><kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd></dd></div><div><dt>Close a dialog</dt><dd><kbd>Esc</kbd></dd></div></dl><p className="muted">Navigation shortcuts pause while you type or a dialog is open.</p></Modal>}
    {reactionPeople && <Suspense fallback={<Modal title="Cast reactions" onClose={() => setReactionPeople(null)}><p role="status">Loading reactions…</p></Modal>}><CastReactionPeople cast={reactionPeople} onClose={() => setReactionPeople(null)} onProfile={openProfile} /></Suspense>}
    {castOptions && <CastOptions cast={castOptions} onReactionPeople={() => { setReactionPeople(castOptions); setCastOptions(null); }} onHide={() => { try { const saved = updatePreferences(hideCast(preferences, castOptions.hash)); setCastOptions(null); notify(saved ? 'Cast hidden on this browser. Restore it in Settings.' : 'Cast hidden for this tab. Browser storage is unavailable.'); } catch (cause) { notify(message(cause)); } }} onMute={() => { try { const saved = updatePreferences(muteAccount(preferences, castOptions.author)); setCastOptions(null); notify(saved ? 'Account muted on this browser. Manage it in Settings.' : 'Account muted for this tab. Browser storage is unavailable.'); } catch (cause) { notify(message(cause)); } }} onClose={() => setCastOptions(null)} onQuotes={() => { setCastQuotes(castOptions); setCastOptions(null); }} onShare={() => { setSharedCast(castOptions); setCastOptions(null); }} onQuote={() => { quoteGeneration.current += 1; setQuotedCast(castOptions); setCastOptions(null); }} />}
    {sharedCast && <ShareCastDialog cast={sharedCast} onClose={() => setSharedCast(null)} notify={notify} />}
  </div></ContentControls.Provider>;
}
