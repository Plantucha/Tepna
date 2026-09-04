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
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { classify as rebaseClassify, parsePorcelain as rebaseParsePorcelain, classifyStamps as rebaseClassifyStamps } from '../tools/rebase-safe.mjs';
import { decide as landDecide } from '../tools/land-pr.mjs';
import { classify as qdClassify, pick as qdPick, IDLE_MIN as QD_IDLE_MIN, STARVED_MIN as QD_STARVED_MIN } from '../tools/queue-doctor.mjs';
import { classify as commitShape } from '../tools/commit-shape.mjs';
import * as captureRecapture from '../tools/capture-recapture.mjs';
import { estimate as beatCrEstimate, estSummary as beatCrSummary } from '../tools/beat-capture-recapture.mjs';
import { attenuateAndRecover, buildTemplate as beatBuildTemplate } from '../tools/beat-injection-recovery.mjs';
import * as deviceStability from '../tools/device-stability.mjs';
import * as beatCorrespondence from '../tools/beat-correspondence.mjs';
import * as circularStats from '../tools/circular-stats.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { spawn, execSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
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

/* ── PROGRESS + ETA ─────────────────────────────────────────────────────────────────────────
   The full suite runs >10 min and a filtered one can still take minutes (`--group=clock` is 58
   groups / 853 assertions / 295 s), and until now it printed NOTHING until it was done. That is
   not merely unfriendly: with no measured figure to hand, waiting gets estimated by guess, and a
   guess of "10–15 min" was published here against a true 78 min.

   The denominator is REAL, not a mean: `tests/group-timings.json` carries per-group wall times, so
   the ETA is the sum of the times of the groups still to run. Where a group is absent from that
   file (new, or renamed) it falls back to the observed mean and the line says `~` so the reader
   knows which number they are looking at.

   ⚠️ Matching is by TITLE only — the timings file stores no tags — so a tag-scoped filter may plan
   against a superset. It over-estimates in that case, which is the harmless direction.

   Goes to STDERR so TAP/log parsers on stdout are untouched, and is OFF under CI (hundreds of
   lines) — `--no-progress` disables it locally. */
function progressReporter() {
  let plan = null;
  try {
    /* 🔴 THE DENOMINATOR IS THE EXECUTED SET, NOT THE TIMINGS FILE. The first version planned by
       matching `group-timings.json` TITLES, but selection also matches TAGS — so `--group=clock`
       planned 36 groups while 58 actually ran, and the line read `[55/36]`. A progress counter whose
       numerator can exceed its denominator is not merely ugly: the ETA derived from it is wrong by
       the same ratio, and it is wrong in the optimistic direction.

       `listOnly` declares every group WITHOUT executing any (each body is skipped, so it costs
       ~0.1 s), and it carries the TAG — so applying the real matcher to it yields exactly the set
       `onGroup` will fire for. The timings file is then used only for the per-group COST, which is
       what it is actually authoritative about; a group missing from it falls back to the mean of the
       ones present. */
    const { runDexTests: _list, dexGroupMatcher } = createRequire(import.meta.url)(join(ROOT, 'tests/dex-tests.js'));
    const raw = JSON.parse(readFileSync(join(ROOT, 'tests/group-timings.json'), 'utf8'));
    const match = GROUP_FILTER ? dexGroupMatcher(GROUP_FILTER) : null;
    const declared = _list({ listOnly: true }).groups;
    const selected = match ? declared.filter((g) => match(g.title, g.tag)) : declared;
    const known = selected.map((g) => raw.groups?.[g.title]).filter((x) => typeof x === 'number');
    const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    const per = new Map();
    let total = 0;
    for (const g of selected) {
      const ms = typeof raw.groups?.[g.title] === 'number' ? raw.groups[g.title] : mean;
      per.set(g.title, ms);
      total += ms;
    }
    if (selected.length) plan = { per, total, count: selected.length, priced: known.length };
  } catch {
    plan = null; /* no list or no timings → running mean, and say so */
  }
  const t0 = Date.now();
  let done = 0;
  let plannedDone = 0;
  if (plan) {
    process.stderr.write(
      '  ⏱  plan: ' + plan.count + ' groups will run, ~' + (plan.total / 1000).toFixed(0) + 's' + (plan.priced < plan.count ? '  (' + (plan.count - plan.priced) + ' unpriced — mean used)' : '') + '\n'
    );
  } else {
    process.stderr.write('  ⏱  group plan unavailable — ETA will be a running mean\n');
  }
  const fmt = (x) => (!Number.isFinite(x) ? '?' : x >= 60 ? Math.floor(x / 60) + 'm' + String(Math.round(x % 60)).padStart(2, '0') + 's' : Math.round(x) + 's');
  return (G) => {
    done++;
    const elapsed = (Date.now() - t0) / 1000;
    let left = Number.NaN;
    let exact = false;
    if (plan) {
      plannedDone += plan.per.has(G.title) ? plan.per.get(G.title) : plan.total / Math.max(1, plan.count);
      /* Scale the remaining PLAN by how wrong it has been so far — the timings file is a hint from
         another machine, so trusting it unadjusted repeats the "78 min" error at group scale.
         ⚠️ BUT NOT FROM ONE SAMPLE. Unguarded, this divided a real elapsed by a 1 ms first group and
         printed `ETA 146m24s` for a run that took 5 — the same cold-sample error it exists to fix,
         re-created one level up. The correction only engages once enough of the plan has actually
         run to mean something, and is clamped: a hint that is out by more than 5x is not a hint
         worth scaling by. */
      const seen = plannedDone / Math.max(1, plan.total);
      let ratio = 1;
      if (seen >= 0.05 && elapsed > 2 && plannedDone > 0) {
        ratio = elapsed / (plannedDone / 1000);
        if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
        ratio = Math.min(5, Math.max(0.2, ratio));
      }
      left = Math.max(0, ((plan.total - plannedDone) / 1000) * ratio);
      exact = plan.per.has(G.title);
    }
    process.stderr.write(
      '  [' +
        String(done).padStart(3) +
        (plan ? '/' + plan.count : '') +
        ']  ' +
        (G.ms >= 1000 ? String((G.ms / 1000).toFixed(1)) + 's' : String(G.ms) + 'ms').padStart(7) +
        '  ' +
        'elapsed ' +
        fmt(elapsed) +
        '  ' +
        (exact ? 'ETA ' : 'ETA ~') +
        fmt(left) +
        '  ' +
        String(G.title).slice(0, 58) +
        '\n'
    );
  };
}

const PROGRESS = !process.env.CI && !process.argv.slice(2).some((a) => /^--?no-progress$/i.test(a));

const SHOW_TIMINGS = process.argv.slice(2).some((s) => /^--?timings?$/i.test(s)) || !!process.env.DEX_TIMINGS;

/* --group-index=N[,M…] — execute EXACTLY these declaration indices, nothing else.
   `--group=` selects by title/tag substring-or-regex, which is right for a human and wrong for a
   machine: titles here contain regex metacharacters and commas (the filter's own OR separator), so
   a tool that enumerates groups and feeds them back cannot address one unambiguously. Indices are
   what `--list` already emits and what the shard planner already partitions on, so this reuses
   `dexShardSelector` rather than adding a second selection mechanism.
   Built for tools/per-group-coverage.mjs, which must run each group in isolation to learn which
   lines it executes — the per-test coverage MUTATION-PROGRAM-FOLLOWUPS §6 names as the prerequisite
   for test selection, and which tools/mutate.mjs §INCREMENTAL SWEEPS names as the reason a SURVIVED
   verdict cannot be soundly reused. */
const GROUP_INDICES = (() => {
  const a = process.argv.slice(2);
  const hit = a.find((s) => /^--?group-index(=|$)/i.test(s));
  if (!hit) return null;
  const raw = hit.includes('=') ? hit.split('=').slice(1).join('=') : a[a.indexOf(hit) + 1] || '';
  const idx = String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (!idx.length) {
    console.error(`✗ bad --group-index "${raw}" — want one or more 0-based integers, e.g. 12 or 12,13`);
    process.exit(2);
  }
  return new Set(idx);
})();

/* --interval-coverage=<out.json> — per-group INTERVAL coverage via the V8 inspector
   (MUTATION-SUITE-FOLLOWUPS §3c). c8's per-group runs attributed ONLY the load-time baseline to the
   DSPs (188 of 494 groups read as executing nothing; six real kills were manufactured into
   survivors), and §3a proved the collected data cannot be re-interpreted around that. This changes
   what is COLLECTED: `Profiler.takePreciseCoverage` RESETS ON READ on this Node, so each snapshot IS
   an interval — take once after load and DISCARD (that is the baseline), run the group, take again:
   the second snapshot is the group's own execution with the baseline already gone.
   ⚠️ RESET-ON-READ MAKES THE COUNTER A SHARED, DESTRUCTIVE RESOURCE — never compose this flag with
   c8 or any other in-process coverage reader: whoever reads the interval consumes it, and c8 would
   then report whatever the last interval happened to contain, LOWER, without erroring. */
const INTERVAL_COV = (() => {
  const a = process.argv.slice(2);
  const hit = a.find((x) => /^--?interval-coverage(=|$)/i.test(x));
  if (!hit) return null;
  const raw = hit.includes('=') ? hit.split('=').slice(1).join('=') : a[a.indexOf(hit) + 1] || '';
  if (!raw) {
    console.error('✗ --interval-coverage needs an output path');
    process.exit(2);
  }
  return raw;
})();
let __covPost = null;
if (INTERVAL_COV) {
  /* ⚠️ PIN EVERY VM CONTEXT UNTIL THE FINAL TAKE — this is the §3 root cause, unified. V8 DROPS a
     script's coverage when its context is garbage-collected, and several groups build short-lived
     realms (a fresh co-load per group), so their entire execution vanished from c8 AND from the
     inspector takes alike: counts existed (a no-discard probe read maxCount 12) and the take
     reported the script ABSENT once the realm was collectable. Keeping a reference until after the
     take is the whole fix; the array is released immediately after the interval is written. */
  const __vm = await import('node:vm');
  const __keepAlive = [];
  globalThis.__covKeepAlive = __keepAlive;
  const __origCreate = __vm.default.createContext;
  __vm.default.createContext = function (...a) {
    const c = __origCreate.apply(this, a);
    __keepAlive.push(c);
    return c;
  };
  const { Session } = await import('node:inspector');
  const ses = new Session();
  ses.connect();
  __covPost = (method, params) => new Promise((resv, rej) => ses.post(method, params || {}, (e, r) => (e ? rej(e) : resv(r))));
  await __covPost('Profiler.enable');
  /* Started HERE — before any DSP loads — so the first take captures the entire load phase. */
  await __covPost('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

/** Offset-range V8 coverage → executed LINE set, per file under ROOT. Exported-shape helper kept
 *  local: paint outer-to-inner so a count-0 sub-block correctly unmarks its lines (an else-branch
 *  inside an executed function must not read as executed). Offsets are into the COMPILED source —
 *  `classicify` rewrites line contents in place, so when disk offsets disagree we re-derive the
 *  transformed text rather than mis-map. */
/* COUNT-DIFF MODE (§3d): the discard-take approach loses re-entries into pre-baseline vm scripts in
   this runner (measured: a no-discard take shows hrvdex maxCount 12 for a group whose interval take
   reports the script ABSENT — V8 counts the calls, the post-reset take drops the script). Instead of
   fighting that, run WITHOUT discard and subtract a once-measured BASELINE COUNT per line: the load
   phase is deterministic (§3a measured identical line sets across groups; counts inherit that), so
   `count > baselineCount` ⇔ the group itself executed the line. */
function intervalToCounts(v8result) {
  const files = {};
  for (const scr of v8result.result || []) {
    const url = String(scr.url || '');
    const p = url.startsWith('file://') ? url.slice(7) : url;
    if (!p.startsWith(ROOT) || !p.endsWith('.js') || p.includes('node_modules')) continue;
    let src;
    try {
      src = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const ranges = [];
    let maxEnd = 0;
    for (const fn of scr.functions || [])
      for (const r of fn.ranges || []) {
        ranges.push(r);
        if (r.endOffset > maxEnd) maxEnd = r.endOffset;
      }
    if (!ranges.length) continue;
    if (maxEnd > src.length + 8) {
      try {
        src = DexBuild.classicify(src);
      } catch {}
    }
    const lineOfOffset = [];
    {
      let line = 1;
      for (let i = 0; i < src.length; i++) {
        lineOfOffset[i] = line;
        if (src[i] === '\n') line++;
      }
      lineOfOffset[src.length] = line;
    }
    ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const lineCount = {};
    for (const r of ranges) {
      const a = lineOfOffset[Math.min(r.startOffset, src.length)] || 1;
      const b = lineOfOffset[Math.max(0, Math.min(r.endOffset - 1, src.length))] || a;
      for (let ln = a; ln <= b; ln++) lineCount[ln] = r.count;
    }
    const rel = p.slice(ROOT.length).replace(/^\/+/, '');
    files[rel] = lineCount;
  }
  return files;
}

function intervalToLines(v8result) {
  const files = {};
  for (const scr of v8result.result || []) {
    const url = String(scr.url || '');
    const p = url.startsWith('file://') ? url.slice(7) : url;
    if (!p.startsWith(ROOT) || !p.endsWith('.js') || p.includes('node_modules')) continue;
    let src;
    try {
      src = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const ranges = [];
    let maxEnd = 0;
    for (const fn of scr.functions || [])
      for (const r of fn.ranges || []) {
        ranges.push(r);
        if (r.endOffset > maxEnd) maxEnd = r.endOffset;
      }
    if (!ranges.length) continue;
    if (maxEnd > src.length + 8) {
      try {
        src = DexBuild.classicify(src);
      } catch {
        /* keep disk source; worst case is a clipped tail line */
      }
    }
    const lineOfOffset = [];
    {
      let line = 1;
      for (let i = 0; i < src.length; i++) {
        lineOfOffset[i] = line;
        if (src[i] === '\n') line++;
      }
      lineOfOffset[src.length] = line;
    }
    /* outer-to-inner: wider ranges first, then nested overrides repaint. */
    ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const lineCount = new Map();
    for (const r of ranges) {
      const a = lineOfOffset[Math.min(r.startOffset, src.length)] || 1;
      const b = lineOfOffset[Math.max(0, Math.min(r.endOffset - 1, src.length))] || a;
      for (let ln = a; ln <= b; ln++) lineCount.set(ln, r.count);
    }
    const rel = p.slice(ROOT.length).replace(/^\//, '');
    const lines = [...lineCount.entries()]
      .filter(([, c]) => c > 0)
      .map(([ln]) => ln)
      .sort((x, y) => x - y);
    if (lines.length) files[rel] = lines;
  }
  return files;
}

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
  sandbox.addEventListener = noop; // RENDER-HARNESS §RN: ECGScope._bindEvents calls window.addEventListener
  sandbox.removeEventListener = noop;
  return vm.createContext(sandbox);
}

function loadInto(ctx, file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) throw new Error('module not found: ' + file);
  // ESM-MIGRATION Phase 2: a converted co-load DSP (glucodex-dsp.js) ships top-level import/export the
  // shared vm realm can't eval. classicify() sheds the module syntax (the IIFE + window attaches remain),
  // so the DSP loads exactly as before. No-op on classic files, so it is safe to run on every module.
  const code = DexBuild.classicify(readFileSync(p, 'utf8'));
  /* ABSOLUTE path as the vm filename. V8 attributes coverage to this URL, and c8 keeps only files
     that resolve under the project root — with the RELATIVE name it kept none of them, so a coverage
     run reported on the harness and silently omitted every DSP it had just exercised. classicify()
     replaces line CONTENTS in place (^…$ with /gm), so line numbers still match the file on disk. */
  vm.runInContext(code, ctx, { filename: p });
}

/* ── 2 · gather sources (static checks) and fixtures (export completeness) ── */
const SHIPPED_INLINED = new Set(); // every .js the owned bundles inline — the lint's scope floor
function readSources() {
  const wanted = [
    'tools/regen-goldens.mjs', // §F1.5 — the dispatcher must keep naming every node with a regen path
    // The fold itself is gated by source scan: it routes the O2Ring finger pleth and owns the trio
    // completeness count, and neither is reachable by executing anything from here.
    'tools/trio-batch.mjs',
    /* CROSS-DEVICE-DRIFT-AND-CLOSURE §5 — `closeTriple` mirrors `fitClockClosure`'s tolerance rule
       because one is bundled and the other is not. Two copies of a threshold drift apart silently, so
       the closure-identity gate reads the rule out of BOTH files as text and compares them. */
    'tools/drift-report.js',
    /* KNOWN-CLOCK-FOLLOWUPS §3 — the drawn-axis refusal lives in this tool's CLI loop, not its exported
       surface, so it is gated as TEXT. Its PAT target is the Wellue finger PPG, the one device whose
       axis is drawn on every stream measured (20/20). */
    'tools/pat-host-offset.mjs',
    'tools/regen-integrator-goldens.mjs',
    /* §4.3 — the §3.1 bootstrap exemption is a CONTRACT BETWEEN TWO FILES: this tool matches the
       §3.1 assertion's label to recognise a first-generation fixture. A rename in dex-tests.js would
       silently re-close the deadlock, so the label is read out of the tool as text and compared. */
    'tools/verify-fixtures.mjs',
    /* CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS §3 — the cohort desat-recall matcher is implemented TWICE
       (cohort-regression.js + cohort-runner.html), independently, with the same [-10s,+60s] window. No
       executable entry spans both, so cross-site agreement is asserted by source scan (the DA-II §2.2
       DesSev pattern). MUST be listed in BOTH lanes: the browser lane's SOURCE_FILES needs the same two
       entries or the scan reads nothing there — exactly the motiondex-dsp.js hole noted in that file. */
    'cohort-regression.js',
    'cohort-runner.html',
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
    'event-coupling.js', // §9.5 — pin its LCG multiply too (it carries the same 1103515245 clone)
    'crossnight-envelope.js',
    'integrator-app.js',
    'integrator-render.js',
    'ecgdex-app.js',
    'ppgdex-app.js',
    'pulsedex-app.js',
    'pulsedex-render.js',
    'motiondex-render.js',
    'hrvdex-app.js',
    'oxydex-app.js',
    'oxydex-render.js',
    'oxydex-fusion.js',
    /* DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §AD — the ANALYSIS lane's two OxyDex consumers, read by the
       'no bare OxyDex._bare helper' scan. Neither file's TEXT was loaded in either lane, which is why a
       bare `processNight(...)` in both went unseen after the back-compat global spray was removed. */
    /* BLANK-ON-PRINT-FLEET §3 — the entrance-guard parity gate reads BOTH: the required selector
       set is DERIVED from ans-design.css's from-opacity:0 keyframes, so a newly-animated selector
       fails until it is guarded. Must be listed in BOTH lanes or the scan reads nothing in one. */
    'ans-design.css',
    'entrance-guard.js',
    'nsrr-adapter.js',
    'odi-bias-analysis.js',
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
    /* REGEN-CORPUS-PATH-FOLLOWUPS §3.4 — the corpus-resolution scan reads the WHOLE regen family plus
       verify-fixtures above. These two tools are the write half and the verify half of one workflow and
       they silently disagreed about where uploads/ is; a scan that covered only the core would miss a
       per-node tool that re-hardcodes the path, which is exactly how the divergence arose. Listed in
       BOTH lanes — the browser lane fetches the same set or the scan reads nothing there. */
    'tools/regen-goldens-core.mjs',
    'tools/regen-oxydex-goldens.mjs',
    'tools/regen-ecgdex-goldens.mjs',
    'tools/regen-ppgdex-goldens.mjs',
    'tools/regen-pulsedex-goldens.mjs',
    'tools/regen-hrvdex-goldens.mjs',
    'tools/regen-glucodex-goldens.mjs',
    'tools/regen-cpap-goldens.mjs',
    'tools/regen-motiondex-goldens.mjs',
    // The release-hygiene leg scans these two: build-docs.mjs owns the list of deploy paths it
    // rewrites, and release.mjs must NOT carry a second copy of it (its hardcoded copy had drifted
    // and omitted sitemap.xml / feed.xml / llms-full.txt / docs/index.html).
    'tools/release.mjs',
    'tools/build-docs.mjs',
    'tools/build-analysis.mjs',
    'manifest-gate.js',
    'sensor-trio-worker.js',
    'sensor-trio-power-analysis.js',
    'sensor-trio-gpu.js',
    'hrvdex-render.js',
    'pat-gate.js',
    'pat-align.js',
    // Worker SOURCE text for the anti-inertness scan: pat-gate's clock refusals are only as real as the
    // arguments its one runtime caller passes, and that caller is a Web Worker no behavioural test can
    // drive (O2RING-PHASE4-PREMISE-REVIEW §4).
    'pat-feasibility-worker.js',
    /* The RENDERER, added 2026-09-02. The worker above was scanned and this file was not, and that
       asymmetry is exactly how `vdCorr` was published, carried across the worker boundary and dropped
       at the render step while every test stayed green. A layer nothing reads is a layer nothing
       checks. */
    'pat-feasibility.js',
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
    /* DEEP-AUDIT-III-FOLLOWUPS-II §6.9 — the OTHER host-booting orchestrator. `overdex-app.js` was
       listed and `data-unifier-app.js` was not, so a source scan over "every host-booting surface"
       would have read one of the two and reported itself clean. Both §10.1 consumers mutation-tested
       BLIND; a scan that closes them has to be able to see both. */
    'data-unifier-app.js',
    // TEST-COVERAGE-ANALYSIS 2026-07-15 — the analysis-page controllers, so the statistics-kernel
    // group can assert each one delegates to AnalysisStats (delegation-parity leg).
    'analysis-stats.js',
    'nights-icc-analysis.js',
    'sigma-no-reference-analysis.js',
    'cgm-hrv-coupling-analysis.js',
    'treatment-response-analysis.js',
    'odi-bias-analysis.js',
    'hrv-confound-analysis.js',
    /* THE ONLY PYTHON IN THIS LIST, and it is here because one rule has three implementations in two
       languages. `allan.py classify`, `clock.js CK_ALLAN_NOISE` and `ppgdex-dsp.js ALLAN_NOISE` all
       name a power-law noise type from an ADEV slope, and NOTHING compared them — the same shape as
       the closure-identity gate above, and as `registry-defs-parity`, both of which exist because two
       copies of one truth drift. Loaded as TEXT only; nothing here executes Python. */
    'capture-host/allan.py'
  ];
  const out = {};
  for (const f of wanted) {
    const p = join(ROOT, f);
    if (existsSync(p)) out[f] = readFileSync(p, 'utf8');
  }
  /* DEEP-AUDIT-III §1.4 — the scope must be DERIVED, not hand-maintained. The list above is curated,
     and nothing kept it in sync with what the bundler actually inlines, so the house-invariant Clock
     lint printed "clean across 70 files" while 44 SHIPPED files sat outside its scope — a gate
     failing OPEN by omission, and one of them (integrator-longitudinal.js) carried a live Date.parse.
     Take the union of every `data-inline-src` in the owned bundles: "any source" now means "any code
     we ship". Files are ADDED to the curated set, never removed, so no assertion that names a file
     can lose its input. */
  for (const b of ManifestGate.MANIFEST_BUNDLES.concat(['Data Unifier.html', 'OverDex.html'])) {
    const bp = join(ROOT, b);
    if (!existsSync(bp)) continue;
    const html = readFileSync(bp, 'utf8');
    for (const m of html.matchAll(/data-inline-src="([^"]+)"/g)) {
      const f = m[1];
      if (!/\.(?:js|mjs)$/.test(f)) continue;
      SHIPPED_INLINED.add(f);
      if (out[f]) continue;
      const fp = join(ROOT, f);
      if (existsSync(fp)) out[f] = readFileSync(fp, 'utf8');
    }
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
/* PAPER-ODI4-REPRODUCIBILITY §8 — the SubjectA pilot corpus, read as a PAIR OF INPUTS.
   NOT routed through readEquiv/pairCommitted: that puts a file in the "fixture" slot, and the
   `every equiv leg points at a fixture the ledger actually records` gate correctly reds on it —
   `ground_truth_nightN.json` is a second INPUT (the planted truth), not a derived export fixture, so
   FIXTURE-PROVENANCE.json rightly does not record it. The gate caught this on the first run; the fix is
   to stop mislabelling the file, not to widen the ledger. */
function readOdiPilot() {
  const out = {};
  const CSV = ['O2Ring S 2100_20260511231000.csv', 'O2Ring S 2100_20260512235500.csv', 'O2Ring S 2100_20260513225000.csv', 'O2Ring S 2100_20260514230500.csv', 'O2Ring S 2100_20260515232000.csv'];
  for (let n = 1; n <= 5; n++) {
    const inP = join(ROOT, 'uploads', CSV[n - 1]);
    const gtP = join(ROOT, 'uploads', 'ground_truth_night' + n + '.json');
    const rec = {};
    if (existsSync(inP)) {
      try {
        rec.input = readFileSync(inP, 'utf8');
      } catch {
        /* unreadable → absent */
      }
    }
    if (existsSync(gtP)) {
      try {
        rec.truth = JSON.parse(readFileSync(gtP, 'utf8'));
      } catch {
        /* unreadable → absent */
      }
    }
    if (rec.input || rec.truth) out[n] = rec;
  }
  return out;
}
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
      } catch {
        /* unreadable → treat as absent */
      }
    }
    if (fxP && existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch {
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
  /* PAPER-ODI4-REPRODUCIBILITY §4 — the SubjectA pilot corpus behind papers/odi4-ahi-bias.html, now
     COMMITTED (synthetic, seed 424242, synth-gen/2.1). `pairCommitted` because these live in the repo,
     not in DEX_UPLOADS: they are the paper's reference bytes, not somebody's recordings. Committed
     inputs mean CI re-runs this every push — the FIXTURE-VERIFICATION-GATE argument for why an
     adversarial COMMITTED twin beats a real one. Table 1 silently stopped reproducing for months
     precisely because nothing re-ran it. */
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
  // §10 LONG-CYCLE (OXYDEX-PB-DETECTOR-FOLLOWUPS §5): 8 cycles at 110 s — the 90-130 s upper band,
  // which no other committed input reaches (the others run at 20 s, 50 s and ~420 s drift).
  pairCommitted('oxydex_longcycle', 'synthetic_oxydex_o2ring_longcycle.csv', null);
  pairCommitted('oxydex_odibasis', 'synthetic_oxydex_o2ring_gap.csv', null); // §5: a gap+artifact night that diverges the two ODI time bases
  pair('pulsedex_synth', 'synthetic_pulsedex_rr.txt', 'synthetic_pulsedex_golden.node-export.json');
  pair('hrvdex_synth', 'synthetic_hrvdex_welltory.csv', 'synthetic_hrvdex_golden.node-export.json');
  pair('glucodex_synth', 'synthetic_glucodex_lingo.csv', 'synthetic_glucodex_golden.node-export.json');
  pair('ppgdex_synth', 'synthetic_ppgdex_verity.txt', 'synthetic_ppgdex_golden.node-export.json');
  // ADVERSARIAL PpgDex FINGER twin (PPGDEX-O2RING-FINGER-SITE §6) — input only, NO golden. Its job is
  // not to pin bytes but to assert the invariants the WRIST twin structurally cannot express: a
  // single-optical-column file must parse at all; its LED agreement must be null and never 100; the
  // in-band 156 sentinel must split into rejected-vs-kept by ISOLATION rather than by value; and a
  // beat whose span touches a gap must be dropped, not filled. pairCommitted so a DEX_UPLOADS
  // real-corpus override cannot hide it.
  pairCommitted('ppgdex_finger', 'synthetic_ppgdex_o2ring_finger.txt', 'synthetic_ppgdex_o2ring_finger_golden.node-export.json');
  // PPG-FOOT-PLACEMENT §0 — the INVERTED-convention twin, the polarity the real hardware produces.
  pairCommitted('ppgdex_inverted', 'synthetic_ppgdex_verity_inverted.txt', 'synthetic_ppgdex_inverted_golden.node-export.json');
  // The FRAGMENTED Verity twin (INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.2). Every other committed
  // PpgDex input is contiguous, so `coverage()` returns null on all of them and NOTHING committed
  // exercised the emitter — the gap derivation was gated only by inputs hand-built inside the test,
  // which is weaker in exactly the way the parent brief's §5 warns about. pairCommitted (not pair):
  // a repo artifact, so a DEX_UPLOADS real-corpus override cannot turn this gate into a silent skip.
  pairCommitted('ppgdex_gapped', 'synthetic_ppgdex_verity_gapped.txt', 'synthetic_ppgdex_gapped_golden.node-export.json');
  /* INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS §1 — the INTEGRATOR-FACING rich export. Same committed
     input as `ppgdex_synth`; only `compute`'s `{rich:true}` differs, so the pair isolates that flag. */
  pairCommitted('ppgdex_rich', 'synthetic_ppgdex_verity.txt', 'synthetic_ppgdex_rich_golden.node-export.json');
  /* ECGDEX-EDR-RESP-ACCURACY §7.4 — the ECGDex half of the same hole. Same committed input as
     `ecgdex_synth`; only `compute`'s `{rich:true}` differs, so the pair isolates that flag. */
  pairCommitted('ecgdex_rich', 'synthetic_ecgdex_h10.txt', 'synthetic_ecgdex_rich_golden.node-export.json');
  pair('ecgdex_synth', 'synthetic_ecgdex_h10.txt', 'synthetic_ecgdex_golden.node-export.json');
  // ADVERSARIAL ECGDex twin — a COMMITTED FRAGMENTED recording (INTEGRATOR-GAP-AWARE-OVERLAP part 2).
  // The clean twin above is contiguous, so nothing committed exercised `recording.coverage` — which is
  // exactly how §5 describes the defect surviving every gate: "the equiv/GATE-C fixtures are
  // single-recording and gapless, so the envelope IS the coverage there". pairCommitted (not pair):
  // the input is a repo artifact, so a DEX_UPLOADS real-corpus override cannot hide it.
  pairCommitted('ecgdex_gapped', 'synthetic_ecgdex_h10_gapped.txt', 'synthetic_ecgdex_gapped_golden.node-export.json');
  // MotionDex IMU leg (MOTIONDEX-BUILD-2026-07-17 §5): a COMMITTED synthetic Polar ACC stream →
  // buildNodeExport(compute({acc,chestAcc})) ≡ the committed golden. pairCommitted (repo artifact,
  // resolved against ROOT/uploads) so a DEX_UPLOADS real-corpus override cannot hide it.
  pairCommitted('motiondex', 'synthetic_motiondex_acc.txt', 'synthetic_motiondex_golden.node-export.json');
  // ADVERSARIAL GlucoDex twin — a COMMITTED 14 h sensor-change gap (FIXTURE-VERIFICATION-GATE-2026-07-14 §4).
  // The clean twin above trips NO FLAG.GAP_LONG, so nothing committed exercised the long-gap path — which is
  // exactly how DEEP-AUDIT-2026-07-14 §1 came back byte-identical on it, shipped as "export-inert", and left
  // the REAL Lingo night's fixture stale. pairCommitted (not pair): the input is a repo artifact, so it
  // resolves against ROOT/uploads and cannot be hidden by a DEX_UPLOADS override aimed at a real corpus —
  // same reasoning as the OxyDex adversarial twins.
  pairCommitted('glucodex_gap', 'synthetic_glucodex_lingo_gap.csv', 'synthetic_glucodex_gap_golden.node-export.json');
  // DEEP-AUDIT-VI F6 — the Clarity COLUMN-PICK twin: a serial Index counter + "Low" cells. One Low
  // cell used to flip the glucose pick to the Index column (headline metrics on ROW NUMBERS).
  pairCommitted('glucodex_clarity_low', 'synthetic_glucodex_clarity_low.csv', 'synthetic_glucodex_clarity_low_golden.node-export.json');
  // FOLLOWUPS §1.10 — the DEGENERATE-EDR twin: input only, no golden. Its job is an INVARIANT (a
  // rate that cannot be measured is refused, never substituted), not a byte pin.
  pairCommitted('ecgdex_flat_edr', 'synthetic_ecgdex_flat_edr.txt', null);

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
      } catch {
        /* unreadable → treat as absent */
      }
    }
    rec.fixtureFile = 'cpapdex_synthetic_edf_golden.node-export.json';
    if (rec.input !== undefined || rec.fixture !== undefined) out.cpapdex_edf = rec;

    /* FOLLOWUPS §1.9 — the MASK-OFF twin: a 20-min set whose mask is on for only the first 10 min.
       Input only, no golden: the assertion is an INVARIANT (a breaths/min is divided by the MEASURED
       window, not the recording length), and the real corpus cannot express it — mask-on was 1.000 on
       all 24 nights §1.5 folded, so every real night has wall ≡ mask-on and is silent by construction. */
    {
      const mo = {};
      let ok2 = true;
      for (const k of ['BRP', 'PLD']) {
        const p2 = join(UPLOADS, `cpapdex_maskoff_twin_${k}.edf`);
        if (!existsSync(p2)) {
          ok2 = false;
          break;
        }
        const b2 = readFileSync(p2);
        mo[k] = b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.byteLength);
      }
      if (ok2) out.cpapdex_maskoff = { input: mo };
    }
  }

  // ── CPAPDex LIVE-vs-SD COMPARATOR leg (CPAPDEX-LIVE-SD-COMPARATOR brief) ──────────────────────
  // The comparator golden is code-gated (a manifestHash claim), so it needs a dynamic leg or it is the
  // decoration the fixture-reproducibility gate abolishes. Its inputs are a SYNTHETIC pin-twin pair
  // (tools/gen-comparator-twin.mjs — one wall-clock flow sampled into two files, no recording of any
  // person), so both ship in git and this leg RUNS IN CI. The consuming assertion (comparator group)
  // readEDFs both and re-runs CPAPCross.compareChannel, diffing against the committed golden.
  {
    const liveP = join(UPLOADS, 'cpapdex_comparator_live_twin_BRP.edf');
    const sdP = join(UPLOADS, 'cpapdex_comparator_sd_twin_BRP.edf');
    const fxP = join(ROOT, 'uploads', 'cpapdex_comparator_golden.json');
    const rec = {};
    if (existsSync(liveP) && existsSync(sdP)) {
      const bl = readFileSync(liveP);
      const bs = readFileSync(sdP);
      rec.input = {
        live: bl.buffer.slice(bl.byteOffset, bl.byteOffset + bl.byteLength),
        sd: bs.buffer.slice(bs.byteOffset, bs.byteOffset + bs.byteLength)
      };
    }
    if (existsSync(fxP)) {
      try {
        rec.fixture = JSON.parse(readFileSync(fxP, 'utf8'));
      } catch {
        /* unreadable → treat as absent */
      }
    }
    rec.fixtureFile = 'cpapdex_comparator_golden.json';
    if (rec.input !== undefined || rec.fixture !== undefined) out.cpapdex_comparator = rec;
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
      } catch {
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
      } catch {
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
      } catch {
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
      } catch {
        /* gate self-skips */
      }
    }
  }
  // residue 2026-09-02-respiration-fusion-no-fixture — the respiration-fusion twins. Fixture-only:
  // the gate rebuilds all four cases in-code from tests/respiration-fusion-twins.js.
  {
    const fxR = join(ROOT, 'uploads', 'integrator_respiration_fusion_twins.node-export.json');
    if (existsSync(fxR)) {
      try {
        out.integrator_respiration_fusion_twins = {
          fixture: JSON.parse(readFileSync(fxR, 'utf8')),
          fixtureFile: 'integrator_respiration_fusion_twins.node-export.json'
        };
      } catch {
        /* gate self-skips */
      }
    }
  }
  // §4.3 — the apnea chance-null twins. Fixture-only: the gate rebuilds all four nights in-code.
  {
    const fxA = join(ROOT, 'uploads', 'integrator_apnea_null_twins.node-export.json');
    if (existsSync(fxA)) {
      try {
        out.integrator_apnea_null_twins = { fixture: JSON.parse(readFileSync(fxA, 'utf8')), fixtureFile: 'integrator_apnea_null_twins.node-export.json' };
      } catch {
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

/* DEAD-FIELD-HINTS-FLEET §5 — the dead-field-hint gate resolves each node's `lbl_*` writes against
   the ids that node's OWN .src.html defines, so it needs both halves together. Returns the surface
   text too (rather than leaning on readSrcHtml) because that list omits MotionDex and carries
   Integrator: a node missing from it would contribute zero ids and read as trivially clean, which is
   the vacuous-pass this gate exists to prevent. The JS list is READ FROM the <script src> block the
   bundler inlines — never globbed — so a module added to a node is covered automatically. */
function readNodeSurfaces() {
  const out = {};
  for (const node of ['CPAPDex', 'ECGDex', 'GlucoDex', 'HRVDex', 'MotionDex', 'OxyDex', 'PpgDex', 'PulseDex']) {
    const p = join(ROOT, node + '.src.html');
    if (!existsSync(p)) continue;
    const html = readFileSync(p, 'utf8');
    const js = {};
    for (const m of html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)) {
      if (/^https?:/i.test(m[1])) continue;
      const jp = join(ROOT, m[1]);
      if (existsSync(jp)) js[m[1]] = readFileSync(jp, 'utf8');
    }
    out[node] = { html: html, js: js };
  }
  return out;
}

/* CLAUDE.md wins on every conflict and is the first thing a session reads — so a FALSE claim in it
   misleads more reliably than a bug does. Nothing checked its factual assertions, and one had rotted:
   it said `clock.js` is "inlined by the owned bundler into every bundle" when three of the eight app
   bundles do not carry it at all, leaving `DexClock` undefined there. Nothing in CI could see it.

   The gatable subset is narrow ON PURPOSE. Auto-extracting every path CLAUDE.md names and asserting it
   exists was measured first and REJECTED: 11 of 75 read as "missing", nearly all legitimately so
   (ledgers deliberately retired into `provenance/` fragments, corpus suffixes like `_ECG.txt`, the
   `Foo.html` placeholder, two `*-list.txt` files killed in July) — ~15 % false positives, which is the
   noisy red that gets routed around rather than read.

   So claims are OPT-IN and carry their own value: CLAUDE.md writes `CLAIM <name> = <number>` inline and
   this reads the tree for the same number. Prose stays prose; only the number is load-bearing, so the
   gate cannot drift into policing wording. Node-lane only (fs reads) — the browser lane has no readdir,
   so `env.claudeMdClaims` is undefined there and the group SKIPs, mirroring docs-ledger/release-ledger. */
function readClaudeMdClaims() {
  const cm = join(ROOT, 'CLAUDE.md');
  if (!existsSync(cm)) return undefined;
  const claudeMd = readFileSync(cm, 'utf8');

  /* The number pattern is DELIBERATELY permissive, and the gate rejects what it should not have
     matched. `(\d+)` alone silently TRUNCATES: `CLAIM x = 5.5` yielded 5, so a fractional claim could
     pass a check it should fail — in the gate whose whole job is stopping CLAUDE.md from lying.
     Tightening to `(?!\.\d)` fixes the truncation and replaces it with SILENCE: the claim stops being
     parsed at all, and a claim nobody checks is the same defect one level up. So it matches the
     decimal, and `claimsMalformed` carries it to an assertion that reds by name. */
  const claims = {};
  const claimsMalformed = [];
  for (const m of claudeMd.matchAll(/CLAIM\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
    const raw = m[2];
    if (!/^\d+$/.test(raw)) {
      claimsMalformed.push(m[1] + ' = ' + raw);
      continue;
    }
    claims[m[1]] = Number(raw);
  }

  /* Read from the SHIPPED bundle, not from source or a builder list: the question this claim answers is
     what a user's browser actually gets. `data-inline-src` is the owned bundler's marker. */
  const APP_BUNDLES = ['OxyDex.html', 'PulseDex.html', 'HRVDex.html', 'ECGDex.html', 'PpgDex.html', 'GlucoDex.html', 'CPAPDex.html', 'MotionDex.html'];
  const clockBundles = [];
  const missingBundles = [];
  for (const b of APP_BUNDLES) {
    const p = join(ROOT, b);
    if (!existsSync(p)) {
      missingBundles.push(b);
      continue;
    }
    if (/data-inline-src="clock\.js"/.test(readFileSync(p, 'utf8'))) clockBundles.push(b);
  }

  // What the builder says it owns, read FROM the builder rather than restated here.
  let ownedBundles = null,
    orchestrators = null;
  try {
    const src = readFileSync(join(ROOT, 'tools', 'build.mjs'), 'utf8');
    const om = src.match(/ORCHESTRATORS\s*=\s*\[([^\]]*)\]/);
    if (om)
      orchestrators = om[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean).length;
    const mg = readFileSync(join(ROOT, 'manifest-gate.js'), 'utf8');
    const bm = mg.match(/MANIFEST_BUNDLES\s*=\s*\[([^\]]*)\]/);
    if (bm && orchestrators != null) {
      ownedBundles =
        bm[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean).length + orchestrators;
    }
  } catch {
    /* unreadable ⇒ leave null. `null` means UNKNOWN and the assertion reports that; it must never
       collapse to 0, which would read as "the builder owns nothing" and pass a wrong CLAIM. */
  }

  return { claudeMd, claims, claimsMalformed, clockBundles, missingBundles, appBundles: APP_BUNDLES, ownedBundles, orchestrators };
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
    'sigma-no-reference-analysis.html',
    'qrs-equiv-analysis.html',
    'qrs-yield-analysis.html',
    'cohort-harness.html',
    'cohort-runner.html',
    'cohort-regression.html',
    'PAT Feasibility.html',
    'index.html'
  ];
  /* PAPER-ODI4-REPRODUCIBILITY §6.3 — `odi-bias-analysis.html` moved from 'none' to 'self' because its
     SubjectA path FETCHES five committed LOCAL sample files, and under 'none' the browser refused every
     one: the page rendered an EMPTY TABLE with no error a reader would see, so the paper's own recipe
     could not be followed by anyone. Measured: 'none' -> 0 rows / 10 CSP errors; 'self' -> 5 nights,
     5 rows, 0 errors. 'self' still blocks every REMOTE origin, so the no-network invariant holds —
     same-origin cannot reach a CDN, a DOI or a dataset. Identical reasoning to CPAPDex.src.html, which
     already takes 'self' for exactly this reason. A page belongs in `self` ONLY if it demonstrably
     fetches a committed local corpus; the default for everything else stays 'none'. */
  const self = ['PpgDex Fusion Prototype.html', 'odi-bias-analysis.html'];
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
/* TOOL-INVOCABILITY SCOPE — DERIVED from the filesystem, never hand-curated (DEEP-AUDIT-III §1.4:
   a curated scope silently stops covering what it was written for). Node-lane only, like docsLedger:
   the browser lane cannot list a directory, so that group SKIPs there. */
function readToolSources() {
  const tdir = join(ROOT, 'tools');
  if (!existsSync(tdir)) return null;
  const out = {};
  for (const n of readdirSync(tdir)
    .filter((f) => f.endsWith('.mjs'))
    .sort())
    out[n] = readFileSync(join(tdir, n), 'utf8');
  return out;
}

/* CITATION-ATTRIBUTION-FOLLOWUPS §3 — hand the gate the ledger and the reader-facing SOURCE, and let
   the gate own the predicate (a precomputed boolean here would move the check out of the gate).
   SCOPE is editable, reader-facing source. FOLLOWUPS-II §2 settled the three surfaces the first cut
   left undecided, by measuring each rather than reasoning about it:
     · `papers/**` (html+md)   — IN. 32 DOI occurrences, ZERO problems. These are the published
       artifacts, so a wrong author list matters most here — the link still resolves and still lands on
       the paper being described, which is the defect a reader cannot detect. Gating a clean surface
       costs nothing today and is the whole point: it pins it against drift.
     · `docs/**.md`            — IN. 4 occurrences, zero problems. Authored specs no builder writes.
       `docs/*.html` stays OUT: those are served COPIES of root pages already gated at their source,
       so including them would double-report every finding.
     · `briefs/`               — OUT, and this is measured, not assumed. 49 occurrences, **17
       problems, all of them false** — a brief quotes a wrong attribution *in order to say it is
       wrong*. `CITATION-ATTRIBUTION-FOLLOWUPS` itself trips four times on the very defects it fixed.
       Gating briefs would make the gate loudest exactly where the repo is doing its job.
   Generated bundles remain excluded: their text is a copy of the DSP's, so including them reports every
   finding twice and names a file you must not edit. Node-lane only. */
function readCitations() {
  const lp = join(ROOT, 'audits', 'CITATION-VERIFICATION-2026-08-05.json');
  if (!existsSync(lp)) return null;
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(lp, 'utf8'));
  } catch {
    return null;
  }
  if (!ledger || !ledger.dois) return null;
  const surfaces = [];
  const add = (rel) => {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      return;
    }
    if (!/10\.\d{4,9}\//.test(text)) return;
    surfaces.push({ file: rel, text });
  };
  for (const f of readdirSync(ROOT).sort()) {
    if (!/ Reference\.html$/.test(f) && !/^[^/]+\.js$/.test(f)) continue;
    add(f);
  }
  /* papers/** (html+md) and docs/**.md — see the scope note above. Walked, not globbed, so a paper in
     a subdirectory cannot silently fall outside the gate. */
  const walk = (rel, keep) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) walk(r, keep);
      else if (keep.test(e.name)) add(r);
    }
  };
  walk('papers', /\.(html|md)$/);
  walk('docs', /\.md$/);
  return { ledger, surfaces };
}

/* WHAT BIOME ACTUALLY LOOKED AT — because for months it silently looked at everything except the
   biggest file in the repo.

   `biome ci` skips any file over `files.maxSize` and reports the skip as a WARNING, which does not
   fail the job. `tests/dex-tests.js` passed 1 MiB long ago, so the lint+format gate had been green on
   34,653 lines it never opened — a green that meant "checked 0 files" while reading like "checked".
   Two PRs in one day stated "biome clean" about edits to that file on the strength of it.

   Raising the cap fixes it once. This makes it stay fixed: the runner reports every includable file's
   size next to the configured cap, so the day the file grows past the new limit the suite says so
   instead of going quiet again. Node-lane only (it stats the tree), like docsLedger. */
function readBiomeCoverage() {
  const cfgP = join(ROOT, 'biome.json');
  if (!existsSync(cfgP)) return null;
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgP, 'utf8'));
  } catch {
    return { parseError: true };
  }
  const inc = (cfg.files && cfg.files.includes) || [];
  // Mirror biome's own selection closely enough to be honest: the positive globs are extensions, the
  // negative ones are prefixes/segments. Anything uncertain is INCLUDED, so this over-reports rather
  // than under-reports — the same fail-loud direction rebase-safe uses.
  const exts = inc.filter((g) => !g.startsWith('!')).map((g) => g.replace(/^\*\*\//, '').replace(/^\*/, ''));
  const negs = inc.filter((g) => g.startsWith('!')).map((g) => g.slice(1).replace(/\*\*/g, '').replace(/\/+$/, ''));
  const files = [];
  for (const rel of walkRepoPaths(ROOT)) {
    if (!exts.some((e) => rel.endsWith(e))) continue;
    if (negs.some((n) => n && (rel.startsWith(n.replace(/^\//, '')) || rel.includes(n.replace(/^\//, ''))))) continue;
    try {
      files.push({ path: rel, bytes: statSync(join(ROOT, rel)).size });
    } catch {
      /* vanished between walk and stat — not our business */
    }
  }
  return { maxSize: (cfg.files && cfg.files.maxSize) || null, defaultMaxSize: 1048576, files };
}

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
  /* CROSSNIGHT-ENVELOPE-SPEC §7's adoption table drifted from the filesystem twice (it omitted CPAPDex,
     then listed no non-emitters at all, so it read as full adoption). Hand it to the gate so the table
     is checked against `ls *-cross.js` rather than maintained by hand. */
  const csP = join(ROOT, 'docs/CROSSNIGHT-ENVELOPE-SPEC.md');
  const crossSpec = existsSync(csP) ? readFileSync(csP, 'utf8') : '';
  const longP = join(ROOT, 'integrator-longitudinal.js');
  const longHeader = existsSync(longP) ? readFileSync(longP, 'utf8').slice(0, 1600) : '';
  return { briefs, indexText, rootBriefNames, fsBriefNames, fsPaths, rootDocs, crossSpec, longHeader };
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
/* PRE-PUSH PARITY (`preflight-parity` group) — the `npm run check` script and the CI drift-guard job
   must run the same guards. They drifted, and it cost five red CI round-trips: `check` ran
   `build.mjs --check` but neither `build-analysis --check` nor `build-docs --check`, so a DSP edit
   passed locally and failed in CI at ~12 s, repeatedly. Both texts are fed in so the gate can compare
   them rather than trusting a comment. */
function readPreflight() {
  const pkgP = join(ROOT, 'package.json'),
    ciP = join(ROOT, '.github', 'workflows', 'tests.yml');
  if (!existsSync(pkgP) || !existsSync(ciP)) return null;
  return { pkgText: readFileSync(pkgP, 'utf8'), ciText: readFileSync(ciP, 'utf8') };
}

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
    'ORIENTATION.md',
    /* TRIO-POWER-N15-FINDINGS §181 — the sigma-triple gate calls the planted σ and this paper's
       published tables "ONE ATOMIC UNIT … change both, or neither", but it only ever compared three
       CODE copies to a hardcoded literal. Reading the paper lets it compare against the artifact it
       claims atomicity with, which is the half that was aspirational. */
    'papers/sensor-trio-nights.html'
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
      'dex-escape.js', // RENDER-HARNESS (§RN): escapeHTML — a top-level dep of the *-render.js review builders
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
      'pat-align.js',
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
      // ENGINE-VERIFICATION-FINDINGS §1.4 — the O2Ring finger pleth's own adapter (breaks the
      // oxydex-spo2 0.95 / polar-sense-ppg 0.85 tie that routed it 'ambiguous' and unanalyzed).
      'adapters/o2ring-ppg.js',
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
    ['oxydex-util.js', 'pulsedex-dsp.js', 'oxydex-dsp.js', 'hrvdex-dsp.js', 'glucodex-dsp.js', 'pat-gate.js', 'signal-orchestrate.js', 'dex-coload.js'].forEach((f) => loadInto(ctx, f));
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
    // MotionDex DSP (MOTIONDEX-BUILD-2026-07-17) — a clean IIFE that leaks no bare names + delegates
    // DexClock (loaded above); sets env.MotionDex/MOTIONDSP for its equiv leg (env.equiv.motiondex).
    'motiondex-dsp.js',
    // MOTIONDEX badge fail-open gate (DEEP-AUDIT-II §7.8) needs the real resolver in BOTH lanes.
    'motiondex-registry.js',
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
    /* MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS §2/§3/§4 — the ACC↔flow clock-recovery + resampling layer
       (`window.RespAccAnalysis`). It was in NEITHER lane: `nativeHz`, `toGrid` and the channel
       constructors each carry a separately-documented SILENT failure, all three fixed and none of them
       gated — so every one of those fixes rested on a comment. DOM-free and side-effect-free at load.
       Load failure → env.RespAccAnalysis undefined → that group's availability assert reds rather than
       the group quietly vanishing. */
    'resp-acc-analysis.js',
    // TEST-COVERAGE-FOLLOWUPS-II §1b — HRVDex's personalization already leaks its pure cited kernels as
    // bare globals (Object.assign(window,{…})) and loads headless, so NO source edit / NO re-bundle is
    // owed (the brief's "no seam" premise was wrong). Load it last so env can grab calcVo2Cat/getAgeBand.
    'hrvdex-profile.js',
    // §1b OxyDex sibling — ALSO test-only (no re-bundle): oxydex-profile.js's up* functions are top-level
    // globals and it loads headless once oxydex-util.js (sv/gv, DOM-guarded) is present, which it is (above).
    // Its initProfile() DOM init no-ops headless (sv guards on getElementById). env grabs upKarvonenZone/upBMILabel.
    'oxydex-profile.js',
    /* WEARABLE-HOST-AXIS-FOLLOWUPS §F5 — trio-batch's clock LINES. `printDriftFit`/`printClockFit` had
       zero coverage because nothing in trio-batch.mjs is callable (its night loop runs at import), so
       the one place a ppm becomes a sentence was the one place no assertion could reach. The formatters
       are pure and live here now; load failure → env.DriftReport undefined → that group's assert reds. */
    'tools/drift-report.js',
    'tools/tch-corpus.js'
  ].forEach((f) => {
    try {
      loadInto(ctx, f);
    } catch (e) {
      console.error(paint('  ! optional module failed to load: ' + f + ' — ' + e.message, C.yellow));
    }
  });

  // RENDER-HARNESS (DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §RN) — the *-render.js DISPLAY layer was previously
  // loaded ONLY as raw text (env.sources) and NEVER executed, so no test could pin a surfaced render value
  // (a ~325× mmol glucose error, a green-painted hypoxic SpO₂, "well controlled" on a severe AHI all shipped
  // green). Execute them here so their globals become assertable. They must load in an ISOLATED scope: their
  // top-level `const {fmtDate,fmtClock,…} = window.OxyDex._bare` destructures would otherwise collide with the
  // same bare names already in the shared realm (classicify leaks top-level decls). Wrapping each in an IIFE
  // scopes those decls while the `window.X`/`global.X` attaches (GluDisp · OxyDex.reviewView · CpapRender ·
  // PulseDex.reviewView) still escape to the sandbox. Deps (their DSP · dex-escape) are already loaded above.
  ['glucodex-render.js', 'oxydex-render.js', 'cpapdex-render.js', 'hrvdex-render.js', 'pulsedex-render.js', 'ecgdex-render.js', 'oxydex-fusion.js'].forEach((f) => {
    try {
      const p = join(ROOT, f);
      if (!existsSync(p)) return;
      const code = DexBuild.classicify(readFileSync(p, 'utf8'));
      vm.runInContext('(function(){\n' + code + '\n})();', ctx, { filename: f });
    } catch (e) {
      console.error(paint('  ! render module failed to load: ' + f + ' — ' + e.message, C.yellow));
    }
  });

  /* PAT-UNDER-PERBLOCK-ALIGNMENT §4 — the strict-matchRate statistics. NODE-ONLY (an .mjs
     orchestrator, not a bundled module), so the browser lane skips the group. The tool guards its
     CLI behind an entry-point check precisely so this import stays INERT — importing a tool that
     executes at module scope would start a full corpus run inside the test process. */
  /* REM-STAGING-FOLLOWUPS §2b — the expert-label join/scoring. NODE-ONLY (.mjs tool). Import is inert:
     the tool guards its CLI behind an entry-point check, so this does not start a scoring run. */
  /* Mutation TRIAGE — the pure attribution/grouping half. NODE-ONLY (.mjs tool); the import is inert
     because the tool guards its CLI behind an entry-point check. */
  let MutTriage = null;
  try {
    MutTriage = await import(new URL('../tools/mutate-triage.mjs', import.meta.url).href);
  } catch (e) {
    console.error(paint('  ! mutate-triage failed to load: ' + e.message, C.yellow));
  }

  let NsrrStage = null;
  try {
    NsrrStage = await import(new URL('../tools/nsrr-stage-validate.mjs', import.meta.url).href);
  } catch (e) {
    console.error(paint('  ! nsrr-stage-validate failed to load: ' + e.message, C.yellow));
  }

  let PatHostOffset = null;
  let PatStrict = null;
  /* ── THE COHORT WORKER, IN A RECONSTRUCTED REALM (DEEP-AUDIT-V-FOLLOWUPS Tier-4) ─────────────
     `cohort-worker.js` is 644 lines with zero test-group mentions, and Tier-4's own re-measurement
     found it the ONE row a grep count would have wrongly cleared: the single hit in tests/ is prose
     in a comment calling it a documented gap. So it is executed here rather than mentioned.
     The `pulse` KIND is the lean one — synth-gen + cohort-gen + kernel + clock + pulsedex-dsp — which
     is enough to prove the realm boots, the DSPs co-load without colliding, and a job returns a real
     envelope. ~4 s for one seed.
     ⚠️ `importScripts` must CLASSICIFY. The browser hands the worker classic scripts; in Node a
     dual-mode ESM source throws under plain eval, `loadScript` falls through to its served-only
     XHR path, and the boot fails with "XMLHttpRequest is not defined" — which is a fact about the
     harness, not the worker. Measured while writing this. */
  let CohortWorker = null;
  try {
    const { readFileSync: _rf } = await import('node:fs');
    const { join: _join } = await import('node:path');
    const _vm = (await import('node:vm')).default;
    const _req = (await import('node:module')).createRequire(import.meta.url);
    const _DexBuild = _req('../tools/build-core.js');
    const _root = new URL('..', import.meta.url).pathname;
    const boot = (kind) => {
      const posted = [];
      const ctx = _vm.createContext({});
      ctx.globalThis = ctx;
      ctx.self = ctx;
      ctx.postMessage = (m) => posted.push(m);
      ctx.performance = { now: () => Date.now() };
      ctx.console = { log() {}, warn() {}, error() {} };
      ctx.setTimeout = setTimeout;
      ctx.clearTimeout = clearTimeout;
      ctx.importScripts = (...urls) => {
        for (const u of urls) _vm.runInContext(_DexBuild.classicify(_rf(_join(_root, u), 'utf8')), ctx, { filename: u });
      };
      _vm.runInContext(_rf(_join(_root, 'cohort-worker.js'), 'utf8'), ctx, { filename: 'cohort-worker.js' });
      ctx.onmessage({ data: { type: 'init', kind } });
      return { posted, ctx };
    };
    const w = boot('pulse');
    const ready = w.posted[0];
    let done = null;
    if (ready && !ready.err) {
      w.ctx.onmessage({ data: { type: 'job', seed: 1, reqId: 7 } });
      done = w.posted[1];
    }
    /* An UNKNOWN kind exercises the failure path, so the assertions can show the ready/err contract
       discriminates rather than merely reporting success on the happy path. */
    const bad = boot('no-such-kind');
    CohortWorker = { ready, done, badReady: bad.posted[0] };
  } catch (e) {
    console.error(paint('  ! cohort-worker realm failed to build: ' + e.message, C.yellow));
  }

  let PatFiducial = null;
  try {
    PatFiducial = await import(new URL('../tools/pat-fiducial.mjs', import.meta.url).href);
  } catch (e) {
    console.error(paint('  ! pat-fiducial failed to load: ' + e.message, C.yellow));
  }
  try {
    PatStrict = await import(new URL('../tools/pat-matchrate-strict.mjs', import.meta.url).href);
  } catch (e) {
    console.error(paint('  ! pat-matchrate-strict failed to load: ' + e.message, C.yellow));
  }
  try {
    PatHostOffset = await import(new URL('../tools/pat-host-offset.mjs', import.meta.url).href);
  } catch (e) {
    console.error(paint('  ! pat-host-offset failed to load: ' + e.message, C.yellow));
  }

  const env = {
    PatStrict: PatStrict,
    PatFiducial: PatFiducial,
    CohortWorker: CohortWorker,
    NsrrStage: NsrrStage,
    MutTriage: MutTriage,
    PatHostOffset: PatHostOffset,
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
    OxyVO2abs: ctx.upVO2abs,
    OxyUP: ctx.UP,
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
    // RENDER-HARNESS (§RN) — executed render globals (OxyDex/PulseDex above already carry .reviewView +
    // PulseDex.tanakaHRmax); GluDisp/CpapRender + the hoisted classifiers hang off bare window.
    GluDisp: ctx.GluDisp,
    CpapRender: ctx.CpapRender,
    HrvRmssdClass: ctx.hrvRmssdClass,
    OxySpo2NightCV: ctx.oxySpo2NightCV,
    ECGScope: ctx.ECGUI && ctx.ECGUI.ECGScope, // §RN: canvas waveform explorer (axis-tick label drive)
    // §RN last finding — the two ECGScope time-axis helpers, hoisted out of the canvas draw so the
    // node lane can pin the tick spacing and the label text without a canvas shim.
    ECGUI: ctx.ECGUI,
    IntegratorDSP: ctx.IntegratorDSP,
    IntegratorTCH: ctx.IntegratorTCH,
    PATAlign: ctx.PATAlign,
    IntegratorLong: ctx.IntegratorLong,
    DexPatientGen: ctx.DexPatientGen,
    parseTimestamp: ctx.parseTimestamp,
    DexClock: ctx.DexClock,
    PulseDex: ctx.PulseDex,
    OxyDex: ctx.OxyDex,
    HRVDex: ctx.HRVDex,
    MotionDex: ctx.MotionDex,
    MOTIONDSP: ctx.MOTIONDSP,
    SignalFrame: ctx.SignalFrame,
    DexExport: ctx.DexExport,
    exportName: ctx.exportName,
    EXPORT_KINDS: ctx.EXPORT_KINDS,
    SignalSpec: ctx.SignalSpec,
    SignalAdapters: ctx.SignalAdapters,
    EventCoupling: ctx.EventCoupling,
    PATGate: ctx.PATGate,
    SignalOrchestrate: ctx.SignalOrchestrate,
    DexCoload: ctx.DexCoload,
    DexIngest: ctx.DexIngest,
    pickProvenanceBanner: ctx.pickProvenanceBanner,
    Quantity: ctx.Quantity,
    DexUnits: ctx.DexUnits,
    /* Run `fn` with a global temporarily REMOVED from the module realm, then put it back.
       Some code paths are guarded by `typeof X !== 'undefined'` and only execute when a module is
       ABSENT — the quantity.js fallback arms in hrvdex-dsp's computeDerived, for instance. The
       harness always loads quantity.js, so those arms are dead under test and no fixture can reach
       them; mutants inside them are unkillable for a reason that has nothing to do with the tests.
       The DSPs run in a vm context the assertions cannot see, so the toggle has to be handed in from
       the runner. Restoration is in a `finally`; the caller should ASSERT it afterwards, because a
       global left mutated by one group fails in an unrelated one. */
    /* Construct a Date INSIDE the module realm. `instanceof` is realm-scoped: the DSPs run in a vm
       context with its own intrinsics, so a host-constructed `new Date(ms)` fails
       `x instanceof Date` there and any code guarded that way silently takes its else-branch.
       hrvdex-dsp L718 does exactly that — `r._date instanceof Date ? r._date.getUTCHours() : 8` —
       so a fixture passing a host Date gets hour 8 at every hour, and three "different" hours pin
       one arm three times. Nothing errors; the branch just never runs. */
    realmDate: function (ms) {
      /* The factory is EVALUATED INSIDE the context. `ctx.Date` is not reachable — a contextified
         sandbox does not expose the realm's intrinsics as own properties, and reading it gives
         undefined ("ctx.Date is not a constructor"). Running the arrow inside the realm returns a
         constructor that belongs to it. */
      if (!ctx.__realmDate) ctx.__realmDate = vm.runInContext('(ms) => new Date(ms)', ctx);
      return ctx.__realmDate(ms);
    },
    withGlobalRemoved: function (name, fn) {
      var saved = ctx[name];
      try {
        ctx[name] = undefined;
        return fn();
      } finally {
        ctx[name] = saved;
      }
    },
    adaptEnvelopeNode: ctx.adaptEnvelopeNode,
    recWindow: ctx.recWindow,
    overlapInterval: ctx.overlapInterval,
    fuseHRVConsensus: ctx.fuseHRVConsensus,
    // §4.3 — the apnea fusion, so the twins' equiv leg drives the same seam the regen tool does.
    fuseApneaEvents: ctx.fuseApneaEvents,
    fuseRespirationRate: ctx.fuseRespirationRate,
    fusePeriodicBreathing: ctx.fusePeriodicBreathing,
    dedupeRecs: ctx.dedupeRecs,
    runFusion: ctx.runFusion,
    buildFusionExport: ctx.buildFusionExport,
    fusePulseCrossCheck: ctx.fusePulseCrossCheck,
    fuseHrvResource: ctx.fuseHrvResource,
    fuseCvhrCorroboration: ctx.fuseCvhrCorroboration,
    oxyComputeFusion: ctx.oxyComputeFusion,
    reconstructEventTMs: ctx.reconstructEventTMs,
    pearson: ctx.pearson,
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
    MOTION_REGISTRY: ctx.MOTION_REGISTRY,
    MotionRegistry: ctx.MotionRegistry,
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
    RespAccAnalysis: ctx.RespAccAnalysis,
    /* The TOOL's source, for the single-source scan beside the parser's own gate. Node-lane only —
       the browser lane cannot read a file off disk, and that group SKIPs there. */
    respAccHeadlessSrc: (() => {
      try {
        return readFileSync(join(ROOT, 'tools', 'resp-acc-headless.mjs'), 'utf8');
      } catch {
        return null;
      }
    })(),
    DriftReport: ctx.DriftReport,
    TchCorpus: ctx.TchCorpus,
    docs: readDocs(),
    docsLedger: readDocsLedger(),
    biomeCoverage: readBiomeCoverage(),
    citations: readCitations(),
    /* The rebase classifier decides GENERATED-vs-SOURCE for every conflicted path, and being wrong
       toward GENERATED reverts someone's work silently. It shipped with a `--classify` entry point
       documented as "used by the self-test" and no self-test — no group, nothing in `npm run check`,
       nothing calling it. Node-lane only (an ESM import of a tool), so the browser lane SKIPs, exactly
       like docsLedger. */
    /* device-stability's PURE decision cores — the per-stream verdict, the common-τ read, and the
       is-it-a-crystal test. Same shape and same reason as rebaseClassify below: the tool walks a
       corpus that CI does not have, so what can be gated is the reasoning, driven by value. Node-lane
       only (an ESM import of a tool), so the browser lane SKIPs. */
    deviceStability: deviceStability,
    /* beat-correspondence's PURE core (vpAlign, nccAnchor) — same shape and reason as deviceStability. */
    beatCorrespondence: beatCorrespondence,
    circularStats: circularStats,
    rebaseClassify: rebaseClassify,
    /* the porcelain parse, separated from the I/O so the gate can drive it by value — see the group */
    rebaseParsePorcelain: rebaseParsePorcelain,
    /* The verification-stamp guard's decision core. Pure, so the gate drives it by value rather than
       running a rebase. The three-way split IS the content: a guard alarming on every stale stamp would
       fire on any branch with a deliberately-unverified fixture, and a warning that cries when nothing
       is wrong is one people scroll past — leaving the failure where it was, plus noise. */
    rebaseClassifyStamps: rebaseClassifyStamps,
    /* land-pr's PURE decision core. Same shape and same reason as rebaseClassify above: the tool's
       value is a state machine that must not be re-derived by hand in every session, and a state
       machine is only trustworthy if something drives it. Node-lane only (an ESM import of a tool),
       so the browser lane SKIPs. No `gh`, no network, no clock — decide() is a pure function. */
    landDecide: landDecide,
    qdClassify: qdClassify,
    qdPick: qdPick,
    qdIdleMin: QD_IDLE_MIN,
    qdStarvedMin: QD_STARVED_MIN,
    commitShape: commitShape,
    captureRecapture: captureRecapture,
    beatCrEstimate: beatCrEstimate,
    beatCrSummary: beatCrSummary,
    attenuateAndRecover: attenuateAndRecover,
    beatBuildTemplate: beatBuildTemplate,
    /* REGEN-CORPUS-PATH-FOLLOWUPS-II §1 — A2's OWN scope. The SPDX lint used to read `env.sources`,
       a list curated to serve OTHER source-scan gates, so a file was licence-checked iff some unrelated
       scan happened to want its text. `CLAUDE.md` §📜 states the invariant as universal. This walks the
       tree instead (same walker docs-ledger uses, same exclusions) and hands the gate the first 4 KB of
       every .js/.mjs — headers live at the top, and 203 × 4 KB is cheap. The gate keeps its own regexes;
       handing it a precomputed boolean would move the predicate out of the gate. Node-lane only. */
    /* WALKER · nested repositories. `walkRepoPaths` feeds BOTH the A2 SPDX gate and the docs-ledger
       link inventory, and a git worktree placed inside the checkout (the house rule puts them at
       ../wt-<task>, but sessions do nest them) carries a `.git` entry that `isExcluded` skips as a
       dot-entry — so the marker was invisible while the whole worktree was walked as this repo's
       source. Observed 2026-08-04: A2 reported 10 missing SPDX headers, all inside other sessions'
       worktrees at older commits, a RED that CI cannot reproduce because CI clones clean.

       Verified against a SYNTHETIC fixture rather than against whatever worktrees happen to exist —
       a check that only fires when someone nests one is a check that is vacuous in CI, which is the
       failure mode this repo keeps meeting. Built and torn down here; the assertions live in the
       house-lint group. */
    walkerNestedRepo: (() => {
      let tmp = null;
      try {
        tmp = mkdtempSync(join(tmpdir(), 'tepna-walk-'));
        mkdirSync(join(tmp, 'normal'));
        writeFileSync(join(tmp, 'normal', 'keep.js'), '// keep\n');
        mkdirSync(join(tmp, 'nested'));
        writeFileSync(join(tmp, 'nested', '.git'), 'gitdir: /elsewhere\n'); // linked-worktree marker
        writeFileSync(join(tmp, 'nested', 'inside.js'), '// must not be walked\n');
        mkdirSync(join(tmp, 'nested', 'deep'));
        writeFileSync(join(tmp, 'nested', 'deep', 'deeper.js'), '// nor this\n');
        const paths = walkRepoPaths(tmp);
        return {
          sawNormalDir: paths.indexOf('normal') >= 0,
          sawNormalFile: paths.indexOf('normal/keep.js') >= 0,
          sawNestedDir: paths.indexOf('nested') >= 0,
          sawNestedFile: paths.indexOf('nested/inside.js') >= 0,
          sawNestedDeep: paths.indexOf('nested/deep/deeper.js') >= 0,
          n: paths.length
        };
      } catch (_e) {
        return null;
      } finally {
        try {
          if (tmp) rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    })(),
    authoredJsHeads: (() => {
      try {
        const out = {};
        for (const rel of walkRepoPaths(ROOT)) {
          if (!/\.(?:js|mjs)$/.test(rel)) continue;
          try {
            const fd = openSync(join(ROOT, rel), 'r');
            const buf = Buffer.alloc(4096);
            const n = readSync(fd, buf, 0, 4096, 0);
            closeSync(fd);
            out[rel] = buf.slice(0, n).toString('utf8');
          } catch {}
        }
        return out;
      } catch {
        return null;
      }
    })(),
    /* BADGE-COVERAGE-AUDIT (corrected) — every node's UI-layer source, so the badge gate can read the
       literal ids each `evBadge(...)` call site passes and resolve them against that node's OWN
       registry. Node-lane only (readdir); the browser lane SKIPs, as docs-ledger does. */
    /* WHICH SOURCE LAYERS CAN A SCAN READ AT ALL? Measured 2026-09-02: 38 of 112 root-level runtime
       `*.js` are in NEITHER lane's source list, so no text-reading assertion can see them — including
       all eight `*-registry.js` (CLAUDE.md §🎫's "Grade source of truth") and the spine modules
       `kernel-constants.js` / `metric-registry.js`.

       That blind spot is not hypothetical: `pat-feasibility.js` was outside both lists while its
       WORKER was in them 5 times, and that asymmetry is exactly how a published `vdCorr` reached no
       surface with the whole suite green. A layer nothing reads is a layer nothing checks.

       The NODE side is taken from the runner's own assembled sources rather than re-parsed, so it
       cannot drift from what the lane actually has. Node-lane only (readdir); the browser SKIPs. */
    sourceVisibility: (() => {
      try {
        const files = readdirSync(ROOT).filter((f) => /^[a-z0-9][a-z0-9-]*\.js$/.test(f));
        const suite = readFileSync(join(ROOT, 'Dex-Test-Suite.html'), 'utf8');
        const j = suite.indexOf('SOURCE_FILES');
        const seg = j >= 0 ? suite.slice(j, suite.indexOf('];', j)) : '';
        const browser = [...seg.matchAll(/'([A-Za-z0-9_.\-]+\.(?:js|mjs|html|css))'/g)].map((m) => m[1]);
        return { files, browser };
      } catch {
        return null;
      }
    })(),
    nodeUiSources: (() => {
      try {
        const out = {};
        for (const f of readdirSync(ROOT)) {
          const m = /^([a-z0-9]+)-(?:render|app|fusion|overview|chartbadges)\.js$/.exec(f);
          if (!m) continue;
          (out[m[1]] = out[m[1]] || {})[f] = readFileSync(join(ROOT, f), 'utf8');
        }
        return out;
      } catch {
        return null;
      }
    })(),
    /* WEARABLE-DRIFT-DIRECT §6 — the pure decision predicate from tools/dual-clock-rate.mjs, so the
       "is there a second clock at all" rule is gated on VALUES rather than only source-scanned. The
       module guards its own main, so importing it fires no I/O. Node-lane only; the browser lane has
       no ESM tool import and SKIPs, as docs-ledger does. */
    DualClock: await (async () => {
      try {
        return await import('../tools/dual-clock-rate.mjs');
      } catch {
        return null;
      }
    })(),
    /* PAT-GEOMETRY-PROBE §2 — the five geometric signatures every timeline defect in this project has
       turned out to be (saturation · sawtooth · censoring · drawn · step), as pure detectors. The group
       plants each shape and asserts the SPECIFICITY MATRIX: own probe fires, other four silent. Same
       module the tool runs, so detector and CLI cannot drift. Node-lane only; the browser lane has no
       ESM tool import and SKIPs, as docs-ledger does. */
    GeomProbe: await (async () => {
      try {
        return await import('../tools/geometry-probe.mjs');
      } catch {
        return null;
      }
    })(),
    /* PAT-GEOMETRY-PROBE §6 — the PASSTHROUGH test. GeomProbe's group tests the DETECTORS; this tests
       the alignment FUNCTIONS, which is the actual mutation analogue: a synthetic ECG+PPG whose lag is
       flat by construction goes through the production chain, and any shape in the output was put
       there by the code. Then each planted input defect must reach the output, or the chain is blind
       rather than clean. Node-lane only. */
    GeomPass: await (async () => {
      try {
        return await import('../tools/geometry-passthrough.mjs');
      } catch {
        return null;
      }
    })(),
    toolSources: readToolSources(),
    sources: readSources(),
    // §F1.5 — the TCH golden's input builder, shared with tools/regen-integrator-goldens.mjs
    tchGoldenInputs: (() => {
      try {
        return require(join(ROOT, 'tests', 'tch-golden-inputs.js')).tchGoldenInputs;
      } catch {
        return null;
      }
    })(),
    // §4.3 — the apnea-null twins' input builder, shared with tools/regen-integrator-goldens.mjs so
    // the gate and the tool cannot drift (the sibling-divergence class §F1.5 fixed for the TCH golden).
    apneaNullTwins: (() => {
      try {
        return require(join(ROOT, 'tests', 'apnea-null-twins.js')).apneaNullTwins;
      } catch {
        return null;
      }
    })(),
    respirationFusionTwins: (() => {
      try {
        return require(join(ROOT, 'tests', 'respiration-fusion-twins.js')).respirationFusionTwins;
      } catch {
        return null;
      }
    })(),
    // §1.4 — the scope FLOOR: every .js the owned bundles inline. The lint asserts its scanned set
    // covers this, so the coverage can never silently shrink back to a hand-maintained list again.
    shippedInlined: Array.from(SHIPPED_INLINED).sort(),
    trackedFiles: readTrackedFiles(),
    // FIXTURE-VERIFICATION-GATE §1 — computeHash is async (crypto.subtle) and the assertion harness is
    // synchronous, so the discrimination probe is computed HERE and asserted there. ManifestGate itself
    // is passed for the (sync) closure-membership self-tests.
    ManifestGate,
    computeHashProbe: await readComputeHashProbe(),
    fixtures: readFixtures(),
    equiv: readEquiv(),
    odiPilot: readOdiPilot(),
    hosts: readHosts(),
    srcHtml: readSrcHtml(),
    nodeSurfaces: readNodeSurfaces(),
    nonBundleCsp: readNonBundleCsp(),
    claudeMdClaims: readClaudeMdClaims(),
    onGroup: PROGRESS ? progressReporter() : undefined,
    /* XMT GROUND TRUTH (analysis/xmt-fixture.js) — loaded through the SAME `loadInto` path the DSPs
       use, so c8 attributes per-function coverage to it exactly as it does for a DSP. That matters:
       `tools/extreme-mutate.mjs` reads those counts, and Descartes' rule makes coverage a
       PRECONDITION for the pseudo-tested verdict — a fixture c8 cannot see would classify
       `not-covered` and the validation would fail for a reason that is not about the tool.
       Its own realm, so nothing it defines can reach the DSP sandbox. */
    xmtFixture: (() => {
      try {
        const c = makeSandbox();
        loadInto(c, 'xmt-fixture.js');
        return c.XmtFixture || (c.globalThis && c.globalThis.XmtFixture) || null;
      } catch {
        return null;
      }
    })(),
    analysisTools: readAnalysisTools(),
    bundleCsp: readBundleCsp(),
    manifests: readManifests(),
    releaseLedger: readReleaseLedger(),
    discoverability: readDiscoverability(),
    preflight: readPreflight(),
    groupFilter: GROUP_FILTER || null,
    listOnly: LIST_ONLY
  };
  // Exact index selection. Set before the SHARD block so the two never both apply.
  if (GROUP_INDICES) env.shardIndices = GROUP_INDICES;

  const { runDexTests, auditSkips } = require('./dex-tests.js');

  /* Sharding is a TWO-PASS run, and it is cheap because pass 1 costs nothing: an inventory pass
     (listOnly) declares all N groups while executing ZERO of them (~0.07 s — every group body is
     skipped), which hands the planner the full group list. The planner then LPT-packs that list
     into balanced bins, and pass 2 executes only THIS shard's indices. Every shard process runs
     the same pure planner over the same inventory, so they agree on the partition with no
     coordination — and no group can fall between two shards. */
  /* VERIFY-DRAFTS SUITE MODE (2026-08-27, ledger d9dc764b324f). The standalone verifier built
     its own co-load realm and certified two drafts the suite then failed — "verified against a
     realm SHAPED LIKE the suite's" is not "verified in the suite's realm", and no imitation
     loader can promise otherwise. This hook removes the imitation: the suite loads everything
     exactly as it will for the gate, then hands ITS OWN ctx to the verifier and exits. The
     realm is authoritative by construction, not by replication. */
  if (process.argv.includes('--verify-drafts')) {
    const vd = await import('../tools/verify-drafts.mjs');
    process.exit(vd.verifyPile(ctx, undefined, { realmLabel: 'suite (run-tests.mjs --verify-drafts)' }));
  }
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

  if (__covPost && !process.env.DEX_IV_NODISCARD && !process.env.DEX_IV_COUNTS) await __covPost('Profiler.takePreciseCoverage'); // DISCARD: the load-time baseline (skipped in COUNTS mode — see intervalToCounts)
  const forked = JOBS && !SHARD && !AS_JSON && !LIST_ONLY && !INTERVAL_COV ? await runForked(JOBS) : null;
  const { groups, totalGroups, groupFilter } = forked ? { groups: forked, totalGroups: forked.length, groupFilter: GROUP_FILTER || null } : runDexTests(env);
  if (__covPost && process.env.DEX_IV_COUNTS) {
    const iv = await __covPost('Profiler.takePreciseCoverage');
    writeFileSync(INTERVAL_COV, JSON.stringify({ groupIndices: GROUP_INDICES ? [...GROUP_INDICES] : null, counts: intervalToCounts(iv) }));
    if (globalThis.__covKeepAlive) globalThis.__covKeepAlive.length = 0;
  } else if (__covPost) {
    const iv = await __covPost('Profiler.takePreciseCoverage'); // the GROUP interval, baseline-free
    if (process.env.DEX_IV_DEBUG)
      writeFileSync(
        INTERVAL_COV + '.raw',
        JSON.stringify(
          (iv.result || [])
            .filter((r) => r.url && !/node:|node_modules/.test(r.url))
            .map((r) => ({ url: r.url, fns: (r.functions || []).length, maxCount: Math.max(0, ...(r.functions || []).flatMap((f) => (f.ranges || []).map((x) => x.count))) }))
        )
      );
    writeFileSync(INTERVAL_COV, JSON.stringify({ groupIndices: GROUP_INDICES ? [...GROUP_INDICES] : null, files: intervalToLines(iv) }));
    if (globalThis.__covKeepAlive) globalThis.__covKeepAlive.length = 0;
  }

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
  /* ── PASSING assertions whose DETAIL reads as absence ─────────────────────────────────────────
     `T.ok(name, cond, detail)` prints `detail` on PASS as well as on failure, and authors write it
     as the FAILURE explanation. So a green run prints lines like "✓ the worker catch-fallback exists
     — catch block not found", which are correct and read as broken.
     WHY THIS MATTERS BEYOND TIDINESS: hunting VACUOUS gates by reading suite output is one of this
     repo's main defect-finding methods, and 255 such lines drown the one signal that would identify a
     genuinely vacuous assertion. Measured 2026-09-03 while chasing exactly that, and the chase cost a
     retraction.
     ⚠️ COUNTED AT RENDER, NOT SCANNED FROM SOURCE, and that is the whole design. Of 4189 `T.ok` call
     sites only 509 pass a LITERAL detail; 3680 are computed expressions and invisible to any static
     scan. A source-level gate would therefore police 12 % of the population while reporting on all of
     it — measuring a proxy, not the thing. The rendered string is the thing. */
  const ABSENCE_DETAIL = /\b(not found|no [a-z-]+ found|did the [a-z ]+ change shape)\b/i;
  let absenceOnPass = 0;
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
      if (t.pass && !t.skip && t.detail && ABSENCE_DETAIL.test(String(t.detail))) absenceOnPass++;
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
  /* PUBLISH THE DEBT, then RATCHET it. Printing the count is what makes the number falsifiable —
     a cap with no visible measurement is a claim. The cap is the count as measured on a full green
     run; it may only ever go DOWN, and lowering it when the debt shrinks is the point. A run that
     covers only some groups (a shard, a --group filter) sees fewer and must not red on that, so the
     ratchet applies to a FULL run only. */
  if (absenceOnPass) {
    console.log(
      paint('  ' + absenceOnPass + ' passing assertion(s) print an absence-shaped detail', C.dim) +
        paint('  — green output that reads as broken; see residue 2026-09-03-pass-detail-reads-as-absence', C.dim)
    );
  }
  // exitCode, not process.exit() — stdout is async to a PIPE, and CI captures stdout through one, so
  // exiting immediately after printing the full report can truncate its tail (incl. the summary line).
  process.exitCode = fail ? 1 : 0;
}

main();
