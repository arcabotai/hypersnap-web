// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getChannels, getConversation, getFeed, getInfo, type Cast, type ConversationNode, type User } from './lib/api';

// Exercise the production conversation, cards, mention rendering and quotes.
// All public responses are isolated fixtures; no account is connected.
vi.mock('./lib/api', async original => ({
  ...await original<typeof import('./lib/api')>(),
  getCast: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getInfo: vi.fn(),
}));

const person = (fid: number): User => ({ fid, username: `person${fid}.eth`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, author: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(author), text, timestamp: '2026-10-23T12:00:00.000Z', embeds: [], reactions: { likes_count: 5, recasts_count: 1 }, replies: { count: 1 } });
const imageUrl = 'https://images.example/attached.png';
const videoUrl = 'https://video.example/watch?id=123';
let conversationCast: Cast;
let replies: ConversationNode[];
let quotedCasts: Map<string, Cast>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('opencaster.explore', '1');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  conversationCast = cast('a', 20, 'An isolated public conversation');
  replies = [];
  quotedCasts = new Map();
  vi.mocked(getFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-conversation-test' });
  vi.mocked(getConversation).mockImplementation(async () => ({ cast: conversationCast, replies }));
  vi.mocked(getCast).mockImplementation(async hash => {
    const quoted = quotedCasts.get(hash.replace(/^0x/, ''));
    if (!quoted) throw new Error('This isolated quoted cast is unavailable.');
    return quoted;
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); localStorage.clear(); sessionStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 100 && !ready(); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(ready()).toBe(true);
}

async function start() {
  history.replaceState(null, '', `/cast/${conversationCast.hash}`);
  await act(async () => root.render(<App />));
  await until(() => Boolean(container.querySelector('.conversation-page article.cast')));
}

const featured = () => container.querySelector<HTMLElement>('.conversation-page .cast--featured')!;
const bodyText = () => featured().querySelector<HTMLElement>('.cast__text')!;
function addQuote(quoted: Cast) {
  conversationCast.embeds = [{ cast_id: { fid: quoted.author.fid, hash: quoted.hash } }];
  quotedCasts.set(quoted.hash.replace(/^0x/, ''), quoted);
}

describe('isolated conversation presentation', () => {
  it('shows the complete featured cast below its author header while replies remain compact', async () => {
    conversationCast.text = Array.from({ length: 12 }, (_, index) => `Public conversation line ${index + 1}.`).join('\n');
    const reply = cast('b', 30, 'A long reply. '.repeat(40));
    replies = [{ cast: reply, replies: [] }];
    await start();

    const article = featured();
    expect(article).not.toBeNull();
    const header = article.querySelector('.cast__header')!;
    expect(header.querySelector('.avatar-button')).not.toBeNull();
    expect(header.querySelector('.cast__meta')).not.toBeNull();
    expect(header.querySelector('button[aria-label="More cast options"]')).not.toBeNull();
    expect(header.contains(bodyText())).toBe(false);
    expect(bodyText().textContent).toBe(conversationCast.text);
    expect(bodyText().classList.contains('cast__text--clamp')).toBe(false);
    expect(article.querySelector('.cast__more')).toBeNull();
    const replyArticle = container.querySelector('.conversation-replies article.cast')!;
    expect(replyArticle.classList.contains('cast--featured')).toBe(false);
    expect(replyArticle.querySelector('.cast__text--clamp')).not.toBeNull();
    expect(replyArticle.querySelector('.cast__more')?.textContent).toBe('Show more');
  });

  it('presents image and website attachments together without duplicating standalone URL text', async () => {
    conversationCast.text = `Watch this public conversation.\n\n${videoUrl}`;
    conversationCast.embeds = [{ url: videoUrl }, { url: imageUrl }];
    const original = JSON.stringify(conversationCast);
    await start();

    expect(bodyText().textContent?.trim()).toBe('Watch this public conversation.');
    const attachments = featured().querySelector('.cast__attachments')!;
    expect(attachments).not.toBeNull();
    expect(attachments.querySelector<HTMLImageElement>('.embed img')?.getAttribute('src')).toBe(imageUrl);
    expect(attachments.querySelector<HTMLAnchorElement>('.link-embed')?.href).toBe(videoUrl);
    expect(JSON.stringify(conversationCast)).toBe(original);
  });

  it('retains inline links and UTF-8 protocol mentions after a matching standalone attachment URL', async () => {
    const beforeMention = `${videoUrl}\n🌈 Hello `;
    conversationCast.text = `${beforeMention}, read ${videoUrl} for context.`;
    const byte = new TextEncoder().encode(beforeMention).length;
    conversationCast.mentioned_profiles = [person(42)];
    conversationCast.mentioned_profiles_ranges = [{ start: byte, end: byte }];
    conversationCast.embeds = [{ url: videoUrl }];
    const original = JSON.stringify(conversationCast);
    await start();

    expect(bodyText().textContent?.trim()).toBe(`🌈 Hello @person42.eth, read ${videoUrl} for context.`);
    const mention = bodyText().querySelector<HTMLAnchorElement>('.cast-mention')!;
    expect(mention.textContent).toBe('@person42.eth');
    expect(mention.getAttribute('href')).toBe('/profile/42');
    expect([...bodyText().querySelectorAll<HTMLAnchorElement>('a')].filter(link => link.href === videoUrl)).toHaveLength(1);
    expect(JSON.stringify(conversationCast)).toBe(original);
  });

  it('keeps a standalone authored URL when there is no corresponding rendered attachment', async () => {
    const otherUrl = 'https://other.example/source';
    conversationCast.text = `The original source:\n${otherUrl}`;
    conversationCast.embeds = [{ url: imageUrl }];
    await start();

    expect(bodyText().textContent).toBe(conversationCast.text);
    expect(bodyText().querySelector<HTMLAnchorElement>('a')?.href).toBe(otherUrl);
  });

  it('keeps an attachment URL inline with an inserted mention on the same line', async () => {
    conversationCast.text = ` ${videoUrl}`;
    conversationCast.mentioned_profiles = [person(42)];
    conversationCast.mentioned_profiles_ranges = [{ start: 0, end: 0 }];
    conversationCast.embeds = [{ url: videoUrl }];
    await start();

    expect(bodyText().textContent).toBe(`@person42.eth ${videoUrl}`);
    expect(bodyText().querySelector<HTMLAnchorElement>('a:not(.cast-mention)')?.href).toBe(videoUrl);
  });

  it('shows a compact quoted author, timestamp and image while preserving quoted source text', async () => {
    const quoted = cast('c', 40, `Original quoted text with @literal and ${videoUrl}\nA second line.`);
    quoted.author.pfp_url = 'https://images.example/quote-author.png';
    quoted.embeds = [{ url: imageUrl }];
    addQuote(quoted);
    const original = JSON.stringify(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.textContent).toContain(quoted.author.username);
    expect(quote.textContent).toContain(quoted.text);
    expect(quote.querySelector('time')?.getAttribute('datetime')).toBe(quoted.timestamp);
    expect(quote.querySelector('.avatar')).not.toBeNull();
    expect([...quote.querySelectorAll('img')].map(image => image.getAttribute('src'))).toContain(imageUrl);
    expect(quote.querySelector('a a')).toBeNull();
    if (quote.tagName === 'A') expect(quote.querySelector('a')).toBeNull();
    expect(quote.textContent).not.toContain('Open quoted cast');
    expect(JSON.stringify(quoted)).toBe(original);
  });

  it('restores protocol mentions in quoted text without placing links inside the quote anchor', async () => {
    const beforeMention = '🌈 Hello ';
    const quoted = cast('c', 40, `${beforeMention}!`);
    const byte = new TextEncoder().encode(beforeMention).length;
    quoted.mentioned_profiles = [person(42)];
    quoted.mentioned_profiles_ranges = [{ start: byte, end: byte }];
    addQuote(quoted);
    const original = JSON.stringify(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.querySelector('.quoted-cast__text')?.textContent).toBe('🌈 Hello @person42.eth!');
    expect(quote.querySelector('a')).toBeNull();
    expect(JSON.stringify(quoted)).toBe(original);
  });

  it.each([
    'http://images.example/insecure.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://images.example/vector.svg',
    'https://user:password@images.example/credentialed.png',
  ])('renders no quote thumbnail for an unsupported image URL: %s', async unsafeUrl => {
    const quoted = cast('c', 40, 'Keep the quoted text even when its attachment cannot be displayed.');
    quoted.embeds = [{ url: unsafeUrl }, { url: imageUrl }];
    addQuote(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.textContent).toContain(quoted.text);
    expect([...quote.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([imageUrl]);
  });
});
