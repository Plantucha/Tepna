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
import { makeVerdict } from './verdict-emit.mjs';

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
/* Stratum key = NOMINAL rate (nearest Hz). Measured effFs differs by hundredths file to file and each
   of those is one quantum, not a different one; 55.11 and 55.15 Hz are one stratum, 55 and 176 are two. */
export function strataOf(perFile) {
  return [...new Set(perFile.map((x) => String(Math.round(x.fs))))].sort((a, b) => a - b);
}
export function stratum(perFile, key) {
  const members = perFile.filter((x) => String(Math.round(x.fs)) === key);
  return {
    members,
    fsMedian: q(
      members.map((x) => x.fs),
      0.5
    )
  };
}

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
  /* Residue 2026-09-05-fiducial-sd-quoted-without-its-sample-rate: strata are NOMINAL rates, one per
     quantum — hundredths of measured effFs collapse, 55 and 176 do not, and each stratum quotes ITS fs. */
  const pf = [{ fs: 55.11 }, { fs: 55.15 }, { fs: 176.2 }, { fs: 55.14 }, { fs: 176.41 }];
  const st = strataOf(pf);
  ok(st.length === 2 && st[0] === '55' && st[1] === '176', 'strata: 55.11/55.15/55.14 collapse to 55; 176.2/176.41 to 176; sorted numerically');
  const s55 = stratum(pf, '55');
  ok(s55.members.length === 3 && Math.abs(s55.fsMedian - 55.14) < 1e-9, 'stratum 55: three members, median measured fs 55.14');
  ok(stratum(pf, '176').members.length === 2, 'stratum 176: two members');
  ok(stratum(pf, '135').members.length === 0, 'an absent stratum has no members, not a fabricated one');

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

  /* ── the verdict ──────────────────────────────────────────────────────────── */
  const VAT = { at: '2026-09-22T00:00:00Z', commit: null, commitReason: 'selftest' };
  const vStratum = (sd) => [{ fsHz: '100', fsMeasured: 100, quantumMs: 10, files: 3, pairs: [{ pair: 'min|pct50', sdMs: sd, samples: sd / 10, iqrMs: sd, betweenSdMs: null, band: band(sd) }] }];
  const material = pfjVerdict({ filesGiven: 4, filesQualified: 3, beats: 300, strata: vStratum(25), tch: { stratumFsHz: '100', files: 3, triples: [], refused: 0 }, ...VAT });
  ok(material.status === 'PASS' && material.result.strata[0].pairs[0].band === 'MATERIAL', 'verdict: a MATERIAL band is a FINDING in result — status is PASS, never FAIL');
  ok(material.population.eligible === 4 && material.population.checked === 3 && material.population.excluded === 1, 'verdict: population in files, 4 = 3 qualified + 1 excluded');
  const refused = pfjVerdict({
    filesGiven: 3,
    filesQualified: 3,
    beats: 300,
    strata: vStratum(6),
    tch: { stratumFsHz: '100', files: 3, triples: [{ triple: 'a/b/c', ok: false, negative: ['b'], componentsMs: null }], refused: 1 },
    ...VAT
  });
  ok(
    refused.status === 'PASS' && refused.result.tch.refused === 1 && refused.result.tch.triples[0].negative[0] === 'b',
    'verdict: a TCH negative variance is a NAMED refusal in result, never clamped, never a status'
  );
  const none = pfjVerdict({ filesGiven: 5, filesQualified: 0, beats: 7, strata: [], tch: null, ...VAT });
  ok(none.status === 'NOT_RUN' && none.result === null && /0 of 5/.test(none.reason), 'verdict: no qualifying file is NOT_RUN with the counts in the reason');
  ok(
    /reachable from nothing/.test(material.criterion.name) && material.criterion.unit === 'fs strata' && material.criterion.threshold === 1,
    "verdict: the criterion is the tool's own gate (>= 1 stratum) and says FAIL/UNKNOWN are unreachable"
  );
  ok(material.result.strata[0].quantumMs === 10 && material.result.strata[0].pairs[0].samples === 2.5, "verdict: every SD carries its stratum's quantum (row 2026-09-05, fixed #2749)");
  const legs = 15 + 6; // the fixed legs above plus the six verdict legs — COUNTED, not written down
  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${legs - fails.length}/${legs})`);
  return fails.length === 0;
}

/* ── THE VERDICT ─ a MEASUREMENT whose bands are FINDINGS, so the criterion is its own hard gate ────────
   §7 asks "how much uncertainty does the foot introduce?" — a number in ms, not a pass/fail. The
   pre-stated bands (MATERIAL / INTERMEDIATE / NOT-DOMINANT) are what the charter asked to be measured;
   MATERIAL means "the charter's 20–50 ms concern is met", which is a result, not a defect. So the
   status never encodes a band: the per-pair band rides in `result`, PER fs STRATUM, with the sample
   quantum beside every SD (residue 2026-09-05-fiducial-sd-quoted-without-its-sample-rate, fixed
   #2749 — an SD is a number of samples wearing ms and is comparable only within one fs).

   THE CRITERION IS THE TOOL'S OWN HARD GATE, not a new one: at least one fs stratum with a within-file
   SD (a file needs >= 10 usable beats; none qualifying is a refusal). Population in FILES: eligible =
   files given, checked = files with >= 10 beats, excluded = unparseable or too few beats.

   ⚠ A TCH REFUSAL (negative variance) IS A FINDING, NOT AN EXCLUSION. The header says the refusal
   "is itself diagnostic, NOT because independence is believed" — so a refused triple stays in
   `result` with its negative components named and counted, never clamped, and never moves the status.
   FAIL and UNKNOWN are reachable from nothing here, and criterion.name says so. */
export function pfjVerdict({ filesGiven, filesQualified, beats, strata, tch, at, commit, commitReason }) {
  const base = {
    tool: 'tools/pat-fiducial-jitter.mjs',
    gate: 'pat-fiducial-jitter',
    scope: 'internal',
    criterion: {
      name: ">= 1 sample-rate stratum reports a clock-free within-file fiducial SD (a file needs >= 10 usable beats). The tool's own hard gate, NOT a quality bar: the MATERIAL / INTERMEDIATE / NOT-DOMINANT bands are pre-stated FINDINGS the charter asked for and ride in result per stratum with each SD's sample quantum. FAIL and UNKNOWN are reachable from nothing; a TCH negative variance is a named refusal in result, never clamped, never a status",
      direction: 'gte',
      threshold: 1,
      unit: 'fs strata'
    },
    evidence: ['tools/pat-fiducial-jitter.mjs', 'briefs/PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md'],
    at,
    commit,
    commitReason
  };
  const population = { eligible: filesGiven, checked: filesQualified, excluded: filesGiven - filesQualified };
  if (!strata || !strata.length) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { eligible: filesGiven, checked: 0, excluded: filesGiven },
      result: null,
      reason: `no sample-rate stratum could report: ${filesQualified} of ${filesGiven} file(s) had >= 10 usable beats (${beats} beats in total) — refusing to report rather than quote an SD over too few beats`
    });
  }
  return makeVerdict({ ...base, status: 'PASS', population, result: { beats, filesGiven, filesQualified, strata, tch } });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  if (args.includes('--verdict-sample')) {
    /* The PASS shape from an illustrative single stratum. No file is read and no number is claimed. */
    console.log(
      JSON.stringify(
        pfjVerdict({
          filesGiven: 12,
          filesQualified: 10,
          beats: 4200,
          strata: [{ fsHz: '55', fsMeasured: 55.14, quantumMs: 18.14, files: 10, pairs: [{ pair: 'min|pct50', sdMs: 6.1, samples: 0.34, iqrMs: 5.2, betweenSdMs: 3.0, band: 'NOT-DOMINANT' }] }],
          tch: { stratumFsHz: '55', files: 10, triples: [{ triple: 'tangent/pct25/pct50', ok: false, negative: ['pct25'], componentsMs: null }], refused: 1 },
          at: '2026-09-22T00:00:00Z',
          commit: null,
          commitReason: '--verdict-sample: illustrative stratum, no file read'
        }),
        null,
        2
      )
    );
    process.exit(0);
  }
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/pat-fiducial-jitter.mjs --selftest | <ppg-file> [...]');
    process.exit(2);
  }
  const { getDsps } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { PPGDSP } = getDsps();
  const all = [];
  const byFile = [];
  for (const f of files) {
    let rec;
    try {
      rec = PPGDSP.parsePPG(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    if (!rec || !rec.ch) continue;
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
    if (mine.length >= 10) byFile.push({ beats: mine, fs: rec.fs });
  }
  if (all.length < 10) {
    console.error(`only ${all.length} usable beats — refusing to report`);
    console.log(JSON.stringify(pfjVerdict({ filesGiven: files.length, filesQualified: byFile.length, beats: all.length, strata: [], tch: null })));
    process.exit(2);
  }
  /* WITHIN-FILE at THAT FILE'S fs, then median across files — see the pooling warning in the header.
     ⚠️ Residue `2026-09-05-fiducial-sd-quoted-without-its-sample-rate`: this used to convert EVERY
     file with the LAST file's fs (`fsSeen`), so a population mixing 55 Hz and 176 Hz Verity files
     was scaled by one wrong quantum, and the dominance verdict moved with which file happened to be
     read last. A fiducial SD is a number of SAMPLES wearing ms: it is comparable only within one fs,
     so the report is STRATIFIED by fs, each stratum carrying its own quantum beside its SD. */
  const perFile = byFile.map(({ beats, fs }) => ({ fs, pw: pairwiseJitter(beats, fs) })).filter((x) => Object.keys(x.pw).length);
  /* stratum key = NOMINAL rate (nearest Hz): measured effFs differs by hundredths file to file and
     each of those is one quantum, not a different one */
  const strata = strataOf(perFile);
  console.log(`beats ${all.length} across ${byFile.length} files · ${strata.length} sample-rate stratum/strata: ${strata.map((f) => f + ' Hz').join(', ')}`);
  if (strata.length > 1) console.log('⚠️  mixed sample rates — SDs are reported PER STRATUM and must not be compared across them (one sample differs between strata).');
  let pw = {};
  let tchFs = null;
  let tchN = -1;
  const strataOut = [];
  for (const fsKey of strata) {
    const members = perFile.filter((x) => String(Math.round(x.fs)) === fsKey);
    const inStratum = members.map((x) => x.pw);
    const fsNum = q(
      members.map((x) => x.fs),
      0.5
    ); // the stratum's MEDIAN measured fs, for the quantum
    const keys = [...new Set(inStratum.flatMap((x) => Object.keys(x)))];
    const pwS = {};
    for (const k of keys) {
      const sds = inStratum.map((x) => x[k]?.sdMs).filter(Number.isFinite);
      const means = inStratum.map((x) => x[k]?.meanMs).filter(Number.isFinite);
      if (!sds.length) continue;
      const betweenSd = means.length > 1 ? Math.sqrt(variance(means)) : Number.NaN;
      pwS[k] = { sdMs: q(sds, 0.5), iqrMs: q(inStratum.map((x) => x[k]?.iqrMs).filter(Number.isFinite), 0.5), n: inStratum.length, betweenSd };
    }
    console.log(
      `\nfs ≈ ${fsKey} Hz (median measured ${fsNum.toFixed(2)}) · one sample = ${(1000 / fsNum).toFixed(2)} ms · CLOCK-FREE beat-to-beat SD (ms), WITHIN file, median across ${inStratum.length} files:`
    );
    const rows = Object.entries(pwS).sort((a, b) => a[1].sdMs - b[1].sdMs);
    strataOut.push({
      fsHz: fsKey,
      fsMeasured: fsNum,
      quantumMs: 1000 / fsNum,
      files: inStratum.length,
      pairs: rows.map(([k, v]) => ({ pair: k, sdMs: v.sdMs, samples: v.sdMs / (1000 / fsNum), iqrMs: v.iqrMs, betweenSdMs: Number.isFinite(v.betweenSd) ? v.betweenSd : null, band: band(v.sdMs) }))
    });
    for (const [k, v] of rows)
      console.log(
        `   ${k.padEnd(22)} within-SD ${v.sdMs.toFixed(2).padStart(7)} (${(v.sdMs / (1000 / fsNum)).toFixed(2)} samples)  IQR ${v.iqrMs.toFixed(2).padStart(7)}  between-file SD ${Number.isFinite(v.betweenSd) ? v.betweenSd.toFixed(2).padStart(7) : '      -'}   ${band(v.sdMs)} @ ~${fsKey} Hz`
      );
    /* the TCH decomposition below runs on the LARGEST stratum only — a variance split across strata
       would mix two quanta into one number, which is the row's defect one layer up */
    if (inStratum.length > tchN) {
      pw = pwS;
      tchN = inStratum.length;
      tchFs = fsKey;
    }
  }
  if (strata.length > 1) console.log(`\n(TCH below: largest stratum only — fs ${tchFs} Hz, ${tchN} files)`);
  console.log(`\nTCH decomposition (independence NOT assumed — see header; negatives are refusals):`);
  const triples = [];
  for (const [A, B, C] of [
    ['tangent', 'pct25', 'pct50'],
    ['min', 'tangent', 'pct50'],
    ['maxSlope', 'pct50', 'pct75']
  ]) {
    const t = tchTriple(pw, A, B, C);
    if (!t) continue;
    if (!t.ok) {
      console.log(`   ${A}/${B}/${C}: REFUSED — negative variance for ${t.negative.join(', ')}`);
      triples.push({ triple: `${A}/${B}/${C}`, ok: false, negative: t.negative, componentsMs: null });
      continue;
    }
    triples.push({ triple: `${A}/${B}/${C}`, ok: true, negative: [], componentsMs: Object.fromEntries(Object.entries(t.v).map(([k, x]) => [k, Math.sqrt(x)])) });
    console.log(
      `   ${A}/${B}/${C}: ` +
        Object.entries(t.v)
          .map(([k, x]) => `${k} ${Math.sqrt(x).toFixed(2)} ms`)
          .join(' · ')
    );
  }
  console.log(
    JSON.stringify(
      pfjVerdict({
        filesGiven: files.length,
        filesQualified: byFile.length,
        beats: all.length,
        strata: strataOut,
        tch: { stratumFsHz: tchFs, files: tchN, triples, refused: triples.filter((x) => !x.ok).length }
      })
    )
  );
}

if (process.argv[1]?.endsWith('pat-fiducial-jitter.mjs')) await main();
