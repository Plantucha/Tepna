/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-fiducial-jitter.mjs — PAT-ROOT-CAUSE-FORENSICS §7, rescoped.
 *
 * §7 asks: "even with a PERFECT clock, how much uncertainty does the foot introduce?" Every prior
 * attempt answered a different question, and two artefacts are why:
 *   • `pat-sd-is-the-window` — every PAT SD previously reported measured the 450 ms PHYS window
 *     (450/sqrt(12) = 129.90 ms), i.e. the window's own variance, not the physiology.
 *   • EXTERNAL-METHODS-SURVEY §1 — comparing fiducials by RECOVERY RATE cannot work here: the
 *     families differ by a near-constant translation (foot->half measured at 89.5 ms, spread 22 ms
 *     over 30 nights) and the strict statistic's leave-one-block-out centre absorbs a constant BY
 *     DESIGN. A translation-invariant estimator cannot see a translation.
 *
 * ┌─ THE MEASUREMENT: PAIRWISE, ON THE SAME BEAT — THE CLOCK CANCELS BY CONSTRUCTION ────────────┐
 * │ Two fiducials of the SAME beat share the same clock, the same t0, the same axis and the same  │
 * │ sample grid. Their DIFFERENCE is therefore free of every clock term exactly — not              │
 * │ approximately, not after correction, but identically. It is also free of the PHYS window,      │
 * │ which never enters: no acceptance stage runs here. So beat-to-beat variability of              │
 * │ (fiducial_A - fiducial_B) is a pure fiducial quantity, and it is the only §7 statistic in this │
 * │ repo that excludes BOTH artefacts by construction rather than by correction.                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 WHAT THIS IS A FLOOR ON, AND WHY IT IS NOT THE WHOLE ANSWER. The pairwise difference sees only
 * the NON-COMMON part of the two fiducials' error. Families on one pulse share morphology: when a
 * beat broadens, or an artefact tilts the upstroke, every family moves together and the shared
 * component CANCELS in the difference. So a small pairwise SD does not prove small fiducial jitter —
 * it proves small DISAGREEMENT. Report it as a floor. The same objection applies with more force to
 * the three-cornered hat below, whose derivation assumes INDEPENDENT leg errors; `tch-corners-are-
 * coupled` records that coupling breaking this assumption is a live failure mode in this repo, and
 * positively-correlated errors bias every sigma DOWNWARD. The TCH numbers are printed because a
 * refused/negative variance is itself diagnostic, NOT because independence is believed.
 *
 * 🔴 POOL WITHIN FILES, NEVER ACROSS THEM. Measured 2026-08-28, and it nearly produced two
 * contradictory answers from one tool: pooling all 8968 beats into ONE difference distribution gave
 * SD 41-56 ms (MATERIAL) while the same families on a single file gave 0.64-5.31 ms (NOT-DOMINANT).
 * The tell was that the pooled IQR stayed at 1-8 ms while the pooled SD hit 56 — a tight bulk with a
 * between-group shift, i.e. `V_pool = within + between` with the between term dominating. Each file
 * has its own near-constant family offset (EXTERNAL-METHODS-SURVEY measured foot->half at 89.5 ms
 * with a 22 ms spread ACROSS nights), so pooling measures that spread, not beat-to-beat jitter. This
 * tool therefore computes the SD WITHIN each file and reports the median across files, and prints the
 * between-file component separately because it is a real quantity — just a different one.
 *
 * PRE-STATED BANDS (closed, no gaps — declared before the first run):
 *   clock-free beat-to-beat SD  >= 20 ms  -> MATERIAL: the fiducial is a first-order term in the
 *                                            error budget, and the charter's "20-50 ms changes
 *                                            achievable precision fundamentally" is met.
 *                        10 ms <= SD < 20 ms -> INTERMEDIATE: real, but smaller than the 60 ms bar.
 *                                 SD < 10 ms -> NOT DOMINANT: the fiducial is not the limiting term.
 *   A negative TCH variance -> REFUSE that decomposition and say so; never clamp it to zero.
 *
 * Usage:
 *   node tools/pat-fiducial-jitter.mjs --selftest
 *   node tools/pat-fiducial-jitter.mjs <ppg-file> [...]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BAND_MATERIAL_MS = 20;
export const BAND_INTERMEDIATE_MS = 10;

export function band(sdMs) {
  if (!(sdMs >= 0)) return 'UNDEFINED';
  if (sdMs >= BAND_MATERIAL_MS) return 'MATERIAL';
  if (sdMs >= BAND_INTERMEDIATE_MS) return 'INTERMEDIATE';
  return 'NOT-DOMINANT';
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export function variance(a) {
  if (a.length < 2) return Number.NaN;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
}
const srt = (a) => a.slice().sort((x, y) => x - y);
const q = (a, p) => (a.length ? srt(a)[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : Number.NaN);

/* Sub-sample read of a bandpassed signal — feet are fractional, so this must interpolate. */
function sampleAt(bp, i) {
  if (!(i >= 0) || i > bp.length - 1) return Number.NaN;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return bp[lo];
  return bp[lo] + (i - lo) * (bp[hi] - bp[lo]);
}

/* ── the fiducial families, all measured on ONE upstroke [lo, peak] ─────────────────────────────
   `min` and `maxSlope` are INTEGER by nature and therefore carry the sample quantum (1/fs) in their
   jitter; `tangent`, `pct*` are fractional. That difference is a property to report, not a defect —
   at 176 Hz one sample is 5.7 ms and at 55 Hz it is 18 ms. */
export function familiesForBeat(bp, lo, peakI) {
  const p = Math.floor(peakI);
  if (!(p > lo + 2) || p >= bp.length) return null;
  let mi = p;
  let mv = bp[p];
  for (let j = p; j > lo; j--)
    if (bp[j] < mv) {
      mv = bp[j];
      mi = j;
    }
  let ms = mi;
  let msv = -Infinity;
  for (let j = mi; j < p; j++) {
    const dv = bp[j + 1] - bp[j];
    if (dv > msv) {
      msv = dv;
      ms = j;
    }
  }
  if (!(msv > 1e-9)) return null;
  const amp = bp[p] - mv;
  if (!(amp > 1e-9)) return null;
  const out = { min: mi, maxSlope: ms };
  /* tangent = the SHIPPED foot: where the max-slope tangent meets the minimum level (refineFeet). */
  out.tangent = Math.max(lo, Math.min(p, ms - (bp[ms] - mv) / msv));
  /* fractional-upstroke crossings, interpolated (never rounded — the quantum is the thing measured) */
  for (const pct of [0.1, 0.25, 0.5, 0.75]) {
    const target = mv + pct * amp;
    let hit = Number.NaN;
    for (let j = mi; j < p; j++) {
      if (bp[j] <= target && bp[j + 1] >= target) {
        const d = bp[j + 1] - bp[j];
        hit = d > 1e-12 ? j + (target - bp[j]) / d : j;
        break;
      }
    }
    out[`pct${Math.round(pct * 100)}`] = hit;
  }
  /* max second derivative on the upstroke */
  let d2i = mi;
  let d2v = -Infinity;
  for (let j = mi + 1; j < p - 1; j++) {
    const d2 = bp[j + 1] - 2 * bp[j] + bp[j - 1];
    if (d2 > d2v) {
      d2v = d2;
      d2i = j;
    }
  }
  out.d2max = d2i;
  return out;
}

export const FAMILIES = ['min', 'maxSlope', 'tangent', 'pct10', 'pct25', 'pct50', 'pct75', 'd2max'];

/* Pairwise, on the same beat: the clock cancels identically. Returns SD in ms of the beat-to-beat
   difference for every family pair. */
export function pairwiseJitter(beats, fs) {
  const msPer = 1000 / fs;
  const out = {};
  for (let a = 0; a < FAMILIES.length; a++) {
    for (let b = a + 1; b < FAMILIES.length; b++) {
      const A = FAMILIES[a];
      const B = FAMILIES[b];
      const d = [];
      for (const bt of beats) {
        const va = bt[A];
        const vb = bt[B];
        if (Number.isFinite(va) && Number.isFinite(vb)) d.push((va - vb) * msPer);
      }
      if (d.length >= 10) out[`${A}|${B}`] = { n: d.length, sdMs: Math.sqrt(variance(d)), iqrMs: q(d, 0.75) - q(d, 0.25), meanMs: mean(d) };
    }
  }
  return out;
}

/* Three-cornered hat over a family TRIPLE. Independence is NOT believed here (see header); a
   negative variance is surfaced as a refusal, never clamped. */
export function tchTriple(pw, A, B, C) {
  const get = (x, y) => pw[`${x}|${y}`] ?? pw[`${y}|${x}`];
  const ab = get(A, B);
  const ac = get(A, C);
  const bc = get(B, C);
  if (!ab || !ac || !bc) return null;
  const vAB = ab.sdMs ** 2;
  const vAC = ac.sdMs ** 2;
  const vBC = bc.sdMs ** 2;
  const v = { [A]: 0.5 * (vAB + vAC - vBC), [B]: 0.5 * (vAB + vBC - vAC), [C]: 0.5 * (vAC + vBC - vAB) };
  const neg = Object.entries(v)
    .filter(([, x]) => x < 0)
    .map(([k]) => k);
  return { v, negative: neg, ok: neg.length === 0 };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  ok(band(25) === 'MATERIAL', 'band 25 -> MATERIAL');
  ok(band(20) === 'MATERIAL', 'band boundary 20 is MATERIAL (closed)');
  ok(band(15) === 'INTERMEDIATE', 'band 15 -> INTERMEDIATE');
  ok(band(10) === 'INTERMEDIATE', 'band boundary 10 is INTERMEDIATE (closed, no gap)');
  ok(band(5) === 'NOT-DOMINANT', 'band 5 -> NOT-DOMINANT');

  /* A synthetic upstroke with a KNOWN tangent foot. Ramp from 0 to 1 over samples 10..20, so the
     max slope is constant on the ramp and the tangent meets the minimum level at sample 10. */
  const bp = new Float64Array(40);
  for (let i = 0; i < 40; i++) bp[i] = i <= 10 ? 0 : i >= 20 ? 1 : (i - 10) / 10;
  const f = familiesForBeat(bp, 0, 20);
  ok(f !== null, 'a clean synthetic upstroke yields families');
  ok(Math.abs(f.pct50 - 15) < 0.51, `pct50 of a linear ramp is its midpoint ~15, got ${f?.pct50}`);
  ok(f.min <= 10.001, `min sits at the foot of the ramp, got ${f?.min}`);

  /* THE CLOCK CANCELS: shifting every fiducial of a beat by a constant must not move any pairwise
     difference. This is the property the whole measurement rests on, so it is asserted. */
  const beats = [];
  for (let k = 0; k < 40; k++) {
    const shift = k * 3.7; // a large, varying "clock error"
    beats.push({ min: 10 + shift, maxSlope: 15 + shift, tangent: 10.5 + shift, pct50: 15 + shift, pct10: 11 + shift, pct25: 12.5 + shift, pct75: 17.5 + shift, d2max: 11 + shift });
  }
  const pw = pairwiseJitter(beats, 100);
  const anySd = Object.values(pw).map((x) => x.sdMs);
  ok(anySd.length > 0 && Math.max(...anySd) < 1e-9, `a pure clock shift must leave every pairwise SD at 0, max was ${Math.max(...anySd)}`);

  /* POSITIVE CONTROL — the harness must be able to SEE jitter, or the zero above is vacuous. */
  const noisy = beats.map((b, i) => ({ ...b, pct50: b.pct50 + (i % 2 ? 1 : -1) }));
  const pw2 = pairwiseJitter(noisy, 100);
  ok(pw2['min|pct50'].sdMs > 5, `planted +/-1 sample on pct50 at 100 Hz must show ~20 ms, got ${pw2['min|pct50'].sdMs.toFixed(2)}`);

  /* TCH refuses rather than clamps. */
  const t = tchTriple({ 'a|b': { sdMs: 1 }, 'a|c': { sdMs: 1 }, 'b|c': { sdMs: 10 } }, 'a', 'b', 'c');
  ok(t && !t.ok && t.negative.length > 0, 'an inconsistent triple must REFUSE, not clamp');

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'SELFTEST PASS (11/11)');
  return fails.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/pat-fiducial-jitter.mjs --selftest | <ppg-file> [...]');
    process.exit(2);
  }
  const { getDsps } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { PPGDSP } = getDsps();
  const all = [];
  const byFile = [];
  let fsSeen = 0;
  for (const f of files) {
    let rec;
    try {
      rec = PPGDSP.parsePPG(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    if (!rec || !rec.ch) continue;
    fsSeen = rec.fs;
    const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
    let refIdx = 0;
    let best = -1;
    per.forEach((p, i) => {
      if (p.peaks.length > best) {
        best = p.peaks.length;
        refIdx = i;
      }
    });
    const ref = per[refIdx];
    const bp = ref.bp || rec.ch[refIdx];
    const peaks = ref.peaks;
    const mine = [];
    for (let i = 1; i < peaks.length; i++) {
      const lo = Math.floor(peaks[i - 1]);
      const fam = familiesForBeat(bp, lo, peaks[i]);
      if (fam) {
        all.push(fam);
        mine.push(fam);
      }
    }
    if (mine.length >= 10) byFile.push(mine);
  }
  if (all.length < 10) {
    console.error(`only ${all.length} usable beats — refusing to report`);
    process.exit(2);
  }
  /* WITHIN-FILE, then median across files — see the pooling warning in the header. */
  const perFile = byFile.map((beats) => pairwiseJitter(beats, fsSeen)).filter((x) => Object.keys(x).length);
  const keys = [...new Set(perFile.flatMap((x) => Object.keys(x)))];
  const pw = {};
  for (const k of keys) {
    const sds = perFile.map((x) => x[k]?.sdMs).filter(Number.isFinite);
    const means = perFile.map((x) => x[k]?.meanMs).filter(Number.isFinite);
    if (!sds.length) continue;
    const betweenSd = means.length > 1 ? Math.sqrt(variance(means)) : Number.NaN;
    pw[k] = { sdMs: q(sds, 0.5), iqrMs: q(perFile.map((x) => x[k]?.iqrMs).filter(Number.isFinite), 0.5), n: perFile.length, betweenSd };
  }
  console.log(`beats ${all.length} across ${byFile.length} files · fs ${fsSeen.toFixed(2)} Hz · one sample = ${(1000 / fsSeen).toFixed(2)} ms`);
  console.log(`\nCLOCK-FREE beat-to-beat SD (ms), WITHIN file, median across ${perFile.length} files:`);
  const rows = Object.entries(pw).sort((a, b) => a[1].sdMs - b[1].sdMs);
  for (const [k, v] of rows)
    console.log(
      `   ${k.padEnd(22)} within-SD ${v.sdMs.toFixed(2).padStart(7)}  IQR ${v.iqrMs.toFixed(2).padStart(7)}  between-file SD ${Number.isFinite(v.betweenSd) ? v.betweenSd.toFixed(2).padStart(7) : '      -'}   ${band(v.sdMs)}`
    );
  console.log(`\nTCH decomposition (independence NOT assumed — see header; negatives are refusals):`);
  for (const [A, B, C] of [
    ['tangent', 'pct25', 'pct50'],
    ['min', 'tangent', 'pct50'],
    ['maxSlope', 'pct50', 'pct75']
  ]) {
    const t = tchTriple(pw, A, B, C);
    if (!t) continue;
    if (!t.ok) {
      console.log(`   ${A}/${B}/${C}: REFUSED — negative variance for ${t.negative.join(', ')}`);
      continue;
    }
    console.log(
      `   ${A}/${B}/${C}: ` +
        Object.entries(t.v)
          .map(([k, x]) => `${k} ${Math.sqrt(x).toFixed(2)} ms`)
          .join(' · ')
    );
  }
}

if (process.argv[1]?.endsWith('pat-fiducial-jitter.mjs')) await main();
