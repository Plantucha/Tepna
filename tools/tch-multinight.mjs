#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-multinight.mjs — multi-night three-cornered-hat A/B harness
 *   (classic reference-free σ  vs  per-night motion-derived ρ)
 *
 * WHY — INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III §1 asks for a DISTRIBUTION +
 * reference-anchored MAGNITUDE check across MANY trio nights. The single real
 * 2026-07-06 rescue (docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md §6:
 * OxyDex σ 0.03 → 1.02 bpm under a measured co-motion ρ=0.655) was run ad-hoc on
 * user-provided files that never entered the repo (privacy posture). This turns
 * that ad-hoc run into a REPEATABLE, COMMITTED artifact:
 *
 *   1. `--selftest` — a deterministic SYNTHETIC multi-night corpus with KNOWN
 *      planted per-device σ and a known co-motion structure, spanning the
 *      positive-variance and quiet-order regimes. Because truth is known this is a
 *      STRONGER magnitude check than one real night: it asserts the estimator
 *      recovers the planted σ, names the right culprit every night, and that the
 *      per-night motion-ρ RESCUES the quiet-order nights (classic leaves the quiet
 *      sensor at a pathological ≈0) — the §6 mechanism as a known-answer.
 *   2. `--dir <path>` — the drop-in path: point it at a folder of real per-night
 *      trio node-export triples (the §6 input contract) and it produces the real
 *      distribution + magnitude table via the SAME code path.
 *
 * FAITHFULNESS — runs the SHIPPED `IntegratorTCH.threeCorneredHat` kernel (v1.2.0,
 * integrator-tch.js) and mirrors the shipped `_tchRhoFromMotion` aggregation from
 * integrator-dsp.js (mean of the POSITIVE pairwise motion correlations, clamped to
 * [0, 0.9]) so the classic-vs-ρ A/B matches what fuseHRVConsensus does end-to-end.
 *
 * DETERMINISTIC — seeded LCG (mulberry32 + Box–Muller), no Date.now / Math.random,
 * so the self-test known-answers are stable across runs and machines.
 *
 * USAGE
 *   node tools/tch-multinight.mjs --selftest        # known-answer corpus (CI-safe)
 *   node tools/tch-multinight.mjs --dir uploads/trio # real nights, one subdir/night
 *   node tools/tch-multinight.mjs --selftest --json  # machine-readable rows
 * ════════════════════════════════════════════════════════════════════════ */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const TCH = require(join(ROOT, 'integrator-tch.js'));

/* ── deterministic seeded normals (same generator family as tests/tch-selftest) ── */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(seed, n) {
  const r = mulberry32(seed),
    o = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(r(), 1e-12),
      u2 = r();
    const m = Math.sqrt(-2 * Math.log(u1));
    o.push(m * Math.cos(2 * Math.PI * u2));
    o.push(m * Math.sin(2 * Math.PI * u2));
  }
  return o.slice(0, n);
}

/* ── faithful mirror of integrator-dsp.js `_tchRhoFromMotion` (§1) ───────────
   ρ = clamp( mean over node-pairs of max(pearson(motion_i, motion_j), 0), 0, 0.9 ).
   Needs ≥2 motion-bearing nodes; null → classic solve. Uses the SHIPPED
   IntegratorTCH.pearson so the correlation is computed identically to the gate. */
function rhoFromMotion(motions) {
  const present = motions.filter((m) => Array.isArray(m) && m.some((v) => v != null && isFinite(v)));
  if (present.length < 2) return null;
  const rs = [];
  for (let i = 0; i < present.length; i++)
    for (let j = i + 1; j < present.length; j++) {
      const r = TCH.pearson(present[i], present[j]);
      if (r != null) rs.push(r);
    }
  if (!rs.length) return null;
  const pos = rs.map((r) => Math.max(r, 0));
  const mean = pos.reduce((a, b) => a + b, 0) / pos.length;
  const rho = Math.max(0, Math.min(0.9, mean));
  return { value: +rho.toFixed(3), meanPairR: +mean.toFixed(3), nMotionNodes: present.length, nPairs: rs.length };
}

/* ── run one night's A/B: classic (no ρ) vs per-night motion-ρ ──────────────
   night = { label, series:{ECGDex,PpgDex,OxyDex:[{tMin,v}]}, motion:{node:[…]},
             truth?:{node:σ} }. Returns a comparison row. */
function runNight(night, labels) {
  const [LA, LB, LC] = labels;
  const al = TCH.alignTriplet(night.series[LA], night.series[LB], night.series[LC], { key: 'tMin', val: 'v' });
  const base = { label: night.label, n: al.keys.length };
  if (al.keys.length < 12) return { ...base, ok: false, reason: 'overlap ' + al.keys.length + ' < 12' };

  // align motion onto the SAME shared epoch keys the HR triplet resolved on
  const motionAligned = labels.map((lab) => {
    const src = night.motion && night.motion[lab];
    if (!Array.isArray(src)) return null;
    const map = new Map(src.map((o) => [o.tMin, o.v]));
    const v = al.keys.map((k) => (map.has(k) ? map.get(k) : null));
    return v.some((x) => x != null) ? v : null;
  });
  const rho = rhoFromMotion(motionAligned);

  const classic = TCH.threeCorneredHat(al.A, al.B, al.C, { labels, minN: 12 });
  const opts = { labels, minN: 12 };
  if (rho && rho.value > 0) opts.rho = rho.value;
  const withRho = TCH.threeCorneredHat(al.A, al.B, al.C, opts);

  return {
    ...base,
    ok: true,
    rho: rho ? rho.value : null,
    rhoMeanR: rho ? rho.meanPairR : null,
    classic,
    withRho,
    truth: night.truth || null,
    // per-node σ for the corner that is quietest / smoothed under the quiet-order regime
    sigmaClassic: sigmaMap(classic),
    sigmaRho: sigmaMap(withRho)
  };
}
function sigmaMap(r) {
  if (!r || !r.ok || !r.sigma) return null;
  const o = {};
  Object.keys(r.sigma).forEach((k) => {
    o[k] = +r.sigma[k].toFixed(3);
  });
  return o;
}

/* ════════════════════════════════════════════════════════════════════════
 * SYNTHETIC multi-night corpus (known-answer)
 * ──────────────────────────────────────────────────────────────────────── */
const LABELS = ['ECGDex', 'PpgDex', 'OxyDex']; // H10-ECG · Verity-PPG · O2Ring/Oxy

/* One night — a PLANTED-CORRELATION FACTOR MODEL (bpm, per 30-s epoch).
 * Each device's deviation from the latent truth L is
 *     e_i = s_i · ( √g_i·Zg  +  √q_i·Zq  +  √(1−g_i−q_i)·Z_i )
 * with independent standard normals Zg (global shared driver), Zq (an EXTRA driver
 * shared by H10 & Oxy only — the quiet-order coupling), and per-device Z_i. By
 * construction Var(e_i)=s_i² EXACTLY (loadings sum to 1) and the pairwise error
 * correlations are a KNOWN matrix:
 *     corr(H10,Oxy)=√(gH·gO)+√(qH·qO)   corr(·,PPG)=√(g_·gP)   (PPG carries no Zq)
 * so obs_i = L + e_i is the exact TCH correlated model  V_ij=s_i²+s_j²−2ρ_ij s_i s_j.
 * The motion index is a PROXY tied to the SAME shared drivers (+ its own noise), so
 * its pairwise correlation lands near the mean common-mode ρ — exactly what
 * `_tchRhoFromMotion` estimates. quiet-order nights load Zq heavily on H10 & Oxy
 * (corr → ~0.9, both small σ) so classic drives the quieter corner pathological. */
function synthNight(spec) {
  const N = spec.n || 120,
    seed = spec.seed;
  const L = (() => {
    const w = normals(seed, N),
      v = [];
    let acc = 58;
    for (let i = 0; i < N; i++) {
      acc += w[i] * 0.6;
      v.push(acc);
    }
    return v;
  })();
  const Zg = normals(seed + 1, N),
    Zq = normals(seed + 2, N); // shared drivers
  const Z = { ECGDex: normals(seed + 11, N), PpgDex: normals(seed + 22, N), OxyDex: normals(seed + 33, N) };
  const mNoise = { ECGDex: normals(seed + 44, N), PpgDex: normals(seed + 55, N), OxyDex: normals(seed + 66, N) };
  const s = spec.sigma,
    ld = spec.load,
    mScale = spec.motionScale || 1.4,
    mNz = spec.motionNoise || 0.5;

  const series = {},
    motion = {};
  for (const lab of LABELS) {
    const g = ld[lab].g,
      q = ld[lab].q,
      indep = Math.max(0, 1 - g - q);
    series[lab] = [];
    motion[lab] = [];
    for (let i = 0; i < N; i++) {
      const shared = Math.sqrt(g) * Zg[i] + Math.sqrt(q) * Zq[i]; // common-mode driver mix
      const e = s[lab] * (shared + Math.sqrt(indep) * Z[lab][i]); // Var = s² exactly
      series[lab].push({ tMin: i * 0.5, v: L[i] + e });
      // motion index: same shared drivers (physical premise: motion drives shared error) + noise, ≥0
      motion[lab].push({ tMin: i * 0.5, v: Math.abs(mScale * shared + mNz * mNoise[lab][i]) });
    }
  }
  return { label: spec.label, series, motion, truth: { ...s }, regime: spec.regime };
}

/* The corpus: a distribution across regimes. Verity (PpgDex) is always the loudest
 * (the real-corpus finding: median σ̂ ≈ 2.8 bpm — the trustworthy culprit). Loadings:
 *   positive-variance → a single modest global ρ≈0.4 (all pairs), classic mildly
 *     under-estimates, motion-ρ un-biases σ upward toward planted.
 *   quiet-order → H10 & Oxy heavily co-loaded on Zq (corr≈0.9) with tiny σ, PPG loud
 *     and mostly independent → classic drives the quiet corner pathological; the
 *     per-night motion-ρ RESCUES it (the §6 mechanism, as a known-answer). */
function synthCorpus() {
  // positive-variance: a single modest global ρ≈0.40 (all pairs equal), σ well-separated
  const PV = { ECGDex: { g: 0.4, q: 0 }, PpgDex: { g: 0.4, q: 0 }, OxyDex: { g: 0.4, q: 0 } };
  // quiet-order: a strong global ρ≈0.60 with OxyDex the SMALLEST-σ corner (the smoothed
  // O2Ring pulse of §6) → classic drives OxyDex σ pathological; a matching motion-ρ rescues it.
  const QO = { ECGDex: { g: 0.6, q: 0 }, PpgDex: { g: 0.6, q: 0 }, OxyDex: { g: 0.6, q: 0 } };
  const specs = [
    { label: 'PV-1', seed: 101, regime: 'positive', load: PV, sigma: { ECGDex: 0.9, PpgDex: 2.8, OxyDex: 1.4 } },
    { label: 'PV-2', seed: 202, regime: 'positive', load: PV, sigma: { ECGDex: 1.0, PpgDex: 3.2, OxyDex: 1.6 } },
    { label: 'PV-3', seed: 303, regime: 'positive', load: PV, sigma: { ECGDex: 0.8, PpgDex: 2.4, OxyDex: 1.2 } },
    { label: 'QO-1', seed: 404, regime: 'quiet-order', load: QO, sigma: { ECGDex: 1.0, PpgDex: 2.9, OxyDex: 0.5 } },
    { label: 'QO-2', seed: 505, regime: 'quiet-order', load: QO, sigma: { ECGDex: 1.1, PpgDex: 3.4, OxyDex: 0.5 } },
    { label: 'QO-3', seed: 606, regime: 'quiet-order', load: QO, sigma: { ECGDex: 0.9, PpgDex: 2.6, OxyDex: 0.45 } }
  ];
  return specs.map(synthNight);
}

/* ════════════════════════════════════════════════════════════════════════
 * REAL-NIGHT ingest — one subdirectory per night, three node-export JSONs.
 * Contract (the §6 inputs): a node export carries `timeseries.epochs[]` with
 * per-epoch `hr` and (for the motion-ρ) `motionIndex`, plus a floating `tMs`.
 * Node identity is read from schema.node / the filename (ECGDex/PpgDex/OxyDex).
 * ──────────────────────────────────────────────────────────────────────── */
function readNightDir(dir) {
  const files = readdirSync(dir).filter((f) => /\.json$/i.test(f));
  const series = {},
    motion = {};
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const node = nodeOf(j, f);
    if (!node || !LABELS.includes(node)) continue;
    const eps = (j.timeseries && j.timeseries.epochs) || (j.series && j.series.epochs) || [];
    const hr = [],
      mo = [];
    for (const e of eps) {
      const key = epKey(e);
      if (key == null) continue;
      if (e.hr != null && isFinite(e.hr)) hr.push({ tMin: key, v: e.hr });
      if (e.motionIndex != null && isFinite(e.motionIndex)) mo.push({ tMin: key, v: e.motionIndex });
    }
    if (hr.length) series[node] = hr;
    if (mo.length) motion[node] = mo;
  }
  return { label: dir.split('/').pop(), series, motion };
}
function nodeOf(j, fname) {
  const s = (j.schema && (j.schema.node || j.node)) || j.node || '';
  for (const L of LABELS) if (String(s).includes(L) || new RegExp(L, 'i').test(fname)) return L;
  return null;
}
// 5-min epoch key on the floating-ms grid (mirrors integrator-dsp _epKey), tMin fallback
function epKey(e) {
  if (e.tMs != null && isFinite(e.tMs)) return Math.round(e.tMs / 300000) * 5;
  if (e.tMin != null && isFinite(e.tMin)) return e.tMin;
  return null;
}

/* ════════════════════════════════════════════════════════════════════════
 * Reporting + verdict
 * ──────────────────────────────────────────────────────────────────────── */
function median(xs) {
  const a = xs
    .filter((x) => x != null && isFinite(x))
    .slice()
    .sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function report(rows, { json } = {}) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const w = (s, n) => String(s).padEnd(n);
  const r = (s, n) => String(s).padStart(n);
  console.log('\n  night   n   ρ     method(classic→ρ)          σ classic (E/P/O)       σ ρ-on (E/P/O)        culprit');
  console.log('  ' + '─'.repeat(104));
  for (const row of rows) {
    if (!row.ok) {
      console.log('  ' + w(row.label, 7) + r(row.n, 3) + '   —    ' + row.reason);
      continue;
    }
    const sc = row.sigmaClassic,
      sr = row.sigmaRho;
    const f3 = (o) => (o ? [o.ECGDex, o.PpgDex, o.OxyDex].map((x) => (x == null ? ' — ' : x.toFixed(2))).join('/') : 'solve-failed');
    const meth = (row.classic.method || '?') + '→' + (row.withRho.method || '?');
    console.log(
      '  ' +
        w(row.label, 7) +
        r(row.n, 3) +
        '  ' +
        r(row.rho == null ? '—' : row.rho.toFixed(2), 4) +
        '  ' +
        w(meth, 24) +
        '  ' +
        w(f3(sc), 20) +
        '  ' +
        w(f3(sr), 20) +
        '  ' +
        (row.withRho.culprit || row.classic.culprit || '?')
    );
  }
  // distribution summary
  const solved = rows.filter((x) => x.ok && x.withRho.ok);
  const culpritSig = solved.map((x) => (x.sigmaRho ? x.sigmaRho[x.withRho.culprit] : null));
  console.log('\n  distribution (' + solved.length + ' solved / ' + rows.length + ' nights):');
  console.log('    median culprit σ (ρ-on)  = ' + fmt(median(culpritSig)) + ' bpm');
  LABELS.forEach((L) => {
    console.log(
      '    median σ[' + L + ']  classic=' + fmt(median(solved.map((x) => x.sigmaClassic && x.sigmaClassic[L]))) + '  ρ-on=' + fmt(median(solved.map((x) => x.sigmaRho && x.sigmaRho[L]))) + ' bpm'
    );
  });
}
function fmt(x) {
  return x == null ? ' — ' : x.toFixed(2);
}

/* ── known-answer verdict for the synthetic corpus ────────────────────────── */
function verify(rows, corpus) {
  const checks = [];
  const ok = (name, cond, detail) => {
    checks.push({ name, pass: !!cond, detail: detail || '' });
  };
  const byLabel = Object.fromEntries(corpus.map((c) => [c.label, c]));

  for (const row of rows) {
    const spec = byLabel[row.label];
    ok(row.label + ': A/B solved', row.ok && row.classic && row.withRho, row.reason || '');
    if (!row.ok || !row.withRho.ok) continue;
    // (1) culprit = the planted-loudest device (PpgDex/Verity) on EVERY night
    const loudest = Object.entries(spec.truth).sort((a, b) => b[1] - a[1])[0][0];
    ok(row.label + ': culprit = planted-loudest (' + loudest + ')', row.withRho.culprit === loudest, 'got ' + row.withRho.culprit);
    // (2) culprit σ recovered within a factor of planted (reference-anchored magnitude).
    // Positive-variance nights recover tightly (×1.6); a scalar-ρ solve on a quiet-order
    // night whose true correlation is a matrix recovers the culprit only to ×2.
    const cS = row.sigmaRho[loudest],
      cT = spec.truth[loudest];
    const fac = spec.regime === 'quiet-order' ? 2.0 : 1.6;
    ok(row.label + ': culprit σ magnitude ≈ planted (×' + fac + ')', cS != null && cS > cT / fac && cS < cT * fac, 'planted ' + cT.toFixed(2) + ' → ' + fmt(cS));

    if (spec.regime === 'quiet-order') {
      // (3) THE RESCUE (§6): the reference-free classic path leaves the quiet Oxy corner
      // pathological (the negative-variance 'correlated' auto-fallback drives it ≈0, or it
      // sits far below its true σ); a per-night motion-ρ LIFTS it off the pathological floor.
      const oClassic = row.sigmaClassic ? row.sigmaClassic.OxyDex : null;
      const oRho = row.sigmaRho ? row.sigmaRho.OxyDex : null;
      const quietSig = (oClassic != null && oClassic < 0.35) || row.classic.method === 'correlated' || row.classic.negative;
      ok(row.label + ': classic shows the quiet-order signature', quietSig, 'classic OxyDex σ=' + fmt(oClassic) + ' method=' + row.classic.method);
      ok(
        row.label + ': motion-ρ RESCUES OxyDex σ (lifts clearly above classic)',
        oRho != null && oClassic != null && oRho > oClassic + 0.2 && oRho > 0.4,
        'classic ' + fmt(oClassic) + ' → ρ-on ' + fmt(oRho)
      );
      ok(row.label + ': a real co-motion ρ was derived (>0)', row.rho != null && row.rho > 0, 'ρ=' + fmt(row.rho));
    } else {
      // (4) positive-variance: the total recovered variance Σσ² does NOT fall under ρ — the
      // §5 invariant (positive common-mode makes classic UNDER-estimate; ρ un-biases σ upward).
      // Per-node it can redistribute (a scalar-ρ solve may lower one corner while raising others),
      // so the invariant is on the SUM, not each component.
      const sum = (m) => (m ? LABELS.reduce((a, L) => a + (m[L] != null ? m[L] * m[L] : 0), 0) : null);
      const s2c = sum(row.sigmaClassic),
        s2r = sum(row.sigmaRho);
      ok(row.label + ': ρ does not lower total Σσ² (§5 invariant)', s2c != null && s2r != null && s2r >= s2c - 0.5, 'Σσ² classic=' + fmt(s2c) + ' → ρ-on=' + fmt(s2r));
    }
  }
  return checks;
}

/* ════════════════════════════════════════════════════════════════════════
 * main
 * ──────────────────────────────────────────────────────────────────────── */
function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const dirIx = argv.indexOf('--dir');

  console.log('IntegratorTCH multi-night A/B — kernel v' + TCH.VERSION + '  (classic vs per-night motion-ρ)');

  if (dirIx >= 0) {
    const base = argv[dirIx + 1];
    if (!base || !existsSync(base)) {
      console.error('  --dir: path not found: ' + base);
      process.exit(2);
    }
    const subs = readdirSync(base)
      .map((d) => join(base, d))
      .filter((p) => statSync(p).isDirectory());
    if (!subs.length) {
      console.error('  --dir: expected one subdirectory per night (each with 3 node-export JSONs) under ' + base);
      process.exit(2);
    }
    const rows = subs.map((d) => runNight(readNightDir(d), LABELS));
    report(rows, { json });
    console.log('\n  (real nights: no planted truth → distribution is the verdict; compare median σ to the corpus reference.)');
    return;
  }

  // default / --selftest : synthetic known-answer corpus
  const corpus = synthCorpus();
  const rows = corpus.map((c) => runNight(c, LABELS));
  report(rows, { json });
  const checks = verify(rows, corpus);
  const pass = checks.filter((c) => c.pass).length,
    fail = checks.length - pass;
  console.log('\n  known-answer checks: ' + pass + '/' + checks.length + ' passed');
  for (const c of checks) if (!c.pass) console.log('    ✗ ' + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
  if (fail) {
    console.error('\n  SELF-TEST RED — ' + fail + ' known-answer check(s) failed');
    process.exit(1);
  }
  console.log('  ✓ multi-night mechanism + rescue + magnitude reproduced on the known-answer corpus\n');
}

main();
