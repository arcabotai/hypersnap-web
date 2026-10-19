# Image uploads

The browser uploads public JPEG, PNG, WebP and GIF images to our Cloudflare
Worker. The original file is retained, including any photo metadata such as EXIF.
Upload controls must disclose this before the user chooses a file. Removing an
attachment from a draft does not remove an already uploaded image. Images have
stable public links and may be cached by recipients. There is no end-user media
deletion flow in this release.

## Authorization and storage

The existing device Ed25519 key signs one constrained upload grant inside the
session closure. It does not expose a generic signing API or the private key.
The grant binds `arca.hypersnap.media.upload.v1`, schema version, exact website
origin, FID, posting public key, random nonce, issue/expiry times, image SHA-256,
byte size and content type. Its lifetime is at most 120 seconds. The proof and
public fields travel in the request header; account recovery phrases and wallet
private keys are never involved.

Before accepting an image, the Worker checks the exact grant schema, canonical
signature, same origin and current Hypersnap offchain signer registration. The
signer must belong to that FID, permit `MESSAGE_TYPE_CAST_ADD` and remain valid
for at least 30 seconds. A failed, unavailable or truncated registry response
denies the upload. The Worker checks the registry again after receiving the
image, so a signer revoked or expired during a slow transfer is denied before
storage reservation. The registry destination stays fixed at
`https://haatz.quilibrium.com`; no Farcaster/Snapchain service is introduced.

Uploads are bounded to 5 MiB. Server checks require the claimed image format's
magic/header, dimensions no greater than 8192 on either side, and no more than
25 million canvas pixels. SVG, HTML, video and other formats are rejected. These
checks establish the allowed image container and dimensions; they are not a
complete image decoder or metadata scrubber.

After validating the complete image and its SHA-256, the Worker atomically
reserves the nonce and quotas in a SQLite-backed Durable Object. A reservation
is never rolled back after an ambiguous storage failure, so the same grant
cannot be replayed. Failed attempts are not automatically retried by the client.
Choosing a file again creates a fresh grant.

The dedicated `hypersnap-quorum-media` R2 bucket has direct `r2.dev` access
disabled. Only the Worker binding can write it. `PUT` is conditional on the
content hash being absent, preserving immutable `/media/<sha256>` links. Reads
serve fixed image MIME types with `nosniff`, a sandboxed restrictive CSP and
immutable caching. There is no arbitrary upstream media-fetch endpoint or
public unsigned upload endpoint.

## Quotas and retained operational state

- Per FID per UTC issue day: 10 uploads and 50 MiB.
- Entire app per UTC issue day: 1000 uploads and 5 GiB.
- The Durable Object stores FID counters and used public nonces. Its alarm
  deletes all operational state five minutes after that issue day ends, after
  every grant from the day has expired. Midnight replays remain in the same
  object's nonce ledger because the object is selected by the signed issue day.
- Image storage persists independently of the daily quota state. There is no
  automatic media expiration policy in this release. Operators should monitor
  total R2 storage as adoption grows.

Quotas bound accepted storage writes; they do not eliminate Worker request,
registry-read or network traffic from abusive clients. The upload route is
designed to reject unauthenticated callers before any registry lookup or
durable-state write. Worker request logging remains disabled.

## Cloudflare deployment

`wrangler.jsonc` declares the R2 binding `MEDIA_BUCKET`, the Durable Object binding
`MEDIA_QUOTA`, and migration `media-quota-v1` with `new_sqlite_classes` containing
`MediaUploadQuota`. The class must be re-exported by the Worker entry point. The
R2 bucket was created using the existing account; no subscription was changed.

Cloudflare documents [R2 Worker bindings and conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[SQLite-backed Durable Object transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[SQLite Durable Objects on the Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/),
and [deleting all Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

## Validation

`worker/media.test.ts` and `src/lib/media.test.ts` contain 16 tests using synthetic,
unregistered Ed25519 identities and mocked
Hypersnap/R2/Durable Object services. It covers valid uploads, immutable reads,
origin/signature tampering, concurrent replay, active signer scope/ownership,
truncated registries, content/type/size mismatch, daily quota and ledger cleanup.
No test signs a real account action or writes a user image to production.

A separate isolated Miniflare smoke test exercised actual local SQLite Durable
Object transactions and R2 conditional writes with the production handler and a
mocked Hypersnap registry: signed upload `200`, replay `409`, exact immutable
image read `200`, duplicate-content upload `200`. The installed local runtime
supports compatibility dates through `2026-10-02`, so that smoke used that date;
the existing deployed Worker configuration remains `2026-10-19`. Wrangler's
deployment dry run also accepted the R2 and Durable Object bindings.
