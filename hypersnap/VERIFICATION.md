# Verification record · 2026-10-19

The standalone Hypersnap entry passes `cd hypersnap && yarn verify`: **46 tests** (26 Worker, 8 API, 11 auth, 1 independent protocol golden vector), TypeScript including the Worker, and a production build. Browser checks covered live feed rendering, profile lookup, bookmarks, and rejecting/clearing an invalid recovery phrase. Public live checks read data only. No real wallet authorization, signer registration, reaction, or cast was submitted.

Cloudflare deployment initially exposed a runtime difference: Workers rejects Fetch's `redirect: 'error'` mode. The Worker now uses `manual`, rejects all upstream redirects, and has a regression test for this behavior. See [Cloudflare's Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/).

The original Quorum messenger build is retained unchanged. Its separate root verification command was attempted, but its dependencies and linked sibling repositories are not installed in this checkout. The exact verdict block from that attempt follows; this is not a passing messenger regression run. Its permanent-account mint guard was respected.

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   db04b99  ⚠ working tree dirty (2 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/<no base branch — cannot tell what this branch changed>)
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
