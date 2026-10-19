# Quorum for Hypersnap

This standalone browser entry makes Hypersnap public browsing and local signing available without requiring Quorum messenger registration. Quorum's original messenger source, license, fonts, symbol, and theme tokens are preserved in the parent fork. The new web primitives and shell use its semantic tokens; Farcaster wire signing modules are adapted from the MIT-licensed `quorum-shared` source.

## Run

Use Node 22 and Yarn 1.22. `yarn install --frozen-lockfile`, then `yarn dev`. Vite prints the local URL and proxies `/api` to the same public node used in production. `yarn verify` runs the protocol/API/Worker tests and typechecks both browser and Worker code before the production build.

The parent repository's `yarn verify` belongs to the retained Quorum messenger application and needs its linked sibling repositories and dependencies. It does not validate this independent entry; run both when editing both applications. Never bypass its bot mint guard.

## Deploy

`yarn build`, then `wrangler deploy`. `wrangler.jsonc` targets the Arca Cloudflare account, the `hypersnap-quorum` Worker, and the `quorum.arca.computer` custom domain. Use your own account/domain when deploying another fork. Authentication is handled by the local Wrangler CLI; credentials never belong in source or browser environment variables.

The Worker serves static assets and adds CSP, no-referrer, no-store HTML, and other browser security headers. API routes use one fixed upstream (`https://haatz.quilibrium.com`), an explicit route/query allowlist, response size/time bounds, and signed binary message submissions limited to 64 KiB. It forwards neither cookies nor authorization headers, follows no redirects, and emits no application request logs. No database is needed. The upstream node remains a network availability dependency; this version has no failover or independent indexer. Apply appropriate account-level abuse/rate controls before scaling traffic.

## Signing model

An English BIP39 phrase derives the Farcaster custody account at `m/44'/60'/0'/0/0`. A domain-separated HKDF derives an Ed25519 app key, reused across connections. The API response must match the derived custody address. Signer state uses `/v1/signersByFid`, including all pages, expiry and scope checks, and current nonce. A new authorization uses Hypersnap's gasless KEY_ADD, waits for registry visibility, and permits only casts and adding/removing reactions. Its 90-day TTL is independent of this tab's session.

Only the address, public keys, signatures, and public protocol messages are sent. The phrase is never deliberately persisted, logged, included in URLs, or sent to the Worker. The input is cleared immediately after derivation. Mutable buffers are wiped; JavaScript strings and cryptographic library internals cannot be guaranteed to be zeroed. Signing out disables and wipes the current signer buffer without revoking the network registration. Bookmarks and theme are the only application data saved to local storage. Source is linked in the application. No third-party scripts, analytics, embedded mini-app execution, or remote fonts are used.

For a submission timeout, network inclusion is unknown: inspect the profile or signer state before manually retrying. The app never retries writes automatically. Successful submissions are acknowledged by the node, not independently proven finalized.

## Scope and verification

Implemented: public trending feeds, following feeds after connection, username/FID lookup, user casts, indexed channel feeds, conversation reading, casts and replies, like/recast add/remove, bookmarks, dark/light theme, responsive navigation, and session sign-out.

Excluded: creating Farcaster accounts, paid storage/on-chain registration, seed recovery, wallet transfers, DM transport, media uploads, notifications, mention composition, mini-app execution, and signer revocation UI. Existing mentions are returned as protocol text; they are not reconstructed into clickable profile labels in this first version. Channel feeds may be empty on the current public node. The composer creates global casts and explicit cast replies.

Automated checks use synthetic keys, mocked HTTP responses, and an independent Rust protocol golden vector. Live integration checks perform public reads only. A real user login, gasless authorization, and cast still require a user-controlled existing FID and have not been exercised in production by this development session. This is a beta, and no independent security audit is claimed.
