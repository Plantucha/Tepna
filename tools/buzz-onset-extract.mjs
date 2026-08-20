#!/usr/bin/env node
/*
 * tools/buzz-onset-extract.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * EXTRACT COMMANDED-BUZZ ONSETS from ACC / ring-motion streams and turn them into numbers: the
 * command→artifact latency per fire, and the pairwise inter-device onset delta per event.
 *
 * The apparatus behind O2RING-BUZZ-FIDUCIAL's measured results (2026-08-19, three runs): the daemon's
 * /api/ring/buzz stamps each command to the ms; this tool finds where the ~1.1 s vibration artifact
 * STARTS in each recorded stream. Detector: high-frequency energy (|first difference| of the ACC
 * magnitude, 3-sample smoothed) against a robust baseline (median + k·1.4826·MAD from a pre-command
 * window); onset = first of `sustain` consecutive supra-threshold samples. Threshold-crossing lands ON
 * THE RISING SLOPE, so a slow-coupled device reads systematically late and noisier — the measured
 * Verity legs (SD 143–303 ms vs the H10's 22–33 ms) are estimator-limited, not clock-limited. A
 * matched-filter estimator over the same data is the known upgrade path; this tool records the honest
 * baseline it must beat.
 *
 * Usage:
 *   node tools/buzz-onset-extract.mjs --cmds 22:42:28.910,22:42:31.985,... \
 *        --acc <H10_ACC.txt> --acc <Verity_ACC.txt> [--motion <ring_PPG2W.txt>]
 * Streams are the capture-host column formats (Phone timestamp;sensor ns;x;y;z / ...;ch0;ch1;motion).
 * Latencies print per file; pairwise deltas print between consecutive --acc files (file2 − file1).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

/** 'HH:MM:SS.mmm' (or a plain number) → seconds-of-day. PURE. Exact-field arithmetic — the first run
 *  of this analysis extracted ZERO events everywhere because a hand conversion used the wrong hour;
 *  a systematic all-null from a coarse-verified detector means the WINDOW is wrong, not the data. */
export function secOfDay(s) {
  if (typeof s === 'number') return s;
  const m = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

/** Capture-host stream file → [{t (sec-of-day), v (magnitude)}]. cols: value columns to combine. */
export function loadStream(path, cols) {
  const out = [];
  for (const ln of fs.readFileSync(path, 'utf8').split('\n')) {
    const p = ln.split(';');
    if (p.length < 3 || !/^\d{4}-/.test(p[0])) continue;
    const t = secOfDay(p[0].slice(11, 23));
    if (t == null) continue;
    let v;
    if (cols.length > 1) {
      let s = 0;
      for (const c of cols) s += (+p[c]) ** 2;
      v = Math.sqrt(s);
    } else v = Math.abs(+p[cols[0]]);
    if (Number.isFinite(v)) out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** High-frequency energy: |first difference|, 3-sample smoothed. Vibration shows as a step in this
 *  series while posture/gravity (which dominate raw magnitude) cancel out. PURE. */
export function hfEnergy(series) {
  const d = new Array(series.length).fill(0);
  for (let i = 1; i < series.length; i++) d[i] = Math.abs(series[i].v - series[i - 1].v);
  const sm = series.map((s, i) => ({
    t: s.t,
    v: i > 0 && i < d.length - 1 ? (d[i - 1] + d[i] + d[i + 1]) / 3 : 0
  }));
  return sm;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
}

/** Onset of the artifact for ONE command: first `sustain` consecutive samples above
 *  median + k·1.4826·MAD of the pre-command baseline. Returns {onset, latency} or {refused}. PURE. */
export function findOnset(sig, tCmd, { prePad = [1.5, 0.3], post = 2.0, k = 8, sustain = 3 } = {}) {
  const base = sig.filter((s) => s.t >= tCmd - prePad[0] && s.t < tCmd - prePad[1]).map((s) => s.v);
  if (base.length < 10) return { refused: 'baseline window has <10 samples' };
  const med = median(base);
  const mad = median(base.map((v) => Math.abs(v - med))) || 1e-9;
  const thr = med + k * 1.4826 * mad;
  let run = 0;
  let runStart = null;
  for (const s of sig) {
    if (s.t < tCmd - 0.2 || s.t > tCmd + post) {
      run = 0;
      continue;
    }
    if (s.v > thr) {
      if (run === 0) runStart = s.t;
      run++;
      if (run >= sustain) return { onset: runStart, latency: runStart - tCmd, thr };
    } else run = 0;
  }
  return { refused: 'no sustained supra-threshold run in the window' };
}

/** Whole-run report: onsets per stream + pairwise deltas between consecutive ACC streams. PURE. */
export function analyze(streams, cmds) {
  const per = streams.map(({ name, sig }) => ({
    name,
    events: cmds.map((c) => ({ cmd: c, ...findOnset(sig, c) }))
  }));
  const deltas = [];
  for (let i = 1; i < per.length; i++) {
    if (streams[i].kind !== 'acc' || streams[i - 1].kind !== 'acc') continue;
    const d = [];
    for (let e = 0; e < cmds.length; e++) {
      const a = per[i - 1].events[e],
        b = per[i].events[e];
      if (a.onset != null && b.onset != null) d.push({ event: e + 1, deltaS: b.onset - a.onset });
    }
    deltas.push({ pair: `${streams[i].name} − ${streams[i - 1].name}`, d });
  }
  return { per, deltas };
}

/** Linear-interpolate a {t,v} series onto a uniform grid. PURE. */
export function resample(sig, t0, t1, fs = 100) {
  const out = [];
  let j = 0;
  for (let t = t0; t <= t1; t += 1 / fs) {
    while (j < sig.length - 1 && sig[j + 1].t < t) j++;
    if (j >= sig.length - 1 || sig[j].t > t) {
      out.push(0);
      continue;
    }
    const a = sig[j],
      b = sig[j + 1];
    out.push(b.t > a.t ? a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t) : a.v);
  }
  return out;
}

/** Lag (seconds) of series b RELATIVE TO a by normalized cross-correlation, parabolic-refined at the
 *  peak. Positive = b later. This is the matched-filter estimator: over an APERIODIC burst pattern the
 *  correlation peak is unique, every burst contributes at once, and — unlike threshold-crossing — the
 *  per-event PRECISION is rise-shape-insensitive (the threshold baseline's ~130 ms SD collapses).
 *  ⚠ ACCURACY is not: xcorr aligns energy centroids, so a slow-rising coupling drags the estimate late
 *  by ~rise/2 — a bias that is CONSTANT per contact geometry, cancelling in session-to-session
 *  comparisons but not in absolute offsets. State lags as "xcorr lag", never as "clock offset",
 *  unless the two couplings are known to match. PURE. */
export function xcorrLag(a, b, fs = 100, maxLagS = 2) {
  const z = (x) => {
    const m = x.reduce((p, c) => p + c, 0) / x.length;
    const sd = Math.sqrt(x.reduce((p, c) => p + (c - m) ** 2, 0) / x.length) || 1;
    return x.map((v) => (v - m) / sd);
  };
  const A = z(a),
    B = z(b);
  const maxLag = Math.round(maxLagS * fs);
  let best = -Infinity,
    bestL = 0;
  const r = new Map();
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0,
      n = 0;
    for (let i = 0; i < A.length; i++) {
      const k = i + lag;
      if (k < 0 || k >= B.length) continue;
      s += A[i] * B[k];
      n++;
    }
    const v = n ? s / n : -Infinity;
    r.set(lag, v);
    if (v > best) {
      best = v;
      bestL = lag;
    }
  }
  if (!Number.isFinite(best) || best <= 0) return { refused: 'no positive correlation peak' };
  // parabolic sub-sample refinement around the integer peak
  const y0 = r.get(bestL - 1),
    y1 = r.get(bestL),
    y2 = r.get(bestL + 1);
  let frac = 0;
  if (y0 != null && y2 != null) {
    const den = y0 - 2 * y1 + y2;
    if (den < 0) frac = (0.5 * (y0 - y2)) / den;
  }
  return { lagS: (bestL + frac) / fs, peak: best };
}

/** Matched-filter analysis over a whole pattern: pairwise device lag (all bursts at once) + per-event
 *  lags (for an honest spread), + per-device command→artifact latency against a boxcar template train
 *  (burstS ≈ the measured ~1.1 s vibration). PURE. */
export function xcorrAnalyze(streams, cmds, { fs = 100, burstS = 1.1 } = {}) {
  const t0 = Math.min(...cmds) - 2,
    t1 = Math.max(...cmds) + 3;
  const grids = streams.map((st) => resample(st.sig, t0, t1, fs));
  const template = [];
  for (let t = t0; t <= t1; t += 1 / fs) template.push(cmds.some((c) => t >= c && t < c + burstS) ? 1 : 0);
  const latency = streams.map((st, i) => ({ name: st.name, ...xcorrLag(template, grids[i], fs) }));
  const pairs = [];
  for (let i = 1; i < streams.length; i++) {
    const whole = xcorrLag(grids[i - 1], grids[i], fs);
    const per = [];
    for (const c of cmds) {
      const e0 = c - 0.5,
        e1 = c + 2.5;
      const ga = resample(streams[i - 1].sig, e0, e1, fs);
      const gb = resample(streams[i].sig, e0, e1, fs);
      const r = xcorrLag(ga, gb, fs, 1.5);
      if (r.lagS != null) per.push(r.lagS);
    }
    pairs.push({ pair: `${streams[i].name} − ${streams[i - 1].name}`, whole, per });
  }
  return { latency, pairs };
}

const stats = (a) => {
  if (!a.length) return null;
  const mean = a.reduce((p, c) => p + c, 0) / a.length;
  const sd = Math.sqrt(a.reduce((p, c) => p + (c - mean) ** 2, 0) / a.length);
  return { n: a.length, mean, sd, median: median(a) };
};

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ok   ${nm}`);
    } else {
      fail++;
      console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`);
    }
  };
  ok('secOfDay converts exactly', secOfDay('22:42:28.910') === 22 * 3600 + 42 * 60 + 28.91);
  ok('secOfDay rejects junk', secOfDay('not a time') === null);

  // synthetic 50 Hz ACC: gravity + noise, with planted 1 s vibration bursts at KNOWN onsets
  const mkStream = (onsets, { fs = 50, t0 = 1000, dur = 40, amp = 40 } = {}) => {
    const sig = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let i = 0; i < dur * fs; i++) {
      const t = t0 + i / fs;
      let v = 1000 + 2 * rnd(); // gravity + sensor noise
      for (const o of onsets) if (t >= o && t < o + 1.0) v += amp * Math.sin(i * 2.9) * (0.5 + Math.abs(rnd()));
      sig.push({ t, v });
    }
    return hfEnergy(sig);
  };

  // planted VARIED latencies — recovery must track each one, not a constant
  const cmds = [1005, 1011, 1018];
  const lats = [0.12, 0.3, 0.08];
  const sig = mkStream(cmds.map((c, i) => c + lats[i]));
  const evs = cmds.map((c) => findOnset(sig, c));
  ok(
    'all planted bursts found',
    evs.every((e) => e.onset != null),
    JSON.stringify(evs)
  );
  ok(
    'each planted latency recovered within 2 samples (40 ms)',
    evs.every((e, i) => Math.abs(e.latency - lats[i]) <= 0.04),
    evs.map((e) => e.latency?.toFixed(3)).join(',')
  );

  // CONTROL: a command window with NO burst must refuse, never invent an onset
  const quiet = findOnset(sig, 1030);
  ok('a burst-free window refuses', quiet.refused != null, JSON.stringify(quiet));

  // pairwise delta: second stream identical bursts shifted +0.15 s → delta ≈ +150 ms per event
  const sig2 = mkStream(cmds.map((c, i) => c + lats[i] + 0.15));
  const { deltas } = analyze(
    [
      { name: 'A', kind: 'acc', sig },
      { name: 'B', kind: 'acc', sig: sig2 }
    ],
    cmds
  );
  const dv = deltas[0].d.map((x) => x.deltaS);
  ok('pairwise delta recovers a planted +150 ms offset', dv.length === 3 && dv.every((x) => Math.abs(x - 0.15) <= 0.04), dv.map((x) => (x * 1000).toFixed(0)).join(','));

  // too-short baseline refuses rather than judging against nothing
  ok('a truncated baseline refuses', findOnset(sig.slice(0, 5), 1005).refused != null);

  // ── the matched filter, and the exact failure it must fix ─────────────────────────────────────
  // stream S has SHARP burst edges; stream L has a SLOW 0.4 s linear rise into each burst, planted
  // 150 ms later. Threshold-crossing lands on L's slope → biased late beyond the true offset; the
  // whole-pattern xcorr must recover ~150 ms regardless of rise shape.
  // A TRUE time-shift synthetic: the burst carrier's phase rides (t − onset) and each stream gets its
  // own noise seed — otherwise index-anchored carriers + shared noise correlate at lag 0 and poison the
  // xcorr assertions (measured: a spurious ~+100 ms on a supposedly exact matched-shape recovery).
  const mkShaped = (onsets, riseS, { fs = 50, t0 = 1000, dur = 40, amp = 60, seed0 = 3 } = {}) => {
    const sig = [];
    let seed = seed0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let i = 0; i < dur * fs; i++) {
      const t = t0 + i / fs;
      let v = 1000 + 2 * rnd();
      for (const o of onsets) {
        if (t >= o && t < o + 1.0) {
          const env = riseS > 0 ? Math.min(1, (t - o) / riseS) : 1;
          v += amp * env * Math.sin(2 * Math.PI * 17 * (t - o)) * (0.75 + 0.5 * Math.abs(rnd()));
        }
      }
      sig.push({ t, v });
    }
    return hfEnergy(sig);
  };
  const cmds2 = [1005, 1011, 1018, 1024, 1029]; // aperiodic: gaps 6,7,6,5? make 6,7,6,5 — fine, unequal
  const TRUE = 0.15;
  const sharp = mkShaped(cmds2, 0, { seed0: 11 });
  const slow = mkShaped(
    cmds2.map((c) => c + TRUE),
    0.4,
    { seed0: 29 }
  );
  const mf = xcorrAnalyze(
    [
      { name: 'S', kind: 'acc', sig: sharp },
      { name: 'L', kind: 'acc', sig: slow }
    ],
    cmds2,
    { fs: 100, burstS: 1.0 }
  );
  const wl = mf.pairs[0].whole.lagS;
  // ACCURACY when the couplings MATCH: both slow risers → the centroid bias cancels exactly
  const slow0 = mkShaped(cmds2, 0.4, { seed0: 47 });
  const mm = xcorrAnalyze(
    [
      { name: 'L0', kind: 'acc', sig: slow0 },
      { name: 'L1', kind: 'acc', sig: slow }
    ],
    cmds2,
    { fs: 100, burstS: 1.0 }
  );
  ok('matched couplings: xcorr recovers the planted +150 ms exactly', Math.abs(mm.pairs[0].whole.lagS - TRUE) <= 0.02, `got ${(mm.pairs[0].whole.lagS * 1000).toFixed(1)} ms`);
  // MISMATCHED couplings: the estimate is TRUE + a positive centroid bias (~rise/2) — known, bounded,
  // and constant per geometry. The assertion pins the bias's sign and rough size so a regression that
  // "fixes" it silently (or doubles it) is caught.
  ok('mismatched couplings: lag = truth + a bounded positive centroid bias', wl - TRUE > 0.03 && wl - TRUE < 0.25, `bias ${((wl - TRUE) * 1000).toFixed(0)} ms`);
  // the threshold baseline is biased late on the slow-rise stream — the defect the matched filter fixes
  const thS = cmds2.map((c) => findOnset(sharp, c).latency).filter((x) => x != null);
  const thL = cmds2.map((c) => findOnset(slow, c).latency).filter((x) => x != null);
  if (thS.length >= 3 && thL.length >= 3) {
    const bias = thL.reduce((p, c) => p + c, 0) / thL.length - thS.reduce((p, c) => p + c, 0) / thS.length - TRUE;
    ok('threshold-crossing IS biased on the slow riser (the control that justifies the xcorr)', bias > 0.02, `bias ${(bias * 1000).toFixed(0)} ms`);
  } else ok('threshold baseline extracted enough events to show the bias', false, `${thS.length}/${thL.length}`);
  // per-event xcorr spread stays tight
  const perSD = (() => {
    const a = mf.pairs[0].per;
    const m = a.reduce((p, c) => p + c, 0) / a.length;
    return Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / a.length);
  })();
  ok('per-event xcorr lags are tight (SD ≤ 30 ms) on synthetic', mf.pairs[0].per.length >= 4 && perSD <= 0.03, `n=${mf.pairs[0].per.length} SD ${(perSD * 1000).toFixed(1)} ms`);
  // command→artifact latency via the template train
  const latS = mf.latency[0].lagS;
  ok('template-train latency reads ~0 for the zero-latency stream', Math.abs(latS) <= 0.03, `${(latS * 1000).toFixed(1)} ms`);
  // burst-free stream refuses
  const flat2 = mkShaped([], 0, { seed0: 71 });
  const nf = xcorrAnalyze(
    [
      { name: 'S', kind: 'acc', sig: sharp },
      { name: 'F', kind: 'acc', sig: flat2 }
    ],
    cmds2
  );
  ok('a burst-free stream yields no confident pair lag', nf.pairs[0].whole.refused != null || nf.pairs[0].whole.peak < 0.3, JSON.stringify(nf.pairs[0].whole));

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const args = process.argv.slice(2);
  const cmds = (args[args.indexOf('--cmds') + 1] || '').split(',').map(secOfDay);
  const streams = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--acc') streams.push({ name: args[++i], kind: 'acc', sig: hfEnergy(loadStream(args[i], [2, 3, 4])) });
    else if (args[i] === '--motion') streams.push({ name: args[++i], kind: 'motion', sig: hfEnergy(loadStream(args[i], [4])) });
  }
  if (!cmds.length || cmds.some((c) => c == null) || !streams.length) {
    console.log('usage: --cmds HH:MM:SS.mmm,... --acc <ACC.txt> [--acc <ACC2.txt>] [--motion <PPG2W.txt>]');
    process.exit(2);
  }
  if (process.argv.includes('--xcorr')) {
    const { latency, pairs } = xcorrAnalyze(streams, cmds);
    for (const l of latency) console.log(l.lagS != null ? `  ${l.name}: command→artifact latency ${(l.lagS * 1000).toFixed(1)} ms (peak r ${l.peak.toFixed(2)})` : `  ${l.name}: ${l.refused}`);
    for (const p of pairs) {
      if (p.whole.lagS == null) {
        console.log(`  pair ${p.pair}: ${p.whole.refused}`);
        continue;
      }
      const st = stats(p.per);
      const conf = p.whole.peak < 0.6 ? '  ⚠ LOW CONFIDENCE (r < 0.6) — treat as unresolved, not as a lag' : '';
      console.log(`  pair ${p.pair}: whole-pattern lag ${(p.whole.lagS * 1000).toFixed(1)} ms (peak r ${p.whole.peak.toFixed(2)})${conf}`);
      if (st) console.log(`    per-event: n=${st.n} mean ${(st.mean * 1000).toFixed(1)} SD ${(st.sd * 1000).toFixed(1)} SE ${((st.sd / Math.sqrt(st.n)) * 1000).toFixed(1)} ms`);
    }
    process.exit(0);
  }
  const { per, deltas } = analyze(streams, cmds);
  for (const p of per) {
    console.log(`\n─ ${p.name}`);
    const lat = [];
    for (const e of p.events) {
      if (e.onset != null) {
        console.log(`   cmd ${e.cmd.toFixed(3)}  onset ${e.onset.toFixed(3)}  latency ${e.latency >= 0 ? '+' : ''}${e.latency.toFixed(3)} s`);
        lat.push(e.latency);
      } else console.log(`   cmd ${e.cmd.toFixed(3)}  — ${e.refused}`);
    }
    const st = stats(lat);
    if (st) console.log(`   extracted ${st.n}/${cmds.length} · latency median ${st.median >= 0 ? '+' : ''}${st.median.toFixed(3)} s · SD ${(st.sd * 1000).toFixed(0)} ms`);
  }
  for (const dd of deltas) {
    const st = stats(dd.d.map((x) => x.deltaS));
    if (!st) continue;
    console.log(`\n─ pairwise ${dd.pair}`);
    for (const x of dd.d) console.log(`   event ${x.event}: ${(x.deltaS * 1000).toFixed(1)} ms`);
    console.log(`   n=${st.n} · mean ${(st.mean * 1000).toFixed(1)} ms · SD ${(st.sd * 1000).toFixed(1)} ms · SE ${((st.sd / Math.sqrt(st.n)) * 1000).toFixed(1)} ms`);
  }
}
