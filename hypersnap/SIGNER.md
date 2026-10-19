# Arca Signer beta

The website never asks for your recovery phrase. Use a compatible wallet app to approve a limited posting key; your custody key stays in that wallet. The optional offline signer offers another way to approve the same requests. Neither approach makes an unaudited app or compromised computer safe. No independent security audit has been completed.

## Connect with a wallet app

1. Open `https://quorum.arca.computer` in the browser where your wallet is installed. Under **Browser wallet**, choose **Connect Rainbow extension & approve** to use Rainbow directly. If it is missing, install or enable the [official Rainbow extension](https://rainbow.me/extension) and refresh wallet detection in that browser. The embedded preview browser cannot access extensions installed in Chrome. For a separate mobile wallet, choose **Connect wallet app** for WalletConnect: scan the QR code from another device, or tap your installed wallet on the same phone. Keep the browser tab open. Opening a different browser starts a separate device session.
2. If your Farcaster custody wallet is not already in your chosen wallet, import its 24-word phrase **inside the wallet's own import screen**. Never paste it into this website. Use the wallet's add/import flow rather than resetting an existing wallet. Check the wallet's own backup and cloud-sync settings before importing.
3. Find your public Farcaster account on Quorum. Select the imported custody address in the wallet; a different verified address cannot approve this account.
4. Review the browser's complete posting key, permissions, and inactivity lifetime. Choose your wallet and approve the two typed signing requests: `KeyAdd`, then `SignedKeyRequest`. On mobile, return to the browser between prompts and use **Open wallet to approve** again if the phone does not switch automatically.
5. The website verifies both signatures against the custody address. Select **Connect to Hypersnap** to register the posting key. Future casts and reactions use that limited device key, with optional password-encrypted local storage.

Direct browser connections use standard EIP-1193 requests and EIP-6963 discovery. Wallet providers and their supplied names are not authenticated by discovery; choose software you trust. A malicious extension can impersonate another wallet. The optional WalletConnect route connects a separate wallet app through Reown's external relay; it needs a configured public project ID. Neither route uses a Farcaster sign-in service.

The mobile app buttons include MetaMask, Trust Wallet, and Rainbow. Rainbow uses its [official universal WalletConnect link](https://github.com/rainbow-me/rainbowkit/blob/main/packages/rainbowkit/src/wallets/walletConnectors/rainbowWallet/rainbowWallet.ts) for pairing and `rainbow://wc` to reopen pending signature requests. On desktop, Rainbow can scan the same WalletConnect QR code; its compatible extension is discovered through the browser wallet option. Physical wallet/browser combinations still require device testing.

### WalletConnect privacy and connection lifetime

WalletConnect encrypts messages between the browser and wallet. Recovery phrases and custody private keys stay in the wallet. Encryption does not hide routing metadata: the relay can observe connection IPs, project/client identifiers, random topics, message sizes, timing, and protocol tags. Verify can receive the site's origin and message identifiers for domain attestation. Reown's [privacy policy](https://reown.com/privacy-policy) also describes data collected across its broader services; do not treat encrypted transport as anonymity.

The connection requests Ethereum Mainnet typed-data signing only. It does not request transfers, swaps, social/email authentication, or blockchain balance queries. The site uses the minimal SignClient library, locally generated QR codes, and reviewed wallet-opening links rather than AppKit. The WalletConnect session and pairing are disconnected after the signing attempt finishes or is cancelled; the browser's separate posting key remains subject to the Hypersnap authorization you approved. Reject a prompt left open in the wallet if you cancel here. Closing a website cannot force a wallet app to close its own prompt.

The pairing QR/link includes an ephemeral encryption secret. Share it only with your intended wallet. Never post it to support, chat, issue reports, logs, or public screenshots. Approval signatures are verified locally against the exact custody address and request before any Hypersnap message is submitted.

### WalletConnect deployment and license

Set `VITE_WALLETCONNECT_PROJECT_ID` at build time, using the public ID from your own [Reown Dashboard project](https://dashboard.reown.com). The value is intentionally visible in the built website. Set exact domain allowlists for production and any preview origin you deploy; no Dashboard API secret belongs in frontend configuration. Leave social/email login, Reown-hosted authentication, payments, swaps, and event tracking disabled for this signing-only integration. See [project settings](https://docs.reown.com/cloud/dashboard-configuration-settings).

The pinned `@walletconnect/sign-client` 2.26.0 is distributed under the [WalletConnect Community License](licenses/walletconnect-2.26.0-LICENSE.md). The project owner approved using it and the encrypted external relay. This is a separately licensed bundled component, and the fork's own app code remains AGPL. The license includes redistribution/attribution obligations, required Reown network connectivity, and commercial thresholds of 500 monthly active users or 2,500,000 monthly RPCs, subject to its terms and current service conditions. It must not be described as Apache-licensed or wholly open-source software. Operators of forks should review the included license before distributing or operating their build.

For this pinned SDK, the connection allowlist covers:

| Endpoint | Purpose |
| --- | --- |
| `wss://relay.walletconnect.org` | Default encrypted WalletConnect messaging relay. |
| `https://verify.walletconnect.org` | Verify domain-attestation iframe and attestation/public-key requests. |
| `https://verify.walletconnect.com` | SDK-trusted alternate Verify host. |

SDK telemetry is disabled; `https://pulse.walletconnect.org/batch` is the SDK's telemetry destination and is not needed for this integration. Website scripts, styles, fonts, wallet links and QR generation remain locally bundled. The Verify iframe is external content in its own origin. This list describes the browser-side integration, not every endpoint contacted independently by a user's wallet app.

These endpoints and defaults are documented in the [pinned relay constants](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/constants/relayer.ts), [Verify implementation](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/controllers/verify.ts), and [telemetry implementation](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/controllers/events.ts). Re-test network traffic and CSP after SDK upgrades; the much broader AppKit CSP is not the specification for this integration.

MetaMask is one compatible example, not a requirement. Its [official import guide](https://support.metamask.io/start/use-an-existing-wallet/) supports 12- and 24-word English wallets on extension and mobile; its [mobile browser guide](https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser/) explains opening dapps inside the app. Instances linked to Google, Apple, or Telegram may link/sync newly imported wallets, so review those settings if you want local-only custody. MetaMask's current mobile license is source-available, not an open-source license. Our adapter is open-source and allows other compatible wallets.

Brave Wallet offers an open-source alternative: Brave documents [wallet discovery on desktop, iOS and Android](https://brave.com/blog/eip-6963/), [typed-data signing](https://wallet-docs.brave.com/ethereum/use-cases/signing-data/), and [12–24-word wallet import](https://support.brave.com/hc/en-us/articles/12759132380173-Import-an-existing-wallet-into-Brave-Wallet). Its core is [MPL-2.0 licensed](https://github.com/brave/brave-core/blob/master/LICENSE). Check its current import guidance before using an existing populated wallet; use a separate browser profile or fresh wallet instance if necessary. Do not reset another wallet to connect here. Brave's provider is unavailable until its wallet is configured, and is unavailable in private/Tor windows.

These requests authorize a Hypersnap posting key and involve no app-requested transaction or gas payment. The protocol's required domain is `Farcaster KeyAdd`, version `1`, chain ID `1`; the historical name does not route through Farcaster's servers. A wallet must support `eth_signTypedData_v4` for the matching Ethereum account. Smart-contract custody wallets, hardware wallets with incompatible typed-data support, alternate derivation paths, and every wallet/browser combination are not guaranteed to work. Rejected or mismatched signatures fail closed.

Select **Ethereum Mainnet** in the wallet before approving: some wallets require their selected network to match the signed domain. No ETH balance or on-chain transaction is required by this flow. The app does not switch networks automatically.

## Optional offline desktop approval

1. Open [Quorum for Hypersnap](https://quorum.arca.computer). Look up your public username, FID, or custody address.
2. Download the public authorization request. Keep that browser tab open: its random posting key stays there.
3. Download [Arca Signer v0.2.0](https://github.com/arcabotai/hypersnap-web/releases/tag/arca-signer-v0.2.0). The supplied binary is for Apple Silicon Macs. Other platforms can build the source.
4. Check the release's SHA-256 checksum and Developer ID signature. You may disconnect your computer from the network before opening the signer.
5. Import the request into Arca Signer. Compare the FID, custody address, complete posting key, request checksum, and permissions with the browser. Requests expire after 15 minutes. The displayed website name is self-asserted, not proof of who created the request.
6. Enter the matching 24-word English phrase only in the native app. Export the public approval, clear the app, and quit.
7. Reconnect if needed. Import the approval into the same browser tab and approve registration. No phrase or custody private key is in either transfer file.

The posting key can create casts and add/remove reactions. Its seven-day inactivity window is refreshed when it is used; it does not expire seven days after sign-in. It cannot transfer funds or change custody through these permitted Hypersnap message types. Hypersnap protocol rules and node software enforce those limits.

## Saved devices and revocation

Saving a device is optional and off by default. A password of at least 12 characters encrypts only the random posting key in this browser's IndexedDB. The password is not stored or recoverable. Use a strong, unique password. An unlocked browser or malicious code served by the website can still misuse the active posting key.

**Lock** clears the active key. **Forget** deletes the encrypted local copy but leaves network authorization intact. **Revoke** removes that specific device key from Hypersnap and waits for the node to report its absence before deleting the saved copy. Approve removal with the matching wallet app, or use the optional offline request/approval flow. If submission times out, use the status check; the app does not automatically resubmit uncertain writes. Keep a copy of the public key if you may need to identify it later.

Keys approved by older beta versions and other devices remain separate. This release does not silently remove them. Losing a browser key or deleting its vault does not itself revoke it; another compatible custody-authorized tool is needed to remove a lost key.

## Verify the macOS beta

This beta is **Developer ID–signed with hardened runtime**, but **Apple notarization is pending**. A valid signature identifies the publisher and detects changes; it is not an audit. macOS may block a downloaded unnotarized app. Follow your organization's policy and wait for a notarized release if required. The project does not ask you to disable Gatekeeper or remove quarantine.

```sh
shasum -a 256 -c SHA256SUMS.txt
ditto -x -k Arca-Signer-mac-arm64.zip ./arca-signer
codesign --verify --deep --strict --verbose=2 './arca-signer/Arca Signer.app'
codesign -dv --verbose=4 './arca-signer/Arca Signer.app'
```

Expected publisher: `Developer ID Application: LUIS FELIPE ABARCA RAMIREZ (48H3WZWYU3)`. Expected TeamIdentifier: `48H3WZWYU3`; bundle identifier: `computer.arca.hypersnap.signer`. Download the checksum, `BUILD-MANIFEST.json`, and `RELEASE-STATUS.json` from the same release. A checksum obtained from the same compromised download source is not independent proof of authenticity.

## Review and build

Check out the release tag, enter `hypersnap/`, and use Node 22 with Yarn 1.22:

```sh
yarn install --frozen-lockfile
yarn verify
yarn signer:dev
```

`yarn signer:build` produces readable bundled JavaScript and a manifest recording the source commit, source input hash, runtime version, and payload file hashes. Repeating the build from the same sources and lockfile should reproduce those payloads. The signed ZIP contains timestamps and signatures and is not claimed to be bit-for-bit reproducible. Dependencies and build tooling remain part of the trust boundary.

On a Mac with your own Developer ID certificate:

```sh
yarn signer:package --sign-identity 'Developer ID Application: YOUR NAME (TEAMID)'
```

Release packaging requires a clean, committed tree. An optional `--notary-profile PROFILE_NAME` uses an existing `notarytool` Keychain profile; no Apple credentials belong in source. See [native implementation](signer/README.md), [verification record](VERIFICATION.md), and [source](https://github.com/arcabotai/hypersnap-web).

## Boundaries

The companion uses a sandboxed renderer, context isolation, narrow validated IPC, a nonpersistent session, an allowlisted local protocol, and denied network/navigation/permissions. Electron's run-as-Node, inspector, and Node-options fuses are disabled. ASAR integrity validation is enabled. Only explicit user-selected public request/approval files are read or exported; the app has no automatic updates.

The browser and Worker use no Farcaster-operated sign-in service. Public reads and signed messages go through Arca's Cloudflare Worker to the Quilibrium-operated Hypersnap node. That node remains an availability and correctness dependency; confirmations are node observations, not independently verified consensus proofs. Optional WalletConnect signing adds Reown's relay and Verify services, plus the user's selected wallet software, to the connection's trust and availability boundaries. Cloudflare and GitHub distribute code, and compromised releases can compromise future imports. An infected operating system, clipboard monitor, or malicious signer build can steal a phrase despite this design. Never send a real recovery phrase to support, chat, issue reports, or screenshots.
