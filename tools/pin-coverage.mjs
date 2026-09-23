#!/usr/bin/env node
/*
 * tools/pin-coverage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * HOW MUCH OF THE CORPUS IS IN-BAND BLANKING? — the denominator behind `nPinSpanIntervals`.
 *
 * WHY IT EXISTS. `pinnedSpans` has detected O2Ring in-band blanking since #2317 and the export has
 * REPORTED it as `quality.pinnedCoverage`, but nothing consumed it: every rMSSD/SD1/LF:HF was
 * computed as though the blanked samples were signal. The fix (exclude a pinned span like a gap) is
 * owner-ruled (P5, 2026-09-12), and that ruling asked for "one PR with a corpus measurement". This is
 * that measurement, promoted out of a scratch script so the figure it produces can be re-derived —
 * a published number whose producer has vanished is the 255th uncheckable number
 * (`PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03`: at most 5 of 259 tables are attributable to a tool).
 *
 * 🔴 THE DENOMINATOR IS THE WHOLE POINT, AND GETTING IT WRONG IS WHY THIS TOOL EXISTS IN THIS SHAPE.
 * `nPinSpanIntervals` and `nGapSpanIntervals` are counted over EVERY INPUT interval; the export's
 * series is the KEPT subset. Dividing one by the other mixes two populations and, measured while
 * writing this, produced a per-file "800 %" — the only reason the mismatch was caught before it
 * reached a changeset. `analyze` now publishes `nInputIntervals` and this tool divides by THAT.
 * A share whose numerator and denominator come from different populations is not a rate.
 *
 * WHAT IT REPORTS, per tree: files found · analysed · threw; files carrying >= 1 pinned interval;
 * pinned intervals over INPUT intervals; and the per-file distribution among affected files
 * (median · p90 · max). The throw count is reported rather than swallowed because the two capture
 * trees differ by two orders of magnitude in it (1 vs 198), and a silently-dropped file is an
 * absence that would read as a clean night.
 *
 * MEMORY (standing rule, 2026-09-15: never exceed 8 GB). One file is read, analysed, reduced to
 * SCALARS, and dropped; nothing accumulates across the loop but running totals and one array of
 * per-file percentages. The vm realm carrying `clock.js` + `kernel-constants.js` + the two DSPs is
 * built ONCE and reused, because that is the expensive fixed cost. Measured on the 665-file tree:
 * 0.70 GB resident, flat.
 *
 * NOT IMPLEMENTED, declared per the tool-build standard §2.11:
 *   · §2.6/§2.8 PARALLELISM — none. This is single-process by choice: the per-file cost is ~1 s and
 *     the realm setup dominates a short run, so a pool would buy little and cost the shared box
 *     memory it cannot spare (see the 8 GB rule). Re-measure before adding one.
 *   · §2.9 GENERIC — explicitly SINGLE-PURPOSE. It answers one question about one detector.
 *
 * USAGE
 *   node tools/pin-coverage.mjs --dir <captures>            # one tree
 *   node tools/pin-coverage.mjs --dir <a> --dir <b>         # several, reported separately
 *   node tools/pin-coverage.mjs --dir <d> --resume          # continue from the checkpoint
 *   node tools/pin-coverage.mjs --dir <d> --limit 25        # bounded sample, size STATED in output
 *   node tools/pin-coverage.mjs --selftest                  # pure core, no corpus, no git
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CKPT = join(ROOT, '.cache', 'pin-coverage-checkpoint.json');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const many = (n) => argv.reduce((a, v, i) => (v === n && argv[i + 1] ? a.concat(argv[i + 1]) : a), []);
const one = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/* ── pure core: the reduction, so the selftest can exercise it without a corpus ──────────────────
   Everything that can be wrong about a RATE lives here — the denominator choice, the empty case,
   the quantiles — and none of it needs a file. */
export function reduce(rows) {
  let analysed = 0,
    withPin = 0,
    totPin = 0,
    totIn = 0;
  const share = [];
  for (const r of rows) {
    if (r == null || r.nInputIntervals == null || r.nPinSpanIntervals == null) continue;
    analysed++;
    totPin += r.nPinSpanIntervals;
    totIn += r.nInputIntervals;
    if (r.nPinSpanIntervals > 0 && r.nInputIntervals > 0) {
      withPin++;
      share.push((100 * r.nPinSpanIntervals) / r.nInputIntervals);
    }
  }
  share.sort((a, b) => a - b);
  const q = (p) => (share.length ? share[Math.min(share.length - 1, Math.floor(p * share.length))] : null);
  return {
    analysed,
    withPin,
    filePct: analysed ? (100 * withPin) / analysed : null,
    totPin,
    totIn,
    /* null, never 0, when nothing was measured — a rate over an empty denominator is not "no
       blanking", it is no measurement (§∅). */
    intervalPct: totIn ? (100 * totPin) / totIn : null,
    median: q(0.5),
    p90: q(0.9),
    max: share.length ? share[share.length - 1] : null
  };
}

function loadCkpt() {
  try {
    const j = JSON.parse(readFileSync(CKPT, 'utf8'));
    return j && typeof j === 'object' && Array.isArray(j.done) ? j : null;
  } catch {
    return null; // an unreadable checkpoint is discarded, never half-trusted
  }
}
function saveCkpt(o) {
  try {
    mkdirSync(dirname(CKPT), { recursive: true });
    writeFileSync(CKPT, JSON.stringify(o));
  } catch {
    /* a checkpoint that cannot be written must not kill a run that is otherwise fine */
  }
}

if (flag('--selftest')) {
  let fail = 0;
  const A = (m, c) => {
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      fail++;
    }
  };
  /* THE DENOMINATOR BUG, planted. If `reduce` ever divides by a kept-interval count again, this is
     the assertion that reds: 8 pinned of 100 INPUT is 8 %, and no input can exceed 100 %. */
  const r = reduce([
    { nPinSpanIntervals: 8, nInputIntervals: 100 },
    { nPinSpanIntervals: 0, nInputIntervals: 100 }
  ]);
  A('interval share uses the INPUT denominator', Math.abs(r.intervalPct - 4) < 1e-9);
  A('per-file share is over that file only', Math.abs(r.max - 8) < 1e-9);
  A('a file with no pinned interval is analysed but not "affected"', r.analysed === 2 && r.withPin === 1);
  A('no per-file share can exceed 100 %', r.max <= 100);
  /* EMPTY IS NULL, NOT ZERO — the §∅ rule the whole change is about, applied to its own report. */
  const e = reduce([]);
  A('an empty corpus reports null, never 0 %', e.intervalPct === null && e.filePct === null && e.median === null);
  /* A row missing either half is NOT counted — a half-measured file must not dilute the rate. */
  const p = reduce([{ nPinSpanIntervals: 5 }, { nInputIntervals: 50 }, { nPinSpanIntervals: 5, nInputIntervals: 50 }]);
  A('a row missing either field is skipped entirely', p.analysed === 1 && p.totIn === 50);
  /* Quantiles on a single affected file must not invent a spread. */
  const s = reduce([{ nPinSpanIntervals: 1, nInputIntervals: 4 }]);
  A('one affected file: median = p90 = max', s.median === 25 && s.p90 === 25 && s.max === 25);
  const ck = { done: ['a'], rows: [] };
  saveCkpt(ck);
  A('checkpoint round-trips', (loadCkpt() || {}).done?.[0] === 'a');
  writeFileSync(CKPT, 'not json');
  A('an unreadable checkpoint is discarded, never half-trusted', loadCkpt() === null);
  console.log(fail ? `SELFTEST FAIL (${fail})` : 'SELFTEST PASS (8/8)');
  process.exit(fail ? 1 : 0);
}

const dirs = many('--dir');
if (!dirs.length) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(4);
}
const LIMIT = Number(one('--limit', '0')) || 0;
const RESUME = flag('--resume');

const DexBuild = createRequire(import.meta.url)(join(ROOT, 'tools', 'build-core.js'));
const sb = {};
sb.window = sb;
sb.self = sb;
sb.globalThis = sb;
sb.console = { log() {}, warn() {}, error() {} };
sb.setTimeout = setTimeout;
sb.clearTimeout = clearTimeout;
sb.__DEX_NAMESPACED__ = true;
const ctx = vm.createContext(sb);
for (const f of ['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
const P = ctx.PPGDSP;
/* TIER, printed per §2.7: there is one path and no fallback, so say so rather than leave a reader
   wondering which arm ran. */
console.log(`pin-coverage: tier=in-process vm realm (no pool; single-purpose — see header §2.11)`);

const prior = RESUME ? loadCkpt() : null;
const done = new Set(prior?.done || []);
const rows = prior?.rows || [];
if (prior) console.log(`resuming: ${done.size} file(s) already done`);

for (const d of dirs) {
  let files = [];
  try {
    for (const n of readdirSync(d).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
      try {
        for (const f of readdirSync(join(d, n))) if (/_PPG\.txt$/i.test(f) && /o2ring|wellue/i.test(f)) files.push(join(d, n, f));
      } catch {
        /* an unreadable night directory is skipped and shows up in `found` vs `analysed` */
      }
    }
  } catch {
    console.log(`  ${d}: unreadable`);
    continue;
  }
  if (LIMIT) files = files.slice(0, LIMIT);
  let threw = 0,
    seen = 0;
  const mine = [];
  for (const f of files) {
    seen++;
    if (done.has(f)) {
      const r = rows.find((x) => x.f === f);
      if (r) mine.push(r);
      continue;
    }
    try {
      const a = P.analyze(P.parsePPG(readFileSync(f, 'utf8')), () => {});
      const row = { f, nPinSpanIntervals: a?.nPinSpanIntervals ?? null, nInputIntervals: a?.nInputIntervals ?? null };
      mine.push(row);
      rows.push(row);
    } catch {
      threw++;
    }
    done.add(f);
    /* HEARTBEAT (§2.4): a REAL running value, not a placeholder — the pinned total so far, so a
       partial run already answers the question rather than only reporting a position. */
    if (seen % 25 === 0) {
      const r = reduce(mine);
      process.stderr.write(`  …${seen}/${files.length}  affected ${r.withPin}  pinned ${r.totPin}/${r.totIn}\n`);
      saveCkpt({ done: [...done], rows });
    }
  }
  saveCkpt({ done: [...done], rows });
  const r = reduce(mine);
  const pc = (v) => (v == null ? 'n/a (nothing measured)' : v.toFixed(v < 10 ? 3 : 2) + ' %');
  console.log(`\n== ${d} ==`);
  console.log(`  O2Ring _PPG.txt found ${files.length}${LIMIT ? ` (LIMIT ${LIMIT} — sample, not the corpus)` : ''} · analysed ${r.analysed} · threw ${threw}`);
  console.log(`  files with >=1 pinned interval: ${r.withPin} (${pc(r.filePct)})`);
  console.log(`  pinned ${r.totPin} of ${r.totIn} INPUT intervals (${pc(r.intervalPct)})`);
  if (r.withPin) console.log(`  per-file share among affected: median ${r.median.toFixed(2)} % · p90 ${r.p90.toFixed(2)} % · max ${r.max.toFixed(2)} %`);
}
