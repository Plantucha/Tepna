#!/usr/bin/env node
/*
 * tools/deep-vlf-probe.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE STANDING VLF-vs-CONTAMINATED-DEEP PROBE (DEEP-STAGE-DESAT-CONFOUND-2026-07-29 §9/§11/§12).
 * Within `Deep` epochs only, it asks whether a spectral feature can tell a desat-contaminated epoch
 * from a clean one, and — the question that actually decides it — what a threshold would DO:
 *   1) discrimination: AUC + Hanley-McNeil 95% CI for vlf/lf, VLF/tp, vlf, rmssd, lfhf
 *   2) the operating-point sweep: at each θ, contamination caught MINUS genuine Deep destroyed
 *   3) STRATIFIED BY CLOCK QUALITY (§10/§12) — the vigil capture host's clock_synced nights vs the
 *      older free-running-device-clock corpus, since every figure here depends on the O2Ring and the
 *      H10 agreeing about what time it is
 *   4) --shift-profile: AUC as a function of an ARTIFICIAL offset applied to desat times. A corpus
 *      with honest clocks should peak at 0; a skewed one should peak off-centre or run flat.
 *
 * WHY THIS EXISTS AS A COMMITTED TOOL. §9's and §11's numbers came from a throwaway script that no
 * longer exists, so §10's "the probe is written, this is a re-run not a rebuild" was not true when
 * the time came to re-run it — it had to be rebuilt from the brief's prose. That is the same failure
 * §11 documents one level up (an uncommitted harness that silently sampled ONE ECG fragment per
 * night). A probe whose result is quoted in a brief belongs in `tools/`.
 *
 * WHY NOT A DSP CHANGE. It reads two nodes' ALREADY-EMITTED exports and computes no new signal — it
 * moves no bundle and no manifestHash. Read-only: writes nothing, ever.
 *
 * INPUT. `uploads/trio/<night>/{ECGDex,OxyDex}_<night>.node-export.json` — gitignored personal
 * recordings, present only on a machine that has run `tools/trio-batch.mjs`. Per §11 this reads the
 * COMMITTED MERGED exports and adds no night-folding logic of its own; `trio-batch.mjs` owns the
 * night key, the nocturnal-majority gate and the concurrent-sessions rule. A night missing either
 * export, missing `timeseries.sleepStages`, or predating the per-epoch band fields (#569, so no
 * `vlf`) is skipped and COUNTED — never silently read as having no VLF.
 *
 * USAGE
 *   node tools/deep-vlf-probe.mjs [--dir <trio-output-dir>] [--json] [--shift-profile]
 *     --dir <dir>        trio output root (default: uploads/trio)
 *     --vigil-from <d>   first night captured by the vigil host (default: 2026-07-16)
 *     --shift-profile    also print AUC vs artificial desat time-shift, per arm
 *     --shift-range <m>  half-width of that scan in minutes (default 15)
 *     --shift-step <m>   step of that scan in minutes (default 2.5)
 *     --until <date>     ignore nights after this date (for the placebo split — see below)
 *     --json             machine-readable output instead of the printed report
 *     --selftest         known-answer checks for the AUC/CI math (no corpus, no I/O)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const SHIFT_PROFILE = argv.includes('--shift-profile');
const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));
/* The vigil capture host runs ONE daemon that actively `clock_synced` all three devices per session
   (see the per-device stamp in its status.json). Nights before it are three free-running device
   clocks with no sync — the confound §10 parked on. The boundary is a capture-side fact, not a
   tunable: it is the first night the host recorded. */
const VIGIL_FROM = opt('--vigil-from', '2026-07-16');
/* Scan half-width for --shift-profile. Configurable because a profile that peaks at its own boundary
   is a truncated scan, not a finding — the range must be widened until the shape closes. */
const SHIFT_RANGE = Number(opt('--shift-range', '15'));
const SHIFT_STEP = Number(opt('--shift-step', '2.5'));
/* --until restricts the corpus to nights <= this date. Its purpose is the PLACEBO SPLIT: the vigil
   nights are all LATER than the legacy ones, so corpus era is perfectly confounded with clock
   discipline, and any arm difference could be therapy drift rather than timing. Re-running with a
   fake boundary INSIDE the legacy era measures how big an arm gap this corpus produces for free. */
const UNTIL = opt('--until', null);

/* ── stats ────────────────────────────────────────────────────────────────── */

/* Mann-Whitney AUC with MIDRANKS. Ties matter here: `motionIndex` and friends are quantised, and
   scoring ties as wins would inflate every AUC by a few points. */
function auc(pos, neg) {
  const n1 = pos.length,
    n2 = neg.length;
  if (!n1 || !n2) return null;
  const all = pos.map((v) => ({ v, p: 1 })).concat(neg.map((v) => ({ v, p: 0 })));
  all.sort((a, b) => a.v - b.v);
  // midrank assignment over tied runs
  const rank = new Array(all.length);
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const mid = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) rank[k] = mid;
    i = j + 1;
  }
  let sumRankPos = 0;
  for (let i = 0; i < all.length; i++) if (all[i].p) sumRankPos += rank[i];
  const U = sumRankPos - (n1 * (n1 + 1)) / 2;
  return U / (n1 * n2);
}

/* Hanley & McNeil (1982) normal-approximation SE. This is the interval §9/§11 quoted — reproducing
   their published CIs from the published n's is one of the selftests, because an interval computed
   by a different method would silently re-write the brief's own numbers. */
function aucCI(A, n1, n2) {
  if (A == null || !n1 || !n2) return null;
  const Q1 = A / (2 - A);
  const Q2 = (2 * A * A) / (1 + A);
  const se = Math.sqrt((A * (1 - A) + (n1 - 1) * (Q1 - A * A) + (n2 - 1) * (Q2 - A * A)) / (n1 * n2));
  return { se, lo: Math.max(0, A - 1.96 * se), hi: Math.min(1, A + 1.96 * se) };
}

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ── selftest ─────────────────────────────────────────────────────────────── */
if (SELFTEST) {
  let fails = 0;
  const near = (label, got, want, tol) => {
    const ok = got != null && Math.abs(got - want) <= tol;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: got ${got}, want ${want} ±${tol}`);
  };
  // perfect separation, no ties
  near('AUC perfect separation', auc([3, 4, 5], [0, 1, 2]), 1, 1e-12);
  near('AUC perfect inversion', auc([0, 1, 2], [3, 4, 5]), 0, 1e-12);
  // complete ties must be exactly 0.5, not 1.0 — the midrank check
  near('AUC all tied', auc([1, 1, 1], [1, 1, 1]), 0.5, 1e-12);
  // three wins and one tie over four pairs → 3.5/4. Pins that a tie scores 0.5, not 0 and not 1.
  near('AUC one tied pair', auc([2, 3], [1, 2]), 0.875, 1e-12);
  // the brief's own published intervals, reproduced from the published n's
  const c11 = aucCI(0.599, 54, 403);
  near('§11 vlf/lf CI lo (0.515)', Math.round(c11.lo * 1000) / 1000, 0.515, 1e-9);
  near('§11 vlf/lf CI hi (0.683)', Math.round(c11.hi * 1000) / 1000, 0.683, 1e-9);
  const c9 = aucCI(0.61, 58, 348);
  near('§9 vlf/lf CI lo (0.528)', Math.round(c9.lo * 1000) / 1000, 0.528, 1e-9);
  near('§9 vlf/lf CI hi (0.692)', Math.round(c9.hi * 1000) / 1000, 0.692, 1e-9);
  near('median even', median([1, 2, 3, 4]), 2.5, 1e-12);
  console.log(fails ? `\n${fails} FAILED` : '\nall selftests pass');
  process.exit(fails ? 1 : 0);
}

/* ── corpus ───────────────────────────────────────────────────────────────── */
if (!existsSync(DIR)) {
  console.error(
    `deep-vlf-probe: ${DIR} does not exist.\n\n  This tool reads gitignored personal recordings already folded by tools/trio-batch.mjs.\n  Point --dir at a trio output root, e.g.:\n    node tools/deep-vlf-probe.mjs --dir uploads/trio\n`
  );
  process.exit(2);
}
const nightDirs = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const epochsOut = []; // { night, arm, stage, contaminated, vlf, lf, hf, tp, rmssd, lfhf }
const nightsUsed = [];
const skipped = [];
/* Desat times kept per night so --shift-profile can re-map them against the same epoch windows
   without re-reading the corpus. */
const nightWindows = [];

for (const night of nightDirs) {
  if (UNTIL && night > UNTIL) continue;
  const ecgFile = join(DIR, night, `ECGDex_${night}.node-export.json`);
  const oxyFile = join(DIR, night, `OxyDex_${night}.node-export.json`);
  if (!existsSync(ecgFile) || !existsSync(oxyFile)) {
    skipped.push(`${night}: missing ECGDex/OxyDex export`);
    continue;
  }
  let ecg, oxy;
  try {
    ecg = JSON.parse(readFileSync(ecgFile, 'utf8'));
    oxy = JSON.parse(readFileSync(oxyFile, 'utf8'));
  } catch (e) {
    skipped.push(`${night}: unparseable export (${e.message})`);
    continue;
  }
  const stages = ecg.timeseries && ecg.timeseries.sleepStages;
  const epochs = (ecg.timeseries && ecg.timeseries.epochs) || [];
  const t0 = ecg.recording && ecg.recording.startEpochMs;
  if (!Array.isArray(stages) || !stages.length || t0 == null) {
    skipped.push(`${night}: no ECGDex stage series (short/ambulatory night)`);
    continue;
  }
  /* A night folded before #569 carries epochs with no band fields. Reading those as "no VLF" would
     quietly enter them as zeros and drag every median down; they are skipped and counted. */
  const banded = epochs.filter((e) => e.vlf != null && e.lf != null);
  if (!banded.length) {
    skipped.push(`${night}: epochs carry no vlf/lf (folded before #569 — re-fold to include)`);
    continue;
  }
  const byTMin = new Map(epochs.map((e) => [e.tMin, e]));
  const durSec = ecg.recording && ecg.recording.durSec;

  // absolute [start,end) window per staged epoch, bounded by the night's own duration.
  // Identical construction to tools/deep-desat-falsifier.mjs — the two tools must agree about
  // which epoch a desat lands in, or their contamination counts are not comparable.
  const windows = stages.map((s, i) => {
    const start = t0 + s.tMin * 60000;
    const nextTMin = i + 1 < stages.length ? stages[i + 1].tMin : durSec != null ? durSec / 60 : s.tMin + 5;
    const durMin = Math.max(0.1, nextTMin - s.tMin);
    return { stage: s.stage, start, end: start + durMin * 60000, durMin, ep: byTMin.get(s.tMin) };
  });
  const desats = (oxy.ganglior_events || [])
    .filter((e) => e.impulse === 'desat_event' && e.tMs != null)
    .map((e) => e.tMs);

  const hit = new Array(windows.length).fill(false);
  for (const tMs of desats) {
    const idx = windows.findIndex((w) => tMs >= w.start && tMs < w.end);
    if (idx >= 0) hit[idx] = true;
  }

  const arm = night >= VIGIL_FROM ? 'vigil' : 'legacy';
  windows.forEach((w, i) => {
    const e = w.ep;
    if (!e || e.vlf == null || e.lf == null) return;
    epochsOut.push({
      night,
      arm,
      stage: w.stage,
      contaminated: hit[i],
      vlf: e.vlf,
      lf: e.lf,
      hf: e.hf,
      tp: e.totalPower,
      rmssd: e.rmssd,
      lfhf: e.lfhf,
    });
  });
  nightWindows.push({ night, arm, windows, desats });
  nightsUsed.push({ night, arm });
}

/* ── features ─────────────────────────────────────────────────────────────── */
const FEATURES = [
  { key: 'vlf/lf', of: (e) => (e.lf > 0 ? e.vlf / e.lf : null) },
  { key: 'VLF/tp', of: (e) => (e.tp > 0 ? e.vlf / e.tp : null) },
  { key: 'vlf', of: (e) => e.vlf },
  { key: 'rmssd', of: (e) => e.rmssd },
  { key: 'lfhf', of: (e) => e.lfhf },
];

function armStats(rows) {
  const deep = rows.filter((e) => e.stage === 'Deep');
  const pos = deep.filter((e) => e.contaminated);
  const neg = deep.filter((e) => !e.contaminated);
  const out = {
    nights: new Set(rows.map((e) => e.night)).size,
    deepEpochs: deep.length,
    contaminated: pos.length,
    clean: neg.length,
    prevalence: deep.length ? pos.length / deep.length : null,
    features: {},
    sweep: [],
  };
  for (const f of FEATURES) {
    const P = pos.map(f.of).filter((v) => v != null && isFinite(v));
    const N = neg.map(f.of).filter((v) => v != null && isFinite(v));
    const A = auc(P, N);
    const ci = aucCI(A, P.length, N.length);
    out.features[f.key] = {
      auc: A,
      ci,
      medPos: median(P),
      medNeg: median(N),
      established: ci ? ci.lo > 0.5 : null,
    };
  }
  /* §9.3's operating-point sweep, which is what actually decides the veto: at each θ on vlf/lf,
     contamination caught MINUS genuine Deep destroyed. Reported as measured counts rather than
     through a normal model — the model script behind §11.2's break-even figure is one of the
     casualties this tool exists to prevent, and the empirical net needs no model. */
  const ratio = (e) => (e.lf > 0 ? e.vlf / e.lf : null);
  for (const th of [1.5, 2.0, 2.5, 3.0, 4.0]) {
    const caught = pos.filter((e) => ratio(e) != null && ratio(e) >= th).length;
    const destroyed = neg.filter((e) => ratio(e) != null && ratio(e) >= th).length;
    out.sweep.push({ th, caught, ofPos: pos.length, destroyed, ofNeg: neg.length, net: caught - destroyed });
  }
  return out;
}

/* AUC as a function of an artificial shift applied to desat times. Drift between the O2Ring and the
   H10 misassigns desats to neighbouring epochs; if that is happening, the arm's peak moves off 0. */
function shiftProfile(arm) {
  const rows = [];
  for (let shiftMin = -SHIFT_RANGE; shiftMin <= SHIFT_RANGE; shiftMin += SHIFT_STEP) {
    const pos = [],
      neg = [];
    for (const nw of nightWindows) {
      if (arm && nw.arm !== arm) continue;
      const hit = new Array(nw.windows.length).fill(false);
      for (const tMs of nw.desats) {
        const t = tMs + shiftMin * 60000;
        const idx = nw.windows.findIndex((w) => t >= w.start && t < w.end);
        if (idx >= 0) hit[idx] = true;
      }
      nw.windows.forEach((w, i) => {
        const e = w.ep;
        if (!e || w.stage !== 'Deep' || e.lf == null || !(e.lf > 0) || e.vlf == null) return;
        (hit[i] ? pos : neg).push(e.vlf / e.lf);
      });
    }
    const A = auc(pos, neg);
    rows.push({ shiftMin, n: pos.length, auc: A, ci: aucCI(A, pos.length, neg.length) });
  }
  return rows;
}

/* Two independent AUCs, normal-approximation difference test. This is §10's actual question — not
   "is each arm significant" but "do the arms DIFFER" — and the two are not the same claim: an arm
   can fail to establish an effect purely for want of epochs while being perfectly consistent with
   the other arm. */
function compareArms(a, b, key) {
  const ra = a.features[key],
    rb = b.features[key];
  if (!ra || !rb || !ra.ci || !rb.ci) return null;
  const diff = ra.auc - rb.auc;
  const se = Math.sqrt(ra.ci.se * ra.ci.se + rb.ci.se * rb.ci.se);
  const z = se > 0 ? diff / se : null;
  // two-sided p from the normal tail (Abramowitz & Stegun 7.1.26 erf approximation)
  const erf = (x) => {
    const s = x < 0 ? -1 : 1;
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x);
    return s * y;
  };
  const p = z == null ? null : 1 - erf(Math.abs(z) / Math.SQRT2);
  return { diff, se, z, p, lo: diff - 1.96 * se, hi: diff + 1.96 * se };
}

/* ── report ───────────────────────────────────────────────────────────────── */
const pooled = armStats(epochsOut);
const vigil = armStats(epochsOut.filter((e) => e.arm === 'vigil'));
const legacy = armStats(epochsOut.filter((e) => e.arm === 'legacy'));

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        dir: DIR,
        vigilFrom: VIGIL_FROM,
        nightsUsed,
        skipped,
        pooled,
        vigil,
        legacy,
        shiftProfile: SHIFT_PROFILE ? { pooled: shiftProfile(null), vigil: shiftProfile('vigil'), legacy: shiftProfile('legacy') } : null,
      },
      null,
      2
    )
  );
  process.exit(0);
}

const f3 = (v) => (v == null ? '—' : v.toFixed(3));
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1) + ' %');

console.log(`\ndeep-vlf-probe — ${DIR}`);
console.log(`nights read: ${nightsUsed.length}   (vigil ≥ ${VIGIL_FROM}: ${nightsUsed.filter((n) => n.arm === 'vigil').length}, legacy: ${nightsUsed.filter((n) => n.arm === 'legacy').length})`);
if (skipped.length) {
  console.log(`nights skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  ⊘ ${s}`);
}

function printArm(label, s) {
  console.log(`\n── ${label} ──`);
  console.log(`nights ${s.nights}   Deep epochs ${s.deepEpochs}   contaminated ${s.contaminated} / clean ${s.clean}   prevalence ${pct(s.prevalence)}`);
  if (!s.contaminated || !s.clean) {
    console.log('  (no contrast in this arm — nothing to discriminate)');
    return;
  }
  console.log('  feature'.padEnd(12) + 'AUC'.padEnd(9) + '95% CI'.padEnd(18) + 'med+'.padEnd(10) + 'med−'.padEnd(10) + 'verdict');
  for (const f of FEATURES) {
    const r = s.features[f.key];
    const ci = r.ci ? `[${f3(r.ci.lo)}, ${f3(r.ci.hi)}]` : '—';
    console.log(
      `  ${f.key}`.padEnd(12) +
        f3(r.auc).padEnd(9) +
        ci.padEnd(18) +
        (r.medPos == null ? '—' : r.medPos.toFixed(2)).padEnd(10) +
        (r.medNeg == null ? '—' : r.medNeg.toFixed(2)).padEnd(10) +
        (r.established ? 'discriminates' : 'NOT established')
    );
  }
  console.log('  θ on vlf/lf   caught          destroyed        net');
  for (const w of s.sweep) {
    console.log(
      `  ${w.th.toFixed(1)}`.padEnd(16) +
        `${w.caught}/${w.ofPos}`.padEnd(16) +
        `${w.destroyed}/${w.ofNeg}`.padEnd(17) +
        (w.net > 0 ? '+' : '') +
        w.net
    );
  }
}

printArm('POOLED (control — must reproduce §11)', pooled);
printArm(`VIGIL — one daemon, all three devices clock_synced (≥ ${VIGIL_FROM})`, vigil);
printArm('LEGACY — three free-running device clocks, no sync', legacy);

console.log('\n── vigil vs legacy: do the arms DIFFER? (§10\'s actual question) ──');
console.log('  feature'.padEnd(12) + 'Δ AUC'.padEnd(10) + '95% CI'.padEnd(20) + 'z'.padEnd(8) + 'p');
for (const f of FEATURES) {
  const c = compareArms(vigil, legacy, f.key);
  if (!c) continue;
  console.log(
    `  ${f.key}`.padEnd(12) +
      (c.diff >= 0 ? '+' : '') +
      f3(c.diff).padEnd(9) +
      `[${c.lo >= 0 ? '+' : ''}${f3(c.lo)}, ${c.hi >= 0 ? '+' : ''}${f3(c.hi)}]`.padEnd(20) +
      f3(c.z).padEnd(8) +
      f3(c.p)
  );
}
console.log('  (Δ > 0 would mean the clock-synced arm discriminates BETTER — §10\'s hypothesis)');

if (SHIFT_PROFILE) {
  console.log('\n── AUC vs artificial desat time-shift (a skewed corpus peaks off 0) ──');
  /* n is printed alongside every AUC on purpose. A shift moves desats off Deep epochs entirely, so
     the contaminated count collapses as the scan widens — and an AUC read off 5 epochs will swing
     to 0.7 on noise alone. Without n beside it, that swing reads as a clock offset. */
  console.log('  shift(min)'.padEnd(13) + 'pooled (n)'.padEnd(17) + 'vigil (n)'.padEnd(17) + 'legacy (n)');
  const P = shiftProfile(null),
    V = shiftProfile('vigil'),
    L = shiftProfile('legacy');
  const cell = (r) => `${f3(r.auc)} (${r.n})`;
  for (let i = 0; i < P.length; i++) {
    console.log(
      `  ${P[i].shiftMin >= 0 ? '+' : ''}${P[i].shiftMin}`.padEnd(13) +
        cell(P[i]).padEnd(17) +
        cell(V[i]).padEnd(17) +
        cell(L[i])
    );
  }
}
console.log('');
