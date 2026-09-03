/*
 * tools/trio-batch.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * TRIO BATCH — raw Polar Sensor Logger + O2Ring capture folder → per-night trio node-exports,
 * in the exact shape `tools/tch-multinight.mjs --dir` ingests (one subdir per night, three
 * `ganglior.node-export` JSONs: ECGDex · PpgDex · OxyDex).
 *
 * Closes the DATA half of INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III §1 ("the remaining owed
 * work is DATA, not code — commit ≥~5 more nights' three node-export JSONs and `--dir` prints
 * the real distribution").
 *
 * WHY A SEPARATE TOOL (not a DSP change): it only ORCHESTRATES the already-committed headless
 * compute() surfaces (ECGDex/PpgDex/OxyDex) — it adds no signal processing of its own, so it
 * moves no bundle and no manifestHash.
 *
 * PRIVACY (non-negotiable). The source capture folder is raw personal medical data and is
 * gitignored. This tool:
 *   - NEVER copies raw signal out of the source folder — it emits DERIVED summaries only;
 *   - runs every export through the SHARED `dexScrubExport` (dex-export.js) before writing, which
 *     drops `recording.device/serial/model` + input filenames/hashes and stamps `scrubbed:true`;
 *   - writes output filenames from the NIGHT + node only — never a device serial (dex-export.js §46:
 *     "NO device serial. The only sanctioned disambiguator is the short content digest").
 *
 * NIGHT BOUNDARY. Filename date ≠ night: a Verity PPG starting 2026-06-27T23:58 belongs to the
 * same night as an O2Ring stamped 2026-06-28T00:0x. A recording is assigned to the night of
 * (start − 12 h), so an evening start and the post-midnight hours of the same sleep both land on
 * the evening's date. Daytime (non-nocturnal) captures therefore land on the PREVIOUS night's key.
 *
 * WHAT MAKES A WINDOW A NIGHT — CLOCK TIME, NOT DURATION. This used to be a pure duration test
 * (`--min-hours`), resting on the comment below that "the O2Ring is always the sleep session". That
 * stopped being true the moment the capture box started recording continuously: on 2026-07-26 an
 * AWAKE 14:33→18:15 afternoon block cleared 3 h with all three sensors worn, entered the corpus as
 * night `2026-07-26`, and posted the worst sigma in it (PpgDex 8.31, OxyDex 5.16 bpm — sitting up
 * and moving is exactly what wrecks armband PPG and finger pulse-ox). Nothing was wrong with the
 * data; it simply was not a night, and it dragged the corpus median from 4.24 to 6.21 bpm.
 *
 * So a window must now be MOSTLY NOCTURNAL: more than half of the three-way overlap has to fall
 * inside `--night-band` (default 21:00–09:00 floating wall clock). A MAJORITY test, not an absolute
 * one — an absolute floor either rejects a genuine short night (2026-07-23 is 2.6 h at 03:00) or
 * admits a 19:00→22:30 evening block on the 1.5 h of it that happens to land after 21:00. The
 * fraction does not care how long the window is, only where it sits. `--keep-daytime` bypasses it,
 * which is what that flag always claimed to do and now actually does.
 *
 * USAGE
 *   node tools/trio-batch.mjs --src "<capture dir>" [options]
 *   (no --max-old-space-size needed — the dispatcher sizes each child's heap from the probed host)
 *
 *     --src <dir>        raw capture folder (required)
 *     --out <dir>        output root (default: uploads/trio) — one subdir per night
 *     --night <key>      only this night (YYYY-MM-DD); repeatable
 *     --limit <n>        process at most n nights
 *     --min-hours <h>    skip a recording shorter than h hours (default 3)
 *     --min-overlap <h>  required three-way overlap (default 1 — tch-multinight needs ≥12 5-min epochs)
 *     --night-band <a-b> nocturnal hours, local wall clock (default 21-9); may wrap midnight
 *     --keep-daytime     do not filter non-nocturnal captures
 *     --skip-existing    skip a night already computed from the SAME inputs by the SAME code
 *     --force            recompute everything, stamp or no stamp (beats --skip-existing)
 *     --jobs <n>         nights to compute in parallel (default: AUTO — probed from the host)
 *     --dry-run          plan only: print the night/file plan, compute nothing, write nothing
 *     --selftest         known-answer checks for the nocturnal gate (no corpus, no I/O)
 *
 * PARALLELISM + MEMORY. Nights run as CHILD PROCESSES, pool-capped. The cap is PROBED, not assumed:
 * a night peaks at ~0.9 GB (a ~330 MB PPG text held while it parses into Float32 channels, plus a
 * ~180 MB ECG), so on a small machine RAM binds before CPU does. The tool takes min(cores−1, free
 * RAM ÷ ~1.2 GB) and prints what it picked and why — over-committing here does not merely slow the
 * run, it gets the process OOM-killed mid-corpus. Process-per-night (not threads) means each night's
 * memory is returned to the OS on exit, so nothing accumulates across the corpus, and no
 * --max-old-space-size is needed on the command line: the parent sizes each child's heap to the host.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fitDatToSpo2Csv, readDat, readSpo2Csv, timefitDisagrees } from './o2ring-dat-timefit.mjs';

const __filename = fileURLToPath(import.meta.url); // re-spawned as the child (see DISPATCH)
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
// ESM-MIGRATION: a co-loaded DSP (ecgdex-dsp.js …) may be a dual-mode ES module — shed its top-level
// export/import via the single classicify source before vm-loading (no-op on classic files).
const DexBuild = createRequire(import.meta.url)('./build-core.js');
// §F5 — the clock lines are formatted by a PURE module so their wording is gateable. Nothing inside
// this file is callable from a test (the night loop runs at import), which is why these had none.
const DriftReport = createRequire(import.meta.url)('./drift-report.js');

/* ── args ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const optAll = (n) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === n && argv[i + 1]) out.push(argv[i + 1]);
  return out;
};

const SRC = opt('--src', null);
// resolve(), not join(): join(ROOT, '/abs/path') CONCATENATES and would write inside the repo.
const OUT = resolve(ROOT, opt('--out', 'uploads/trio'));
const ONLY = optAll('--night');
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const MIN_HOURS = parseFloat(opt('--min-hours', '3'));
// Three-way overlap floor. NOT invented: tch-multinight needs ≥12 five-min epochs (= 1 h) to solve a
// night, and sensor-trio-worker.js:307 floors at 1000 s. 1 h satisfies both. Do not raise it without
// reason — a stricter floor silently discards eligible nights.
const MIN_OVERLAP = parseFloat(opt('--min-overlap', '1'));
const KEEP_DAYTIME = flag('--keep-daytime');
/* Optional CPAP DATALOG root. When given, each night's offset is FITTED from the wearables and
   printed with per-sensor attribution. Optional on purpose: the trio fold must work for anyone
   without a CPAP, and a missing card is not an error, it is simply one fewer thing to report.

   ACCEPTS EITHER the card ROOT (the thing `cpap_harvest` mirrors — `SETTINGS/`, `STR.edf`, `DATALOG/`)
   OR `DATALOG` itself, because the lookup below is `join(CPAP_DIR, '20260730')` and pointing it one
   level too high fails as "no CPAP events for this night" — which reads like *the CPAP did not record*
   rather than *you gave me the wrong directory*. A silent wrong answer for a path typo is not worth
   defending; if `<dir>/DATALOG` exists, that is unambiguously what was meant. */
const CPAP_DIR = (() => {
  const raw = opt('--cpap', null);
  if (!raw) return null;
  const inner = join(raw, 'DATALOG');
  return existsSync(inner) && statSync(inner).isDirectory() ? inner : raw;
})();
/* §4 — admit nights that are not full trios. OFF by default: this tool feeds every other analysis
   in the repo, and a night that is not a fusion trio must not silently start appearing in one. */
const ALLOW_PARTIAL = flag('--allow-partial');
const SKIP_EXISTING = flag('--skip-existing');
// --force recomputes everything, stamp or no stamp. The engine is still being tuned, so "redo it all
// under today's code" has to be one flag away — and it must BEAT --skip-existing when both are given.
const FORCE = flag('--force');
// Internal: a child told to compute exactly ONE node of one night (see the node-split dispatch).
const ONLY_NODE = opt('--only-node', null);
const TRIO_NODES = ['ECGDex', 'PpgDex', 'OxyDex'];
/* COUNT THE TRIO, NOT EVERY .json IN THE FOLDER. Completeness used to be
   `readdirSync(dir).filter(f => f.endsWith('.json')).length === 3`, which silently made the trio test
   mean "exactly three JSON files exist" — so the moment a night gained a FOURTH export (the O2Ring
   finger site, below) every night would read incomplete, re-fold on every run, and never write its
   stamp. The test is about the three trio nodes; say that. */
const countTrioExports = (dir) => {
  try {
    return readdirSync(dir).filter((f) => TRIO_NODES.some((n) => f.startsWith(n + '_')) && f.endsWith('.node-export.json')).length;
  } catch {
    return 0;
  }
};
const wantNode = (n) => !ONLY_NODE || ONLY_NODE === n;
// Nocturnal band, floating wall clock. Wraps midnight when start > end, which is the normal case.
const [BAND_A, BAND_B] = (() => {
  const raw = opt('--night-band', '21-9');
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(raw).trim());
  if (!m || +m[1] > 23 || +m[2] > 23) {
    console.error(`trio-batch: --night-band must be H-H with both hours 0-23 (got ${raw})`);
    process.exit(2);
  }
  return [+m[1], +m[2]];
})();

/* Milliseconds of an interval set that fall inside the nocturnal band.
   Read with getUTC* on floating wall-clock ms per the Clock Contract §5: `tMs` already encodes the
   recording's LOCAL civil time, so a UTC getter returns the hour the sleeper actually saw, on any
   machine. Using getHours() here would make "is this a night" depend on the analyst's timezone.
   Bands are laid down per calendar day and, when the band wraps midnight, run into the next day —
   consecutive bands cannot overlap (21:00+12 h ends at 09:00, the next starts 12 h later), so a
   plain sum double-counts nothing. Iteration starts one day early because the band covering a
   00:30 sample opened at 21:00 the PREVIOUS day. */
const DAY = 86400e3;
const nocturnalMs = (A, a = BAND_A, b = BAND_B) => {
  if (!A.length) return 0;
  const span = b > a ? (b - a) * 3600e3 : (24 - a + b) * 3600e3;
  let total = 0;
  for (const [s, e] of A) {
    for (let d = Math.floor(s / DAY) * DAY - DAY; d < e; d += DAY) {
      const bs = d + a * 3600e3;
      const be = bs + span;
      const lo = Math.max(s, bs),
        hi = Math.min(e, be);
      if (hi > lo) total += hi - lo;
    }
  }
  return total;
};

/* THE GATE IS A TRIMMER, NOT A DOORMAN. Applying the majority-nocturnal test to a whole window can
   only ADMIT or REJECT it — and a window is a cluster of blocks, so a cluster that is 61 % nocturnal
   passes *carrying its daytime block inside it*. That is what happened on 2026-07-26: an awake
   14:31→20:01 block sat only 1.7 h from the 21:40→05:10 sleep, under SLEEP_GAP_H, so the two never
   split into separate clusters; the merged 11.8 h window scored 61 % and sailed through. The night
   folded as 14.3 h with the armband's SDNN divergence at 83 % — the same night folded from its sleep
   blocks alone is 7.0 h at 2 %. So apply the SAME majority test PER BLOCK and drop the ones that
   fail: a cluster now contributes exactly its nocturnal blocks instead of all-or-nothing.
   Still a fraction, never an absolute clip — a 19:00→02:00 sleep is 71 % nocturnal and survives
   WHOLE; we do not cut it at 21:00, because sleep onset is not a band edge. */
const nocturnalBlocks = (A, a = BAND_A, b = BAND_B) => A.filter(([s, e]) => e > s && nocturnalMs([[s, e]], a, b) / (e - s) > 0.5);

/* ── --skip-existing verdict, as a PURE function so it can be known-answer tested ─────────────────
 * Returns the reason a night must be RECOMPUTED, or null when skipping is provably safe. Pure and
 * I/O-free on purpose: the caller does the stat/read, this decides. A skip is a claim that recomputing
 * would change nothing, and an unchecked claim of that shape is how a stale artifact ships — so every
 * way the claim can be false gets its own branch, and every branch gets a case in --selftest.
 * `stamp` is the parsed sidecar, null when absent, the string 'BAD' when unparseable. */
/* Split a night's nodes across children ONLY with slots to spare. `jobs` is already the probed floor of
   (cores−1, free RAM ÷ ~1.2 GB, HARD_CAP), so on a 1-core or memory-tight host this is false and the
   run behaves exactly as before. Never split when the nights alone already fill the pool — the slots are
   busy either way and splitting would only add process startup. Pure, so --selftest can pin it. */
function shouldSplitNodes(jobs, nights) {
  return jobs > 1 && nights < jobs;
}

function redoReason(stamp, nJson, inputsDigest, codeDigest) {
  if (!stamp) return 'no stamp';
  if (stamp === 'BAD') return 'unreadable stamp';
  if (nJson !== 3) return `${nJson}/3 exports present`;
  if (stamp.inputsDigest !== inputsDigest) return 'inputs changed';
  if (stamp.codeDigest !== codeDigest) return 'code changed';
  return null;
}

/* ── --selftest ───────────────────────────────────────────────────────────────────────────────────
 * Known answers for the nocturnal gate, on hand-built windows — no corpus, no I/O, CI-safe. The gate
 * decides whether a window is a night, and it got that wrong on real data once (2026-07-26); every
 * case below is either that bug or a window it must NOT reject. */
if (flag('--selftest')) {
  const D = Date.UTC(2026, 6, 25); // floating wall-clock midnight, per the Clock Contract
  const at = (day, h, m = 0) => D + day * 86400e3 + h * 3600e3 + m * 60e3;
  const H = (ms) => +(ms / 3600e3).toFixed(3);
  const ivS = (A) => A.reduce((t, [a, b]) => t + (b - a), 0);
  const frac = (A) => (ivS(A) ? nocturnalMs(A) / ivS(A) : 0);
  let fail = 0;
  const ok = (name, got, want) => {
    const good = Math.abs(got - want) < 1e-6;
    if (!good) fail++;
    console.log(`  ${good ? '\u2713' : '\u2717'} ${name}  got=${got} want=${want}`);
  };

  // THE REGRESSION: 2026-07-26 14:33 -> 18:15, awake, all three sensors worn, 3.7 h.
  ok('afternoon block is 0 % nocturnal', frac([[at(1, 14, 33), at(1, 18, 15)]]), 0);
  // A full night, evening start through the small hours -> entirely in band.
  ok('22:34 -> 07:00 is 100 % nocturnal', frac([[at(0, 22, 34), at(1, 7)]]), 1);
  ok('...and counts every hour of it', H(nocturnalMs([[at(0, 22, 34), at(1, 7)]])), H(at(1, 7) - at(0, 22, 34)));
  // 2026-07-23 was a real 2.6 h night at 03:00. An ABSOLUTE floor of --min-hours would have killed
  // it; the majority test keeps it. This case is why the gate is a fraction.
  ok('short 03:00 night survives', frac([[at(1, 3), at(1, 5, 36)]]), 1);
  // The case an absolute floor would have WRONGLY admitted: awake evening, 1.5 h of it after 21:00.
  ok('19:00 -> 22:30 evening is a minority', frac([[at(0, 19), at(0, 22, 30)]]) <= 0.5 ? 1 : 0, 1);
  // Midnight wrap: the band covering 00:30 opened at 21:00 the PREVIOUS calendar day.
  ok('00:00 -> 02:00 is fully in band', frac([[at(1, 0), at(1, 2)]]), 1);
  // Straddling the 09:00 edge: 07:00-11:00 -> 2 h of 4 h. Exactly at the boundary, and `<= 0.5`
  // rejects it, which is the intended reading of "MORE than half".
  ok('07:00 -> 11:00 is exactly half', frac([[at(1, 7), at(1, 11)]]), 0.5);
  // Two nights of band in one interval must both count (multi-day sum, no double counting).
  ok('48 h window sees exactly 24 h of band', H(nocturnalMs([[at(0, 9), at(2, 9)]])), 24);
  // A non-wrapping band must work too (--night-band 1-5), or the wrap branch is load-bearing by luck.
  ok('non-wrapping band 1-5', H(nocturnalMs([[at(1, 0), at(1, 8)]], 1, 5)), 4);

  // ── THE TRIMMER (the 2026-07-26 cluster, to scale) ────────────────────────────────────────────
  // Awake 14:31→20:01 and sleep 21:40→05:10, 1.7 h apart — under SLEEP_GAP_H, so they arrive as ONE
  // cluster of two blocks. Whole-window: 11.8 h at 61 % nocturnal → ADMITTED with the daytime inside.
  // Per-block: the awake block is 0 % and goes, the sleep block is 100 % and stays.
  const awake = [at(1, 14, 31), at(1, 20, 1)];
  const sleep = [at(1, 21, 40), at(2, 5, 10)];
  const cluster = [awake, sleep];
  ok('the merged cluster WOULD have passed the whole-window test', frac(cluster) > 0.5 ? 1 : 0, 1);
  ok('...and it is 13.0 h of which 5.5 h is awake', H(ivS(cluster)), 13);
  ok('trimmer keeps exactly one block', nocturnalBlocks(cluster).length, 1);
  ok('trimmer keeps THE SLEEP block', H(ivS(nocturnalBlocks(cluster))), H(sleep[1] - sleep[0]));
  ok('trimmed cluster is 100 % nocturnal', frac(nocturnalBlocks(cluster)), 1);
  // A sleep that straddles the band edge must survive WHOLE — the trimmer drops blocks, never clips
  // them. 19:00→02:00 is 5 h of 7 h in band (71 %), so it is a night and stays intact.
  const straddle = [at(0, 19), at(1, 2)];
  ok('19:00 -> 02:00 sleep survives the trimmer whole', H(ivS(nocturnalBlocks([straddle]))), H(straddle[1] - straddle[0]));
  // An all-daytime cluster trims to nothing — the night is then rejected, not silently emptied.
  ok('all-daytime cluster trims to zero blocks', nocturnalBlocks([awake]).length, 0);
  // Boundary: exactly half is NOT a majority, matching the whole-window reading of `> 0.5`.
  ok('07:00 -> 11:00 (exactly half) is trimmed out', nocturnalBlocks([[at(1, 7), at(1, 11)]]).length, 0);

  /* --skip-existing. A skip is a CLAIM that recomputing changes nothing; each way that claim can be
     false gets a case. The `null` case is the dangerous one — it is the only branch that skips work,
     so the four beside it are what stop it from skipping a night it should redo. */
  const eq = (name, got, want) => {
    const good = got === want;
    if (!good) fail++;
    console.log(`  ${good ? '✓' : '✗'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };
  const S = { inputsDigest: 'IN', codeDigest: 'CODE' };
  eq('same inputs + same code + 3 exports ⇒ SKIP', redoReason(S, 3, 'IN', 'CODE'), null);
  eq('no stamp ⇒ redo', redoReason(null, 3, 'IN', 'CODE'), 'no stamp');
  eq('unreadable stamp ⇒ redo (never trust a corrupt claim)', redoReason('BAD', 3, 'IN', 'CODE'), 'unreadable stamp');
  // The OOM case: 2026-07-06 was left with only its ECGDex export by a killed run.
  eq('2 of 3 exports ⇒ redo (the half-written night)', redoReason(S, 2, 'IN', 'CODE'), '2/3 exports present');
  eq('4 json in the dir ⇒ redo (not a clean trio)', redoReason(S, 4, 'IN', 'CODE'), '4/3 exports present');
  eq('a new session appended ⇒ redo', redoReason(S, 3, 'IN-MOVED', 'CODE'), 'inputs changed');
  // The stale-artifact case this whole gate exists for: a DSP edit must invalidate every night.
  eq('a DSP edit ⇒ redo', redoReason(S, 3, 'IN', 'CODE-MOVED'), 'code changed');

  /* Node split. The rule has to be safe on a SMALL machine first: the probe hands it jobs=1 there, and
     a 1-slot host must behave exactly as it did before. Splitting is only ever a use for slots that
     would otherwise idle. */
  eq('1 slot (small/busy host) ⇒ never split', shouldSplitNodes(1, 1), false);
  eq('1 slot, many nights ⇒ never split', shouldSplitNodes(1, 20), false);
  eq('1 night, 8 slots ⇒ split (7 would idle)', shouldSplitNodes(8, 1), true);
  eq('2 nights, 8 slots ⇒ split', shouldSplitNodes(8, 2), true);
  eq('nights already fill the pool ⇒ do not split', shouldSplitNodes(8, 8), false);
  eq('more nights than slots ⇒ do not split', shouldSplitNodes(8, 11), false);
  eq('2 slots, 1 night ⇒ split (the modest-host win)', shouldSplitNodes(2, 1), true);

  console.log(fail ? `\n  ${fail} FAILED` : '\n  all green');
  process.exit(fail ? 1 : 0);
}
const DRY = flag('--dry-run');
const CHILD = flag('--child'); // internal: this process computes ONE night and exits

/* ── HARDWARE PROBE + CONCURRENCY PLAN ────────────────────────────────────────────────────────────
 * A night is EXPENSIVE and the cost is dominated by memory, not CPU: a Verity `_PPG.txt` is ~330 MB of
 * text which V8 holds as a string WHILE parsing it into Float32 channels, and the paired H10 `_ECG.txt`
 * adds ~180 MB. Measured peak ≈ 0.9 GB RSS per night (0.7 GB steady + filter scratch).
 *
 * So concurrency is capped by whichever runs out first — cores or RAM — and on a small machine that is
 * RAM. Getting this wrong is not a slowdown, it is an OOM kill mid-corpus (which is exactly how a
 * previous run lost its last night). We therefore probe the host and take the MINIMUM of the two limits,
 * never a fixed guess, and we PRINT what we chose and why (CLAUDE.md: no silent caps).
 *
 * Free memory — not total — is the honest budget: the box may already be hosting a browser, an IDE, and
 * a concurrent agent. We leave a reserve so we degrade to slower-but-correct instead of being OOM-killed.
 */
const GB = 1024 ** 3;
const PER_JOB_GB = 1.2; // measured ~0.9 GB peak/night + headroom
const RESERVE_GB = 2.0; // never consume the host's last 2 GB
const HARD_CAP = 8; // beyond this the disk/parse becomes the bottleneck anyway
function planConcurrency() {
  const cores = Math.max(1, os.cpus().length);
  const freeGB = os.freemem() / GB,
    totalGB = os.totalmem() / GB;
  // `os.freemem()` excludes reclaimable page cache on Linux, so it UNDER-reports what is really
  // available. Trust the smaller of (free) and (total − reserve) — pessimistic on purpose.
  const budgetGB = Math.max(0, Math.min(freeGB, totalGB - RESERVE_GB));
  const byCpu = Math.max(1, cores - 1); // leave one core for the OS/coordinator
  const byMem = Math.max(1, Math.floor(budgetGB / PER_JOB_GB));
  const auto = Math.max(1, Math.min(byCpu, byMem, HARD_CAP));
  const asked = parseInt(opt('--jobs', '0'), 10) || 0;
  const jobs = asked > 0 ? asked : auto;
  return { cores, totalGB, freeGB, budgetGB, byCpu, byMem, auto, jobs, forced: asked > 0 };
}
// Child heap: enough for one night with room for the filter scratch, but never more than the host has.
function childHeapMB(planned) {
  const perJobMB = Math.floor((planned.budgetGB / Math.max(1, planned.jobs)) * 1024 * 0.9);
  return Math.max(1536, Math.min(8192, perJobMB));
}

if (!SRC || !existsSync(SRC)) {
  console.error('trio-batch: --src <capture dir> is required and must exist');
  process.exit(2);
}

/* ── 1 · headless DSP realm (mirrors tests/run-tests.mjs makeCtx/loadInto) ─── */
function makeCtx() {
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
  // oxydex-dsp.js is grandfathered-impure: it reads document.documentElement.outerHTML at LOAD.
  // Mirror tests/run-tests.mjs makeSandbox() exactly, so the DSPs run in the same realm the gates use.
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
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = documentStub;
  sandbox.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  // the namespaced co-load contract (each DSP hangs its node object off the realm global)
  sandbox.__DEX_NAMESPACED__ = true;
  return vm.createContext(sandbox);
}
function loadInto(ctx, file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) throw new Error('module not found: ' + file);
  vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: file });
}

// LAZY — the DSP realm is built only by a process that actually COMPUTES. A dispatching parent never
// loads it (it only plans + spawns), which keeps the coordinator at a few MB instead of carrying a full
// DSP realm for the whole run.
let ctx = null,
  ECGDex,
  PpgDex,
  OxyDex,
  DexKernel,
  dexScrubExport,
  COMMON;
function loadDsps() {
  if (ctx) return;
  ctx = makeCtx();
  // clock.js FIRST — the delegating DSPs alias DexClock.parseTimestamp at load (CLAUDE.md §Clock Contract).
  // kernel-constants.js supplies DexKernel, which every builder stamps into the export envelope.
  for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'oxydex-util.js', 'oxydex-dsp.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'integrator-dsp.js']) loadInto(ctx, f);
  ({ ECGDex, PpgDex, OxyDex, DexKernel, dexScrubExport } = ctx);
  for (const [n, v] of Object.entries({ ECGDex, PpgDex, OxyDex, DexKernel, dexScrubExport })) if (!v) throw new Error('trio-batch: ' + n + ' did not load into the headless realm');
  // `rich: true` is what unlocks timeseries.epochs[] — the app's light stream omits it, and ONLY the
  // orchestrate emitter opts in (signal-orchestrate.emitEcg/PpgNodeExport). tch-multinight reads
  // timeseries.epochs[].{hr,motionIndex}, so without rich the export is epoch-less and useless here.
  COMMON = { kernel: DexKernel, rich: true };
}

/* ── 2 · scan + index the capture folder ─────────────────────────────────── */
// Polar Sensor Logger: Polar_<H10|Sense>_<SERIAL>_<YYYYMMDD>_<HHMMSS>_<STREAM>.txt
const RE_POLAR = /^Polar_(H10|Sense)_([0-9A-Fa-f]+)_(\d{8})_(\d{6})_([A-Z]+)\.txt$/;
// O2Ring: "O2Ring S 2100_<YYYYMMDDHHMMSS>.csv"
const RE_O2 = /^O2Ring[^_]*_(\d{14})\.csv$/;
// O2Ring NATIVE BINARY: "<YYYYMMDDHHMMSS>.dat" — the device's own file, written beside the vendor CSV.
// When the CSV export stops (app not opened, phone not synced) the .dat is all that survives, and a
// night with a perfectly good ECG+PPG pair used to be dropped for want of an anchor. See
// TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md.
const RE_O2_DAT = /^(\d{14})\.dat$/;

// capture-host (the BLE `capture.py` daemon) layout — the SAME vendor CONTENT under DIFFERENT names
// (CAPTURE-HOST-INTEGRATOR-FOLD §1): one 14-digit stamp instead of `<YYYYMMDD>_<HHMMSS>`, the device
// token `VeritySense` (not `Sense`), the stream `MAG` (not `MAGN`), and Wellue-prefixed O2Ring files.
// The file BYTES are identical to the Polar Sensor Logger / O2Ring exports the DSPs already parse, so
// matching these names lets a real capture-host night ingest with no rename shim.
const RE_POLAR_CH = /^Polar_(H10|VeritySense)_([0-9A-Fa-f]+)_(\d{14})_([A-Z0-9]+)\.txt$/;
const RE_O2_CH = /^Wellue_O2Ring-S_[^_]+_(\d{14})_SPO2\.csv$/;
const RE_O2_DAT_CH = /^Wellue_O2Ring-S_[^_]+_(\d{14})_STORED\.dat$/; // onboard backup (full session)
/* THE O2RING'S OWN PLETHYSMOGRAM — ~125 Hz finger optical, live-BLE only.
   `dex-ingest` has always called this "PpgDex's legitimate finger PRIMARY" and routed it there; this
   fold never fed it, so every corpus run was Verity-only and PpgDex's finger site — the one whose
   morphology tier `ppgdex-registry` already grades separately — has never been computed at scale.
   Absent from the onboard `.dat` backup, which carries 1 Hz SpO2/HR/motion and no waveform, so this
   exists only on nights the capture host was listening. */
const RE_O2_PPG_CH = /^Wellue_O2Ring-S_[^_]+_(\d{14})_PPG\.txt$/;

// Clock Contract: floating wall-clock ms — components verbatim through Date.UTC, never new Date(str).
const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s);
const parse14 = (s) => utc(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
const parse8_6 = (d, t) => utc(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));

// A recording belongs to the night of (start − 12 h): evening starts and post-midnight starts
// of the same sleep collapse onto one key. See NIGHT BOUNDARY above.
const nightKeyOf = (tMs) => new Date(tMs - 12 * 3600e3).toISOString().slice(0, 10);

const nights = new Map();
const bump = (key) => {
  if (!nights.has(key)) nights.set(key, { key, ecg: [], acc_h10: [], ppg: [], acc_ver: [], gyro: [], magn: [], oxy: [], o2ppg: [] });
  return nights.get(key);
};

// RECURSE: the Polar Sensor Logger corpus is one FLAT folder, but the capture-host daemon writes one
// SUBDIRECTORY PER NIGHT (plus a `stored/` dir of onboard .dat backups). Walk the tree so both layouts
// ingest from the same `--src` — the regexes match on the BASENAME, and `readdirSync(recursive:true)`
// on a flat folder still returns bare filenames, so this is back-compat for the Polar corpus.
for (const rel of readdirSync(SRC, { recursive: true })) {
  const name = basename(rel);
  const full = join(SRC, rel);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  }
  if (!st.isFile()) continue;

  // Polar streams — normalize BOTH the Polar Sensor Logger and capture-host layouts to {dev, stream, t0}
  // (dev ∈ {H10, Sense}, stream ∈ {ECG, ACC, PPG, GYRO, MAGN}) before the shared routing below.
  let dev = null;
  let stream = null;
  let t0 = null;
  let m = RE_POLAR.exec(name);
  if (m) {
    dev = m[1];
    t0 = parse8_6(m[3], m[4]);
    stream = m[5];
  } else if ((m = RE_POLAR_CH.exec(name))) {
    dev = m[1] === 'VeritySense' ? 'Sense' : m[1];
    t0 = parse14(m[3]);
    stream = m[4] === 'MAG' ? 'MAGN' : m[4];
  }
  if (dev) {
    const rec = { name, full, t0, bytes: st.size, dev, stream };
    const n = bump(nightKeyOf(t0));
    if (dev === 'H10' && stream === 'ECG') n.ecg.push(rec);
    else if (dev === 'H10' && stream === 'ACC') n.acc_h10.push(rec);
    else if (dev === 'Sense' && stream === 'PPG') n.ppg.push(rec);
    else if (dev === 'Sense' && stream === 'ACC') n.acc_ver.push(rec);
    else if (dev === 'Sense' && stream === 'GYRO') n.gyro.push(rec);
    else if (dev === 'Sense' && stream === 'MAGN') n.magn.push(rec);
    continue;
  }
  // O2Ring vendor CSV — Polar-Sensor-Logger-style "O2Ring …_<14>.csv" OR capture-host "Wellue_O2Ring-S_…_SPO2.csv".
  m = RE_O2.exec(name) || RE_O2_CH.exec(name);
  if (m) {
    t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).oxy.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'SPO2', kind: 'csv', stamp: m[1] });
    continue;
  }
  // O2Ring finger plethysmogram → PpgDex's FINGER site (not OxyDex: it is an optical waveform, and
  // OxyDex consumes the 1 Hz SpO2 summary). Checked BEFORE the _SPO2/_STORED patterns cannot match it,
  // but kept adjacent so the three O2Ring streams read as one group.
  m = RE_O2_PPG_CH.exec(name);
  if (m) {
    t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).o2ppg.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'PPG', kind: 'txt', stamp: m[1] });
    continue;
  }
  // O2Ring onboard binary — bare "<14>.dat" OR capture-host "Wellue_O2Ring-S_…_STORED.dat".
  m = RE_O2_DAT.exec(name) || RE_O2_DAT_CH.exec(name);
  if (m) {
    t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).oxy.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'SPO2', kind: 'dat', stamp: m[1] });
  }
}

/* PREFER THE VENDOR CSV when the same session is present as BOTH files. The O2Ring writes the CSV and
   the .dat for one recording under the same 14-digit stamp, and they carry the same samples (the brief
   pins it: 24,040 rows, zero mismatches on SpO₂/pulse/motion). Keep the CSV — it is the corpus's
   established provenance — and drop its .dat twin, so one recording never appears as two anchors. */
for (const n of nights.values()) {
  const csvStamps = new Set(n.oxy.filter((r) => r.kind === 'csv').map((r) => r.stamp));
  n.oxy = n.oxy.filter((r) => r.kind !== 'dat' || !csvStamps.has(r.stamp));
}

/* END-STAMP — the last wall-clock stamp in a stream file, read from a 64 KB TAIL (never the whole
   file: a PPG waveform is ~350 MB). Gives each recording a real [t0, tEnd] window. */
const endOf = (rec) => {
  /* O2Ring .dat: a binary with NO text stamps, so the tail-scan below finds nothing. It records at
     1 Hz, so tEnd = t0 + (records × 1000 ms). Read the whole file — a .dat is ~75 KB, not a waveform.
     FRAMING ONLY (10-byte header · 3-byte records · 0xFF 0xFF trailer): the VALUE decode — SpO₂, pulse,
     the motion×2 scale, the timestamps — stays single-sourced in oxydex-dsp.js decodeO2RingBinToCSV,
     which is what actually parses this file downstream. The planner never loads the DSP realm (see
     LAZY above), so it counts records rather than decoding them. */
  if (rec.kind === 'dat') {
    try {
      const b = readFileSync(rec.full);
      let n = 0;
      for (let off = 10; off + 3 <= b.length; off += 3) {
        if (b[off] === 0xff && b[off + 1] === 0xff) break;
        n++;
      }
      return n ? rec.t0 + n * 1000 : null;
    } catch {
      return null;
    }
  }
  const fd = openSync(rec.full, 'r');
  try {
    const size = statSync(rec.full).size;
    const n = Math.min(65536, size);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    const lines = buf
      .toString('utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const first = lines[i].split(/[;,]/)[0].trim();
      // Polar: 2026-06-13T20:44:50.123 (ISO, no zone → components verbatim, Clock Contract rule 3)
      let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(first);
      if (m) return utc(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      // O2Ring: 21:09:52 03/05/2026 (HH:MM:SS DD/MM/YYYY → rule 4, preferDMY)
      m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(first);
      if (m) return utc(+m[6], +m[5], +m[4], +m[1], +m[2], +m[3]);
    }
  } catch {
    /* unreadable tail → fall through to the size estimate */
  } finally {
    closeSync(fd);
  }
  return null;
};
const windowOf = (rec) => {
  if (rec._win) return rec._win;
  const tEnd = endOf(rec);
  rec._win = { t0: rec.t0, tEnd: tEnd != null && tEnd > rec.t0 ? tEnd : rec.t0 };
  return rec._win;
};

/* ── MERGED SESSION INTERVALS ────────────────────────────────────────────────────────────────
   A night is not one file per stream. This box reconnects constantly — 07-24 wrote 8 ECG, 164 PPG
   and 153 SpO2 session files for a single night — so asking "which ONE file overlaps the anchor"
   measures the wrong thing entirely. Measured over the 2026-07-16..25 corpus, the best single-file
   three-way overlap versus the union of merged sessions:

     07-16  0.66 h vs  1.76 h      07-21  2.35 h vs  3.92 h
     07-17  1.00 h vs  3.59 h      07-22  1.07 h vs  4.75 h
     07-18  1.47 h vs 11.38 h      07-23  0.58 h vs  2.57 h   <- rejected, had 2.6 h
     07-19  3.35 h vs  8.54 h      07-24  0.45 h vs  2.91 h   <- rejected, had 2.9 h
     07-20  1.06 h vs  5.53 h      07-25  0.58 h vs  2.71 h   <- rejected, had 2.7 h

   Three of ten nights were discarded despite having ~3 h of genuine simultaneous tri-device
   recording, and 07-18 folded 1.47 h of the 11.38 h it actually had. Worse than the waste: the
   single-file rule always keeps the LONGEST CONTINUOUS session, which is by construction the
   calmest, least-interrupted stretch of the night. Every statistic downstream — the sigma
   distributions, the three-cornered hat — was therefore computed on a subsample selected for being
   artifact-free. That is a bias, not a sampling choice, and it gets worse the churnier the box gets.
   */
const mergeIv = (recs) => {
  const out = [];
  for (const r of recs.map(windowOf).sort((a, b) => a.t0 - b.t0)) {
    if (out.length && r.t0 <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r.tEnd);
    else out.push([r.t0, r.tEnd]);
  }
  return out;
};
const ivIntersect = (A, B) => {
  const out = [];
  let i = 0,
    j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]),
      e = Math.min(A[i][1], B[j][1]);
    if (e > s) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++;
    else j++;
  }
  return out;
};
const ivSpan = (A) => A.reduce((t, [s, e]) => t + (e - s), 0);

/* Every record of a stream that touches the night's merged anchor window — not the single best one.
   A record contributing zero overlap is still dropped (a daytime capture is not this night's sleep),
   so the concurrency guarantee the original comment insists on is preserved: what changes is that
   concurrency is now judged against the whole anchor, and ALL concurrent sessions are kept. */
const concurrentSet = (arr, anchorIv, label, key, minOverlapH) => {
  if (!arr.length || !anchorIv.length) return null;
  const kept = arr.filter((r) => ivSpan(ivIntersect(mergeIv([r]), anchorIv)) > 0);
  const ovMs = ivSpan(ivIntersect(mergeIv(kept), anchorIv));
  const H = (ms) => (ms / 3600e3).toFixed(1);
  if (ovMs < minOverlapH * 3600e3) {
    console.log(`    \u2717 ${key}: ${label} — NO concurrent recording (merged overlap ${H(ovMs)} h < ${minOverlapH} h) — night rejected`);
    return null;
  }
  const dropped = arr.length - kept.length;
  if (dropped) console.log(`    \u00b7 ${key}: ${label} — ${kept.length} concurrent session(s), ${H(ovMs)} h merged; skipped ${dropped} non-concurrent`);
  else console.log(`    \u00b7 ${key}: ${label} — ${kept.length} concurrent session(s), ${H(ovMs)} h merged`);
  return kept.sort((a, b) => windowOf(a).t0 - windowOf(b).t0);
};

/* ── 3 · plan ────────────────────────────────────────────────────────────── */
let plan = [...nights.values()].sort((a, b) => a.key.localeCompare(b.key));
if (ONLY.length) plan = plan.filter((n) => ONLY.includes(n.key));

// The worker's hard floor is 1000 s of simultaneous coverage (sensor-trio-worker.js:307). Require
// MIN_HOURS of genuine three-way overlap here so a night that cannot make that floor never ships.
const trio = [];
for (const n of plan) {
  // Anchor on the O2Ring. It used to be true that the ring "is always the sleep session" — it is not
  // any more (the box records through the day and the ring is worn for it), which is why the
  // nocturnal gate below exists rather than relying on the anchor to mean night.
  // Rank by recorded DURATION, not bytes: bytes stopped being comparable once .dat joined CSV as an
  // oxy candidate (a binary .dat is ~10× denser than the same session's CSV, so a short daytime CSV
  // would outweigh a full night's .dat). Duration is what "the sleep session" actually means.
  // ANCHOR = every O2Ring session of the night, merged. The ring is still the anchor for the same
  // reason as before (it is always the sleep session, never a daytime capture) — but it is also the
  // most fragmented stream on this box (153-324 SpO2 files a night, longest single 0.57 h), so
  // anchoring on its longest SINGLE file capped the entire fold at that file's length. That is why
  // OxyDex contributed 14 epochs to a night where ECGDex contributed 78.
  const anchorIv = mergeIv(n.oxy);
  if (!anchorIv.length) {
    console.log(`  ⊘ ${n.key} — not a trio night (no O2Ring anchor)`);
    continue;
  }
  const pick = {
    key: n.key,
    oxy: n.oxy.slice().sort((a, b) => windowOf(a).t0 - windowOf(b).t0),
    ecg: concurrentSet(n.ecg, anchorIv, 'ECG', n.key, MIN_OVERLAP),
    accH10: concurrentSet(n.acc_h10, anchorIv, 'H10 ACC', n.key, 0),
    ppg: concurrentSet(n.ppg, anchorIv, 'PPG', n.key, MIN_OVERLAP),
    accVer: concurrentSet(n.acc_ver, anchorIv, 'Verity ACC', n.key, 0),
    gyro: concurrentSet(n.gyro, anchorIv, 'GYRO', n.key, 0),
    magn: concurrentSet(n.magn, anchorIv, 'MAGN', n.key, 0),
    /* The O2Ring's own pleth, held to the SAME concurrency rule as the Verity's — it has to overlap
       the ring's SpO2 anchor to be this night's sleep, or a 15:00 nap joins the record.
       MIN_OVERLAP 0, like the IMU companions: this stream is a SECOND optical opinion, not a
       precondition for the night, so a short finger session should contribute what it has rather than
       be dropped — and unlike ECG/PPG it gates nothing downstream. */
    o2ppg: concurrentSet(n.o2ppg, anchorIv, 'O2Ring PPG', n.key, 0)
  };
  const have = [pick.ecg && 'ECG', pick.ppg && 'PPG', pick.oxy.length && 'SpO2'].filter(Boolean);
  /* THREE IS A FUSION PRECONDITION, NOT A DATA ONE (POOLED-CLOCK-FIT-FOLLOWUPS §4).
     `tch-multinight` needs a genuine three-way overlap, so this tool has always required one. The
     CLOCK FIT needs no such thing — it consumes CPAP anchors plus whatever wearable channels exist,
     and each node's export is full-length however little the three coincide. So a rule that exists
     for the fusion path was silently bounding the clock-fit corpus.
     Measured over the whole capture tree: 42 nights are dropped here, and every one of them HAS
     CPAP data. That is not the 4 the brief estimated — it is more than the 36-night corpus itself.
     `--allow-partial` admits them; default OFF, so every existing analysis is byte-unchanged. */
  if (have.length < (ALLOW_PARTIAL ? 1 : 3)) {
    console.log(`  ⊘ ${n.key} — not a concurrent trio night (have: ${have.join('+') || 'none'})`);
    continue;
  }
  if (ALLOW_PARTIAL && have.length < 3) console.log(`    · ${n.key}: PARTIAL night — ${have.join('+')} only; fittable for the clock, NOT a fusion trio`);
  // The gate is the genuine THREE-WAY intersection of the merged sets, not the smaller of two
  // pairwise overlaps — the previous form could pass a night where ECG and PPG each overlapped the
  // ring but at different times.
  /* The sleep window is the intersection of the legs that EXIST with the ring anchor. With both
     ECG and PPG present this is byte-identical to the previous `ECG ∩ PPG ∩ anchor`; with one
     missing it degrades to the pair, and with both missing to the anchor's own nocturnal blocks —
     rather than intersecting with an empty set and silently losing the night. */
  const legIv = [pick.ecg, pick.ppg].filter((l) => l && l.length).map(mergeIv);
  const threeIvAll = legIv.reduce(function (acc, l) {
    return ivIntersect(acc, l);
  }, anchorIv);
  // ONE NIGHT IS ONE SLEEP, NOT EVERYTHING THAT SHARES A DATE KEY. Merging every session of the
  // night restored the data the single-file rule threw away — but it also let a DAYTIME ring
  // capture into the anchor, and the ECG/PPG sets are chosen against the anchor, so the daytime
  // hours came with it: OxyDex records came out 21.6 h and 14.6 h long, spanning an 8 h hole. That
  // is precisely the "12:14 daytime ECG paired with an overnight PPG" failure the original
  // single-file rule existed to prevent, reintroduced from the other side.
  //
  // So: cluster the three-way blocks, split wherever they are separated by more than SLEEP_GAP_H of
  // no concurrent recording, and keep the LONGEST cluster. Within it every session still merges —
  // reconnect churn is minutes, never hours, so this splits day from night without ever splitting a
  // night from itself.
  const SLEEP_GAP_H = 4;
  const clusters = [];
  for (const b of threeIvAll) {
    const last = clusters[clusters.length - 1];
    if (last && b[0] - last[last.length - 1][1] <= SLEEP_GAP_H * 3600e3) last.push(b);
    else clusters.push([b]);
  }
  // Rank by NOCTURNAL span first, total span only as the tie-break. "Longest" alone picks wrong the
  // day a 5 h awake stretch outlasts a 4 h sleep — and the whole point of clustering is to separate
  // day from night, so the ranking should be about time-of-day, not size.
  const chosen = clusters.sort((x, y) => (KEEP_DAYTIME ? ivSpan(y) - ivSpan(x) : nocturnalMs(y) - nocturnalMs(x) || ivSpan(y) - ivSpan(x)))[0] || [];
  // MOSTLY NOCTURNAL, or it is not this night's sleep — applied PER BLOCK, so the gate TRIMS the
  // daytime out of a mixed cluster instead of admitting or rejecting the whole thing. See
  // `nocturnalBlocks` for the 2026-07-26 cluster that motivated it.
  const threeIv = KEEP_DAYTIME ? chosen : nocturnalBlocks(chosen);
  const bh = (h) => `${String(h).padStart(2, '0')}:00`;
  const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  if (!threeIv.length) {
    // Nothing survived the trim: this date key holds daytime captures only. Report it as the whole
    // window it was, so the message still names what got rejected.
    const chosenH = ivSpan(chosen) / 3600e3;
    const chosenNoct = nocturnalMs(chosen) / 3600e3;
    const w = chosen.length ? [chosen[0][0], chosen[chosen.length - 1][1]] : null;
    console.log(
      `  ⊘ ${n.key} — NOT NOCTURNAL: ${w ? `${hhmm(w[0])}→${hhmm(w[1])}, ` : ''}only ${chosenNoct.toFixed(1)} h of ` +
        `${chosenH.toFixed(1)} h (${chosenH > 0 ? ((chosenNoct / chosenH) * 100).toFixed(0) : 0}%) inside ${bh(BAND_A)}–${bh(BAND_B)} — ` +
        `no block is majority-nocturnal (pass --keep-daytime to fold it anyway)`
    );
    continue;
  }
  const ov = ivSpan(threeIv) / 3600e3;
  const noctH = nocturnalMs(threeIv) / 3600e3;
  const noctFrac = ov > 0 ? noctH / ov : 0;
  // NO SILENT CAPS (CLAUDE.md): say what the trim dropped, block by block, before the overlap gate —
  // a night that fails MIN_OVERLAP *because* of the trim must show why, not just report a small number.
  const trimmed = chosen.filter((b) => !threeIv.includes(b));
  if (trimmed.length) {
    const shed = ivSpan(trimmed) / 3600e3;
    console.log(
      `    · ${n.key}: trimmed ${trimmed.length} non-nocturnal block(s), ${shed.toFixed(1)} h ` +
        `(${trimmed.map((b) => `${hhmm(b[0])}→${hhmm(b[1])}`).join(', ')}) — daytime is not this night's sleep`
    );
  }
  if (ov < MIN_OVERLAP) {
    console.log(`  ⊘ ${n.key} — three-way merged overlap ${ov.toFixed(1)} h < ${MIN_OVERLAP} h${trimmed.length ? ' (after the nocturnal trim above)' : ''}`);
    continue;
  }
  if (clusters.length > 1) {
    const shed = (ivSpan(threeIvAll) - ivSpan(chosen)) / 3600e3;
    console.log(`    · ${n.key}: ${clusters.length} concurrent blocks >${SLEEP_GAP_H} h apart — keeping the longest, shedding ${shed.toFixed(1)} h (daytime)`);
  }
  // Every stream is now clipped to the sleep window: a session that does not touch it is not part of
  // this night, whatever its date key says.
  const inSleep = (l) => (l ? l.filter((r) => ivSpan(ivIntersect(mergeIv([r]), threeIv)) > 0) : l);
  pick.oxy = inSleep(pick.oxy);
  pick.ecg = inSleep(pick.ecg);
  pick.ppg = inSleep(pick.ppg);
  pick.accH10 = inSleep(pick.accH10);
  pick.o2ppg = inSleep(pick.o2ppg);
  pick.accVer = inSleep(pick.accVer);
  pick.gyro = inSleep(pick.gyro);
  pick.magn = inSleep(pick.magn);
  console.log(
    `  ✓ ${n.key} — ${have.length < 3 ? 'PARTIAL (' + have.join('+') + ')' : 'concurrent trio'}, ${ov.toFixed(1)} h ${have.length < 3 ? 'overlap' : 'three-way overlap'} (merged sessions)` +
      (KEEP_DAYTIME ? '' : `, ${(noctFrac * 100).toFixed(0)}% nocturnal`)
  );
  trio.push(pick);
}

console.log(`\ntrio nights: ${trio.length}${LIMIT ? ` (limiting to ${LIMIT})` : ''}`);
let work = LIMIT ? trio.slice(0, LIMIT) : trio;

/* ── 3a · --skip-existing — a night is DONE only if the SAME inputs AND the SAME code produced it ──
 * Re-running a corpus to add ONE night recomputes every night: measured 38.4 s for a night that was
 * already on disk, byte-identical. Over a 20-night corpus that is the whole run wasted to add an hour
 * of new sleep.
 *
 * But "the folder exists" is NOT a safe skip, and this repo has been burned by exactly that shape
 * before (a served bundle a day stale behind a green gate; a fixture re-stamped as reproducible under
 * code that no longer reproduced it). A skip is a CLAIM that recomputing would change nothing, so it
 * is only allowed when both halves of that claim are checked:
 *   · inputs — every planned file's basename + size + mtime. A new session appended to a night, or a
 *     re-pull that replaced a truncated file, moves this digest and the night recomputes.
 *   · code   — the DSP sources the child actually loads, plus THIS FILE (its merge/clip/gate logic
 *     shapes the output as much as the DSPs do). Edit a DSP and every night recomputes, which is the
 *     whole point: a stale export that no current code reproduces is the defect, not the saving.
 * Neither digest stores a filename or a serial — only a hash — so the privacy contract above holds.
 *
 * The stamp is written ONLY after all three exports land, so a night an OOM-kill left half-written
 * (which has happened: 2026-07-06 kept only its ECGDex export) has no stamp and is always redone. */
const STAMP = '.trio-stamp'; // NOT *.json — tch-multinight --dir globs /\.json$/i and must not see it
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const CODE_DIGEST = (() => {
  const srcs = ['clock.js', 'kernel-constants.js', 'dex-export.js', 'oxydex-util.js', 'oxydex-dsp.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'].map((f) => join(ROOT, f)).concat([__filename]);
  return sha16(srcs.map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')).join('\0'));
})();
const inputDigest = (p) =>
  sha16(
    Object.keys(p)
      .sort()
      .flatMap((k) => {
        const v = p[k];
        return (Array.isArray(v) ? v : v && v.name ? [v] : []).map((f) => {
          let mt = 0;
          try {
            mt = statSync(f.full).mtimeMs;
          } catch {
            /* gone → digest changes → recompute */
          }
          return `${k}\0${f.name}\0${f.bytes}\0${mt}`;
        });
      })
      .sort()
      .join('\n')
  );
if (SKIP_EXISTING && !FORCE && !DRY) {
  const keep = [];
  for (const p of work) {
    const dir = join(OUT, p.key);
    const sf = join(dir, STAMP);
    let st = null;
    if (existsSync(sf)) {
      try {
        st = JSON.parse(readFileSync(sf, 'utf8'));
      } catch {
        st = 'BAD';
      }
    }
    const nJson = countTrioExports(dir);
    const why = redoReason(st, nJson, inputDigest(p), CODE_DIGEST);
    if (why) {
      // SAY WHY. "code changed" is the line that matters while the engine is being tuned: it is the
      // tool reporting that today's DSP bytes are not the ones that produced this night, which is the
      // version-awareness a hand-maintained version number would only approximate.
      keep.push(p);
      console.log(`  ↻ ${p.key} — recomputing: ${why}`);
    } else console.log(`  ⏭ ${p.key} — already computed from these inputs by this code (--skip-existing)`);
  }
  if (keep.length !== work.length) console.log(`  skipped ${work.length - keep.length} of ${work.length} night(s); ${keep.length} to compute`);
  work = keep;
}

if (DRY) {
  for (const p of work) {
    console.log(`\n  ${p.key}`);
    for (const [k, v] of Object.entries(p)) {
      const list = Array.isArray(v) ? v : v && v.name ? [v] : [];
      if (!list.length) continue;
      const mb = list.reduce((t, f) => t + f.bytes, 0) / 1e6;
      console.log(`    ${k.padEnd(7)} ${list.length} session(s), ${mb.toFixed(1)} MB total`);
      for (const f of list.slice(0, 3)) console.log(`            ${f.name}  (${(f.bytes / 1e6).toFixed(1)} MB)`);
      if (list.length > 3) console.log(`            … +${list.length - 3} more`);
    }
  }
  console.log('\n--dry-run: nothing computed, nothing written.');
  process.exit(0);
}

/* ── 3b · DISPATCH — one CHILD PROCESS per night, pool-capped to the host ────────────────────────────
 * Process-per-night, not worker-threads: a night's ~0.9 GB peak is returned to the OS the moment the
 * child exits, so memory never accumulates across a 17-night corpus. Threads would share one heap and
 * the high-water mark would only ever climb. It also contains a crash — one bad night can't take the run
 * down, it just reports and the pool continues.
 * The parent NEVER loads a DSP realm (see loadDsps) — it plans, spawns, and streams the children's lines.
 */
if (!CHILD && work.length >= 1 && (work.length > 1 || planConcurrency().jobs > 1)) {
  const plan = planConcurrency();
  const heapMB = childHeapMB(plan);
  console.log(
    `\nhost: ${plan.cores} core(s) · ${plan.totalGB.toFixed(1)} GB RAM (${plan.freeGB.toFixed(1)} GB free)` +
      `\nconcurrency: ${plan.jobs}${plan.forced ? ' (forced via --jobs)' : ''}` +
      ` — cpu allows ${plan.byCpu}, memory allows ${plan.byMem} @ ~${PER_JOB_GB} GB/night` +
      ` ⇒ ${plan.forced ? 'override' : 'min'} = ${plan.jobs} · child heap ${heapMB} MB`
  );
  if (!plan.forced && plan.byMem < plan.byCpu) console.log(`  note: MEMORY-bound on this host (${plan.budgetGB.toFixed(1)} GB usable) — more cores would not help.`);
  // Below one night's footprint we cannot honestly promise the run will survive. Say so LOUDLY rather
  // than letting the OS OOM-kill it half-way through and leave a truncated corpus behind (which has
  // happened: a killed run left 2026-07-06 with only its ECGDex export).
  if (plan.budgetGB < PER_JOB_GB)
    console.log(
      `  ⚠ LOW MEMORY: ~${plan.budgetGB.toFixed(1)} GB usable, but ONE night peaks at ~${PER_JOB_GB} GB` +
        ` (a ~330 MB PPG text is held while it parses into Float32 channels).\n` +
        `    Running anyway at 1×, but this host may swap or be OOM-killed. Close other apps, or process` +
        ` a night at a time with --night <YYYY-MM-DD>.`
    );

  /* ── NODE SPLIT — only ever with capacity to spare ──────────────────────────────────────────────
   * The pool parallelises across NIGHTS, so a run of one night used ONE core however many the host
   * has: measured 39.4 s at 104 % CPU on a 24-core box. The three nodes of a night are independent
   * (each reads its own streams and writes its own export), so with idle slots they can run as
   * separate children and the night's cost becomes max(node) instead of sum(node).
   *
   * ONLY with slots to spare. `plan.jobs` is already the probed floor of (cores−1, free RAM ÷ ~1.2 GB,
   * HARD_CAP) — on a small or busy machine it is 1, and then this is 1 too and nothing changes. Never
   * split when nights alone already fill the pool: the slots are full either way and splitting would
   * only add process startup and re-planning. So the split is strictly a use for capacity that would
   * otherwise idle, which is why it cannot make a modest host slower.
   *
   * A split child computes ONE node and does NOT write the night's stamp — it cannot know whether its
   * siblings succeeded. The PARENT writes it, once, after every node of that night has come back 0. */
  const splitNodes = shouldSplitNodes(plan.jobs, work.length);
  if (splitNodes) console.log(`  node-split: ON — ${work.length} night(s) < ${plan.jobs} slot(s), so each night's ${TRIO_NODES.length} nodes run as separate children`);

  const t0 = Date.now();
  const queue = splitNodes ? work.flatMap((p) => TRIO_NODES.map((n) => ({ p, node: n }))) : work.map((p) => ({ p, node: null }));
  const queue0 = queue.length; // immutable job count — `queue` is drained by the workers
  // How long to wait for a dead child's pipes to drain before reporting without them (see `settle`).
  const CHILD_STDIO_GRACE_MS = 5000;
  const nightOutcome = new Map(); // night key → { ok, total } so the parent can stamp a fully-green night
  let done = 0,
    failed = 0;
  const runOne = ({ p, node }) =>
    new Promise((res) => {
      const args = [`--max-old-space-size=${heapMB}`, __filename, '--src', SRC, '--out', OUT, '--night', p.key, '--child', '--min-hours', String(MIN_HOURS), '--min-overlap', String(MIN_OVERLAP)];
      if (node) args.push('--only-node', node);
      if (KEEP_DAYTIME) args.push('--keep-daytime');
      if (ALLOW_PARTIAL) args.push('--allow-partial');
      // The CHILD computes the night, so the child is what needs the CPAP path. Forgetting to forward
      // a flag across this boundary is silent: the parent parses it, the child never sees it, and the
      // feature simply does not happen while every night still reports success.
      if (CPAP_DIR) args.push('--cpap', CPAP_DIR);
      const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      ch.stdout.on('data', (d) => {
        out += d;
      });
      ch.stderr.on('data', (d) => {
        out += d;
      });
      /* ── THE RUN MUST NOT BE ABLE TO HANG AFTER THE WORK IS DONE (2026-08-13) ────────────────────
         `close` fires only once the child has exited AND every stdio pipe has reached EOF. Those are
         different events, and the second one can simply never arrive — a pipe held open leaves the
         parent waiting on a child that is already dead. Measured here: 17 nights computed, every
         `.trio-stamp` written, and the coordinator then sat for 32 minutes at 0 % CPU with a DEFUNCT
         child it had never reaped, because nothing but `close` could resolve this promise.

         That is the worst shape a hang can take: all the work is finished and none of it is reported,
         so it is indistinguishable from a slow night. `exit` is the event that actually means the
         process is gone, so it is the one that decides — `close` is still preferred when it arrives
         first (its stdio is complete), and `exit` arms a short grace period for the pipes to drain
         before resolving with what was captured.

         `error` is handled for the same reason: an unhandled `error` on a child emitter THROWS, so a
         spawn failure (EAGAIN under load, a bad interpreter path) would take down a run that has
         already computed most of its nights rather than failing that one job. */
      let settled = false;
      let graceT = null;
      const settle = (code, why) => {
        if (settled) return;
        settled = true;
        if (graceT) clearTimeout(graceT);
        if (why) out += `\n[trio-batch] child ${why}\n`;
        finish(code);
      };
      ch.on('error', (e) => settle(1, `spawn/runtime error: ${e && e.message ? e.message : e}`));
      ch.on('exit', (code, signal) => {
        // The process is GONE. Give the pipes a moment to flush, then report regardless.
        /* NOT unref'd, deliberately. An unref'd timer does not hold the event loop open, so if this
           grace period were the only pending work Node would EXIT — the promise never resolves, the
           worker loop never advances, and the remaining nights are dropped without a word. That is
           the same "finished but unreported" shape this whole block exists to prevent. Holding the
           loop for at most CHILD_STDIO_GRACE_MS is the cheaper failure. */
        graceT = setTimeout(() => settle(code == null ? (signal ? 1 : 0) : code, `exited (${signal || code}) but its stdio never closed — reporting anyway`), CHILD_STDIO_GRACE_MS);
      });
      ch.on('close', (code) => settle(code, null));
      function finish(code) {
        done++;
        // Print each night's block whole, so interleaved children never shred each other's output.
        const body = out
          .split('\n')
          .filter((l) => /^\s{4,}[✓✗⊘·⏱⚖]/.test(l)) // `{4,}`, ⏱ and ⚖: deeper-indented fit/agreement lines — an exact-4 filter silently ate the first, and a missing ⚖ ate the second
          .join('\n');
        console.log(`\n▸ ${p.key}${node ? ` · ${node}` : ''}  [${done}/${queue0}]${code === 0 ? '' : `  ✗ child exit ${code}`}`);
        if (body) console.log(body);
        if (code !== 0) {
          failed++;
          if (!body)
            console.log(
              out
                .trim()
                .split('\n')
                .slice(-3)
                .map((l) => '    ' + l)
                .join('\n')
            );
        }
        // A split night is only STAMPED once every one of its nodes has come back 0 — the same rule the
        // in-child path uses (all three exports landed), enforced here because no single child can see
        // its siblings. A night with one failed node stays unstamped and is redone next run.
        if (node) {
          const o = nightOutcome.get(p.key) || { ok: 0, total: TRIO_NODES.length };
          if (code === 0) o.ok++;
          nightOutcome.set(p.key, o);
          if (o.ok === o.total) {
            const dir = join(OUT, p.key);
            const nJson = countTrioExports(dir);
            if (nJson === TRIO_NODES.length)
              writeFileSync(join(dir, STAMP), JSON.stringify({ inputsDigest: inputDigest(p), codeDigest: CODE_DIGEST, nodes: TRIO_NODES.slice().sort() }, null, 2) + '\n');
            // …and the clock fit, for the same reason the stamp is here: it reads all THREE exports,
            // so no --only-node child can compute it correctly. Printed under its own heading because
            // by now the per-node blocks above have already been flushed.
            /* §4: the fit needs CPAP anchors plus WHATEVER wearable channels exist, so gating it on
               a full trio is the same fusion-precondition confusion `--allow-partial` exists to
               undo. Without this the flag admits the night and the one thing it was admitted FOR
               never runs — a feature that reports success while doing nothing. */
            if (CPAP_DIR && (nJson === TRIO_NODES.length || (ALLOW_PARTIAL && nJson >= 1))) {
              console.log(`\n▸ ${p.key} · clock fit`);
              printClockFit(dir, p.key);
            }
            /* The wearable DRIFT fit is deliberately OUTSIDE the CPAP gate: it aligns the H10 against
               the Verity from beat times both already export, so it needs no CPAP anchors and no
               `--cpap` flag. Gating it on the CPAP would be the same fusion-precondition confusion
               `--allow-partial` exists to undo — a night that cannot be clock-fitted can still be
               drift-fitted, and on this corpus that is most of them. */
            if (nJson >= 1) printDriftFit(dir, p.key);
            // The agreement gate needs at least two nodes to compare; it refuses below that itself.
            if (nJson >= 2) writeAgreement(dir, p.key);
            // Only when the capture wrote one — absent is the ordinary case, not a failure.
            writeArrival(dir, p.key, p);
          }
        }
        res();
      }
    });
  const workers = Array.from({ length: Math.min(plan.jobs, queue.length) }, async () => {
    while (queue.length) await runOne(queue.shift());
  });
  await Promise.all(workers);

  const secs = (Date.now() - t0) / 1000;
  const complete = readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory() && countTrioExports(join(OUT, d.name)) === TRIO_NODES.length).length;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`nights        : ${work.length} planned · ${complete} complete trio(s) on disk${failed ? ` · ${failed} child failure(s)` : ''}`);
  console.log(`wall-clock    : ${secs.toFixed(0)}s  (${(secs / Math.max(1, work.length)).toFixed(0)}s/night at ${plan.jobs}×${splitNodes ? `, nodes split ${TRIO_NODES.length}-way` : ''})`);
  console.log(`\nnext: node tools/tch-multinight.mjs --dir ${opt('--out', 'uploads/trio')}`);
  process.exit(failed ? 1 : 0);
}

/* ── 4 · compute + scrub + write ─────────────────────────────────────────── */
loadDsps(); // only reached by a CHILD, or a single-night / --jobs 1 run
const hoursOf = (ex) => {
  const d = ex && ex.recording && ex.recording.durationSec;
  return d != null ? d / 3600 : null;
};
// A scrubbed export must never carry the serial back out via a filename/device field.
const writeExport = (dir, node, key, ex) => {
  const scrubbed = dexScrubExport(ex);
  const f = join(dir, `${node}_${key}.node-export.json`);
  writeFileSync(f, JSON.stringify(scrubbed, null, 2) + '\n');
  const eps = (scrubbed.timeseries && scrubbed.timeseries.epochs) || [];
  const withHr = eps.filter((e) => e.hr != null).length;
  const withMot = eps.filter((e) => e.motionIndex != null).length;
  console.log(`    ✓ ${node.padEnd(7)} ${eps.length} epochs · ${withHr} hr · ${withMot} motion`);
  return { node, epochs: eps.length, hr: withHr, motion: withMot };
};

/* Apnea/hypopnea onsets from a ResMed `_EVE.edf`, straight from the device's OWN scoring — no DSP in
   the path, so the fit cannot be an artifact of our own event detection. Time base is the EDF header
   start plus each TAL's onset offset. */
/* A hoisted DECLARATION, not a `const` arrow: the dispatching parent calls this (via printClockFit)
   from a child-exit callback and then `process.exit()`s, so module evaluation never reaches this line
   and a `const` would still be in its temporal dead zone — "Cannot access 'cpapApneaTimes' before
   initialization", thrown into the fit's own try/catch and printed as a clock-fit failure. */
function cpapApneaTimes(dayDir) {
  const out = [];
  let files = [];
  try {
    files = readdirSync(dayDir).filter((f) => /_EVE\.edf$/.test(f));
  } catch {
    return out;
  }
  for (const f of files) {
    const b = readFileSync(join(dayDir, f));
    const S = (o, n) => b.toString('latin1', o, o + n).trim();
    const [dd, mm, yy] = S(168, 8).split('.').map(Number);
    const [hh, mi, ss] = S(176, 8).split('.').map(Number);
    const t0 = Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss);
    for (const m of b.toString('latin1').matchAll(/([+-]\d+(?:\.\d+)?)\x15(\d+(?:\.\d+)?)\x14([^\x14\x00]*)/g))
      if (/apnea|apnoea|hypopnea|hypopnoea/i.test(m[3])) out.push(t0 + parseFloat(m[1]) * 1000);
  }
  return out.sort((a, b) => a - b);
}

/* ── CLOCK FIT vs the CPAP (optional: --cpap) ────────────────────────────────────────────────────
   A CPAP has no user-settable clock and cannot be NTP-disciplined, so its offset is permanent and
   must be MEASURED. One candidate offset is slid across the night and EVERY wearable channel is scored
   at it (`fitClockOffsetPooled`, POOLED-CLOCK-FIT-2026-07-31-BRIEF), because the channels are individually
   weak and jointly decisive: on this corpus the pooled fit resolved four nights — 2026-06-14, 06-19,
   07-05, 07-25 — where no single channel cleared its own floor. Each channel's z at that offset is
   still printed separately, so a sensor that does NOT support the answer stays visible rather than
   being absorbed into a blend.

   Degrades by design: whatever subset of nodes produced events is used, and a channel that cannot
   contribute is printed WITH ITS REASON rather than omitted. A night with no CPAP data, or none that
   fits, prints that plainly instead of a fabricated correction.

   A NIGHT-level product, not a node-level one — it consumes all three exports, so it runs exactly
   once per night, in whichever process can see all of them (see the !ONLY_NODE / parent call sites).
   `loadDsps()` is called here rather than at start-up so a dispatching parent stays a few-MB
   coordinator until there is actually a fit to compute. */
/* ── WEARABLE DRIFT, from beat times the exports already carry ───────────────────────────────────
   The H10 and the Verity do NOT share a timebase across a night: measured 87 ppm = 2.26 s over 7.4 h,
   which exceeds an RR interval, so a constant-offset match walks off the correct beat partway through
   and reports ~16 % correspondence for a pair that actually agrees on ~90 % of heartbeats.

   Needs no raw files and no contract change — `timeseries.rr.tSec` (ECGDex) and `timeseries.ppi.tSec`
   (PpgDex) are already in the node-export. Prints the chance control beside every number, because the
   block fit maximises the statistic it reports. */
/* ── THE PACKET-ARRIVAL SIDECAR, WHEN THERE IS ONE (2026-08-13) ──────────────────────────────────
   `capture.py` writes a `*_PMDARRIVAL.csv` per stream: the HOST arrival stamp beside the DEVICE
   sensor counter for every BLE packet. Until now nothing outside `capture-host/nightqc.py` read it —
   trio ingested it zero times, so the one artefact that can place two devices on a single timebase
   reached a QC log and stopped there.

   ⚠️ MOST RECORDINGS WILL NOT HAVE ONE, AND THAT IS THE NORMAL PATH, NOT AN ERROR. The sidecar is
   written only by the capture box; a phone capture has none, and even on the box it only began on
   2026-08-11 — 2 of the 49 nights in this corpus carry any rows at all. Absent ⇒ this returns null
   and the fold is byte-identical to before. Present-but-empty counts as absent: several files are
   header-only, and `presence of a file is not presence of data`.

   WHAT IT YIELDS. Each device's counter has its own arbitrary epoch, so `host − device` is not a
   quantity in itself; what matters is the MAPPING from each device's counter onto host time, because
   two devices mapped onto one host clock are then mutually comparable — which is exactly the term
   PAT needs and has never had. `DexClock.hostAxis` is the sanctioned estimator for it (Clock Contract
   §7 forbids hand-rolling a rate correction), and it publishes `independent`: a phone-style host
   column that is merely the device stamp rounded is NOT a second clock, and must not be spent as one. */
function writeArrival(dir, key, p) {
  const dirs = new Set();
  for (const k of ['ecg', 'ppg', 'oxy', 'acc_h10', 'acc_ver', 'gyro', 'magn', 'o2ppg']) {
    for (const f of p[k] || []) if (f && f.full) dirs.add(dirname(f.full));
  }
  const files = [];
  for (const d of dirs) {
    try {
      for (const n of readdirSync(d)) if (n.endsWith('_PMDARRIVAL.csv')) files.push(join(d, n));
    } catch {
      /* unreadable dir → simply no sidecar from it */
    }
  }
  if (!files.length) return null; // NO BOX, NO SIDECAR — the ordinary case, silently unchanged
  loadDsps();
  const DexClock = ctx.DexClock;
  if (!DexClock || typeof DexClock.hostAxis !== 'function') return null;

  /* SCOPE THE ANCHORS TO THE NIGHT. The sidecars sit in the capture directory, which also holds the
     NEXT day's recordings — collecting every file in the directory fit one Verity axis across 89483 s
     (24.9 h), i.e. the night plus the following day, and called the result that night's clock. The
     window is taken from the exports this fold just wrote, padded an hour each side so a sidecar that
     starts slightly before the first analysable epoch still counts. */
  let winLo = Infinity,
    winHi = -Infinity;
  for (const node of ['PpgDex', 'ECGDex', 'OxyDex']) {
    const ef = join(dir, `${node}_${key}.node-export.json`);
    if (!existsSync(ef)) continue;
    try {
      const d = JSON.parse(readFileSync(ef, 'utf8'));
      const s0 = (d.recording || {}).startEpochMs;
      const eps = (d.timeseries || {}).epochs || [];
      if (!isFinite(s0) || !eps.length) continue;
      winLo = Math.min(winLo, s0);
      winHi = Math.max(winHi, s0 + (eps[eps.length - 1].tMin + 5) * 60000);
    } catch {
      /* unreadable export → contributes no window */
    }
  }
  const PAD_MS = 3600000;
  const inWindow = (t) => !isFinite(winLo) || (t >= winLo - PAD_MS && t <= winHi + PAD_MS);

  const byDev = new Map();
  let rows = 0;
  for (const f of files) {
    let txt = '';
    try {
      txt = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = txt.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      if (c.length < 5) continue;
      const t = DexClock.parseTimestamp(c[0], {});
      const devNs = Number(c[4]); // last_sensor_ns: the arrival stamp follows the LAST sample
      if (!t || !isFinite(devNs) || devNs <= 0) continue;
      if (!inWindow(t.tMs)) continue; // a packet from the NEXT day is not this night's clock
      const dev = c[1] || 'unknown';
      if (!byDev.has(dev)) byDev.set(dev, []);
      byDev.get(dev).push({ devMs: devNs / 1e6, hostMs: t.tMs });
      rows++;
    }
  }
  if (!rows) return null; // header-only files ⇒ treated as absent

  const medOf = (a) => {
    const v = a.slice().sort((x, y) => x - y);
    return v.length ? v[v.length >> 1] : NaN;
  };
  // Median absolute deviation — the honest scatter of a median under heavy BLE delivery jitter.
  const madOf = (a) => {
    const m = medOf(a);
    return medOf(a.map((x) => Math.abs(x - m)));
  };
  const devices = [];
  for (const [dev, anchors] of byDev) {
    anchors.sort((a, b) => a.devMs - b.devMs);
    const ax = DexClock.hostAxis(anchors, {});
    devices.push({
      device: dev,
      anchors: anchors.length,
      ok: !!ax.ok,
      reason: ax.ok ? undefined : ax.reason,
      // `independent` is the field to branch on — NOT a small ppm. A host column that is the device
      // stamp rounded reports ~0 ppm and is the ABSENCE of a second clock wearing its shape.
      independent: ax.independent == null ? null : ax.independent,
      spreadMs: ax.spreadMs == null ? null : Math.round(ax.spreadMs * 100) / 100,
      ppm: ax.ppm == null ? null : Math.round(ax.ppm * 10) / 10,
      maxStepMs: ax.maxStepMs == null ? null : Math.round(ax.maxStepMs * 10) / 10,
      // The mapping anchor: device counter -> host instant at the first anchor. Two devices carrying
      // this are on ONE timebase, which is the whole point.
      /* `independent` IS NOT "USABLE AS A CLOCK", and the O2Ring is the case that proves it. That flag
         only asks whether the host column differs from the device column; it says nothing about
         whether the DEVICE column is a clock at all. The ring's axis is DRAWN — sample_index x an
         assumed rate — so it passes an independence test it should never have been asked, at 2730 ppm
         where a real crystal is +/-100. Flag the implausibility here so no consumer spends it: a
         drawn axis may be PLACED on the host timeline, never spent as a second opinion about it. */
      plausibleCrystal: ax.ppm == null ? null : Math.abs(ax.ppm) <= 200,
      /* …and `plausibleCrystal` is a MAGNITUDE proxy for the question above, not an answer to it. It
         catches the ring only because that particular drawn axis happens to report 2730 ppm. A drawn
         axis whose assumed rate is nearly right reports a SMALL ppm and passes: measured 2026-08-14
         over 395 sidecars, one real O2Ring segment (2026-08-13, 1.72 h) reports **−22.83 ppm** — a
         textbook-plausible crystal, sitting between the H10's −20 and the Verity's −34 — with a
         drawn-delta share of 99.3 %. It passes `independent` (huge spread) AND `plausibleCrystal`
         (|−22.83| ≤ 200) while having no oscillator at all.
         `deviceDrawn` is the STRUCTURAL test the comment above actually wanted: concentration of the
         device's own inter-sample deltas, which separates the populations with no overlap (real
         streams ≤ 56.00 %, drawn ≥ 79.04 % over 381 files). Carried through so consumers can refuse
         on provenance rather than on magnitude. */
      deviceDrawn: ax.deviceDrawn == null ? null : ax.deviceDrawn,
      drawnShare: ax.drawnShare == null ? null : Math.round(ax.drawnShare * 1000) / 1000,
      /* THE MAPPING CONSTANT, AS A MEDIAN — never a single anchor. Per-device arrival spread here is
         3013 ms (Verity) and 7005 ms (H10), so one packet is not an estimate: taking the first put
         this offset 1355 ms from the median-derived value, which is larger than PAT itself. `MAD` is
         published beside it because a 500 ms offset with 3000 ms scatter is not a measurement, and
         the number has to say so. */
      offsetMs: anchors.length ? Math.round(medOf(anchors.map((a) => a.hostMs - a.devMs)) * 10) / 10 : null,
      offsetMadMs: anchors.length ? Math.round(madOf(anchors.map((a) => a.hostMs - a.devMs)) * 10) / 10 : null,
      t0DevMs: anchors.length ? Math.round(anchors[0].devMs) : null,
      t0HostMs: anchors.length ? anchors[0].hostMs : null,
      spanSec: anchors.length > 1 ? Math.round((anchors[anchors.length - 1].hostMs - anchors[0].hostMs) / 1000) : 0
    });
  }
  devices.sort((a, b) => b.anchors - a.anchors);
  const indep = devices.filter((d) => d.independent === true && d.plausibleCrystal !== false && d.deviceDrawn !== true).length;
  /* RING-CLOCK sidecar — the O2Ring's RTC watched against the host (FINISHED-WORK-IMPROVEMENTS §A 2c,
     from `O2RING-TIME-CAPABILITY-WIRING`). The daemon writes `*_rtclog.csv` per session via
     `capture-host/writers.py:RingClockLogWriter`; nightqc rolls the same rows into a summary via
     `nightqc.rtc_drift_summary`. This surfaces the same verdict beside `arrival_${key}.json` so
     downstream fold consumers can read the ring's RTC history off disk instead of the box's live
     status. A push is a CLAIM until the next read confirms it; a reset-suspect ruins the stored
     .dat's timebase, and finding one after the fold is the point of persisting the rows. */
  const ringClock = readRingClockLog(dirs, inWindow, DexClock);
  const datTimefit = readDatTimefit(dirs, winLo, winHi, ringClock);
  console.log(
    `    ⇄ arrival sidecar: ${devices.length} device(s), ${rows} packet(s)` +
      `  usable-clock: ${indep}/${devices.length}` +
      devices.map((d) => `  ${d.device.split(' ')[1] || d.device}:${d.ppm == null ? '—' : d.ppm + 'ppm'}/${d.spreadMs == null ? '—' : d.spreadMs + 'ms'}`).join('') +
      (ringClock ? `  ring-rtc: ${ringClock.reads}r/${ringClock.pushes}p/${ringClock.resets}x  drift ${ringClock.driftS == null ? '—' : ringClock.driftS + 's'}` : '') +
      (datTimefit ? `  dat-timefit: ${datTimefit.converged ? datTimefit.lagS + 's' : 'unconverged'}${datTimefit.disagrees ? ' ⚠DISAGREES' : ''}` : '')
  );
  const artefact = { night: key, packets: rows, files: files.length, devices };
  if (ringClock) artefact.ringClock = ringClock;
  if (datTimefit) artefact.datTimefit = datTimefit;
  writeFileSync(join(dir, `arrival_${key}.json`), JSON.stringify(artefact, null, 2) + '\n');
  return devices;
}

/* ── THE STORED .dat's CLOCK, FITTED TO HOST TIME (FINISHED-WORK §B4) ────────────────────────────
   `tools/o2ring-dat-timefit.mjs` cross-correlates the ring's onboard `.dat` against the live,
   host-stamped `_SPO2.csv` of the SAME 1 Hz session. Its header has claimed since it shipped that it
   "runs on every night on disk" and "VALIDATES the 0xC0 time-push, which nothing else measures" —
   and until now NOTHING INVOKED IT. This is that invocation.

   WHY HERE. `ringClock` above reads the RTC offset the ring REPORTS. The fit measures the offset the
   ring's stored data actually EXHIBITS. Two independent measurements of one quantity, so they can be
   checked against each other — which is the whole value, and neither alone can do it.

   🔴 BRANCH ON `converged`, NEVER ON `ok`. `ok` says a lag was chosen; `converged` says two
   independent columns, both strictly inside the search window, agreed on it. On a real pair the
   difference is not academic: at maxLag 600 the SpO2 leg survives at 400 s and at 3600 the pulse leg
   survives at 3581 s, both `ok`, disagreeing by 3181 s — the answer tracking the search width. Only
   a converged fit is recorded as a lag; an unconverged one is recorded as a REFUSAL with its reason,
   because "we looked and could not tell" is a different fact from "we did not look".

   ⚠️ maxLag is 4 h, and it is not generous. The observed lags across this corpus run to ±13509 s,
   so a narrow window does not merely miss a fit — it produces a boundary-pinned number that reads
   like one. `bestLag`'s `atBoundary` is what makes that visible; the width is what makes it rare. */
function readDatTimefit(dirs, winLo, winHi, ringClock) {
  /* ⚠️ FUNCTION-SCOPED, NOT MODULE-SCOPED, AND THAT IS LOAD-BEARING. These began as module-level
     `const`s below `writeArrival` and crashed the first real run with `Cannot access
     'DAT_STAMP_SLOP_MS' before initialization`: this file starts spawning children during module
     evaluation, and a child's exit callback reaches `writeArrival` before evaluation has walked far
     enough down the file to leave the temporal dead zone. Nothing in a type-check or an import
     smoke-test sees that — only a real fold does. */
  const DAT_MAX_LAG_S = 14400;
  const DAT_STAMP_SLOP_MS = 12 * 3600 * 1000;
  if (!isFinite(winLo) || !isFinite(winHi)) return null; // no host window ⇒ nothing to fit against
  const stampOf = (f) => {
    const m = /_(\d{14})_/.exec(f);
    if (!m) return null;
    const v = m[1];
    return Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12), +v.slice(12, 14));
  };
  /* The stored sessions sit in a `stored/` SIBLING of the night dirs, not inside them. */
  const datFiles = [];
  for (const d of dirs) {
    const st = join(dirname(d), 'stored');
    try {
      for (const n of readdirSync(st)) if (n.endsWith('_STORED.dat')) datFiles.push({ f: join(st, n), t: stampOf(n) });
    } catch {
      /* no stored/ dir → the ordinary phone-captured case, silently unchanged */
    }
  }
  const csvFiles = [];
  for (const d of dirs) {
    try {
      for (const n of readdirSync(d)) if (n.endsWith('_SPO2.csv')) csvFiles.push({ f: join(d, n), t: stampOf(n) });
    } catch {
      /* unreadable dir → contributes no candidate */
    }
  }
  if (!datFiles.length || !csvFiles.length) return null;

  /* ⚠️ THE `.dat` STAMP IS THE RING'S UNVERIFIED RTC — the very thing being measured — so it can only
     SHORTLIST, never select. The slop is wide (±12 h) because a battery event resets that clock by an
     unbounded amount, and the fit is what confirms. Selecting on the stamp would be assuming the
     answer. */
  const cands = datFiles.filter((d) => d.t != null && d.t > winLo - DAT_STAMP_SLOP_MS && d.t < winHi + DAT_STAMP_SLOP_MS);
  const csvs = csvFiles.filter((c) => c.t != null && c.t > winLo - DAT_STAMP_SLOP_MS && c.t < winHi + DAT_STAMP_SLOP_MS);
  if (!cands.length || !csvs.length) return null;

  let best = null;
  let attempts = 0;
  for (const dd of cands) {
    let dat;
    try {
      dat = readDat(dd.f);
    } catch {
      continue;
    }
    if (dat.length < 300) continue; // under 5 min of session — not enough shared fingerprint
    for (const cc of csvs) {
      let csv;
      try {
        csv = readSpo2Csv(cc.f);
      } catch {
        continue;
      }
      if (csv.length < 300) continue;
      attempts++;
      const fit = fitDatToSpo2Csv({ dat, csv, maxLag: DAT_MAX_LAG_S });
      if (!fit.converged) continue;
      /* Among converged fits, the PULSE column's error ranks them — measured 2026-08-23 over 48
         corpus pairs, SpO2 error does not discriminate a real match (it admits a 13626 s
         disagreement even below 0.5, because SpO2 barely moves overnight) while pulse error caps
         the disagreement at 8 s. Same reasoning as `AGREE_TOL_S`. */
      const err = fit.pulse ? fit.pulse.meanAbsErr : Infinity;
      if (!best || err < best.err) best = { err, fit, dat: dd.f, csv: cc.f };
    }
  }
  if (!best) return { converged: false, attempts, reason: 'no candidate .dat/_SPO2.csv pair produced a converged fit', dats: cands.length, csvs: csvs.length };

  const lagS = best.fit.chosen.lagS;
  /* THE CROSS-CHECK B4 ASKS FOR. `ringClock.lastOffsetS` is what the ring SAYS its clock is off by;
     `lagS` is what its stored data SHOWS. They should match to the second, plus whatever the clock
     drifted between the readback and the session. Beyond that the two disagree, and a disagreement
     between two independent measurements of one quantity is the finding — not something to average. */
  const reported = ringClock && ringClock.lastOffsetS != null ? ringClock.lastOffsetS : null;
  const driftAllowance = ringClock && ringClock.driftS != null ? Math.abs(ringClock.driftS) : 0;
  const delta = reported != null ? Math.round((lagS - reported) * 10) / 10 : null;
  /* `null`, not `false`, when there is no readback to compare against — see `timefitDisagrees`. A
     consumer must be able to tell "the two measurements agree" from "there is only one". */
  const disagrees = timefitDisagrees(lagS, reported, ringClock ? ringClock.driftS : null);
  return {
    converged: true,
    attempts,
    lagS,
    datStartHostMs: best.fit.datStartHostMs,
    spo2LagS: best.fit.spo2 ? best.fit.spo2.lagS : null,
    pulseLagS: best.fit.pulse ? best.fit.pulse.lagS : null,
    pulseErr: best.fit.pulse ? Math.round(best.fit.pulse.meanAbsErr * 1000) / 1000 : null,
    dat: basename(best.dat),
    csv: basename(best.csv),
    /* Both sides of the cross-check travel, so a consumer can re-judge it without re-fitting. */
    reportedOffsetS: reported,
    deltaS: delta,
    driftAllowanceS: driftAllowance,
    disagrees
  };
}

/* Roll every `*_rtclog.csv` in the arrival scope into ONE ring-clock verdict, or null when no sidecar
   is present or holds a readable row. Mirrors `nightqc.rtc_drift_summary` (Python) exactly:
     • reads / pushes / resets / batteries — per-event counts across every file, WINDOW-scoped.
     • firstOffsetS / lastOffsetS — the first and last periodic READ offset (push has no offset).
     • driftS — the free run between them.
     • firstReadMs / lastReadMs / spanH — clock-time bounds of the read events.
     • rows — the raw window-scoped rows so the fold consumer can re-derive anything else without
       reaching back to the sidecar (the point of persisting them beside the arrival JSON). */
function readRingClockLog(dirs, inWindow, DexClock) {
  const files = [];
  for (const d of dirs) {
    try {
      for (const n of readdirSync(d)) if (n.endsWith('_rtclog.csv')) files.push(join(d, n));
    } catch {
      /* unreadable dir → simply no sidecar from it */
    }
  }
  if (!files.length) return null; // NO SIDECAR — the ordinary phone-captured case, silently unchanged
  const rows = [];
  let reads = 0,
    pushes = 0,
    resets = 0,
    batteries = 0;
  let firstOffsetS = null,
    lastOffsetS = null,
    firstReadMs = null,
    lastReadMs = null;
  for (const f of files) {
    let txt = '';
    try {
      txt = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = txt.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      if (c.length < 3) continue;
      const t = DexClock.parseTimestamp(c[0], {});
      if (!t || !isFinite(t.tMs)) continue;
      if (!inWindow(t.tMs)) continue; // a row from the next day is not this night's clock
      const event = c[1];
      const offRaw = c[2] === '' || c[2] == null ? null : Number(c[2]);
      const offS = offRaw != null && isFinite(offRaw) ? offRaw : null;
      if (event === 'push') pushes++;
      else if (event === 'reset-suspect') resets++;
      else if (event === 'battery') batteries++;
      else if (event === 'read') reads++;
      if (event === 'read' && offS != null) {
        if (firstOffsetS == null) {
          firstOffsetS = offS;
          firstReadMs = t.tMs;
        }
        lastOffsetS = offS;
        lastReadMs = t.tMs;
      }
      rows.push({ tMs: t.tMs, event, offsetS: offS });
    }
  }
  if (!rows.length) return null; // header-only sidecars ⇒ treated as absent, same as `writeArrival`
  const driftS = firstOffsetS != null && lastOffsetS != null ? Math.round((lastOffsetS - firstOffsetS) * 10) / 10 : null;
  const spanH = firstReadMs != null && lastReadMs != null && lastReadMs > firstReadMs ? Math.round(((lastReadMs - firstReadMs) / 3.6e6) * 10) / 10 : null;
  return { files: files.length, reads, pushes, resets, batteries, firstOffsetS, lastOffsetS, driftS, firstReadMs, lastReadMs, spanH, rows };
}

/* ── THE CROSS-NODE AGREEMENT GATE, AND THE FIRST ARTEFACT THIS FOLD PERSISTS (2026-08-13) ───────
   Two shipped `ppgdex-dsp.js` defects — a wrong optical polarity on 10 of 20 nights, and a
   `correctRR` reference lock-in emitting a constant HR for 25 minutes — both passed five green
   PpgDex fixtures. Neither was visible inside the node (a polarity flip is common-mode across the
   three LEDs; a locked reference is self-consistent). Both were obvious the moment PpgDex was put
   beside the simultaneous ECG and ring — which is exactly what this fold had all the data to do and
   never did.

   So the fold now runs `IntegratorDSP.hrAgreement` over the exports it just wrote, and WRITES the
   verdict next to them. Writing it is half the point: every clock fit this tool computes is printed
   and then lost with the scrollback, so nothing downstream can read, diff or gate on any of it. The
   sidecar makes the night's cross-sensor verdict an artefact rather than a log line. */
function writeAgreement(dir, key) {
  // The PARENT never loads a DSP realm (it plans and spawns), so pull one in here — the same thing
  // `printDriftFit` does for the clock fit, and for the same reason.
  loadDsps();
  const nodes = ['PpgDex', 'ECGDex', 'OxyDex'];
  const sources = [];
  for (const n of nodes) {
    const f = join(dir, `${n}_${key}.node-export.json`);
    if (!existsSync(f)) continue;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8'));
      const s0 = (d.recording || {}).startEpochMs;
      const eps = ((d.timeseries || {}).epochs || [])
        .filter((e) => e && typeof e.hr === 'number' && isFinite(e.hr) && isFinite(e.tMin))
        // ABSOLUTE instant, never the epoch index: the nodes' starts differ by up to 24 min on this
        // corpus, so comparing tMin across them compares different moments.
        // `beats` is REQUIRED, not optional: hrAgreement drops truncated epochs by it, and omitting
        // the field makes that filter silently inert — the fix would be present and never applied.
        .map((e) => ({ tMs: s0 + e.tMin * 60000, hr: e.hr, beats: e.beats }));
      if (eps.length) sources.push({ node: n, epochs: eps });
    } catch {
      /* unreadable export → that node simply does not vote */
    }
  }
  const r = ctx.IntegratorDSP.hrAgreement(sources, {});
  if (!r || !r.ok) {
    console.log(`    ⚖ agreement: ${r && r.reason ? r.reason : 'not computed'}`);
    return null;
  }
  const worst = Object.keys(r.fault).sort((a, b) => r.fault[b] - r.fault[a])[0];
  const named = r.fault[worst] > 0 ? `  worst=${worst} (${r.fault[worst]})` : '';
  const dropNote = r.droppedFragments ? `  dropped=${r.droppedFragments} fragment(s)` : '';
  console.log(
    `    ⚖ HR agreement: ${r.flagged}/${r.compared} epoch(s) disagree >${r.tolBpm} bpm (${r.flaggedPct} %)` + `  adjudicable=${r.adjudicable}${dropNote}${named}  nodes=${r.nodes.join('/')}`
  );
  // Only the SUMMARY plus the flagged epochs — a full per-epoch dump would be most of the night.
  const outPath = join(dir, `agreement_${key}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        night: key,
        tolBpm: r.tolBpm,
        nodes: r.nodes,
        compared: r.compared,
        adjudicable: r.adjudicable,
        // What the gate DISCARDED, not just what it judged. A filter that silently drops epochs reads
        // as "covered everything" when it did not — the sidecar has to state its own coverage.
        droppedFragments: r.droppedFragments,
        flagged: r.flagged,
        flaggedPct: r.flaggedPct,
        fault: r.fault,
        epochs: r.epochs
      },
      null,
      2
    ) + '\n'
  );
  return r;
}

function printDriftFit(dir, key) {
  /* Timing PROVENANCE for a closure leg (WEARABLE-HOST-AXIS-FOLLOWUPS §F3). A drawn axis
     (`sample_index x an assumed rate`) is a constant, not a clock — passing one to fitClockClosure
     yields a confident number about nothing, which is how six nights failed with "all legs confident".
     Read straight from the node export the leg came from; absent ⇒ undefined ⇒ treated as usable. */
  const timingOf = (node) => {
    const f = join(dir, `${node}_${key}.node-export.json`);
    if (!existsSync(f)) return undefined;
    try {
      return (JSON.parse(readFileSync(f, 'utf8')).quality || {}).timingSource || undefined;
    } catch {
      return undefined;
    }
  };
  const rd = (node, path) => {
    const f = join(dir, `${node}_${key}.node-export.json`);
    if (!existsSync(f)) return null;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const ser = path.split('.').reduce((o, k) => (o == null ? o : o[k]), j.timeseries || {});
    const t0 = j.recording && j.recording.startEpochMs;
    if (!ser || !ser.tSec || t0 == null) return null;
    const out = [];
    for (let i = 0; i < ser.tSec.length; i++) if (!ser.corrected || ser.corrected[i] === 0) out.push(t0 + ser.tSec[i] * 1000);
    return out;
  };
  const A = rd('ECGDex', 'rr'),
    B = rd('PpgDex', 'ppi'),
    C = rd('PpgDexFinger', 'ppi');
  if (!A || !B || A.length < 500 || B.length < 500) {
    console.log('    ⏱ wearable drift: need ECGDex rr + PpgDex ppi beat series');
    return null;
  }
  loadDsps();
  const r = ctx.IntegratorDSP.fitClockDrift(A, B, {});
  if (r.offsetMs == null) {
    console.log(`    ⏱ wearable drift: unresolved — ${r.reason}`);
    return r;
  }
  /* CLOSURE FIRST — and the ordering IS the fix (§F5). d(A,B)+d(B,C)+d(C,A) is identically zero, so a
     non-zero result proves one of the three MEASUREMENTS is wrong — with no reference clock and no
     ground truth. Measured across six nights it is never zero, and on 2026-07-28 it misses by 58 ppm
     even though all three legs individually clear their own chance control: per-leg confidence is NOT
     sufficient. This used to be computed twenty lines BELOW the drift print, so the ppm and its
     seconds-over-the-night conversion were already on screen, stated as fact, by the time the number
     that voids them was known. `CROSS-DEVICE-DRIFT-AND-CLOSURE` §6 forbids exactly that. */
  let closure = null;
  let cl = null;
  if (C && C.length >= 500) {
    cl = ctx.IntegratorDSP.fitClockClosure(
      [
        { name: 'H10', times: A, timingSource: timingOf('ECGDex') },
        { name: 'VER', times: B, timingSource: timingOf('PpgDex') },
        { name: 'O2R', times: C, timingSource: timingOf('PpgDexFinger') }
      ],
      {}
    );
    if (cl.ok && cl.triples.length) {
      const tri = cl.triples[0];
      closure = { closurePpm: tri.closurePpm, consistent: tri.consistent, weakLegs: tri.weakLegs };
    } else if (cl.excluded && cl.excluded.length) {
      // A refusal is a RESULT, and it is a DIFFERENT result from "no third sensor was worn".
      closure = { refused: true, reason: cl.reason };
    }
  }
  console.log(DriftReport.driftFitLine(r, closure));
  // A refusal is printed too — saying nothing here is how a drawn leg stayed invisible for six nights.
  const clLine = DriftReport.closureLine(cl);
  if (clLine) console.log(clLine);
  return { driftPpm: r.driftPpm, offsetMs: r.offsetMs, corr: r.medianCorrespondence, chance: r.chanceCorrespondence, iqrMs: r.medianIqrMs, confident: r.confident, closure };
}

function printClockFit(dir, key) {
  if (!CPAP_DIR) return null;
  try {
    const ap = cpapApneaTimes(join(CPAP_DIR, key.replace(/-/g, '')));
    if (!ap.length) {
      console.log('    ⏱ clock-fit: no CPAP events for this night');
      return null;
    }
    loadDsps();
    const chans = [];
    for (const node of ['OxyDex', 'ECGDex', 'PpgDex']) {
      const f = join(dir, `${node}_${key}.node-export.json`);
      if (!existsSync(f)) continue;
      const ex = JSON.parse(readFileSync(f, 'utf8'));
      const t0 = ex.recording && ex.recording.startEpochMs;
      const by = {};
      for (const e of ex.ganglior_events || []) {
        let ms = e.tMs;
        if (ms == null && t0 != null && e.t) {
          const [h, m, sec] = e.t.split(':').map(Number);
          const d = new Date(t0);
          ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, sec);
          while (ms < t0 - 3600e3) ms += 86400e3;
        }
        if (ms != null && isFinite(ms)) (by[e.impulse || 'event'] ||= []).push(ms);
      }
      for (const k of Object.keys(by).sort()) chans.push({ node, channel: k, times: by[k] });
    }
    const fit = ctx.IntegratorDSP.fitClockOffsetPooled(ap, chans, {});
    console.log(DriftReport.clockFitLine(fit, ap.length));
    for (const c of fit.channels) {
      console.log(
        c.usable
          ? `        · ${(c.node + '/' + c.channel).padEnd(38)} z ${String(c.zAtPeak).padStart(6)}${c.agreed ? '' : `   (own peak ${(c.ownOffsetSec / 60).toFixed(2)} min — does NOT support this offset)`}`
          : `        · ${(c.node + '/' + c.channel).padEnd(38)} —      (${c.reason})`
      );
    }
    return fit;
  } catch (e) {
    console.log(`    ⏱ clock-fit failed: ${e.message}`);
    return null;
  }
}

mkdirSync(OUT, { recursive: true });
const summary = [];

for (const p of work) {
  console.log(`\n▸ ${p.key}`);
  const dir = join(OUT, p.key);
  mkdirSync(dir, { recursive: true });
  const row = { key: p.key, nodes: [] };

  /* ── MERGING SESSIONS, AND WHY IT IS DONE ON PARSED RECORDS ────────────────────────────────
     Concatenating the raw TEXT is not an option: the worst per-stream union in this corpus is
     775 MB (07-20 Verity ACC) and 559 MB (07-18 ECG), both past V8's ~537 MB maximum string, so a
     text merge would throw `Invalid string length` on exactly the nights with the most data.
     Parsed samples are ~10x denser than their text, so merging there is both safe and exact.

     NO TIME IS EVER FABRICATED. The silence between two sessions is real — the sensor was off-link
     — and each parser already has a way to say so, which is the way used here:
       ECG carries `gaps:[{idx,ms}]`, so the inter-session silence becomes one more gap entry at
       the join, and every carried-over gap has its index shifted by the join offset.
       PPG carries per-sample `relSec`, so a later session's samples simply land at their true
       offset from the first session's t0 and the hole appears as a jump in relSec.
     A merge that closed those holes instead would be inventing signal. */
  const mergeEcg = (recs) => {
    recs = recs.filter((r) => r && r.int16 && r.int16.length && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
    if (recs.length <= 1) return recs[0] || null;
    /* The LONGEST fragment's fs, not the first one's. Both are `130 Hz + host-axis correction`, but the
       correction is only applied to fragments that clear ECGDex's span gate (40 min), so `recs[0]` is
       routinely a 5-second reconnect stub carrying the raw device crystal while a 7-hour fragment on the
       same night carries the disciplined rate. Sample-index → duration is imposed on every fragment
       here, so it should come from the fragment that owns most of the samples. */
    const fs = recs.reduce((a, b) => (b.int16.length > a.int16.length ? b : a), recs[0]).fs;
    /* A rate change mid-night would make one sample index mean two different durations. It does not
       happen on an H10 (130 Hz fixed), but assuming it cannot is how a silent corruption starts.
       0.05 Hz = 385 ppm. The old bound was 0.5 Hz = 3846 ppm, which was never a guard on anything real:
       an H10 crystal lives within ~30 ppm, and the widest per-night spread across the 2026-07-16..29
       corpus is 52 ppm. It was loose enough to admit a 133.2 Hz fragment (an ungated host-axis rate off
       a 62 s stub — the defect this bound could not see, fixed at source in `ecgdex-dsp.js`) while still
       being tight enough to THROW on it, so a good night failed to fold for the wrong reason. */
    const odd = recs.find((r) => Math.abs((r.fs || fs) - fs) > 0.05);
    if (odd) throw new Error(`ECG sessions disagree on fs (${fs} vs ${odd.fs}) — refusing to merge`);
    let n = 0;
    for (const r of recs) n += r.int16.length;
    const out = new Int16Array(n);
    const gaps = [];
    const overlaps = [];
    const clockResyncs = [];
    let idx = 0,
      prevEndMs = null;
    for (const r of recs) {
      if (prevEndMs != null) {
        const d = r.t0Ms - prevEndMs;
        /* `idx`, not `idx - 1` — THE CONVENTION IS "the first sample AFTER the dropout"
           (INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.1, fixed 2026-07-31; stated at the definition in
           `ecgdex-dsp.js parseECGText`). At this point `idx` is where THIS session's first sample is
           about to land, so `idx` IS the first sample after the silence — and `idx - 1` was the last
           one before it, the opposite of what `parseECGText` emits for an in-file dropout.
           Why first-after wins: the consumer (the dead-time walk in `ecgdex-dsp.js`) tests
           `g.idx <= refIdx[k]` and credits the dropout to every beat at or past that index. Under
           first-after, a beat ON the boundary sample is genuinely after the hole and SHOULD carry the
           dead time. Under last-before it was credited to the beat immediately BEFORE the hole too —
           one sample, 7.7 ms at 130 Hz, immaterial against hour-scale segments (which is why it went
           unnoticed) but wrong in the direction that inflates elapsed time. */
        if (d > 0)
          gaps.push({ idx, ms: d }); // the real off-link silence
        /* d < 0 = this session starts BEFORE the previous one is predicted to end: either the two
           overlap in wall-clock, or `fs` over-states the previous fragment's duration. Samples are
           concatenated contiguously, so the merged timeline is longer than reality by |d| and there is
           no honest single-scalar repair. COUNTED rather than silently dropped: measured 0 of 33
           boundaries on 2026-07-26 and 0 across the 2026-07-16..29 corpus, so this is a tripwire for a
           regime we have not seen, not a live correction. If it ever fires, the merge is lying about
           elapsed time and the fold should be treated as suspect. */
        else if (d < 0) overlaps.push({ idx, ms: d });
      }
      for (const g of r.gaps || []) gaps.push({ idx: g.idx + idx, ms: g.ms });
      /* A mid-file clock resync (DEEP-AUDIT-VI F1) is a property of the NIGHT, not of the fragment it
         happened in — two of the three poisoned nights (08-23, 08-27) are multi-fragment, and without
         this line their folded exports carried no `recording.clockResyncs` while the single-fragment
         08-26 did. `idx` re-bases onto the merged sample index; `atRelMs` onto the merged relative
         axis via the fragment's wall-clock start, the same axis `gaps[].idx` above lands on. */
      for (const c of r.clockResyncs || []) clockResyncs.push({ ...c, idx: c.idx + idx, atRelMs: c.atRelMs + (r.t0Ms - recs[0].t0Ms) });
      out.set(r.int16, idx);
      idx += r.int16.length;
      prevEndMs = r.t0Ms + (r.int16.length / fs) * 1000;
    }
    if (overlaps.length)
      console.warn(
        `  ⚠ ECG merge: ${overlaps.length} negative session boundary(ies), total ${(overlaps.reduce((a, o) => a + o.ms, 0) / 1000).toFixed(2)} s — merged elapsed time is OVER-stated by that much`
      );
    return {
      int16: out,
      fs,
      gaps,
      overlaps,
      clockResyncs,
      t0Ms: recs[0].t0Ms,
      offsetMin: recs[0].offsetMin,
      source: 'file',
      durSec: n / fs,
      /* Carry the TIMING PROVENANCE across the merge — the ECG twin of mergePpg's F3 fix below
         (WEARABLE-HOST-AXIS-FOLLOWUPS §F3): without this a folded multi-fragment night has no
         `hostAxis`/`deviceEpoch`, so the export's `recording.timingSource`/`recording.deviceEpoch`
         (H10-2019-ORIGIN) came out absent on exactly the nights BLE reconnects fragment — the common
         case. Independence mirrors mergePpg's rule: it is a property of the capture SETUP, so any
         fragment that resolved it speaks for the night; `ok:false` because a merged night has no
         single anchor set — the fs above already carries the longest fragment's correction. */
      hostAxis: (() => {
        const parts = recs.filter((r) => r.hostAxis);
        if (!parts.length) return undefined;
        const indep = parts.some((r) => r.hostAxis.independent === true) ? true : parts.some((r) => r.hostAxis.independent === false) ? false : null;
        return {
          ok: false,
          merged: true,
          fragments: parts.length,
          independent: indep,
          timingSource: indep === true ? 'device+host' : indep === false ? 'device' : null,
          reason: 'merged night — per-fragment axes; fs carries the longest fragment’s correction'
        };
      })(),
      /* Bimodal years-vs-seconds, so no sample-weighting: the night is plausible only if EVERY
         fragment is (a mid-night sync leaves the early fragments on the 2019 origin), and the
         published offset is the worst fragment's — the one a reader needs to see. */
      deviceEpoch: (() => {
        const parts = recs.filter((r) => r.deviceEpoch);
        if (!parts.length) return null;
        const worst = parts.reduce((a, b) => (Math.abs(b.deviceEpoch.offsetMs) > Math.abs(a.deviceEpoch.offsetMs) ? b : a));
        return { offsetMs: worst.deviceEpoch.offsetMs, plausible: parts.every((r) => r.deviceEpoch.plausible) };
      })()
    };
  };
  const mergePpg = (recs) => {
    recs = recs.filter((r) => r && r.n && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
    if (recs.length <= 1) return recs[0] || null;
    /* SESSIONS AT DIFFERENT SAMPLE RATES MUST NOT SHARE A GRID. This merge concatenates samples and
       stamps ONE `fs`; it used to take `recs[0].fs` and validate only channel count and site, so a
       night whose rate changed mid-way was merged under the FIRST fragment's rate.
    
       Measured 2026-08-03. The Verity moved 55 Hz -> 176 Hz at 21:54; the fold merged 18 sessions
       spanning both and declared fs = 55 over data that was mostly 176 Hz. Beat detection derives its
       refractory window in SAMPLES from `fs`, so the window came out 3.2x too short in real time, a
       second peak per cardiac cycle was accepted, and the night's mean HR exported as **108.6 bpm
       against the chest ECG's 52.1** — a clean 2.08x. Nothing errored. The three-cornered hat then
       faithfully reported the Verity as the night's worst sensor (sigma 3.37 bpm) on a doubled series,
       which is how a fold bug turns into a false finding about hardware.
    
       DROP the minority-rate sessions rather than throw: the ECG path refuses outright, but here the
       dominant rate usually carries almost the whole night, and refusing would discard a good recording
       over a few minutes of pre-sleep fragments. Keep the LONGEST session's rate (by samples, not by
       being first — the stray fragment is often earliest), and say what was dropped. */
    const domFs = recs.reduce((a, b) => (b.n > a.n ? b : a), recs[0]).fs;
    const rateOk = (r) => !(r.fs > 0) || !(domFs > 0) || Math.abs(r.fs - domFs) / domFs <= 0.05;
    const offRate = recs.filter((r) => !rateOk(r));
    if (offRate.length) {
      const secs = offRate.reduce((t, r) => t + r.n / (r.fs || domFs || 1), 0);
      console.warn(
        `  ⚠ PPG merge: dropped ${offRate.length} session(s) at a different sample rate ` +
          `(${[...new Set(offRate.map((r) => (r.fs || 0).toFixed(1)))].join('/')} Hz vs ${domFs.toFixed(1)} Hz, ` +
          `${(secs / 60).toFixed(1)} min) — merging them would mis-time beat detection`
      );
      recs = recs.filter(rateOk);
      if (recs.length <= 1) return recs[0] || null;
    }
    const base = recs[0];
    const nch = base.ch.length;
    const bad = recs.find((r) => r.ch.length !== nch || r.site !== base.site);
    if (bad) throw new Error('PPG sessions disagree on channel count or site — refusing to merge');
    let n = 0;
    for (const r of recs) n += r.n;
    const ch = Array.from({ length: nch }, () => new Float32Array(n));
    const amb = new Float32Array(n);
    const relSec = new Float64Array(n);
    let idx = 0;
    for (const r of recs) {
      const off = (r.t0Ms - base.t0Ms) / 1000; // true offset — the gap shows up here
      for (let c = 0; c < nch; c++) ch[c].set(r.ch[c].subarray(0, r.n), idx);
      if (r.amb) amb.set(r.amb.subarray(0, r.n), idx);
      for (let i = 0; i < r.n; i++) relSec[idx + i] = off + r.relSec[i];
      idx += r.n;
    }
    return {
      ch,
      amb,
      relSec,
      fs: base.fs,
      n,
      t0Ms: base.t0Ms,
      offsetMin: base.offsetMin,
      durSec: relSec[n - 1],
      site: base.site,
      gap: null,
      sentinelRejected: recs.reduce((t, r) => t + (r.sentinelRejected || 0), 0),
      sentinelKept: recs.reduce((t, r) => t + (r.sentinelKept || 0), 0),
      /* Carry the TIMING PROVENANCE across the merge (WEARABLE-HOST-AXIS-FOLLOWUPS §F3). Without this
         the merged rec has no `hostAxis`, so the export's `quality.timingSource` came out null on every
         folded night — the field existed and was never populated, which is precisely the hollow-gate
         failure this repo keeps hitting.

         SAMPLE-WEIGHTED, not worst-case. A worst-case rule was tried first and measured to be wrong: it
         refused 2026-07-28, a night whose O2Ring genuinely reports real timestamps and which closes at
         -11.4 ppm, because one short fragment carried too few host anchors to judge. Weighting by
         samples makes the merged verdict identical to what the single-file detector would say if the
         fragments were concatenated — which is the thing being approximated. */
      hostAxis: (() => {
        const parts = recs.filter((r) => r.hostAxis && r.n > 0);
        if (!parts.length) return undefined;
        let tot = 0,
          acc = 0,
          anyOk = false;
        for (const r of parts) {
          if (r.hostAxis.quantizedShare != null) {
            acc += r.hostAxis.quantizedShare * r.n;
            tot += r.n;
          }
          if (r.hostAxis.ok) anyOk = true;
        }
        const share = tot > 0 ? acc / tot : null;
        /* MIRRORS parsePPG's `axisSynthetic` (DA-V §2.7 F17) — and it MUST, because this is the fold
           path and the single-file path, and a provenance rule that holds in one and not the other is
           how a folded night ends up making a claim the same bytes would not make unfolded.
           The share-based signature alone went blind when capture-host's rate-SLEW estimator (2026-07-27)
           stopped the synthesised column being a singleton delta set: `quantizedShare` fell to 0.00083
           on a real night, so `drawn` read false and every folded O2Ring night claimed
           `timingSource:'device+host'` — a real second clock — for an axis accumulated from host
           arrival times. The O2Ring layout is the provenance fact; the fingerprint is only evidence
           for it, and the writer can erase the evidence. */
        const isFinger = parts.some((r) => r.site === 'finger');
        const drawn = (share != null && share >= 0.99) || isFinger;
        /* INDEPENDENCE CARRIES ACROSS THE MERGE TOO (DA-V §2.4 F13). A fold whose fragments all say
           "this host column is the device stamp rounded" has no second clock either, and dropping the
           verdict here would re-introduce on the fold path exactly what parsePPG stopped claiming on
           the single-file one. ANY fragment with a genuinely independent host column is enough to
           earn `device+host` — independence is a property of the capture setup, and a short fragment
           that could not resolve it is silent, not contradictory. */
        const indep = parts.some((r) => r.hostAxis.independent === true) ? true : parts.some((r) => r.hostAxis.independent === false) ? false : null;
        return {
          ok: anyOk,
          fragments: parts.length,
          quantizedShare: share,
          drawn,
          independent: indep,
          // Mirrors parsePPG: a drawn axis with host anchors is host-timed; with none, it has no timing.
          timingSource: drawn ? (anyOk ? 'host' : 'none') : indep === false ? 'device' : 'device+host'
        };
      })()
    };
  };

  /* ECGDex — raw H10 _ECG is the HONEST H10 leg (device _HR.txt is smoothed; CLAUDE.md).
     Build the parsed rec, then attach the _ACC companion so posture/accExtras run. */
  /* `--allow-partial` admits nights that have no ECG or no PPG at all, so a node whose input is
     absent must be SKIPPED, not attempted. Without this the compute throws "Cannot read properties
     of null" twice per partial night — 80 times over the corpus — and prints a ✗ for a node that was
     never going to exist. A missing leg is a fact about the night, not a failure. */
  if (wantNode('ECGDex') && p.ecg && p.ecg.length)
    try {
      const rec = mergeEcg(p.ecg.map((f) => ECGDex.parseECG(readFileSync(f.full, 'utf8'))));
      if (p.accH10 && p.accH10.length) {
        /* ALL concurrent ACC sessions, laid on ONE UNIFORM GRID with the silence between them padded.
           `[0]` was wrong (the earliest session is often a settling fragment: 2026-07-27 had 7 sessions
           with `[0]` = 0.2 MB against a real 60 MB one). Taking the LONGEST fixed that, but only that:
           accExtras/epochMotion index deviceACC as UNIFORMLY sampled from `[0].tsMs`, so a plain concat
           would time-shift every sample after the first gap — which is why the longest was taken alone.

           The premise that "the longest covers essentially the whole window" does not hold. Measured over
           2026-07-16..26, ECGDex motion coverage ran 39–98 % of epochs while PpgDex and OxyDex were 100 %
           on every night; 2026-07-25 lost a contiguous 26-epoch (~130 min) block at the START, with ECG
           and ACC spanning the same 7.7 h — four earlier ACC fragments (22:34→23:00) were simply
           discarded. The correlated-TCH's motion-ρ third corner therefore saw less of the night than the
           other two, which is the leg PR #483 exists to provide.

           So: place every session at its TRUE index on one grid at the first session's rate, and fill the
           never-written slots with non-finite samples. Alignment is preserved BY CONSTRUCTION (an index
           is a time), and the DSP's epoch accumulator treats a non-finite sample as a HOLE — lowering
           coverage, never entering the mean — so a gap epoch still reports `null`, not a fabricated
           stillness. Falls back to the longest single session if the grid would be implausibly large, so
           one wild stamp degrades to the old behaviour instead of allocating a night-sized array. */
        const accRecs = p.accH10
          .map((f) => {
            try {
              return ECGDex.parseDeviceACC(readFileSync(f.full, 'utf8'));
            } catch {
              return null;
            }
          })
          .filter((a) => a && a.acc && a.acc.length && a.acc[0].tsMs != null)
          .sort((x, y) => x.acc[0].tsMs - y.acc[0].tsMs);
        if (accRecs.length) {
          /* The FINEST rate present, not the first session's. The grid index is a time, so mixed
             rates align by construction — but the RESOLUTION must be able to hold the fastest stream
             or two of its samples round to the same slot and one is silently overwritten. The Verity
             moved 52 -> 26 -> 416 Hz across 2026-08-02 when SDK mode was toggled; taking `[0]` there
             would have quantised the fastest sessions onto a coarse grid. A finer grid only costs
             holes, which the DSP already treats as missing rather than as stillness. */
          const fsAcc = accRecs.reduce((mx, r) => Math.max(mx, r.accFs || 0), 0) || 51;
          const t0Acc = accRecs[0].acc[0].tsMs;
          const tEnd = accRecs.reduce((mx, r) => Math.max(mx, r.acc[r.acc.length - 1].tsMs), t0Acc);
          const nGrid = Math.round(((tEnd - t0Acc) / 1000) * fsAcc) + 1;
          const CAP = 36 * 3600 * 200;
          if (accRecs.length > 1 && nGrid > 0 && nGrid <= CAP) {
            const grid = new Array(nGrid);
            for (const r of accRecs) {
              for (const smp of r.acc) {
                const i = Math.round(((smp.tsMs - t0Acc) / 1000) * fsAcc);
                if (i >= 0 && i < nGrid) grid[i] = smp;
              }
            }
            let filled = 0;
            for (let i = 0; i < nGrid; i++) {
              if (grid[i]) filled++;
              else grid[i] = { x: NaN, y: NaN, z: NaN, tsMs: t0Acc + (i / fsAcc) * 1000 };
            }
            rec.deviceACC = grid;
            rec.accFs = fsAcc;
            const pct = ((filled / nGrid) * 100).toFixed(0);
            const hrs = ((tEnd - t0Acc) / 3600e3).toFixed(1);
            console.log(`    \u00b7 ${p.key}: H10 ACC \u2014 ${accRecs.length} session(s) on one grid, ${pct}% of ${hrs} h covered (rest padded as holes)`);
          } else {
            const best = accRecs.reduce((b, r) => (r.acc.length > b.acc.length ? r : b), accRecs[0]);
            rec.deviceACC = best.acc;
            rec.accFs = best.accFs;
          }
        }
      }
      const ex = ECGDex.compute(rec, { ...COMMON, source: 'polar-h10-ecg' });
      const h = hoursOf(ex);
      if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ ECGDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
      else row.nodes.push(writeExport(dir, 'ECGDex', p.key, ex));
    } catch (e) {
      console.log(`    ✗ ECGDex  ${e.message}`);
    }

  /* PpgDex — Verity HR MUST come from raw _PPG (device _HR.txt is all-zero; _PPI is header-only).
     ACC+GYRO drive the per-epoch motionIndex. */
  // Same as ECGDex above: a night with no PPG is a partial night, not a broken one.
  if (wantNode('PpgDex') && p.ppg && p.ppg.length)
    try {
      const rec = mergePpg(p.ppg.map((f) => PpgDex.parsePPG(readFileSync(f.full, 'utf8'))));
      // The IMU companions stay single-session: they only drive the per-epoch motionIndex, and the
      // 775 MB ACC union is the one that would blow the string limit. Documented, not silent.
      /* EVERY concurrent session, not `[0]`.
         `[0]` discarded 99 % of the night. Measured on 2026-07-26: 50 Verity ACC fragments totalling
         229 MB, of which the first held 2.2 MB — so PpgDex's motionIndex, posture, every magnetometer
         feature and the movement_onset impulse were all computed from roughly the first two minutes of
         each night. The H10 ACC path already learned this ("`[0]` was wrong … the earliest session is
         often a settling fragment") and was fixed to a padded uniform grid; this path was never given
         the same treatment.

         A GRID is not needed here, and that is the whole reason the fix differs from the H10's.
         `accExtras` indexes deviceACC as UNIFORMLY sampled, so a plain concat there would time-shift
         every sample after a gap. PpgDex instead times each row through `relSecOf`, which reads an
         ABSOLUTE per-row stamp — so a time-ordered concat is already correctly placed, and silence
         between fragments is simply absent rather than mis-timed.

         `relNs` must be dropped, though: it is the DEVICE counter and restarts at 0 in every fragment,
         so `relSecOf` would fold all 50 sessions onto the first one's window. Clearing it makes the
         helper fall through to the absolute `tMs` path. Millisecond resolution is ample for a 0.25 s
         motion grid. */
      const xyz = (l) => {
        if (!l || !l.length) return null;
        const rows = [];
        for (const f of l) {
          const parsed = ctx.PPGDSP.parseSensorXYZ(readFileSync(f.full, 'utf8'));
          for (const r of parsed || []) if (r.tMs != null && isFinite(r.tMs)) rows.push({ ...r, relNs: NaN });
        }
        rows.sort((a, b) => a.tMs - b.tMs);
        return rows.length ? rows : null;
      };
      rec.acc = xyz(p.accVer);
      rec.gyro = xyz(p.gyro);
      rec.magn = xyz(p.magn);
      const ex = PpgDex.compute(rec, { ...COMMON, source: 'polar-sense-ppg' });
      const h = hoursOf(ex);
      if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ PpgDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
      else row.nodes.push(writeExport(dir, 'PpgDex', p.key, ex));
    } catch (e) {
      console.log(`    ✗ PpgDex  ${e.message}`);
    }

  /* ── PpgDexFinger — the O2RING'S OWN plethysmogram through the SAME node ───────────────────────
     `dex-ingest` has always routed `Wellue_*_PPG.txt` to PpgDex as its "legitimate finger PRIMARY",
     and `ppgdex-registry` already grades finger morphology on its own tier — but this fold never fed
     it, so the finger site had never been computed at scale and every corpus run was Verity-only.

     SAME node, SAME code, different site: PpgDex detects the site from the column count (one
     reflectance path = O2Ring finger, three LED columns = Verity), so nothing here has to declare it
     — the export's `recording.site` is derived, not asserted.

     Written under a distinct name rather than as a fourth trio member: the trio is what
     `tch-multinight` and the clock fit consume, and a night without the capture host still has to be
     a complete trio. `countTrioExports` above exists so this file cannot be mistaken for one.

     THE POINT is the comparison it unlocks. The finger and the wrist see the SAME heart through two
     different optical paths, so their PPI series are two independent estimates of one truth — the
     only cross-device interval check this suite can make, since neither device publishes usable
     firmware intervals (the Verity's `_PPI.txt` is often header-only, its `_HR.txt` all-zero, and the
     O2Ring publishes none at all). */
  if (wantNode('PpgDex') && p.o2ppg && p.o2ppg.length)
    try {
      const frec = mergePpg(p.o2ppg.map((f) => PpgDex.parsePPG(readFileSync(f.full, 'utf8'))));
      const fex = PpgDex.compute(frec, { ...COMMON, source: 'o2ring-finger-ppg' });
      const fh = hoursOf(fex);
      if (!KEEP_DAYTIME && fh != null && fh < MIN_HOURS) console.log(`    ⊘ PpgDexFinger  ${fh.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
      else {
        writeExport(dir, 'PpgDexFinger', p.key, fex);
        const site = fex.recording && fex.recording.site;
        // The site is DERIVED from the waveform's column count. If it did not come out 'finger' the
        // file was not what this branch assumed, and saying so beats publishing it as one.
        if (site !== 'finger') console.log(`    ⚠ PpgDexFinger  site detected as '${site}', expected 'finger' — check the input layout`);
      }
    } catch (e) {
      console.log(`    ✗ PpgDexFinger  ${e.message}`);
    }

  /* OxyDex — O2Ring CSV (HH:MM:SS DD/MM/YYYY → Clock Contract rule 4, preferDMY). The Motion
     column supplies this corner's motionIndex. fileMeta name is already serial-free. */
  if (wantNode('OxyDex'))
    try {
      /* .dat → CSV text via OxyDex's OWN decoder (the same one the browser drop path uses), because
       compute() takes {samples|rows|text} and never bytes. Not a second implementation: the 3-byte
       layout, the 0xFF 0xFF trailer, the motion×2 scale and the filename→t0 rule live in exactly one
       place. Verified equivalent on 2026-07-06, the night that has both files. */
      // SpO2 merges as TEXT: the whole-night union is at most 1.4 MB in this corpus, nowhere near the
      // string limit, and every row carries its own absolute stamp so concatenation in time order is
      // exactly the same record the ring would have written had it never dropped. Header kept once.
      const oxyText = (f) => {
        if (f.kind === 'dat') {
          const bytes = new Uint8Array(readFileSync(f.full));
          if (!OxyDex.isO2RingBin(bytes)) throw new Error(`not an O2Ring native binary: ${f.name}`);
          return OxyDex.decodeO2RingBinToCSV(bytes, f.name);
        }
        return readFileSync(f.full, 'utf8');
      };
      const parts = p.oxy.map(oxyText).filter((t) => t && t.trim());
      if (!parts.length) throw new Error('no readable O2Ring session');
      const head = parts[0].split('\n')[0];
      const text =
        [parts[0].trimEnd()]
          .concat(
            parts
              .slice(1)
              .map((t) => {
                const lines = t.split('\n');
                return (lines[0].trim() === head.trim() ? lines.slice(1) : lines).join('\n').trimEnd();
              })
              .filter(Boolean)
          )
          .join('\n') + '\n';
      const isDat = p.oxy.some((f) => f.kind === 'dat');
      const ex = OxyDex.compute({ text, fileMeta: { name: p.oxy[0].name } }, { ...COMMON, source: isDat ? 'o2ring-dat' : 'o2ring-csv' });
      const h = hoursOf(ex);
      if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ OxyDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
      else row.nodes.push(writeExport(dir, 'OxyDex', p.key, ex));
    } catch (e) {
      console.log(`    ✗ OxyDex  ${e.message}`);
    }

  // The stamp is the ONLY thing --skip-existing trusts, so it is written only when all three exports
  // actually landed. A partial night (a node threw, or the run was OOM-killed) stays unstamped and is
  // recomputed next time rather than being mistaken for done.
  if (row.nodes.length === 3) {
    writeFileSync(join(dir, STAMP), JSON.stringify({ inputsDigest: inputDigest(p), codeDigest: CODE_DIGEST, nodes: row.nodes.map((n) => n.node).sort() }, null, 2) + '\n');
  }

  /* ── CLOCK FIT vs the CPAP (optional: --cpap <DATALOG>) ─────────────────────────────────────
     A CPAP has no user-settable clock and cannot be NTP-disciplined, so its offset is permanent and
     must be MEASURED. Each wearable channel is fitted independently and printed separately, because
     agreement between unrelated mechanisms — oxygen transport, autonomic tone, body movement — is
     what makes the number credible. One blended figure would hide the disagreement worth seeing.

     Degrades by design: whatever subset of nodes produced events is used, and a channel that cannot
     contribute is printed WITH ITS REASON rather than omitted. A night with no CPAP data, or none
     that fits, prints that plainly instead of a fabricated correction. */
  /* NOT in a --only-node child. The fit reads all THREE node-exports off disk, so a child that owns
     one node sees only whatever siblings happen to have finished — and under node-split the FIRST
     child sees none, reporting "no channel could be estimated" for a night that fits perfectly well.
     The same night then prints three different answers depending on which child you read.

     This is the exact hazard the stamp below already documents — "no single child can see its
     siblings" — solved the same way: the parent runs it once, after every node has landed. */
  if (!ONLY_NODE) row.clockFit = printClockFit(dir, p.key);
  if (!ONLY_NODE) row.driftFit = printDriftFit(dir, p.key);
  /* ⚠️ THESE TWO WERE ONLY ON THE OTHER PATH, AND THE OTHER PATH ALMOST NEVER RUNS.
     There are two completion paths for a night: this one, where a child owns the WHOLE night, and the
     parent's `if (node)` branch, which handles a night whose nodes were split across children. The
     sidecars were added to the parent branch alone. But node-split is enabled only when
     `work.length < plan.jobs` — FEWER nights than job slots — so every ordinary corpus fold takes THIS
     path and silently wrote neither sidecar. Measured: a 40-night fold produced 0 `agreement_*.json`
     and 0 `arrival_*.json`, while small batches (which do split) produced them for every night. The
     feature looked correct because the case it was developed against is the rare one.
     Guarded by `!ONLY_NODE` for the same reason as the fits directly above: a child that owns a single
     node cannot see its siblings' exports, so it would adjudicate a "disagreement" against files that
     have not been written yet. */
  if (!ONLY_NODE && row.nodes.length >= 2) writeAgreement(dir, p.key);
  if (!ONLY_NODE) writeArrival(dir, p.key, p);

  summary.push(row);
}

/* ── 5 · verdict ─────────────────────────────────────────────────────────── */
const complete = summary.filter((r) => r.nodes.length === 3);
console.log(`\n${'─'.repeat(64)}`);
console.log(`nights written : ${summary.length}`);
console.log(`complete trios : ${complete.length}  (all three node-exports)`);
const noMotion = complete.filter((r) => r.nodes.some((n) => n.motion === 0)).length;
if (noMotion)
  console.log(
    `motion gaps    : ${noMotion} night(s) have a corner with 0 motion epochs\n` +
      `                 (ECGDex does not stamp motionIndex on its epochs today — see\n` +
      `                  ecgdex-dsp.js epoch push; PpgDex/OxyDex do. The motion-ρ leg of\n` +
      `                  TCH FU-III §1 needs that DSP change, not more data.)`
  );
console.log(`\nnext: node tools/tch-multinight.mjs --dir ${opt('--out', 'uploads/trio')}`);
