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
