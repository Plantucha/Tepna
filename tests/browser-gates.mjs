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
 * Run: `npm run gates:browser:local` (tools/browser-lane.mjs serves the tree, picks a free port and
 * sets BASE_URL). By hand: BASE_URL=http://127.0.0.1:<a port you serve> node tests/browser-gates.mjs.
 * This file starts NO server, so a bare run reaches whatever holds 8080 — see the ORIGIN PREFLIGHT.
 */
import { readFileSync } from 'node:fs';
import { aggregateChildren, makeVerdict } from '../tools/verdict-emit.mjs';
/* The DECLARED GATE A population, read from the gate module rather than hardcoded: the wait below carried
   a literal 8 against nine declared bundles. One number, one source. */
import { createRequire } from 'node:module';
const ManifestGate = createRequire(import.meta.url)('../manifest-gate.js');
/* The browser realm's skip budget, read from the SAME file the Node lane's allow-list lives in.
   Unreadable or absent ⇒ null, and `auditBrowserSkips` fails on it: a lost budget must not silently
   re-open the door it closed (`tests/run-tests.mjs` fails closed on the allow-list for one reason). */
const BROWSER_LANE = (() => {
  try {
    return createRequire(import.meta.url)('./expected-skips.json').browserLane || null;
  } catch (_) {
    return null;
  }
})();

/* ── VERDICT-CONTRACT §3d — the five browser legs as ONE object ──────────────────────────────────
   Children = the legs this invocation runs (test-suite · provenance · no-network · night-seal ·
   mobile-viewport), each
   read from its own FAILS delta (provenance `leg`): no failure ⇒ PASS, ≥ 1 ⇒ FAIL, a leg that THREW
   (a crashed renderer, a timeout the leg did not catch) ⇒ UNKNOWN — it decided nothing. NN_ONLY /
   SEAL_ONLY / MOBILE_ONLY select one leg and are DECLARED exclusions ⇒ filtered:true with the consumer rule (the
   no-network workflow runs one leg on purpose; it is that workflow's gate, not this one's). The
   night-seal leg already READS verify-seals' tepna.verdict/1 (`verdictValid`), so this runner is a
   consumer one level up. `--json` prints the object on stdout; the exit code stays. The playwright
   import is DYNAMIC so `--selftest` / `--verdict-sample` run where no browser is installed. */
export const LEGS = ['Dex-Test-Suite.html?full', 'verify-provenance.html', 'no-network.html', 'night-seal (OverDex.html)', 'mobile-viewport (375 px)'];
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
  name: "legs_failing (each browser leg reads its page's OWN DOM verdict; a leg that threw is UNKNOWN; NN_ONLY / SEAL_ONLY / MOBILE_ONLY are declared exclusions)",
  threshold: 0,
  unit: 'failing legs',
  direction: 'eq'
};
const EV = ['Dex-Test-Suite.html', 'verify-provenance.html', 'no-network.html', 'OverDex.html', 'capture-host/tests/vectors/tepna-seal-1/', 'index.html'];

export function verdictSample() {
  return browserGatesVerdict(
    LEGS.map((name) => ({ name, fails: [], threw: null })),
    { commit: null, commitReason: '--verdict-sample: five scratch legs, no browser launched, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

/* ── THE BROWSER REALM'S SKIP BUDGET — residue 2026-11-08-the-browser-lane-has-no-skip-budget ──
   `tests/expected-skips.json` opens with "Every skip the suite emits MUST appear here, or the run
   REDS", and `auditSkips` enforces that in `tests/run-tests.mjs` alone. `Dex-Test-Suite.html` names
   the file nowhere. Muse planted a browser-only skip and this gate stayed green at 189 of 188.

   WHY A BUDGET AND NOT `auditSkips` HERE. The Node allow-list keys a skip on `group :: test` plus a
   declared reason substring. Measured 2026-11-10 in a fresh worktree of `origin/main`: the browser
   realm's headless floor emits 197 skips over 941 groups, so per-skip entries would pin 197 realm
   differences as reviewable lines. Worse, 20 of those skips hand `T.skip` a reason as the NAME and
   no detail, and `auditSkips` reads `t.detail` — an entry for one of them reds as `reason-drift`
   forever, and an entry with no `detail` reds as `no-declared-reason`. So the realm gets three
   numbers, each with its own tooth:

     · `budget` CEILINGS the count and may only shrink. It is one-sided on purpose: 15 of the 197
       skips need a gitignored recording, so a checkout that HAS the corpus runs them and the count
       falls. The gate prints the slack and stays green. CI carries no corpus, so there the ceiling
       sits tight against the measured number and a planted skip reds.
     · `reasonClasses` declares every reason a browser skip may carry. A novel reason reds whatever
       the count does, which is the swap a ceiling alone cannot see.
     · `reasonInNameOnly` pins the 20 reason-in-name skips and reds the 21st.

   Pure, so every arm is planted in the selftest below without a browser. */
export function auditBrowserSkips(census, cfg) {
  if (!census) return ['the browser skip census is unreadable (ALL_GROUPS absent) — this budget examined NOTHING, so it cannot pass'];
  const c = cfg || {};
  if (typeof c.budget !== 'number' || !Array.isArray(c.reasonClasses) || typeof c.reasonInNameOnly !== 'number') {
    return ['tests/expected-skips.json carries no readable `browserLane` budget — the browser realm would run with no skip ceiling at all, which is the state the row logged'];
  }
  const rows = census.rows || [];
  /* The reason is the detail, or the test NAME when the leg passed no detail — the 20 above. */
  const reasonOf = (r) => (String(r.detail || '').trim() ? String(r.detail) : String(r.test || ''));
  const named = (list) =>
    list
      .slice(0, 4)
      .map((r) => r.group + ' :: ' + reasonOf(r).slice(0, 70))
      .join('  |  ');
  const inName = rows.filter((r) => !String(r.detail || '').trim());
  const undeclared = rows.filter((r) => !c.reasonClasses.some((k) => reasonOf(r).indexOf(k) >= 0));
  const fails = [];
  if (rows.length > c.budget) {
    fails.push(
      'the browser realm emits ' +
        rows.length +
        ' skips over ' +
        census.floorGroups +
        ' headless-floor groups, above the declared budget of ' +
        c.budget +
        ' — a skip SHRINKS this gate, so raising `browserLane.budget` in tests/expected-skips.json is a deliberate act that owes a justification'
    );
  }
  if (inName.length > c.reasonInNameOnly) {
    fails.push(
      inName.length +
        ' browser skips carry the reason in the NAME and no detail, above the declared ' +
        c.reasonInNameOnly +
        ' — hand T.skip a second argument so the reason can be declared: ' +
        named(inName)
    );
  }
  if (undeclared.length) {
    fails.push(undeclared.length + ' browser skip(s) carry a reason no `browserLane.reasonClasses` entry declares — declare the class or fix the leg: ' + named(undeclared));
  }
  return fails;
}

/* ── THE ORIGIN PREFLIGHT — a page this gate never loaded is NOT_RUN, never a verdict ────────────
   WHY. `BASE_URL` is optional and falls back to `http://127.0.0.1:8080`, and this file starts NO
   server: `npm run gates:browser:local` (`tools/browser-lane.mjs`) is what serves the tree. Row
   `2026-11-10-browser-gates-serves-nothing-on-its-default-port` measured the cost on the rig, where
   the xerj service answers 8080. Every leg then loaded a page that is not ours, the run printed
   `verdict never computed`, and it named no URL and no HTTP status — so the output read as a computed
   verdict over a page the gate never reached.

   A 200 IS NOT REACH. An unrelated service answers 200 as readily as ours, so the preflight asks for
   `__rcState`, the symbol `gateTestSuite` polls: the reach test and the first leg read one contract,
   and a port swap cannot satisfy one while failing the other.

   §🧾: a gate that examined nothing answers NOT_RUN with a reason, and this one names the URL, the
   status or the network error, and the command that serves the tree. Pure, so the selftest plants
   every arm with no server and no browser. */
export const ORIGIN_MARKER = '__rcState';
const SERVE_HINT = 'serve the tree and set BASE_URL — `npm run gates:browser:local` does both';
export function diagnoseOrigin({ url = '', status = null, body = '', error = null, marker = ORIGIN_MARKER } = {}) {
  if (error) return { ok: false, reason: `no page answered ${url}: ${error} — ${SERVE_HINT}` };
  if (status !== 200) return { ok: false, reason: `${url} answered HTTP ${status}, so this run loaded no page of ours — ${SERVE_HINT}` };
  const n = String(body).length;
  if (String(body).indexOf(marker) < 0) return { ok: false, reason: `${url} answered HTTP 200 with ${n} byte(s) that do not hold \`${marker}\`, so another service holds that port — ${SERVE_HINT}` };
  return { ok: true, reason: null };
}
/* The NOT_RUN object. Every leg was ELIGIBLE and every leg is EXCLUDED by the unreachable origin, so
   the population states 0 checked of 5 eligible and does not pretend the legs were never there. The
   contract refuses a `result` here (`verdict.js`: nothing was examined, so nothing was measured), so
   the URL and the status live in the `reason`, which is the only field a reader gets. */
export function originNotRunVerdict(reason, at) {
  return makeVerdict({
    gate: 'browser-gates',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: LEGS.length, excluded: LEGS.length },
    criterion: CRIT,
    result: null,
    evidence: ['tests/browser-gates.mjs', 'tools/browser-lane.mjs'],
    reason,
    tool: 'tests/browser-gates.mjs',
    ...(at ? { commit: null, commitReason: 'selftest', at } : {})
  });
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
  eq(green.status === 'PASS' && green.population.checked === 5 && green.result.filtered === false, true, '§3d · five clean legs ⇒ PASS over 5/5');
  const red = browserGatesVerdict([L(LEGS[0], ['Dex-Test-Suite RED — 2 failing']), L(LEGS[1]), L(LEGS[2]), L(LEGS[3]), L(LEGS[4])], AT);
  eq(red.status === 'FAIL' && /Dex-Test-Suite/.test(red.reason), true, '§3d plant · a red leg ⇒ FAIL, named');
  const mob = browserGatesVerdict([L(LEGS[0]), L(LEGS[1]), L(LEGS[2]), L(LEGS[3]), L(LEGS[4], ['mobile-viewport: index.html needs 732 px at a 375 px device'])], AT);
  eq(mob.status === 'FAIL' && /375 px device/.test(mob.reason), true, '§3d plant · a red mobile-viewport leg ⇒ FAIL, the page and the width named');
  const crashed = browserGatesVerdict([L(LEGS[0], [], 'Error: page crashed'), L(LEGS[1]), L(LEGS[2]), L(LEGS[3]), L(LEGS[4])], AT);
  eq(crashed.status === 'UNKNOWN' && /page crashed/.test(crashed.reason), true, '§3d plant · a leg that THREW ⇒ UNKNOWN (it decided nothing), never green');
  const nn = browserGatesVerdict([L(LEGS[2])], { ...AT, selectedBy: 'NN_ONLY=1' });
  eq(
    nn.status === 'PASS' && nn.result.filtered === true && nn.result.excludedBy === 'NN_ONLY=1' && JSON.stringify(nn.population) === JSON.stringify({ checked: 1, eligible: 5, excluded: 4 }),
    true,
    '§3d plant · NN_ONLY ⇒ a declared exclusion: PASS over 1/5, filtered'
  );
  eq(/NOT the gate/.test(nn.result.consumerRule || ''), true, '§3d plant · …with the consumer rule');
  const mobOnly = browserGatesVerdict([L(LEGS[4])], { ...AT, selectedBy: 'MOBILE_ONLY=1' });
  eq(
    mobOnly.status === 'PASS' && mobOnly.result.excludedBy === 'MOBILE_ONLY=1' && JSON.stringify(mobOnly.population) === JSON.stringify({ checked: 1, eligible: 5, excluded: 4 }),
    true,
    '§3d plant · MOBILE_ONLY ⇒ a declared exclusion: PASS over 1/5, filtered'
  );
  const missing = browserGatesVerdict([L(LEGS[0]), L(LEGS[1]), L(LEGS[2]), L(LEGS[4])], AT);
  eq(
    missing.status === 'UNKNOWN' && /night-seal/.test(missing.reason) && missing.population.excluded === 1,
    true,
    '§3d plant · a leg missing with NO selector ⇒ an unplanned NOT_RUN: UNKNOWN, the leg named, counted excluded'
  );
  eq(browserGatesVerdict([], AT).status, 'NOT_RUN', '§3d plant · nothing ran ⇒ NOT_RUN');
  eq(verdictSample().status === 'PASS' && verdictSample().producedBy.commit === null, true, '§3d · --verdict-sample: five scratch legs ⇒ PASS, no commit');
  /* ── the browser skip budget · row 2026-11-08-the-browser-lane-has-no-skip-budget ───────────── */
  const CFG = { budget: 3, reasonClasses: ['Node-lane only', 'browser lane cannot'], reasonInNameOnly: 1 };
  const row = (test, detail) => ({ group: 'G', test, detail });
  const cen = (rows) => ({ floorGroups: 900, rcGroups: 12, rows });
  const AT_CEIL = [row('a', 'Node-lane only — fs'), row('b', 'browser lane cannot import tools/x.mjs'), row('Y not in env — Node-lane only', '')];
  eq(auditBrowserSkips(cen(AT_CEIL), CFG).length, 0, 'skip budget · at the ceiling, every reason declared, one reason-in-name ⇒ clean');
  const over = auditBrowserSkips(cen([...AT_CEIL, row('d', 'Node-lane only — fs')]), CFG);
  eq(
    over.length === 1 && /4 skips over 900 headless-floor groups, above the declared budget of 3/.test(over[0]),
    true,
    'skip budget plant · ONE skip over the ceiling ⇒ FAIL, the count and the budget named'
  );
  eq(auditBrowserSkips(cen([row('a', 'Node-lane only — fs')]), CFG).length, 0, 'skip budget · UNDER the ceiling is clean — a corpus-bearing checkout runs the corpus legs and the count falls');
  const novel = auditBrowserSkips(cen([row('a', 'a reason nobody declared')]), CFG);
  eq(novel.length === 1 && /no `browserLane.reasonClasses` entry declares/.test(novel[0]), true, 'skip budget plant · a NOVEL reason UNDER the ceiling ⇒ FAIL (the swap a count cannot see)');
  const inname = auditBrowserSkips(cen([row('p — Node-lane only', ''), row('q — browser lane cannot x', '')]), CFG);
  eq(inname.length === 1 && /carry the reason in the NAME/.test(inname[0]), true, 'skip budget plant · a SECOND reason-in-name skip ⇒ FAIL, the legs named');
  eq(auditBrowserSkips(null, CFG).length, 1, 'skip budget · an unreadable census FAILS — it examined nothing');
  eq(/no readable `browserLane` budget/.test(auditBrowserSkips(cen([]), null)[0]), true, 'skip budget · a lost budget block FAILS CLOSED, as run-tests.mjs does with the allow-list');
  eq(/no readable `browserLane` budget/.test(auditBrowserSkips(cen([]), { budget: 3, reasonClasses: ['x'] })[0]), true, 'skip budget · a budget block with no `reasonInNameOnly` is not a budget');
  eq(
    BROWSER_LANE !== null && typeof BROWSER_LANE.budget === 'number' && BROWSER_LANE.reasonClasses.length > 0,
    true,
    'skip budget · the SHIPPED block in tests/expected-skips.json is readable and non-empty'
  );
  /* ── the origin preflight · every arm planted with no server and no browser ──────────────────── */
  const pfUrl = 'http://127.0.0.1:8080/Dex-Test-Suite.html';
  eq(diagnoseOrigin({ url: pfUrl, status: 200, body: '<script>window.__rcState = "pending";</script>' }).ok, true, 'preflight · a 200 holding the polled symbol is reach');
  const pfOther = diagnoseOrigin({ url: pfUrl, status: 200, body: '{"service":"xerj","ok":true}' });
  eq(pfOther.ok === false && /another service holds that port/.test(pfOther.reason), true, 'preflight plant · a 200 from an unrelated service is NOT reach, and the reason says which port');
  eq(/28 byte\(s\)/.test(pfOther.reason), true, 'preflight plant · the reason states the size of what answered, so a stub is distinguishable from a page');
  const pfMissing = diagnoseOrigin({ url: pfUrl, status: 404 });
  eq(pfMissing.ok === false && /answered HTTP 404/.test(pfMissing.reason), true, 'preflight plant · a 404 names the status the gate got');
  const pfDead = diagnoseOrigin({ url: pfUrl, error: 'fetch failed: ECONNREFUSED' });
  eq(pfDead.ok === false && /ECONNREFUSED/.test(pfDead.reason) && pfDead.reason.includes(pfUrl), true, 'preflight plant · a refused connection names the error AND the URL');
  eq(
    [pfOther, pfMissing, pfDead].every((d) => /gates:browser:local/.test(d.reason)),
    true,
    'preflight · every refusal names the one command that serves the tree'
  );
  /* ANTI-VACUITY. A marker absent from the served page would make the preflight refuse every run,
     and a marker nothing polls would make it pass a page the first leg cannot use. Both are read
     from the tree, not asserted: the page must hold the symbol, and this file must poll it. */
  const pfSuite = readFileSync(new URL('../Dex-Test-Suite.html', import.meta.url), 'utf8');
  eq(pfSuite.includes(ORIGIN_MARKER), true, `preflight anti-vacuity · Dex-Test-Suite.html holds ${ORIGIN_MARKER}, so reach is satisfiable`);
  const pfSelf = readFileSync(new URL('./browser-gates.mjs', import.meta.url), 'utf8');
  eq(pfSelf.includes('window.' + ORIGIN_MARKER + " === 'done'"), true, 'preflight anti-vacuity · the marker is the symbol the first leg polls, not a second contract');
  const pfNr = originNotRunVerdict('nothing answered', AT.at);
  eq(pfNr.status === 'NOT_RUN' && pfNr.population.checked === 0 && pfNr.population.excluded === pfNr.population.eligible, true, '§🧾 · an unreached origin is NOT_RUN over 0 of 5 checked');
  eq(pfNr.reason === 'nothing answered' && pfNr.result === null, true, '§🧾 · the NOT_RUN object carries the reason, and no result, because nothing was examined');
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
/* ── `--label <text>` (REPEATABLE): PROVE A NAMED ASSERTION ACTUALLY RAN ──────────────────────────
   A green summary does not distinguish "passed" from "never executed", and this lane's own history is
   the reason: a source-scan gate whose file is wired into only ONE lane reads nothing in the other and
   still reports green (#816, 5316 passed / 1 failing against 5494/5494 in node). Sessions have been
   hand-rolling this check by re-opening the page in a scratch script — twice on 2026-09-27 alone, once
   with a stale absolute path that produced a stack trace where a verdict should have been. Asking here
   costs one array inside an evaluate the gate already makes.
   Matched against the assertion NAME nodes by structure (`div.test .name`), the same discipline the
   failure listing below documents — never against a glyph or the whole body text, which also matches
   the app UIs the render-coverage rigs boot in iframes. */
const LABELS = ARGV.reduce((acc, a, i) => (a === '--label' && ARGV[i + 1] ? acc.concat(ARGV[i + 1]) : acc), []);
const say = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a)); // --json: stdout carries ONE object

const { chromium } = await import('playwright');
const { launch } = await import('../tools/pw-launch.mjs');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
/* The reach test runs BEFORE Chromium launches: an origin that holds no page of ours costs no browser
   and reports NOT_RUN, which is the state the old run printed as `verdict never computed`. */
const PREFLIGHT_URL = BASE + '/Dex-Test-Suite.html';
const origin = await (async () => {
  try {
    const res = await fetch(PREFLIGHT_URL, { signal: AbortSignal.timeout(15000) });
    return diagnoseOrigin({ url: PREFLIGHT_URL, status: res.status, body: await res.text() });
  } catch (e) {
    return diagnoseOrigin({ url: PREFLIGHT_URL, error: (e && e.message) || String(e) });
  }
})();
if (!origin.ok) {
  const v = originNotRunVerdict(origin.reason);
  if (JSON_OUT) console.log(JSON.stringify(v));
  else say(`  tepna.verdict/1: ${v.status}  ·  ${v.population.checked} checked / ${v.population.eligible} eligible / ${v.population.excluded} excluded`);
  console.error('\n⏱ BROWSER GATES NOT RUN — ' + origin.reason);
  process.exit(2);
}
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
  } catch {
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
  const r = await page.evaluate(
    (labels) => ({
      /* The labels are tested IN the page: a run carries ~9.7 k assertion names (9731 measured 2026-09-27) and marshalling them all
       back to compare here would cost more than the gate. Booleans cross the boundary, not the corpus. */
      labelHits: labels.map((l) => Array.from(document.querySelectorAll('div.test .name')).some((d) => (d.textContent || '').indexOf(l) >= 0)),
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
      failTotal: document.querySelectorAll('div.test.no').length,
      /* THE SKIP CENSUS, sliced at the suite's OWN marker: `window.__headlessCount` is where the
         shared groups end and render-coverage begins (Dex-Test-Suite.html sets it once the floor
         finishes). Render-coverage's own skips are environmental — a cold-boot iframe, a budget
         stall — and already reported as `bootSkips`, so they are counted and EXCLUDED here rather
         than budgeted, which would red a slow runner on wall-clock. 197 rows cross the boundary,
         not the ~9.7 k assertion names the labels check deliberately keeps in the page. */
      skips: (() => {
        if (typeof ALL_GROUPS === 'undefined' || !ALL_GROUPS) return null;
        const floor = typeof window.__headlessCount === 'number' ? window.__headlessCount : ALL_GROUPS.length;
        const rows = [];
        ALL_GROUPS.slice(0, floor).forEach((G) => {
          (G.tests || []).forEach((t) => {
            if (t.skip) rows.push({ group: G.title, test: t.name, detail: t.detail == null ? '' : String(t.detail) });
          });
        });
        return { floorGroups: floor, rcGroups: ALL_GROUPS.length - floor, rows };
      })(),
      /* The rows above are only as complete as the page's markup. Before the suite escaped its
         names, an unclosed `<script …>` inside one detail turned every later row into script text:
         4633 of 13198 rows rendered, and a failing row past the break had no element to name
         (RESIDUE 2026-10-19-the-browser-gate-counts-a-failure-it-cannot-name). `ALL_GROUPS` is the
         suite's top-level `let`, the same in-memory list its pill counts from. */
      rowsRendered: document.querySelectorAll('#results div.test').length,
      rowsInMemory: typeof ALL_GROUPS === 'undefined' ? null : ALL_GROUPS.reduce((a, G) => a + G.tests.length, 0)
    }),
    LABELS
  );
  if (r.rowsInMemory !== null && r.rowsRendered !== r.rowsInMemory) {
    FAILS.push('Dex-Test-Suite rendered ' + r.rowsRendered + ' of ' + r.rowsInMemory + ' test rows — a title, name or detail broke the page markup, so a failure past the break cannot be named here');
  }
  say('   summary:', r.summary + (r.bootSkips.length ? '   [boot-skips: ' + r.bootSkips.join(', ') + ']' : ''));
  if (r.skips) {
    const slack = BROWSER_LANE && typeof BROWSER_LANE.budget === 'number' ? BROWSER_LANE.budget - r.skips.rows.length : null;
    say(
      '   browser skips:',
      r.skips.rows.length +
        ' of budget ' +
        (BROWSER_LANE && typeof BROWSER_LANE.budget === 'number' ? BROWSER_LANE.budget : '(none declared)') +
        ' over ' +
        r.skips.floorGroups +
        ' headless-floor groups (' +
        r.skips.rcGroups +
        ' render-coverage groups excluded)' +
        (slack > 0 ? ' — ' + slack + ' under; a corpus-bearing checkout runs legs CI cannot, so lower the budget only from a corpus-free tree' : '')
    );
  }
  auditBrowserSkips(r.skips, BROWSER_LANE).forEach((f) => FAILS.push('Dex-Test-Suite skip budget — ' + f));
  say('   rows rendered:', r.rowsRendered + ' of ' + (r.rowsInMemory === null ? '(ALL_GROUPS unreadable)' : r.rowsInMemory));
  r.failures.forEach((f) => say('   ✕', f));
  if (r.failTotal > r.failures.length) say('   … and ' + (r.failTotal - r.failures.length) + ' more (listing capped at 25)');
  if (r.hasFail) FAILS.push('Dex-Test-Suite RED — ' + r.summary + (r.failures.length ? '\n     ' + r.failures.join('\n     ') : ''));
  /* AN ABSENT LABEL IS A FAILURE, not a note: the caller asked whether a named assertion ran, and "it did
     not" is the answer that matters — a lane that stayed green while the assertion never executed is the
     exact state this flag exists to refuse. Present labels are reported too, so the check is visible when
     it passes rather than only when it bites. */
  LABELS.forEach((l, i) => {
    if (r.labelHits[i]) say('   ✓ label ran: ' + l);
    else FAILS.push('--label "' + l + '" matched NO assertion name in the run — it did not execute in this lane (a green summary does not say it did)');
  });
  await page.close();
}

/* ── Gate 2 · verify-provenance (build manifest + fixture audit) ──────────── */
async function gateProvenance() {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('   [provenance page error]', e.message));
  say('▸ verify-provenance.html …');
  await page.goto(BASE + '/verify-provenance.html', { waitUntil: 'load', timeout: 60000 });
  /* ── WAIT ON THE DECLARED COUNT, NOT A LITERAL (2026-09-27) ─────────────────────────────────────
     This waited for `rows >= 8` and its message said "all 8 bundles", while GATE A's population is NINE
     (`manifest-gate.js MANIFEST_BUNDLES`: 8 apps + Integrator.html). Two records of one number, and they
     had already drifted apart.

     🔴 THIS IS HYGIENE, NOT A DEFECT THAT LET SOMETHING THROUGH, and the distinction is recorded because
     I first believed the opposite. The rows come from `MANIFEST_BUNDLES` itself, never from the assembled
     ledger, so the count is 9 whatever the provenance fragments do — the floor was not a path to a false
     pass. I had reasoned that a dropped fragment would leave 8 rows and satisfy `>= 8`; measured in
     Chrome against the UNCHANGED page with one fragment moved away, the flags read
     `{gateA_ok:false, provOK:false, badPills:1, rows:9}`, because `gateACompare` scores an absent
     committed hash as `missing-committed` and `ok` requires `missing === 0`. The page already refuses.
     What is fixed here is only that the wait and the message no longer carry a stale literal. */
  const DECLARED_BUNDLES = ManifestGate.MANIFEST_BUNDLES.length;
  if (DECLARED_BUNDLES < 9) FAILS.push('verify-provenance: MANIFEST_BUNDLES reports only ' + DECLARED_BUNDLES + ' bundles — refusing to wait on a population that small rather than trusting it');
  try {
    await page.waitForFunction((n) => document.querySelectorAll('#manifest tbody tr').length >= n, DECLARED_BUNDLES, { timeout: 180000 });
  } catch {
    const got = await page.evaluate(() => document.querySelectorAll('#manifest tbody tr').length).catch(() => 'unknown');
    FAILS.push('verify-provenance: build manifest populated ' + got + ' of ' + DECLARED_BUNDLES + ' declared bundles');
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
      ' modules (' +
      s.workerTargets +
      ' worker target(s), ' +
      s.workerUnreadable +
      ' unreadable, ' +
      s.strippedTransport +
      ' served-only transport, ' +
      s.modulesExcluded +
      ' excluded), ' +
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
        ')' +
        /* Name the hits. A count alone sends the reader back to the browser to find them. */
        (s.staticRemoteList && s.staticRemoteList.length ? '\n     static: ' + s.staticRemoteList.join('\n     static: ') : '') +
        (s.workerUnreadableList && s.workerUnreadableList.length ? '\n     unreadable worker target: ' + s.workerUnreadableList.join('\n     unreadable worker target: ') : '') +
        (s.stripProofFailList && s.stripProofFailList.length ? '\n     unproved strip: ' + s.stripProofFailList.map((f) => f.page + ' — ' + f.why).join('\n     unproved strip: ') : '')
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

/* ── Gate 5 · mobile-viewport — THE PHONE-WIDTH FLOOR ────────────────────────────────────────────
   Every other leg runs in the one 1280 x 1600 context above. Row
   `2026-11-08-no-gate-renders-a-phone-viewport` measured what that costs: no gate rendered any
   surface at a phone width, and the July audit's own overflow check was blind.
   `scrollWidth - innerWidth` reads 0 on a page that overflows. A page carrying
   `<meta name="viewport" content="width=device-width">` GROWS its layout viewport to fit wide
   content, so `innerWidth` becomes the content width and the difference cancels. All three
   page-width defects that row cites read clean under it.

   Measured 2026-11-09 over the twelve pages below, each at 375 px:
     · `isMobile: true`  — index.html reads innerWidth 732, CPAPDex.html 522, the other ten read 375.
     · `isMobile: false` — every page reads 375 and the growth is invisible.
   Chromium honours the meta viewport only under mobile emulation, so that flag IS the leg.

   THE INVARIANT: `innerWidth` equals the device width, so the layout viewport did not grow.

   THE BASELINE IS A SET OF NAMES, NEVER A SET OF WIDTHS, and it may only SHRINK. A page outside it
   that grows reds. A page inside it that stops growing reds too, so a fix must delete its entry.
   The baseline is now EMPTY, because every owned page holds at the device width. An empty baseline
   carries no anti-vacuity proof, so the leg plants its own control below: a 900 px box on a page
   the leg itself writes. Emulation that stopped applying reads 375 for that box and reds, rather
   than passing silently over twelve pages it never really constrained.
   A width is logged and never asserted. The rig and the CI runner fall back to different system
   faces, because the repo ships no webfont, so a page's content width need not match across the
   two. One thing this leg therefore cannot see is a baselined page getting WORSE. */
const MOBILE_W = 375;
/* The nine GATE A bundles come from manifest-gate.js. tools/build.mjs declares the two
   orchestrators as `ORCHESTRATORS` and exports nothing, so their names sit here. `index.html` is
   the landing page, which holds at the device width since the nav wrapped below 880 px. */
const MOBILE_ORCHESTRATORS = ['Data Unifier.html', 'OverDex.html'];
const MOBILE_PAGES = [...ManifestGate.MANIFEST_BUNDLES, ...MOBILE_ORCHESTRATORS, 'index.html'];
const MOBILE_OVERFLOW_BASELINE = [];

async function gateMobileViewport() {
  say(`▸ mobile-viewport · ${MOBILE_PAGES.length} pages at ${MOBILE_W} px, mobile emulation …`);
  const mctx = await browser.newContext({ viewport: { width: MOBILE_W, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    /* THE CONTROL. A 900 px box on a page this leg writes itself. Under mobile emulation the layout
       viewport grows to hold it, so `innerWidth` reads well over MOBILE_W. Without the emulation the
       viewport stays at MOBILE_W and this reds — which is the only thing standing between an empty
       baseline and a leg that asserts nothing. */
    const ctlPage = await mctx.newPage();
    await ctlPage.setContent('<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0"><div style="width:900px;height:20px"></div></body>');
    const ctlIw = await ctlPage.evaluate(() => window.innerWidth);
    await ctlPage.close();
    say(`   · control · a 900 px box reads innerWidth ${ctlIw}`);
    if (ctlIw <= MOBILE_W)
      FAILS.push(`mobile-viewport: the control planted a 900 px box and innerWidth stayed ${ctlIw}, so the mobile emulation did not apply and every page below passed over nothing`);
    for (const p of MOBILE_PAGES) {
      const page = await mctx.newPage();
      let m = null;
      try {
        await page.goto(`${BASE}/${encodeURI(p)}`, { waitUntil: 'load', timeout: 60000 });
        m = await page.evaluate((dev) => {
          /* An element counts as wide by its RECT or by its own `scrollWidth`: CPAPDex's card holds a
             table whose rect is clipped to the device while its content is 522 px, and a scan that
             read rects alone named nothing on the one page whose defect is a defeated scroller. */
          const over = [];
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            const w = Math.max(b.width, el.scrollWidth || 0);
            if (w > dev + 1 && (b.height > 0 || (el.scrollWidth || 0) > dev + 1)) over.push({ el, w });
          }
          /* NAME THE INNERMOST OFFENDERS. Every container of a wide element is wide too, so a list
             sorted by width hands the reader `BODY` and `DIV#app` and never the cause. An element
             whose own children all fit IS the cause. */
          const set = new Set(over.map((o) => o.el));
          const leaves = over.filter((o) => ![...o.el.children].some((c) => set.has(c)));
          const name = (el) => {
            const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
            return `${el.tagName}${el.id ? `#${el.id}` : ''}${cls}`;
          };
          return { iw: window.innerWidth, nOver: over.length, wide: leaves.slice(0, 3).map((o) => `${name(o.el)}(${Math.round(o.w)})`) };
        }, MOBILE_W);
      } catch (e) {
        /* A page that did not render is COUNTED and named, never passed over (CLAUDE.md §∅). */
        FAILS.push(`mobile-viewport: ${p} did not render at ${MOBILE_W} px — ${((e && e.message) || String(e)).split('\n')[0]}`);
      }
      await page.close();
      if (!m) continue;
      const listed = MOBILE_OVERFLOW_BASELINE.includes(p);
      /* The offender list prints only for a page that GREW. A page holding at the device width can
         still hold a wide element on purpose: HRVDex's phone nav strip measures 725 px inside a
         375 px viewport and scrolls there. Printing those beside a pass reads as a defect. */
      const grew = m.iw !== MOBILE_W;
      say(`   ${grew ? '!' : '·'} ${p} innerWidth ${m.iw}${listed ? ' (baselined)' : ''}${grew && m.wide.length ? ` — ${m.wide.join(' ')} of ${m.nOver} wide` : ''}`);
      if (m.iw > MOBILE_W && !listed)
        FAILS.push(
          `mobile-viewport: ${p} needs ${m.iw} px at a ${MOBILE_W} px device, so its layout viewport grew and a phone draws it scaled or clipped. Widest: ${m.wide.join(' ') || `no single element over ${MOBILE_W} px`}`
        );
      if (m.iw === MOBILE_W && listed) FAILS.push(`mobile-viewport: ${p} now holds at ${MOBILE_W} px — delete it from MOBILE_OVERFLOW_BASELINE, which may only shrink`);
      if (m.iw < MOBILE_W) FAILS.push(`mobile-viewport: ${p} reads innerWidth ${m.iw} under a ${MOBILE_W} px device, which no layout produces — the emulation did not apply`);
    }
  } finally {
    await mctx.close();
  }
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
} else if (process.env.MOBILE_ONLY) {
  // MOBILE_ONLY=1 → just the phone-width census (12 page loads; for iterating on the baseline)
  selectedBy = 'MOBILE_ONLY=1';
  await leg(LEGS[4], gateMobileViewport);
} else {
  await leg(LEGS[0], gateTestSuite);
  await leg(LEGS[1], gateProvenance);
  await leg(LEGS[2], gateNoNetwork);
  await leg(LEGS[3], gateNightSeal);
  await leg(LEGS[4], gateMobileViewport);
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
say('\n✓ browser gates passed (render-coverage + provenance + no-network + night-seal + mobile-viewport)');
