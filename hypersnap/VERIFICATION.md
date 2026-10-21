# Release log checks · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **467 tests across 29 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. Seventeen new tests use temporary local Git repositories to exercise missing milestones, editing/reordering old entries, valid ancestor source commits, wrong dates, missing/nonancestor source objects, history deletion, development-only exemptions, untracked runtime files, explicit-head isolation, missing bases, feature-branch merge bases and initial pushes. Static validation rejects executable expressions, duplicate IDs, impossible dates and incorrect ordering. No new dependency, network/account write or signing permission is introduced.

The CI guard reads literal milestone data through the existing TypeScript compiler without importing code from either revision. Default-branch pushes compare before/after commits; PRs and feature/tag pushes compare against their merge base. A tag named `main` cannot be mistaken for the default branch. Full Git history is fetched, and absent history fails with an actionable message. CI always reports its check, including docs-only changes. The release checklist and scoped agent instructions require the same guard before every deployment and require user-facing prose to cover each shipped feature or fix. The check proves that a new valid entry exists; it cannot judge prose accuracy or intercept a direct manual Wrangler command.

The public log now also records its own launch and these release checks. Source release `9010a0ddce02dc9a6c93e9f254a0d34f4d89cea7` was deployed as Cloudflare Worker version `73f3c404-1e84-40b9-8eca-206e7128dfb5` from a fresh external asset directory. [Main CI run 39546661188](https://github.com/arcabotai/hypersnap-web/actions/runs/39546661188) passed the new release-note guard, all verification and signer payload reproducibility. A fresh signed-out browser tab confirmed all twelve milestones on the live `/devlog`, with the release-check entry first and its implementation source link intact. Production checks used public reads only. The retained messenger's root gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   4a70b32  ⚠ working tree dirty (7 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/.github/workflows/hypersnap.yml, desktop/hypersnap/package.json, desktop/hypersnap/src/lib/devLog.ts)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Public dev log · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **450 tests across 28 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. This release adds a static, lazily loaded `/devlog` route, ten source-linked historical milestones, topic filters and chronological ordering. Dates were checked against commit author/committer timestamps; date rendering uses an explicit UTC calendar format to avoid moving October 19 milestones to October 18 for visitors west of UTC. Existing route tests cover the public path and canonical URL. No social API, signing, wallet permission or storage contract changed, and no account mutations were needed for these checks.

Browser QA checked direct loading of `/devlog`, all ten milestones, oldest-first ordering, topic filtering, desktop navigation and a separate 320-pixel iframe preview. The mobile header link opened the log from Discover without sign-in. The iframe check establishes layout behavior rather than physical-device or wallet interoperability. Preview-only wrapper files were created outside the deployable assets. No wallet connection, signed message, upload or production account mutation was used.

The inherited messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   d1e1502  ⚠ working tree dirty (8 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/lib/navigation.test.ts, desktop/hypersnap/src/lib/navigation.ts)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Verification record · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

## Familiar client feature release

The standalone `cd hypersnap && yarn verify` gate passes **450 tests across 28 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. No runtime dependency was added. The existing published native beta is unchanged. [FEATURE_SUPPORT.md](FEATURE_SUPPORT.md) maps familiar Farcaster behavior to source-backed Hypersnap support and records unsupported/stubbed APIs.

New coverage includes reverse chronological Likes/Recasts profile history with authoritative cast hydration, exact reaction absence classification, account-scoped reaction reads, four-read concurrency bounds, cancellation and a 25-second aggregate history deadline. Active-session reaction uncertainty survives card remounts and blocks repeat writes while the node still shows the earlier state. Account changes and stale read versions cannot clear that quarantine. Explicit draft recovery, account/destination isolation across signer rotation, size/age/storage failures, inline mention selection and stale search cancellation, clipboard image uploads, IME/repeated-key guards, keyboard publishing, image navigation, profile sharing, local channel shortcuts, activity filters and bounded community panels have regression coverage.

A new OS-sandboxed fixture at `/tmp/arca-hypersnap-e2e-familiar` uses the pinned actual Hypersnap binary, consensus, RocksDB, protocol signature/registry validation and real indexes. The actual app auth/vault/API and Worker/SQLite Durable Object/R2 runtime completed **14 signed submissions and 131 node requests**, all synthetic/loopback-only. Its `feature-checks-proof.json` confirms profile edits/search, quotes, channels, media bytes, all five profile tabs, real like/recast receipts, account isolation, add/remove inclusion and history disappearance, recent activity, deletion and stale search-index filtering. A subsequent GET-only run completed **9 reads, zero signed submissions**, confirming the reverse quote index, channel participants, suggestions endpoint and removed reaction states. That fixture returned no friend-of-friend suggestions; the UI does not fabricate recommendations.

Browser QA used an injected synthetic wallet on the same isolated node. Explicit draft save → navigate away → restore worked; inline mention search resolved an actual indexed FID and Enter selected it without posting. Saved-channel directory and sidebar shortcuts, notification filters, clipboard PNG upload, Command+Enter cast submission, the Photos route and image viewer were checked. The uploaded image decoded at 512×512 from local R2. A signed Like remained `Unlike` after an explicit fresh feed read. No production wallet, account, passkey or media mutation was performed. These checks do not establish real Chrome/Safari/Android/iOS provider interoperability or an independent security audit.

Quote results are a bounded node-index sample and may be incomplete or unavailable; channel participants are authors, not subscribers; notification filters operate over loaded recent activity; saved channels, read state, bookmarks and drafts are local. Drafts are explicitly saved in tab-scoped storage for up to 24 hours and are never automatically submitted. All social API routes retain the fixed Hypersnap upstream and query/response limits. Existing optional WalletConnect relay/license conditions remain disclosed separately.

The retained messenger's root gate still lacks its original dependencies and sibling repositories. Its production-account mint guard remained enabled. Full current receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   911bbc4  ⚠ working tree dirty (34 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/e2e-feature-checks.ts, desktop/hypersnap/scripts/e2e-media-runtime.mjs, desktop/hypersnap/scripts/e2e-media-runtime.test.mjs)
            (… and 26 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Earlier verification records

# Verification record · 2026-10-20

## Passkey-protected local device vaults

The standalone `cd hypersnap && yarn verify` gate passes **363 tests across 22 files**, browser/Worker/native TypeScript, production browser build, and the offline signer payload build. The optional published native beta is unchanged. No new runtime dependency or authentication service is introduced.

New passkey checks cover exact origins/RP IDs, fresh challenges, native response shape and credential identity, user presence and verification, PRF availability, bounded cancellation/timeouts even for late native promises, and clearing both raw and copied PRF outputs. Local vault tests use real HKDF/AES-GCM, authenticated metadata, malformed/tampered records and an independent legacy password-vault fixture. Auth regressions verify current custody/scopes/expiry after unlock, no signer submission, preservation on failed/cancelled setup, whole-record atomic replacement, same-key cross-tab races, late-commit rollback, and erasing PRF material before network reads. UI regressions cover explicit fresh-click enrollment, opt-in storage, legacy passwords, unsupported providers, closing during saves/unlock, corrupt-vault recovery, stale storage reads, and account changes during pending operations.

The repeatable [passkey check runner](scripts/e2e-passkey-checks.ts) uses the actual app WebAuthn adapter, real vault cryptography, in-memory IndexedDB, the real Worker, and the existing OS-isolated Hypersnap node's actual synthetic signer registry. Only the authenticator is a synthetic WebAuthn/PRF provider. It completed password unlock, failed/cancelled setup preserving the old vault, v2 migration, lock/passkey unlock, wrong-origin rejection before a prompt, wrong-PRF rejection and unchanged permissions. Its proof records **9 public reads, zero network writes and zero production writes** at `/tmp/arca-hypersnap-e2e-features/passkey-checks-proof.json`. No real user passkey, wallet approval or production vault was created or changed. A static browser preview of the actual device-settings component was checked with all actions disabled; physical OS/browser/passkey-provider interoperability remains untested by agents.

Passkeys are recommended only when the selected browser/provider returns a valid PRF output. API availability alone does not establish PRF support. Existing password vaults remain readable, and users can choose password encryption or memory-only access explicitly. Credential synchronization by a passkey provider does not synchronize this browser's local ciphertext; a new browser/device or cleared site storage needs custody-wallet reconnection. An unlocked signer and the delivered website code remain trust boundaries. See [SIGNER.md](SIGNER.md) for recovery, storage, provider synchronization and threat-model details.

The Worker explicitly permits WebAuthn create/get only for its own origin, while retaining its existing CSP/frame/credential-forwarding restrictions. No new third-party network destination is required for passkey vault encryption; the selected passkey provider may operate its own credential synchronization independently.

The retained messenger's separate root gate still lacks its original dependencies and sibling repositories. Its permanent-production-account mint guard remained enabled. Current full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   0e1f14b  ⚠ working tree dirty (15 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/components/ConnectAccount.tsx, desktop/hypersnap/src/lib/auth.test.ts, desktop/hypersnap/src/lib/auth.ts)
            (… and 8 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Earlier feature release verification

## Expanded client feature release

The standalone client passes its complete `yarn verify` gate: automated unit, component and integration tests; browser/Worker/native TypeScript; production browser build; and offline companion payload build. **298 tests across 20 files pass.** These checks are separate from the retained messenger gate.

A fresh OS-sandboxed local Hypersnap node at the pinned source revision below ran real signatures, registry/state validation, consensus, RocksDB, social/channel/Tantivy indexes, and the production Worker with actual local SQLite Durable Objects/R2. Two synthetic accounts completed **11 signed submissions and 99 actual node requests** in the final repeatable backend feature run. Its proof reports `productionWrites: 0`, `apiMocked: false`, `registryMocked: false`, and genuine cryptographic signatures. No production wallet approval, account mutation, or upload occurred.

Verified flows: encrypted-vault unlock; display-name editing and prefix user search; cast search with authoritative hydration; cast-ID quotes; channel parent URLs, discovery, search, detail and feed; signed upload grants and byte-exact PNG reads; image casts; Casts/Replies/Photos filtering; follows/reactions/replies/mentions in recent activity; own-cast deletion confirmed absent; foreign deletion rejected before submission; and unfollow cleanup. The node's raw Tantivy index retained a deleted cast; the client now checks bounded search hits against authoritative cast reads and filters only exact confirmed absence. Other read failures remain errors. Search uses up to 25 hits, four concurrent hydration reads, and one 25-second overall deadline.

Browser QA on the actual isolated node confirmed default and expanded synthetic wallet connections; quote submission and deleted-quote placeholders; separate deletion approval/confirmation; actual channel posting and cast search; recent activity and local read state; and a fresh uploaded image appearing on the shareable Photos tab. The image decoded to 512×512 from our local R2 route. The key-upgrade preflight blocked a too-early approval with the actual registry cooldown, then allowed a fresh lookup and confirmed the new key. Browser file-picker automation was slow; this is not a measurement of the website’s upload latency.

React integration regressions additionally cover query history and conversation backgrounds, profile-tab cancellation and late results, pagination cancellation/late errors, quote attachment limits, explicit deletion-key approval followed by independent confirmation, cancelled approvals preserving the old session, late quote receipts preserving a replacement draft, chronological channel-page merging, and exact refresh retries. Existing scopes remain unchanged; deletion requires a new explicitly reviewed `[1,2,3,4,5,6,11]` key. Native offline beta approval remains limited to its original scopes.

Notifications are bounded recent activity rather than a complete archive; read state is per FID on this browser. The upstream adapter omits reaction subtype, so the UI says “reacted” instead of guessing like versus recast. Search indexes and channel directories remain Hypersnap node capabilities. Photos currently covers supported image embeds. No Farcaster-operated API/authentication dependency was introduced; the previously approved optional WalletConnect relay remains an external wallet-transport dependency.


The retained messenger gate was rerun for this release and still cannot invoke its original absent tools/sibling projects. Its mint guard was respected. Full receipt (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   3be63ba  ⚠ working tree dirty (34 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/package.json, desktop/hypersnap/scripts/e2e-bootstrap-node.ts, desktop/hypersnap/scripts/e2e-media-runtime.mjs)
            (… and 25 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Previous social and wallet verification

The standalone Hypersnap entry passes `cd hypersnap && yarn verify`: **211 tests** across 17 files (31 gateway, 10 media Worker, 13 API, 10 pairing boundary, 8 native signer, 39 auth, 8 vault, 24 wallet provider, 13 WalletConnect adapter, 7 SDK lifecycle, 1 independent Rust protocol golden vector, 8 navigation, 3 profile validation, 7 profile draft validation, 20 UTF-8 mention, 6 media helper, and 3 isolated-harness boundary tests), TypeScript for browser/Worker/native code, and browser plus native payload builds.

The end-to-end run booted actual Hypersnap `0.13.5` from pinned source with a startup-only RocksDB correction, local consensus and persistent stores. An OS network sandbox denied non-loopback traffic. Synthetic registrations were seeded through Devnet admin events, then the same database was restarted in isolated Mainnet mode for the app's unchanged network-1 messages. See [E2E-node.md](E2E-node.md) for source pins, the exact patch, configuration and bootstrap commands.

The browser exercised ordinary wallet-style EIP-6963 approval, default-key registration, explicit six-scope registration, name/bio edits while preserving an unchanged legacy IPFS avatar, an uploaded avatar, normal follow/unfollow, follower-list hydration, compact-state-only follow detection and subsequent removal, a delayed profile response, image casting, and copy-link feedback. Fresh API reads and cold node restarts confirmed persisted profile values, expanded authorization, compact-follow removal and cast data. The browser harness alone substitutes exact loopback media URLs and a synthetic wallet; the independent backend media run retains the canonical production origin. The production build contains no harness or synthetic-wallet code.

This run found and fixed unchanged-avatar validation blocking other edits, premature profile-save success, late profile-read rollback, and compact-only follow detection. It also reproduced Hypersnap's always-on one-KEY_ADD-per-minute/FID limiter: the node returned HTTP 400 with `bad_request.rate_limited`, even though the six-scope format is valid. The client now checks recent offchain `addedAt` timestamps before requesting wallet approval, and the Worker narrowly maps that verified error to `429`. Only a definite `429/rate_limited` permits an explicit retry of the retained approved key, with fresh custody/nonce checks. Unknown outcomes remain status-only and never resubmit automatically.

The real Worker also returned `429` for the captured node rate-limit condition. The pre-approval cooldown and retained-approval retry are covered by auth regressions. A later optional browser cooldown probe could not obtain a newly committed signer after the single-validator fixture entered an upstream consensus/WAL replay failure; this does not count as a GUI cooldown pass. Earlier profile, follow and cast persistence checks had already completed. The failure and cleanup are recorded in [E2E-node.md](E2E-node.md).

The social client update uses Hypersnap commit `2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c` as its wire/API reference. No Farcaster-hosted HTTP, websocket, authentication or Snapchain integration was imported from the MIT client snapshot. Default keys retain `[1,3,4]`; an explicit wallet review can authorize a new key for `[1,3,4,5,6,11]`. Synthetic tests cover exact expanded KEY_ADD signatures, link/user-data wire fields, current custody/scope checks, vault compatibility, partial profile saves and unknown-write quarantine. Profile banner writes remain excluded because of Hypersnap's Pro restriction and hydration limitations.

Anonymous browser smoke verified `/profile/<fid>` resolution, follower-list loading, profile navigation/Back, canonical cast sharing with clipboard feedback, `/cast/<hash>` conversation navigation and hard reload, nested reply rendering, share dialog above a conversation, and the explicit social-permission review without any wallet approval or submission. The owner previously reported a successful Rainbow account connection. Those anonymous checks performed no account writes; the separate synthetic-account end-to-end run below covers signed mutations.

Media unit checks use synthetic identities and mocked services. The new end-to-end backend run uses the actual local Hypersnap registry plus actual local Cloudflare SQLite Durable Objects and R2. With unchanged canonical HTTPS origins, it confirmed upload `200`, replay `409`, exact image read `200`, invalid image `415`, expired grant `401`, and unregistered key `403`. Browser checks additionally decoded a 512×512 uploaded image, saved it as the avatar, rejected a disguised SVG, and published an image cast. See [MEDIA.md](MEDIA.md) for the isolated runtime and production storage boundaries. No production account or bucket received a test upload.


Wallet tests use independent viem EIP-712 hashing and synthetic keys to verify exact KeyAdd, SignedKeyRequest, and KeyRemove compatibility. They cover custody mismatch, account/network changes, rejected or malformed signatures, bounded timeouts, cancellation between prompts, provider discovery and untrusted metadata. Vault tests include actual IndexedDB transactions across two connections, preventing another tab’s replacement vault from being erased. Unknown network writes are never automatically resubmitted.


WalletConnect uses the current pinned 2.26.0 SignClient/Core with the project owner’s explicit approval of its Community License and external relay. The project ID is configured in ignored local build environment files and a GitHub Actions public repository variable; no Dashboard API secret is used. Runtime dependency audit reported zero advisories. The SDK is lazy-loaded, uses fresh memory storage and a unique prefix, disables telemetry and global Core caching, permits only the exact displayed typed-data operation, and clears local session/pairing keys during bounded cleanup. The temporary nonsecret SDK environment flag is restored after initialization.

A live browser pairing with the supplied project ID produced a real local QR and canonical wallet-app links. A separate synthetic SignClient peer settled the restricted Mainnet namespace, received and checked the exact FID 1234 KeyAdd scopes `[1,3,4]` and TTL `604800`, then returned user rejection code 5000. The browser showed the controlled rejection, cleared pairing UI, and kept network submission disabled. The synthetic test produced no signature or Hypersnap write; its private temporary pairing file was deleted and relay keys cleared. Rainbow mobile pairing and pending-signature reopening routes were added from its official RainbowKit connector and app handler. The same 110-test gate and production browser/native builds passed after this change. Physical mobile-wallet approval remains untested by agents; the owner later reported successful Rainbow extension connection.

Rainbow browser extension support uses EIP-6963 `me.rainbow` plus its official direct `window.rainbow`, `isRainbow`, and bounded legacy provider-list shapes. Nine additional discovery regressions cover competing extensions, copied announcements, late identification, retained provider references, wallet caps, and untrusted getters/metadata. The 119-test gate and production browser/native builds passed. The browser-wallet UI comes first, prioritizes detected Rainbow, and offers official extension setup guidance when absent. No real extension approval or Hypersnap mutation was performed by agents.

Native UI smoke verified importing a public synthetic request, reviewing public account/key/permissions, signing with a public test-only 24-word phrase, clearing its input, and exporting an approval whose signatures then verified cryptographically. Browser smoke covered public account lookup, phrase-free sign-in, mobile wallet guidance, and rejecting an approval for another request. Native payload builds were repeated and their manifests matched.

Production checks perform public reads only. All new signed mutations used public synthetic keys on the isolated local node; no real wallet approval or production signer, cast, follow, profile, or media write was submitted. Physical iOS/Android wallet approval remains untested. Cross-platform support uses documented EIP-1193/EIP-6963 and typed-data-v4 interfaces; it is not a claim that every wallet/browser combination works. No independent security audit is claimed. The optional macOS beta is Developer ID signed; notarization is deferred.

The live node’s HTTP `requesterFids` sequence query fails to decode; bracket queries are ignored. The UI therefore supports custody-approved removal through wallet or offline signatures using the current user nonce, rather than guessing an app nonce. No upstream node mutation was performed.

The Worker uses manual redirects and rejects all upstream redirects, with regression coverage for Cloudflare runtime compatibility.

The retained Quorum messenger is separate. Its root verification was attempted but cannot run its tools without the original dependencies and sibling shared/SDK repositories. Its permanent-account mint guard was respected. This is the complete recorded verdict from this end-to-end test update (line-end padding omitted), not a passing messenger regression run:

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   3b68055  clean
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/e2e-bootstrap-node.ts, desktop/hypersnap/scripts/e2e-browser-server.mjs, desktop/hypersnap/scripts/e2e-media-checks.mjs)
            (… and 16 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```
