#!/usr/bin/env node
/** Read-only operator report. Credentials are used only in the API request header. */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ACCOUNT_ID = 'e320a5a80611f9a30148d452929b1fb1';
export const DATASET = 'opencaster_activity';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function parseArguments(args, now = new Date()) {
  const result = { days: 7, out: path.join(tmpdir(), `opencaster-analytics-${now.toISOString().replace(/[:.]/g, '-')}.html`), help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (!['--days', '--out'].includes(option) || seen.has(option)) throw new Error('Use --days 1..90 and --out /path/report.html.');
    seen.add(option);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (option === '--days') {
      if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(value)) throw new Error('--days must be an integer from 1 to 90.');
      result.days = Number(value);
    } else {
      if (value.includes('\0') || !/\.html?$/i.test(value)) throw new Error('--out must name an HTML file.');
      result.out = path.resolve(value);
    }
  }
  return result;
}

export async function readCredential({ env = process.env, home = homedir(), read = readFile } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (token) {
    if (/[\r\n]/.test(token)) throw new Error('The Cloudflare credential is invalid.');
    return token;
  }
  const locations = [path.join(home, 'Library/Preferences/.wrangler/config/default.toml'), path.join(home, '.config/.wrangler/config/default.toml')];
  for (const location of locations) {
    let source;
    try { source = await read(location, 'utf8'); } catch { continue; }
    const match = source.match(/^\s*oauth_token\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/m);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  throw new Error('No Cloudflare credential is available. Sign in with Wrangler or set CLOUDFLARE_API_TOKEN.');
}

export function buildQueries(days) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Invalid analytics date range.');
  const window = `timestamp >= NOW() - INTERVAL '${days}' DAY`;
  const count = 'SUM(_sample_interval) AS events';
  const value = 'SUM(_sample_interval * double2) / SUM(_sample_interval) AS mean';
  const query = (select, where, group, limit = 200) => `SELECT ${select}, ${count}, ${value} FROM ${DATASET} WHERE ${window}${where ? ` AND ${where}` : ''} GROUP BY ${group} ORDER BY events DESC LIMIT ${limit} FORMAT JSON`;
  return {
    totals: query('blob1 AS kind', '', 'kind', 20),
    trend: query('intDiv(toUInt32(timestamp), 86400) * 86400 AS day, blob1 AS kind', '', 'day, kind', 900),
    pages: query('blob2 AS page', "blob1 = 'pageview'", 'page'),
    clicks: query('blob2 AS page, blob3 AS name', "blob1 = 'click'", 'page, name'),
    countries: query('blob4 AS country', "blob1 = 'visit'", 'country', 300),
    sources: query('blob3 AS name', "blob1 = 'visit'", 'name', 20),
    devices: query('blob5 AS device, blob6 AS browser', "blob1 = 'visit'", 'device, browser'),
    vitals: query('blob2 AS page, blob3 AS name', "blob1 = 'vital'", 'page, name'),
    requests: query('blob2 AS page, blob3 AS name', "blob1 = 'request'", 'page, name'),
    errors: query('blob2 AS page, blob3 AS name', "blob1 = 'error'", 'page, name'),
  };
}

export async function queryAnalytics(sql, token, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
      body: sql, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Unable to reach Cloudflare analytics. Check your connection and credential.'); }
  if (!response.ok) throw new Error(`Cloudflare analytics query failed (HTTP ${response.status}). Check analytics permission and whether data has arrived.`);
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Cloudflare analytics response exceeded the report limit.');
  let text;
  try {
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder().decode(bytes);
  } catch { throw new Error('Cloudflare analytics response could not be read within the report limit.'); }
  try {
    const result = JSON.parse(text);
    if (!Array.isArray(result.data) || result.data.length > 1_000 || result.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error();
    return result.data;
  } catch { throw new Error('Cloudflare analytics returned an unexpected response.'); }
}

export async function collectReport(days, token, query = queryAnalytics) {
  const pending = Object.entries(buildQueries(days));
  const result = {};
  // Bound API concurrency even when additional charts are introduced.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const [name, sql] = pending.shift();
      result[name] = await query(sql, token);
    }
  }));
  return result;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const numeric = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(numeric(value));
const measurement = row => new Intl.NumberFormat('en', { maximumFractionDigits: String(row.name).toLowerCase() === 'cls' ? 3 : 1 }).format(numeric(row.mean));
const sum = rows => rows.reduce((total, row) => total + numeric(row.events), 0);

function table(headers, rows, empty = 'No measurements received in this period.') {
  if (!rows.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function breakdown(rows, label, unit = 'visits') {
  const maximum = Math.max(1, ...rows.map(row => numeric(row.events)));
  return rows.length ? `<div class="breakdown">${rows.map(row => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label(row))}</span><strong>${number(row.events)} <small>${escapeHtml(unit)}</small></strong></div><div class="bar-track"><div style="width:${(numeric(row.events) / maximum * 100).toFixed(2)}%"></div></div></div>`).join('')}</div>` : '<p class="empty">No measurements received in this period.</p>';
}

function trendChart(rows) {
  const days = new Map();
  for (const row of rows) {
    const timestamp = numeric(row.day) * 1000;
    if (timestamp < Date.UTC(2020, 0, 1) || timestamp > Date.UTC(2100, 0, 1)) continue;
    const key = new Date(timestamp).toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { visit: 0, pageview: 0, click: 0, error: 0 });
    if (Object.hasOwn(days.get(key), row.kind)) days.get(key)[row.kind] += numeric(row.events);
  }
  const values = [...days].sort(([left], [right]) => left.localeCompare(right));
  if (!values.length) return '<p class="empty">No daily activity received in this period.</p>';
  const maximum = Math.max(1, ...values.map(([, day]) => Math.max(day.visit, day.pageview)));
  return `<div class="daily" role="img" aria-label="Daily document visits and page views, UTC">${values.map(([day, value]) => `<div class="daily-column" title="${escapeHtml(`${day}: ${number(value.visit)} visits, ${number(value.pageview)} page views`)}"><div class="daily-bars"><span style="height:${Math.max(1, value.visit / maximum * 100).toFixed(2)}%"></span><span style="height:${Math.max(1, value.pageview / maximum * 100).toFixed(2)}%"></span></div><small>${escapeHtml(day.slice(5))}</small></div>`).join('')}</div><p class="legend"><span>● Visits</span><span>● Page views</span></p>${table(['Day (UTC)', 'Visits', 'Page views', 'Clicks', 'Errors'], values.map(([day, value]) => [day, number(value.visit), number(value.pageview), number(value.click), number(value.error)]))}`;
}

export function renderReport(report, { days = 7, generatedAt = new Date() } = {}) {
  const rows = key => Array.isArray(report[key]) ? report[key] : [];
  const total = kind => sum(rows('totals').filter(row => row.kind === kind));
  const requestRows = rows('requests');
  const requestCount = sum(requestRows);
  const requestMean = requestCount ? requestRows.reduce((value, row) => value + numeric(row.mean) * numeric(row.events), 0) / requestCount : 0;
  const serverErrors = sum(requestRows.filter(row => row.name === '5xx'));
  const cards = [['Document visits', total('visit'), 'Page loads, including reloads'], ['Page views', total('pageview'), 'Initial loads and SPA navigation'], ['Tracked clicks', total('click'), 'Named interface actions'], ['Browser errors', total('error'), 'Fixed categories; no error text']];
  const section = (title, description, contents, wide = false) => `<section class="panel${wide ? ' wide' : ''}"><h2>${escapeHtml(title)}</h2><p class="description">${escapeHtml(description)}</p>${contents}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>Opencaster · Analytics report</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f1;color:#162b27;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1280px;margin:auto;padding:46px 30px 60px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.17em;color:#54736c;text-transform:uppercase}header{display:flex;justify-content:space-between;gap:28px;align-items:flex-start;margin-bottom:30px}h1{font-size:clamp(30px,4vw,44px);letter-spacing:-.05em;line-height:1.1;margin:9px 0 12px}header p{margin:0;color:#60746e}.period{padding:10px 15px;border:1px solid #cedbd4;border-radius:99px;white-space:nowrap;font-weight:700;font-size:13px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}.card{background:#183e34;color:#fff;border-radius:15px;padding:22px}.card span{font-size:12px;color:#b6d7c8}.card strong{display:block;font-size:38px;letter-spacing:-.05em;margin:5px 0}.card p{margin:0;font-size:11px;color:#b6d7c8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{border:1px solid #e0e6de;border-radius:16px;background:#fff;padding:25px;min-width:0}.wide{grid-column:1/-1}h2{font-size:19px;letter-spacing:-.025em;margin:0 0 4px}.description,.empty{font-size:12px;color:#708079;margin:0 0 20px}.empty{padding:25px 0}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}th{color:#6e8077;font-weight:600;font-size:11px}th,td{border-bottom:1px solid #edf0e9;padding:11px 10px;overflow-wrap:anywhere}th:first-child,td:first-child{padding-left:0}td{font-variant-numeric:tabular-nums}tbody tr:last-child td{border-bottom:0}.bar-row{margin-top:16px}.bar-label{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:7px}.bar-label span{overflow-wrap:anywhere}.bar-label strong{white-space:nowrap;font-variant-numeric:tabular-nums}.bar-label small{font-size:10px;font-weight:400;color:#718278}.bar-track{height:7px;border-radius:8px;background:#edf3ed;overflow:hidden}.bar-track div{height:100%;background:#48a17a;border-radius:8px}.daily{height:145px;display:flex;gap:8px;align-items:flex-end;overflow-x:auto;margin-top:26px}.daily-column{height:100%;flex:1;min-width:16px;text-align:center}.daily-bars{height:120px;display:flex;gap:3px;justify-content:center;align-items:flex-end}.daily-bars span{background:#235c49;min-height:1px;width:38%;max-width:35px;border-radius:3px 3px 0 0}.daily-bars span+span{background:#9ad2b3}.daily-column small{font-size:9px;color:#6f7c73;white-space:nowrap}.legend{display:flex;justify-content:flex-end;gap:17px;font-size:11px;color:#235c49}.legend span+span{color:#6d9b7f}.stats{display:flex;gap:25px;flex-wrap:wrap;margin:17px 0 22px}.stats strong{display:block;font-size:25px;letter-spacing:-.04em}.stats span{font-size:11px;color:#708079}.note{margin:24px 0 0;padding:24px;border-radius:15px;background:#e9eee4;color:#536650;font-size:12px}.note h2{font-size:14px;color:#2b462e;margin-bottom:8px}.note p{margin:7px 0}footer{font-size:11px;color:#7d887e;margin-top:22px} @media(max-width:760px){main{padding:28px 18px}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.wide{grid-column:auto}header{display:block}.period{display:inline-block;margin-top:18px}.card{padding:17px}.card strong{font-size:31px}.panel{padding:20px}}@media print{body{background:white}main{padding:15px}.panel,.card{break-inside:avoid}.card{border:1px solid #cbd7ce;color:#183e34;background:#f5faf5}.card span,.card p{color:#506c5b}.daily{height:110px}.daily-bars{height:85px}}
</style></head><body><main><header><div><div class="eyebrow">OPENCASTER / OPERATOR ANALYTICS</div><h1>A clearer view of activity.</h1><p>opencaster.org · Aggregate usage and service performance</p></div><span class="period">Last ${number(days)} days</span></header><div class="cards">${cards.map(([label, value, caption]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong><p>${escapeHtml(caption)}</p></div>`).join('')}</div><div class="grid">
${section('Activity over time', 'UTC calendar days. The current day and first day can be partial.', trendChart(rows('trend')), true)}
${section('Pages people open', 'Page categories contain no profile, cast or channel identifiers.', breakdown(rows('pages'), row => row.page, 'views'))}
${section('What people click', 'Only explicitly named interface actions are counted.', table(['Page', 'Action', 'Clicks'], rows('clicks').map(row => [row.page, row.name, number(row.events)])))}
${section('Countries', 'Country-level location from Cloudflare; no IP addresses are stored by this instrumentation.', breakdown(rows('countries'), row => row.country || 'Unknown'))}
${section('Devices & browsers', 'Broad categories observed on document visits.', table(['Device', 'Browser', 'Visits'], rows('devices').map(row => [row.device || 'Unknown', row.browser || 'Unknown', number(row.events)])))}
${section('How visits arrive', 'Only broad source categories are retained. Referrer URLs, paths and search terms are excluded.', breakdown(rows('sources'), row => row.name || 'Unknown'))}
${section('Browser performance', 'Weighted arithmetic means of numeric measurements; timing values are milliseconds, CLS is unitless. These are diagnostic averages, not Core Web Vitals pass/fail scores.', table(['Page', 'Measurement', 'Samples', 'Mean'], rows('vitals').map(row => [row.page, row.name, number(row.events), measurement(row)])))}
${section('Browser errors', 'Fixed error categories only. Error messages, stacks and page contents are excluded.', table(['Page', 'Category', 'Events'], rows('errors').map(row => [row.page, row.name, number(row.events)])))}
${section('Service health', 'Worker request volume and response latency grouped by route category and status class. Latency measures response creation, excluding response-body streaming.', `<div class="stats"><div><strong>${number(requestCount)}</strong><span>requests</span></div><div><strong>${number(requestMean)} ms</strong><span>mean response latency</span></div><div><strong>${number(serverErrors)}</strong><span>5xx responses</span></div></div>${table(['Route category', 'Status', 'Requests', 'Mean latency (ms)'], requestRows.map(row => [row.page, row.name, number(row.events), number(row.mean)]))}<p class="description"><a href="https://dash.cloudflare.com/${ACCOUNT_ID}/workers/services/view/hypersnap-quorum/production/metrics" target="_blank" rel="noopener noreferrer">Open Cloudflare Worker metrics</a> for request outcomes, CPU time and platform limits. Cloudflare account sign-in is required.</p>`, true)}
</div><aside class="note"><h2>How to read these numbers</h2><p>Visits count document loads, including reloads. They do not identify unique people, returning visitors or individual sessions. Page views also include navigation within the app.</p><p>Counts are approximate: Analytics Engine can sample data, and this report applies Cloudflare’s sample weights. Browser submissions are untrusted, so bots or fabricated requests may affect the numbers. Missing measurements are not proof of zero activity.</p><p>Browser activity is absent when Do Not Track, Global Privacy Control or the site’s analytics opt-out is enabled, when scripts or reporting requests are blocked, or when a browser does not support a measurement. Service request metrics can include these requests.</p><p>Analytics Engine retains data for about 90 days. This local snapshot contains aggregate statistics only; it has no credential, script, external asset or live data connection.</p></aside><footer>Generated ${escapeHtml(generatedAt.toISOString())} · Dataset ${escapeHtml(DATASET)} · Read-only Cloudflare Analytics Engine report</footer></main></body></html>`;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(args);
  if (options.help) {
    (dependencies.print ?? console.log)('Usage: node scripts/analytics-report.mjs [--days 1..90] [--out /path/report.html]\nReads Cloudflare Analytics Engine using CLOUDFLARE_API_TOKEN or an existing Wrangler login. Writes a private local HTML snapshot; no server is started.');
    return;
  }
  const token = await (dependencies.credential ?? readCredential)();
  const report = await (dependencies.collect ?? collectReport)(options.days, token);
  const html = renderReport(report, { days: options.days });
  try {
    // The parent directory must already exist. Refuse to replace a prior report.
    await (dependencies.write ?? writeFile)(options.out, html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch { throw new Error('Unable to write the report. Choose a new HTML filename in an existing writable directory.'); }
  const count = kind => sum((report.totals ?? []).filter(row => row.kind === kind));
  (dependencies.print ?? console.log)(`${options.out}\n${number(count('visit'))} document visits · ${number(count('pageview'))} page views · ${number(count('click'))} clicks`);
  return options.out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Unable to create the analytics report.'); process.exitCode = 1; });
}
