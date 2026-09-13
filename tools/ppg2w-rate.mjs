#!/usr/bin/env node
/*
 * tools/ppg2w-rate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE THE O2RING ppg2w SAMPLE RATE against the calibrated 125 Hz pleth.
 *
 * WHY. `_PPG.txt` (single-channel, MEASURED 125 Hz — O2RING-FRAME-SAMPLE-LOCK) and `_PPG2W.txt` (raw
 * dual-wavelength, cmd 0x05) are the SAME finger, SAME session. The pleth's rate is known; ppg2w's is an
 * explicit UNKNOWN (capture.py stamps its rows at buffer-span/record-count because "no rate is known",
 * sensor_ns is 0). Both cover the same wall-clock span, so the rate falls out of a COVERAGE-CALIBRATED
 * count — gap-immune, no waveform assumption:
 *
 *   coverage = (pleth samples) / (125 Hz * pleth host-span)     ← how much of the night actually landed
 *   fs_ppg2w = (ppg2w samples) / (ppg2w host-span * coverage)   ← same coverage, applied to ppg2w
 *
 * Coverage cancels the shared gap structure that a bare samples/span would mistake for a lower rate; the
 * pleth's own count vs its KNOWN rate is what measures that coverage. A RULER, not a clock: it transfers
 * the pleth's timebase onto ppg2w and adds no new timing to the system — but it retires the rate unknown
 * (and hence the SpO2-trend prerequisite) with zero hardware.
 *
 * ⚠ An earlier draft cross-correlated the pulse waveforms and returned 7 Hz against a ~100 Hz direct
 * count — the autocorrelation locked on a harmonic, and it needed a bandpass the fs-unknown made
 * un-settable. The ratio has no such failure mode: it does not care what the samples MEAN.
 *
 * Usage: node tools/ppg2w-rate.mjs --pleth <_PPG.txt> --ppg2w <_PPG2W.txt>
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Host-stamp times (ms within the day) of every data row. For `--fill`, which needs per-row times
 *  rather than a count and a span. */
export function tsOf(path) {
  const t = fs.readFileSync(path, 'utf8').split('\n');
  const out = [];
  for (let i = 1; i < t.length; i++) {
    const ln = t[i];
    if (!ln || ln[0] === '#' || ln[0] === 'P') continue;
    const m = ln.match(/T(\d\d):(\d\d):(\d\d)\.(\d{1,3})/);
    if (!m) continue;
    out.push(((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0'));
  }
  return out;
}

// count data rows and host-stamp span (seconds) — one pass, no waveform kept.
export function countAndSpan(path) {
  const t = fs.readFileSync(path, 'utf8');
  let n = 0,
    t0 = null,
    t1 = null,
    i = 0;
  while (i < t.length) {
    let j = t.indexOf('\n', i);
    if (j < 0) j = t.length;
    const ln = t.slice(i, j);
    i = j + 1;
    if (!ln || ln[0] === '#' || ln[0] === 'P') continue;
    const semi = ln.indexOf(';');
    if (semi < 0) continue;
    n++;
    const ms = Date.parse(ln.slice(0, semi) + 'Z');
    if (Number.isFinite(ms)) {
      if (t0 === null) t0 = ms;
      t1 = ms;
    }
  }
  return { n, spanS: t0 !== null ? (t1 - t0) / 1000 : null };
}

// PURE, exported for the gate.
export function rateFromRatio(plethN, plethSpanS, p2wN, p2wSpanS, fsPleth) {
  if (!(plethN > 0 && plethSpanS > 0 && p2wN > 0 && p2wSpanS > 0 && fsPleth > 0)) return null;
  const coverage = plethN / (fsPleth * plethSpanS);
  const fsW = p2wN / (p2wSpanS * coverage);
  return { coverage, fsW, fsRaw: p2wN / p2wSpanS };
}

/* ═══ THE FILL RATE, which is NOT the delivered rate above ══════════════════════════════════════
 * Residue `2026-09-06-ppg2w-fill-rate-unmeasured`. #1596 measured that 282,402 of 284,420 buffers sat
 * at the 102-record reply cap (99.3 %) and concluded the whole-night "~100 Hz" figures — including
 * `rateFromRatio` above — are `cap x poll rate`, a DRAIN artifact. It then bought a second mid-cycle
 * drain on the ground that "every night's unsaturated counts measure the true fill rate for free",
 * and nothing ever took the measurement. This is that measurement.
 *
 * HOW A BUFFER IS RECOVERED. `_PPG2W.txt` stores no reply boundary: `capture.py` back-times each
 * reply's rows across its own span, so within a buffer the inter-row delta is constant and it JUMPS
 * at a re-anchor. Split on `|delta - modal| >= 3 ms` — the same rule `ppg2w-spo2-fit.mjs` already
 * uses, not a new one. ⚠️ A 1 ms tolerance does NOT work: the stamps are rounded to ms, so deltas
 * alternate (10, 10, 9, 10 ...) inside one buffer and a strict-equality split fragments it into runs
 * of 2 and 10 rather than ~102.
 *
 * ⚠️ WHY THE WITHIN-BUFFER SPACING CANNOT BE USED, and this is the trap that makes the naive answer
 * wrong rather than imprecise. Those stamps are `buffer_span / record_count` — the writer's own
 * interpolation. Dividing them back out returns the assumption, not a measurement: it reads ~99 Hz on
 * every night including the 99.98 %-saturated ones, which is the drawn-axis failure of CLOCK §7 one
 * layer down. The fill rate is records-in-an-UNSATURATED-reply over the INTER-REPLY ARRIVAL GAP,
 * because an unsaturated reply delivered everything that accumulated since the previous drain, and
 * that gap is real host time.
 *
 * ⚠️ AND A REPLY BELOW THE CAP IS NOT AUTOMATICALLY A PARTIAL ONE. A spurious split would show up as
 * two neighbours summing to exactly 102, so `pairsToCap` counts them: measured 6 of 11,717 (0.1 %) on
 * 2026-09-10, which is what licenses reading the rest as genuine. Without that control this whole
 * measurement could be an artifact of the splitter.  */
export const PPG2W_REPLY_CAP = 102;

/** Split host-stamp times (ms) into replies at re-anchor jumps. PURE. */
export function repliesOf(tsMs, jumpMs = 3) {
  const d = [];
  for (let i = 1; i < tsMs.length; i++) d.push(tsMs[i] - tsMs[i - 1]);
  if (!d.length) return [];
  const h = new Map();
  for (const x of d) h.set(x, (h.get(x) || 0) + 1);
  let modal = 0,
    best = -1;
  for (const [k, v] of h) if (v > best) [best, modal] = [v, k];
  const out = [];
  let s = 0;
  for (let i = 0; i < d.length; i++)
    if (Math.abs(d[i] - modal) >= jumpMs) {
      out.push({ n: i - s + 1, t0: tsMs[s] });
      s = i + 1;
    }
  if (s < tsMs.length) out.push({ n: tsMs.length - s, t0: tsMs[s] });
  return out;
}

/** Saturation + fill rate from replies. `minN` drops splitter singletons. PURE. */
export function fillFromReplies(replies, cap = PPG2W_REPLY_CAP, minN = 8) {
  let atCap = 0,
    pairsToCap = 0;
  const rates = [];
  for (let i = 0; i < replies.length; i++) {
    const b = replies[i];
    if (b.n >= cap) {
      atCap++;
      continue;
    }
    const nxt = replies[i + 1] ? replies[i + 1].n : 0,
      prv = i > 0 ? replies[i - 1].n : 0;
    if (b.n + nxt === cap || b.n + prv === cap) pairsToCap++;
    if (i === 0 || b.n < minN) continue;
    const gap = b.t0 - replies[i - 1].t0;
    if (gap > 200 && gap < 5000) rates.push((b.n * 1000) / gap);
  }
  rates.sort((a, b) => a - b);
  const q = (f) => (rates.length ? rates[Math.min(rates.length - 1, Math.floor(f * rates.length))] : null);
  return {
    replies: replies.length,
    atCap,
    saturatedPct: replies.length ? +((100 * atCap) / replies.length).toFixed(2) : null,
    /* Published so a reader can see the splitter was controlled rather than trusted. */
    pairsToCap,
    nUnsaturated: rates.length,
    fillHzP10: q(0.1),
    fillHzMedian: q(0.5),
    fillHzP90: q(0.9)
  };
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ok   ${n}`);
    } else {
      fail++;
      console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`);
    }
  };
  // coverage exactly cancels a shared gap: pleth 99% of 125*span, ppg2w 99% of X*span → X recovered.
  const span = 26000,
    cov = 0.994,
    fsTrue = 100;
  const r = rateFromRatio(Math.round(125 * span * cov), span, Math.round(fsTrue * span * cov), span, 125);
  ok('coverage cancels the shared gap → true rate recovered', Math.abs(r.fsW - fsTrue) < 0.5, `got ${r.fsW}`);
  ok('coverage is measured, not assumed', Math.abs(r.coverage - cov) < 0.001, `got ${r.coverage}`);
  // a DIFFERENT true rate is recovered, so it is not hard-coded to 100
  const r2 = rateFromRatio(Math.round(125 * span * cov), span, Math.round(130 * span * cov), span, 125);
  ok('a 130 Hz stream reads 130, not 100', Math.abs(r2.fsW - 130) < 0.5, `got ${r2.fsW}`);
  // full coverage: raw == calibrated
  const r3 = rateFromRatio(125 * span, span, 100 * span, span, 125);
  ok('at 100% coverage raw == calibrated', Math.abs(r3.fsW - r3.fsRaw) < 1e-6);
  // refuse on bad input rather than return NaN
  ok('zero span refuses', rateFromRatio(1, 0, 1, 1, 125) === null);
  ok('zero fsPleth refuses', rateFromRatio(1, 1, 1, 1, 0) === null);

  /* ── FILL RATE. Planted replies with a KNOWN answer, because the corpus cannot supply one: there is
     no ground-truth fill rate on disk, which is the whole reason this measurement exists. */
  const mkReplies = (specs, gapMs, stepMs = 5) => {
    /* specs: [n, ...]; each reply's rows sit `stepMs` apart and the next reply starts `gapMs` after
       the previous one STARTED, so the re-anchor shows up as one jump.
       ⚠️ A CONSTANT step across replies is what the real files look like — every reply is 98-102
       records, so `buffer_span / record_count` lands on the same few ms. An earlier version of this
       fixture scaled the step per reply, which made a 50-record reply's step differ from the modal by
       more than the jump tolerance, so the splitter fragmented it into 50 singletons. That is a
       property of the FIXTURE, not of the splitter, and it is recorded here because it looks exactly
       like a splitter bug.
       The step also implies a MUCH higher rate than the truth (5 ms => 200 Hz), which is deliberate:
       it is what a reader of the writer's own interpolation would wrongly report. */
    const ts = [];
    let t = 0;
    for (const n of specs) {
      for (let i = 0; i < n; i++) ts.push(Math.round(t + i * stepMs));
      t += gapMs;
    }
    return ts;
  };
  const rep = repliesOf(mkReplies([102, 102, 50, 102, 50], 500));
  ok('replies are recovered from the re-anchor jumps', rep.length === 5, `got ${rep.length}: ${rep.map((r) => r.n).join(',')}`);
  const F = fillFromReplies(rep);
  ok('a reply at the cap is counted saturated', F.atCap === 3, `got ${F.atCap}`);
  ok('…and the saturated share is reported, not assumed', F.saturatedPct === 60, `got ${F.saturatedPct}`);
  /* 50 records accumulated over a 500 ms drain gap IS 100 Hz — the quantity the whole mode exists for.
     ⚠️ The within-buffer spacing above was planted DELIBERATELY WRONG (0.8 x the gap, so it implies
     ~125 Hz). A reader of `buffer_span / record_count` gets 125; the arrival-gap reading gets 100.
     This is the leg that fails if anyone re-derives the fill from the writer's own interpolation. */
  ok('fill is records over the ARRIVAL GAP, not the writer-interpolated within-buffer spacing (5 ms steps imply 200 Hz; the truth is 100)', F.fillHzMedian === 100, `got ${F.fillHzMedian}`);
  /* …and it is not hard-coded to 100: 60 records over the same gap is 120 Hz. */
  ok(
    'a different partial size reads a different rate',
    fillFromReplies(repliesOf(mkReplies([102, 60, 102], 500))).fillHzMedian === 120,
    'got ' + fillFromReplies(repliesOf(mkReplies([102, 60, 102], 500))).fillHzMedian
  );
  /* The splitter control: none of these partials pairs with a neighbour to exactly the cap. */
  ok('no planted partial pairs to the cap, so none reads as a spurious split', F.pairsToCap === 0, `got ${F.pairsToCap}`);
  const split = fillFromReplies(repliesOf(mkReplies([70, 32, 102], 500)));
  ok('CONTROL · a reply split 70+32 IS detected as pairing to the cap', split.pairsToCap >= 1, `got ${split.pairsToCap}`);
  /* A 1 ms tolerance fragments a real reply — pinned so nobody "tightens" it back. */
  /* THE ROUNDING CASE, planted with a FRACTIONAL step so the ms-rounded deltas alternate exactly as
     the real files do. This is why the tolerance is 3 ms and not 1, and it is the difference between
     ~102 records per reply and runs of 2. */
  const jit = mkReplies([102, 102], 500, 4.6);
  ok('a 1 ms jump tolerance fragments a reply once the stamps are ms-rounded', repliesOf(jit, 1).length > 2, 'got ' + repliesOf(jit, 1).length);
  ok('…and 3 ms recovers exactly the two replies', repliesOf(jit, 3).length === 2, 'got ' + repliesOf(jit, 3).length);
  ok('a singleton run is excluded from the fill, never counted as a partial reply', fillFromReplies(repliesOf(mkReplies([102, 1, 102], 500))).nUnsaturated === 0);
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nall green');
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  /* `--fill <_PPG2W.txt>...` — the FILL rate, which the calibrated rate below cannot see because the
     stream is drain-limited (residue `2026-09-06-ppg2w-fill-rate-unmeasured`). */
  if (process.argv.includes('--fill')) {
    const files = process.argv.slice(process.argv.indexOf('--fill') + 1).filter((a) => !a.startsWith('--'));
    if (!files.length) {
      console.log('usage: --fill <_PPG2W.txt> [more...]');
      process.exit(2);
    }
    const all = [];
    let skipped = 0;
    for (const f of files) {
      const ts = tsOf(f);
      if (ts.length < 500) {
        skipped++;
        continue;
      }
      all.push(...repliesOf(ts));
    }
    if (!all.length) {
      console.log(`  no usable file (${skipped} skipped as too short)`);
      process.exit(1);
    }
    const F = fillFromReplies(all);
    console.log(`  files: ${files.length - skipped} used, ${skipped} skipped (<500 rows)`);
    console.log(`  replies: ${F.replies}   at the ${PPG2W_REPLY_CAP}-record cap: ${F.atCap} = ${F.saturatedPct}%`);
    console.log(`  splitter control — partials pairing to the cap: ${F.pairsToCap} of ${F.replies - F.atCap} (a high share would mean the split is an artifact)`);
    if (F.nUnsaturated) console.log(`\n  FILL RATE from ${F.nUnsaturated} unsaturated replies: median ${F.fillHzMedian.toFixed(1)} Hz  (p10 ${F.fillHzP10.toFixed(1)}, p90 ${F.fillHzP90.toFixed(1)})`);
    else console.log('\n  no unsaturated reply — the stream is fully drain-limited, so the fill rate is only bounded BELOW by cap/gap');
    process.exit(0);
  }
  const FS_PLETH = 125.0;
  const pl = arg('--pleth'),
    pw = arg('--ppg2w');
  if (!pl || !pw) {
    console.log('usage: --pleth <_PPG.txt> --ppg2w <_PPG2W.txt>');
    process.exit(2);
  }
  const P = countAndSpan(pl),
    W = countAndSpan(pw);
  console.log(`  pleth : ${P.n} samples over ${P.spanS?.toFixed(0)} s  (raw ${(P.n / P.spanS).toFixed(1)} Hz vs KNOWN ${FS_PLETH})`);
  console.log(`  ppg2w : ${W.n} samples over ${W.spanS?.toFixed(0)} s  (raw ${(W.n / W.spanS).toFixed(1)} Hz — uncalibrated)`);
  const r = rateFromRatio(P.n, P.spanS, W.n, W.spanS, FS_PLETH);
  if (!r) {
    console.log('  insufficient data');
    process.exit(1);
  }
  console.log(`\n  coverage (from pleth vs its known rate): ${(r.coverage * 100).toFixed(1)}%`);
  console.log(`  ppg2w SAMPLE RATE = ${r.fsW.toFixed(2)} Hz  (nearest round: ${Math.round(r.fsW)} Hz, residual ${((100 * Math.abs(r.fsW - Math.round(r.fsW))) / Math.round(r.fsW)).toFixed(1)}%)`);
}
