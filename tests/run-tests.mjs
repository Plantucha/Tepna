#!/usr/bin/env node
/*
 * run-tests.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/run-tests.mjs — headless CI runner for the Tepna suite
   ────────────────────────────────────────────────────────────────────────
   Runs the SAME assertions as Dex-Test-Suite.html, with no browser, so
   GitHub Actions (or `node tests/run-tests.mjs` locally) can gate merges —
   the JS analogue of `python3 -m pytest`. Exit code 0 = all green, 1 = a
   failing assertion, 2 = a load/setup error. Zero npm dependencies: the
   browser modules are loaded into a `vm` sandbox with minimal window/
   document/localStorage shims.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { spawn, execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { walkRepoPaths } from './docs-ledger-fs.mjs';
import { planShards, partitionViolations, readTimings } from './shard-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* Corpus root (G1 · EFFICIENCY-AUDIT-FINDINGS-2026-07-12). The raw recordings under uploads/ are
   GITIGNORED (personal medical data), so a fresh clone — CI, and the worktree CLAUDE.md §👥 mandates —
   simply does not have them, and every leg that needs one degrades to a ⊘ SKIP. A skip is neither pass
   nor fail, so the gate goes GREEN having never run them: measured, CI verifies 2087 assertions and
   10 of 23 GATE-B fixtures where a full-corpus run does 2107 and 23/23.
   DEX_UPLOADS=<path> points the runner at a real corpus (e.g. the main checkout's uploads/ from inside
   a worktree), so the mandated workflow can run the gate it claims to run. It is ALSO how you reproduce
   CI's exact coverage locally — point it at a dir holding only the tracked fixtures. */
const UPLOADS = process.env.DEX_UPLOADS ? resolve(process.env.DEX_UPLOADS) : join(ROOT, 'uploads');

/* The declared skip budget (G1). Missing/corrupt file → an EMPTY allow-list, which means every skip is
   undeclared and the run reds — deliberately fail-closed: a lost allow-list must not silently re-open
   the door it was added to close. */
const EXPECTED_SKIPS = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'expected-skips.json'), 'utf8'));
  } catch (_) {
    return { allow: [] };
  }
})();
const require = createRequire(import.meta.url);
// shared with verify-manifest.mjs + verify-provenance.html — one projection, three consumers
const ManifestGate = require(join(ROOT, 'manifest-gate.js'));
// P3 — reassemble the per-app provenance/ fragments into the combined ledger shapes dex-tests.js parses.
const ProvenanceLedger = require(join(ROOT, 'provenance-ledger.js'));
// ESM-MIGRATION Phase 2 — classic-load ESM co-load modules (a converted DSP) into the shared vm realm.
const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);

/* Section filter (SECTION-SCOPED-RUNS 2026-07-01): `node tests/run-tests.mjs --group=oxydex`
   (aliases -g / --only, or the DEX_GROUP env var) runs ONLY the groups whose title/tag match
   (comma = OR, regex-or-substring, via the shared dexGroupMatcher). A filtered run is a DEV
   CONVENIENCE, never the canonical CI gate — it prints a loud banner and the unfiltered run stays
   the merge gate. */
const GROUP_FILTER = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?(?:group|g|only)=(.+)$/i);
    if (m) return m[1];
    if (/^--?(?:group|g|only)$/i.test(a[i]) && a[i + 1]) return a[i + 1];
  }
  return process.env.DEX_GROUP || process.env.DEX_GROUPS || '';
})();

/* CI shard (CI-SHARDING): `node tests/run-tests.mjs --shard=1/4` (or DEX_SHARD=1/4) runs only the
   groups whose DECLARATION INDEX ≡ (shard-1) mod 4 — 1-based on the CLI (`1/4`..`4/4`) because a CI
   matrix reads naturally 1-based; converted to 0-based for dexShardSelector. Unlike --group, a
   sharded run IS part of the canonical gate: every group lands in exactly one shard, so the union of
   all N shards is the full suite (proven by tests/verify-shard-union.mjs, which CI runs). */
const SHARD = (() => {
  const a = process.argv.slice(2);
  let raw = '';
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?shard=(.+)$/i);
    if (m) raw = m[1];
    else if (/^--?shard$/i.test(a[i]) && a[i + 1]) raw = a[i + 1];
  }
  raw = raw || process.env.DEX_SHARD || '';
  if (!raw) return null;
  const m = String(raw).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) {
    console.error(`✗ bad --shard "${raw}" — want i/N, 1-based (e.g. 1/4)`);
    process.exit(2);
  }
  const index = Number(m[1]) - 1,
    total = Number(m[2]);
  if (total < 1 || index < 0 || index >= total) {
    console.error(`✗ bad --shard "${raw}" — need 1 ≤ i ≤ N`);
    process.exit(2);
  }
  return { index, total, label: `${index + 1}/${total}` };
})();

const SHOW_TIMINGS = process.argv.slice(2).some((s) => /^--?timings?$/i.test(s)) || !!process.env.DEX_TIMINGS;

/* --quiet / -q (D3 · EFFICIENCY-AUDIT-FINDINGS-2026-07-12): collapse the full per-assertion tree —
   print a header + assertions ONLY for failing groups, and always a trailing FAILURES recap. A red
   run otherwise emits ~169 KB and names the failure once, mid-log, so `| tail` yields nothing
   actionable. Default-ON in CI (env CI); --verbose / --no-quiet forces the full tree even in CI. */
const QUIET = (() => {
  const a = process.argv.slice(2);
  if (a.some((s) => /^--?(verbose|no-quiet)$/i.test(s))) return false;
  if (a.some((s) => /^--?(quiet|q)$/i.test(s))) return true;
  return !!process.env.CI;
})();
/* --list: declare every group, execute NONE (inventory only, ~0 s) — the cheap input to the
   shard-partition proof. --json: emit machine-readable results instead of the human report; it is
   what verify-shard-union.mjs --deep diffs full-run vs shard-union with. */
/* --jobs=N (D1 · EFFICIENCY-AUDIT-FINDINGS-2026-07-12): fork N children over the SAME shard plan CI
   uses and merge their verdicts. The partition proof (tests/verify-shard-union.mjs) already guarantees
   the union of the shards IS the full gate, so this is the full gate — just on all your cores. The
   suite was still single-threaded locally (102 s on 1 of 6 cores) while CI finished in 78 s: your
   laptop was slower than CI at the same work. `--jobs` (or `npm run test:par`) closes that.
   N defaults to the CI shard count; --jobs=auto sizes to the machine. */
const JOBS = (() => {
  const a = process.argv.slice(2);
  let raw = '';
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?jobs?=(.+)$/i);
    if (m) raw = m[1];
    else if (/^--?jobs?$/i.test(a[i])) raw = a[i + 1] && /^\d+$/.test(a[i + 1]) ? a[i + 1] : 'auto';
  }
  raw = raw || process.env.DEX_JOBS || '';
  if (!raw) return 0;
  if (/^auto$/i.test(raw)) return Math.max(2, Math.min(8, cpus().length - 1));
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`✗ bad --jobs "${raw}" — want a positive integer, or "auto"`);
    process.exit(2);
  }
  return n;
})();

const LIST_ONLY = process.argv.slice(2).some((s) => /^--?list$/i.test(s));
const AS_JSON = process.argv.slice(2).some((s) => /^--?json$/i.test(s));

/* ── 1 · build a browser-ish sandbox and load the real modules ───────────── */
function makeSandbox() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const documentStub = {
    getElementById: () => null,
    createElement: el,
    createTextNode: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
    head: el(),
    body: el(),
    documentElement: el(),
    addEventListener: noop,
    readyState: 'complete'
  };
  const store = new Map();
  const localStorageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = documentStub;
  sandbox.localStorage = localStorageStub;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  return vm.createContext(sandbox);
}

function loadInto(ctx, file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) throw new Error('module not found: ' + file);
  // ESM-MIGRATION Phase 2: a converted co-load DSP (glucodex-dsp.js) ships top-level import/export the
  // shared vm realm can't eval. classicify() sheds the module syntax (the IIFE + window attaches remain),
  // so the DSP loads exactly as before. No-op on classic files, so it is safe to run on every module.
  const code = DexBuild.classicify(readFileSync(p, 'utf8'));
  vm.runInContext(code, ctx, { filename: file });
}

/* ── 2 · gather sources (static checks) and fixtures (export completeness) ── */
function readSources() {
  const wanted = [
    'clock.js',
    'oxydex-util.js',
    'pulsedex-dsp.js',
    'oxydex-dsp.js',
    'hrvdex-dsp.js',
    'integrator-dsp.js',
    'ppgdex-dsp.js',
    'glucodex-dsp.js',
    'ecgdex-dsp.js',
    'ecgdex-cross.js',
    'oxydex-cross.js',
    'pulsedex-cross.js',
    'ppgdex-cross.js',
    'cpapdex-cross.js',
    'crossnight-envelope.js',
    'integrator-app.js',
    'integrator-render.js',
    'ecgdex-app.js',
    'ppgdex-app.js',
    'pulsedex-app.js',
    'pulsedex-render.js',
    'hrvdex-app.js',
    'oxydex-app.js',
    'oxydex-render.js',
    'oxydex-fusion.js',
    'dex-escape.js',
    'dex-forget.js',
    'dex-actions.js',
    'dex-profile.js',
    // FIXTURE-VERIFICATION-GATE §2 — the fixture-verification group SCANS these two. build.mjs must
    // NEVER write `verifiedUnder` (it does not run the app, so it cannot know that a fixture still
    // reproduces — auto-writing that claim is exactly how a stale GlucoDex fixture shipped to users).
    // verify-fixtures.mjs is the only tool allowed to author it, and only after a green real run.
    'tools/build.mjs',
    'tools/verify-fixtures.mjs',
    'manifest-gate.js',
    'sensor-trio-worker.js',
    'sensor-trio-power-analysis.js',
    'sensor-trio-gpu.js',
    'hrvdex-render.js',
    'signal-orchestrate.js',
    'dex-ingest.js',
    'cpapdex-dsp.js',
    'cpapdex-edf.js',
    'cpapdex-app.js',
    'cpapdex-fusion.js',
    'ecgdex-morph.js',
    'ppgdex-morph.js',
    // TEST-COVERAGE-FOLLOWUPS-II §4 — worker SOURCE text for the reconstruction rig (a real Worker file,
    // not a blob): the rig evals it in a `new Function` realm with deps passed as params + drives init/job.
    'qrs-equiv-worker.js',
    'qrs-yield-worker.js',
    'dex-export.js',
    'ganglior-provenance.js',
    'signal-frame.js',
    'glucodex-render.js',
    'glucodex-app.js',
    'cpapdex-render.js',
    'pulsedex-overview.js',
    'ecgdex-profile.js',
    'glucodex-profile.js',
    'ppgdex-profile.js',
    'overdex-app.js',
    // TEST-COVERAGE-ANALYSIS 2026-07-15 — the analysis-page controllers, so the statistics-kernel
    // group can assert each one delegates to AnalysisStats (delegation-parity leg).
    'analysis-stats.js',
    'nights-icc-analysis.js',
    'sigma-no-reference-analysis.js',
    'cgm-hrv-coupling-analysis.js',
    'treatment-response-analysis.js',
    'odi-bias-analysis.js',
    'hrv-confound-analysis.js'
  ];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  return out;
}

// manifests (raw text) for the §6 well-formed structural assertion (ECG-INGEST-FOLLOWUPS). The same
// files verify-provenance.html GATE A/B read; a parse failure here is a RED CI test (and a visible
// hard-fail on the verify page), closing the silent-degradation gap a stray-quote corruption caused.
function readManifests() {
  const out = {};
  try {
    // P3: the two ledgers now live as per-app provenance/ fragments; reassemble the combined shape
    // (byte-equivalent at the parsed level to the retired monoliths) under the same env keys, so the
    // structural well-formed assertions in dex-tests.js are unchanged.
    const led = ProvenanceLedger.loadNode({ readFileSync }, { join }, ROOT);
    out['BUILD-MANIFEST.json'] = JSON.stringify(led.buildManifest, null, 2);
    out['FIXTURE-PROVENANCE.json'] = JSON.stringify(led.fixtureProvenance, null, 2);
  } catch (_e) {
    /* leave absent → the "Manifest JSON well-formed" group flags the missing/broken ledger */
  }
  return out;
}

/* FIXTURE-VERIFICATION-GATE §1 — the computeHash discrimination probe.
   computeHash is manifestHash's projection over the export's COMPUTE CLOSURE, so a display edit must NOT
   move it and a DSP edit MUST. That is the entire premise of "export-inert is a computed value, not a
   claim" — so it is self-tested on synthetic bundles rather than trusted. The hashes are async
   (crypto.subtle) while the assertion harness is sync, so the probe is computed here and asserted there. */
async function readComputeHashProbe() {
  const MG = ManifestGate;
  if (!MG || typeof MG.computeHashFromText !== 'function') return null;
  const mk = (dsp, render) =>
    '<script data-inline-src="kernel-constants.js">var K=1;</script>' +
    `<script data-inline-src="glucodex-dsp.js">${dsp}</script>` +
    `<script data-inline-src="glucodex-render.js">${render}</script>` +
    '<style data-inline-src="ans-design.css">body{}</style>';
  const of = async (text) => ({ m: await MG.manifestHashFromText(text), c: await MG.computeHashFromText(text) });
  return {
    base: await of(mk('compute(1)', 'paint(1)')),
    render: await of(mk('compute(1)', 'paint(2)')), // display-only edit
    dsp: await of(mk('compute(2)', 'paint(1)')) // compute-path edit
  };
}

// demo-inputs gate (CPAP-REAL-CORPUS-FOLLOWUPS-II §3): the git-tracked path set, so the group can
// assert every uploads/ file a shipped demo fetches is committed (never a gitignored personal recording).
// `git ls-files` is the authority for "tracked"; a missing git (tarball checkout) → null → group SKIPs.
function readTrackedFiles() {
  try {
    const out = execSync('git ls-files -z', { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch (_) {
    return null;
  }
}

function readFixtures() {
  const dir = join(__dirname, 'fixtures');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      out[f.replace(/\.json$/, '')] = null;
      console.error(paint('  ! fixture parse error: ' + f + ' — ' + e.message, C.yellow));
    }
  }
  return out;
}

// -II §1 / -IV §3 equivalence gate: a committed raw INPUT + its committed ganglior-export
// fixture per node, so the suite can assert Node.compute(input) ≡ the shipped export.
// VI §1 extended this from OxyDex-only to PulseDex + HRVDex (the gate does the per-node
// input prep — PulseDex parses RR text first; OxyDex/HRVDex take {text}).
function readEquiv() {
  const out = {};
  // uploads/ raw INPUTS are gitignored (personal medical data — absent on a fresh CI clone); the
  // derived *.node-export.json FIXTURES are committed (tracked by exact name in .gitignore). Load
  // each half INDEPENDENTLY: a fixture-only consumer (e.g. the GlucoDex §3 integrator-ingest test)
  // still gets its committed fixture in CI, while the input+fixture equiv DIFF (needs both —
  // dex-tests.js's CASES loop) self-skips via T.skip when only the input half is missing. Coupling
  // them (the old behavior) silently starved the fixture-only consumers too, and made the diff
  // hard-FAIL instead of skip on a fresh CI clone.
  const pairFrom = (base, key, inFile, fixFile) => {
    const inP = join(base, inFile),
      // ⚠️ The FIXTURE always comes from the REPO, never from DEX_UPLOADS.
      //
      // A fixture is a COMMITTED repo artifact — the reference this checkout's code is being diffed
      // against. DEX_UPLOADS points at a corpus of gitignored RECORDINGS (often another checkout's
      // uploads/), and resolving the fixture there means diffing your code against SOMEONE ELSE'S
      // committed reference. That is not a weaker gate, it is a WRONG one: it produced a false FAILURE
      // the moment it was tried (a checkout one merge behind still had `metrics.mode:"APAP"` where HEAD
      // says `null`), and a checkout stale in the other direction would produce a false PASS.
      //
      // The same reasoning already fixed committed INPUTS (see pairCommitted below); fixtures were the
      // half that got missed. DEX_UPLOADS supplies RECORDINGS. It must never supply the ANSWER KEY.
      fxP = fixFile ? join(ROOT, 'uploads', fixFile) : null; // adversarial twins carry NO golden
    const rec = {};
    if (existsSync(inP)) {
      try {
        rec.input = readFileSync(inP, 'utf8');
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    if (fxP && existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    // WHICH committed fixture file this leg re-runs. Single-sourced here (the runner is the only
    // place that knows the filename) so the fixture-reproducibility gate can check the ledger's
    // code-gated set against the set that something actually reproduces, with no third list to drift.
    if (fixFile) rec.fixtureFile = fixFile;
    if (rec.input !== undefined || rec.fixture !== undefined) out[key] = rec;
  };
  const pair = (key, inFile, fixFile) => pairFrom(UPLOADS, key, inFile, fixFile);
  // A COMMITTED input is a repo artifact, not a recording: it lives in the checkout's uploads/ and is
  // there in every environment. Resolve it against ROOT so DEX_UPLOADS — which points at a REAL corpus —
  // cannot make it "absent" and turn a gate with teeth into an (undeclared, and now fail-closed) skip.
  const pairCommitted = (key, inFile, fixFile) => pairFrom(join(ROOT, 'uploads'), key, inFile, fixFile);
  pair('oxydex', 'O2Ring S 2100_20260612230016.csv', 'OxyDex_2026-06-13_1056_summary.json');
  // FIXTURE-REPRODUCIBILITY §1: OxyDex's SECOND committed summary was code-gated (it carries a
  // manifestHash claim) but nothing ever re-ran it — CLAUDE.md even says so in prose ("only _1056 has
  // an equiv leg, but _0439 shares the same code"), which is an instruction to a human, not a gate.
  // It has a leg now, so the claim is checked rather than asserted.
  pair('oxydex_0439', 'O2Ring S 2100_20260624222730.csv', 'OxyDex_2026-06-25_0439_summary.json');
  pair('pulsedex', 'Polar_H10_AAAAAAAA_20260613_204448_RR.txt', 'PulseDex_2026-06-25_equiv.node-export.json');
  pair('hrvdex', 'WELLTORY_HRV_DATA_EXPORT_20_May_2026_12_00_AM-17_Jun_2026_11_59_PM.csv', 'HRVDex_2026-06-25_equiv.node-export.json');
  // VII §2: event-byte-coverage cases (purpose-built inputs that emit ≥1 event of each impulse;
  // the equiv cases above carry empty ganglior_events).
  pair('hrvdex_events', 'HRVDex_2026-06-25_events.csv', 'HRVDex_2026-06-25_events.node-export.json');
  pair('pulsedex_events', 'PulseDex_2026-06-25_events_RR.txt', 'PulseDex_2026-06-25_events.node-export.json');
  // GlucoDex Phase-9 CGM leg (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES §1G): real Abbott Lingo vendor CSV.
  pair('glucodex', 'lingo-glucose-data-2026-MAY-23.csv', 'GlucoDex_2026-06-27_equiv.node-export.json');
  // PpgDex Phase-9 raw-PPG leg (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 2/4): real Polar Verity Sense *_PPG.txt.
  pair('ppgdex', 'Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt', 'PpgDex_2026-06-27_equiv.node-export.json');
  // ECGDex Phase-9 raw-ECG leg (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 3/4): real Polar H10 *_ECG.txt clip (~6 min, 130 Hz).
  pair('ecgdex', 'Polar_H10_AAAAAAAA_20260617_010615_ECG_clip.txt', 'ECGDex_2026-06-27_equiv.node-export.json');
  // ── P9: a SYNTHETIC, COMMITTED twin for every node above ─────────────────────────────────────
  // The pairs above use REAL recordings, which are gitignored — so on a fresh clone (i.e. in CI)
  // every one of their diffs ⊘ skips and the equivalence gate asserts NOTHING. These twins are
  // generated by tools/make-synthetic-inputs.mjs in the exact vendor format each parser expects,
  // carry no personal data, and are therefore COMMITTED — so the diff runs everywhere.
  // They ADD to the real legs (which still exercise genuine vendor quirks locally), never replace them.
  pair('oxydex_synth', 'synthetic_oxydex_o2ring.csv', 'synthetic_oxydex_golden.node-export.json');
  /* ADVERSARIAL twins (DEEP-AUDIT-2026-07-11 §1/§8/§9) — input only, NO golden. The point is not to pin
     bytes but to assert INVARIANTS the clean inputs cannot express: an MDY file must compute IDENTICALLY
     to its DMY twin; a dropped-row night must place every event on its OWN parsed stamp; a long night's
     window metrics must describe the whole night. See the dex-tests.js group. */
  pairCommitted('oxydex_dmy', 'synthetic_oxydex_o2ring_dmy.csv', null);
  pairCommitted('oxydex_mdy', 'synthetic_oxydex_o2ring_mdy.csv', null);
  pairCommitted('oxydex_lossy', 'synthetic_oxydex_o2ring_lossy.csv', null);
  pairCommitted('oxydex_longnight', 'synthetic_oxydex_o2ring_longnight.csv', null);
  pairCommitted('oxydex_odibasis', 'synthetic_oxydex_o2ring_gap.csv', null); // §5: a gap+artifact night that diverges the two ODI time bases
  pair('pulsedex_synth', 'synthetic_pulsedex_rr.txt', 'synthetic_pulsedex_golden.node-export.json');
  pair('hrvdex_synth', 'synthetic_hrvdex_welltory.csv', 'synthetic_hrvdex_golden.node-export.json');
  pair('glucodex_synth', 'synthetic_glucodex_lingo.csv', 'synthetic_glucodex_golden.node-export.json');
  pair('ppgdex_synth', 'synthetic_ppgdex_verity.txt', 'synthetic_ppgdex_golden.node-export.json');
  pair('ecgdex_synth', 'synthetic_ecgdex_h10.txt', 'synthetic_ecgdex_golden.node-export.json');
  // ADVERSARIAL GlucoDex twin — a COMMITTED 14 h sensor-change gap (FIXTURE-VERIFICATION-GATE-2026-07-14 §4).
  // The clean twin above trips NO FLAG.GAP_LONG, so nothing committed exercised the long-gap path — which is
  // exactly how DEEP-AUDIT-2026-07-14 §1 came back byte-identical on it, shipped as "export-inert", and left
  // the REAL Lingo night's fixture stale. pairCommitted (not pair): the input is a repo artifact, so it
  // resolves against ROOT/uploads and cannot be hidden by a DEX_UPLOADS override aimed at a real corpus —
  // same reasoning as the OxyDex adversarial twins.
  pairCommitted('glucodex_gap', 'synthetic_glucodex_lingo_gap.csv', 'synthetic_glucodex_gap_golden.node-export.json');

  // ── CPAPDex BINARY-EDF equivalence leg (CPAP-REAL-CORPUS-2026-07-11-BRIEF §P2) ──────────────
  // The fleet's FIRST equiv input that is actually COMMITTED — and therefore the first one whose
  // diff RUNS IN CI. Every leg above skips on a fresh clone: its input is a real recording, so it
  // is gitignored, so CI never executes the diff (read the ⊘ reasons). This input is SYNTHETIC
  // (tools/make-synthetic-edf.mjs — closed-form waveforms, no recording of any person, header
  // identity fields blank), so it ships in git and the gate has teeth in CI.
  //
  // It also retires the FIXTURE-PROVENANCE claim that CPAPDex "can't join" this gate because its
  // input is a binary multi-file EDF set: an input is just bytes, and readEDF takes an ArrayBuffer.
  {
    const KINDS = ['BRP', 'PLD', 'SA2', 'EVE', 'CSL'];
    const inp = {};
    let complete = true;
    for (const k of KINDS) {
      const p = join(UPLOADS, `20260613_231433_${k}.edf`);
      if (!existsSync(p)) {
        complete = false;
        break;
      }
      const b = readFileSync(p); // binary: no 'utf8'
      inp[k] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_edf_golden.node-export.json'); // fixture = repo artifact
    const rec = {};
    if (complete) rec.input = inp;
    if (existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    rec.fixtureFile = 'cpapdex_synthetic_edf_golden.node-export.json';
    if (rec.input !== undefined || rec.fixture !== undefined) out.cpapdex_edf = rec;
  }

  // ── CPAPDex REAL-EDF legs (FIXTURE-REPRODUCIBILITY §1) ──────────────────────────────────────
  // These two fixtures were CODE-GATED — each carries a `manifestHash` claiming "reproducible under
  // this code" — while NOTHING re-ran them. FIXTURE-PROVENANCE even said so out loud ("this real-EDF
  // fixture is NOT in the live equiv gate"), and `build.mjs` silently RE-STAMPED that claim onto a new
  // manifestHash every time the CPAPDex bundle moved. A reproducibility claim that nothing reproduces
  // is not provenance; it is decoration. They have legs now.
  //
  // Their inputs are REAL recordings (gitignored), so these skip on a fresh clone — exactly like every
  // other real-recording leg — and run locally where the EDFs exist. The synthetic twin above is what
  // gives CI its teeth; this is what makes the ledger's claim about THESE fixtures checkable at all.
  // A session = one stamped group of per-stream EDFs; a night may hold several (06-12 has two).
  const cpapReal = (key, sessions, fixFile) => {
    const sets = [];
    let complete = true;
    for (const sess of sessions) {
      const set = {};
      for (const [kind, file] of Object.entries(sess)) {
        const p = join(UPLOADS, file);
        if (!existsSync(p)) {
          complete = false;
          break;
        }
        const b = readFileSync(p); // binary
        set[kind] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
      if (!complete) break;
      sets.push(set);
    }
    const fxP = join(ROOT, 'uploads', fixFile); // fixture = repo artifact, never DEX_UPLOADS
    const rec = {};
    if (complete && sets.length) rec.input = sets;
    if (existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    rec.fixtureFile = fixFile;
    if (rec.input !== undefined || rec.fixture !== undefined) out[key] = rec;
  };
  cpapReal(
    'cpapdex_real_0612',
    [
      { BRP: '20260612_222830_BRP.edf', PLD: '20260612_222830_PLD.edf', SA2: '20260612_222830_SA2.edf', EVE: '20260612_222819_EVE.edf', CSL: '20260612_222819_CSL.edf' },
      { BRP: '20260613_045505_BRP.edf', PLD: '20260613_045505_PLD.edf', SA2: '20260613_045505_SA2.edf', EVE: '20260613_045457_EVE.edf', CSL: '20260613_045457_CSL.edf' }
    ],
    'cpapdex-2026-06-12.node-export.json'
  );
  cpapReal(
    'cpapdex_real_0616',
    [{ BRP: '20260616_213618_BRP.edf', PLD: '20260616_213618_PLD.edf', SA2: '20260616_213618_SA2.edf', EVE: '20260616_213611_EVE.edf', CSL: '20260616_213611_CSL.edf' }],
    'cpapdex-2026-06-16.json'
  );
  // CPAPDex GOLDEN reference (CPAPDEX-PHASE9-FOLLOWUPS-II §1): no INPUT file — the gate rebuilds the
  // deterministic synthetic night from CpapDsp._synthEdfSet in-code; only the committed golden EXPORT is
  // wired. (Retained: it pins the DECODED-set path, while cpapdex_edf above pins the BINARY-parser path.)
  {
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_golden.node-export.json'); // fixture = repo artifact
    if (existsSync(fxP)) {
      try {
        out.cpapdex_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')), fixtureFile: 'cpapdex_synthetic_golden.node-export.json' };
      } catch (e) {
        /* gate self-skips */
      }
    }
  }
  // CPAPDex MULTI-NIGHT GOLDEN (CPAPDEX-PHASE9-FOLLOWUPS-III §1): pins exportNight's >=3-night
  // crossnight-wrapper envelope (the only fixture exercising it, cpapdex-multi17, was retired in -I).
  // No INPUT file — the gate rebuilds >=3 deterministic day-shifted synthetic nights in-code (needs
  // env.CPAPCross / cpapdex-cross.js co-loaded above); only the committed golden EXPORT is wired.
  {
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_multinight_golden.node-export.json'); // fixture = repo artifact
    if (existsSync(fxP)) {
      try {
        out.cpapdex_multinight_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')), fixtureFile: 'cpapdex_synthetic_multinight_golden.node-export.json' };
      } catch (e) {
        /* gate self-skips */
      }
    }
  }
  // Integrator TCH-HR GOLDEN (INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II §2): first code-gated Integrator
  // fixture — fixture-only, the gate rebuilds the three staggered synthetic node-exports in-code and fuses them.
  {
    const fxP = join(ROOT, 'uploads', 'integrator_tch_golden.node-export.json'); // fixture = repo artifact
    if (existsSync(fxP)) {
      try {
        out.integrator_tch_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')), fixtureFile: 'integrator_tch_golden.node-export.json' };
      } catch (e) {
        /* gate self-skips */
      }
    }
  }
  return out;
}

// host realms for the co-load-manifest gate (PPGDEX-FOLLOWUPS §5) — each must co-load every
// dex-coload module; the gate reds if a future add misses a host (the -IV §5 silent-drop class).
function readHosts() {
  const wanted = ['Data Unifier.html', 'OverDex.html', 'Dex-Test-Suite.html', 'tests/run-tests.mjs'];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  return out;
}

// app bundle SOURCES for the Co-load §1 exhaustiveness gate (CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS
// §1) — each *.src.html's <script src> list records which cross/coimport aux modules it bundles; the
// gate asserts dex-coload.js's nodeModules: leg EQUALS that fleet set (browser fetches the same files).
function readSrcHtml() {
  const wanted = ['CPAPDex.src.html', 'ECGDex.src.html', 'GlucoDex.src.html', 'HRVDex.src.html', 'Integrator.src.html', 'OxyDex.src.html', 'PpgDex.src.html', 'PulseDex.src.html'];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  return out;
}

/* N1 (PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-13): the standalone, unbundled analysis/research pages +
   the landing page are same-origin surfaces that ingest recordings and persist checkpoints. They must
   carry the CSP egress/injection backstop the 10 owned bundles do. Node-lane only (fs read); the browser
   lane has no readdir, so env.nonBundleCsp is undefined there and the group SKIPs. `self` = pages that
   fetch the local corpus (connect-src 'self'); the rest lock connect-src 'none'. */
function readNonBundleCsp() {
  const none = [
    'cgm-hrv-coupling-analysis.html',
    'hrv-confound-analysis.html',
    'nights-icc-analysis.html',
    'sensor-trio-power-analysis.html',
    'treatment-response-analysis.html',
    'odi-bias-analysis.html',
    'sigma-no-reference-analysis.html',
    'qrs-equiv-analysis.html',
    'qrs-yield-analysis.html',
    'cohort-harness.html',
    'cohort-runner.html',
    'cohort-regression.html',
    'PAT Feasibility.html',
    'index.html'
  ];
  const self = ['PpgDex Fusion Prototype.html'];
  const out = {};
  for (const f of none) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = { html: readFileSync(p, 'utf8'), connect: 'none' };
  }
  for (const f of self) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = { html: readFileSync(p, 'utf8'), connect: 'self' };
  }
  return out;
}

// analysis-tools self-contained gate (LOCAL-DOWNLOAD / file:// fix): the 9 science tools are bundled to
// self-contained single-file HTML by tools/build-analysis.mjs so they run when downloaded to disk. This
// reads each committed tool HTML so the group can assert the file://-safe invariant (no external <script
// src>, no `new Worker('file.js')`). Node-lane only (fs read); browser lane SKIPs.
function readAnalysisTools() {
  const wanted = [
    'cgm-hrv-coupling-analysis.html',
    'hrv-confound-analysis.html',
    'nights-icc-analysis.html',
    'odi-bias-analysis.html',
    'qrs-equiv-analysis.html',
    'qrs-yield-analysis.html',
    'sensor-trio-power-analysis.html',
    'sigma-no-reference-analysis.html',
    'treatment-response-analysis.html'
  ];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  return out;
}

// security · csp-strict (SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11): the COMMITTED bundle .html CSP metas,
// so the gate can assert each shipped script-src carries a 'sha256-' hash and NOT 'unsafe-inline'. Only the
// <meta> is kept (not the megabyte body). Node lane has full fs; the browser lane fetches the same slice.
function readBundleCsp() {
  const wanted = ['CPAPDex.html', 'ECGDex.html', 'GlucoDex.html', 'HRVDex.html', 'Integrator.html', 'OxyDex.html', 'PpgDex.html', 'PulseDex.html', 'Data Unifier.html', 'OverDex.html'];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const html = readFileSync(p, 'utf8');
    const meta = (html.match(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i) || [''])[0];
    if (meta) out[f] = (meta.match(/content="([^"]*)"/i) || ['', ''])[1];
  }
  return out;
}

// docs-ledger gate (DOCS-LEDGER-GATE-2026-07-03): the brief lifecycle, machine-checked. Node-lane only
// (the lane CI runs) — full fs truth: read every briefs/*.md, DOCS-INDEX.md, the root *-BRIEF.md set, and
// recompute the whole-tree path inventory from disk. No committed list mirror: the browser lane can't list
// a directory, so it SKIPs this gate rather than carry a snapshot every PR would have to regenerate
// (CPAP-REAL-CORPUS-FOLLOWUPS-II §4).
function readDocsLedger() {
  const bdir = join(ROOT, 'briefs');
  if (!existsSync(bdir)) return null;
  const fsBriefNames = readdirSync(bdir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const briefs = {};
  for (const n of fsBriefNames) briefs[n] = readFileSync(join(bdir, n), 'utf8');
  const idxP = join(ROOT, 'DOCS-INDEX.md');
  const indexText = existsSync(idxP) ? readFileSync(idxP, 'utf8') : '';
  const rootBriefNames = readdirSync(ROOT)
    .filter((f) => /-BRIEF\.md$/.test(f))
    .sort();
  // fsPaths — the whole-tree link inventory recomputed from disk (F2); check4b resolves DOCS-INDEX +
  // root-doc links against it.
  const fsPaths = walkRepoPaths(ROOT);
  // X3 (EFFICIENCY-AUDIT-FINDINGS-2026-07-12): the OTHER root docs, so check4b's markdown-link
  // resolution extends from DOCS-INDEX.md to the whole constitution set (a moved target the prose
  // missed is otherwise ungated).
  const rootDocs = {};
  for (const f of ['README.md', 'CLAUDE.md', 'ARCHITECTURE-PRINCIPLES.md', 'ORIENTATION.md', 'CONTRIBUTING.md', 'AUDIT-PROMPT.md']) {
    const p = join(ROOT, f);
    if (existsSync(p)) rootDocs[f] = readFileSync(p, 'utf8');
  }
  return { briefs, indexText, rootBriefNames, fsBriefNames, fsPaths, rootDocs };
}

// release-ledger gate (CONTROLLED-RELEASES-2026-07-05): controlled releases machine-checked. Node-lane
// only (the lane CI runs) — fs truth: read suite.manifest.json, RELEASE-MANIFEST.json, CHANGELOG.md and
// every real changes/*.md. No committed changes-list.txt mirror (CPAP-REAL-CORPUS-FOLLOWUPS-II §4): the
// browser lane can't list changes/, so it SKIPs this gate rather than carry a per-PR-regenerated snapshot.
function readReleaseLedger() {
  const manP = join(ROOT, 'suite.manifest.json'),
    relP = join(ROOT, 'RELEASE-MANIFEST.json');
  if (!existsSync(manP) || !existsSync(relP)) return null;
  const manifestText = readFileSync(manP, 'utf8');
  const releaseText = readFileSync(relP, 'utf8');
  const clP = join(ROOT, 'CHANGELOG.md');
  const changelogText = existsSync(clP) ? readFileSync(clP, 'utf8') : '';
  const cdir = join(ROOT, 'changes');
  const isChangeset = (f) => f.endsWith('.md') && f !== 'README.md' && !/^[._]/.test(f);
  const changeFiles = {};
  let fsChangeNames = [];
  if (existsSync(cdir)) {
    fsChangeNames = readdirSync(cdir).filter(isChangeset).sort();
    for (const n of fsChangeNames) changeFiles[n] = readFileSync(join(cdir, n), 'utf8');
  }
  // check-6 surfaces (CONTROLLED-RELEASES-FOLLOWUPS F2/F3/F4): raw text of every version-carrying surface;
  // the gate extracts + compares to canonical (single-sourced there so this lane and the browser lane can't drift).
  const surfaceTexts = {};
  for (const s of ['CITATION.cff', 'README.md', 'index.html', 'docs/about.json']) {
    const sp = join(ROOT, s);
    if (existsSync(sp)) surfaceTexts[s] = readFileSync(sp, 'utf8');
  }
  return { manifestText, releaseText, changelogText, changeFiles, fsChangeNames, surfaceTexts };
}

// discoverability-cohesion (REPO-DISCOVERABILITY-FOLLOWUPS §5.2) — suite.manifest.json roster ≡
// the generated docs/sitemap.xml. fs truth for both; the group asserts every deployed surface resolves.
function readDiscoverability() {
  const manP = join(ROOT, 'suite.manifest.json'),
    smP = join(ROOT, 'docs', 'sitemap.xml');
  if (!existsSync(manP) || !existsSync(smP)) return null;
  return { manifestText: readFileSync(manP, 'utf8'), sitemapText: readFileSync(smP, 'utf8') };
}

function readDocs() {
  // text artifacts the cohesion-badge group diffs against the engine
  const wanted = [
    'dex-badges.css',
    'OxyDex Reference.html',
    'ECGDex Reference.html',
    'PpgDex Reference.html',
    'CPAPDex Reference.html',
    'PulseDex Reference.html',
    'HRVDex Reference.html',
    'GlucoDex Reference.html',
    'ORIENTATION.md'
  ];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  // GENERATED EEGDex guide (codegen output) — keyed by the conventional doc name the
  // cohesion-badges NODES list uses, read from its generated path. Proves the
  // manifest→guide projection conforms to the generated registry (single-source).
  const eegGuide = join(ROOT, 'codegen/generated/eegdex-reference.html');
  if (existsSync(eegGuide)) out['EEGDex Reference.html'] = readFileSync(eegGuide, 'utf8');
  return out;
}

/* ── 3 · run ─────────────────────────────────────────────────────────────── */
/* D1 · run the shard plan across N forked children and merge their verdicts.
   Correctness rides entirely on the partition proof: every declared group lands in exactly one shard,
   so concatenating the children's groups reconstructs the full run — same groups, same assertions,
   same verdicts (verify-shard-union.mjs --deep proves this empirically). A child that dies without
   parseable JSON is a HARD failure, never a silent gap: a lost shard would be a silently shrunken
   gate, which is the exact failure class G1 is about. */
async function runForked(jobs) {
  const self = fileURLToPath(import.meta.url);
  const passthru = process.argv.slice(2).filter((a) => !/^--?(jobs?|json|timings?|quiet|q|verbose|no-quiet)(=|$)/i.test(a));
  const t0 = Date.now();
  console.log(paint(`▸ --jobs=${jobs}`, C.cyan) + paint(`  forking ${jobs} shard(s) over the same partition CI uses…`, C.dim));

  const child = (i) =>
    new Promise((res) => {
      const c = spawn(process.execPath, [self, `--shard=${i}/${jobs}`, '--json', ...passthru], { encoding: 'utf8' });
      let out = '',
        err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => res({ i, code, out, err }));
    });

  const results = await Promise.all(Array.from({ length: jobs }, (_, k) => child(k + 1)));
  const groups = [];
  for (const r of results) {
    let j = null;
    try {
      j = JSON.parse(r.out);
    } catch (_) {
      /* fall through to the hard failure below */
    }
    if (!j || !Array.isArray(j.groups)) {
      console.error(paint(`\n✗ shard ${r.i}/${jobs} produced no parseable result (exit ${r.code}) — refusing to report a partial gate as a pass.`, C.red));
      console.error((r.err || r.out || '').split('\n').slice(0, 15).join('\n'));
      process.exit(2);
    }
    groups.push(...j.groups);
  }
  groups.sort((a, b) => a.index - b.index); // declaration order, so the report reads like a serial run
  console.log(paint(`  ${groups.length} groups in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`, C.dim));
  return groups;
}

async function main() {
  let ctx;
  try {
    ctx = makeSandbox();
    [
      'kernel-constants.js',
      'clock.js',
      'metric-registry.js',
      'dex-profile.js',
      'oxydex-registry.js',
      'ecgdex-registry.js',
      'ppgdex-registry.js',
      'cpapdex-registry.js',
      'pulsedex-registry.js',
      'hrvdex-registry.js',
      'glucodex-registry.js',
      'codegen/generated/eegdex-registry.js',
      'crossnight-envelope.js',
      'ecgdex-cross.js',
      'oxydex-cross.js',
      'pulsedex-cross.js',
      'ppgdex-cross.js',
      'ecgdex-dsp.js',
      'ppgdex-dsp.js',
      'integrator-dsp.js',
      'integrator-tch.js',
      'signal-spec.js',
      'signal-frame.js',
      'dex-export.js',
      'signal-adapters.js',
      'adapters/polar-rr.js',
      'adapters/coospo-rr.js',
      'adapters/wahoo-rr.js',
      'adapters/oxydex-spo2.js',
      'adapters/welltory-summary.js',
      'adapters/libre-cgm.js',
      'adapters/polar-sense-ppg.js',
      'adapters/polar-h10-ecg.js',
      'adapters/resmed-edf.js',
      'quantity.js',
      'dex-ingest.js',
      'provenance-banner.js',
      'event-coupling.js'
    ].forEach((f) => loadInto(ctx, f));
    // §3 NAMESPACED CO-LOAD (SIGNAL-ADAPTER-FOLLOWUPS): the migrated DSPs now ship a
    // namespaced build, so — exactly like the Data Unifier / OverDex / Dex-Test-Suite host
    // pages — set the flag and co-load all three in this ONE vm realm. They hang their public
    // surface off PulseDex/OxyDex/HRVDex and (flag set) leak NO bare names, so they don't
    // collide with integrator-dsp.js's bare parseTimestamp/mean (loaded above). This is what
    // lets the Phase-9 compute() FUNCTIONAL floor run in Node CI, not just the browser rig (-II §3).
    ctx.__DEX_NAMESPACED__ = true;
    ['oxydex-util.js', 'pulsedex-dsp.js', 'oxydex-dsp.js', 'hrvdex-dsp.js', 'glucodex-dsp.js', 'signal-orchestrate.js', 'dex-coload.js'].forEach((f) => loadInto(ctx, f));
  } catch (e) {
    console.error(paint('SETUP ERROR: ' + e.message, C.red));
    process.exit(2);
  }

  // Optional/leaf modules — gated by the shared suite but not required for setup.
  // Loaded in their OWN guard so a load failure becomes a RED test (missing in
  // env → the self-test group fails), never a dead runner. Morph loads BEFORE the
  // tests run so ECGDSP/PPGDSP `analyze` exercise it morph-active, matching the
  // browser suite (both DSP modules call global.ECGMorph/PPGMorph inside try/catch).
  [
    'ecgdex-morph.js',
    'ppgdex-morph.js',
    'cpapdex-edf.js',
    'cpapdex-dsp.js',
    'cpapdex-fusion.js',
    'cpapdex-cross.js',
    'cpapdex-coimport.js',
    'synth-gen.js',
    'cohort-gen.js',
    'cohort-full.js',
    // glucodex-dsp.js is loaded in the __DEX_NAMESPACED__ co-load block above; re-listing it here
    // re-runs its classicified `export const GLUDSP` as a top-level `const` in the SAME realm → an
    // "Identifier 'GLUDSP' already declared" throw (caught, but a noisy false alarm that would recur
    // for every DSP as the ESM fan-out proceeds). Load-once — the namespaced block already sets env.GLUDSP.
    'dex-patient-gen.js',
    'integrator-longitudinal.js',
    // TEST-COVERAGE-ANALYSIS 2026-07-15 — the analysis-page statistics kernels, single-sourced so the
    // 'Analysis-page statistics kernels — known-answer' group (dex-tests.js) can execute the paper-figure
    // math. Load failure → env.AnalysisStats undefined → that group's availability assert reds.
    'analysis-stats.js',
    // TEST-COVERAGE-FOLLOWUPS §1 — the per-node PROFILE engines (cited VO₂/HRV/apnea/eAG physiology).
    // They attach window.ECGProfile / GLUProfile / PPGProfile; load failure → those env keys undefined →
    // the 'Per-node profile personalization — known-answer' availability assert reds. DexProfile + all
    // node DSPs (incl. glucodex-dsp above) are already in the realm, so personalize() resolves.
    'ecgdex-profile.js',
    'glucodex-profile.js',
    'ppgdex-profile.js',
    // TEST-COVERAGE-FOLLOWUPS §2 — the NSRR PSG ingest adapter (channel matching · 1 Hz resample ·
    // Clock-Contract EDF→OxyDex rows · severity bands). Attaches window.NSRR; the XML annotation
    // parser (parseNsrrXml) needs DOMParser and is exercised in the browser lane only.
    'nsrr-adapter.js',
    // TEST-COVERAGE-FOLLOWUPS §5 — OverDex's recursive folder walker (junk-filter + relPath tagging).
    // DOM-free, attaches globalThis.OverDexWalk; the sync fromInput/relOf surface is pinned headlessly.
    'overdex-walk.js',
    // TEST-COVERAGE-FOLLOWUPS-II §3 (Route A) — the cohort-regression analysis page now exposes its pure
    // OLS kernel as window.CohortRegression.olsR2 (+ a DOM guard so it loads headless). Tests the SHIPPED
    // function, not a copy. Load failure → env.CohortRegression undefined → the known-answer assert reds.
    'cohort-regression.js',
    // TEST-COVERAGE-FOLLOWUPS-II §3 (Route A) — qrs-equiv exposes window.QrsEquiv (pearson · Bland-Altman ·
    // sd · mean) + DOM guards so it loads headless. It is INLINED by build-analysis, so the .html was
    // re-bundled (build-analysis --check is the staleness net). Load failure → env.QrsEquiv undefined → red.
    'qrs-equiv-analysis.js',
    // TEST-COVERAGE-FOLLOWUPS-II §1b — HRVDex's personalization already leaks its pure cited kernels as
    // bare globals (Object.assign(window,{…})) and loads headless, so NO source edit / NO re-bundle is
    // owed (the brief's "no seam" premise was wrong). Load it last so env can grab calcVo2Cat/getAgeBand.
    'hrvdex-profile.js',
    // §1b OxyDex sibling — ALSO test-only (no re-bundle): oxydex-profile.js's up* functions are top-level
    // globals and it loads headless once oxydex-util.js (sv/gv, DOM-guarded) is present, which it is (above).
    // Its initProfile() DOM init no-ops headless (sv guards on getElementById). env grabs upKarvonenZone/upBMILabel.
    'oxydex-profile.js'
  ].forEach((f) => {
    try {
      loadInto(ctx, f);
    } catch (e) {
      console.error(paint('  ! optional module failed to load: ' + f + ' — ' + e.message, C.yellow));
    }
  });

  const env = {
    DexKernel: ctx.DexKernel,
    MetricRegistry: ctx.MetricRegistry,
    DexProfile: ctx.DexProfile,
    ECGProfile: ctx.ECGProfile,
    GLUProfile: ctx.GLUProfile,
    PPGProfile: ctx.PPGProfile,
    NSRR: ctx.NSRR,
    OverDexWalk: ctx.OverDexWalk,
    CohortRegression: ctx.CohortRegression,
    QrsEquiv: ctx.QrsEquiv,
    HrvCalcVo2Cat: ctx.calcVo2Cat,
    HrvGetAgeBand: ctx.getAgeBand,
    OxyKarvonenZone: ctx.upKarvonenZone,
    OxyBMILabel: ctx.upBMILabel,
    CrossNightEnvelope: ctx.CrossNightEnvelope,
    ECGCross: ctx.ECGCross,
    OXYCross: ctx.OXYCross,
    PulseCross: ctx.PulseCross,
    PPGCross: ctx.PPGCross,
    ECGDSP: ctx.ECGDSP,
    ECGDex: ctx.ECGDex,
    PPGDSP: ctx.PPGDSP,
    PpgDex: ctx.PpgDex,
    GLUDSP: ctx.GLUDSP,
    GlucoDex: ctx.GlucoDex,
    IntegratorDSP: ctx.IntegratorDSP,
    IntegratorTCH: ctx.IntegratorTCH,
    IntegratorLong: ctx.IntegratorLong,
    DexPatientGen: ctx.DexPatientGen,
    parseTimestamp: ctx.parseTimestamp,
    DexClock: ctx.DexClock,
    PulseDex: ctx.PulseDex,
    OxyDex: ctx.OxyDex,
    HRVDex: ctx.HRVDex,
    SignalFrame: ctx.SignalFrame,
    DexExport: ctx.DexExport,
    exportName: ctx.exportName,
    EXPORT_KINDS: ctx.EXPORT_KINDS,
    SignalSpec: ctx.SignalSpec,
    SignalAdapters: ctx.SignalAdapters,
    EventCoupling: ctx.EventCoupling,
    SignalOrchestrate: ctx.SignalOrchestrate,
    DexCoload: ctx.DexCoload,
    DexIngest: ctx.DexIngest,
    pickProvenanceBanner: ctx.pickProvenanceBanner,
    Quantity: ctx.Quantity,
    DexUnits: ctx.DexUnits,
    adaptEnvelopeNode: ctx.adaptEnvelopeNode,
    recWindow: ctx.recWindow,
    overlapInterval: ctx.overlapInterval,
    fuseHRVConsensus: ctx.fuseHRVConsensus,
    fusePeriodicBreathing: ctx.fusePeriodicBreathing,
    dedupeRecs: ctx.dedupeRecs,
    runFusion: ctx.runFusion,
    buildFusionExport: ctx.buildFusionExport,
    reconstructEventTMs: ctx.reconstructEventTMs,
    labelPositionalApnea: ctx.labelPositionalApnea,
    _ecgPostureSeries: ctx._ecgPostureSeries,
    corroborateDesat: ctx.corroborateDesat,
    pickHRAuthority: ctx.pickHRAuthority,
    normalizeFile: ctx.normalizeFile,
    OXY_REGISTRY: ctx.OXY_REGISTRY,
    OxyRegistry: ctx.OxyRegistry,
    ECG_REGISTRY: ctx.ECG_REGISTRY,
    EcgRegistry: ctx.EcgRegistry,
    PPG_REGISTRY: ctx.PPG_REGISTRY,
    PpgRegistry: ctx.PpgRegistry,
    CPAP_REGISTRY: ctx.CPAP_REGISTRY,
    CpapRegistry: ctx.CpapRegistry,
    PULSE_REGISTRY: ctx.PULSE_REGISTRY,
    PulseRegistry: ctx.PulseRegistry,
    HRV_REGISTRY: ctx.HRV_REGISTRY,
    HrvRegistry: ctx.HrvRegistry,
    GLU_REGISTRY: ctx.GLU_REGISTRY,
    GlucoRegistry: ctx.GlucoRegistry,
    EEG_REGISTRY: ctx.EEG_REGISTRY,
    EegRegistry: ctx.EegRegistry,
    CpapDsp: ctx.CpapDsp,
    CpapEdf: ctx.CpapEdf,
    CPAPDex: ctx.CPAPDex,
    CpapFusion: ctx.CpapFusion,
    CPAPCross: ctx.CPAPCross,
    CpapCoimport: ctx.CpapCoimport,
    ECGMorph: ctx.ECGMorph,
    PPGMorph: ctx.PPGMorph,
    SYNTH: ctx.SYNTH,
    CohortGen: ctx.CohortGen,
    CohortFull: ctx.CohortFull,
    AnalysisStats: ctx.AnalysisStats,
    docs: readDocs(),
    docsLedger: readDocsLedger(),
    sources: readSources(),
    trackedFiles: readTrackedFiles(),
    // FIXTURE-VERIFICATION-GATE §1 — computeHash is async (crypto.subtle) and the assertion harness is
    // synchronous, so the discrimination probe is computed HERE and asserted there. ManifestGate itself
    // is passed for the (sync) closure-membership self-tests.
    ManifestGate,
    computeHashProbe: await readComputeHashProbe(),
    fixtures: readFixtures(),
    equiv: readEquiv(),
    hosts: readHosts(),
    srcHtml: readSrcHtml(),
    nonBundleCsp: readNonBundleCsp(),
    analysisTools: readAnalysisTools(),
    bundleCsp: readBundleCsp(),
    manifests: readManifests(),
    releaseLedger: readReleaseLedger(),
    discoverability: readDiscoverability(),
    groupFilter: GROUP_FILTER || null,
    listOnly: LIST_ONLY
  };

  const { runDexTests, auditSkips } = require('./dex-tests.js');

  /* Sharding is a TWO-PASS run, and it is cheap because pass 1 costs nothing: an inventory pass
     (listOnly) declares all N groups while executing ZERO of them (~0.07 s — every group body is
     skipped), which hands the planner the full group list. The planner then LPT-packs that list
     into balanced bins, and pass 2 executes only THIS shard's indices. Every shard process runs
     the same pure planner over the same inventory, so they agree on the partition with no
     coordination — and no group can fall between two shards. */
  if (SHARD) {
    const inv = runDexTests({ ...env, listOnly: true }).groups.map((g) => ({ index: g.index, title: g.title }));
    const { bins, weights, unknown } = planShards(inv, readTimings(), SHARD.total);
    const errs = partitionViolations(inv, bins);
    if (errs.length) {
      console.error(paint('✗ shard plan is not a partition — refusing to run a gate that could silently skip a group:', C.red));
      for (const e of errs) console.error('   · ' + e);
      process.exit(2);
    }
    env.shardIndices = bins[SHARD.index];
    SHARD.plannedMs = weights[SHARD.index];
    SHARD.unknown = unknown.length;
  }

  const forked = JOBS && !SHARD && !AS_JSON && !LIST_ONLY ? await runForked(JOBS) : null;
  const { groups, totalGroups, groupFilter } = forked ? { groups: forked, totalGroups: forked.length, groupFilter: GROUP_FILTER || null } : runDexTests(env);

  // Machine-readable lanes (--list inventory / --json results) — no human report, no colour.
  if (AS_JSON || LIST_ONLY) {
    console.log(
      JSON.stringify({
        totalGroups,
        listOnly: LIST_ONLY,
        shard: SHARD ? SHARD.label : null,
        groupFilter: groupFilter || null,
        groups: groups.map((g) => ({
          index: g.index,
          title: g.title,
          tag: g.tag,
          ms: g.ms == null ? null : g.ms,
          tests: LIST_ONLY ? undefined : g.tests.map((t) => ({ name: t.name, pass: !!t.pass, skip: !!t.skip, detail: t.detail || '' }))
        }))
      })
    );
    const failed = LIST_ONLY ? 0 : groups.reduce((a, g) => a + g.tests.filter((t) => !t.pass && !t.skip).length, 0);
    // exitCode + return, NOT process.exit(): Node's stdout is ASYNC to a pipe (sync only to a file/TTY),
    // so process.exit() right after a ~140 KB console.log TRUNCATES it mid-write. Redirecting to a file
    // hid this; spawnSync (a pipe) got a half-written payload and "valid run, unparseable JSON". Setting
    // exitCode lets the event loop drain stdout, then exits with the same status.
    process.exitCode = failed ? 1 : 0;
    return;
  }

  if (SHARD) {
    const est = SHARD.plannedMs ? ' · planned ~' + (SHARD.plannedMs / 1000).toFixed(1) + ' s' : '';
    const unk = SHARD.unknown ? paint('  (' + SHARD.unknown + ' group(s) had no committed timing — balance is a guess for those, coverage is not)', C.yellow) : '';
    console.log('\n' + paint('▸ SHARD ' + SHARD.label, C.cyan) + paint('  →  ' + groups.length + ' of ' + totalGroups + ' groups' + est, C.dim));
    console.log(paint('  (cost-balanced partition — the union of all ' + SHARD.total + ' shards IS the full gate; every group runs in exactly one)', C.dim) + unk);
    if (!groups.length) {
      console.log(paint('  ✗ shard selected ZERO groups — N exceeds the group count?', C.red));
      process.exit(2);
    }
  }
  if (groupFilter) {
    console.log('\n' + paint('▸ FILTERED RUN', C.yellow) + paint('  --group="' + groupFilter + '"  →  ' + groups.length + ' of ' + totalGroups + ' groups', C.dim));
    console.log(paint('  (dev convenience — NOT the canonical gate; run with no filter for the merge-gate pass)', C.dim));
    if (!groups.length) {
      console.log(paint('  ✗ filter matched ZERO groups — check the pattern', C.red));
      process.exit(2);
    }
  }

  let pass = 0,
    fail = 0,
    skip = 0,
    n = 0;
  const lines = [];
  const failures = []; // D3: collected for the tail recap
  for (const g of groups) {
    // skip-aware tally, mirroring Dex-Test-Suite.html's render-coverage ⊘ convention: a skipped
    // test counts as NEITHER pass nor fail, so a gitignored-input SKIP never reds the merge gate.
    const gskip = g.tests.filter((t) => t.skip).length;
    const gp = g.tests.filter((t) => t.pass && !t.skip).length;
    const gf = g.tests.length - gp - gskip;
    pass += gp;
    fail += gf;
    skip += gskip;
    n += g.tests.length;
    // QUIET (D3): print a group header only for FAILING groups; full run prints every header.
    if (!QUIET || gf) {
      lines.push(
        '\n' + paint('▸ ' + g.title, C.bold) + paint('  [' + g.tag + ']', C.dim) + '  ' + paint(gp + '/' + (g.tests.length - gskip) + (gskip ? ' · ' + gskip + '⊘' : ''), gf ? C.red : C.green)
      );
    }
    for (const t of g.tests) {
      if (!t.pass && !t.skip) failures.push({ group: g.title, name: t.name, detail: t.detail || '' });
      // QUIET (D3): only failing assertions get a line; the passing/skip tree is suppressed.
      if (QUIET && (t.pass || t.skip)) continue;
      const mk = t.skip ? paint('  ⊘', C.yellow) : t.pass ? paint('  ✓', C.green) : paint('  ✕', C.red);
      const detail = t.detail ? paint('  — ' + t.detail, t.skip ? C.yellow : t.pass ? C.dim : C.yellow) : '';
      lines.push(mk + ' ' + t.name + detail);
    }
  }
  if (lines.length) console.log(lines.join('\n'));

  // --timings: the slowest groups, and what they cost. This is how the CI shard count gets sized —
  // a shard can never be faster than its single slowest group, so that number is the real floor.
  if (SHOW_TIMINGS) {
    const timed = groups.filter((g) => g.ms != null).sort((a, b) => b.ms - a.ms);
    const totalMs = timed.reduce((a, g) => a + g.ms, 0);
    console.log('\n' + paint('▸ slowest groups', C.bold) + paint('  (' + (totalMs / 1000).toFixed(1) + ' s in ' + timed.length + ' groups)', C.dim));
    for (const g of timed.slice(0, 15)) {
      const pct = totalMs ? ((100 * g.ms) / totalMs).toFixed(1) : '0.0';
      console.log('  ' + String(g.ms).padStart(7) + ' ms  ' + paint((pct + '%').padStart(6), C.dim) + '  ' + g.title);
    }
  }

  /* ── SKIP BUDGET (G1) ──────────────────────────────────────────────────────────────────────
     A ⊘ is neither pass nor fail, so a leg that stops running does not red the gate — it just
     stops being checked, silently. Every skip must therefore be DECLARED in expected-skips.json.
     An undeclared skip is a FAILURE: shrinking the gate has to be a deliberate, reviewable act.
     Shard-safe — it judges only the groups that ran in this process. */
  const { violations: skipViolations, counted: skipCounted } = auditSkips(groups, EXPECTED_SKIPS.allow || []);
  if (skipViolations.length) {
    fail += skipViolations.length;
    console.log('\n' + paint('▸ SKIP BUDGET — ' + skipViolations.length + ' UNDECLARED skip(s)', C.red));
    console.log(paint('  A skip is neither pass nor fail: this leg stopped being checked and the gate would still be green.', C.dim));
    for (const v of skipViolations) console.log(paint('  ✕ ', C.red) + '[' + v.group + '] ' + v.test + (v.detail ? paint('  — ' + v.detail, C.yellow) : ''));
    console.log(paint('  → If this skip is intended, declare it in tests/expected-skips.json (and justify it — you are shrinking the gate).', C.yellow));
  }

  /* ── COVERAGE (G1) ────────────────────────────────────────────────────────────────────────
     Say out loud what this run did NOT verify. The whole G1 finding is that CI silently ran a
     weaker gate than local for want of one line of output. */
  if (skipCounted['corpus-absent']) {
    console.log(
      '\n' +
        paint('▸ COVERAGE — ' + skipCounted['corpus-absent'] + ' leg(s) NOT verified: the raw recording is absent', C.yellow) +
        paint(
          '\n  uploads/ raw recordings are gitignored, so a fresh clone (CI, or a worktree) cannot run them —' +
            '\n  including the real-recording equivalence legs (the GATE-C surface). This run is NOT the full gate.' +
            '\n  → Point DEX_UPLOADS=<path> at a real corpus to actually run them.',
          C.dim
        )
    );
  }

  /* ── FAILURES recap (D3 · EFFICIENCY-AUDIT-FINDINGS-2026-07-12) ────────────────────────────────
     A red run otherwise names each failure ONCE, deep in a ~169 KB log — `| tail` sees only the
     count. Recap every failure at the tail: group ▸ assertion ▸ detail, then the exact --group
     re-run line per failing group, so the actionable read is < 1 KB regardless of suite size. */
  if (failures.length) {
    console.log('\n' + paint('▸ FAILURES (' + failures.length + ')', C.red));
    for (const f of failures) {
      console.log(paint('  ✕ ', C.red) + paint('[' + f.group + ']', C.bold) + ' ' + f.name + (f.detail ? paint('  — ' + f.detail, C.yellow) : ''));
    }
    const failGroups = [...new Set(failures.map((f) => f.group))];
    console.log(paint('  → re-run just the failing group(s):', C.dim));
    for (const gt of failGroups) console.log(paint('      node tests/run-tests.mjs --group=' + JSON.stringify(gt), C.cyan));
  }

  // TAP-ish footer for CI log parsers
  console.log('\n' + paint('1..' + n, C.dim));
  const summary = fail
    ? paint('✕ ' + fail + ' failing', C.red) + paint('  ·  ' + pass + ' passing', C.dim) + (skip ? paint('  ·  ' + skip + ' skipped', C.yellow) : '')
    : paint('✓ all ' + pass + ' assertions passed', C.green) + (skip ? paint('  ·  ' + skip + ' skipped', C.yellow) : '');
  console.log(paint('Tepna test suite', C.cyan) + '  ' + summary + paint('  (' + groups.length + ' groups)', C.dim) + (groupFilter ? paint('  [FILTERED — not the full gate]', C.yellow) : ''));
  // exitCode, not process.exit() — stdout is async to a PIPE, and CI captures stdout through one, so
  // exiting immediately after printing the full report can truncate its tail (incl. the summary line).
  process.exitCode = fail ? 1 : 0;
}

main();
