# Quorum for Hypersnap

This standalone browser entry makes Hypersnap public browsing and local signing available without requiring Quorum messenger registration. Quorum's original messenger source, license, fonts, symbol, and theme tokens are preserved in the parent fork. The new web primitives and shell use its semantic tokens; Farcaster wire signing modules are adapted from the MIT-licensed `quorum-shared` source.

## Run

Use Node 22 and Yarn 1.22. `yarn install --frozen-lockfile`, then `yarn dev`. Vite prints the local URL and proxies `/api` to the same public node used in production. `yarn verify` runs the protocol/API/Worker tests and typechecks both browser and Worker code before the production build.

`yarn verify` also typechecks and bundles the offline companion. The parent repository's separate verification belongs to the retained Quorum messenger and needs its linked sibling repositories and dependencies. Never bypass its bot mint guard.

## Deploy

`yarn build`, then `wrangler deploy`. `wrangler.jsonc` targets the Arca Cloudflare account, the `hypersnap-quorum` Worker, and the `quorum.arca.computer` custom domain. Use your own account/domain when deploying another fork. Authentication is handled by the local Wrangler CLI; credentials never belong in source or browser environment variables.

The Worker serves static assets and adds CSP, no-referrer, no-store HTML, and other browser security headers. API routes use one fixed upstream (`https://haatz.quilibrium.com`), an explicit route/query allowlist, response size/time bounds, and signed binary message submissions limited to 64 KiB. It forwards neither cookies nor authorization headers, follows no redirects, and emits no application request logs. No database is needed. The upstream node remains a network availability dependency; this version has no failover or independent indexer. Apply appropriate account-level abuse/rate controls before scaling traffic.

## Signing model

The website never accepts a recovery phrase. It generates a random Ed25519 posting key in the browser and asks a compatible wallet app to approve it using `eth_signTypedData_v4`. Desktop extensions and mobile wallet browsers connect through EIP-1193/EIP-6963, without a hosted wallet relay or Farcaster login. The selected wallet must match the public account's custody address. For advanced users, the optional offline **Arca Signer** desktop companion accepts public request/approval JSON files. The browser verifies custody signatures before submitting Hypersnap's gasless KEY_ADD. The key permits only casts and adding/removing reactions, with a **seven-day sliding inactivity window**, refreshed by protocol activity. This is not a fixed seven-day expiration.

Only public addresses, keys, signatures, and protocol messages cross the network. The native app denies network requests and has no phrase persistence, telemetry, remote scripts, or updater. Mutable secret buffers are wiped where possible; JavaScript strings and library internals cannot be guaranteed to be zeroed. The browser keeps its posting key in memory unless the user explicitly chooses a password-encrypted IndexedDB vault (PBKDF2-SHA256, 600,000 iterations; AES-256-GCM). Locking clears the active key but preserves the encrypted vault. Forgetting removes the vault; revoking removes the current key from Hypersnap, confirms its absence, then erases its saved copy. Revocation can also use an offline custody approval. See [SIGNER.md](SIGNER.md) for the full trust model and release verification.

For a submission timeout, network inclusion is unknown: inspect the profile or signer state before manually retrying. The app never retries writes automatically. Successful submissions are acknowledged by the node, not independently proven finalized.

## Scope and verification

Implemented: public trending feeds, following feeds after connection, username/FID lookup, user casts, indexed channel feeds, conversation reading, casts and replies, like/recast add/remove, bookmarks, dark/light theme, responsive navigation, and session sign-out.

Excluded: creating Farcaster accounts, paid storage/on-chain registration, seed recovery, wallet transfers, DM transport, media uploads, notifications, mention composition, and mini-app execution. Existing mentions are returned as protocol text; they are not reconstructed into clickable profile labels in this first version. Channel feeds may be empty on the current public node. The composer creates global casts and explicit cast replies.

Automated checks use synthetic keys, mocked HTTP responses, and an independent Rust protocol golden vector. Live integration checks perform public reads only. A real user login, gasless authorization, and cast still require a user-controlled existing FID and have not been exercised in production by this development session. This is a beta, and no independent security audit is claimed.
