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
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { walkRepoPaths } from './docs-ledger-fs.mjs';
import { planShards, partitionViolations, readTimings } from './shard-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);

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
/* --list: declare every group, execute NONE (inventory only, ~0 s) — the cheap input to the
   shard-partition proof. --json: emit machine-readable results instead of the human report; it is
   what verify-shard-union.mjs --deep diffs full-run vs shard-union with. */
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
  const code = readFileSync(p, 'utf8');
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
    'hrvdex-render.js',
    'signal-orchestrate.js',
    'dex-ingest.js',
    'cpapdex-dsp.js',
    'cpapdex-edf.js',
    'cpapdex-app.js',
    'cpapdex-fusion.js',
    'ecgdex-morph.js',
    'ppgdex-morph.js',
    'dex-export.js',
    'ganglior-provenance.js',
    'signal-frame.js',
    'glucodex-render.js',
    'glucodex-app.js',
    'cpapdex-render.js',
    'pulsedex-overview.js',
    'ecgdex-profile.js',
    'glucodex-profile.js',
    'ppgdex-profile.js'
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
  for (const f of ['BUILD-MANIFEST.json', 'FIXTURE-PROVENANCE.json']) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  return out;
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
  const pair = (key, inFile, fixFile) => {
    const inP = join(ROOT, 'uploads', inFile),
      fxP = join(ROOT, 'uploads', fixFile);
    const rec = {};
    if (existsSync(inP)) {
      try {
        rec.input = readFileSync(inP, 'utf8');
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    if (existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    if (rec.input !== undefined || rec.fixture !== undefined) out[key] = rec;
  };
  pair('oxydex', 'O2Ring S 2100_20260612230016.csv', 'OxyDex_2026-06-13_1056_summary.json');
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
  pair('pulsedex_synth', 'synthetic_pulsedex_rr.txt', 'synthetic_pulsedex_golden.node-export.json');
  pair('hrvdex_synth', 'synthetic_hrvdex_welltory.csv', 'synthetic_hrvdex_golden.node-export.json');
  pair('glucodex_synth', 'synthetic_glucodex_lingo.csv', 'synthetic_glucodex_golden.node-export.json');
  pair('ppgdex_synth', 'synthetic_ppgdex_verity.txt', 'synthetic_ppgdex_golden.node-export.json');
  pair('ecgdex_synth', 'synthetic_ecgdex_h10.txt', 'synthetic_ecgdex_golden.node-export.json');

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
      const p = join(ROOT, 'uploads', `20260613_231433_${k}.edf`);
      if (!existsSync(p)) {
        complete = false;
        break;
      }
      const b = readFileSync(p); // binary: no 'utf8'
      inp[k] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_edf_golden.node-export.json');
    const rec = {};
    if (complete) rec.input = inp;
    if (existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch (e) {
        /* unreadable → treat as absent */
      }
    }
    if (rec.input !== undefined || rec.fixture !== undefined) out.cpapdex_edf = rec;
  }
  // CPAPDex GOLDEN reference (CPAPDEX-PHASE9-FOLLOWUPS-II §1): no INPUT file — the gate rebuilds the
  // deterministic synthetic night from CpapDsp._synthEdfSet in-code; only the committed golden EXPORT is
  // wired. (Retained: it pins the DECODED-set path, while cpapdex_edf above pins the BINARY-parser path.)
  {
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_golden.node-export.json');
    if (existsSync(fxP)) {
      try {
        out.cpapdex_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')) };
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
    const fxP = join(ROOT, 'uploads', 'cpapdex_synthetic_multinight_golden.node-export.json');
    if (existsSync(fxP)) {
      try {
        out.cpapdex_multinight_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')) };
      } catch (e) {
        /* gate self-skips */
      }
    }
  }
  // Integrator TCH-HR GOLDEN (INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II §2): first code-gated Integrator
  // fixture — fixture-only, the gate rebuilds the three staggered synthetic node-exports in-code and fuses them.
  {
    const fxP = join(ROOT, 'uploads', 'integrator_tch_golden.node-export.json');
    if (existsSync(fxP)) {
      try {
        out.integrator_tch_golden = { fixture: JSON.parse(readFileSync(fxP, 'utf8')) };
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

// docs-ledger gate (DOCS-LEDGER-GATE-2026-07-03): the brief lifecycle, machine-checked. Node lane has
// full fs truth — read every briefs/*.md, DOCS-INDEX.md, the root *-BRIEF.md set, AND the committed
// tests/docs-ledger-list.json (the browser lane's name source) so the group can assert list == fs.
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
  let listedBriefNames = [],
    listedPaths = [];
  const listP = join(ROOT, 'tests', 'docs-ledger-list.json');
  if (existsSync(listP)) {
    try {
      const j = JSON.parse(readFileSync(listP, 'utf8'));
      listedBriefNames = j.briefs || [];
      listedPaths = j.paths || [];
    } catch (e) {
      /* stale/broken → staleness check reds */
    }
  }
  // fsPaths — the whole-tree link inventory recomputed from disk (F2). Authoritative in the Node lane:
  // check4b resolves against it AND the staleness leg asserts listedPaths == fsPaths (a stale committed
  // list reds in CI, exactly like the brief-name list). Same shared walker the generator uses.
  const fsPaths = walkRepoPaths(ROOT);
  return { briefs, indexText, rootBriefNames, fsBriefNames, listedBriefNames, fsPaths, listedPaths };
}

// release-ledger gate (CONTROLLED-RELEASES-2026-07-05): controlled releases machine-checked. Node lane
// has fs truth — read suite.manifest.json, RELEASE-MANIFEST.json, CHANGELOG.md, every real changes/*.md,
// AND the committed tests/changes-list.json (the browser lane's name source) so the group asserts list==fs.
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
  let listedChangeNames = [];
  const listP = join(ROOT, 'tests', 'changes-list.json');
  if (existsSync(listP)) {
    try {
      listedChangeNames = JSON.parse(readFileSync(listP, 'utf8')).changes || [];
    } catch (e) {
      /* stale/broken → staleness check reds */
    }
  }
  // check-6 surfaces (CONTROLLED-RELEASES-FOLLOWUPS F2/F3/F4): raw text of every version-carrying surface;
  // the gate extracts + compares to canonical (single-sourced there so this lane and the browser lane can't drift).
  const surfaceTexts = {};
  for (const s of ['CITATION.cff', 'README.md', 'index.html', 'docs/about.json']) {
    const sp = join(ROOT, s);
    if (existsSync(sp)) surfaceTexts[s] = readFileSync(sp, 'utf8');
  }
  return { manifestText, releaseText, changelogText, changeFiles, fsChangeNames, listedChangeNames, surfaceTexts };
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
function main() {
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
      'quantity.js',
      'dex-ingest.js',
      'provenance-banner.js'
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
    'glucodex-dsp.js',
    'dex-patient-gen.js',
    'integrator-longitudinal.js'
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
    docs: readDocs(),
    docsLedger: readDocsLedger(),
    sources: readSources(),
    fixtures: readFixtures(),
    equiv: readEquiv(),
    hosts: readHosts(),
    srcHtml: readSrcHtml(),
    bundleCsp: readBundleCsp(),
    manifests: readManifests(),
    releaseLedger: readReleaseLedger(),
    discoverability: readDiscoverability(),
    groupFilter: GROUP_FILTER || null,
    listOnly: LIST_ONLY
  };

  const { runDexTests } = require('./dex-tests.js');

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

  const { groups, totalGroups, groupFilter } = runDexTests(env);

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
          tests: LIST_ONLY ? undefined : g.tests.map((t) => ({ name: t.name, pass: !!t.pass, skip: !!t.skip }))
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
    lines.push('\n' + paint('▸ ' + g.title, C.bold) + paint('  [' + g.tag + ']', C.dim) + '  ' + paint(gp + '/' + (g.tests.length - gskip) + (gskip ? ' · ' + gskip + '⊘' : ''), gf ? C.red : C.green));
    for (const t of g.tests) {
      const mk = t.skip ? paint('  ⊘', C.yellow) : t.pass ? paint('  ✓', C.green) : paint('  ✕', C.red);
      const detail = t.detail ? paint('  — ' + t.detail, t.skip ? C.yellow : t.pass ? C.dim : C.yellow) : '';
      lines.push(mk + ' ' + t.name + detail);
    }
  }
  console.log(lines.join('\n'));

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
