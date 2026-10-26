#!/usr/bin/env node
/*
 * tools/tch-reference-record.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE PUBLIC RECORD OF THE HAT'S REFERENCE CHECK — pooled figures only, and the card reads it.
 *
 * `tools/tch-firmware-reference.mjs` scores each night against a two-detector beat consensus and
 * writes one row per night to a ledger that lives OUTSIDE every checkout: those rows are numbers
 * about a person's nights, and the owner ruled on 2026-09-24 that they stay off the public repo.
 * This tool reads the two run objects that tool prints (`--axis host` and `--axis wall`, both with
 * `--solid auto`), keeps the POOLED figures, and writes two artifacts:
 *
 *   1. `analysis/published-numbers/tch-firmware-reference-<date>.json` — the published record.
 *   2. `codegen/generated/tch-reference-record.js` — the same bytes as a classic script, which
 *      `tools/build-analysis.mjs` inlines into `sensor-trio-night.html`. The card composes its
 *      validation note from it, so no number on the card is typed by hand
 *      (TCH-REFERENCE-POPULATIONS §5.3). A card that cannot find the record REFUSES the note; it
 *      never falls back to a stale sentence.
 *
 * WHAT IT DECIDES (two verdicts, both pre-stated):
 *
 *   `tch-reference-record:no-private-data` — three rules over every leaf of the record: no absolute
 *   filesystem path, no array of more than two ISO dates (a date range IS two), and no per-night row
 *   array. Rule 1 also REWRITES the run verdicts' `evidence`, which names the corpus root, to
 *   CORPUS_PLACEHOLDER; the scan then re-reads what was written, so the verdict judges the bytes and
 *   not the intention. A FAIL here means the record must not be committed.
 *
 *   `tch-reference-record:bias-stratum` (one per axis) — §4's second criterion, which the first
 *   full-corpus run left owed: is the solid stratum's mean bias the same sign as the all-nights mean
 *   AND inside the all-nights 95 % CI? Same sign and inside ⇒ the misread is the estimator's, not the
 *   nights'. The CI is a BOOT_DRAWS-draw bootstrap of the mean on a fixed seed, so it reproduces
 *   byte-for-byte. Three statuses, in this pre-stated order:
 *     · solid nights < CI_MIN_NIGHTS ⇒ UNDERPOWERED. The bound is twice the sibling tool's own
 *       MIN_NIGHTS and is a property of the COUNT, fixed before any value is read (§4: "The solid
 *       stratum will most likely read UNDERPOWERED. Report it with its n and a bound. Do not call it
 *       a FAIL.").
 *     · else, any judged corner whose all-nights CI CONTAINS ZERO ⇒ UNKNOWN. A sign comparison
 *       against an interval that straddles zero decides nothing, and reporting it as a PASS would
 *       read as agreement where there is no measurement.
 *     · else PASS when every judged corner meets both legs, FAIL otherwise.
 *   The H10 is REPORTED, NEVER JUDGED, exactly as in the sibling tool: the reference is built from
 *   its own detections, so its measured error is a lower bound on something the reference cannot see.
 *
 * The paired drift (host − wall on the reference-measured σ, per corner) is carried too, against
 * §4's 0.05 bpm line. It is a PAIRED comparison over the nights both runs scored.
 *
 * Pure, no network. Deterministic: same two run objects in, same bytes out, apart from `generated`
 * and `producedBy.commit`.
 *
 * USAGE
 *   node tools/tch-reference-record.mjs --host <host run.json> --wall <wall run.json> [--date YYYY-MM-DD]
 *   node tools/tch-reference-record.mjs --host h.json --wall w.json --out analysis/published-numbers/tch-firmware-reference-2026-10-18.json --js codegen/generated/tch-reference-record.js
 *   node tools/tch-reference-record.mjs --selftest | --verdict-sample
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BAND_ABS, BAND_REL, MIN_NIGHTS, PASS_FRAC, median, withinBand } from './tch-firmware-reference.mjs';
import { isCliEntry } from './argv-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const req = createRequire(import.meta.url);
const V = req(path.join(ROOT, 'verdict.js'));

export const SCHEMA = 'tepna.published-number-record/1';
export const KEYS = ['h10', 'verity', 'o2'];
export const JUDGED = ['verity', 'o2'];
export const AXES = ['host', 'wall'];
export const BOOT_DRAWS = 20000;
export const BOOT_SEED = 20260926;
export const CI_MIN_NIGHTS = 2 * MIN_NIGHTS;
export const DRIFT_LINE = 0.05;
export const CORPUS_PLACEHOLDER = '<box captures root>/**/{*_ECG.txt,*_RR.txt,*_PPG.txt,*_SPO2.csv}';
export const TWIN_GLOBAL = 'TCH_REFERENCE_RECORD';
export const SUPERSEDES = 'analysis/published-numbers/tch-firmware-reference-2026-09-26.json';
export const BRIEF = 'briefs/TCH-REFERENCE-POPULATIONS-2026-10-13-BRIEF.md';

const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function okRows(run) {
  return ((run && run.detail && run.detail.nights) || []).filter((r) => r && r.ok);
}

/* ── the bootstrap: one PRNG, one seed, so a CI is a fact about the data and not about the run ──── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootCiMean(xs, draws = BOOT_DRAWS, seed = BOOT_SEED) {
  const x = xs.filter(Number.isFinite);
  if (!x.length) return null;
  const rnd = mulberry32(seed);
  const ms = new Array(draws);
  for (let b = 0; b < draws; b++) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[(rnd() * x.length) | 0];
    ms[b] = s / x.length;
  }
  ms.sort((a, b) => a - b);
  return { n: x.length, mean: mean(x), median: median(x), lo: ms[Math.floor(0.025 * draws)], hi: ms[Math.ceil(0.975 * draws) - 1] };
}

/* ── §8's paired drift, recomputed from the two runs rather than quoted from the brief ──────────── */
/* A PAIR IS ONLY A PAIR WHEN BOTH LEGS CARRY THE SAME REFERENCE AXIS. `detail.axis` was the only
   thing the two legs were ever checked on, and that check cannot see which timebase the REFERENCE was
   built on (`tools/tch-firmware-reference.mjs --reference-axis`, residue
   2026-10-18-tch-reference-and-h10-corner-sit-on-two-axes). A device-axis host leg against a
   corrected-axis wall leg differs in TWO things at once, and the difference would be published as the
   host discipline's cost. A legacy run carries no `detail.referenceAxis` and reads as `device`, which
   is the only axis the reference ever had before the option existed. */
export const REF_AXIS_DEFAULT = 'device';
export function runReferenceAxis(run) {
  return (run && run.detail && run.detail.referenceAxis) || REF_AXIS_DEFAULT;
}
export function pairedDrift(hostRun, wallRun) {
  const hRef = runReferenceAxis(hostRun),
    wRef = runReferenceAxis(wallRun);
  if (hRef !== wRef) {
    const corners = {};
    for (const k of KEYS) corners[k] = null;
    return {
      quantity: 'reference-measured σ, host axis − wall axis, per night',
      nights: 0,
      first: null,
      last: null,
      line: DRIFT_LINE,
      referenceAxis: null,
      refused:
        'the host leg built its reference on the ' +
        hRef +
        ' axis and the wall leg on the ' +
        wRef +
        ' axis — a σ is not comparable across reference axes either, so the difference would carry two changes at once',
      corners
    };
  }
  const H = new Map(okRows(hostRun).map((r) => [r.night, r]));
  const W = new Map(okRows(wallRun).map((r) => [r.night, r]));
  const nights = [...H.keys()].filter((n) => W.has(n)).sort();
  const corners = {};
  for (const k of KEYS) {
    const d = nights.map((n) => H.get(n).trueSd[k] - W.get(n).trueSd[k]).filter(Number.isFinite);
    corners[k] = d.length
      ? { n: d.length, medianAbs: r3(median(d.map(Math.abs))), median: r3(median(d)), hostLarger: d.filter((v) => v > 0).length, material: median(d.map(Math.abs)) > DRIFT_LINE }
      : null;
  }
  return {
    quantity: 'reference-measured σ, host axis − wall axis, per night',
    nights: nights.length,
    first: nights[0] || null,
    last: nights[nights.length - 1] || null,
    line: DRIFT_LINE,
    referenceAxis: hRef,
    refused: null,
    corners
  };
}

/* ── per corner, how many nights the classic hat put inside the pre-stated band ─────────────────── */
export function inBandCounts(run) {
  const rows = okRows(run);
  const out = {};
  for (const k of KEYS) {
    const judged = rows.filter((r) => r.hat && r.trueSd && Number.isFinite(r.hat[k]) && Number.isFinite(r.trueSd[k]));
    const pass = judged.filter((r) => withinBand(r.hat[k], r.trueSd[k])).length;
    const fraction = judged.length ? r3(pass / judged.length) : null;
    /* THE CORNER'S LABEL IS THE PER-NIGHT RATE AGAINST THE PRE-STATED PASS_FRAC, never the pooled
       medians. On this corpus every corner's MEDIAN σ̂ sits inside the band while the Verity clears it
       on 54 % of nights: a median difference is not the band test, and a card that read the medians
       would call a corner checked that the estimator misses half the time. */
    out[k] = { pass, of: judged.length, fraction, status: fraction == null ? null : fraction >= PASS_FRAC ? 'reference-checked' : 'unvalidated', reads: readsHowOff(rows, k) };
  }
  return out;
}

/* over-reads / under-reads: the SIGN of (hat − true) on the pooled medians, so the card never has to
   decide it from a hard-coded sentence. The sign is a direction and says nothing about the band —
   whether the corner is reference-checked is the per-night rate in `inBandCounts`. */
export function readsHowOff(rows, k) {
  const hat = median(rows.map((r) => r.hat && r.hat[k]).filter(Number.isFinite));
  const tru = median(rows.map((r) => r.trueSd && r.trueSd[k]).filter(Number.isFinite));
  if (!Number.isFinite(hat) || !Number.isFinite(tru)) return null;
  if (r3(hat) === r3(tru)) return 'matches';
  return hat > tru ? 'over-reads' : 'under-reads';
}

/* ── §4's second criterion ──────────────────────────────────────────────────────────────────────── */
export function biasStratum(run, opts = {}) {
  const rows = okRows(run);
  const solidList = (run && run.detail && run.detail.solid && run.detail.solid.nights) || [];
  const solid = new Set(solidList);
  const sol = rows.filter((r) => solid.has(r.night));
  const corners = {};
  for (const k of KEYS) {
    const all = bootCiMean(rows.map((r) => r.bias && r.bias[k]).filter(Number.isFinite), opts.draws, opts.seed);
    const str = sol.length ? bootCiMean(sol.map((r) => r.bias && r.bias[k]).filter(Number.isFinite), opts.draws, opts.seed) : null;
    /* BOTH LEGS ARE EVALUATED AT THE PUBLISHED PRECISION — the three decimals this record prints,
       which is what a reader can re-check. On the raw doubles a constant sample's mean differs in the
       last bits between two sample sizes, and `inside` then flips on a float artifact rather than on
       a measurement; the CI widths here are ~0.01–0.08 bpm, two orders above the rounding step. */
    const zeroCrossing = all ? r3(all.lo) <= 0 && r3(all.hi) >= 0 : null;
    const sameSign = all && str ? Math.sign(r3(all.mean)) === Math.sign(r3(str.mean)) : null;
    const insideCi = all && str ? r3(str.mean) >= r3(all.lo) && r3(str.mean) <= r3(all.hi) : null;
    corners[k] = {
      judged: JUDGED.indexOf(k) >= 0,
      allNights: all ? { n: all.n, mean: r3(all.mean), median: r3(all.median), ci: [r3(all.lo), r3(all.hi)] } : null,
      stratum: str ? { n: str.n, mean: r3(str.mean), median: r3(str.median), ci: [r3(str.lo), r3(str.hi)] } : null,
      sameSign,
      insideCi,
      zeroCrossing,
      meets: sameSign === true && insideCi === true
    };
  }
  const judged = KEYS.filter((k) => corners[k].judged);
  const n = sol.length;
  const met = judged.filter((k) => corners[k].meets).length;
  const crossing = judged.filter((k) => corners[k].zeroCrossing === true);
  let status, reason;
  if (!rows.length) {
    status = 'NOT_RUN';
    reason = 'the run scored no night, so no bias exists to stratify';
  } else if (n < CI_MIN_NIGHTS) {
    status = 'UNDERPOWERED';
    reason = `${n} solid night(s) against the pre-stated minimum of ${CI_MIN_NIGHTS} (twice the sibling tool's MIN_NIGHTS of ${MIN_NIGHTS}) — the per-corner comparison is reported, not decided`;
  } else if (crossing.length) {
    status = 'UNKNOWN';
    reason = `the all-nights bias CI contains zero on ${crossing.join(' and ')}, so a sign comparison decides nothing`;
  } else if (met === judged.length) {
    status = 'PASS';
    reason = null;
  } else {
    status = 'FAIL';
    reason = `${met}/${judged.length} judged corner(s) meet both legs — a stratum bias outside the all-nights CI says the nights, not the estimator, carry part of the misread`;
  }
  return { status, reason, stratumNights: n, stratumListed: solidList.length, allNights: rows.length, judged, met, corners };
}

export function biasStratumVerdict(run, meta = {}) {
  const b = biasStratum(run, meta);
  const span = okRows(run)
    .map((r) => r.night)
    .sort();
  const solidSpan = okRows(run)
    .filter((r) => ((run.detail && run.detail.solid && run.detail.solid.nights) || []).indexOf(r.night) >= 0)
    .map((r) => r.night)
    .sort();
  return V.make({
    gate: 'tch-reference-record:bias-stratum',
    status: b.status,
    population: {
      name: 'solid vs all',
      checked: b.stratumNights,
      eligible: b.allNights,
      excluded: b.allNights - b.stratumNights,
      first: solidSpan[0] || span[0] || null,
      last: solidSpan[solidSpan.length - 1] || span[span.length - 1] || null
    },
    criterion: { name: 'solid_stratum_mean_bias_same_sign_and_inside_all_nights_95ci', threshold: b.judged.length, unit: 'judged corners', direction: 'gte' },
    result: b.status === 'NOT_RUN' ? null : { axis: (run.detail && run.detail.axis) || null, met: b.met, judged: b.judged, draws: BOOT_DRAWS, seed: BOOT_SEED, corners: b.corners },
    evidence: ['tools/tch-reference-record.mjs', 'tools/tch-firmware-reference.mjs', CORPUS_PLACEHOLDER],
    reason: b.reason,
    producedBy: { tool: 'tools/tch-reference-record.mjs', commit: meta.commit || null, ...(meta.commit ? {} : { commitReason: 'not run from a git checkout' }) },
    at: meta.at
  });
}

/* ── §4's materiality line, spent on ONE pre-stated question ────────────────────────────────────── */
/* DOES MATCHING THE REFERENCE AXIS REMOVE THE H10's HOST-MINUS-WALL GAP?
   TCH-REFERENCE-POPULATIONS §8 published +0.540 bpm median Δσ on the H10 with host larger on 53 of 54
   nights, one-sided, against −0.444 (7 of 54) and −0.278 (15 of 54) on the two optical corners. §8's
   own reading: the H10's direction is the §2.3 axis defect rather than drift, because the reference
   rode the raw device counter while the corner rode the corrected one.

   THE CRITERION IS STATED HERE, BEFORE THE RUN THAT JUDGES IT (brief
   TCH-REFERENCE-AXIS-MATCH-2026-10-20 §3): with the reference placed on the corner's own axis, the
   H10's median paired |Δσ| against the wall leg is AT OR UNDER §4's materiality line of
   ${DRIFT_LINE} bpm. PASS ⇒ the published gap was the mismatch. FAIL ⇒ the gap survives a matched
   axis and the mismatch is not its cause — which is a finding, not a threshold to move.

   THE SIDEDNESS IS REPORTED, NEVER DECIDED, and its band is pre-stated too: a two-sided difference
   puts `hostLarger` inside [${AXIS_MATCH_SIDED[0]}, ${AXIS_MATCH_SIDED[1]}] of the scored nights.
   It is a second quantity over the same data, and a verdict carries one criterion. */
export const AXIS_MATCH_LINE = DRIFT_LINE;
export const AXIS_MATCH_SIDED = [0.25, 0.75];
export function axisMatchVerdict(runs, meta = {}) {
  const drift = pairedDrift(runs.host, runs.wall),
    hRef = runReferenceAxis(runs.host),
    h = drift.corners.h10,
    frac = h && drift.nights ? h.hostLarger / h.n : null;
  let status, reason, result;
  if (drift.refused) {
    status = 'NOT_RUN';
    reason = drift.refused;
    result = null;
  } else if (hRef !== 'corrected') {
    status = 'NOT_APPLICABLE';
    /* The contract wants `result: null` here, and that is the right shape: the criterion does not
       bind, so there is no measurement of it. The figures this run DOES hold are the mismatch's own
       cost, and they ride `pairedDrift` in the record beside this verdict. */
    reason =
      'the host leg built its reference on the ' +
      hRef +
      ' axis (' +
      drift.nights +
      ' paired night(s)), so this run is the mismatch itself and not a test of it — re-run the host leg with --reference-axis corrected';
    result = null;
  } else if (!h || drift.nights < MIN_NIGHTS) {
    status = 'UNDERPOWERED';
    reason = drift.nights + ' paired night(s) against the pre-stated minimum of ' + MIN_NIGHTS + (h ? '' : ' and no H10 Δσ was computable');
    result = { referenceAxis: hRef, h10: h, nights: drift.nights };
  } else {
    status = h.medianAbs <= AXIS_MATCH_LINE ? 'PASS' : 'FAIL';
    reason =
      status === 'PASS'
        ? null
        : 'the H10 median |Δσ| is ' +
          h.medianAbs +
          " bpm with the reference on the corner's own axis, over §4's line of " +
          AXIS_MATCH_LINE +
          ' bpm (host larger on ' +
          h.hostLarger +
          ' of ' +
          h.n +
          ' nights) — a matched reference axis does not account for the gap';
    result = {
      referenceAxis: hRef,
      h10: h,
      verity: drift.corners.verity,
      o2: drift.corners.o2,
      nights: drift.nights,
      sidedness: {
        hostLarger: h.hostLarger,
        of: h.n,
        fraction: frac == null ? null : r3(frac),
        band: AXIS_MATCH_SIDED,
        twoSided: frac != null && frac >= AXIS_MATCH_SIDED[0] && frac <= AXIS_MATCH_SIDED[1]
      }
    };
  }
  return V.make({
    gate: 'tch-reference-record:axis-match',
    status,
    population: {
      name: 'nights paired across the two clock axes',
      checked: status === 'NOT_RUN' ? 0 : drift.nights,
      eligible: status === 'NOT_RUN' ? 0 : drift.nights,
      excluded: 0,
      first: drift.first,
      last: drift.last
    },
    criterion: { name: 'h10_median_abs_dsigma_matched_reference_axis_vs_wall', threshold: AXIS_MATCH_LINE, unit: 'bpm', direction: 'lte' },
    result,
    evidence: ['tools/tch-reference-record.mjs', 'tools/tch-firmware-reference.mjs', 'briefs/TCH-REFERENCE-AXIS-MATCH-2026-10-20-BRIEF.md', CORPUS_PLACEHOLDER],
    reason,
    producedBy: { tool: 'tools/tch-reference-record.mjs', commit: meta.commit || null, ...(meta.commit ? {} : { commitReason: 'not run from a git checkout' }) },
    at: meta.at
  });
}

/* ── the privacy scrub: rewrite, then judge what was written ────────────────────────────────────── */
const ABS_PATH = /(^|[\s"'(=])(\/[A-Za-z0-9_.-]+\/[^\s"')]*|[A-Za-z]:\\[^\s"')]*)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function scrubPaths(x) {
  if (typeof x === 'string') return ABS_PATH.test(x) ? CORPUS_PLACEHOLDER : x;
  if (Array.isArray(x)) return x.map(scrubPaths);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = scrubPaths(x[k]);
    return o;
  }
  return x;
}

export function privateDataFindings(rec) {
  const f = [];
  let leaves = 0;
  const walk = (x, at) => {
    if (Array.isArray(x)) {
      const dates = x.filter((v) => typeof v === 'string' && ISO_DATE.test(v));
      if (dates.length > 2) f.push(`${at}: ${dates.length} ISO dates in one array — a date RANGE is two, a list of nights is per-night data`);
      if (x.some((v) => v && typeof v === 'object' && !Array.isArray(v) && ('trueSd' in v || 'bias' in v || 'hat' in v))) f.push(`${at}: an array of per-night rows`);
      x.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) walk(x[k], at ? `${at}.${k}` : k);
      return;
    }
    leaves++;
    if (typeof x === 'string' && ABS_PATH.test(x)) f.push(`${at}: an absolute filesystem path`);
  };
  walk(rec, '');
  return { findings: f, leaves };
}

export function scrubVerdict(rec, meta = {}) {
  const p = privateDataFindings(rec);
  return V.make({
    gate: 'tch-reference-record:no-private-data',
    status: p.findings.length ? 'FAIL' : 'PASS',
    scope: 'publishable',
    population: { name: 'record leaves', checked: p.leaves, eligible: p.leaves, excluded: 0 },
    criterion: { name: 'record_leaves_free_of_corpus_paths_night_lists_and_per_night_rows', threshold: 0, unit: 'findings', direction: 'lte' },
    result: { findings: p.findings.length, rules: 3 },
    evidence: ['tools/tch-reference-record.mjs', meta.out || 'analysis/published-numbers/tch-firmware-reference-<date>.json'],
    reason: p.findings.length ? p.findings.slice(0, 6).join(' · ') : null,
    producedBy: { tool: 'tools/tch-reference-record.mjs', commit: meta.commit || null, ...(meta.commit ? {} : { commitReason: 'not run from a git checkout' }) },
    at: meta.at
  });
}

/* ── the record ─────────────────────────────────────────────────────────────────────────────────── */
export function buildRecord(runs, meta = {}) {
  const axes = {};
  for (const ax of AXES) {
    const run = runs[ax];
    if (!run) continue;
    const pops = {};
    for (const v of run.verdicts || []) pops[(v.population && v.population.name) || v.gate] = scrubPaths(v);
    const P = (run.detail && run.detail.pooled) || {};
    axes[ax] = { populations: pops, classic: P.classic || null, correlated: P.correlated || null, inBand: inBandCounts(run), biasStratum: biasStratum(run, meta) };
  }
  const H = axes.host && axes.host.populations.all;
  const Hres = (H && H.result) || {};
  const med = Hres.medians || {};
  const drift = pairedDrift(runs.host, runs.wall);
  /* THE SCORED SPAN, NOT THE ELIGIBLE ONE. A population verdict's first/last covers every eligible
     night, refusals included; the card prints a night COUNT beside its dates, so the two must
     describe the same set or the note reads as 54 nights spread over a range that holds 94. */
  const scored = okRows(runs.host)
    .map((r) => r.night)
    .sort();
  const maxAbsBias = Math.max(...KEYS.map((k) => Math.abs((med[k] && med[k].bias) || 0)));
  const rec = {
    schema: SCHEMA,
    producer: 'tools/tch-reference-record.mjs',
    producerCommit: meta.commit || null,
    invocation:
      'node tools/tch-reference-record.mjs --host <host run of tools/tch-firmware-reference.mjs --axis host --solid auto --json> --wall <the same with --axis wall> --out <this file> --js codegen/generated/tch-reference-record.js',
    generated: meta.generated || new Date().toISOString().slice(0, 10),
    supersedes: SUPERSEDES,
    brief: BRIEF,
    inputs: {
      path: '<box captures root>/<night>/',
      committed: false,
      note: 'raw H10 ECG + firmware RR, Verity PPG, O2Ring PPG; gitignored and owner-ruled (2026-09-24) to stay off the public repo, so only POOLED figures are recorded here — no per-night row, no night list'
    },
    deterministic:
      'the reference and every corner are deterministic functions of the files; no sampling. The stratum CI is a ' +
      BOOT_DRAWS +
      '-draw bootstrap of the mean on the fixed seed ' +
      BOOT_SEED +
      ', so it reproduces byte-for-byte',
    publishedIn: 'sensor-trio-night.html (the validation note under the per-device heroes), which inlines codegen/generated/tch-reference-record.js — the card composes every figure from this record',
    axisCanonical: 'host',
    referenceAxisCanonical: runReferenceAxis(runs.host),
    referenceAxisNote:
      'which timebase the two-detector REFERENCE was built on. device is the status quo and the default: the beat clock is the raw device counter (ecgdex-dsp.js analyze). corrected places the reference on rec.tMsAt, the same axis the H10 corner already rides, which is what makes the H10 leg a same-axis comparison',
    axisNote:
      'host is the status quo: ECGDex and PpgDex already add DexClock.hostAxis correctionAt to the device counter, so the card runs on the host-disciplined axis. wall is the counterfactual leg — hostAxis suppressed, each parser on its raw device counter',
    band: { abs: BAND_ABS, rel: BAND_REL, passFraction: PASS_FRAC, minNights: MIN_NIGHTS },
    axes,
    pairedDrift: drift,
    /* TWO SPANS, NAMED. `claims.dateFirst/dateLast` is the span of the nights that were SCORED and is
       the pair that belongs beside `nightsScored`; each verdict's own `population.first/last` is the
       ELIGIBLE span, which is wider because a night can be eligible and refused. The card prints the
       scored pair, and this note exists because quoting a count from one set with a range from the other
       is the §2 defect in a different place. */
    claimsNote:
      'dateFirst/dateLast is the span of the SCORED nights (nightsScored). eligibleFirst/eligibleLast, and each verdict population.first/last, is the wider ELIGIBLE span: a night can be eligible and refused. Never quote a count from one set with a range from the other',
    claims: {
      nightsScored: (H && H.population.checked) || null,
      nightsEligible: (H && H.population.eligible) || null,
      dateFirst: scored[0] || null,
      dateLast: scored[scored.length - 1] || null,
      eligibleFirst: (H && H.population.first) || null,
      eligibleLast: (H && H.population.last) || null,
      classicPassFraction: r3(Hres.classicPassFraction),
      h10Measured: r3(med.h10 && med.h10.trueSd),
      h10Hat: r3(med.h10 && med.h10.classic),
      verityTrue: r3(med.verity && med.verity.trueSd),
      verityHat: r3(med.verity && med.verity.classic),
      o2True: r3(med.o2 && med.o2.trueSd),
      o2Hat: r3(med.o2 && med.o2.classic),
      rhoVO: r3(Hres.rho && Hres.rho.vo),
      maxAbsBias: r3(maxAbsBias),
      solidNightsScored: (axes.host && axes.host.populations.solid && axes.host.populations.solid.population.checked) || null,
      solidClassicPassFraction: r3(axes.host && axes.host.populations.solid && axes.host.populations.solid.result && axes.host.populations.solid.result.classicPassFraction),
      driftMedianAbs: { h10: drift.corners.h10 && drift.corners.h10.medianAbs, verity: drift.corners.verity && drift.corners.verity.medianAbs, o2: drift.corners.o2 && drift.corners.o2.medianAbs }
    },
    result: { verdicts: [] }
  };
  rec.result.verdicts = [scrubVerdict(rec, meta), ...AXES.filter((ax) => runs[ax]).map((ax) => biasStratumVerdict(runs[ax], meta)), axisMatchVerdict(runs, meta)];
  return rec;
}

export function twinSource(rec, outPath) {
  return (
    '/*\n' +
    ' * codegen/generated/tch-reference-record.js — Tepna · THE PUBLISHED REFERENCE RECORD (GENERATED)\n' +
    ' * Copyright 2026 Michal Planicka\n' +
    ' * SPDX-License-Identifier: Apache-2.0\n' +
    ' * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the\n' +
    ' * project root, or http://www.apache.org/licenses/LICENSE-2.0\n' +
    ' * ═════════════════════════════════════════════════════════════════════════════════════════════\n' +
    ' * @generated by tools/tch-reference-record.mjs from ' +
    outPath +
    ' — DO NOT EDIT.\n' +
    ' * The published record of the hat reference check, as a classic script, so\n' +
    ' * sensor-trio-night.html can compose its validation note from the record instead of quoting it.\n' +
    ' * Pooled figures only (owner ruling 2026-09-24): no per-night row, no night list.\n' +
    ' */\n' +
    'window.' +
    TWIN_GLOBAL +
    ' = ' +
    JSON.stringify(rec, null, 1) +
    ';\n'
  );
}

export function readRun(p) {
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!r || !r.detail || !Array.isArray(r.detail.nights) || !Array.isArray(r.verdicts))
    throw new Error(`${p} is not a --json run of tools/tch-firmware-reference.mjs (needs detail.nights + verdicts)`);
  return r;
}

export function verdictSample() {
  const rows = ['2026-09-28', '2026-09-29', '2026-09-30'].map((night, i) => ({
    night,
    ok: true,
    bias: { h10: 0.04 + i / 100, verity: 0.01, o2: -0.1 },
    hat: { h10: 1, verity: 0.6, o2: 2.9 },
    trueSd: { h10: 0.84, verity: 0.8, o2: 2.97 }
  }));
  const run = { detail: { axis: 'host', solid: { nights: ['2026-09-28', '2026-09-29'] }, nights: rows } };
  return biasStratumVerdict(run, { commit: null, at: '2026-10-18T00:00:00Z' });
}

/* ── selftest ───────────────────────────────────────────────────────────────────────────────────── */
function synthRun(axis, opts = {}) {
  const shift = opts.shift || 0;
  const nights = Array.from({ length: opts.n || 24 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  const rows = nights.map((night, i) => ({
    night,
    ok: true,
    axis,
    trueSd: { h10: 0.8 + shift + i / 200, verity: 0.7 + i / 300, o2: 1.7 + i / 100 },
    hat: { h10: 0.95, verity: 0.41, o2: 1.66 },
    bias: { h10: 0.04 + (opts.solidBias && i < 6 ? 0.2 : 0), verity: 0.02, o2: -0.1 },
    rho: { hv: 0, ho: 0, vo: 0.3 },
    vars: { hv: 1, ho: 1, vo: 1 }
  }));
  const solid = nights.slice(0, opts.solid === undefined ? 6 : opts.solid);
  const pop = (name, gate, n) => ({
    schema: 'tepna.verdict/1',
    gate,
    status: 'FAIL',
    scope: 'internal',
    population: { name, checked: n, eligible: n, excluded: 0, first: nights[0], last: nights[n - 1] },
    criterion: { name: 'classic_hat_optical_corners_within_band_fraction', threshold: PASS_FRAC, unit: 'fraction', direction: 'gte' },
    result: {
      classicPassFraction: 0.7,
      medians: { h10: { trueSd: 0.84, bias: 0.04, classic: 0.95 }, verity: { trueSd: 0.73, bias: 0.02, classic: 0.41 }, o2: { trueSd: 1.71, bias: -0.1, classic: 1.66 } },
      rho: { hv: 0, ho: 0, vo: 0.3 }
    },
    evidence: ['tools/tch-firmware-reference.mjs', '/srv/data/corpus/captures/**/*_ECG.txt'],
    reason: 'synthetic · axis ' + axis,
    producedBy: { tool: 'tools/tch-firmware-reference.mjs', commit: 'deadbee' },
    at: '2026-10-18T00:00:00Z'
  });
  return {
    ...pop('all', 'tch-firmware-reference', rows.length),
    verdicts: [pop('all', 'tch-firmware-reference', rows.length), pop('rolling30', 'tch-firmware-reference:rolling30', rows.length), pop('solid', 'tch-firmware-reference:solid', solid.length)],
    detail: { axis, solid: { nights: solid }, nights: rows }
  };
}

function selftest() {
  let ran = 0;
  const fails = [];
  const ok = (c, m) => {
    ran++;
    if (!c) fails.push(m);
  };
  const host = synthRun('host', { shift: 0.5 });
  const wall = synthRun('wall', { shift: 0 });

  const d = pairedDrift(host, wall);
  ok(d.nights === 24 && d.corners.h10.medianAbs === 0.5 && d.corners.h10.hostLarger === 24, 'the paired drift is host − wall on the SAME nights: a planted +0.5 bpm reads as 0.5 on every night');
  ok(d.corners.verity.medianAbs === 0 && d.corners.verity.material === false, 'a corner with no planted drift reads 0 and is not material against the ' + DRIFT_LINE + ' bpm line');
  ok(pairedDrift(host, { detail: { nights: [] } }).nights === 0, 'no shared night ⇒ no paired result, never a one-sided difference');
  /* THE MIXED PAIR. Both legs here hold the SAME nights and the same planted +0.5 bpm, so the drift is
     computable — and must still be refused, because the two legs disagree on the reference axis. A
     comparator that drifts them anyway publishes the axis change as the host discipline's cost. */
  const hostCorr = { ...host, detail: { ...host.detail, referenceAxis: 'corrected' } };
  const mixed = pairedDrift(hostCorr, wall);
  ok(
    mixed.refused != null && /different reference axes|reference on the corrected axis/.test(mixed.refused) && mixed.nights === 0 && KEYS.every((k) => mixed.corners[k] === null),
    'DECOY · a corrected-axis host leg against a device-axis wall leg is REFUSED, not drifted (' + (mixed.refused || 'not refused').slice(0, 60) + '…)'
  );
  const matched = pairedDrift(hostCorr, { ...wall, detail: { ...wall.detail, referenceAxis: 'corrected' } });
  ok(
    matched.refused === null && matched.nights === 24 && matched.corners.h10.medianAbs === 0.5 && matched.referenceAxis === 'corrected',
    'ANTI-VACUITY · the same two legs on a MATCHED reference axis drift exactly as before and the result names the axis'
  );
  ok(
    runReferenceAxis(host) === 'device' && runReferenceAxis({}) === 'device' && pairedDrift(host, wall).referenceAxis === 'device',
    'a legacy run with no detail.referenceAxis reads as device — the only axis the reference ever had'
  );
  /* the axis-match criterion: five pre-stated outcomes over planted pairs */
  const wallCorr = { ...wall, detail: { ...wall.detail, referenceAxis: 'corrected' } };
  const amNA = axisMatchVerdict({ host, wall }, { at: '2026-10-20T00:00:00Z' });
  ok(
    amNA.status === 'NOT_APPLICABLE' && /is the mismatch itself/.test(amNA.reason) && V.validate(amNA).ok,
    'a device-axis host leg is NOT_APPLICABLE — it IS the mismatch, so it cannot test it (' + V.validate(amNA).errors.join(' | ') + ')'
  );
  const amMixed = axisMatchVerdict({ host: hostCorr, wall }, { at: '2026-10-20T00:00:00Z' });
  ok(
    amMixed.status === 'NOT_RUN' && amMixed.result === null && amMixed.population.checked === 0 && V.validate(amMixed).ok,
    'a mixed pair examined nothing ⇒ NOT_RUN over checked 0, never a PASS by refusal'
  );
  const amFail = axisMatchVerdict({ host: hostCorr, wall: wallCorr }, { at: '2026-10-20T00:00:00Z' });
  ok(
    amFail.status === 'FAIL' && /0.5 bpm/.test(amFail.reason) && amFail.result.sidedness.twoSided === false && amFail.result.sidedness.hostLarger === 24 && V.validate(amFail).ok,
    'ANTI-VACUITY · the planted +0.5 bpm one-sided gap FAILS the ' + AXIS_MATCH_LINE + ' bpm line and the sidedness is reported beside it'
  );
  const corr = (r) => ({ ...r, detail: { ...r.detail, referenceAxis: 'corrected' } });
  const amPass = axisMatchVerdict({ host: corr(synthRun('host', { shift: 0 })), wall: corr(synthRun('wall', { shift: 0 })) }, { at: '2026-10-20T00:00:00Z' });
  ok(
    amPass.status === 'PASS' && amPass.result.h10.medianAbs === 0 && amPass.reason === null && amPass.result.sidedness.fraction === 0 && V.validate(amPass).ok,
    'two legs that agree exactly on the H10 PASS and carry no reason — and read `hostLarger` 0, because a difference of zero has no side'
  );
  /* THE SHAPE THE BRIEF IS ACTUALLY ASKING ABOUT: a gap that survives but has lost its direction.
     ±0.02 bpm alternating is under the line AND two-sided, which is what "the mismatch accounted for
     it" looks like — distinct from the exact-zero leg above, which no real night produces. */
  const alt = corr(synthRun('host', { shift: 0 }));
  alt.detail = { ...alt.detail, nights: alt.detail.nights.map((r, i) => ({ ...r, trueSd: { ...r.trueSd, h10: r.trueSd.h10 + (i % 2 ? 0.02 : -0.02) } })) };
  const amTwo = axisMatchVerdict({ host: alt, wall: corr(synthRun('wall', { shift: 0 })) }, { at: '2026-10-20T00:00:00Z' });
  ok(
    amTwo.status === 'PASS' && amTwo.result.h10.medianAbs === 0.02 && amTwo.result.sidedness.hostLarger === 12 && amTwo.result.sidedness.twoSided === true,
    'ANTI-VACUITY · a ±0.02 bpm alternating gap PASSES the line and reads TWO-SIDED (12 of 24), which is the outcome the criterion was written to detect'
  );
  const amFew = axisMatchVerdict({ host: corr(synthRun('host', { shift: 0.5, n: 4 })), wall: corr(synthRun('wall', { shift: 0, n: 4 })) }, { at: '2026-10-20T00:00:00Z' });
  ok(amFew.status === 'UNDERPOWERED' && /4 paired night/.test(amFew.reason) && V.validate(amFew).ok, 'fewer than MIN_NIGHTS paired nights ⇒ UNDERPOWERED, never a PASS on four nights');
  ok(
    buildRecord({ host, wall }, { at: '2026-10-20T00:00:00Z' }).result.verdicts.filter((v) => v.gate === 'tch-reference-record:axis-match').length === 1,
    'the record carries exactly one axis-match verdict'
  );

  const ci = bootCiMean([1, 1, 1, 1, 1]);
  ok(ci.lo === 1 && ci.hi === 1 && ci.mean === 1, 'the bootstrap of a constant is that constant');
  /* Two separate calls over the same sample, held in two variables so the comparison reads as a
     reproducibility check rather than a self-comparison (biome noSelfCompare). The seed is what makes
     this hold: a published CI a reader cannot recompute is not a published number. */
  const firstDraw = JSON.stringify(bootCiMean([0, 1, 2, 3, 9]));
  const secondDraw = JSON.stringify(bootCiMean([0, 1, 2, 3, 9]));
  ok(firstDraw === secondDraw, 'the fixed seed makes the CI reproducible byte-for-byte');
  ok(bootCiMean([]) === null, 'an empty sample has no CI — null, never a zero-width interval');

  const b = biasStratum(host);
  ok(b.status === 'UNDERPOWERED' && /6 solid night/.test(b.reason) && /20/.test(b.reason), 'a stratum below CI_MIN_NIGHTS is UNDERPOWERED and the reason names both counts');
  ok(b.corners.h10.judged === false && b.corners.verity.judged === true && b.corners.o2.judged === true, 'the H10 is reported, never judged');
  const big = biasStratum(synthRun('host', { n: 30, solid: 22 }));
  ok(big.status === 'PASS' && big.reason === null, 'a stratum at or above the bound with every judged corner inside the CI PASSes');
  const crossing = synthRun('host', { n: 30, solid: 22 });
  crossing.detail.nights.forEach((r, i) => {
    r.bias.verity = i % 2 ? 0.2 : -0.2;
  });
  ok(biasStratum(crossing).status === 'UNKNOWN' && /contains zero/.test(biasStratum(crossing).reason), 'an all-nights CI that straddles zero decides nothing: UNKNOWN, never a PASS');
  ok(biasStratum({ detail: { nights: [] } }).status === 'NOT_RUN', 'no scored night ⇒ NOT_RUN');
  ok(
    V.validate(biasStratumVerdict(host, { at: '2026-10-18T00:00:00Z' })).ok,
    'the stratum verdict validates: ' + V.validate(biasStratumVerdict(host, { at: '2026-10-18T00:00:00Z' })).errors.join(' | ')
  );
  ok(V.validate(verdictSample()).ok, 'the verdict sample validates');

  const ib = inBandCounts(host);
  ok(ib.verity.of === 24 && ib.verity.pass + (24 - ib.verity.pass) === 24, 'the in-band count is per corner over the nights that have both numbers');
  ok(ib.o2.reads === 'matches' || ib.o2.reads === 'under-reads' || ib.o2.reads === 'over-reads', 'every corner reports the DIRECTION the hat reads against the reference');
  ok(ib.o2.status === 'reference-checked' || ib.o2.status === 'unvalidated', 'every corner carries the label the card prints, decided by the per-night rate against PASS_FRAC');
  ok(
    inBandCounts({ detail: { nights: [{ night: '2026-09-01', ok: true, hat: { verity: 0.4 }, trueSd: { verity: 0.75 } }] } }).verity.status === 'unvalidated',
    'a corner outside the band on its only night is unvalidated, whatever the median difference is'
  );
  ok(readsHowOff([{ hat: { verity: 0.41 }, trueSd: { verity: 0.73 } }], 'verity') === 'under-reads', 'a hat below the reference under-reads');
  ok(readsHowOff([{ hat: { verity: 0.72 }, trueSd: { verity: 0.7 } }], 'verity') === 'over-reads', 'a hat just above the reference over-reads — the direction is the sign, not the band');

  const rec = buildRecord({ host, wall }, { commit: 'abc1234', generated: '2026-10-18', at: '2026-10-18T00:00:00Z' });
  ok(rec.schema === SCHEMA && rec.producer === 'tools/tch-reference-record.mjs', 'the record names its schema and its producer');
  ok(JSON.stringify(rec).indexOf('/srv/data/corpus') < 0, 'the corpus path the run verdicts carried is NOT in the record');
  ok(rec.axes.host.populations.all.evidence.indexOf(CORPUS_PLACEHOLDER) >= 0, 'the scrub REWRITES the path to the placeholder rather than dropping the evidence');
  const sv = rec.result.verdicts[0];
  ok(sv.gate === 'tch-reference-record:no-private-data' && sv.status === 'PASS' && sv.scope === 'publishable', 'a clean record carries a publishable PASS from the scrub');
  ok(V.validate(sv).ok, 'the scrub verdict validates: ' + V.validate(sv).errors.join(' | '));
  ok(sv.population.checked > 50, 'the scrub examined the record leaf by leaf, not a sample: ' + sv.population.checked);
  const planted = JSON.parse(JSON.stringify(rec));
  planted.axes.host.populations.all.evidence.push('/srv/data/tepna-corpus/2026-09-28/ring_PPG.txt');
  ok(scrubVerdict(planted).status === 'FAIL' && /absolute filesystem path/.test(scrubVerdict(planted).reason), 'CONTROL · a planted corpus path FAILs the scrub');
  const planted2 = JSON.parse(JSON.stringify(rec));
  planted2.axes.host.nightList = ['2026-09-01', '2026-09-02', '2026-09-03'];
  ok(scrubVerdict(planted2).status === 'FAIL' && /ISO dates/.test(scrubVerdict(planted2).reason), 'CONTROL · a three-date list FAILs the scrub, because a date range is two');
  const planted3 = JSON.parse(JSON.stringify(rec));
  planted3.axes.host.rows = [{ trueSd: { h10: 1 }, bias: { h10: 0 } }];
  ok(scrubVerdict(planted3).status === 'FAIL' && /per-night rows/.test(scrubVerdict(planted3).reason), 'CONTROL · an array of per-night rows FAILs the scrub');
  ok(rec.claims.nightsScored === 24 && rec.claims.dateFirst === '2026-09-01', 'the claims block carries the population the card prints');
  ok(rec.axes.host.classic === null || (typeof rec.axes.host.classic === 'object' && !Array.isArray(rec.axes.host.classic)), 'the pooled band counts ride the axis, as counts and never as rows');
  const refused = synthRun('host', { n: 24 });
  refused.detail.nights.unshift({ night: '2026-08-01', ok: false, reason: 'missing rr' });
  refused.verdicts[0].population.first = '2026-08-01';
  ok(
    buildRecord({ host: refused, wall }, { at: '2026-10-18T00:00:00Z' }).claims.dateFirst === '2026-09-01',
    'the claims date range is the SCORED span, so the night count and the dates describe one set'
  );
  ok(rec.claims.driftMedianAbs.h10 === 0.5, 'the claims block carries the paired drift the card does not print but the brief quotes');

  /* ══ CARD WIRING ══════════════════════════════════════════════════════════════════════════════════
     The JS half of the card is scanned by `tests/dex-tests.js` (it is in both lanes' `env.sources`).
     The BUILT PAGE is not in either lane — it is 1.3 MB of inlined bundle — so the two HTML invariants
     are checked here, from the tool that owns the contract: the note host must be EMPTY in the source
     page (a static sentence there is defect 1 reappearing), and the record must be inlined AHEAD of the
     card, since `window.TCH_REFERENCE_RECORD` is read at module evaluation. Paths resolve from this
     file, not from the cwd, so the check holds under `selftest-all` from any directory. */
  const cardHtml = path.join(HERE, '..', 'sensor-trio-night.html');
  if (fs.existsSync(cardHtml)) {
    const html = fs.readFileSync(cardHtml, 'utf8');
    const host = html.match(/<div class="chart-note ts-valnote" id="tsValNote"[^>]*><\/div>/);
    ok(!!host, 'the built page carries the note host, empty — a static pooled sentence there outlives the run that justified it');
    const iRec = html.indexOf('data-inline-src="codegen/generated/tch-reference-record.js"');
    const iCard = html.indexOf('data-inline-src="sensor-trio-night.js"');
    ok(iRec > 0 && iCard > 0 && iRec < iCard, 'the record is inlined AHEAD of the card (' + iRec + ' < ' + iCard + ') — the card reads the global at evaluation');
    /* The superseded record IS named in the page — once, as the current record's own `supersedes`
       field, which is provenance and must survive. What must not survive is a SECOND mention: a prose
       sentence or a card constant still pointing at the retired run. So the count is pinned to the
       inlined record's own, rather than to zero (a zero here would red on correct provenance). */
    const retired = (html.match(/tch-firmware-reference-2026-09-26\.json/g) || []).length;
    const inRecord = (twinSource(rec, 'x.json').match(/tch-firmware-reference-2026-09-26\.json/g) || []).length;
    ok(retired === inRecord && inRecord === 1, 'the superseded record is named once, as provenance, and nowhere else in the page (page ' + retired + ', record ' + inRecord + ')');
  } else {
    ok(false, 'sensor-trio-night.html is not beside this tool — the card-wiring legs examined nothing (§4b)');
  }

  const twin = twinSource(rec, 'analysis/published-numbers/tch-firmware-reference-2026-10-18.json');
  ok(/@generated by tools\/tch-reference-record\.mjs/.test(twin) && /DO NOT EDIT/.test(twin), 'the twin says it is generated and by what');
  ok(/SPDX-License-Identifier: Apache-2\.0/.test(twin), 'the twin carries the SPDX header');
  const sandbox = { window: {} };
  new Function('window', twin.replace(/^#!.*\n/, ''))(sandbox.window);
  ok(JSON.stringify(sandbox.window[TWIN_GLOBAL]) === JSON.stringify(rec), 'the twin evaluates to the record, field for field');

  /* ══ THE COMMITTED RECORD AGAINST THE PRODUCER THAT WOULD WRITE IT TODAY ═════════════════════════
     Every other check in this file compares a FRESHLY BUILT record with its own twin. Both sides move
     together, so neither can ever see a field the PUBLISHED file never had. #3792 gave `buildRecord`
     FOUR fields: two naming the axis the REFERENCE rode, and `pairedDrift.referenceAxis` /
     `pairedDrift.refused`, which say whether the two legs were comparable at all. The record
     published on 2026-10-18 predates every one of them, so it states one of its two axes and its
     drift block cannot distinguish "computed" from "refused". Nothing noticed.

     This leg compares the two key SETS. It is a RATCHET rather than a red, because closing the gap
     means re-running both corpus legs and re-publishing a number over a corpus that has moved since
     (brief §7a), which is the owner's decision under residue row
     `2026-10-20-the-published-tch-reference-figures-ride-the-mismatched-axis`. So the known gap is
     declared, dated and keyed to that row, and a field missing OUTSIDE it reds as a new defect.

     §∅ — THE GAP IS NOT CLOSED BY TYPING THE DEFAULT IN. `REF_AXIS_DEFAULT` is what a run with no flag
     USES; it is not a record of what the published run rode. Writing it into the file would turn an
     unmeasured provenance fact into a published one. */
  const PUBLISHED_FIELD_GAP = {
    row: '2026-10-20-the-published-tch-reference-figures-ride-the-mismatched-axis',
    declared: '2026-10-26',
    top: ['referenceAxisCanonical', 'referenceAxisNote'],
    pairedDrift: ['referenceAxis', 'refused']
  };
  /* The dated record filename is read out of the twin's own header, so this test pins no run. */
  const twinOnDisk = path.join(ROOT, 'codegen', 'generated', 'tch-reference-record.js');
  if (fs.existsSync(twinOnDisk)) {
    const tsrc = fs.readFileSync(twinOnDisk, 'utf8');
    const m = tsrc.match(/@generated by \S+ from (\S+\.json)/);
    ok(!!m, 'the published twin header names the record it came from, so no dated filename is pinned here');
    const recPath = m ? path.join(ROOT, m[1]) : null;
    if (recPath && fs.existsSync(recPath)) {
      const pub = JSON.parse(fs.readFileSync(recPath, 'utf8'));
      const want = Object.keys(rec);
      ok(want.length >= 15, 'ANTI-VACUITY · the producer writes a substantial record to compare against (' + want.length + ' field(s))');
      const missing = want.filter((k) => !(k in pub));
      const unexpected = missing.filter((k) => !PUBLISHED_FIELD_GAP.top.includes(k));
      ok(unexpected.length === 0, 'the published record carries every provenance field the producer writes, outside the declared gap — new: ' + (unexpected.join(', ') || 'none'));
      const dWant = Object.keys(rec.pairedDrift || {});
      ok(dWant.length >= 4, 'ANTI-VACUITY · the paired-drift block has fields to compare (' + dWant.length + ')');
      const dUnexpected = dWant.filter((k) => !(k in (pub.pairedDrift || {}))).filter((k) => !PUBLISHED_FIELD_GAP.pairedDrift.includes(k));
      ok(dUnexpected.length === 0, 'the published pairedDrift block carries every field the producer writes, outside the declared gap — new: ' + (dUnexpected.join(', ') || 'none'));
      /* A FROZEN EXEMPTION AGES. This reds the day the record is re-published, so the entry cannot
         outlive the gap it excuses. */
      const stillMissing = PUBLISHED_FIELD_GAP.top.filter((k) => !(k in pub)).concat(PUBLISHED_FIELD_GAP.pairedDrift.filter((k) => !(k in (pub.pairedDrift || {}))));
      ok(
        stillMissing.length === PUBLISHED_FIELD_GAP.top.length + PUBLISHED_FIELD_GAP.pairedDrift.length,
        'the declared gap is still real — a re-published record must shrink PUBLISHED_FIELD_GAP in the same diff (row ' + PUBLISHED_FIELD_GAP.row + ')'
      );
      /* §∅ — the record may omit the axis, and it may state it; what it may not do is carry it empty. */
      ok(
        !('referenceAxisCanonical' in pub) || (typeof pub.referenceAxisCanonical === 'string' && pub.referenceAxisCanonical.length > 0),
        'a stated reference axis is a non-empty string — an empty one is the in-range sentinel §∅ bans'
      );
    } else {
      ok(false, 'the record named by the twin header is not on disk — the field-set legs examined nothing (§4b)');
    }
  } else {
    ok(false, 'codegen/generated/tch-reference-record.js is not beside this tool — the field-set legs examined nothing (§4b)');
  }

  console.log(fails.length ? `SELFTEST FAIL (${fails.length}/${ran})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${ran}/${ran})`);
  return fails.length ? 1 : 0;
}

async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 1));
    return 0;
  }
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : null;
  };
  const hostPath = arg('--host');
  const wallPath = arg('--wall');
  if (!hostPath || !wallPath) {
    console.error('usage: node tools/tch-reference-record.mjs --host <host run.json> --wall <wall run.json> [--date YYYY-MM-DD] [--out <record.json>] [--js <twin.js>]');
    console.error('       node tools/tch-reference-record.mjs --selftest | --verdict-sample');
    return 2;
  }
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a checkout → producerCommit null */
  }
  const runs = { host: readRun(hostPath), wall: readRun(wallPath) };
  for (const ax of AXES) {
    const got = runs[ax].detail.axis;
    if (got !== ax) {
      console.error(`--${ax} names a run whose detail.axis is ${JSON.stringify(got)} — a σ is not comparable across axes, so the two legs may not be swapped`);
      return 2;
    }
  }
  if (runReferenceAxis(runs.host) !== runReferenceAxis(runs.wall)) {
    console.error(
      `--host built its reference on the ${runReferenceAxis(runs.host)} axis and --wall on the ${runReferenceAxis(runs.wall)} axis — run both legs with the same --reference-axis, or the published drift carries two changes at once`
    );
    return 2;
  }
  const out = arg('--out');
  const rec = buildRecord(runs, { commit, generated: arg('--date') || undefined, out: out || undefined });
  const scrub = rec.result.verdicts[0];
  if (scrub.status !== 'PASS') {
    console.error('REFUSED — the record is not publishable: ' + scrub.reason);
    console.log(JSON.stringify(scrub, null, 1));
    return 1;
  }
  if (out) fs.writeFileSync(path.join(ROOT, out), JSON.stringify(rec, null, 1) + '\n');
  const js = arg('--js');
  if (js) fs.writeFileSync(path.join(ROOT, js), twinSource(rec, out || 'analysis/published-numbers/tch-firmware-reference-' + rec.generated + '.json'));
  if (!out && !js) console.log(JSON.stringify(rec, null, 1));
  else {
    console.error(
      `record: ${rec.claims.nightsScored} night(s) scored of ${rec.claims.nightsEligible}, ${rec.claims.dateFirst} → ${rec.claims.dateLast} · axis ${rec.axisCanonical} · reference axis ${rec.referenceAxisCanonical}`
    );
    for (const v of rec.result.verdicts) console.error(`  ${v.gate.padEnd(38)} ${v.status}${v.reason ? ' — ' + v.reason : ''}`);
    console.error(`  wrote ${[out, js].filter(Boolean).join(' + ')}`);
  }
  return 0;
}

if (isCliEntry(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
