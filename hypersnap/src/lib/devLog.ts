export type DevLogTag = 'Launch' | 'Wallets' | 'Security' | 'Social' | 'Reliability';

export interface DevLogMilestone {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly summary: string;
  readonly changes: readonly string[];
  readonly commit: string;
  readonly tag: DevLogTag;
}

// Dates match the commits' author and committer timestamps, both recorded at
// UTC−03:00. This is the standalone Hypersnap client's history; Quorum Desktop
// and the underlying social protocols predate this project.
export const PROJECT_STARTED_DATE = '2026-10-19';
export const PROJECT_STARTED_AT = '2026-10-19T04:13:15-03:00';

/** Newest first. Each source link identifies the code behind that milestone. */
export const DEV_LOG: readonly DevLogMilestone[] = [
  {
    id: 'dev-log-release-checks',
    date: '2026-10-21',
    title: 'Every release gets a dev log update',
    summary: 'A release check helps keep this public story current as features and fixes ship.',
    changes: [
      'CI now flags product changes that arrive without a new dated milestone; editing an old entry does not count.',
      'New milestones need a description and an existing source commit, while earlier history stays available.',
      'The release instructions require the same check before deployments, including hotfixes.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/54d9c051d5f10611a86dd25cbfa3e0ce6ea1c44b',
    tag: 'Reliability',
  },
  {
    id: 'public-development-log',
    date: '2026-10-21',
    title: 'The project’s story, open to everyone',
    summary: 'A public dev log brings together the work since the first Hypersnap client commit, with links to the code behind each milestone.',
    changes: [
      'Browse the full timeline without signing in, or filter by wallets, security, social features and reliability.',
      'Read from the beginning or start with the latest changes, on desktop or mobile.',
      'Keep the project’s security model, infrastructure dependencies and beta limitations alongside its progress.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/4a70b32ebde73989cb222e55097c604235630b42',
    tag: 'Launch',
  },
  {
    id: 'community-avatar-fallback',
    date: '2026-10-21',
    title: 'Community profiles stay readable when pictures fail',
    summary: 'A small follow-up made suggested people and channel participants more resilient to unavailable profile images.',
    changes: [
      'Unavailable community avatars now fall back to initials.',
      'Profile links and account names remain usable when an image cannot load.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/d1e1502b658b4fc6828a21e8f292080fae0a243e',
    tag: 'Reliability',
  },
  {
    id: 'familiar-social-features',
    date: '2026-10-21',
    title: 'More of the everyday social experience',
    summary: 'Familiar client features were built against supported Hypersnap reads and signed messages, with local conveniences kept clearly labeled.',
    changes: [
      'Added Likes and Recasts profile history and account-specific reaction status that survives refresh.',
      'Added explicit local draft recovery, inline mention suggestions, pasted photos and keyboard publishing.',
      'Added an image viewer, profile sharing, linked-address details and copy-cast-text tools.',
      'Added saved channel shortcuts, activity filters and bounded views of suggested people, channel participants and quotes.',
      'Kept uncertain reaction writes blocked until a fresh read shows their intended state.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/999fa270a5d5d2063465893e04e157b02c3ee069',
    tag: 'Social',
  },
  {
    id: 'passkey-protected-devices',
    date: '2026-10-20',
    title: 'Passkeys for saved device keys',
    summary: 'Compatible passkey providers can use WebAuthn PRF to protect an already authorized posting key in this browser.',
    changes: [
      'Added optional passkey encryption and unlock for the local device vault.',
      'Kept custody-wallet approval for the first connection, expired or revoked keys, and additional permissions.',
      'Preserved password-encrypted vaults and memory-only access. Passkey-provider synchronization does not synchronize this app’s local vault.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/911bbc4f30d0eb77b3b5d82fc43f3af60da1c7d9',
    tag: 'Security',
  },
  {
    id: 'discovery-and-conversation-tools',
    date: '2026-10-19',
    title: 'Search, activity, quotes and channels',
    summary: 'The client expanded from browsing feeds into finding people, following conversations and posting in indexed channels.',
    changes: [
      'Added public cast and people search, recent activity, and shareable Replies and Photos profile tabs.',
      'Added channel discovery, search, detail pages and channel posting.',
      'Added quote casts and confirmed deletion of the connected account’s own casts.',
      'Required a separate wallet permission upgrade and an explicit confirmation before deleting a cast.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/b5c1f0444efd09bf92ca630fb1b39ad299006908',
    tag: 'Social',
  },
  {
    id: 'isolated-protocol-testing',
    date: '2026-10-19',
    title: 'Testing real Hypersnap flows in isolation',
    summary: 'Signed test actions used synthetic accounts on an isolated Hypersnap node. An independent security audit remains outstanding.',
    changes: [
      'Exercised device approval, follows, profile edits and image-backed casts against actual node software.',
      'Fixed stale profile reads, confirmation of saved fields, imported compact follows and editing around unchanged legacy avatars.',
      'Handled the node’s one-device-key-per-minute limit and kept unknown write outcomes from being retried automatically.',
      'Checked persistence across a cold node restart without submitting actions to production accounts.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/3b6805589c0be7b7a0cca4c8fcb104700c9eeb21',
    tag: 'Reliability',
  },
  {
    id: 'social-routes-and-public-media',
    date: '2026-10-19',
    title: 'Shareable profiles, follows and public images',
    summary: 'The first substantial social expansion added stable public links and more ways to participate using a limited device key.',
    changes: [
      'Added cast permalinks, profile URLs, browser history navigation and nested conversations.',
      'Added verified mentions, follower and following lists, follows, and display-name, bio and picture editing.',
      'Made expanded social permissions an explicit new wallet approval, keeping existing access until the new key is confirmed.',
      'Added authenticated public image uploads using Cloudflare R2 and a quota ledger. Uploaded images are persistent and retain photo metadata.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/71db400682d3b03ab1a119eca56fa7d0ee4e45bf',
    tag: 'Social',
  },
  {
    id: 'rainbow-wallet-support',
    date: '2026-10-19',
    title: 'Rainbow in the browser and on mobile',
    summary: 'Rainbow support grew from mobile pairing links into direct discovery of the browser extension.',
    changes: [
      'Added Rainbow mobile wallet pairing and approval links.',
      'Prioritized the detected Rainbow extension and connected to its specific provider when several wallets were installed.',
      'The project owner reported a successful Rainbow browser-extension sign-in; automated checks continued to use synthetic identities.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/a0bc982419420fced22342f54ca536240325ff9d',
    tag: 'Wallets',
  },
  {
    id: 'walletconnect-browser-access',
    date: '2026-10-19',
    title: 'Connect a wallet app from Chrome or Safari',
    summary: 'Optional WalletConnect pairing let a regular browser request approval from a separate compatible wallet app.',
    changes: [
      'Added locally generated pairing QR codes and mobile wallet links.',
      'Requested typed-data approval for the device key, leaving recovery phrases and custody keys inside the chosen wallet.',
      'Documented the external relay dependency and the SDK’s WalletConnect Community License.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/62d6c7844a03be1920b6c9af8114f069328aecc8',
    tag: 'Wallets',
  },
  {
    id: 'wallet-first-device-approval',
    date: '2026-10-19',
    title: 'Move recovery phrases out of the website',
    summary: 'The early sign-in prototype was replaced with wallet-approved random device keys and an optional offline approval companion.',
    changes: [
      'Removed recovery-phrase entry from the website and introduced limited, independently generated posting keys.',
      'Added optional password-encrypted local storage, locking, forgetting and device revocation.',
      'Introduced the optional Apple Silicon macOS signer beta. Its Developer ID signature does not replace an audit, and Apple notarization was deferred.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/ae8a469357cf77f70b129e5b2d1d3f39360ae3e2',
    tag: 'Security',
  },
  {
    id: 'public-client-prototype',
    date: '2026-10-19',
    title: 'A public Quorum client for Hypersnap',
    summary: 'The project began as a Quorum Desktop fork with a standalone browser client for Hypersnap’s public social network.',
    changes: [
      'Preserved Quorum’s visual language while adding public feeds, profiles and conversations.',
      'Added casts, replies, reactions, local bookmarks and a fixed gateway to the Hypersnap node.',
      'Explored browser-local recovery-phrase-derived signing in the first prototype. The next milestone replaced it with wallet-first approval.',
    ],
    commit: 'https://github.com/arcabotai/hypersnap-web/commit/52af2a579f7608df67974e72ae317c9794bd186b',
    tag: 'Launch',
  },
];
