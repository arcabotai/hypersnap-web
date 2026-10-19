# Verification record · 2026-10-19

The standalone Hypersnap entry passes `cd hypersnap && yarn verify`: **91 tests** (26 Worker, 8 API, 9 public transfer boundary, 8 native signer, 18 auth, 7 encrypted vault/storage, 14 wallet provider, and 1 independent Rust protocol golden vector), TypeScript for browser/Worker/native code, and browser plus native payload builds.

Wallet tests use independent viem EIP-712 hashing and synthetic keys to verify exact KeyAdd, SignedKeyRequest, and KeyRemove compatibility. They cover custody mismatch, account/network changes, rejected or malformed signatures, bounded timeouts, cancellation between prompts, provider discovery and untrusted metadata. Vault tests include actual IndexedDB transactions across two connections, preventing another tab’s replacement vault from being erased. Unknown network writes are never automatically resubmitted.

Native UI smoke verified importing a public synthetic request, reviewing public account/key/permissions, signing with a public test-only 24-word phrase, clearing its input, and exporting an approval whose signatures then verified cryptographically. Browser smoke covered public account lookup, phrase-free sign-in, mobile wallet guidance, and rejecting an approval for another request. Native payload builds were repeated and their manifests matched.

Live integration checks perform public reads only. No real wallet approval, signer registration/removal, cast, or reaction was submitted. Physical iOS/Android wallet approval remains untested. Cross-platform support uses documented EIP-1193/EIP-6963 and typed-data-v4 interfaces; it is not a claim that every wallet/browser combination works. No independent security audit is claimed. The optional macOS beta is Developer ID signed; notarization is deferred.

The live node’s HTTP `requesterFids` sequence query fails to decode; bracket queries are ignored. The UI therefore supports custody-approved removal through wallet or offline signatures using the current user nonce, rather than guessing an app nonce. No upstream node mutation was performed.

The Worker uses manual redirects and rejects all upstream redirects, with regression coverage for Cloudflare runtime compatibility.

The retained Quorum messenger is separate. Its root verification was attempted but cannot run its tools without the original dependencies and sibling shared/SDK repositories. Its permanent-account mint guard was respected. This is the complete recorded verdict from that attempt (line-end padding omitted) (before the final wallet UI edits), not a passing messenger regression run:

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   52af2a5  ⚠ working tree dirty (17 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/.gitignore, desktop/hypersnap/package.json, desktop/hypersnap/src/App.tsx)
            (… and 20 more)
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
