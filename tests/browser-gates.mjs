/*
 * tests/browser-gates.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless-browser CI gate. The Node suite (tests/run-tests.mjs) covers logic;
 * this drives the two BROWSER-only gates a headless runner can't otherwise see:
 *   1. Dex-Test-Suite.html  — full assertion suite + render-coverage (boots all
 *      8 app bundles in iframes, confirms computed values reach the DOM).
 *   2. verify-provenance.html — GATE A: each committed bundle's plain-inline manifestHash
 *      matches BUILD-MANIFEST.json; GATE B: every ledger fixture is reproducible.
 *
 * Detection is by polling the pages' own DOM verdicts — no page edits needed.
 *
 * NOTE on uploads/: it is gitignored (personal data), so on a fresh CI checkout
 * the provenance FIXTURE audit (GATE B) has nothing to scan and passes vacuously;
 * GATE A (all 8 bundles reproducible) is still fully enforced. Locally, with
 * uploads/ present, both gates run. The Dex-Test-Suite gate never needs uploads/.
 *
 * Run: BASE_URL=http://127.0.0.1:8080 node tests/browser-gates.mjs
 */
import { aggregateChildren, makeVerdict } from '../tools/verdict-emit.mjs';

/* ── VERDICT-CONTRACT §3d — the four browser legs as ONE object ──────────────────────────────────
   Children = the legs this invocation runs (test-suite · provenance · no-network · night-seal), each
   read from its own FAILS delta (provenance `leg`): no failure ⇒ PASS, ≥ 1 ⇒ FAIL, a leg that THREW
   (a crashed renderer, a timeout the leg did not catch) ⇒ UNKNOWN — it decided nothing. NN_ONLY /
   SEAL_ONLY select one leg and are DECLARED exclusions ⇒ filtered:true with the consumer rule (the
   no-network workflow runs one leg on purpose; it is that workflow's gate, not this one's). The
   night-seal leg already READS verify-seals' tepna.verdict/1 (`verdictValid`), so this runner is a
   consumer one level up. `--json` prints the object on stdout; the exit code stays. The playwright
   import is DYNAMIC so `--selftest` / `--verdict-sample` run where no browser is installed. */
export const LEGS = ['Dex-Test-Suite.html?full', 'verify-provenance.html', 'no-network.html', 'night-seal (OverDex.html)'];
export function browserGatesVerdict(legs, { selectedBy = null, commit, commitReason, at } = {}) {
  const ran = legs.map((l) => ({
    name: l.name,
    provenance: 'leg',
    status: l.threw ? 'UNKNOWN' : l.fails.length ? 'FAIL' : 'PASS',
    ...(l.threw ? { why: String(l.threw).slice(0, 160) } : l.fails.length ? { why: l.fails[0].split('\n')[0].slice(0, 160) } : {})
  }));
  const missing = LEGS.filter((n) => !legs.some((l) => l.name === n));
  /* a leg not run under a selector is a DECLARED exclusion; without one it is an unplanned NOT_RUN
     child — the aggregation makes the run UNKNOWN, never green (a leg list edited without a selector). */
  const children = selectedBy ? ran : [...ran, ...missing.map((name) => ({ name, provenance: 'not-run' }))];
  const agg = aggregateChildren(children, { eligible: LEGS.length, declaredExcluded: selectedBy ? missing : [], excludedBy: selectedBy });
  let { result } = agg;
  if (result) result = { ...result, fails: legs.reduce((a, l) => a + l.fails.length, 0), children: result.children.map((c, i) => ({ ...c, ...(ran[i] && ran[i].why ? { why: ran[i].why } : {}) })) };
  return makeVerdict({
    gate: 'browser-gates',
    status: agg.status,
    population: agg.population,
    criterion: CRIT,
    result,
    evidence: EV,
    reason: agg.reason,
    tool: 'tests/browser-gates.mjs',
    commit,
    commitReason,
    at
  });
}
const CRIT = {
  name: "legs_failing (each browser leg reads its page's OWN DOM verdict; a leg that threw is UNKNOWN; NN_ONLY / SEAL_ONLY are declared exclusions)",
  threshold: 0,
  unit: 'failing legs',
  direction: 'eq'
};
const EV = ['Dex-Test-Suite.html', 'verify-provenance.html', 'no-network.html', 'OverDex.html', 'capture-host/tests/vectors/tepna-seal-1/'];

export function verdictSample() {
  return browserGatesVerdict(
    LEGS.map((name) => ({ name, fails: [], threw: null })),
    { commit: null, commitReason: '--verdict-sample: four scratch legs, no browser launched, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const L = (name, fails = [], threw = null) => ({ name, fails, threw });
  const all = LEGS.map((name) => L(name));
  const green = browserGatesVerdict(all, AT);
  eq(green.status === 'PASS' && green.population.checked === 4 && green.result.filtered === false, true, '§3d · four clean legs ⇒ PASS over 4/4');
  const red = browserGatesVerdict([L(LEGS[0], ['Dex-Test-Suite RED — 2 failing']), L(LEGS[1]), L(LEGS[2]), L(LEGS[3])], AT);
  eq(red.status === 'FAIL' && /Dex-Test-Suite/.test(red.reason), true, '§3d plant · a red leg ⇒ FAIL, named');
  const crashed = browserGatesVerdict([L(LEGS[0], [], 'Error: page crashed'), L(LEGS[1]), L(LEGS[2]), L(LEGS[3])], AT);
  eq(crashed.status === 'UNKNOWN' && /page crashed/.test(crashed.reason), true, '§3d plant · a leg that THREW ⇒ UNKNOWN (it decided nothing), never green');
  const nn = browserGatesVerdict([L(LEGS[2])], { ...AT, selectedBy: 'NN_ONLY=1' });
  eq(
    nn.status === 'PASS' && nn.result.filtered === true && nn.result.excludedBy === 'NN_ONLY=1' && JSON.stringify(nn.population) === JSON.stringify({ checked: 1, eligible: 4, excluded: 3 }),
    true,
    '§3d plant · NN_ONLY ⇒ a declared exclusion: PASS over 1/4, filtered'
  );
  eq(/NOT the gate/.test(nn.result.consumerRule || ''), true, '§3d plant · …with the consumer rule');
  const missing = browserGatesVerdict([L(LEGS[0]), L(LEGS[1]), L(LEGS[2])], AT);
  eq(
    missing.status === 'UNKNOWN' && /night-seal/.test(missing.reason) && missing.population.excluded === 1,
    true,
    '§3d plant · a leg missing with NO selector ⇒ an unplanned NOT_RUN: UNKNOWN, the leg named, counted excluded'
  );
  eq(browserGatesVerdict([], AT).status, 'NOT_RUN', '§3d plant · nothing ran ⇒ NOT_RUN');
  eq(verdictSample().status === 'PASS' && verdictSample().producedBy.commit === null, true, '§3d · --verdict-sample: four scratch legs ⇒ PASS, no commit');
  console.log(`all ${n} selftests passed`);
}

const ARGV = process.argv.slice(2);
if (ARGV.includes('--selftest')) {
  selftest();
  process.exit(0);
}
if (ARGV.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
const JSON_OUT = ARGV.includes('--json');
const say = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a)); // --json: stdout carries ONE object

const { chromium } = await import('playwright');
const { launch } = await import('../tools/pw-launch.mjs');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const FAILS = [];
// --disable-dev-shm-usage: CI containers give /dev/shm only ~64 MB. Render-coverage boots 9 self-
// contained app bundles (each evals MBs of inlined plain-text JS) in an iframe; that overflows /dev/shm
// and the RENDERER PROCESS CRASHES mid-run — which surfaces as an EARLY waitForFunction rejection
// (~30 s in), NOT a 5-min stall. Routing Chromium shared memory to /tmp removes the crash. (Local runs
// have a large /dev/shm, which is why the suite is green there but red in CI.)
const browser = await launch(chromium);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

/* ── Gate 1 · Dex-Test-Suite (assertions + render-coverage) ───────────────── */
async function gateTestSuite() {
  const page = await ctx.newPage();
  let crashed = false;
  page.on('pageerror', (e) => say('   [suite page error]', e.message));
  page.on('crash', () => {
    crashed = true;
    say('   [suite] RENDERER CRASHED (page "crash" event) — almost always /dev/shm OOM booting the app bundles');
  });
  say('▸ Dex-Test-Suite.html …');
  // ?full is REQUIRED: render-coverage is ON-DEMAND (lazy, 2026-06-30). A bare open paints only the
  // headless floor and never boots the rigs → __rcState stays 'pending' and the wait below times out.
  await page.goto(BASE + '/Dex-Test-Suite.html?full', { waitUntil: 'load', timeout: 60000 });
  // Read the suite's OWN programmatic verdict (CLAUDE.md: window.__rcState + sameOriginStatus(), never
  // scrape prose). Render-coverage is complete iff __rcState === 'done'. (The old predicate waited for
  // the literal words "hang guard" in #results — brittle, and it hid the real failure mode below.)
  try {
    // CI runners are meaningfully slower than a local/dev machine for this rig (shared vCPUs, plus
    // --disable-dev-shm-usage routes iframe boot memory through disk instead of tmpfs) — the ~30-50s
    // local runtime observed a full clean pass with zero boot-skips; the codebase's own retry-once
    // boot logic + this 5-min ceiling were already CI headroom over that baseline. A run that reaches
    // 'running' with groups still legitimately accumulating (no crash, no thrown error) and just needs
    // more wall-clock is NOT the same failure mode as a genuine hang; widen the ceiling so a slow-but-
    // progressing CI runner doesn't red on wall-clock alone (BROWSER-GATES-CI-TIMEOUT 2026-07-03).
    // The options object MUST be the THIRD arg — waitForFunction(pageFunction, arg, options). Passing
    // it as the second arg (the historical bug here) makes Playwright treat it as `arg` and silently
    // fall back to the DEFAULT 30 s timeout — so the "widen the ceiling to 15 min" fix above never took
    // effect, and render-coverage (which needs ~26-30 s: the Integrator rig alone is ~14 s) raced the
    // accidental 30 s ceiling and rejected at 9 groups. `null` arg + explicit options restores the 15-min
    // ceiling. polling:500 (a timer, not the default rAF) also leaves the page idle so its `_rcYield`
    // requestIdleCallback scheduler (Dex-Test-Suite.html ~line 1075) fires between rig boots.
    await page.waitForFunction(() => window.__rcState === 'done', null, { timeout: 900000, polling: 500 });
  } catch (err) {
    // waitForFunction rejects on EITHER a genuine 5-min stall OR an early execution-context loss
    // (renderer crash). Distinguish them and report the state actually reached, so the next run is
    // actionable instead of the old blanket "did not finish within 5 min" that masked the crash.
    let diag = null;
    try {
      diag = await page.evaluate(() => {
        const s = (window.sameOriginStatus && window.sameOriginStatus()) || {};
        return { rcState: window.__rcState || 'unknown', rcGroups: s.renderCoverageGroups || 0, bootSkips: window.__rcBootSkips || [], blocked: !!s.blocked, rcTimings: window.__rcTimings || [] };
      });
    } catch (_) {
      /* context gone → almost certainly a crash */
    }
    if (crashed || !diag) {
      FAILS.push(
        'Dex-Test-Suite: renderer CRASHED during render-coverage' +
          (diag ? ' (reached rcState=' + diag.rcState + ', ' + diag.rcGroups + ' rc groups)' : ' (execution context lost)') +
          ' — this is a CI /dev/shm OOM; chromium must launch with --disable-dev-shm-usage (see launch args above).'
      );
    } else {
      FAILS.push(
        'Dex-Test-Suite: render-coverage did not reach done within 15 min — rcState=' +
          diag.rcState +
          ', ' +
          diag.rcGroups +
          ' rc groups booted, bootSkips=' +
          JSON.stringify(diag.bootSkips) +
          (diag.blocked ? ', same-origin BLOCKED' : '') +
          '. Per-rig timings (ms) so far: ' +
          JSON.stringify(diag.rcTimings) +
          ' — a rig missing from this list is the one that was still in-flight when the ceiling hit.'
      );
    }
    try {
      await page.close();
    } catch (_) {}
    return;
  }
  const r = await page.evaluate(() => ({
    hasFail: !!document.querySelector('#summary .pill.fail'),
    bootSkips: window.__rcBootSkips || [],
    summary: (document.getElementById('summary').innerText || '').replace(/\s+/g, ' ').trim(),
    /* NAME THE FAILURES, do not just count them. This gate used to report "✕ 2 failing" and
       nothing else, so every consumer — CI log reader or a session debugging their own PR — had
       to reproduce a ~15 minute browser run just to learn WHICH assertions broke. The names are
       already in the page: the suite renders each failing assertion as `div.test.no` with `.name`
       and `.detail` children (Dex-Test-Suite.html, the `_cls=t.skip?'sk':(t.pass?'ok':'no')`
       line). Reading them costs one extra selector inside an evaluate we are already making.
       ⚠️ Selected by CLASS, not by the ✕ glyph. A glyph filter also matches the "✕ Clear" buttons
       inside the app UIs the render-coverage rigs boot in iframes — measured while debugging
       #2352, where it returned button labels instead of assertions. Match structure, not
       presentation. Capped at 25 so a mass failure cannot flood a CI log. */
    failures: Array.from(document.querySelectorAll('div.test.no'))
      .slice(0, 25)
      .map((d) => {
        const n = ((d.querySelector('.name') || {}).textContent || '').trim();
        const det = ((d.querySelector('.detail') || {}).textContent || '').trim();
        return det ? n + '  —  ' + det : n;
      })
      .filter((t) => t.length > 0),
    failTotal: document.querySelectorAll('div.test.no').length
  }));
  say('   summary:', r.summary + (r.bootSkips.length ? '   [boot-skips: ' + r.bootSkips.join(', ') + ']' : ''));
  r.failures.forEach((f) => say('   ✕', f));
  if (r.failTotal > r.failures.length) say('   … and ' + (r.failTotal - r.failures.length) + ' more (listing capped at 25)');
  if (r.hasFail) FAILS.push('Dex-Test-Suite RED — ' + r.summary + (r.failures.length ? '\n     ' + r.failures.join('\n     ') : ''));
  await page.close();
}

/* ── Gate 2 · verify-provenance (build manifest + fixture audit) ──────────── */
async function gateProvenance() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('   [provenance page error]', e.message));
  say('▸ verify-provenance.html …');
  await page.goto(BASE + '/verify-provenance.html', { waitUntil: 'load', timeout: 60000 });
  // Manifest appends one row per bundle (8). Wait for all, then a short settle
  // so the (best-effort) fixture audit finishes too.
  try {
    await page.waitForFunction(() => document.querySelectorAll('#manifest tbody tr').length >= 8, null, { timeout: 180000 });
  } catch {
    FAILS.push('verify-provenance: build manifest did not populate all 8 bundles');
    await page.close();
    return;
  }
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const reds = [...document.querySelectorAll('#manifest .pill.bad, #manifest td.bad, #fixtures .pill.bad, #fixtures td.bad')];
    return {
      bundles: document.querySelectorAll('#manifest tbody tr').length,
      fixtures: document.querySelectorAll('#fixtures tbody tr').length,
      reds: reds.map((e) => (e.closest('tr')?.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 30)
    };
  });
  say(`   ${out.bundles} bundles · ${out.fixtures} fixtures audited`);
  if (out.reds.length) FAILS.push('verify-provenance RED verdicts:\n   - ' + out.reds.join('\n   - '));
  await page.close();
}

/* ── Gate 3 · no-network invariant (privacy: 0 remote egress across the shipped surfaces) ── */
async function gateNoNetwork() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('   [no-network page error]', e.message));
  say('▸ no-network.html …');
  await page.goto(BASE + '/no-network.html', { waitUntil: 'load', timeout: 60000 });
  // Read the gate's OWN verdict (window.__noNetworkOK + noNetworkStatus()), never scrape prose.
  // It boots the 8 bundles + 2 orchestrators in trapped iframes; an unsettled boot is a SKIP inside
  // the gate (static layer is authoritative), so the verdict still resolves without a CI /dev/shm red.
  try {
    await page.waitForFunction(() => typeof window.__noNetworkOK === 'boolean', null, { timeout: 180000 });
  } catch {
    FAILS.push('no-network: verdict never computed (gate did not finish scanning/booting the surfaces)');
    await page.close();
    return;
  }
  const s = await page.evaluate(() => (window.noNetworkStatus ? window.noNetworkStatus() : { ok: window.__noNetworkOK }));
  say(
    '   static:' +
      s.static +
      ' runtime:' +
      s.runtime +
      ' python:' +
      s.python +
      ' canary:' +
      s.canary +
      ' · ' +
      s.surfacesScanned +
      ' surfaces, ' +
      s.looseModules +
      ' modules, ' +
      s.surfacesBooted +
      ' booted'
  );
  if (!s.ok)
    FAILS.push(
      'no-network RED — static:' +
        s.static +
        ' runtime:' +
        s.runtime +
        ' python:' +
        s.python +
        ' canary:' +
        s.canary +
        ' (staticHits=' +
        s.staticRemoteHits +
        ', runtimeHits=' +
        s.runtimeRemoteHits +
        ', pyHits=' +
        s.pythonEgressHits +
        ')'
    );
  await page.close();
}

/* ── CAPTURE-NIGHT-SEAL phase C — the in-page reader, on the committed vector and the EIGHT plants ──
   WebCrypto and DecompressionStream are browser-only in the sense that matters: a Node co-load runs
   the same reader (the node lane does, on the same vector) but cannot see OverDex's WIRING of it —
   the file input, the IndexedDB card store, the badge, the verdict object on `OverDex.seals`. This
   leg drives the real `ingest()` path in the served OverDex.html with File objects built from the
   committed bytes, and reads the page's own verdicts, never its prose.

   The eight plants (brief §6 + the consent-mirror plant of #2801, capture-host/tests/vectors/tepna-seal-1/plants/expected.json + the
   three a reader builds itself): each must red BY NAME in-page, and the denominator is an equality
   — eight enumerated, eight seen. `consent absent` is the one that must NOT refuse (reads null). */
async function gateNightSeal() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('   [overdex page error]', e.message));
  say('▸ OverDex.html · sealed night (tepna-seal/1) …');
  await page.goto(BASE + '/OverDex.html', { waitUntil: 'load', timeout: 60000 });
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const vdir = join(here, '..', 'capture-host', 'tests', 'vectors', 'tepna-seal-1');
  const exp = JSON.parse(readFileSync(join(vdir, 'expected.json'), 'utf8'));
  const plantsExp = JSON.parse(readFileSync(join(vdir, 'plants', 'expected.json'), 'utf8'));
  const b64 = (p) => readFileSync(p).toString('base64');
  const vector = b64(join(vdir, exp.seal));
  const plants = {};
  for (const [name, rec] of Object.entries(plantsExp)) plants[name] = { b64: b64(join(vdir, 'plants', rec.file)), expect: rec.expect };
  const r = await page.evaluate(
    async ({ exp, vector, plants }) => {
      const O = window.OverDex;
      if (!O || !O.seals) return { error: 'OverDex.seals surface absent — night-seal not wired' };
      if (!window.NightSeal) return { error: 'NightSeal not loaded' };
      const toU8 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const fileOf = (s, name) => new File([toU8(s)], name);
      const ingestOne = async (file, card) => {
        await O.seals.setCard(exp.boxId, exp.keyId, card);
        await O.seals.ingestFiles([file]);
        // ingest is async and un-awaited by design; poll the page's own list
        for (let i = 0; i < 200; i++) {
          const L = O.seals.list();
          if (L.length && L[L.length - 1].verdict) return L[L.length - 1];
          await new Promise((res) => setTimeout(res, 50));
        }
        return { status: 'TIMEOUT' };
      };
      const good = { cardKeyHex: exp.cardKeyHex, fingerprint: exp.boxKeyFingerprint, knownRevision: null };
      const out = { vector: null, plants: {}, badges: {} };
      // the vector opens, verified, three streams, badge reads sealed·verified, verdict PASS and VALID
      const v = await ingestOne(fileOf(vector, exp.seal), good);
      out.vector = {
        status: v.status,
        kind: v.kind || null,
        streams: v.streams,
        badge: v.badge && v.badge.text,
        verdictValid: v.verdict && v.verdict.valid,
        verdictStatus: v.verdict && v.verdict.status,
        items: (O.items() || []).map((it) => ({ rel: it.relPath, klass: it.klass }))
      };
      // the four sealer-built plants
      for (const [name, pl] of Object.entries(plants)) {
        const o = await ingestOne(fileOf(pl.b64, 'plant.tepna'), good);
        out.plants[name] = {
          status: o.status,
          kind: o.kind || null,
          consent: o.consent,
          badge: o.badge && o.badge.text,
          expect: pl.expect,
          verdictValid: o.verdict && o.verdict.valid,
          tampered: o.streams && o.streams.tampered,
          opened: o.streams && o.streams.opened
        };
      }
      // the three a reader builds from the base vector (the sealer-built four are above)
      const wrong = await ingestOne(fileOf(vector, exp.seal), { cardKeyHex: '101112131415161718191a1b1c1d1e1f', fingerprint: exp.boxKeyFingerprint, knownRevision: null });
      out.plants['wrong card key'] = { status: wrong.status, kind: wrong.kind || null, expect: 'card-key', verdictValid: wrong.verdict && wrong.verdict.valid };
      const stale = await ingestOne(fileOf(vector, exp.seal), { cardKeyHex: exp.cardKeyHex, fingerprint: exp.boxKeyFingerprint, knownRevision: 2 });
      out.plants['stale revision'] = { status: stale.status, kind: stale.kind || null, expect: 'revision', verdictValid: stale.verdict && stale.verdict.valid };
      // a forged header: change one clear-header field, keep the box's signature and payload
      const blob = toU8(vector);
      const n = 10,
        dv = new DataView(blob.buffer);
      const hlen = dv.getUint32(n);
      const hdr = JSON.parse(new TextDecoder().decode(blob.subarray(n + 4, n + 4 + hlen)));
      hdr.night = '2026-09-21';
      const nh = new TextEncoder().encode(JSON.stringify(hdr, Object.keys(hdr).sort()));
      const forged = new Uint8Array(n + 4 + nh.length + (blob.length - (n + 4 + hlen)));
      forged.set(blob.subarray(0, n), 0);
      new DataView(forged.buffer).setUint32(n, nh.length);
      forged.set(nh, n + 4);
      forged.set(blob.subarray(n + 4 + hlen), n + 4 + nh.length);
      const fg = await ingestOne(new File([forged], exp.seal), good);
      out.plants['forged header'] = { status: fg.status, kind: fg.kind || null, expect: 'signature', verdictValid: fg.verdict && fg.verdict.valid };
      // legacy: a loose file that came from no seal carries the honest default badge
      await O.seals.ingestFiles([new File(['Time,Oxygen Level,Pulse Rate,Motion\n2026-09-20T22:00:00,97,60,0\n'], 'loose.csv')]);
      await new Promise((res) => setTimeout(res, 300));
      out.badges.legacy = (document.querySelector('#manifest .seal') || {}).textContent || null;
      return out;
    },
    { exp, vector, plants }
  );
  if (r.error) {
    FAILS.push('night-seal: ' + r.error);
    await page.close();
    return;
  }
  const v = r.vector;
  say('   vector:', v.status, v.badge, '· streams', JSON.stringify(v.streams), '· verdict', v.verdictStatus, v.verdictValid ? 'valid' : 'INVALID');
  if (v.status !== 'PASS') FAILS.push('night-seal: the committed vector did not open as PASS — ' + v.status + ' ' + (v.kind || ''));
  if (!(v.streams && v.streams.opened === 3 && v.streams.verified === 3 && v.streams.tampered.length === 0))
    FAILS.push('night-seal: vector streams ' + JSON.stringify(v.streams) + ', want 3 opened / 3 verified / 0 tampered');
  if (!/^sealed · box TESTBOX0 · closed \d\d:\d\d · verified$/.test(v.badge || '')) FAILS.push('night-seal: vector badge reads ' + JSON.stringify(v.badge));
  if (!v.verdictValid) FAILS.push("night-seal: the vector's tepna.verdict/1 does not validate under verdict.js");
  if (!v.items.some((it) => /^TESTBOX0-2026-09-20\//.test(it.rel))) FAILS.push('night-seal: the unsealed streams did not enter the manifest under <boxId>-<night>/');
  // the EIGHT plants — an equality on the count, each by name
  const names = Object.keys(r.plants);
  say('   plants seen:', names.length, '—', names.join(' · '));
  if (names.length !== 8) FAILS.push('night-seal: ' + names.length + ' plants seen, the denominator is EIGHT');
  for (const [name, o] of Object.entries(r.plants)) {
    const tag = '   plant ' + name + ': ' + o.status + ' ' + (o.kind || '') + (o.badge ? ' — ' + o.badge : '');
    say(tag);
    if (o.expect === null) {
      if (o.status !== 'PASS' || o.consent !== null) FAILS.push('night-seal plant "' + name + '": must OPEN with consent null, got ' + o.status + ' consent=' + JSON.stringify(o.consent));
    } else if (o.expect.indexOf('manifest:') === 0) {
      // a tampered stream reds BY NAME and the night still opens (PASS is not available: status FAIL, but streams opened)
      if (!(o.status === 'FAIL' && o.kind === o.expect && o.opened === 3 && o.tampered && o.tampered.length === 1))
        FAILS.push('night-seal plant "' + name + '": want FAIL ' + o.expect + ' with the other streams open, got ' + JSON.stringify(o));
      if (!/^TAMPERED: synthetic_oxydex_o2ring\.csv$/.test(o.badge || '')) FAILS.push('night-seal plant "' + name + '": badge must name the stream, got ' + JSON.stringify(o.badge));
    } else if (!(o.status === 'FAIL' && o.kind === o.expect)) FAILS.push('night-seal plant "' + name + '": want FAIL ' + o.expect + ', got ' + o.status + ' ' + (o.kind || ''));
    if (o.verdictValid === false) FAILS.push('night-seal plant "' + name + '": its tepna.verdict/1 does not validate');
  }
  if (r.plants['unknown signing key'] && !/unknown key/.test(r.plants['unknown signing key'].badge || ''))
    FAILS.push('night-seal: the unknown-key badge must say so, got ' + JSON.stringify(r.plants['unknown signing key'].badge));
  if (r.badges.legacy !== 'unsealed folder — provenance unknown') FAILS.push('night-seal: a loose file must carry "unsealed folder — provenance unknown", got ' + JSON.stringify(r.badges.legacy));
  await page.close();
}

// NN_ONLY=1 → run just the fast no-network gate (its own lightweight workflow, on every push);
// default → run all three (rides the on-demand browser-gates workflow).
/* §3d — each leg records its own FAILS delta and whether it threw; the object is built from these. */
const LEG_RESULTS = [];
async function leg(name, fn) {
  const before = FAILS.length;
  let threw = null;
  try {
    await fn();
  } catch (e) {
    threw = (e && e.message) || String(e);
    FAILS.push(name + ': threw — ' + threw);
  }
  LEG_RESULTS.push({ name, fails: FAILS.slice(before), threw });
}
let selectedBy = null;
if (process.env.NN_ONLY) {
  selectedBy = 'NN_ONLY=1';
  await leg(LEGS[2], gateNoNetwork);
} else if (process.env.SEAL_ONLY) {
  // SEAL_ONLY=1 → just the sealed-night leg (seconds; for iterating on the reader)
  selectedBy = 'SEAL_ONLY=1';
  await leg(LEGS[3], gateNightSeal);
} else {
  await leg(LEGS[0], gateTestSuite);
  await leg(LEGS[1], gateProvenance);
  await leg(LEGS[2], gateNoNetwork);
  await leg(LEGS[3], gateNightSeal);
}
await browser.close();

const verdict = browserGatesVerdict(LEG_RESULTS, { selectedBy });
if (JSON_OUT) console.log(JSON.stringify(verdict));
else
  say(
    `  tepna.verdict/1: ${verdict.status}  ·  ${verdict.population.checked} checked / ${verdict.population.eligible} eligible / ${verdict.population.excluded} excluded${verdict.result && verdict.result.filtered ? '  ·  FILTERED (' + verdict.result.excludedBy + ') — not the gate' : ''}`
  );
/* THE EXIT CODE STAYS — CI reads it until the consumer reads the object (§3d). */
if (FAILS.length) {
  console.error('\n✕ BROWSER GATES FAILED:\n' + FAILS.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
say('\n✓ browser gates passed (render-coverage + provenance + no-network + night-seal)');
