# Familiar client features on Hypersnap

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The [Farcaster client snapshot](https://github.com/farcasterxyz/client/tree/0c289ed93c125cc0f752d90ad224a4a41c31c3f5) is a UX reference. Its README says the snapshot points to production Farcaster APIs. Quorum implements its own UI and uses the fixed Hypersnap gateway; importing the snapshot's services would violate that boundary.

This matrix records the implementation reviewed against [Hypersnap source](https://github.com/farcasterorg/hypersnap/tree/2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c), version 0.13.5. An endpoint name alone does not establish support. Public reads were also checked against the live node; signed writes were tested only with synthetic accounts on an OS-sandboxed loopback node.

| Familiar behavior | Quorum implementation | Boundary |
| --- | --- | --- |
| Home feeds | Discover and Following tabs | Discover is trending; Hypersnap's `for_you` handler aliases trending, so we do not label it personalized. |
| Casts and threads | Public casts, replies, parent links, nested conversations, quotes, deletion, stable cast links | Existing explicit device scopes apply. Deletion needs separate wallet permission and confirmation. |
| Reactions | Like/unlike, recast/undo, authoritative connected-user state after refresh | Hypersnap leaves `viewer_context` empty. We read actual `/v1/reactionById` receipts, keep failures distinct from absence, and limit concurrent reads to four. Unknown submissions remain quarantined in the active session until the intended state is observed. |
| Profiles | Casts, Replies, Photos, Likes, Recasts, followers/following, linked addresses, join date and profile sharing | Likes/Recasts use reverse chronological `/v1/reactionsByFid` history and authoritative target hydration. Deleted targets are skipped; failed reads remain errors. Original publication dates are preserved and reaction dates shown separately. |
| Profile editing | Display name, bio and picture | Banner writes have upstream Pro/hydration limitations. Additional protocol fields are not exposed until their read/edit contracts are implemented. |
| Composer | Inline verified-user mention search, keyboard selection, exact username/FID fallback, UTF-8 counter, Ctrl/Command+Enter | Selecting a suggestion binds its FID; raw `@text`, emails and URLs do not silently become protocol mentions. IME composition and repeated keys cannot publish accidentally. |
| Drafts | Explicit Save, Restore and Discard for an account and destination | Text, public mention references and uploaded image URLs only; session storage, 24-hour TTL, 20 drafts and bounded size. No keys, automatic posting or cross-device synchronization. A refreshed signer for the same account can restore its draft. |
| Photos | Signed upload, clipboard image upload, image viewer, arrow navigation and original link | JPEG/PNG/WebP/GIF, 5 MiB, two total embeds (a quote uses one). Uploads are public immediately, including discarded-draft uploads. Metadata remains retained. |
| Cast tools | Copy text, bookmark, quote, share link/native share sheet | Bookmarks remain on this browser. No undocumented protocol pin operation is invented. |
| Notifications | Recent activity with All, Unread, Mentions, Replies, Reactions and Follows filters | Filters operate over loaded events. The node omits reaction subtype and does not provide a complete historical inbox. Read state is local per account; the `mark_seen` stub is not called. |
| Channels | Active/all/search directory, real channel parent URLs, channel posting, saved shortcuts | Saved channels are browser shortcuts, not network subscriptions. Participant counts represent accounts that posted. Subscription/member writes are upstream stubs and are not shown as supported actions. |
| Discovery and context | Suggested people, paginated channel participants, quote-cast viewer | Suggestions are a bounded friends-of-friends sample. Participants are authors, not subscribers. Quote results are capped at 25; an empty response can also mean the node's quote index is unavailable. |
| Wallet access | Rainbow/browser wallets, optional WalletConnect, local passkey/password protected device keys | Recovery words stay in a wallet. Existing WalletConnect relay/license disclosures remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). |

Unsupported hosted features are not presented as working controls: Farcaster DMs, managed account registration, push delivery, miniapp execution/catalogs, trading, video processing, paid storage, protocol pins, channel subscription management or a personalized recommendation model. Some require new first-party infrastructure; others require missing Hypersnap protocol/index support. Following suggestions, quotes and channel participation reads, when shown, are bounded views of the current node's indexes rather than promises of a complete archive.

Reusable validation, route and local-storage helpers in `hypersnap/src/lib/` are candidates for a future shared Hypersnap mobile package. They do not participate in the retained Quorum messenger's cross-client synchronization protocol.
