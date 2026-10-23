# Opencaster statistics

Opencaster records first-party aggregate usage and health measurements in the
Cloudflare Analytics Engine dataset `opencaster_activity`. The existing
[Worker metrics dashboard](https://dash.cloudflare.com/e320a5a80611f9a30148d452929b1fb1/workers/services/view/hypersnap-quorum/production/metrics)
also provides infrastructure request counts, errors and CPU measurements.

## View the usage dashboard

From `hypersnap/`, with the existing Wrangler Cloudflare connection:

```sh
yarn analytics:report --days 7 --out /tmp/opencaster-analytics.html
```

Open the resulting HTML file to see document visits, page views, clicks,
traffic-source categories, country/device/browser breakdowns, browser error
counts, available page-performance samples and gateway request health. This is
a private local snapshot; rerun the command for current data. The report uses
Cloudflare's authenticated SQL API and contains aggregates, never credentials.
It is not served by the public website. A separately supplied
`CLOUDFLARE_API_TOKEN` needs Account Analytics Read permission; never put it in
a `VITE_` variable or the website bundle.

Collection begins with this release. A **visit is a document load**, including
reloads, rather than a unique person or an identified session. Page views also
count client navigation, including Back/Forward. Clicks measure explicitly
marked UI actions, not successful social writes. Browser errors are counts of
uncaught errors or unhandled rejections, without messages or stack traces.
Numeric LCP, CLS and TTFB samples depend on browser support and are reported
when the document first becomes hidden; INP is not currently collected.

Counts can be affected by bots, blockers, privacy choices, interrupted delivery
and Cloudflare sampling. Events are not proof of a human action. Browser
submissions are untrusted, and rate limits are approximate per Cloudflare
location. Cloudflare currently retains Analytics Engine data for three months.
The report weights aggregates by `_sample_interval`, including numeric means.
It does not reconstruct individual browsing sessions or backfill old clicks.

## What is collected

The browser sends bounded batches of fixed labels to `/_analytics/events` on
`opencaster.org`. Allowed events and labels live in
[`src/lib/analyticsEvents.ts`](src/lib/analyticsEvents.ts), shared with the Worker.
Page labels are categories such as `profile`, `cast`, `search` and `connect`.
Traffic sources are reduced in the browser to `direct`, `search`, `social`,
`github`, `internal` or `other`. The Worker adds a two-letter country and coarse
browser/device categories; the original user agent is not stored.

The Worker also records request-family (`page`, `asset`, `api`, `media`, `other`),
status-class and elapsed-time measurements for the canonical production origin.
These operational aggregates include automated requests and are separate from
browser visits. The ingestion route itself is excluded from request metrics.

No analytics cookies or persistent visitor IDs are created. Analytics never
stores raw page paths, search queries, referrer URLs, profile identifiers, cast
hashes, channel names, DOM text, form values, wallet identifiers, pairing links,
signing payloads, keys, request/response bodies, error messages or stacks.
Cloudflare already processes incoming requests as the site's hosting provider;
an IP address is used only for its short-lived ingestion rate-limit counter,
not written into the analytics dataset. The browser sends events without cookies
or authorization and makes no analytics request to an external origin.

Do Not Track and Global Privacy Control disable the site's browser analytics;
the Worker also honors their request headers. **Settings → Privacy & analytics**
lets a visitor turn off browser usage collection on this device. This preference
does not disable the hosting provider's ordinary processing or aggregate
operational request metrics. Local development, previews, the legacy domain and
the offline signer do not send browser usage events to the production dataset.

## Storage schema and operations

| Field | Meaning |
| --- | --- |
| `blob1` | `visit`, `pageview`, `click`, `vital`, `error` or `request` |
| `blob2` | Fixed page category, or fixed request family |
| `blob3` | Fixed action/source/vital/error name, `view`, or HTTP status class |
| `blob4` | Two-letter country, `XX` if unavailable |
| `blob5` | `desktop`, `mobile`, `tablet` or `other` |
| `blob6` | `chrome`, `safari`, `firefox`, `edge` or `other` |
| `double1` | Count, always `1` |
| `double2` | Numeric vital value or elapsed milliseconds; otherwise `0` |
| `index1` | Constant `opencaster` |

The binding in `wrangler.jsonc` creates the dataset after its first write. The
ingestion route accepts up to 20 events and 8 KiB per request, checks the exact
origin and finite schema, and has a dedicated rate limit. Analytics failures
do not change application operations; the client drops failed batches without
retrying. The client also bounds its queue and per-document event volume.

Persisted invocation logs, automatic traces and the third-party Web Analytics
beacon remain disabled. Raw platform traces can include request URLs and storage
metadata, while a general-purpose browser beacon would run in the wallet page's
context. Explicit Analytics Engine points preserve the existing self-only
script policy and provide the custom clicks that Web Analytics does not support.

Cloudflare references: [Analytics Engine setup](https://developers.cloudflare.com/analytics/analytics-engine/get-started/),
[SQL and sampling](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
[retention and limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/),
[rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/),
[trace attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).
