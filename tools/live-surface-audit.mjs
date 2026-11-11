/**
 * tools/live-surface-audit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE GATE JUDGES THE BUNDLE; THIS READS THE BYTES THE HOST SERVES.
 *
 * `no-network.html` proves that no authored source carries a transport primitive, and the privacy
 * audits prove the same over `*.js` / `*.src.html`. Neither can see a script the EDGE inserts into the
 * served response, because that script never enters the repo. Residue row
 * `2026-11-08-the-live-site-carries-an-analytics-beacon-the-glossary-denies` arrived exactly there: a
 * live fetch found an analytics beacon on every page while a shipped FAQ answer denied analytics, and
 * the repo-side gates stayed green and correct.
 *
 * So this tool reads the live pages and decides over them. It never runs inside `npm run check`: a
 * gate step that reaches the network would make CI depend on a host nobody in CI controls. Without
 * `--fetch` it examines nothing and says so (`NOT_RUN`, `result: null`).
 *
 *   node tools/live-surface-audit.mjs --fetch                 # read the pinned paths, print the verdict
 *   node tools/live-surface-audit.mjs --fetch --json          # the object alone
 *   node tools/live-surface-audit.mjs --selftest              # the pure core over fixtures, no network
 *   node tools/live-surface-audit.mjs --verdict-sample        # one sample object, commit null
 *
 * ⚠ THE `Accept` HEADER DECIDES WHAT THE EDGE SENDS. Measured 2026-11-11 against the homepage: a
 * request whose Accept header was the bare wildcard returned 37537 bytes and NO beacon, and a request with
 * `Accept: text/html` returned 37904 bytes and the beacon. So an audit that does not ask for HTML
 * clears the site over a response no browser receives. This tool pins the header and prints it beside
 * the verdict, because the reader must know which response was judged.
 *
 * Two readings ride beside the decision and never change it:
 *   · a SAME-ORIGIN absolute reference is not a finding — the served page may name its own host;
 *   · a host REPORTING endpoint (`nel`, `report-to`) is the edge's own transport telemetry. The page
 *     requests nothing, so the criterion does not bind, and the annotation names the endpoint hosts.
 */
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

export const TOOL = 'tools/live-surface-audit.mjs';
export const GATE = 'live-surface-audit';

/* The paths an audit reads: the homepage, the FAQ that carries the claim, the largest app bundle, and
   the suite page. A path list is pinned, never globbed, so two runs compare. */
export const DEFAULT_ORIGIN = 'https://tepna.net';
export const DEFAULT_PATHS = ['/', '/Glossary.html', '/OxyDex.html', '/HRVDex.html'];
export const DEFAULT_TIMEOUT_MS = 30000;
export const UA = 'tepna-live-surface-audit (repo self-audit)';
/* Load-bearing: the edge injects its beacon into HTML-accepting responses only (see the header note). */
export const ACCEPT = 'text/html,application/xhtml+xml';

/* Tags whose `src`/`href` fetches or executes something. A `<a href>` navigates and never loads, so it
   stays out — an outbound citation link is not a transport finding. */
export const LOADING_TAGS = ['script', 'link', 'img', 'iframe', 'object', 'embed', 'source', 'video', 'audio', 'track'];

/* Named analytics rules. A host match is the rule; the generic class below carries everything else, so
   an unknown vendor still reports as a finding rather than waving through. */
export const ANALYTICS_RULES = [
  { name: 'cloudflare-insights', host: /(^|\.)cloudflareinsights\.com$/i },
  { name: 'cloudflare-beacon-path', path: /\/beacon(\.min)?\.js$/i },
  { name: 'google-analytics', host: /(^|\.)google-analytics\.com$/i },
  { name: 'google-tag-manager', host: /(^|\.)googletagmanager\.com$/i },
  { name: 'plausible', host: /(^|\.)plausible\.io$/i },
  { name: 'matomo', host: /(^|\.)matomo\.(cloud|org)$/i },
  { name: 'segment', host: /(^|\.)segment\.(com|io)$/i }
];
export const OFFSITE_CLASS = 'offsite-asset';

/* ── THE PURE CORE ────────────────────────────────────────────────────────────────────────────── */

/* An HTML comment can hold an EXAMPLE of a beacon — the audit docs do. A commented reference loads
   nothing, so the scan reads the markup with comments removed, and a selftest leg pins that. */
export function stripComments(html) {
  return String(html == null ? '' : html).replace(/<!--[\s\S]*?-->/g, ' ');
}

export function hostOf(url, originHost) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const abs = /^\/\//.test(raw) ? 'https:' + raw : raw;
  if (!/^https?:\/\//i.test(abs)) return null; /* relative, data:, blob:, mailto: — no remote host */
  try {
    return new URL(abs).host.toLowerCase();
  } catch {
    return null;
  }
}

export function pathOf(url) {
  const raw = String(url || '').trim();
  const abs = /^\/\//.test(raw) ? 'https:' + raw : raw;
  try {
    return new URL(abs).pathname;
  } catch {
    return '';
  }
}

export function ruleFor(host, path) {
  for (const r of ANALYTICS_RULES) {
    if (r.host && r.host.test(host)) return r.name;
    if (r.path && r.path.test(path)) return r.name;
  }
  return OFFSITE_CLASS;
}

/* Every loading reference whose host differs from the page's own host. The attribute scan runs over
   one tag at a time, so a `href` on a `<script>` and a `src` on a `<link>` both read. */
export function scanMarkup(html, { originHost } = {}) {
  const text = stripComments(html);
  const own = String(originHost || '').toLowerCase();
  const findings = [];
  let tags = 0;
  const tagRe = new RegExp('<(' + LOADING_TAGS.join('|') + ')\\b([^>]*)>', 'gi');
  for (const m of text.matchAll(tagRe)) {
    tags += 1;
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    for (const a of attrs.matchAll(/\b(src|href)\s*=\s*"([^"]*)"|\b(src|href)\s*=\s*'([^']*)'/gi)) {
      const attr = (a[1] || a[3]).toLowerCase();
      const url = a[2] === undefined ? a[4] : a[2];
      const host = hostOf(url, own);
      if (host === null) continue;
      if (own && host === own) continue;
      findings.push({ tag, attr, url, host, rule: ruleFor(host, pathOf(url)) });
    }
  }
  return { tags, findings };
}

/* The edge's own reporting headers. `report-to` carries JSON; a malformed value yields an entry with no
   endpoint host rather than a throw, because an unreadable header is not an absent one. */
export function classifyHeaders(headers = {}) {
  const get = (k) => {
    const hit = Object.keys(headers).find((n) => n.toLowerCase() === k);
    return hit === undefined ? null : String(headers[hit]);
  };
  const reporting = [];
  const nel = get('nel');
  if (nel !== null) reporting.push({ header: 'nel', endpointHosts: [], note: 'network error logging armed' });
  const rt = get('report-to') || get('reporting-endpoints');
  if (rt !== null) {
    const hosts = [];
    for (const m of rt.matchAll(/https?:\/\/[^"'\s,)}]+/g)) {
      const h = hostOf(m[0]);
      if (h && !hosts.includes(h)) hosts.push(h);
    }
    reporting.push({ header: 'report-to', endpointHosts: hosts, note: hosts.length ? null : 'no endpoint url read from the header' });
  }
  const server = (get('server') || '').toLowerCase();
  const cdn = get('cf-ray') !== null || server.includes('cloudflare') || reporting.some((r) => r.endpointHosts.some((h) => h.endsWith('cloudflare.com'))) ? 'cloudflare' : null;
  return { cdn, reporting };
}

/* A page the audit could not read is EXCLUDED with its own reason, never a clean page. */
export function judge({ pages = [] } = {}) {
  const byPage = [];
  const excludedReasons = [];
  let checked = 0;
  let offsite = 0;
  let beacons = 0;
  const reporting = [];
  for (const p of pages) {
    if (p.error) {
      excludedReasons.push({ url: p.url, reason: 'fetch failed: ' + p.error });
      continue;
    }
    if (p.status !== 200) {
      excludedReasons.push({ url: p.url, reason: 'http ' + p.status });
      continue;
    }
    const scan = p.scan || scanMarkup(p.body, { originHost: p.originHost });
    const named = scan.findings.filter((f) => f.rule !== OFFSITE_CLASS);
    checked += 1;
    offsite += scan.findings.length;
    beacons += named.length;
    const h = classifyHeaders(p.headers || {});
    for (const r of h.reporting) {
      if (!reporting.some((x) => x.header === r.header && String(x.endpointHosts) === String(r.endpointHosts))) reporting.push(r);
    }
    byPage.push({ url: p.url, bytes: p.bytes == null ? null : p.bytes, loadingTags: scan.tags, findings: scan.findings, cdn: h.cdn });
  }
  return {
    checked,
    eligible: pages.length,
    excluded: excludedReasons.length,
    excludedReasons,
    offsite,
    beacons,
    byPage,
    hostReporting: reporting,
    request: null
  };
}

export function verdictFields(j, { commit, commitReason } = {}) {
  const population = { checked: j.checked, eligible: j.eligible, excluded: j.excluded };
  const criterion = { name: 'offsite_page_assets', threshold: 0, unit: 'references', direction: 'lte' };
  const base = { gate: GATE, tool: TOOL, population, criterion, evidence: [TOOL], commit, commitReason };
  if (j.checked === 0) {
    return {
      ...base,
      status: 'NOT_RUN',
      result: null,
      reason: j.eligible === 0 ? 'no page was fetched, so nothing was examined' : 'every eligible page was excluded: ' + j.excludedReasons.map((e) => e.url + ' (' + e.reason + ')').join(', ')
    };
  }
  const result = {
    offsite: j.offsite,
    beacons: j.beacons,
    pages: j.byPage.map((p) => ({ url: p.url, bytes: p.bytes, loadingTags: p.loadingTags, offsite: p.findings.length, rules: p.findings.map((f) => f.rule) })),
    hostReporting: j.hostReporting,
    request: j.request
  };
  if (j.offsite > 0) {
    const rules = [...new Set(j.byPage.flatMap((p) => p.findings.map((f) => f.rule + ' @ ' + f.host)))];
    return { ...base, status: 'FAIL', result, reason: j.offsite + ' offsite reference(s) on ' + j.byPage.filter((p) => p.findings.length).length + ' page(s): ' + rules.join(', ') };
  }
  return { ...base, status: 'PASS', result, reason: null };
}

/* ── THE LIVE READ ────────────────────────────────────────────────────────────────────────────── */

export async function fetchPage(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const originHost = hostOf(url);
  try {
    const res = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: ACCEPT }, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { url, status: res.status, body, bytes: Buffer.byteLength(body), headers, originHost: hostOf(res.url || url) || originHost };
  } catch (e) {
    return { url, status: 0, error: e && e.message ? e.message : String(e), originHost };
  }
}

export async function run({ origin = DEFAULT_ORIGIN, paths = DEFAULT_PATHS, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const pages = [];
  for (const p of paths) {
    /* one page at a time: the suite page alone is over a megabyte, and the fleet's memory rule caps a
       tool at what one unit needs */
    pages.push(await fetchPage(new URL(p, origin).toString(), { timeoutMs, fetchImpl }));
  }
  const j = judge({ pages });
  j.request = { accept: ACCEPT, userAgent: UA };
  return j;
}

/* ── THE SAMPLE AND THE SELFTEST ──────────────────────────────────────────────────────────────── */

export const FIXTURE_CLEAN = '<html><head><link rel="stylesheet" href="dex-badges.css"><script src="oxydex-dsp.js"></script></head><body><img src="/logo.svg"></body></html>';
export const FIXTURE_BEACON = '<html><head><script defer src="https://static.cloudflareinsights.com/beacon.min.js/v1"></script></head><body></body></html>';
export const FIXTURE_FONT = '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head><body></body></html>';
export const SAMPLE_HEADERS = { nel: '{"report_to":"cf-nel","success_fraction":0.0}', 'report-to': '{"group":"cf-nel","endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=x"}]}' };

export function verdictSample() {
  const j = judge({ pages: [{ url: DEFAULT_ORIGIN + '/', status: 200, body: FIXTURE_CLEAN, bytes: FIXTURE_CLEAN.length, headers: SAMPLE_HEADERS, originHost: 'tepna.net' }] });
  return makeVerdict(verdictFields(j, { commit: null, commitReason: 'sample verdict built from fixtures, with no live fetch' }));
}

export function selftest() {
  const legs = [];
  const ok = (name, cond, detail) => legs.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });

  /* 1 · a clean page names no offsite reference; the control proves the scan saw its tags */
  const clean = scanMarkup(FIXTURE_CLEAN, { originHost: 'tepna.net' });
  ok('clean page: 0 findings', clean.findings.length === 0, clean.findings.length);
  ok('clean page control: the scan read its loading tags', clean.tags === 3, clean.tags);

  /* 2 · the beacon reads as its named rule; the control rewrites the host to the page's own */
  const beacon = scanMarkup(FIXTURE_BEACON, { originHost: 'tepna.net' });
  ok('beacon: 1 finding named cloudflare-insights', beacon.findings.length === 1 && beacon.findings[0].rule === 'cloudflare-insights', JSON.stringify(beacon.findings));
  const sameHost = scanMarkup(FIXTURE_BEACON.replace('static.cloudflareinsights.com', 'tepna.net'), { originHost: 'tepna.net' });
  ok('beacon control: a same-host absolute url is no finding', sameHost.findings.length === 0, sameHost.findings.length);

  /* 3 · an unknown vendor still reports, under the generic class */
  const font = scanMarkup(FIXTURE_FONT, { originHost: 'tepna.net' });
  ok('offsite stylesheet: reported as ' + OFFSITE_CLASS, font.findings.length === 1 && font.findings[0].rule === OFFSITE_CLASS, JSON.stringify(font.findings));

  /* 4 · a protocol-relative url is absolute; a doubled slash inside a path is not */
  const protoRel = scanMarkup('<script src="//static.cloudflareinsights.com/beacon.min.js"></script>', { originHost: 'tepna.net' });
  ok('protocol-relative url: detected', protoRel.findings.length === 1 && protoRel.findings[0].host === 'static.cloudflareinsights.com', JSON.stringify(protoRel.findings));
  const innerSlash = scanMarkup('<script src="assets//app.js"></script>', { originHost: 'tepna.net' });
  ok('protocol-relative control: a doubled slash inside a path is no finding', innerSlash.findings.length === 0, innerSlash.findings.length);

  /* 5 · a commented example loads nothing; the control keeps the live tag beside it */
  const commented = scanMarkup('<!-- <script src="https://static.cloudflareinsights.com/beacon.min.js"></script> --><script src="app.js"></script>', { originHost: 'tepna.net' });
  ok('commented beacon: no finding', commented.findings.length === 0, JSON.stringify(commented.findings));
  const commentedPlusLive = scanMarkup('<!-- <script src="https://x.example/a.js"></script> --><script src="https://y.example/b.js"></script>', { originHost: 'tepna.net' });
  ok(
    'comment control: the live tag beside it still reports',
    commentedPlusLive.findings.length === 1 && commentedPlusLive.findings[0].host === 'y.example',
    JSON.stringify(commentedPlusLive.findings)
  );

  /* 6 · an outbound citation link is not a transport finding */
  const anchor = scanMarkup('<a href="https://doi.org/10.1000/x">paper</a>', { originHost: 'tepna.net' });
  ok('an anchor href is no finding', anchor.findings.length === 0, anchor.findings.length);

  /* 7 · the edge's reporting headers, and an unreadable one */
  const h = classifyHeaders(SAMPLE_HEADERS);
  ok('headers: cloudflare named from the report endpoint', h.cdn === 'cloudflare', JSON.stringify(h));
  ok(
    'headers: the endpoint host rides in the annotation',
    h.reporting.some((r) => r.endpointHosts.includes('a.nel.cloudflare.com')),
    JSON.stringify(h.reporting)
  );
  const broken = classifyHeaders({ 'report-to': '{not json' });
  ok('headers control: an unreadable value gives an entry with no host', broken.reporting.length === 1 && broken.reporting[0].endpointHosts.length === 0, JSON.stringify(broken.reporting));
  const bare = classifyHeaders({});
  ok('headers control: no header gives no annotation', bare.reporting.length === 0 && bare.cdn === null, JSON.stringify(bare));

  /* 8 · population arithmetic over a page the audit could not read */
  const mixed = judge({
    pages: [
      { url: 'https://tepna.net/', status: 200, body: FIXTURE_CLEAN, bytes: 10, headers: {}, originHost: 'tepna.net' },
      { url: 'https://tepna.net/gone.html', status: 404, originHost: 'tepna.net' },
      { url: 'https://tepna.net/dead.html', error: 'connect timeout', originHost: 'tepna.net' }
    ]
  });
  ok('judge: checked + excluded = eligible', mixed.checked + mixed.excluded === mixed.eligible && mixed.checked === 1, JSON.stringify([mixed.checked, mixed.excluded, mixed.eligible]));
  ok('judge: each exclusion carries its own reason', mixed.excludedReasons.length === 2 && mixed.excludedReasons.every((e) => e.reason), JSON.stringify(mixed.excludedReasons));

  /* 9 · the three statuses, each with the control beside it */
  const nothing = verdictFields(judge({ pages: [] }));
  ok('verdict: nothing fetched is NOT_RUN with result null', nothing.status === 'NOT_RUN' && nothing.result === null && !!nothing.reason, JSON.stringify(nothing));
  const passing = verdictFields(mixed);
  ok('verdict: a clean read is PASS with no reason', passing.status === 'PASS' && passing.reason === null && passing.result.offsite === 0, JSON.stringify(passing.result));
  const failing = verdictFields(judge({ pages: [{ url: 'https://tepna.net/', status: 200, body: FIXTURE_BEACON, bytes: 9, headers: {}, originHost: 'tepna.net' }] }));
  ok('verdict: a beacon is FAIL and the reason names the rule', failing.status === 'FAIL' && /cloudflare-insights/.test(failing.reason), failing.reason);
  const allExcluded = verdictFields(judge({ pages: [{ url: 'https://tepna.net/x', status: 503, originHost: 'tepna.net' }] }));
  ok('verdict: every page excluded is NOT_RUN, never PASS', allExcluded.status === 'NOT_RUN' && /503/.test(allExcluded.reason), allExcluded.reason);

  /* 10 · the sample object validates, which is what the adoption gate reads */
  let sampleOk = false;
  let sampleDetail = '';
  try {
    const v = verdictSample();
    sampleOk = v.schema === 'tepna.verdict/1' && v.producedBy.commit === null && !!v.producedBy.commitReason;
    sampleDetail = v.status;
  } catch (e) {
    sampleDetail = e.message;
  }
  ok('the sample object validates and states why it names no commit', sampleOk, sampleDetail);

  const failed = legs.filter((l) => !l.pass);
  for (const l of failed) console.log('  ✕ ' + l.name + ' — ' + l.detail);
  if (failed.length) {
    console.log(failed.length + ' of ' + legs.length + ' selftests failed');
    return 1;
  }
  console.log('all ' + legs.length + ' selftests passed');
  return 0;
}

/* ── CLI ──────────────────────────────────────────────────────────────────────────────────────── */

/* The house idiom reads a value as the NEXT token, and `argv-guard` refuses `--flag=value` outright. */
/* The flag name arrives WITH its dashes, so every read site holds the literal flag. A tool that builds
   a flag name from a fragment leaves the documented-flag check undecidable (tests/dex-tests.js). */
function flagValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

export async function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--fetch', '--json', '--selftest', '--verdict-sample'], valued: ['--origin', '--paths', '--timeout-ms'] }, { tool: TOOL });
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    printVerdict(verdictSample(), { prefix: '' });
    return 0;
  }
  const origin = flagValue(argv, '--origin', DEFAULT_ORIGIN);
  const paths = String(flagValue(argv, '--paths', DEFAULT_PATHS.join(',')))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const timeoutMs = Number(flagValue(argv, '--timeout-ms', DEFAULT_TIMEOUT_MS));
  const json = argv.includes('--json');

  let j;
  if (argv.includes('--fetch')) {
    j = await run({ origin, paths, timeoutMs });
  } else {
    j = judge({ pages: [] });
    j.eligible = 0;
  }
  const fields = verdictFields(j);
  if (!argv.includes('--fetch')) fields.reason = 'no --fetch given, so this run read no page; the tool reads the live host and never runs inside a gate';
  const v = makeVerdict(fields);

  if (!json) {
    console.log('▸ ' + GATE + ' · ' + origin + ' · ' + v.status);
    if (j.checked === 0) {
      console.log('  ' + v.reason);
    } else {
      for (const p of j.byPage) {
        console.log(
          '  ' +
            p.url +
            ' — ' +
            (p.bytes === null ? 'size unread' : p.bytes + ' bytes') +
            ', ' +
            p.loadingTags +
            ' loading tag(s), ' +
            p.findings.length +
            ' offsite reference(s)' +
            (p.cdn ? ' · edge: ' + p.cdn : '')
        );
        for (const f of p.findings) console.log('      ✕ ' + f.rule + ' — <' + f.tag + ' ' + f.attr + '> ' + f.url);
      }
      for (const e of j.excludedReasons) console.log('  ⊘ ' + e.url + ' — ' + e.reason);
      for (const r of j.hostReporting) console.log('  ⓘ host header ' + r.header + (r.endpointHosts.length ? ' → ' + r.endpointHosts.join(', ') : '') + (r.note ? ' (' + r.note + ')' : ''));
      if (j.request) console.log('  ⓘ request sent · accept: ' + j.request.accept + ' · user-agent: ' + j.request.userAgent);
      console.log("  the page requests nothing of its own; a host reporting endpoint is the edge's, so it annotates and never decides");
    }
    printVerdict(v);
  } else {
    console.log(JSON.stringify(v));
  }
  return v.status === 'FAIL' ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
