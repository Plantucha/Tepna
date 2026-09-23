#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// stuck-run-lengths.mjs — is T_STUCK = 200 samples a threshold for this stream, or only for the one
// it was derived from?
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE QUESTION. Residue `2026-09-06-t-stuck-validated-on-ring-only`: `writers.py`'s `T_STUCK = 200`
// is "four times the plateau p99.99", and that p99.99 = 48 was measured on O2Ring 8-bit pleth ONLY
// (3.16 M samples, two files). `RUN_MIN_BY_STREAM` then applies the same SAMPLE COUNT to five
// streams whose plateau distributions have never been measured.
//
// ⚠️ ONE CONSTANT IS FOUR PHYSICAL THRESHOLDS. Measured from the corpus, not from the declared table:
// ring `ppg1` ~127.76 Hz, Verity `_PPG.txt` 55.13 Hz, Verity `_ACC.txt` 51.68 Hz. So 200 samples is
// 1.57 s where it was derived, 3.63 s on Verity PPG, 3.87 s on Verity ACC — and 1.0 s on a device
// that falls through to 200 Hz. None of those was chosen. Note the test `200 >= 4 * p99.99` is
// UNIT-INVARIANT within a stream (both sides scale by 1/fs), so the rate matters for what the
// threshold MEANS, not for that comparison — both units are reported for interpretability.
//
// ⚠️ AND THAT COMPARISON TESTS THE WRONG DIRECTION, which is why it is not the criterion here.
// `200 >= 4 * p99.99` guards against the cut being too LOW (flagging real signal). The row's stated
// risk is the opposite: too HIGH under-reports. On a slower stream the same physical plateau spans
// FEWER samples, so `200 / p99.99` is LARGER — the band passes most comfortably exactly where the
// threshold is physically laxest, and a universal PASS could not separate "the constant transfers"
// from "the constant is nowhere near the false-positive floor on four of five streams".
//
// ⚠️ THE FLAGGED SPANS CANNOT SUPPLY AN UPPER BOUND — they are CENSORED AT THE THRESHOLD. Measured
// over the corpus's 343 `*RUNS*` sidecars: 68 `stuck` spans, `min = 200 samples EXACTLY`. The
// shortest span the shipped detector ever flagged is the cut itself, so that set measures the cut
// and not the phenomenon.
//
// SO THE CRITERION IS DISTRIBUTIONAL, which is §∅'s own prescription — "key on RUN LENGTH, never on
// value membership… the two populations separate by themselves". Run the distribution UNTHRESHOLDED
// and ask whether a gap separates the plateau population from a long-run population, and on which
// side of it 200 falls.
//
// 🔒 PRE-REGISTERED, fixed before any stream was read:
//   P      = p99.99 of non-sentinel run lengths (samples)
//   N      = #{runs >= 200} — the long-run population above the cut
//   [a, b] = the widest MULTIPLICATIVE gap above P, taken between CONSECUTIVE OBSERVED run lengths
//            (a = l_i + 1, b = l_{i+1} - 1), so both sides carry a positive count BY CONSTRUCTION.
//   ⚠️ The bracketing is load-bearing and its absence is a wrong verdict, not an ambiguous one: an
//      unbracketed "widest empty band above P" is ALWAYS the unbounded tail past the largest run
//      (ratio infinity), which wins the maximisation and then fires FAIL-LOW on a stream that should
//      read HOLD. `plantHoldNotFailLow` asserts exactly that case, and asserts the unbracketed rule
//      gets it wrong — a plant whose longest runs are its own implanted ones could not see this.
//
//   UNDERPOWERED   fewer than 1e6 samples        quoted as a count, no verdict
//   no gap (b/a < 4):
//     NOT-EXERCISED  and N = 0                   ONE lump and nothing beyond it; the cut is untested
//     NO GAP         and N > 0                   continuous into the long runs; NO threshold separates
//   a gap exists (b/a >= 4):
//     FAIL-LOW       200 < a                     the cut sits inside the plateau population
//     FAIL-HIGH      200 > b                     a separated population lies BELOW the cut; propose b
//     HOLD           a <= 200 <= b               the constant transfers, alternatives being reachable
//
// ⚠️ FAIL-HIGH IS TESTED BEFORE N, and that ordering IS the row's failure mode. Keying NOT-EXERCISED
// on `N = 0` alone mislabels a stream whose entire separated population sits BELOW 200 — there IS a
// population, the cut simply misses all of it, which is exactly "too high a threshold under-reports".
// Found by the plant, not by review: `plantFailHighBelowCut` has N = 0 and must read FAIL-HIGH.
//
//
// Factor 4 is inherited, not invented: it is the factor the shipped constant already uses.
//
// Usage:
//   node tools/stuck-run-lengths.mjs --selftest
//   node tools/stuck-run-lengths.mjs --dir <captures root> --stream verity-ppg|verity-acc|h10-acc|ppg2w
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export const T_STUCK = 200;
export const GAP_FACTOR = 4;
export const MIN_SAMPLES = 1e6;

/* Run lengths of CONSTANT value, as a sparse histogram {length -> count}. Streaming by design: the
   histogram is the only thing that grows, and it grows in distinct lengths, not in samples. */
export function runHistogram(values, hist = new Map()) {
  let prev = null;
  let run = 0;
  for (const v of values) {
    if (v === prev) run++;
    else {
      if (run > 0) hist.set(run, (hist.get(run) || 0) + 1);
      prev = v;
      run = 1;
    }
  }
  if (run > 0) hist.set(run, (hist.get(run) || 0) + 1);
  return hist;
}

/** The q-th quantile of run LENGTH over the histogram (q in [0,1]), by run count. */
export function quantile(hist, q) {
  const lens = [...hist.keys()].sort((x, y) => x - y);
  const total = lens.reduce((s, l) => s + hist.get(l), 0);
  if (!total) return null;
  const target = q * total;
  let seen = 0;
  for (const l of lens) {
    seen += hist.get(l);
    if (seen >= target) return l;
  }
  return lens[lens.length - 1];
}

/** The widest multiplicative gap above `floor`, BRACKETED by observed lengths on both sides.
    Returns { a, b, ratio, below, above } or null when no gap exists above the floor. */
export function widestBracketedGap(hist, floor) {
  /* ⚠️ THE LOWER BRACKET MAY SIT AT OR BELOW THE FLOOR, and filtering it out loses the gap that
     matters most. The first draft took only lengths > floor, so the band between the plateau tail
     (48, observed) and the first long run (900) was never a candidate — its lower neighbour had been
     filtered away — and the plant read NO GAP with a 1.86x tail gap instead of the real 18.3x one.
     Consecutive OBSERVED lengths are what brackets a band; the floor constrains where the band may
     START, not which lengths may bracket it. */
  const lens = [...hist.keys()].sort((x, y) => x - y);
  let best = null;
  for (let i = 0; i + 1 < lens.length; i++) {
    const lo = lens[i];
    const hi = lens[i + 1];
    if (hi - lo <= 1) continue; // adjacent observed lengths — no gap between them
    const a = lo + 1;
    const b = hi - 1;
    if (a <= floor) continue; // the band must lie above the plateau tail
    const ratio = b / a;
    if (!best || ratio > best.ratio) best = { a, b, ratio, below: hist.get(lo), above: hist.get(hi) };
  }
  return best;
}

/** The DEFECTIVE rule, kept only so the plant can assert it gets the HOLD case wrong. */
export function widestUnbracketedGap(hist, floor) {
  const lens = [...hist.keys()].filter((l) => l > floor).sort((x, y) => x - y);
  if (!lens.length) return null;
  const bracketed = widestBracketedGap(hist, floor);
  const tail = { a: lens[lens.length - 1] + 1, b: Number.POSITIVE_INFINITY, ratio: Number.POSITIVE_INFINITY };
  return !bracketed || tail.ratio > bracketed.ratio ? tail : bracketed;
}

export function verdictOf(hist, nSamples, { tStuck = T_STUCK, factor = GAP_FACTOR, minSamples = MIN_SAMPLES } = {}) {
  const lens = [...hist.keys()];
  const N = lens.filter((l) => l >= tStuck).reduce((s, l) => s + hist.get(l), 0);
  const P = quantile(hist, 0.9999);
  const gap = P == null ? null : widestBracketedGap(hist, P);
  const base = { P, N, gap, samples: nSamples };
  if (nSamples < minSamples) return { ...base, status: 'UNDERPOWERED', reason: `${nSamples} samples, minimum ${minSamples}` };
  if (!gap || gap.ratio < factor) {
    const g = gap ? `${gap.ratio.toFixed(2)}x` : 'none';
    // No separation. WHICH no-separation it is turns on whether anything reaches the cut at all.
    if (N === 0)
      return {
        ...base,
        status: 'NOT-EXERCISED',
        reason: `one population and nothing beyond it (no run reaches ${tStuck}; widest bracketed gap ${g}) — the cut is untested in either direction and no constant is proposed`
      };
    return {
      ...base,
      status: 'NO GAP',
      reason: `the widest bracketed gap above p99.99=${P} is ${g}, under ${factor}x — the plateau and long-run populations are continuous, so NO threshold separates them`
    };
  }
  if (tStuck < gap.a) return { ...base, status: 'FAIL-LOW', reason: `${tStuck} < gap start ${gap.a} — the cut sits inside the plateau population` };
  // BEFORE N: a separated population entirely below the cut is the row's failure, not an absence.
  if (tStuck > gap.b)
    return {
      ...base,
      status: 'FAIL-HIGH',
      reason: `${tStuck} > gap end ${gap.b} — a separated population lies BELOW the cut, which misses all of it (N=${N}); per-stream constant proposed at ${gap.b}`,
      propose: gap.b
    };
  return { ...base, status: 'HOLD', reason: null };
}

/* ── PLANTS ───────────────────────────────────────────────────────────────────────────────────── */

/** A plateau population with lengths 1..maxPlateau, then an implanted long-run population, then
    runs BEYOND it — the "beyond" is what makes the HOLD case distinguishable from the tail. */
export function plantStream({ plateauMax = 48, longFrom = 900, longTo = 6000, beyond = true, bulk = 3e6 } = {}) {
  /* `bulk` is load-bearing: p99.99 lands in the PLATEAU only while the long-run population is rarer
     than 1e-4 of all runs. The first draft used 1e5 and the 26 implanted runs pushed p99.99 to 3000,
     so the plant read NO GAP — it was measuring its own weights, not the rule. */
  const hist = new Map();
  for (let l = 1; l <= plateauMax; l++) hist.set(l, Math.max(1, Math.round(bulk / (l * l))));
  const step = Math.max(1, Math.round((longTo - longFrom) / 8) || 1);
  for (let l = longFrom; l <= longTo; l += step) hist.set(l, 3);
  if (beyond) hist.set(longTo + 4000, 2);
  return hist;
}

/** A separated population ENTIRELY BELOW the cut, with nothing at or above it: N = 0, and the correct
    verdict is FAIL-HIGH because 200 misses the whole population. */
export function plantFailHighBelowCut() {
  return plantStream({ plateauMax: 20, longFrom: 120, longTo: 190, beyond: false });
}

async function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const N_OF = (h) => [...h.keys()].filter((l) => l >= T_STUCK).reduce((s, l) => s + h.get(l), 0);

  ok(
    JSON.stringify([...runHistogram([1, 1, 2, 2, 2, 3])]) ===
      JSON.stringify([
        [2, 1],
        [3, 1],
        [1, 1]
      ]),
    'runHistogram counts constant runs, including the final one'
  );
  ok(quantile(runHistogram([1, 1, 1, 2]), 1) === 3 && quantile(new Map(), 0.5) === null, 'quantile is over run counts, and is null on an empty histogram');

  /* the case the UNBRACKETED rule gets wrong — the whole reason bracketing is a condition */
  const h = plantStream();
  const v = verdictOf(h, 5e6);
  ok(v.status === 'HOLD', `plateau<=48 + long runs 900..6000 + a run beyond ⇒ HOLD, got ${v.status} (${v.reason})`);
  ok(v.gap.a <= T_STUCK && T_STUCK <= v.gap.b, `200 sits inside the bracketed gap [${v.gap?.a}, ${v.gap?.b}]`);
  const ub = widestUnbracketedGap(h, v.P);
  ok(ub.ratio === Number.POSITIVE_INFINITY && T_STUCK < ub.a, `PLANT IS NOT VACUOUS: the unbracketed rule picks the unbounded tail [${ub.a}, inf) and would fire FAIL-LOW on this exact stream`);

  /* a plant whose longest runs ARE the implanted ones cannot see that defect — asserted, so nobody
     later "simplifies" the plant back to it */
  const hNoBeyond = plantStream({ beyond: false });
  const ubNo = widestUnbracketedGap(hNoBeyond, quantile(hNoBeyond, 0.9999));
  ok(ubNo.ratio === Number.POSITIVE_INFINITY, 'a plant with no run beyond the implanted population has the same unbounded tail — which is why `beyond` is not optional');

  const fh = verdictOf(plantFailHighBelowCut(), 5e6);
  ok(fh.status === 'FAIL-HIGH', `a separated population entirely BELOW the cut ⇒ FAIL-HIGH, got ${fh.status} (${fh.reason})`);
  ok(fh.N === 0, "and it has N = 0 — keying NOT-EXERCISED on N alone would have mislabelled the row's own failure mode");
  ok(fh.propose === fh.gap.b && fh.propose < T_STUCK, `FAIL-HIGH proposes a per-stream constant at the gap end (${fh.propose})`);
  const flat = new Map();
  for (let l = 1; l <= 4000; l++) flat.set(l, 5);
  ok(verdictOf(flat, 5e6).status === 'NO GAP' && N_OF(flat) > 0, 'a continuous distribution with runs past the cut ⇒ NO GAP, never NOT-EXERCISED');
  const plateauOnly = plantStream({ longFrom: 1e9, longTo: 1e9, beyond: false });
  plateauOnly.delete(1e9);
  ok(verdictOf(plateauOnly, 5e6).status === 'NOT-EXERCISED' && N_OF(plateauOnly) === 0, 'a stream with no run reaching the cut ⇒ NOT-EXERCISED, not NO GAP');
  ok(verdictOf(plantStream(), 1000).status === 'UNDERPOWERED', 'under 1e6 samples ⇒ UNDERPOWERED whatever the shape');

  const N = 12;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`SELFTEST FAIL (${fails.length} of ${N})`);
    process.exit(1);
  }
  console.log(`SELFTEST PASS (${N}/${N})`);
}

/* ── STREAMS ──────────────────────────────────────────────────────────────────────────────────
   `cols` are the 0-based data columns whose run lengths are counted INDEPENDENTLY (a run is a
   constant value in ONE channel — a 3-LED plateau is per-LED, not a vector equality). `fs` is the
   rate MEASURED from the corpus, not the declared table, and is used only to report seconds. */
export const STREAMS = {
  'verity-ppg': { glob: /Polar_.*Sense.*_PPG\.txt$/, cols: [2, 3, 4], names: ['ch0', 'ch1', 'ch2'], fs: 55.13, writerKey: 'ppg' },
  'verity-acc': { glob: /Polar_.*Sense.*_ACC\.txt$/, cols: [2, 3, 4], names: ['x', 'y', 'z'], fs: 51.68, writerKey: 'acc' },
  'h10-acc': { glob: /Polar_H10_.*_ACC\.txt$/, cols: [2, 3, 4], names: ['x', 'y', 'z'], fs: 51.68, writerKey: 'acc' },
  ppg2w: { glob: /_PPG2W\.txt$/, cols: [2, 3], names: ['ch0', 'ch1'], fs: 127.76, writerKey: 'ppg2w' }
};

/** Stream one capture file into per-channel histograms. Lazy by contract: one line at a time, and
    the only growing state is the sparse histograms (distinct run LENGTHS, never samples). */
async function scanFile(path, spec, hists, counts, longByValue) {
  const prev = new Array(spec.cols.length).fill(null);
  const run = new Array(spec.cols.length).fill(0);
  const rl = createInterface({ input: createReadStream(path, { encoding: 'latin1' }), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (line.charCodeAt(0) !== 50) continue; // data rows start with the year '2'
    const p = line.split(';');
    for (let c = 0; c < spec.cols.length; c++) {
      const v = p[spec.cols[c]];
      if (v === undefined) continue;
      counts[c]++;
      if (v === prev[c]) run[c]++;
      else {
        if (run[c] > 0) close(hists[c], longByValue[c], prev[c], run[c]);
        prev[c] = v;
        run[c] = 1;
      }
    }
  }
  for (let c = 0; c < spec.cols.length; c++) if (run[c] > 0) close(hists[c], longByValue[c], prev[c], run[c]);
}

/** Record one finished run: always into the length histogram, and — only when long enough to matter
    for the tail — into the per-value map the modal-exclusion report reads. */
function close(hist, byValue, value, len) {
  hist.set(len, (hist.get(len) || 0) + 1);
  if (len < LONG_RUN_FLOOR) return;
  let h = byValue.get(value);
  if (!h) byValue.set(value, (h = new Map()));
  h.set(len, (h.get(len) || 0) + 1);
}

export const LONG_RUN_FLOOR = 20;

/** The second report: the same histogram with the LONG runs of the top-k most run-producing VALUES
    removed.
    ⚠️ THE FIRST DRAFT EXCLUDED THE TOP-k MODAL *LENGTHS*, WHICH IS THE BULK, NOT THE SENTINELS.
    Lengths 1-3 are the most common runs in every stream, so dropping them emptied the histogram and
    every channel reported `p99.99 = null` — caught by a two-file smoke run, not by the selftest,
    because the plants have no value dimension at all. Sentinels are a property of the VALUE; the
    plateau is a property of the LENGTH.
    ⚠️ And this is not §∅'s forbidden move: nothing is keyed on WHICH value (no membership test, no
    literal). The top-k are whatever the data's own run counts nominate, and BOTH reports are
    published — the finding is whether the gap moves across the cut, never a single corrected number.
    Only runs at or above LONG_RUN_FLOOR are tracked per value, which is what keeps this bounded: a
    sentinel's contribution to the TAIL is what inflates p99.99, and short runs cannot be sentinels of
    concern. */
export function dropTopModalValues(hist, longByValue, k) {
  const top = [...longByValue.entries()]
    .map(([v, h]) => [v, [...h.values()].reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map((e) => e[0]);
  const out = new Map(hist);
  for (const v of top) {
    for (const [len, n] of longByValue.get(v)) {
      const left = (out.get(len) || 0) - n;
      if (left > 0) out.set(len, left);
      else out.delete(len);
    }
  }
  return { hist: out, excluded: top.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const dir = opt('--dir', null);
  const name = opt('--stream', null);
  const spec = STREAMS[name];
  if (!dir || !spec) {
    console.error('usage: node tools/stuck-run-lengths.mjs --dir <captures root> --stream ' + Object.keys(STREAMS).join('|') + ' [--limit N] | --selftest');
    process.exit(2);
  }
  const limit = +opt('--limit', 0);
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (d, out = []) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (spec.glob.test(e)) out.push(p);
    }
    return out;
  };
  let files = walk(dir).sort();
  if (limit > 0) files = files.slice(0, limit);
  const hists = spec.cols.map(() => new Map());
  const longByValue = spec.cols.map(() => new Map());
  const counts = spec.cols.map(() => 0);
  let done = 0;
  for (const f of files) {
    try {
      await scanFile(f, spec, hists, counts, longByValue);
    } catch (e) {
      console.log(`  skip ${f.split('/').pop()}: ${String(e.message).slice(0, 60)}`);
    }
    if (++done % 50 === 0) console.log(`  … ${done}/${files.length} files, ${counts[0].toLocaleString()} samples ch0`);
  }
  console.log(`\nstream ${name} · ${files.length} files · fs ${spec.fs} Hz (measured) · writers key '${spec.writerKey}'`);
  const rows = [];
  for (let c = 0; c < spec.cols.length; c++) {
    const dropped = dropTopModalValues(hists[c], longByValue[c], 3);
    for (const [label, h] of [
      ['all-runs', hists[c]],
      [`top${dropped.excluded}-values-excluded`, dropped.hist]
    ]) {
      const v = verdictOf(h, counts[c]);
      const sec = (n) => (n == null ? 'n/a' : (n / spec.fs).toFixed(2) + ' s');
      rows.push({ channel: spec.names[c], report: label, ...v });
      console.log(
        `  ${spec.names[c]}/${label.padEnd(17)} samples=${counts[c].toLocaleString().padStart(12)} p99.99=${String(v.P).padStart(5)} (${sec(v.P).padStart(8)})` +
          `  N=${String(v.N).padStart(6)}  gap=${v.gap ? `[${v.gap.a},${v.gap.b}] ${v.gap.ratio.toFixed(2)}x` : 'none'}  → ${v.status}`
      );
      if (v.reason) console.log(`      ${v.reason}`);
    }
  }
  console.log('\nJSON ' + JSON.stringify({ stream: name, fs: spec.fs, files: files.length, tStuck: T_STUCK, rows }));
}

if (process.argv.includes('--selftest')) await selftest();
else await main();
