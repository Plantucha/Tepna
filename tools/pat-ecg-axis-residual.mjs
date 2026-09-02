#!/usr/bin/env node
/*
 * tools/pat-ecg-axis-residual.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * H_axis P1 (PPG-FOOT-PLACEMENT-FOLLOWUPS §1, frozen pre-registration) — anchors only, no oracle.
 *
 * The oracle's ECG train rides `t0Ms + i/fs` (fs at most RATE-corrected); the DSP's own
 * host-disciplined position map `rec.tMsAt(i)` additionally carries the PIECEWISE hostAxis
 * interpolation. Their difference
 *
 *     c(i) = tMsAt(i) − (t0Ms + i/fs·1000)
 *
 * is, by construction, exactly the axis error the current train carries relative to the
 * host-disciplined one — whatever linear part `fs` already absorbed is already subtracted.
 *
 * PREDICTION DERIVED, NOT ASSUMED — and the first derivation was WRONG, caught against the frozen
 * text (kept per report-don't-absorb): R_linear = R_true − c, so the measured lag
 * f − R_linear = lag_true + c — INFLATED by c, not deflated. The halves-mode shift is therefore
 *
 *     Δmode_pred = mean_B(c) − mean_A(c)        (A = 1st scored half, B = 2nd; Δmode = modeB−modeA)
 *
 * which is exactly the frozen §1 wording ("mean over the 2nd scored half − mean over the 1st");
 * this tool's first commit computed the negation and disagreed with its own pre-registration.
 *
 * evaluated over the oracle's own overlap split (same lo/mid/hi rule as `oracleNight`,
 * re-stated here because that function does not export its split).
 *
 * P1 verdict inputs (frozen): |Δmode − Δmode_pred| ≤ 30 ms, sign included, on ≥3 of 4 signal
 * nights, against #2044's published Δmode = −80 / −120 / +100 / +150 ms
 * (2026-07-24 · 08-12 · 08-17 · 08-18). This tool prints the prediction and diagnostics
 * (tMsCorrected · independent · maxStepMs · c-range); the comparison lives in the brief.
 *
 *   node tools/pat-ecg-axis-residual.mjs --selftest
 *   node tools/pat-ecg-axis-residual.mjs --dir <captures root> --night 2026-07-24 [--night …]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

/* ── pure core: halves-mean difference of a sampled correction over a split ───────────────────────
   cSamples: [{t, c}] with t ascending. Returns mean(c | t∈[mid,hi]) − mean(c | t∈[lo,mid)) —
   B minus A, the frozen §1 order. Uniform-in-time sampling stands in for beat-weighted means
   (beats are near-uniform overnight; stated in the pre-registration's collapse-floor terms). */
export function halvesMeanDiff(cSamples, lo, mid, hi) {
  let sa = 0;
  let na = 0;
  let sb = 0;
  let nb = 0;
  for (const { t, c } of cSamples) {
    if (!(isFinite(t) && isFinite(c))) continue;
    if (t >= lo && t < mid) {
      sa += c;
      na++;
    } else if (t >= mid && t <= hi) {
      sb += c;
      nb++;
    }
  }
  if (na < 10 || nb < 10) return null;
  return sb / nb - sa / na;
}

/* The oracle's overlap-split rule, re-stated (pat-window-oracle.mjs oracleNight does not export
   its split): lo/hi from both trains' overlap, mid = median scored R. */
export function oracleSplit(rTimes, fTimes) {
  const lo = Math.max(rTimes[0], fTimes[0]);
  const hi = Math.min(rTimes[rTimes.length - 1], fTimes[fTimes.length - 1]);
  if (!(hi > lo)) return null;
  const rIn = rTimes.filter((t) => t >= lo && t <= hi);
  if (rIn.length < 200) return null;
  return { lo, mid: rIn[Math.floor(rIn.length / 2)], hi };
}

function selftest() {
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!cond) fail++;
  };
  const T = 6 * 3600e3;
  const mk = (fn) => {
    const s = [];
    for (let t = 0; t <= T; t += 60e3) s.push({ t, c: fn(t) });
    return s;
  };
  console.log('\n### halvesMeanDiff — analytic plants');
  ok(
    'zero correction ⇒ 0',
    Math.abs(
      halvesMeanDiff(
        mk(() => 0),
        0,
        T / 2,
        T
      )
    ) < 1e-9
  );
  // step of +100 ms at mid: mean_A 0, mean_B 100 ⇒ B−A = +100 — a late-half positive c must
  // predict a POSITIVE mode shift (measured lag = true + c); the first version asserted −100
  // and its instrument disagreed with the frozen text's sign on real data.
  const st = halvesMeanDiff(
    mk((t) => (t >= T / 2 ? 100 : 0)),
    0,
    T / 2,
    T
  );
  ok('a +100 ms step at mid ⇒ +100 (sign: B minus A, the frozen order)', Math.abs(st - 100) < 1.5, `${st?.toFixed(2)}`);
  // quadratic c = k·t²: mean_A = kT²/12, mean_B = 7kT²/12 ⇒ B−A = +kT²/2
  const k = 100 / (T * T); // c(T) = 100 ms
  const q = halvesMeanDiff(
    mk((t) => k * t * t),
    0,
    T / 2,
    T
  );
  ok('quadratic reaching 100 ms ⇒ +50 analytic', Math.abs(q - 50) < 1.0, `${q?.toFixed(2)}`);
  // linear c under an axis that absorbed it is c≡0 by construction — covered by the zero plant.
  ok('under 10 samples per half refuses', halvesMeanDiff(mk(() => 0).slice(0, 15), 0, T / 2, T) === null);

  console.log('\n### oracleSplit — the re-stated rule matches its own definition');
  const R = [];
  for (let i = 0; i < 1000; i++) R.push(i * 900);
  // lo = max(R[0]=0, F[0]=50) = 50; hi = min(R.last=899100, F.last=899950) = 899100 — the R train ends first
  const s = oracleSplit(R, [50, 899950]);
  ok('overlap respected', s && s.lo === 50 && s.hi === 899100, s ? `${s.lo}..${s.hi}` : 'null');
  // rIn = R[1..999] (999 beats; R[0]=0 falls below lo), so mid = rIn[499] = R[500] = 450000
  ok('mid is the median scored R', s && s.mid === 450000, s ? `${s.mid}` : 'null');

  console.log(`\n${fail === 0 ? 'PASS — analytic plants and the split rule hold' : `FAIL — ${fail} problem(s)`}`);
  return fail === 0;
}

async function main() {
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const DIR = argv[argv.indexOf('--dir') + 1];
  const nights = argv.flatMap((a, i) => (a === '--night' ? [argv[i + 1]] : []));
  if (!DIR || !existsSync(DIR) || !nights.length) {
    console.error('usage: node tools/pat-ecg-axis-residual.mjs --selftest | --dir <captures root> --night YYYY-MM-DD [--night …]');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { pickPair } = await import(join(HERE, 'pat-window-oracle.mjs'));
  getDsps();
  console.log('night        ΔmodePred   tMsCorrected  independent  maxStep   c range        split (h)');
  for (const n of nights) {
    const dir = join(DIR, n);
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      console.log(`${n}  ⊘ no directory`);
      continue;
    }
    /* The oracle's picker, imported — this was the FOURTH copy of the pre-#2082 version. Note it
       reports its own reason below: that is exactly why `pickPair` RETURNS `missing` instead of
       printing, since the three call sites each report differently. */
    const paired = pickPair(dir, files);
    if (paired.missing) {
      console.log(`${n}  ⊘ ${paired.missing}`);
      continue;
    }
    const { eF, pF } = paired;
    let E;
    let P;
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'));
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch (e) {
      console.log(`${n}  ⊘ parse failed (${String(e.message).slice(0, 50)})`);
      continue;
    }
    const split = oracleSplit(Array.from(E.times), Array.from(P.times));
    if (!split) {
      console.log(`${n}  ⊘ no usable split`);
      continue;
    }
    /* c(t) sampled once per minute across the scored span: index i for linear time t is
       (t − t0)·fs/1000, and c = tMsAt(i) − t. */
    const cSamples = [];
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let t = split.lo; t <= split.hi; t += 60e3) {
      const i = ((t - E.t0Ms) * E.fs) / 1000;
      if (!(i >= 0)) continue;
      const c = E.tMsAt(i) - t;
      cSamples.push({ t, c });
      if (c < cMin) cMin = c;
      if (c > cMax) cMax = c;
    }
    const d = halvesMeanDiff(cSamples, split.lo, split.mid, split.hi);
    const spanH = ((split.hi - split.lo) / 3600e3).toFixed(1);
    console.log(
      `${n}  ${d == null ? '   n/a  ' : (d >= 0 ? '+' : '') + d.toFixed(1).padStart(7) + ' ms'}   ${String(E.tMsCorrected).padEnd(12)}  ${String(E.independent).padEnd(11)}  ${E.maxStepMs == null ? '  n/a' : E.maxStepMs.toFixed(0).padStart(5)}   ${cMin.toFixed(0)}..${cMax.toFixed(0)} ms   ${spanH}`
    );
  }
}

if (process.argv[1]?.endsWith('pat-ecg-axis-residual.mjs')) await main();
