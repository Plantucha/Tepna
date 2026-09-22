#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// pat-mode-posture.mjs — does the PAT lag mode follow the BODY or the CLOCK-ON-THE-WALL?
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE QUESTION, AND WHY THE ORACLE CANNOT ANSWER IT. Residue `2026-09-06-a-statistic-both-hypotheses-
// predict` (PAT-FORENSICS-WINDOW-ORACLE §-park): the last item asks whether the per-night lag mode is
// slow PHYSIOLOGY (BP / vasomotor / posture / stage) or an INSTRUMENTAL effect the host axis cannot see
// (contact drift, warming, wear shift). The oracle measures a mode per night, and BOTH candidates
// predict a mode that differs between nights — a statistic both hypotheses predict cannot separate
// them, so running the oracle again at any width cannot answer (the 6× sweep moved nothing). The
// halves diagnostic (`2026-09-14-oracle-mode-not-stable-across-halves`) then showed the mode is not
// even stable WITHIN a night — it moves 80–160 ms between halves on every SIGNAL RECOVERED night —
// which is what makes a within-night covariate design possible at all.
//
// THE DESIGN — a covariate that moves with the body and not with the sensor: TRUNK POSTURE from the
// H10's own chest accelerometer (the `_ACC.txt` sibling of the very ECG fragment the oracle scores).
// Segment the night into runs of one posture class, estimate the lag mode in each segment with the
// oracle's own machinery (`rawLags` → `lagMode`, the same search interval), and ask ONE question whose
// answer DIFFERS under the two hypotheses:
//
//     when the body RETURNS to a posture it held earlier, does the mode RETURN with it?
//
//   · PHYSIOLOGY predicts YES: the mode is a property of the state, so two supine segments an hour
//     apart agree more than a supine and its neighbouring lateral segment do.
//     ⇒ median |Δmode| over SAME-posture pairs  <  median |Δmode| over ADJACENT different-posture pairs
//   · DRIFT / CONTACT predicts NO: the mode is a property of elapsed time (or of the last wear shift),
//     so same-posture pairs — which by construction span LONGER intervals than adjacent pairs — agree
//     LESS, and a turn that disturbs the contact starts a new mode that no return undoes.
//     ⇒ the same ratio  ≥ 1
//
// The statistic is the per-night ratio  R = median(S) / median(D)  with S the same-posture pair set and
// D the adjacent-different-posture pair set, and a within-night PERMUTATION null (posture labels
// shuffled across the night's segments, 200 draws) beside every R so a ratio can be read against what
// "posture carries no information" produces on that night's own segment geometry.
//
// 🔒 PRE-REGISTERED BANDS — written and committed BEFORE the first corpus run (pre-state-the-threshold):
//   population   nights whose (ECG, PPG) pair the oracle would score AND whose ECG fragment has an ACC
//                sibling AND which yield ≥ 1 same-posture pair and ≥ 1 adjacent-different pair from
//                segments of ≥ MIN_BEATS R beats. Every other night is EXCLUDED BY NAME.
//   UNDERPOWERED  fewer than MIN_NIGHTS (5) nights in the population — no verdict, the count is the result
//   PHYSIOLOGY-LEANING (status PASS)   median R ≤ 0.5  AND  ≥ 70 % of nights R < 1
//   TIME-LEANING       (status FAIL)   median R ≥ 1.0
//   INDETERMINATE      (status UNKNOWN) anything between — the design ran and could not separate them
//   ⚠ PASS / FAIL are the contract's closed vocabulary, NOT goodness: FAIL means the mode followed TIME,
//     not that the tool failed. Read the `reason` beside the status.
//
// WHAT THIS DOES NOT ESTABLISH. A positive result says the mode co-varies with posture; it does not name
// the mechanism (hydrostatic BP, vasomotor tone, arm position relative to the heart — the PPG is on the
// upper arm). A negative result says posture is not the covariate; sleep STAGE (CPAP/EEG leg) remains
// untested here and is the next covariate the §-park note names. Neither result touches the oracle's
// recovered concentration, which is real regardless (§545 "what this does NOT say").
//
// Usage:
//   node tools/pat-mode-posture.mjs --dir <captures root>   [--json] [--epoch 30] [--perms 200]
//   node tools/pat-mode-posture.mjs --selftest | --verdict-sample
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const MIN_BEATS = 200; // the oracle's own per-train floor (`oracleNight`), applied per segment
export const MIN_NIGHTS = 5;
export const EPOCH_S = 30; // MotionDex `bodyPosition` epoch
export const MAX_GAP_MS = 5 * 60 * 1000; // a run of one posture is broken by a timeline gap longer than this
export const PERMS = 200;
export const BAND_PHYS_RATIO = 0.5;
export const BAND_PHYS_SHARE = 0.7;
export const BAND_TIME_RATIO = 1.0;

/* ── ACC parse (Polar Sensor Logger / capture-host layout) ────────────────────────────────────────
   `Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]`. The phone stamp is read by REGEX into
   the floating wall-clock axis (`Date.UTC` of the components — Clock Contract §2.3, never
   `new Date(str)`), which is the same axis `ecgRpeakTimes` puts the R train on (`rec.t0Ms + pos/fs`).
   Posture segments are minutes long, so seconds-level agreement between the two is ample. */
export function parseAcc(text) {
  const t = [];
  const x = [];
  const y = [];
  const z = [];
  /* Two layouts in the corpus: `stamp;ns;X;Y;Z` (2026-08 onward) and the earlier
     `stamp;ns;timestamp [ms];X;Y;Z` (2026-07-16 carries it). The gravity triple is always the LAST
     three integer fields; the optional middle column is skipped by shape, not by header parsing.
     Measured 2026-09-22: the first parser assumed five fields and read every early night as
     `acc-empty` — a NAMED skip, which is the only reason it was seen. */
  const re = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?;[^;]*;(?:[^;]*;)?(-?\d+);(-?\d+);(-?\d+)\s*$/;
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    const ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
    t.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
    x.push(+m[8] / 1000);
    y.push(+m[9] / 1000);
    z.push(+m[10] / 1000);
  }
  return { t, x, y, z };
}

/* ── posture class from a gravity vector ──────────────────────────────────────────────────────────
   BYTE-FOR-BYTE the fixed-threshold, Z-first scheme of `motiondex-dsp.js classifyGravity` (which
   itself mirrors ECGDex `_posture` and PPGDex `_posturePPG` — three siblings reading the same torso
   ACC). gz > 0 ⇒ SUPINE (owner-confirmed on a real night, chest Z +973 mg; POSTURE-SIGN-AND-NADIR-
   LABELS 2026-07-20). MotionDex is a browser IIFE, not importable here; the selftest plants the
   documented cases so a drift between the copies reds. */
export function classifyGravity(gx, gy, gz) {
  const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (!(mag > 0.4) || mag > 2.0) return 'unknown';
  const ux = gx / mag;
  const uy = gy / mag;
  const uz = gz / mag;
  if (Math.abs(uz) >= 0.7) return uz > 0 ? 'supine' : 'prone';
  if (Math.abs(uy) >= 0.55) return 'upright';
  return ux < 0 ? 'left' : 'right';
}

const median = (a) => {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Per-epoch gravity = component MEDIANS over the epoch (MotionDex's bucketing), then the class. */
export function postureEpochs(acc, epochS = EPOCH_S) {
  const out = [];
  if (!acc.t.length) return out;
  const E = epochS * 1000;
  const t0 = acc.t[0];
  let i = 0;
  while (i < acc.t.length) {
    const k = Math.floor((acc.t[i] - t0) / E);
    const start = t0 + k * E;
    const xs = [];
    const ys = [];
    const zs = [];
    while (i < acc.t.length && acc.t[i] < start + E) {
      xs.push(acc.x[i]);
      ys.push(acc.y[i]);
      zs.push(acc.z[i]);
      i++;
    }
    if (xs.length < 5) continue; // an epoch with a handful of samples is not a posture reading
    out.push({ start, end: start + E, cls: classifyGravity(median(xs), median(ys), median(zs)) });
  }
  return out;
}

/* Maximal runs of ONE class. `unknown` epochs (moving / off) are dropped from the timeline rather than
   breaking a run — a turn is a CHANGE OF CLASS, which is what ends a segment; a gap longer than
   MAX_GAP_MS does break it, because a run that spans a dropout is two stretches wearing one label. */
export function segments(epochs, maxGapMs = MAX_GAP_MS) {
  const segs = [];
  let cur = null;
  for (const e of epochs) {
    if (e.cls === 'unknown') continue;
    if (cur && cur.cls === e.cls && e.start - cur.end <= maxGapMs) {
      cur.end = e.end;
      continue;
    }
    cur = { cls: e.cls, start: e.start, end: e.end };
    segs.push(cur);
  }
  return segs;
}

/* The mode per segment, with the oracle's machinery and floor. Short segments are SKIPPED BY NAME and
   counted; they are not silently absent. */
export function segmentModes(segs, rTimes, fTimes, { rawLags, lagMode, searchMax }, minBeats = MIN_BEATS) {
  const rows = [];
  const skipped = { short: 0, 'no-mode': 0 };
  for (const s of segs) {
    const rSeg = rTimes.filter((t) => t >= s.start && t < s.end);
    if (rSeg.length < minBeats) {
      skipped.short++;
      continue;
    }
    const mode = lagMode(rawLags(rSeg, fTimes, searchMax), searchMax);
    if (mode == null) {
      skipped['no-mode']++;
      continue;
    }
    rows.push({ cls: s.cls, start: s.start, end: s.end, beats: rSeg.length, mode });
  }
  return { rows, skipped };
}

/* S = every same-class pair (any separation); D = every ADJACENT pair of different classes. */
export function pairSets(rows) {
  const S = [];
  const D = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) if (rows[i].cls === rows[j].cls) S.push(Math.abs(rows[i].mode - rows[j].mode));
    if (i + 1 < rows.length && rows[i].cls !== rows[i + 1].cls) D.push(Math.abs(rows[i].mode - rows[i + 1].mode));
  }
  return { S, D };
}

export function ratioOf(rows) {
  const { S, D } = pairSets(rows);
  if (!S.length || !D.length) return { ratio: null, nS: S.length, nD: D.length };
  const mS = median(S);
  const mD = median(D);
  /* Modes are 10-ms bins, so two segments can tie EXACTLY. medD = 0 with medS = 0 is a night where
     nothing moved at all — no information either way — and reads 1; medD = 0 with medS > 0 is the
     time-leaning extreme (posture changes agree perfectly, returns do not) and reads Infinity. */
  const ratio = mD > 0 ? mS / mD : mS > 0 ? Number.POSITIVE_INFINITY : 1;
  return { ratio, nS: S.length, nD: D.length, medS: mS, medD: mD };
}

/* Seeded LCG so the null is reproducible — the same night gives the same p every run. */
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

/* Within-night permutation null: shuffle the CLASS LABELS across the night's segments (the modes and
   their order stay), recompute R. p = share of draws with R ≤ observed. A night whose label
   permutations cannot produce both an S and a D pair is reported with p = null. */
export function permutationP(rows, observed, perms = PERMS, seed = 7) {
  const rnd = lcg(seed);
  let le = 0;
  let valid = 0;
  const labels = rows.map((r) => r.cls);
  for (let k = 0; k < perms; k++) {
    const sh = [...labels];
    for (let i = sh.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [sh[i], sh[j]] = [sh[j], sh[i]];
    }
    const r = ratioOf(rows.map((row, i) => ({ ...row, cls: sh[i] })));
    if (r.ratio == null) continue;
    valid++;
    if (r.ratio <= observed) le++;
  }
  return valid ? le / valid : null;
}

/* ── the verdict ──────────────────────────────────────────────────────────────────────────────────
   population = NIGHTS: checked (a ratio) + excluded (every named skip) = eligible (night dirs seen). */
export function runVerdict(nightRows, excludedBy, eligible, { commit = null, evidence = [] } = {}) {
  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const checked = nightRows.length;
  const excluded = Object.values(excludedBy).reduce((a, b) => a + b, 0);
  const ratios = nightRows.map((r) => r.ratio);
  const medR = checked ? median(ratios) : null;
  const shareBelow1 = checked ? ratios.filter((r) => r < 1).length / checked : null;
  let status;
  let reason;
  if (checked === 0) {
    status = 'NOT_RUN';
    reason = `no night reached a ratio — ${JSON.stringify(excludedBy)}`;
  } else if (checked < MIN_NIGHTS) {
    status = 'UNDERPOWERED';
    reason = `${checked} night(s) in the population, minimum ${MIN_NIGHTS} — the count is the result, not the ratio`;
  } else if (medR <= BAND_PHYS_RATIO && shareBelow1 >= BAND_PHYS_SHARE) {
    status = 'PASS';
    reason = `PHYSIOLOGY-LEANING: median same/different-posture ratio ${medR.toFixed(2)} ≤ ${BAND_PHYS_RATIO} and ${(100 * shareBelow1).toFixed(0)} % of nights < 1 — returning to a posture returns the mode`;
  } else if (medR >= BAND_TIME_RATIO) {
    status = 'FAIL';
    reason = `TIME-LEANING: median ratio ${medR.toFixed(2)} ≥ ${BAND_TIME_RATIO} — same-posture pairs agree no better than posture changes; the mode follows elapsed time, not the body. (FAIL is the contract word, not a tool failure.)`;
  } else {
    status = 'UNKNOWN';
    reason = `INDETERMINATE: median ratio ${medR.toFixed(2)}, ${(100 * shareBelow1).toFixed(0)} % of nights < 1 — between the pre-stated bands; the design ran and did not separate the hypotheses`;
  }
  const obj = {
    gate: 'pat-mode-posture',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'median_same_posture_over_adjacent_different_posture_mode_diff_ratio', threshold: BAND_PHYS_RATIO, unit: 'ratio', direction: 'lte' },
    /* The contract: a PASS carries `reason: null` — a PASS that needs explaining is not a PASS. The
       reading (which hypothesis the ratio leans to) is worth having on every status, so it lives in
       `result.reading`; `reason` carries it only when the status is not PASS. */
    result:
      status === 'NOT_RUN' ? null : { reading: reason, medianRatio: medR, shareBelow1, nights: nightRows, excludedBy, bands: { phys: [BAND_PHYS_RATIO, BAND_PHYS_SHARE], time: BAND_TIME_RATIO } },
    reason: status === 'PASS' ? null : reason,
    evidence,
    producedBy: commit
      ? { tool: 'tools/pat-mode-posture.mjs', commit }
      : { tool: 'tools/pat-mode-posture.mjs', commit: null, commitReason: 'git rev-parse --short HEAD failed (no checkout at the tool root)' }
  };
  return V.make(obj);
}

function gitCommitShort() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/* ── synthetic nights for the selftest and the corpus-free sample ─────────────────────────────────
   Two plants that DIFFER under the two hypotheses (signal-must-differ-under-both-hypotheses): the same
   posture sequence supine→left→supine→left→supine, R at 1 Hz, feet = R + lag(t) + jitter, and only the
   lag model changes. Under a model neither plant assumes, a constant lag, the ratio sits near 1. */
export function synthNight(model, { jitterMs = 8, seed = 3 } = {}) {
  const rnd = lcg(seed);
  const t0 = Date.UTC(2026, 0, 1, 23, 0, 0);
  const SEG = 20 * 60 * 1000; // 20-minute posture segments
  const classes = ['supine', 'left', 'supine', 'left', 'supine'];
  const gz = { supine: 0.97, left: 0.1 };
  const gx = { supine: 0.05, left: -0.95 };
  const acc = { t: [], x: [], y: [], z: [] };
  const r = [];
  const f = [];
  classes.forEach((cls, k) => {
    for (let ms = 0; ms < SEG; ms += 40) {
      // 25 Hz
      const t = t0 + k * SEG + ms;
      acc.t.push(t);
      acc.x.push(gx[cls] + (rnd() - 0.5) * 0.02);
      acc.y.push((rnd() - 0.5) * 0.02);
      acc.z.push(gz[cls] + (rnd() - 0.5) * 0.02);
    }
    for (let ms = 0; ms < SEG; ms += 1000) {
      const t = t0 + k * SEG + ms;
      const elapsedS = (t - t0) / 1000;
      const lag = model === 'physiology' ? (cls === 'supine' ? 300 : 420) : model === 'drift' ? 300 + elapsedS * 0.05 : 340;
      r.push(t);
      f.push(t + lag + (rnd() - 0.5) * 2 * jitterMs);
    }
  });
  return { acc, rTimes: r, fTimes: f.sort((a, b) => a - b) };
}

async function oracleFns() {
  const o = await import(join(HERE, 'pat-window-oracle.mjs'));
  return { rawLags: o.rawLags, lagMode: o.lagMode, searchMax: o.MODE_SEARCH_MAX };
}

export async function scoreNight(acc, rTimes, fTimes, { epochS = EPOCH_S, perms = PERMS, fns } = {}) {
  const F = fns || (await oracleFns());
  const segs = segments(postureEpochs(acc, epochS));
  const { rows, skipped } = segmentModes(segs, rTimes, fTimes, F);
  const R = ratioOf(rows);
  if (R.ratio == null)
    return { skip: rows.length < 2 ? 'fewer-than-2-scorable-segments' : R.nS === 0 ? 'no-same-posture-pair' : 'no-adjacent-different-posture-pair', segs: segs.length, rows, skipped };
  return { ratio: R.ratio, medS: R.medS, medD: R.medD, nS: R.nS, nD: R.nD, p: permutationP(rows, R.ratio, perms), segs: segs.length, rows, skipped };
}

export async function sampleRun() {
  const fns = await oracleFns();
  const rows = [];
  for (const [i, m] of ['physiology', 'physiology', 'drift', 'physiology', 'physiology', 'physiology'].entries()) {
    const n = synthNight(m, { seed: 11 + i });
    const s = await scoreNight(n.acc, n.rTimes, n.fTimes, { fns, perms: 50 });
    rows.push({ night: `<synthetic ${m} ${i}>`, ratio: s.ratio, p: s.p, nS: s.nS, nD: s.nD, segments: s.rows.length });
  }
  return { rows, excludedBy: { 'no-acc-sibling': 1 }, eligible: rows.length + 1 };
}

async function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const fns = await oracleFns();
  /* the three siblings' documented cases — a drift between the copies reds here */
  ok(classifyGravity(0.05, 0.02, 0.97) === 'supine' && classifyGravity(0.05, 0.02, -0.97) === 'prone', 'gz>0 ⇒ supine, gz<0 ⇒ prone (owner-confirmed sign)');
  ok(classifyGravity(0.46, 0.6, 0.65) === 'upright', 'the intermediate-tilt case g=(0.46,0.6,0.65) is UPRIGHT under the threshold scheme (deep-audit H), not supine by argmax');
  ok(classifyGravity(-0.9, 0.1, 0.2) === 'left' && classifyGravity(0.9, 0.1, 0.2) === 'right', 'lateral by x sign');
  ok(classifyGravity(0.1, 0.1, 0.1) === 'unknown' && classifyGravity(2, 2, 2) === 'unknown', 'off-magnitude ⇒ unknown, never a posture');
  /* parse: the capture-host layout line, ms kept, mg → g */
  const a = parseAcc('Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]\n2026-08-04T22:48:10.115;599616068360302728;-733;115;51\n2026-08-04T22:48:10.155;5996;-700;100;60\n');
  ok(a.t.length === 2 && a.t[0] === Date.UTC(2026, 7, 4, 22, 48, 10, 115) && Math.abs(a.x[0] + 0.733) < 1e-9, 'parseAcc reads the phone stamp by regex onto the floating axis and scales mg→g');
  const a6 = parseAcc('Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]\n2026-07-16T21:08:59.143;599635091648980304;0.0;-707;-19;681\n');
  ok(
    a6.t.length === 1 && Math.abs(a6.x[0] + 0.707) < 1e-9 && Math.abs(a6.z[0] - 0.681) < 1e-9,
    'the EARLY six-column layout (extra `timestamp [ms]`) parses to the same triple — the 2026-07 nights are not acc-empty'
  );
  /* segments: unknown dropped without breaking, a class change breaks, a long gap breaks */
  const E = (k, cls) => ({ start: k * 30000, end: (k + 1) * 30000, cls });
  const sg = segments([E(0, 'supine'), E(1, 'unknown'), E(2, 'supine'), E(3, 'left'), E(4, 'left'), E(30, 'left')]);
  ok(
    sg.length === 3 && sg[0].cls === 'supine' && sg[0].end === 90000 && sg[1].cls === 'left' && sg[2].cls === 'left',
    `unknown does not break a run, a class change does, a >5 min gap does — got ${JSON.stringify(sg.map((s) => [s.cls, s.start / 30000, s.end / 30000]))}`
  );
  /* pair sets */
  const rows = [
    { cls: 'supine', mode: 300 },
    { cls: 'left', mode: 400 },
    { cls: 'supine', mode: 310 },
    { cls: 'left', mode: 390 }
  ];
  const ps = pairSets(rows);
  ok(ps.S.length === 2 && ps.D.length === 3 && ps.S.includes(10) && ps.D.includes(100), `S = same-class pairs at any separation (2), D = adjacent different (3): ${JSON.stringify(ps)}`);
  ok(Math.abs(ratioOf(rows).ratio - 10 / 90) < 1e-9, 'ratio = median(S)/median(D)');
  /* THE TWO PLANTS DIFFER — physiology returns the mode, drift does not */
  const P = synthNight('physiology');
  const sP = await scoreNight(P.acc, P.rTimes, P.fTimes, { fns, perms: 100 });
  ok(sP.ratio != null && sP.ratio < 0.5 && sP.rows.length === 5, `PHYSIOLOGY plant: 5 segments, ratio ${sP.ratio?.toFixed(3)} < 0.5 (same posture ⇒ same mode)`);
  ok(sP.p != null && sP.p <= 0.1, `…and the permutation null puts it in the tail (p=${sP.p})`);
  const Dn = synthNight('drift');
  const sD = await scoreNight(Dn.acc, Dn.rTimes, Dn.fTimes, { fns, perms: 100 });
  ok(sD.ratio != null && sD.ratio >= 1, `DRIFT plant (0.05 ms/s, posture-blind): ratio ${sD.ratio?.toFixed(3)} ≥ 1 (same-posture pairs span longer, agree less)`);
  const C = synthNight('constant', { jitterMs: 45 });
  const sC = await scoreNight(C.acc, C.rTimes, C.fTimes, { fns, perms: 100 });
  ok(sC.ratio != null && sC.ratio > 0.3 && sC.ratio < 3, `CONSTANT lag + 45 ms jitter (a model neither plant assumes): ratio ${sC.ratio?.toFixed(3)} near 1, not in either band's tail`);
  ok(
    ratioOf([
      { cls: 'a', mode: 300 },
      { cls: 'b', mode: 300 },
      { cls: 'a', mode: 300 }
    ]).ratio === 1,
    'an all-tied night (medS = medD = 0) reads 1, not Infinity or NaN'
  );
  /* short segments are counted, not silently absent */
  const short = segmentModes([{ cls: 'supine', start: 0, end: 1000 }], [1, 2, 3], [4, 5, 6], fns);
  ok(short.rows.length === 0 && short.skipped.short === 1, 'a segment under MIN_BEATS is SKIPPED BY NAME and counted');
  /* the verdict: bands, equality, closed vocabulary, NOT_RUN carries null */
  const mk = (ratios) => ratios.map((r, i) => ({ night: `n${i}`, ratio: r, p: 0.1 }));
  const vP = runVerdict(mk([0.2, 0.3, 0.4, 0.1, 0.9, 0.3]), { short: 2 }, 8);
  ok(
    vP.status === 'PASS' && vP.reason === null && /PHYSIOLOGY/.test(vP.result.reading) && vP.population.checked + vP.population.excluded === vP.population.eligible,
    `six nights, median 0.3, 100 % < 1 ⇒ PASS (physiology) and 6+2=8: ${vP.status}`
  );
  const vF = runVerdict(mk([1.2, 0.9, 1.5, 2, 1.1]), {}, 5);
  ok(vF.status === 'FAIL' && /TIME-LEANING/.test(vF.reason) && /not a tool failure/.test(vF.reason), 'median 1.2 ⇒ FAIL (time-leaning), and the reason says FAIL is not a tool failure');
  ok(runVerdict(mk([0.7, 0.8, 0.6, 0.9, 0.4]), {}, 5).status === 'UNKNOWN', 'median 0.7 ⇒ UNKNOWN (indeterminate, between the bands)');
  ok(runVerdict(mk([0.1, 0.1, 0.1, 0.1]), { 'no-acc-sibling': 3 }, 7).status === 'UNDERPOWERED', 'four nights ⇒ UNDERPOWERED even at ratio 0.1 — the count is the result');
  const v0 = runVerdict([], { short: 4 }, 4);
  ok(v0.status === 'NOT_RUN' && v0.result === null, 'zero nights ⇒ NOT_RUN with result null');
  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const sr = await sampleRun();
  const vs = runVerdict(sr.rows, sr.excludedBy, sr.eligible, { commit: 'abc1234', evidence: ['<sample>'] });
  ok(V.validate(vs).ok, `the sample verdict validates under verdict.js: ${JSON.stringify(V.validate(vs).errors)}`);
  const N = 21;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`SELFTEST FAIL (${fails.length} of ${N})`);
    process.exit(1);
  }
  console.log(`SELFTEST PASS (${N}/${N})`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    const s = await sampleRun();
    console.log(JSON.stringify(runVerdict(s.rows, s.excludedBy, s.eligible, { commit: gitCommitShort(), evidence: ['<sample>'] }), null, 2));
    return;
  }
  const DIR = argv[argv.indexOf('--dir') + 1];
  const EPOCH = Number(argv.includes('--epoch') ? argv[argv.indexOf('--epoch') + 1] : EPOCH_S);
  const NPERM = Number(argv.includes('--perms') ? argv[argv.indexOf('--perms') + 1] : PERMS);
  const JSON_OUT = argv.includes('--json');
  if (!DIR || !existsSync(DIR)) {
    console.error('usage: node tools/pat-mode-posture.mjs --dir <captures root> [--json] [--epoch 30] [--perms 200] | --selftest | --verdict-sample');
    process.exit(2);
  }
  const o = await import(join(HERE, 'pat-window-oracle.mjs'));
  const fns = { rawLags: o.rawLags, lagMode: o.lagMode, searchMax: o.MODE_SEARCH_MAX };
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  getDsps();
  const nights = readdirSync(DIR)
    .filter((n) => /^2026-/.test(n) && statSync(join(DIR, n)).isDirectory())
    .sort();
  const excludedBy = {};
  const skip = (n, why) => {
    excludedBy[why] = (excludedBy[why] || 0) + 1;
    console.log(`${n}  ⊘ ${why}`);
  };
  const nightRows = [];
  console.log(`epoch ${EPOCH} s · min beats/segment ${MIN_BEATS} · perms ${NPERM} · bands: PHYS median≤${BAND_PHYS_RATIO} & ≥${100 * BAND_PHYS_SHARE}% <1 · TIME median≥${BAND_TIME_RATIO}`);
  console.log('night        segs  scored   nS   nD   med|ΔS|  med|ΔD|   ratio     p    classes');
  for (const n of nights) {
    const dir = join(DIR, n);
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      skip(n, 'unreadable-night-dir');
      continue;
    }
    const paired = o.pickPair(dir, files);
    if (paired.missing) {
      skip(n, 'missing-stream');
      continue;
    }
    const accPath = paired.eF.replace(/_ECG\.txt$/, '_ACC.txt');
    if (!existsSync(accPath)) {
      skip(n, 'no-acc-sibling');
      continue;
    }
    let E;
    let P;
    let acc;
    try {
      E = ecgRpeakTimes(readFileSync(paired.eF, 'utf8'), { refine: true });
      P = ppgFootTimes(readFileSync(paired.pF, 'utf8'));
      acc = parseAcc(readFileSync(accPath, 'utf8'));
    } catch (e) {
      skip(n, `parse-error: ${String(e.message).slice(0, 50)}`);
      continue;
    }
    const rTimes = Array.from(E.times);
    const fTimes = Array.from(P.times).filter(Number.isFinite);
    if (rTimes.length < MIN_BEATS || fTimes.length < MIN_BEATS) {
      skip(n, 'too-few-beats');
      continue;
    }
    if (!acc.t.length) {
      skip(n, 'acc-empty');
      continue;
    }
    const s = await scoreNight(acc, rTimes, fTimes, { epochS: EPOCH, perms: NPERM, fns });
    if (s.skip) {
      skip(n, s.skip);
      continue;
    }
    const classes = s.rows.map((r) => r.cls[0]).join('');
    nightRows.push({ night: n, ratio: s.ratio, p: s.p, nS: s.nS, nD: s.nD, medS: s.medS, medD: s.medD, segments: s.rows.length, classes, rows: JSON_OUT ? s.rows : undefined });
    console.log(
      `${n}  ${String(s.segs).padStart(4)}  ${String(s.rows.length).padStart(6)}  ${String(s.nS).padStart(3)}  ${String(s.nD).padStart(3)}  ${s.medS.toFixed(0).padStart(7)}  ${s.medD.toFixed(0).padStart(7)}  ${s.ratio.toFixed(3).padStart(6)}  ${s.p == null ? '  n/a' : s.p.toFixed(2).padStart(5)}    ${classes}`
    );
  }
  console.log('\nSKIPPED:', JSON.stringify(excludedBy));
  const v = runVerdict(nightRows, excludedBy, nights.length, { commit: gitCommitShort(), evidence: [DIR] });
  console.log(`${v.status} — ${v.result ? v.result.reading : v.reason}`);
  console.log('VERDICT ' + JSON.stringify(JSON_OUT ? v : { ...v, result: v.result && { ...v.result, nights: v.result.nights.map((r) => ({ night: r.night, ratio: r.ratio, p: r.p })) } }));
}

if (process.argv[1]?.endsWith('pat-mode-posture.mjs')) await main();
