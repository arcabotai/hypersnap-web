# Opencaster

**An open source client for everyone. Powered by Arca Computer. Runs on Hypersnap.**

Opencaster is a public browser client for Hypersnap, forked from [Quorum Desktop](https://github.com/QuilibriumNetwork/quorum-desktop). The standalone entry lives in [`hypersnap/`](./hypersnap/); the original Quorum messenger source, AGPL license, and attribution are retained below.

Website: **https://opencaster.org** · [Source](https://github.com/arcacomputer/opencaster) · [Dev log](https://opencaster.org/devlog)

```sh
cd hypersnap
yarn install --frozen-lockfile
yarn dev
# Verify the standalone client, including the Worker and offline signer:
yarn verify
```

Browse profiles, casts, conversations, channels, notifications and search through the fixed Hypersnap gateway. Connect an existing custody wallet through a compatible browser extension or optional WalletConnect to authorize a scoped device key. **Recovery phrases stay in the wallet; the website never asks for them.** Optional passkeys or password encryption protect saved device keys in this browser.

The move from quorum.arca.computer preserves public profile/cast paths and published media links. Browser-local saved keys, passkeys, drafts, bookmarks and preferences remain tied to their original origin; reconnect your wallet and set up optional device saving on the new website. Existing network authorizations are not silently revoked or transferred.

Application code is open source under AGPL-3.0. Optional WalletConnect uses its own Community License; see [third-party notices](hypersnap/THIRD_PARTY_NOTICES.md). See [`hypersnap/README.md`](hypersnap/README.md) for the release process, supported features, infrastructure dependencies and beta limits. This is an independent client, not an official Quorum or Farcaster release.

---

## Original Quorum messenger documentation

# Quorum Desktop

The world's first fully private and decentralized group messenger.
Powered by Quilibrium and the libp2p stack, Quorum can be used over TCP, QUIC, Websockets, or even LoRa — so it can run across the traditional internet, local networks, or off-grid setups.

**Available Platforms:**

- **Web Browser** - [Live app (beta)](https://app.quorummessenger.com/)
- **Desktop** - Electron wrapper for native desktop experience
- **Mobile** - [quorum-mobile](https://github.com/QuilibriumNetwork/quorum-mobile) (React Native + Expo)

- [Official website](https://www.quorummessenger.com/) - [FAQ](https://www.quorummessenger.com/faq)

## Repository Ecosystem

Quorum is built as a **multi-repository ecosystem** where shared functionality is centralized:

| Repository | Purpose |
|------------|---------|
| **[quorum-desktop](https://github.com/QuilibriumNetwork/quorum-desktop)** | Web + Electron desktop app (this repo) |
| **[quorum-mobile](https://github.com/QuilibriumNetwork/quorum-mobile)** | React Native + Expo mobile app |
| **[quorum-shared](https://github.com/QuilibriumNetwork/quorum-shared)** | Shared types, hooks, sync protocol (`@quilibrium/quorum-shared`) |

All clients sync data via the same protocol defined in `quorum-shared`, ensuring messages, bookmarks, and user settings stay in sync across all devices.

## Documentation

For detailed documentation on specific features and components, please refer to the [`.agents/docs`](.agents/docs) directory. You can find the complete index of available documentation in [`.agents/INDEX.md`](.agents/INDEX.md).

**Key Documentation:**

- [Quorum Ecosystem Architecture](.agents/docs/quorum-shared-architecture.md) - Multi-repo system and shared package
- [Component Management Guide](.agents/docs/component-management-guide.md) - Creating cross-platform components
- [Cross-Platform Architecture](.agents/docs/cross-platform-repository-implementation.md) - How the shared codebase works

## Development Resources

The [`.agents/`](.agents) folder contains development resources including:

- Architecture documentation and component guides
- Bug reports and solutions
- Task management ([pending & ongoing](.agents/tasks), [completed](.agents/tasks/.done))
- Mobile development guidelines and cross-platform considerations

### Development Tools

The [`src/dev/`](src/dev) folder contains development utilities:

- **Dev tools** (`/dev`) - Hub for the current available development tools
- **Documentation Viewer** (`/dev`) - Interactive frontend for browsing docs, tasks, and bug reports from the `.agents/` folder
- **Primitives Playground** (`/playground`) - Web-based testing environment for UI primitives and components
- **Mobile Playground** - Comprehensive testing environment accessible by running the mobile app (see Mobile Development section)

#### Headless DM harness

[`src/dev/tests/harness/`](src/dev/tests/harness/README.md) runs the **real desktop
client in Node** - both sides of a conversation, no browser, no devices. It exists
for the DM transport investigation: reproducing decrypt failures, measuring
send-vs-arrive loss, and testing session recovery unattended.

```bash
yarn harness dm-basic      # two bots exchange DMs both ways
yarn harness dm-reorder    # reproduces the upstream decrypt failure in ~35s
yarn harness dm-loss       # send-vs-arrive accounting per direction
```

A sibling harness drives the **mobile** client the same way
(`quorum-mobile/dev/harness/`, `yarn harness:dm`).

Scenarios talk to the production relay and register real accounts, so use
throwaway or dedicated test accounts only. The harness README covers setup, the
full scenario list, and what the bench deliberately does *not* cover.

For the investigation these support, start at
[`.agents/docs/transport-reliability-index.md`](.agents/docs/transport-reliability-index.md).

#### Accessing Development Tools

After running `yarn dev`, you can access the development tools at: `http://localhost:[port]/dev`

#### Testing with Mock Data

Add `?users=N` to any URL to generate mock users/contacts for testing:

```
# Space members list (1000 mock users)
http://localhost:5173/spaces/{space-id}/{channel-id}?users=1000

# Direct messages list (50 mock contacts)
http://localhost:5173/messages?users=50
```

**localStorage (persistent across sessions):**
```javascript
// Enable mock users (Space members)
localStorage.setItem('debug_mock_users', 'true')
localStorage.setItem('debug_mock_count', '1000')

// Enable mock conversations (DM contacts)
localStorage.setItem('debug_mock_conversations', 'true')
localStorage.setItem('debug_mock_conversation_count', '50')

// Disable
localStorage.removeItem('debug_mock_users')
localStorage.removeItem('debug_mock_conversations')
```

## Setup and Development

### Retained messenger setup and full verification

The root package verifies the retained Quorum messenger as well as running
Opencaster’s standalone gate. Use Node 22 and Yarn Classic 1.22:

```sh
# From the repository root
yarn setup:verify
yarn setup:verify --check
yarn verify
```

The setup command restores the exact compatible shared-library and SDK source
revisions listed in [`scripts/verification-dependencies.json`](scripts/verification-dependencies.json),
installs their frozen Yarn lockfiles, builds their missing `dist/` artifacts,
and installs the root and `hypersnap/` packages independently. The source
checkouts live under ignored `.quorum-deps/`, with local `link:` dependencies;
no sibling checkout or global `yarn link` is required.

The retained messenger uses `quorum-shared` **2.1.0-45** at
`c00c61e099fe9e682c982bc952b4e712c7a4a576` and the SDK **2.1.1** at
`882d8e1b520fc97c73be964013b06a57ca4f4a63`, matching its recorded upstream
verification environment. Intentional dependency updates need an explicit
manifest pin and a clean matching checkout. Setup refuses unexpected origins,
versions, revisions or local changes rather than resetting them. Its immutable
local comparison ref lets verification detect later committed or uncommitted
dependency changes.

`--check` validates the pinned sources, built artifacts and installed root links
without changing files. `--deps-only` restores/builds the source dependencies
without installing either application. Opencaster can still be installed and
verified independently from `hypersnap/`, using its own manifest and lockfile.

The root gate validates the dependency setup, runs messenger typecheck, lint,
unit tests, offline harness and build, then runs `hypersnap/yarn verify` in its
own directory. Generated output and dependency checkouts are excluded from
lint; application sources remain checked. The normal routing, failure handling,
known-red ceilings and permanent-account mint guard remain active. A fresh
checkout can correctly report **PASS (PARTIAL)** because production live arms
would create permanent accounts or Spaces; do not bypass the guard to obtain
a bare PASS. Optional quorum-mobile cross-client coverage still needs that
separate repository and existing persisted test identities.

When running the retained messenger locally, its Vite server proxies the Quorum
API through the same origin. Opencaster uses its own fixed Hypersnap gateway.
The two applications have separate build entries and dependency toolchains.

### Web Development

To run the web app in development:

```bash
yarn dev
```

To run in Electron desktop app:

```bash
yarn dev

# In another terminal
yarn electron:dev
```

To build for production and preview:

```bash
yarn build:preview
```

### Mobile Development

The mobile app lives in a separate repository: **[quorum-mobile](https://github.com/QuilibriumNetwork/quorum-mobile)**

Both apps share code via the `@quilibrium/quorum-shared` package. See [Quorum Ecosystem Architecture](.agents/docs/quorum-shared-architecture.md) for details on the multi-repo setup.

## Translation Workflow

> All the existing translations (apart from English) have been created using an LLM.  
> Communities are welcome to proofread and correct them. We are setting up a dedicated platform to do just that.
> **Proofreading completed for**: English, Italian.

### To Correct an Existing Language

1. Correct the file: `src/i18n/<locale>/messages.po`
2. Run the command:
   ```bash
   yarn lingui:compile
   ```
   This updates the `messages.js` file in `src/i18n/<locale>/messages.js`.
3. Commit the changes and push to the remote repository.

### To Add a New Language

1. Add the language to `locales.ts` in: `src/i18n/locales.ts`
2. Run the command:
   ```bash
   yarn lingui:extract
   ```
   This creates the `.po` file in `src/i18n/<new-locale>/messages.po`.
3. Translate the messages in the `messages.po` file.
   - To translate via LLM, you can use: [po-files-translator](https://github.com/lamat1111/po-files-translator) (even if you choose to use an LLM, it's important to proofread the final text)
4. Run the command:
   ```bash
   yarn lingui:compile
   ```
   This creates the `messages.js` file in `src/i18n/<new-locale>/messages.js`.
5. Commit the changes and push to the remote repository.

---

_Updated: 2026-07-28_
