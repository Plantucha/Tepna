/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * acc-select-compare.mjs — EXTERNAL-METHODS-SURVEY-FOLLOWUPS §2.
 *
 * Two tools pick a night's ACC fragments by different rules and disagree about which nights are
 * alignable:
 *
 *   pat-matchrate-strict.mjs   `nearInTime`  — the 3 fragments starting NEAREST the beat pipeline's
 *                                              span, then the best overlap among them
 *   acc-shared-movement.mjs    `biggestAcc`  — the 3 LARGEST fragments per device, then the pair
 *                                              with the greatest mutual overlap
 *
 * A night's alignability must not be a property of which tool asked. But notice what BOTH rules
 * share: a shortlist of 3, applied BEFORE anything measures overlap. That is the same shape as the
 * defect that produced this brief item — selecting each device's largest fragment independently
 * reported "the two ACC recordings do not overlap" on 13 of 38 nights.
 *
 * 🔴 THE SHORTLIST IS UNNECESSARY, AND THAT IS THE POINT. It exists because parsing a fragment is
 * expensive (a night's Verity ACC runs to ~339 MB), so the rules guess which ones are worth parsing.
 * But the two numbers a shortlist needs — a fragment's FIRST and LAST timestamp — are the first and
 * last LINES of the file, readable in a few KB without parsing anything. Bounds for every fragment
 * cost microseconds; only the winning pair is ever parsed. So the honest rule is: enumerate all
 * fragments, compute the true best pair, parse that.
 *
 * This tool measures what the shortlists cost before that change is made: per night, the true best
 * pair over ALL fragments against what each rule's top-3 would have kept.
 *
 * Usage:  node tools/acc-select-compare.mjs --dir <corpus> [--only YYYY-MM-DD] [--top 3]
 *         node tools/acc-select-compare.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { closeSync, openSync, readSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDsps, loadDsps, median } from './pat-matchrate-strict.mjs';

const argv = process.argv.slice(2);
const av = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

/** First and last data-row timestamps of a Polar-Sensor-Logger-shaped file, read from the two ENDS.
 *  Never parses the body — that is the whole economy this tool argues for. */
export function fragmentBounds(file, parseTimestamp) {
  const size = statSync(file).size;
  if (size < 64) return null;
  const fd = openSync(file, 'r');
  try {
    const headN = Math.min(65536, size);
    const head = Buffer.alloc(headN);
    readSync(fd, head, 0, headN, 0);
    const tailN = Math.min(65536, size);
    const tail = Buffer.alloc(tailN);
    readSync(fd, tail, 0, tailN, size - tailN);
    const stampOf = (s) => {
      const t = parseTimestamp(s.split(';')[0]);
      return t && Number.isFinite(t.tMs) ? t.tMs : null;
    };
    /* Skip the header row and any partial first line; take the first row that yields a stamp. */
    let first = null;
    for (const line of head.toString('utf8').split('\n').slice(0, 40)) {
      const v = stampOf(line.trim());
      if (v != null) {
        first = v;
        break;
      }
    }
    /* From the tail, the LAST complete line — the first line of a mid-file read is partial, and the
       final line may be empty. Walk backwards until one parses. */
    let last = null;
    const tl = tail.toString('utf8').split('\n');
    for (let i = tl.length - 1; i >= 1 && last == null; i--) last = stampOf(tl[i].trim());
    if (first == null || last == null || !(last >= first)) return null;
    return { file, size, t0: first, t1: last };
  } finally {
    closeSync(fd);
  }
}

const overlap = (a, b) => Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0);

export function bestPairOver(frA, frB) {
  let best = null;
  for (const a of frA)
    for (const b of frB) {
      const ov = overlap(a, b);
      if (ov > (best?.ov ?? -Infinity)) best = { ov, a, b };
    }
  return best;
}

export function compareNight(dir, top, parseTimestamp) {
  const list = (re) =>
    readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => fragmentBounds(join(dir, f), parseTimestamp))
      .filter(Boolean);
  const A = list(/H10.*_ACC\.txt$/i);
  const B = list(/verity.*_ACC\.txt$/i);
  if (!A.length || !B.length) return { skipped: `no bounded ACC on ${!A.length ? 'H10' : 'Verity'}`, nA: A.length, nB: B.length };
  const truth = bestPairOver(A, B);
  if (!truth || truth.ov <= 0) return { skipped: 'no fragment pair overlaps at all', nA: A.length, nB: B.length };

  /* RULE 1 — largest-N per device, then best pair among them (acc-shared-movement). */
  const bySize = (l) =>
    l
      .slice()
      .sort((x, y) => y.size - x.size)
      .slice(0, top);
  const r1 = bestPairOver(bySize(A), bySize(B));

  /* RULE 2 — nearest-in-time-to-the-target per device, then best pair (pat-matchrate-strict). The
     target here is the TRUE best pair's span, which is generous to this rule: in the real tool the
     target comes from the beat pipeline and can itself be off. A shortlist that loses the answer
     even when handed the right target has lost it for good. */
  const near = (l, t0) =>
    l
      .slice()
      .sort((x, y) => Math.abs(x.t0 - t0) - Math.abs(y.t0 - t0))
      .slice(0, top);
  const tgt = Math.max(truth.a.t0, truth.b.t0);
  const r2 = bestPairOver(near(A, tgt), near(B, tgt));

  const h = (ms) => +(ms / 3600000).toFixed(2);
  return {
    nA: A.length,
    nB: B.length,
    truthOverlapH: h(truth.ov),
    bySizeOverlapH: r1 ? h(r1.ov) : null,
    nearTimeOverlapH: r2 ? h(r2.ov) : null,
    bySizeKeepsTruth: !!r1 && r1.ov === truth.ov,
    nearTimeKeepsTruth: !!r2 && r2.ov === truth.ov,
    bySizeLostH: r1 ? h(truth.ov - r1.ov) : null,
    nearTimeLostH: r2 ? h(truth.ov - r2.ov) : null
  };
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
    if (!c) fail++;
  };
  /* A shortlist can only be shown to LOSE if the losing case is constructible, so the control plants
     it: three big fragments that do not overlap the other device, and one small one that does. A
     size-ranked top-3 must miss it; enumerating everything must not. */
  const A = [
    { size: 900, t0: 0, t1: 100 },
    { size: 800, t0: 200, t1: 300 },
    { size: 700, t0: 400, t1: 500 },
    { size: 10, t0: 1000, t1: 2000 }
  ];
  const B = [{ size: 999, t0: 1000, t1: 2000 }];
  const truth = bestPairOver(A, B);
  ok('enumerating every fragment finds the overlapping pair', truth.ov === 1000, `ov=${truth.ov}`);
  const top3 = A.slice()
    .sort((x, y) => y.size - x.size)
    .slice(0, 3);
  const shortlisted = bestPairOver(top3, B);
  ok('a size-ranked top-3 LOSES it', shortlisted.ov < truth.ov, `ov=${shortlisted.ov} vs ${truth.ov}`);
  ok('…and would report no overlap at all', shortlisted.ov <= 0, `ov=${shortlisted.ov}`);
  /* Non-vacuity the other way: with the small fragment inside the shortlist, both agree — so the
     test above is detecting the shortlist, not an arithmetic difference between the two paths. */
  const top4 = A.slice()
    .sort((x, y) => y.size - x.size)
    .slice(0, 4);
  ok('widening the shortlist to 4 recovers it', bestPairOver(top4, B).ov === truth.ov);

  console.log(`\n${fail ? `FAIL — ${fail}` : 'PASS — a shortlist can lose the best pair, and the control shows it'}`);
  return fail ? 1 : 0;
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  if (argv.includes('--selftest')) process.exit(selftest());
  const DIR = av('--dir');
  const ONLY = av('--only');
  const TOP = +av('--top', 3);
  if (!DIR || !existsSync(DIR)) {
    console.error('acc-select-compare: pass --dir <corpus>. The raw corpus is gitignored and is not in the repo.');
    process.exit(2);
  }
  loadDsps();
  const { DexClock } = getDsps();
  const pt = (s) => DexClock.parseTimestamp(s);
  const nights = readdirSync(DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && statSync(join(DIR, n)).isDirectory())
    .filter((n) => !ONLY || n === ONLY)
    .sort();
  const rows = [];
  for (const n of nights) {
    let r;
    try {
      r = { night: n, ...compareNight(join(DIR, n), TOP, pt) };
    } catch (e) {
      r = { night: n, skipped: 'threw: ' + e.message };
    }
    rows.push(r);
    console.error(
      r.skipped
        ? `  ${n}  SKIP  ${r.skipped}  (A=${r.nA ?? '?'} B=${r.nB ?? '?'})`
        : `  ${n}  frags ${String(r.nA).padStart(3)}/${String(r.nB).padStart(3)}  truth ${String(r.truthOverlapH).padStart(5)} h  bySize ${String(r.bySizeOverlapH).padStart(5)}${r.bySizeKeepsTruth ? ' ' : '✗'}  nearTime ${String(r.nearTimeOverlapH).padStart(5)}${r.nearTimeKeepsTruth ? ' ' : '✗'}`
    );
  }
  const used = rows.filter((r) => !r.skipped);
  const sum = (k) => used.filter((r) => r[k]).length;
  const lost = (k) => used.map((r) => r[k]).filter((v) => Number.isFinite(v) && v > 0);
  console.log(
    JSON.stringify(
      {
        nights: rows.length,
        measured: used.length,
        top: TOP,
        fragmentsPerNight: { h10: median(used.map((r) => r.nA)), verity: median(used.map((r) => r.nB)) },
        bySize: { keepsTruth: sum('bySizeKeepsTruth'), of: used.length, nightsLosingTime: lost('bySizeLostH').length, medianHoursLost: lost('bySizeLostH').length ? median(lost('bySizeLostH')) : 0 },
        nearTime: {
          keepsTruth: sum('nearTimeKeepsTruth'),
          of: used.length,
          nightsLosingTime: lost('nearTimeLostH').length,
          medianHoursLost: lost('nearTimeLostH').length ? median(lost('nearTimeLostH')) : 0
        },
        rows
      },
      null,
      2
    )
  );
}
