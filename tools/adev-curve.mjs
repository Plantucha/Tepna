#!/usr/bin/env node
/*
 * tools/adev-curve.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * READ THE ADEV CURVE A NODE EXPORT NOW CARRIES — the consumer residue
 * `2026-09-21-adev-curve-not-exported-by-either-node` said the curve was owed before it was published:
 * "an export-shape change on two nodes, so it is owed a CONSUMER first (nothing reads a curve today)".
 * This is that consumer, and it does the one thing the scalars cannot:
 *
 *   1 · RE-DERIVES the published slope from the published curve. `slope` is a log-log least-squares
 *       fit over exactly these points, so a reader can check it rather than trust it — and a curve
 *       that does not reproduce its own slope is a defect in whichever of the two is wrong. This is
 *       the criterion (pre-stated): |refit − published| ≤ 1.96 · published slopeSE.
 *   2 · Looks for a KNEE — the shape that makes a single slope unreadable. Fit the first half and the
 *       second half of the ladder separately; if they differ by more than the two SEs allow, the
 *       night has two mechanisms and the headline slope describes neither (CLAUDE.md §7: the slope
 *       names the mechanism — τ⁻¹ jitter · τ⁻¹ᐟ² · τ⁰ a floor · τ⁺¹ᐟ² wander · τ⁺¹ drift).
 *   3 · Prints the ladder, so the floor is visible where `optimalTauSec` alone only asserts it.
 *
 * A KNEE IS NOT A FAILURE — it is a finding, and the verdict says so: `SHORTFALL` (the headline slope
 * held its own fit while a named sub-population — one half of the ladder — did not), never FAIL.
 * FAIL is reserved for a curve that cannot reproduce its own published slope.
 *
 *   node tools/adev-curve.mjs <export.json> [<export.json> …] [--json]
 *   node tools/adev-curve.mjs --selftest | --verdict-sample
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';

/* Log-log OLS with the SE, mirroring clock.js `_ckAllanSlope` / ppgdex `allanSlopeFit`: only points
   with adev > 0 and tau > 0 are fitted (an exactly-flat τ has no log), and three is the minimum —
   two points fit any line and cannot be checked. */
export function fitSlope(points) {
  const pts = (points || []).filter((p) => p && p.adevPpm > 0 && p.tauSec > 0);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => Math.log(p.tauSec));
  const ys = pts.map((p) => Math.log(p.adevPpm));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  /* The SE is a LOWER bound and that is not a rounding caveat: overlapping ADEV points are correlated
     while OLS assumes independence (clock.js says the same where it fits). Do not tighten 1.96 to 1. */
  const se = n > 2 ? Math.sqrt(ss / (n - 2) / sxx) : null;
  return { slope, se, nTau: n };
}

/* Every stability object an export carries, with its path — PpgDex publishes one under
   `validation.stability`, ECGDex one under `recording.hostAxis.stability`. A reader must not have to
   know which node it is holding. */
export function stabilitiesIn(exp) {
  const out = [];
  const v = exp && exp.validation && exp.validation.stability;
  if (v) out.push({ where: 'validation.stability', st: v });
  const h = exp && exp.recording && exp.recording.hostAxis && exp.recording.hostAxis.stability;
  if (h) out.push({ where: 'recording.hostAxis.stability', st: h });
  return out;
}

/* The per-stability reading. `knee` is null when the ladder is too short to split (each half needs
   three fittable points) — absent, never a fabricated "no knee". */
export function readCurve(st) {
  const curve = Array.isArray(st && st.curve) ? st.curve : [];
  const refit = fitSlope(curve);
  const published = st && Number.isFinite(st.slope) ? st.slope : null;
  const se = st && Number.isFinite(st.slopeSE) ? st.slopeSE : null;
  const reproduces = refit && published != null && se != null ? Math.abs(refit.slope - published) <= 1.96 * se : refit && published != null ? Math.abs(refit.slope - published) <= 0.05 : null;
  let knee = null;
  if (curve.length >= 6) {
    const mid = Math.floor(curve.length / 2);
    const a = fitSlope(curve.slice(0, mid + 1));
    const b = fitSlope(curve.slice(mid));
    if (a && b && a.se != null && b.se != null) {
      const gap = Math.abs(a.slope - b.slope);
      const tol = 1.96 * Math.sqrt(a.se ** 2 + b.se ** 2);
      knee = { atTauSec: curve[mid].tauSec, slopeBefore: a.slope, slopeAfter: b.slope, gap, tol, split: gap > tol };
    }
  }
  const floorI = curve.length ? curve.reduce((bi, p, i) => (p.adevPpm < curve[bi].adevPpm ? i : bi), 0) : -1;
  return {
    points: curve.length,
    refitSlope: refit ? refit.slope : null,
    refitSE: refit ? refit.se : null,
    publishedSlope: published,
    publishedSE: se,
    reproduces,
    knee,
    floorTauSec: floorI >= 0 ? curve[floorI].tauSec : null,
    floorAdevPpm: floorI >= 0 ? curve[floorI].adevPpm : null,
    tauMaxSec: curve.length ? curve[curve.length - 1].tauSec : null
  };
}

export function verdictObject(readings, { files = [], commit, commitReason, at } = {}) {
  const criterion = {
    name: 'curves_not_reproducing_their_slope (the published slope must be the log-log fit over the published curve, within 1.96·slopeSE; a KNEE is a SHORTFALL, not a failure)',
    threshold: 0,
    unit: 'curves',
    direction: 'eq'
  };
  const base = { gate: 'adev-curve', criterion, evidence: files.slice(), tool: 'tools/adev-curve.mjs', commit, commitReason, at };
  const withCurve = readings.filter((r) => r.points >= 3);
  const bad = withCurve.filter((r) => r.reproduces === false);
  const knees = withCurve.filter((r) => r.knee && r.knee.split);
  const population = { checked: withCurve.length, eligible: readings.length, excluded: readings.length - withCurve.length };
  const result = { curves: readings.length, checked: withCurve.length, notReproducing: bad.length, knees: knees.length, readings };
  if (!withCurve.length) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population,
      result: null,
      reason: readings.length
        ? `${readings.length} stability object(s) carry no curve of 3+ points — nothing to re-derive (an export from before the curve was published?)`
        : 'no stability object in the input'
    });
  }
  if (bad.length) {
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `${bad.length} of ${withCurve.length} curve(s) do not reproduce their published slope: ${bad.map((r) => `published ${r.publishedSlope.toFixed(3)} ± ${r.publishedSE == null ? '?' : r.publishedSE.toFixed(3)} vs refit ${r.refitSlope.toFixed(3)}`).join('; ')}`
    });
  }
  if (knees.length) {
    return makeVerdict({
      ...base,
      status: 'SHORTFALL',
      population,
      result,
      reason: `${knees.length} of ${withCurve.length} curve(s) have a KNEE — the headline slope describes neither side: ${knees.map((r) => `at τ=${r.knee.atTauSec}s, ${r.knee.slopeBefore.toFixed(2)} → ${r.knee.slopeAfter.toFixed(2)} (gap ${r.knee.gap.toFixed(2)} > ${r.knee.tol.toFixed(2)})`).join('; ')}`
    });
  }
  return makeVerdict({ ...base, status: 'PASS', population, result, reason: null });
}

export function verdictSample() {
  /* A pure-jitter ladder (τ⁻¹) with its own fit as the published slope — no export read, no code
     identity claimed. */
  const curve = [1, 2, 4, 8, 16, 32, 64].map((tau, i) => ({ tauSec: tau, adevPpm: 6000 / tau, n: 600 - i * 2 }));
  const f = fitSlope(curve);
  const st = { slope: f.slope, slopeSE: f.se, curve };
  return verdictObject([readCurve(st)], {
    files: ['(scratch ladder)'],
    commit: null,
    commitReason: '--verdict-sample: a scratch τ⁻¹ ladder, no export read, no code identity claimed',
    at: '2026-09-22T00:00:00Z'
  });
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { files: ['(planted ladder)'], commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const ladder = (f, k = 7) => Array.from({ length: k }, (_, i) => ({ tauSec: 2 ** i, adevPpm: f(2 ** i), n: 600 - i }));
  /* 1 · a clean τ⁻¹ ladder re-derives its own slope */
  const c1 = ladder((t) => 6000 / t);
  const f1 = fitSlope(c1);
  eq(Math.abs(f1.slope + 1) < 1e-9, true, 'fitSlope reads a τ⁻¹ ladder as slope −1');
  const r1 = readCurve({ slope: f1.slope, slopeSE: f1.se, curve: c1 });
  eq(r1.reproduces, true, 'a curve reproduces the slope published beside it');
  eq(verdictObject([r1], AT).status, 'PASS', 'PASS: the published slope is the fit over the published curve');
  /* 2 · a WRONG published slope is caught — the whole point of publishing the curve */
  const bad = readCurve({ slope: -0.2, slopeSE: 0.01, curve: c1 });
  eq(bad.reproduces, false, 'a published slope the curve does not support fails to reproduce');
  const vb = verdictObject([bad], AT);
  eq(vb.status === 'FAIL' && /published -0\.200 ± 0\.010 vs refit -1\.000/.test(vb.reason), true, 'FAIL names both numbers');
  /* 3 · a KNEE is a SHORTFALL, not a failure — and it is the shape a scalar cannot show */
  const knee = [1, 2, 4, 8, 16, 32, 64].map((t, i) => ({ tauSec: t, adevPpm: t <= 8 ? 6000 / t : 750 * (t / 8) ** 0.5, n: 600 - i }));
  const fk = fitSlope(knee);
  const rk = readCurve({ slope: fk.slope, slopeSE: fk.se, curve: knee });
  eq(rk.knee.split, true, 'the two halves of a kneed ladder do not share a slope');
  const vk = verdictObject([rk], AT);
  eq(vk.status === 'SHORTFALL' && /KNEE/.test(vk.reason), true, 'SHORTFALL: a knee is a finding, never a FAIL');
  eq(/at τ=8s/.test(vk.reason), true, '…and the reason names the τ it breaks at');
  eq(verdictObject([r1], AT).result.knees, 0, 'control: a straight ladder reports no knee');
  /* 4 · the floor is visible where optimalTauSec only asserts it */
  /* τ⁻¹ down to a FLOOR at 400 ppm: 6000·τ⁻¹ until τ=8, then flat — more averaging buys nothing past
     there, which is the fact `optimalTauSec` asserts and only the curve can show. */
  const floored = [1, 2, 4, 8, 16, 32].map((t, i) => ({ tauSec: t, adevPpm: Math.max(400, 6000 / t), n: 600 - i }));
  eq(readCurve({ slope: -1, slopeSE: 0.5, curve: floored }).floorTauSec, 16, 'the floor τ is read off the curve, not taken on trust');
  eq(readCurve({ slope: -1, slopeSE: 0.5, curve: floored }).floorAdevPpm, 400, '…with the floor value beside it');
  /* 5 · absence is NOT a pass */
  eq(verdictObject([readCurve({ slope: -1, slopeSE: 0.1, curve: [] })], AT).status, 'NOT_RUN', 'NOT_RUN: a stability object with no curve (a pre-2026-09-22 export)');
  eq(verdictObject([], AT).status, 'NOT_RUN', 'NOT_RUN: no stability object at all');
  eq(readCurve({ slope: -1, slopeSE: 0.1, curve: c1.slice(0, 2) }).refitSlope, null, 'two points fit any line and are refused');
  /* 6 · both node shapes are found */
  eq(stabilitiesIn({ validation: { stability: { slope: -1 } } })[0].where, 'validation.stability', 'PpgDex shape found');
  eq(stabilitiesIn({ recording: { hostAxis: { stability: { slope: -1 } } } })[0].where, 'recording.hostAxis.stability', 'ECGDex shape found');
  eq(stabilitiesIn({}).length, 0, 'an export with no stability yields none');
  eq(verdictSample().status, 'PASS', 'the scratch ladder sample is a PASS');
  eq(verdictSample().producedBy.commit, null, 'the sample claims no code identity');
  console.log(`all ${n} selftests passed`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) return console.log(JSON.stringify(verdictSample()));
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));
  const out = json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  if (!files.length) {
    console.error('usage: node tools/adev-curve.mjs <export.json> [<export.json> …] [--json] | --verdict-sample | --selftest');
    process.exit(2);
  }
  const readings = [];
  for (const f of files) {
    let exp;
    try {
      exp = JSON.parse(readFileSync(f, 'utf8'));
    } catch (e) {
      out(`  ✗ ${f}: ${String(e.message).slice(0, 80)}`);
      continue;
    }
    for (const { where, st } of stabilitiesIn(exp)) {
      const r = readCurve(st);
      readings.push(r);
      out(`\n▸ ${f}  ${where}   ${r.points} τ points`);
      if (!r.points) {
        out('   (no curve — an export from before 2026-09-22?)');
        continue;
      }
      out(
        `   published slope ${r.publishedSlope == null ? '—' : r.publishedSlope.toFixed(3)} ± ${r.publishedSE == null ? '—' : r.publishedSE.toFixed(3)}   refit ${r.refitSlope == null ? '—' : r.refitSlope.toFixed(3)}   ${r.reproduces === false ? 'DOES NOT REPRODUCE' : 'reproduces'}`
      );
      out(`   floor σ_y ${r.floorAdevPpm == null ? '—' : r.floorAdevPpm.toPrecision(4)} ppm at τ=${r.floorTauSec}s   ·   ladder to τ=${r.tauMaxSec}s`);
      if (r.knee)
        out(
          `   knee at τ=${r.knee.atTauSec}s: ${r.knee.slopeBefore.toFixed(2)} → ${r.knee.slopeAfter.toFixed(2)}  (gap ${r.knee.gap.toFixed(2)} vs tol ${r.knee.tol.toFixed(2)})${r.knee.split ? '  ⇒ TWO MECHANISMS' : ''}`
        );
      for (const p of Array.isArray(readCurveRaw(st)) ? readCurveRaw(st) : []) out(`     τ ${String(p.tauSec).padStart(7)} s   σ_y ${p.adevPpm.toPrecision(5).padStart(11)} ppm   n ${p.n}`);
    }
  }
  const v = verdictObject(readings, { files });
  if (json) console.log(JSON.stringify(v));
  else out(`\n  tepna.verdict/1: ${v.status}  ·  ${v.population.checked} checked / ${v.population.eligible} eligible${v.reason ? '  — ' + v.reason : ''}`);
}
const readCurveRaw = (st) => (Array.isArray(st && st.curve) ? st.curve : []);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
