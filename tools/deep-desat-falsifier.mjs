#!/usr/bin/env node
/*
 * tools/deep-desat-falsifier.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE STANDING CROSS-SIGNAL FALSIFIER for called sleep stages (DEEP-STAGE-DESAT-CONFOUND-2026-07-29
 * §6 item 4 / REM-STAGING-REDESIGN §5): "REM/Deep should carry a stage-appropriate desaturation
 * rate, and OxyDex + ECGDex already publish enough per night to check it, for free." This maps
 * every OxyDex `desat_event` onto the ECGDex stage epoch covering it and reports:
 *   1) the per-stage desat-rate table with exact (Garwood) Poisson 95% CIs
 *   2) the per-night Deep-vs-Light ratio + one-sided exact sign test
 *   3) the settling test: does Deep collapse once desat-overlapping epochs are excluded?
 *
 * WHY THIS EXISTS. The original REM investigation's "6.5% median REM" figure came from a hand-rolled
 * harness that merged every file in a calendar-date folder — no night key, no nocturnal-majority
 * gate, no concurrent-session-only rule. Re-run on the project's OWN night definition, the number
 * moved (to 4.8%) and one conclusion had to be withdrawn. This tool cannot repeat that mistake by
 * construction: it reads ALREADY-COMPUTED `tools/trio-batch.mjs` output — the night key
 * (date of start−12h), majority-nocturnal gate, and concurrent-sessions-only rule are enforced ONCE,
 * upstream, by the tool that owns them. This script adds no night-folding logic of its own.
 *
 * WHY A SEPARATE TOOL (not a DSP change). It reads two nodes' ALREADY-EMITTED exports and computes
 * no new signal — it moves no bundle and no manifestHash. Read-only: writes nothing, ever.
 *
 * INPUT. `uploads/trio/<night>/{ECGDex,OxyDex}_<night>.node-export.json` — gitignored personal
 * recordings, present only on a machine that has run `tools/trio-batch.mjs`. A night missing either
 * file, or missing `timeseries.sleepStages` (ECGDex must be long enough to stage), is skipped and
 * counted, never silently dropped from the printed total.
 *
 * USAGE
 *   node tools/deep-desat-falsifier.mjs [--dir <trio-output-dir>] [--json]
 *     --dir <dir>   trio output root (default: uploads/trio)
 *     --json        machine-readable output instead of the printed report
 *     --selftest    known-answer checks for the CI/sign-test math (no corpus, no I/O)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ── args ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
function opt(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
}
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));

/* ── stats: inverse normal CDF (Acklam), Wilson–Hilferty chi² quantile,
   exact (Garwood) Poisson CI, exact one-sided binomial sign-test p-value ──── */
function invNorm(p) {
  // Acklam's algorithm — accurate to ~1.15e-9 over (0,1). Standard, dependency-free.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425,
    phigh = 1 - plow;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function logGamma(x) {
  // Lanczos approximation (g=7, n=9 coefficients) — standard, ~15 significant digits.
  const gLanczos = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = gLanczos[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += gLanczos[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function gammaIncLowerReg(a, x) {
  // Regularized lower incomplete gamma P(a,x) — series (x < a+1) or continued fraction (x >= a+1).
  // Numerical Recipes §6.2, standard and reliable to double precision for the a,x ranges here.
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a,
      term = sum,
      n = a;
    for (let i = 0; i < 500; i++) {
      n += 1;
      term *= x / n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction for Q(a,x) = 1 - P(a,x), Lentz's method
  const FPMIN = 1e-300;
  let b = x + 1 - a,
    c = 1 / FPMIN,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - q;
}
function invGammaIncLowerReg(a, p) {
  // Invert P(a,x)=p for x, via Newton–Raphson refinement of a Wilson–Hilferty seed. W-H alone is
  // only ~0.1% accurate at small df (it was off by 0.02 at k=0's df=2 case, unacceptable for a
  // tool that names itself "exact") — refining it against the exact regularized incomplete gamma
  // above is what makes this the real Garwood interval rather than an approximation to it.
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  const z = invNorm(p);
  let x = a * Math.max(1e-8, 1 - 1 / (9 * a) + (z * Math.sqrt(1 / (9 * a)))) ** 3;
  if (!isFinite(x) || x <= 0) x = a;
  for (let i = 0; i < 100; i++) {
    const fx = gammaIncLowerReg(a, x) - p;
    // pdf of Gamma(a,1) at x, in log space to avoid overflow for larger a
    const logPdf = (a - 1) * Math.log(x) - x - logGamma(a);
    const pdf = Math.exp(logPdf);
    if (pdf <= 0 || !isFinite(pdf)) break;
    let step = fx / pdf;
    if (!isFinite(step)) break;
    let xNew = x - step;
    if (xNew <= 0) xNew = x / 2; // keep iterates positive; halving is a safe bisection-style fallback
    if (Math.abs(xNew - x) < 1e-12 * Math.max(1, x)) {
      x = xNew;
      break;
    }
    x = xNew;
  }
  return x;
}
function chi2Quantile(p, df) {
  // χ²(df) is Gamma(shape = df/2, scale = 2), so its quantile is 2 × the Gamma(df/2,1) quantile.
  if (df <= 0) return 0;
  return 2 * invGammaIncLowerReg(df / 2, p);
}
function poissonCI(k, alpha = 0.05) {
  // Garwood exact interval: lower = χ²(α/2, 2k)/2 (0 when k=0), upper = χ²(1-α/2, 2(k+1))/2.
  const lo = k === 0 ? 0 : chi2Quantile(alpha / 2, 2 * k) / 2;
  const hi = chi2Quantile(1 - alpha / 2, 2 * (k + 1)) / 2;
  return [lo, hi];
}
function binomPmf(k, n, p) {
  let logC = 0;
  for (let i = 0; i < k; i++) logC += Math.log(n - i) - Math.log(i + 1);
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function signTestPGE(k, n) {
  // One-sided exact P(X >= k) under Binomial(n, 0.5) — "at least k of n nights favour the direction".
  let s = 0;
  for (let i = k; i <= n; i++) s += binomPmf(i, n, 0.5);
  return s;
}
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

if (SELFTEST) {
  // Known answers: Garwood CI for k=0 is [0, 3.6889/2λ-scale]; k=4 matches the brief's own figures.
  const [lo0, hi0] = poissonCI(0);
  const [lo4, hi4] = poissonCI(4);
  const okA = lo0 === 0 && Math.abs(hi0 - 3.6889) < 0.001; // χ²(0.975,2)/2 = -ln(0.025) exactly = 3.68888 — the textbook "λ upper ≈ 3.69 for 0 events observed"
  const okB = Math.abs(lo4 - 1.0899) < 0.001 && Math.abs(hi4 - 10.2416) < 0.001; // published k=4 Garwood bounds (Ulm 1990 / standard tables)
  const pSign = signTestPGE(11, 14); // brief's own figure: 11 of 14, p ≈ 0.03 one-sided
  const okC = Math.abs(pSign - 0.0287) < 0.01;
  console.log(`selftest: poissonCI(0)=[${lo0},${hi0.toFixed(4)}] ${okA ? 'OK' : 'FAIL'}`);
  console.log(`selftest: poissonCI(4)=[${lo4.toFixed(4)},${hi4.toFixed(4)}] ${okB ? 'OK' : 'FAIL'}`);
  console.log(`selftest: signTestPGE(11,14)=${pSign.toFixed(4)} ${okC ? 'OK' : 'FAIL'}`);
  process.exit(okA && okB && okC ? 0 : 1);
}

/* ── corpus discovery ─────────────────────────────────────────────────────── */
if (!existsSync(DIR)) {
  console.error(`deep-desat-falsifier: ${DIR} does not exist.\n\n  This tool reads gitignored personal recordings already folded by tools/trio-batch.mjs.\n  Point --dir at a trio output root, e.g.:\n    node tools/deep-desat-falsifier.mjs --dir uploads/trio\n`);
  process.exit(2);
}
const nightDirs = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const STAGES = ['REM', 'Light', 'Deep', 'Wake'];
const stageMinutes = Object.fromEntries(STAGES.map((s) => [s, 0]));
const stageDesats = Object.fromEntries(STAGES.map((s) => [s, 0]));
const allEpochs = []; // { stage, rmssd, hasDesat, minutes }
const perNight = []; // { night, deepRate, lightRate, deepMin, lightMin }
let nightsRead = 0,
  nightsSkipped = 0;
const skipReasons = [];

for (const night of nightDirs) {
  const ecgFile = join(DIR, night, `ECGDex_${night}.node-export.json`);
  const oxyFile = join(DIR, night, `OxyDex_${night}.node-export.json`);
  if (!existsSync(ecgFile) || !existsSync(oxyFile)) {
    nightsSkipped++;
    skipReasons.push(`${night}: missing ECGDex/OxyDex export`);
    continue;
  }
  let ecg, oxy;
  try {
    ecg = JSON.parse(readFileSync(ecgFile, 'utf8'));
    oxy = JSON.parse(readFileSync(oxyFile, 'utf8'));
  } catch (e) {
    nightsSkipped++;
    skipReasons.push(`${night}: unparseable export (${e.message})`);
    continue;
  }
  const stages = ecg.timeseries && ecg.timeseries.sleepStages;
  const epochs = ecg.timeseries && ecg.timeseries.epochs;
  const t0 = ecg.recording && ecg.recording.startEpochMs;
  if (!Array.isArray(stages) || !stages.length || t0 == null) {
    nightsSkipped++;
    skipReasons.push(`${night}: no ECGDex stage series (short/ambulatory night)`);
    continue;
  }
  const rmssdByTMin = new Map((epochs || []).map((e) => [e.tMin, e.rmssd]));
  const durSec = ecg.recording && ecg.recording.durSec;
  // build absolute [start,end) windows per epoch, bounded by the night's own duration
  const windows = stages.map((s, i) => {
    const start = t0 + s.tMin * 60000;
    const nextTMin = i + 1 < stages.length ? stages[i + 1].tMin : durSec != null ? durSec / 60 : s.tMin + 5;
    const durMin = Math.max(0.1, nextTMin - s.tMin);
    return { stage: s.stage, start, end: start + durMin * 60000, durMin, rmssd: rmssdByTMin.get(s.tMin) };
  });
  const desats = (oxy.ganglior_events || []).filter((e) => e.impulse === 'desat_event' && e.tMs != null);

  // map each desat onto the epoch whose window contains it (windows are time-ordered → linear scan is fine)
  const hasDesat = new Array(windows.length).fill(false);
  for (const d of desats) {
    const idx = windows.findIndex((w) => d.tMs >= w.start && d.tMs < w.end);
    if (idx >= 0) hasDesat[idx] = true;
  }
  windows.forEach((w, i) => {
    if (STAGES.includes(w.stage)) {
      stageMinutes[w.stage] += w.durMin;
      allEpochs.push({ stage: w.stage, rmssd: w.rmssd, hasDesat: hasDesat[i], durMin: w.durMin });
    }
  });
  // count desats per stage (a desat not landing in any window is dropped — cannot happen if it
  // fell inside the recording, but a trailing/leading desat just outside the staged span can)
  for (const d of desats) {
    const idx = windows.findIndex((w) => d.tMs >= w.start && d.tMs < w.end);
    if (idx >= 0 && STAGES.includes(windows[idx].stage)) stageDesats[windows[idx].stage]++;
  }

  // per-night Deep-vs-Light ratio (only nights with >=30 min of each, per the brief's own criterion)
  const deepMin = windows.filter((w) => w.stage === 'Deep').reduce((a, w) => a + w.durMin, 0);
  const lightMin = windows.filter((w) => w.stage === 'Light').reduce((a, w) => a + w.durMin, 0);
  const deepDesats = windows.reduce((a, w, i) => a + (w.stage === 'Deep' && hasDesat[i] ? 1 : 0), 0);
  const lightDesats = windows.reduce((a, w, i) => a + (w.stage === 'Light' && hasDesat[i] ? 1 : 0), 0);
  if (deepMin >= 30 && lightMin >= 30) {
    const deepRate = deepDesats / (deepMin / 60);
    const lightRate = lightDesats / (lightMin / 60);
    perNight.push({ night, deepRate, lightRate, deepMin, lightMin, ratio: lightRate > 0 ? deepRate / lightRate : deepRate > 0 ? Infinity : null });
  }
  nightsRead++;
}

/* ── report 1: per-stage rate table ──────────────────────────────────────── */
const rateTable = STAGES.map((s) => {
  const min = stageMinutes[s],
    k = stageDesats[s];
  const rate = min > 0 ? k / (min / 60) : null;
  const [lo, hi] = poissonCI(k);
  const ciLo = min > 0 ? lo / (min / 60) : null,
    ciHi = min > 0 ? hi / (min / 60) : null;
  return { stage: s, min: Math.round(min), desats: k, ratePerHour: rate != null ? +rate.toFixed(2) : null, ci95: ciLo != null ? [+ciLo.toFixed(2), +ciHi.toFixed(2)] : null };
});

/* ── report 2: per-night sign test ───────────────────────────────────────── */
const qualifying = perNight.filter((n) => n.ratio != null && isFinite(n.ratio));
const favouringDeep = qualifying.filter((n) => n.deepRate > n.lightRate).length;
const ratios = qualifying.map((n) => n.ratio);
const pSign = qualifying.length ? signTestPGE(favouringDeep, qualifying.length) : null;

/* ── report 3: the settling test (exclude desat-overlapping epochs) ─────── */
function settleRow(epochs) {
  const deep = epochs.filter((e) => e.stage === 'Deep');
  const light = epochs.filter((e) => e.stage === 'Light');
  const totalMin = epochs.reduce((a, e) => a + e.durMin, 0);
  const deepMin = deep.reduce((a, e) => a + e.durMin, 0);
  return {
    epochs: epochs.length,
    deepPctOfSleep: totalMin > 0 ? +((100 * deepMin) / totalMin).toFixed(1) : null,
    medRmssdDeep: median(deep.map((e) => e.rmssd).filter((v) => v != null)),
    medRmssdLight: median(light.map((e) => e.rmssd).filter((v) => v != null))
  };
}
const settleAll = settleRow(allEpochs);
const settleExcl = settleRow(allEpochs.filter((e) => !e.hasDesat));
const settleOnly = settleRow(allEpochs.filter((e) => e.hasDesat));
const gapAll = settleAll.medRmssdDeep != null && settleAll.medRmssdLight != null ? +(settleAll.medRmssdDeep - settleAll.medRmssdLight).toFixed(1) : null;
const gapExcl = settleExcl.medRmssdDeep != null && settleExcl.medRmssdLight != null ? +(settleExcl.medRmssdDeep - settleExcl.medRmssdLight).toFixed(1) : null;

const result = {
  nightsFound: nightDirs.length,
  nightsRead,
  nightsSkipped,
  skipReasons,
  rateTable,
  signTest: { nights: qualifying.length, favouringDeep, medianRatio: ratios.length ? +median(ratios).toFixed(2) : null, pOneSided: pSign != null ? +pSign.toFixed(4) : null },
  settling: { all: { ...settleAll, rmssdGap: gapAll }, excludingDesatOverlap: { ...settleExcl, rmssdGap: gapExcl }, onlyDesatOverlap: settleOnly }
};

if (AS_JSON) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\ndeep-desat-falsifier — ${DIR}`);
  console.log(`nights: ${nightsRead} read, ${nightsSkipped} skipped (of ${nightDirs.length} found)`);
  if (skipReasons.length) console.log(skipReasons.map((r) => '  · ' + r).join('\n'));
  console.log(`\n── per-stage desaturation rate (exact 95% CI) ──`);
  console.log('stage'.padEnd(8) + 'min'.padEnd(8) + 'desats'.padEnd(9) + 'rate/h'.padEnd(9) + '95% CI');
  for (const r of rateTable) console.log(r.stage.padEnd(8) + String(r.min).padEnd(8) + String(r.desats).padEnd(9) + String(r.ratePerHour).padEnd(9) + (r.ci95 ? `[${r.ci95[0]}, ${r.ci95[1]}]` : '—'));
  console.log(`\n── per-night Deep-vs-Light ratio (nights with ≥30 min of each) ──`);
  console.log(`${qualifying.length} qualifying nights · Deep>Light on ${favouringDeep} · median ratio ${result.signTest.medianRatio} · one-sided sign-test p=${result.signTest.pOneSided}`);
  console.log(`\n── settling test: exclude every epoch overlapping a desat ──`);
  console.log('set'.padEnd(24) + 'epochs'.padEnd(8) + 'Deep%sleep'.padEnd(12) + 'medRMSSD Deep'.padEnd(15) + 'Light'.padEnd(8) + 'gap');
  const rows = [
    ['all', settleAll, gapAll],
    ['excl. desat-overlapping', settleExcl, gapExcl],
    ['only desat-overlapping', settleOnly, settleOnly.medRmssdDeep != null && settleOnly.medRmssdLight != null ? +(settleOnly.medRmssdDeep - settleOnly.medRmssdLight).toFixed(1) : null]
  ];
  for (const [label, s, gap] of rows) console.log(label.padEnd(24) + String(s.epochs).padEnd(8) + String(s.deepPctOfSleep).padEnd(12) + String(s.medRmssdDeep).padEnd(15) + String(s.medRmssdLight).padEnd(8) + String(gap));
  console.log('');
}
process.exit(0);
