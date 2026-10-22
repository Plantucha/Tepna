#!/usr/bin/env node
/*
 * tools/tch-degeneracy-d7.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ══════════════════════════════════════════════════════════════════════════
 * D7 · WHY THE FUSED THREE-CORNERED HAT GOES NEGATIVE, measured three ways.
 *
 * `briefs/TCH-FUSED-DEGENERACY-MECHANISM-2026-10-12-BRIEF.md` §4 pre-states three criteria and
 * this tool runs exactly those three, emitting one `tepna.verdict/1` each. The criteria are
 * quoted from the brief BEFORE any of them ran on these nights; nothing here derives a threshold
 * from the data it judges.
 *
 *   M1 · WHICH CORNER.  `negVar.{h10,verity,o2}` per fused-negative night.
 *        Criterion: ≥ 9 of the 12 negatives on the O2Ring corner upholds §2's asymmetry
 *        prediction; a spread across corners refutes it as the SOLE mechanism. The brief's
 *        9/12 is carried here as the SHARE 0.75, because the corpus has grown since the
 *        2026-09-16 run (118 nights then) and an absolute count cannot bind a different
 *        population. 0.75 is the brief's own ratio, not a number fitted to this run.
 *
 *   M2 · ONE COMMON WEIGHT.  Criterion: 0 negative nights means the mechanism is the per-pair
 *        measure asymmetry and §5's option C becomes available; any negatives remaining means a
 *        second mechanism (correlated errors, M3) is also live.
 *
 *        THE VARIANT IS THE PRODUCTION ESTIMATOR, NOT A SECOND IMPLEMENTATION. `tchSigmasFused`
 *        builds w_HV = t·cH·cV, w_HO = t·cH·cO, w_VO = t·cV·cO. Passing the SAME g to all three
 *        corners gives w = t·g² on every pair, so g = √(cH·cV·cO) yields exactly the brief's
 *        single vector w = t·h·v·o on all three pairwise variances. One call, no new estimator,
 *        and the consensus trust t is computed by the same code as the fused column.
 *
 *   M3 · CORRELATED SOLVE.  The pairwise-ρ hat (`integrator-tch.js correlated`) on the nights M2
 *        leaves negative. Criterion: three positive σ on EVERY remaining night means the residue
 *        is correlation, not weighting.
 *
 *        Its three inputs come from inverting the half-sum identity rather than re-deriving the
 *        variances: with σ²_H = ½(V_HV + V_HO − V_VO) and its two siblings, V_HV = σ²_H + σ²_V,
 *        V_HO = σ²_H + σ²_O, V_VO = σ²_V + σ²_O — exact, and signed, so a negative corner carries
 *        through instead of being clipped.
 *
 * ⚠️ THE `hasConf` CAVEAT (§3). A night carrying no per-beat `conf` falls back to c = 1, so its
 * fused column IS the unweighted hat wearing the fused label. That cannot manufacture a DIFFERENCE
 * between the columns — such a night contributes to both identically — so the negative COUNTS are
 * safe. It does bar quoting a σ from those nights, which this tool never does: it reports corners
 * and counts, and prints the `hasConf` split beside them so a reader can check.
 *
 * Read-only. No DSP change, no fixture, no write.
 *
 * usage:
 *   node tools/tch-degeneracy-d7.mjs --dir uploads/trio
 *   node tools/tch-degeneracy-d7.mjs --dir uploads/trio --json
 *   node tools/tch-degeneracy-d7.mjs --verdict-sample
 *   node tools/tch-degeneracy-d7.mjs --selftest        # planted truth: the inversion, the constant-weight identity
 */
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { nightSeries } from './tch-fused-corpus.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { populationVerdict, producedByOf, snapshotNights } from './corpus-scope.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AS = require(join(ROOT, 'analysis-stats.js'));
const TCH = require(join(ROOT, 'integrator-tch.js'));
const V = require(join(ROOT, 'verdict.js'));

const TOOL = 'tools/tch-degeneracy-d7.mjs';
const BRIEF = 'briefs/TCH-FUSED-DEGENERACY-MECHANISM-2026-10-12-BRIEF.md';
/* §4's 9-of-12, carried as the share it is. Pre-stated in the brief, not fitted here. */
const O2_SHARE_FLOOR = 0.75;

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/* Signed σ² per corner from one `tchSigmasFused` result: the positive corners come back as σ,
   the non-positive ones only as `negVar`. Both are needed, and clipping either loses M3's input. */
function signedVars(r) {
  const one = (sig, nv) => (sig != null ? sig * sig : nv);
  return { a: one(r.h10, r.negVar.h10), b: one(r.verity, r.negVar.verity), c: one(r.o2, r.negVar.o2) };
}

/* The three pairwise difference variances the hat was solved FROM, recovered by inverting the
   half-sum identity. Exact for any signed triple. */
function pairVarsFromSigned(s) {
  return { Vab: s.a + s.b, Vac: s.a + s.c, Vbc: s.b + s.c };
}

const NEG_CORNERS = (r) => ['h10', 'verity', 'o2'].filter((k) => r.negVar[k] != null);

/* `tepna.verdict/1` requires `result: null` on NOT_RUN and NOT_APPLICABLE — nothing was measured, so
   nothing may be reported. The counts that justify the status live in `population` and `reason`. */
/* P(X ≥ k | n, 1/3) — the SAME uniform-⅓ null `TRIO-ARTIFACT-GATE-AND-N15-POWER` §6.2 used to refuse a
   corner attribution at n = 8 (it got P = 0.088 for OxyDex 5 of 8 and called it "not a finding"). Kept
   as a DIAGNOSTIC beside M1's pre-stated criterion, not as the criterion, and reported for the leading
   corner both uncorrected and times three — three corners were available and the leader was chosen
   after looking. */
export function upperTailUniformThird(k, n) {
  if (!(n > 0) || k > n) return null;
  const p = 1 / 3;
  let lc = 0; // log C(n, i), stepped so a large n never overflows a factorial
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) lc += Math.log(n - i + 1) - Math.log(i);
    if (i >= k) tail += Math.exp(lc + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return tail;
}

const resultFor = (status, result) => (status === 'NOT_RUN' || status === 'NOT_APPLICABLE' ? null : result);

/* One night, three solves: the fused column, the unweighted control, and M2's common weight.
   Series are read, reduced to scalars, and dropped — nothing accumulates per night. */
export function measureNight(dir, night) {
  const S = nightSeries(dir, night);
  if (S.skip) return { night, skip: S.skip };
  const { hh, vv, oo, cH, cV, cO, one, ks } = S;
  const g = cH.map((h, i) => Math.sqrt(h * cV[i] * cO[i])); // √(cH·cV·cO) ⇒ w = t·cH·cV·cO on all three pairs
  const fused = AS.tchSigmasFused(hh, vv, oo, cH, cV, cO);
  const plain = AS.tchSigmasFused(hh, vv, oo, one, one, one);
  const common = AS.tchSigmasFused(hh, vv, oo, g, g, g);
  const row = {
    night,
    n: ks.length,
    hasConf: S.hasConf,
    fused: { neg: fused.neg, corners: NEG_CORNERS(fused), negVar: fused.negVar },
    plain: { neg: plain.neg, corners: NEG_CORNERS(plain) },
    common: { neg: common.neg, corners: NEG_CORNERS(common), negVar: common.negVar }
  };
  /* DIAGNOSTIC, not a criterion. §2 derives the asymmetry from w_HV carrying a product of TWO
     sub-unit confidences while w_HO and w_VO carry one each, so each pair's variance is estimated
     over a different subset of beats. Both solves are in hand, so invert each back to its three
     pairwise variances and record what the common weight actually moves.

     ⚠️ AND IT MOVES ONLY TWO OF THE THREE, on this corpus, by construction: `tch-fused-corpus.mjs`
     pins cO = 1, so g² = cH·cV·cO = cH·cV = w_HV / t. The common weight IS the HV pair's weight here,
     V_HV is unchanged to floating point, and M2 re-estimates V_HO and V_VO under the HV measure. That
     is worth knowing before reading M2's result as "weights off". */
  const pvF = pairVarsFromSigned(signedVars(fused));
  const pvC = pairVarsFromSigned(signedVars(common));
  row.pairs = { fused: { hv: pvF.Vab, ho: pvF.Vac, vo: pvF.Vbc }, common: { hv: pvC.Vab, ho: pvC.Vac, vo: pvC.Vbc } };
  if (common.neg) {
    const sol = TCH.correlated(pvC.Vab, pvC.Vac, pvC.Vbc);
    row.m3 = sol
      ? { ok: sol.a > 0 && sol.b > 0 && sol.c > 0, minRho: sol.rho, h10: Math.sqrt(sol.a), verity: Math.sqrt(sol.b), o2: Math.sqrt(sol.c) }
      : { ok: false, minRho: null, reason: 'no ρ in [0, 0.95] gives three non-negative σ²' };
  }
  return row;
}

export function run(dir) {
  /* ONE walk, and the walk is the population: the night list comes out of the snapshot, so the
     verdict below describes the set this run actually scored
     (RESIDUE 2026-10-21-forty-one-corpus-enumerators-report-no-population). */
  const popBefore = snapshotNights(dir);
  const rows = popBefore.nights.map((n) => measureNight(dir, n));
  const population = populationVerdict(popBefore, snapshotNights(dir), { tool: TOOL, evidence: [TOOL] });
  return { dir, rows, nights: popBefore.nights.length, population };
}

export function verdicts(res, commit, commitReason = null) {
  const solved = res.rows.filter((r) => !r.skip);
  const skipped = res.rows.length - solved.length;
  const fusedNeg = solved.filter((r) => r.fused.neg);
  const commonNeg = solved.filter((r) => r.common.neg);
  /* THE REASON FOR AN ABSENT IDENTITY IS MEASURED, NOT BORROWED. This asserted `not read from a
     git tree` for every caller that named no commit, which was false of the CLI path and of the
     sample alike. The shared resolver reads the tree, and a caller that must disclaim identity —
     the fabricated sample below — states its own reason. */
  const producedBy = producedByOf(TOOL, commit, commitReason);
  const evidence = [TOOL, 'tools/tch-fused-corpus.mjs', 'analysis-stats.js', BRIEF];
  const out = [];

  /* ── M1 ── which corner carries the negatives */
  const corner = { h10: 0, verity: 0, o2: 0 };
  for (const r of fusedNeg) for (const k of r.fused.corners) corner[k]++;
  const cornerTotal = corner.h10 + corner.verity + corner.o2;
  const o2Share = cornerTotal ? corner.o2 / cornerTotal : null;
  const NAMES = { h10: 'Polar H10 (ECGDex)', verity: 'Verity (PpgDex)', o2: 'O2Ring (OxyDex)' };
  const dominant = ['h10', 'verity', 'o2'].sort((a, b) => corner[b] - corner[a])[0];
  const dominantShare = cornerTotal ? corner[dominant] / cornerTotal : null;
  const withPairs = solved.filter((r) => r.pairs);
  const relShift = (k) => withPairs.map((r) => (r.pairs.fused[k] ? (r.pairs.common[k] - r.pairs.fused[k]) / Math.abs(r.pairs.fused[k]) : null)).filter((x) => x != null);
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);
  const maxAbs = (a) => (a.length ? a.reduce((m, x) => Math.max(m, Math.abs(x)), 0) : null);
  const m1Status = fusedNeg.length === 0 ? 'NOT_APPLICABLE' : o2Share >= O2_SHARE_FLOOR ? 'PASS' : 'FAIL';
  out.push(
    V.make({
      gate: 'tch-degeneracy-d7-m1',
      status: m1Status,
      population: { checked: fusedNeg.length, eligible: solved.length, excluded: solved.length - fusedNeg.length },
      criterion: { name: 'o2_corner_share_of_negative_corners', threshold: O2_SHARE_FLOOR, unit: 'share', direction: 'gte' },
      result: resultFor(m1Status, {
        negativeNights: fusedNeg.length,
        solvedNights: solved.length,
        skippedNights: skipped,
        negativeCornerCounts: corner,
        o2Share,
        nights: fusedNeg.map((r) => ({ night: r.night, corners: r.fused.corners, hasConf: r.hasConf })),
        hasConfAmongNegatives: fusedNeg.filter((r) => r.hasConf).length,
        unweightedNegativeNights: solved.filter((r) => r.plain.neg).length,
        unweightedNegativeCorners: solved.filter((r) => r.plain.neg).map((r) => ({ night: r.night, corners: r.plain.corners })),
        /* diagnostic, outside the criterion — what the common weight moves, per pair. The HV row is
           the control: cO = 1 makes the common weight identical to w_HV, so a non-zero median there
           would mean the inversion or the weighting is not doing what this tool says. */
        diagnosticMedianRelShiftVhv: med(relShift('hv')),
        diagnosticMaxAbsRelShiftVhv: maxAbs(relShift('hv')),
        diagnosticMedianRelShiftVho: med(relShift('ho')),
        diagnosticMedianRelShiftVvo: med(relShift('vo')),
        /* diagnostic, outside the criterion — the §6.2 null, applied to the leading corner */
        diagnosticLeadingCorner: dominant,
        diagnosticLeadingCornerShare: dominantShare,
        diagnosticUniformThirdP: upperTailUniformThird(corner[dominant], cornerTotal),
        diagnosticUniformThirdPTimesThree: cornerTotal ? Math.min(1, 3 * upperTailUniformThird(corner[dominant], cornerTotal)) : null
      }),
      evidence,
      reason:
        fusedNeg.length === 0
          ? 'no fused-negative night in this corpus, so there is no corner distribution to test'
          : o2Share >= O2_SHARE_FLOOR
            ? null
            : dominantShare >= O2_SHARE_FLOOR
              ? `the negatives concentrate on ONE corner and it is not the O2Ring: ${corner[dominant]} of ${cornerTotal} negative corners are ${NAMES[dominant]} (h10 ${corner.h10} · verity ${corner.verity} · o2 ${corner.o2}). §2's prediction that the O2Ring corner is the exposed one is refuted by name; the asymmetry is real and points at the other end of the down-weighted pair`
              : `the negatives spread across corners (h10 ${corner.h10} · verity ${corner.verity} · o2 ${corner.o2}); §2's asymmetry is not the sole mechanism`,
      producedBy
    })
  );

  /* ── M2 ── one common weight */
  const m2Status = solved.length === 0 ? 'NOT_RUN' : commonNeg.length === 0 ? 'PASS' : 'FAIL';
  out.push(
    V.make({
      gate: 'tch-degeneracy-d7-m2',
      status: m2Status,
      population: { checked: solved.length, eligible: solved.length, excluded: 0 },
      criterion: { name: 'negative_nights_under_one_common_weight', threshold: 0, unit: 'nights', direction: 'lte' },
      result: resultFor(m2Status, {
        commonNegativeNights: commonNeg.length,
        fusedNegativeNights: fusedNeg.length,
        solvedNights: solved.length,
        skippedNights: skipped,
        nights: commonNeg.map((r) => ({ night: r.night, corners: r.common.corners, hasConf: r.hasConf })),
        weight: 'w = t · cH · cV · cO on all three pairwise variances, via g = sqrt(cH·cV·cO)'
      }),
      evidence,
      reason:
        solved.length === 0
          ? 'no night solved, so the common weight was never applied'
          : commonNeg.length === 0
            ? null
            : `${commonNeg.length} night(s) stay negative under one common weight, so a second mechanism is live`,
      producedBy
    })
  );

  /* ── M3 ── correlated solve on what M2 leaves negative */
  const conv = commonNeg.filter((r) => r.m3 && r.m3.ok);
  const m3Status = commonNeg.length === 0 ? 'NOT_APPLICABLE' : conv.length === commonNeg.length ? 'PASS' : 'FAIL';
  out.push(
    V.make({
      gate: 'tch-degeneracy-d7-m3',
      status: m3Status,
      population: { checked: commonNeg.length, eligible: commonNeg.length, excluded: 0 },
      criterion: { name: 'nights_with_three_positive_sigma_under_pairwise_rho', threshold: 1, unit: 'share', direction: 'gte' },
      result: resultFor(m3Status, {
        remainingNegativeNights: commonNeg.length,
        converged: conv.length,
        /* `correlated` sweeps ρ upward and stops at the FIRST value admitting a non-negative solution,
           so `minRho` is a lower bound on the common-mode correlation, never an estimate of it — ρ is
           not identifiable reference-free (CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14 §1). At that
           first ρ the smallest corner sits AT the boundary by construction, so a near-zero σ in the
           triple below is the search stopping, not a sensor measured as perfect. */
        minRhoIsALowerBound: true,
        nights: commonNeg.map((r) => ({ night: r.night, ...(r.m3 || { ok: false, reason: 'no solve attempted' }) }))
      }),
      evidence: evidence.concat(['integrator-tch.js']),
      reason:
        commonNeg.length === 0
          ? 'M2 left no negative night, so the correlated solve has no population'
          : conv.length === commonNeg.length
            ? null
            : `${commonNeg.length - conv.length} of ${commonNeg.length} night(s) have no ρ in [0, 0.95] giving three positive σ`,
      producedBy
    })
  );

  for (const v of out) {
    /* `validate` returns { ok, errors, checked } — reading it as an array made the check pass on
       everything, which is the shape of defect this toolchain exists to catch. */
    const r = V.validate(v);
    if (!r.ok) throw new Error(`${v.gate} is not a valid tepna.verdict/1: ${r.errors.join(' · ')}`);
  }
  return out;
}

/* A planted triplet with a KNOWN negative corner, so `--verdict-sample` emits a real verdict over
   real arithmetic rather than a hand-written object. The H10 and Verity errors are each other's
   negatives, so V_HV = 4σ²_e exceeds V_HO + V_VO = 2σ²_e + 2σ²_o whenever σ_e > σ_o, and
   σ²_O = ½(V_HO + V_VO − V_HV) comes out below zero. Synthetic by declaration: no corpus is read. */
export function verdictSample() {
  const n = 1200;
  const hh = [];
  const vv = [];
  const oo = [];
  const one = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const truth = 60 + 5 * Math.sin(i / 90);
    const e = 2.5 * rnd();
    hh.push(truth + e);
    vv.push(truth - e);
    oo.push(truth + 0.4 * rnd());
    one.push(1);
  }
  const r = AS.tchSigmasFused(hh, vv, oo, one, one, one);
  const row = {
    night: 'synthetic',
    n,
    hasConf: false,
    fused: { neg: r.neg, corners: NEG_CORNERS(r), negVar: r.negVar },
    plain: { neg: r.neg, corners: NEG_CORNERS(r) },
    common: { neg: r.neg, corners: NEG_CORNERS(r), negVar: r.negVar }
  };
  return verdicts({ dir: '(synthetic)', rows: [row], nights: 1 }, null, '--verdict-sample: one synthetic night, no corpus read, no code identity claimed')[0];
}

/* ── SELFTEST ────────────────────────────────────────────────────────────────────────────────────
   Planted truth only; no corpus is read. The two assertions that matter are the ones a reader cannot
   check by eye: that the half-sum inversion is exact and signed, and that a CONSTANT confidence
   vector through the common-weight path reproduces the unweighted solve — which is what makes M2's
   "one common weight" claim the production estimator rather than a re-implementation. */
function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (cond, what) => {
    if (cond) pass++;
    else {
      fail++;
      console.log(`  ✗ ${what}`);
    }
  };
  const near = (a, b, eps, what) => ok(Math.abs(a - b) < eps, `${what} (${a} vs ${b})`);

  /* 1 · the half-sum inversion is exact on a positive triple */
  const triple = { h10: 2, verity: 3, o2: 4, negVar: { h10: null, verity: null, o2: null } };
  const sv = signedVars(triple);
  near(sv.a, 4, 1e-12, 'signedVars squares a positive σ');
  near(sv.c, 16, 1e-12, 'signedVars squares the third corner');
  const pv = pairVarsFromSigned(sv);
  near(pv.Vab, 13, 1e-12, 'V_HV = σ²_H + σ²_V');
  near(pv.Vac, 20, 1e-12, 'V_HO = σ²_H + σ²_O');
  near(pv.Vbc, 25, 1e-12, 'V_VO = σ²_V + σ²_O');
  near(0.5 * (pv.Vab + pv.Vac - pv.Vbc), 4, 1e-12, 'the half-sum recovers σ²_H from the inverted pairs');
  near(0.5 * (pv.Vab + pv.Vbc - pv.Vac), 9, 1e-12, 'the half-sum recovers σ²_V');
  near(0.5 * (pv.Vac + pv.Vbc - pv.Vab), 16, 1e-12, 'the half-sum recovers σ²_O');

  /* 2 · a negative corner is carried through SIGNED, not clipped */
  const negTriple = { h10: 2, verity: null, o2: 4, negVar: { h10: null, verity: -1.5, o2: null } };
  const nsv = signedVars(negTriple);
  near(nsv.b, -1.5, 1e-12, 'a non-positive corner comes from negVar, signed');
  ok(pairVarsFromSigned(nsv).Vab === 4 - 1.5, 'the inverted pair variance keeps the negative term');
  ok(NEG_CORNERS(negTriple).join() === 'verity', 'NEG_CORNERS names only the non-positive corner');
  ok(NEG_CORNERS(triple).length === 0, 'NEG_CORNERS is empty on a clean solve');

  /* 3 · a CONSTANT confidence vector through the common-weight path ≡ the unweighted solve.
     Normalising by Σw cancels any constant, so the three pairs share one measure — the property M2
     depends on, asserted against the production estimator rather than assumed. */
  const n = 600;
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  const hh = [];
  const vv = [];
  const oo = [];
  const one = [];
  const half = [];
  for (let i = 0; i < n; i++) {
    const truth = 58 + 4 * Math.sin(i / 70);
    hh.push(truth + 0.3 * rnd());
    vv.push(truth + 0.9 * rnd());
    oo.push(truth + 2.2 * rnd());
    one.push(1);
    half.push(0.5);
  }
  const plain = AS.tchSigmasFused(hh, vv, oo, one, one, one);
  const constW = AS.tchSigmasFused(hh, vv, oo, half, half, half);
  ok(plain.h10 != null && plain.verity != null && plain.o2 != null, 'the planted triple solves cleanly unweighted');
  near(constW.h10, plain.h10, 1e-9, 'a constant confidence leaves the H10 corner unchanged');
  near(constW.verity, plain.verity, 1e-9, 'a constant confidence leaves the Verity corner unchanged');
  near(constW.o2, plain.o2, 1e-9, 'a constant confidence leaves the O2Ring corner unchanged');

  /* 3b · the §6.2 null, checked against the number that brief PUBLISHED: OxyDex 5 of 8 → P = 0.088
     (`TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` §6.2). A known answer from the repo's own
     record, so the diagnostic cannot drift away from the standard it claims to apply. */
  near(upperTailUniformThird(5, 8), 0.0879, 5e-4, "the §6.2 null reproduces that brief's published 0.088");
  near(upperTailUniformThird(0, 8), 1, 1e-12, 'the whole mass sits at or above zero successes');
  ok(upperTailUniformThird(9, 8) === null, 'more successes than trials is null, not a number');
  ok(upperTailUniformThird(1, 0) === null, 'zero trials is null, not a number');
  ok(upperTailUniformThird(25, 25) < 1e-11, 'a 25-of-25 sweep is far below any plausible bar');

  /* 4 · the sample verdict is valid, exercises the negative path, and names the corner */
  const sample = verdictSample();
  ok(sample.schema === 'tepna.verdict/1', 'the sample is a tepna.verdict/1');
  const vr = V.validate(sample);
  ok(vr.ok === true, `the sample validates (${vr.errors.join(' · ')})`);
  ok(Array.isArray(vr.checked) && vr.checked.length > 0, 'validate examined something rather than returning an empty report');
  ok(sample.status === 'PASS', `the planted anti-correlated pair drives the O2Ring corner negative (status ${sample.status})`);
  near(sample.result.o2Share, 1, 1e-12, 'the planted negative sits on the O2Ring corner');
  ok(sample.producedBy.commit === null && typeof sample.producedBy.commitReason === 'string', 'a null commit carries a commitReason');

  /* 5 · population arithmetic and the two "examined nothing" statuses */
  const clean = {
    night: 'clean',
    n: 10,
    hasConf: true,
    fused: { neg: false, corners: [], negVar: {} },
    plain: { neg: false, corners: [] },
    common: { neg: false, corners: [], negVar: {} },
    vhv: { fused: 1, common: 1, deflated: false }
  };
  const vs = verdicts({ dir: '(planted)', rows: [clean, { night: 'x', skip: 'no overlap' }], nights: 2 }, 'deadbee');
  ok(vs.length === 3, 'three verdicts, one per measurement');
  for (const v of vs) ok(v.population.checked + v.population.excluded === v.population.eligible, `${v.gate} population closes`);
  ok(vs[0].status === 'NOT_APPLICABLE', `no negative night makes M1 NOT_APPLICABLE (${vs[0].status})`);
  ok(vs[1].status === 'PASS', `no negative under the common weight makes M2 PASS (${vs[1].status})`);
  ok(vs[2].status === 'NOT_APPLICABLE', `an empty M3 population is NOT_APPLICABLE, not PASS (${vs[2].status})`);
  ok(vs[0].result === null, 'NOT_APPLICABLE carries result: null — nothing was measured, so nothing is reported');
  ok(vs[1].result.skippedNights === 1, 'a skipped night is counted as skipped, not solved');
  ok(vs[1].result.solvedNights === 1, 'only the solved night is eligible');
  ok(vs[0].reason !== null && vs[1].reason === null, 'every non-PASS carries a reason and the PASS does not');
  ok(vs[1].producedBy.commit === 'deadbee', 'the commit is stamped when one is given');

  /* The human table reads its own field names; printing `undefined` is invisible to the JSON path. */
  ok(m3Cell(null) === '—', 'a night M3 never reached prints a dash');
  ok(m3Cell({ ok: false, minRho: null }) === 'no ρ', 'a night with no admissible ρ says so');
  ok(m3Cell({ ok: true, minRho: 0.25 }) === 'ok ρ≥0.25', `the ρ cell reads minRho and marks it a bound (${m3Cell({ ok: true, minRho: 0.25 })})`);

  console.log(fail === 0 ? `\n✓ all ${pass} selftests passed` : `\n✗ ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

/* The ρ cell, exported so the selftest asserts the FIELD NAME. Read straight off the object it
   printed `undefined` for a whole corpus run — the JSON path carries the same number under its real
   name, so nothing downstream noticed. `≥` because `correlated` reports the smallest ρ that restores
   non-negativity: a lower bound, never an estimate (§8.1). */
export function m3Cell(m3) {
  if (!m3) return '—';
  if (!m3.ok) return 'no ρ';
  return `ok ρ≥${m3.minRho}`;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 1));
    return;
  }
  const dirI = argv.indexOf('--dir');
  if (dirI < 0 || !argv[dirI + 1]) {
    console.error(`usage: node ${TOOL} --dir <corpus> [--json]   |   ${TOOL} --verdict-sample`);
    process.exit(2);
  }
  const res = run(argv[dirI + 1]);
  const vs = verdicts(res, gitCommit());
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ dir: res.dir, verdicts: vs, population: res.population, rows: res.rows }, null, 2));
    return;
  }
  const solved = res.rows.filter((r) => !r.skip);
  console.log(`\n  D7 · fused-hat degeneracy — ${res.dir}\n`);
  console.log(`  ${solved.length} of ${res.rows.length} night(s) solved · ${solved.filter((r) => r.hasConf).length} carry per-beat conf`);
  console.log(
    `  population: ${res.population.status} — ${res.population.population.checked} night(s) covered of ${res.population.population.eligible}${res.population.reason ? ` · ${res.population.reason}` : ''}\n`
  );
  console.log('  night        n_s   fused        common       ρ-solve');
  console.log('  ' + '─'.repeat(66));
  for (const r of res.rows) {
    if (r.skip) continue;
    if (!r.fused.neg && !r.common.neg) continue;
    const m3 = m3Cell(r.m3);
    console.log(`  ${r.night} ${String(r.n).padStart(6)}   ${(r.fused.corners.join('+') || '—').padEnd(12)} ${(r.common.corners.join('+') || '—').padEnd(12)} ${m3}`);
  }
  console.log('\n  (only nights with a negative corner are listed; the rest solved cleanly)\n');
  for (const v of vs) console.log(JSON.stringify(v));
  console.log('');
}

if (isCliEntry(import.meta.url)) main();
