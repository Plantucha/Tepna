#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
// project root, or http://www.apache.org/licenses/LICENSE-2.0
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ring-offset-census.mjs — THE RING'S OFFSET STEPS, COUNTED OVER THE CORPUS INSTEAD OF FIVE NIGHTS.
//
// Residue `2026-09-29-ring-offset-steps-every-night-single-rate-quoted-across-them` establishes the
// class on five recordings and says in terms that the corpus is UNSIZED: "how many folded nights
// carry offset steps, and what each one's published numbers become under the per-segment model …
// a unit of its own and is not #3232". This is that unit.
//
// WHAT IT MEASURES, and why it reads the captures rather than the folds. A folded export publishes
// `recording.hostAxis.maxStepMs`, the largest anchor-to-anchor divergence the OLD single-axis model
// saw, so a step that model smoothed away leaves no trace in the artifact. The row says so, and so
// does `2026-10-25-the-ring-seam-verdict-never-reaches-a-folded-artifact`. The per-segment numbers
// exist only where the segmentation is computed, which is `PPGDSP.parsePPG`. So this walks the raw
// ring plethysmograms and reads `offsetSegments` off the parse, one fragment resident at a time.
//
// THE CRITERION IS PRE-STATED AND IT IS NOT A SIZING: a census counts, and the decision this emits
// is whether the per-segment model ever produces a rate no crystal can hold. ±50 ppm is DexClock's
// own crystal bound, quoted by rows 2026-09-29-thirty-five-of-ninety… and 2026-10-25-the-committed-
// ring-folds…, and `nights_keeping_an_implausible_rate` must be 0. A night keeps one when any of its
// segments publishes a finite `ppm` outside that bound. The old single-axis ppm is reported beside
// it as DATA, never as the thing judged.
//
// POPULATION. Eligible is every folded ring night (`uploads/trio/<night>/PpgDexFinger_*`), checked is
// those whose raw ring plethysmogram is readable on this box, and excluded nights are NAMED — §∅:
// reduced coverage annotates, it does not refuse. The corpus root is snapshotted before and after
// the walk through `corpus-scope-core`, because `tepna-corpus-tier.service` can re-tier a root under
// a run this long.
//
//   node tools/ring-offset-census.mjs                      # the census (report → stderr)
//   node tools/ring-offset-census.mjs --json               # the verdict object on stdout
//   node tools/ring-offset-census.mjs --out <path>         # also write the per-night result
//   node tools/ring-offset-census.mjs --night 2026-09-24   # one night
//   node tools/ring-offset-census.mjs --limit 5            # the first N eligible nights
//   node tools/ring-offset-census.mjs --verdict-sample     # the documented object, computed
//   node tools/ring-offset-census.mjs --selftest
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { NIGHT_RE, snapshotNights, populationVerdict, ruleLine, gitCommitOf } from './corpus-scope-core.mjs';
import { collapseHome } from './home-paths.mjs';
import { corpusSearch, formatCorpusSearch } from './regen-goldens-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { classicify } = createRequire(import.meta.url)(join(ROOT, 'tools/build-core.js'));
/* A WORKTREE HAS NO CORPUS, and the `uploads/` a linked checkout does hold is the 20 % that is
   tracked (FIXTURE-CORPUS-REACHABILITY §1). So the root is SEARCHED — `$DEX_UPLOADS`, then the
   primary checkout, then this one — and the search is printable, because "absent" has to be a
   conclusion the reader can check. */
export const CORPUS = corpusSearch(ROOT);

/* DexClock's own bound, not one derived from the data it judges (§🧾: a threshold read off the
   measurement is `UNKNOWN`). A quartz oscillator holds tens of ppm; `CK_AXIS_MAX_PPM` is 50 000 and
   refuses, which is three orders coarser than anything a crystal does. */
export const IMPLAUSIBLE_PPM = 50;
/* The owner's pre-stated step bound, quoted by row 2026-09-29-thirty-five-of-ninety-folded-ring-
   nights-publish-an-impossible-ppm. A step under it is reported, never counted as a clean night. */
export const STEP_BOUND_MS = 10000;
/* The ring writes one plethysmogram file per BLE session, so a night is a set of fragments. The
   capture-host layout is the provenance fact: `Wellue_O2Ring-S_<serial>_<14>_PPG.txt`. The serial is
   PII, so nothing downstream of this regex carries a file name — a night is keyed by its date. */
const RE_RING_PPG = /^Wellue_O2Ring-S_[^_]+_\d{14}_PPG\.txt$/;
/* THE NIGHT RULE IS THE SHARED ONE, AND A BYTE-IDENTICAL COPY IS STILL A SECOND NAME. A local `re`
   reads as a tool declaring its own rule, which then owes `ruleLine` beside every walk, and minting
   a name for the primitive's own default is what row
   2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year repaired across eleven runs.
   `NIGHT_RE` is both this walk's filter and `snapshotNights`'s default, so the two cannot drift. */

function realm(files) {
  /* MIRRORS `tests/run-tests.mjs makeSandbox()`, so the DSP runs in the realm the gates use.
     A stub without `dataset` is not a smaller stub: `metric-registry.js` applies the persisted tier
     at module evaluation and throws on `body.dataset.mode`, which reads as a corpus failure. */
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = { console, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: el,
    createTextNode: () => ({}),
    head: el(),
    body: el(),
    documentElement: el(),
    addEventListener() {},
    readyState: 'complete'
  };
  sb.navigator = { userAgent: 'ring-offset-census' };
  const store = new Map();
  sb.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
  sb.__DEX_NAMESPACED__ = true;
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const SPINE = ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js'];

/* ── PURE, so the selftest drives them without a corpus ──────────────────────────────────────── */

/* One fragment's segmentation, reduced to the numbers the row asks for. `ppm: null` with a named
   `rateReason` is the per-segment model DECLINING to rate a segment, which is the §∅-correct answer
   and the whole point of the comparison — it is never read as 0 ppm. */
export function reduceSegments(segs) {
  const rows = Array.isArray(segs) ? segs : [];
  const rated = rows.filter((s) => Number.isFinite(s && s.ppm));
  const reasons = {};
  for (const s of rows) {
    if (Number.isFinite(s && s.ppm)) continue;
    const key = String((s && s.rateReason) || 'no reason given').replace(/\d+(\.\d+)?/g, 'N');
    reasons[key] = (reasons[key] || 0) + 1;
  }
  let maxStep = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1] && rows[i - 1].flatOffsetMs,
      b = rows[i] && rows[i].flatOffsetMs;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = Math.abs(b - a);
    if (maxStep === null || d > maxStep) maxStep = d;
  }
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1] && rows[i - 1].flatOffsetMs,
      b = rows[i] && rows[i].flatOffsetMs;
    if (Number.isFinite(a) && Number.isFinite(b)) steps.push(Math.abs(b - a));
  }
  return {
    segments: rows.length,
    rated: rated.length,
    unrated: rows.length - rated.length,
    rateReasons: reasons,
    maxRatedAbsPpm: rated.length ? Math.max(...rated.map((s) => Math.abs(s.ppm))) : null,
    implausibleRated: rated.filter((s) => Math.abs(s.ppm) > IMPLAUSIBLE_PPM).length,
    maxOffsetStepMs: maxStep,
    offsetStepsOverBound: steps.filter((d) => d > STEP_BOUND_MS).length
  };
}

/* The night row. `published` is what the committed artifact says; `frags` is what the captures say
   today. They are kept apart on purpose: the fold ran on 2026-10-03 over whatever fragments existed
   THEN, and this box's archive has been re-synced since, so a difference in fragment count is not
   evidence that either side is wrong. Only the per-segment numbers are claimed here. */
export function nightRow(night, published, frags) {
  const sum = (k) => frags.reduce((t, f) => t + (f[k] || 0), 0);
  const reasons = {};
  for (const f of frags) for (const [k, v] of Object.entries(f.rateReasons || {})) reasons[k] = (reasons[k] || 0) + v;
  const drawnReasons = {};
  for (const f of frags) for (const [k, v] of Object.entries(f.drawnReasons || {})) drawnReasons[k] = (drawnReasons[k] || 0) + v;
  const maxOf = (k) => {
    const xs = frags.map((f) => f[k]).filter((x) => Number.isFinite(x));
    return xs.length ? Math.max(...xs) : null;
  };
  const absMax = (k) => {
    const xs = frags.map((f) => f[k]).filter((x) => Number.isFinite(x));
    return xs.length ? xs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
  };
  return {
    night,
    published: {
      ppm: published ? published.ppm : null,
      anchors: published ? published.anchors : null,
      maxStepMs: published ? published.maxStepMs : null,
      totalMs: published ? published.totalMs : null,
      drawn: published ? published.drawn : null,
      timingSource: published ? published.timingSource : null,
      /* 0 of 74 committed ring exports carry either field — every fold predates #3980 and #4070.
         Published as a tri-state so a later re-fold's artifacts are distinguishable from these. */
      carriesOffsetSegments: published ? published.carriesOffsetSegments : null,
      carriesClockSeam: published ? published.carriesClockSeam : null
    },
    fragments: frags.length,
    bytes: sum('bytes'),
    rows: sum('rows'),
    /* SIGNED, and the name says so: this is the fragment rate of largest MAGNITUDE, not its absolute
       value. A reader who compares an `AbsMax` field to +50 without `Math.abs` passes every negative
       rate on this corpus, and every rate here is negative. */
    singleAxisWorstPpm: absMax('singleAxisPpm'),
    /* How many of this night's fragments published a rate over a DRAWN device column, and how many
       claimed a second clock at all. A night whose every fragment is drawn has no oscillator to
       drift, whatever its ppm says. */
    fragmentsDrawnAxis: sum('drawnAxis'),
    fragmentsIndependentAxis: sum('independentAxis'),
    /* WHICH RULE FIRED, counted. A night drawn on the finger layout alone and a night whose deltas
       actually concentrate are different facts about the device column, and a bare count of drawn
       fragments cannot tell them apart. */
    drawnReasons,
    maxDrawnShare: maxOf('drawnShare'),
    maxQuantizedShare: maxOf('quantizedShare'),
    maxSpreadMs: maxOf('spreadMs'),
    segments: sum('segments'),
    ratedSegments: sum('rated'),
    unratedSegments: sum('unrated'),
    rateReasons: reasons,
    maxRatedAbsPpm: maxOf('maxRatedAbsPpm'),
    implausibleRatedSegments: sum('implausibleRated'),
    maxOffsetStepMs: maxOf('maxOffsetStepMs'),
    offsetStepsOverBound: sum('offsetStepsOverBound'),
    resyncs: sum('resyncs'),
    /* The two populations kept apart: segments the model RAISED, against recordings it left whole
       and whose single rate therefore stands. A night can hold both, one fragment each way. */
    impliedSegments: sum('impliedSegments'),
    segmentedSegments: sum('segmentedSegments'),
    unreadableFragments: sum('unreadable'),
    keepsImplausibleRate: sum('implausibleRated') > 0
  };
}

/* The maximum of what is there, or `null` when nothing is. Never a seeded 0. */
export function nullableMax(xs) {
  const ys = (xs || []).filter((x) => Number.isFinite(x));
  return ys.length ? ys.reduce((a, b) => Math.max(a, b)) : null;
}

export function verdictObject(rows, { eligible, excluded, excludedNights = [], commit, commitReason, at, evidence = [] } = {}) {
  const criterion = { name: `nights_keeping_an_implausible_rate (any segment with a finite ppm outside ±${IMPLAUSIBLE_PPM})`, threshold: 0, unit: 'nights', direction: 'lte' };
  const base = { gate: 'ring-offset-census', criterion, evidence: ['tools/ring-offset-census.mjs', ...evidence], tool: 'tools/ring-offset-census.mjs', commit, commitReason, at };
  if (!rows.length)
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: eligible || 0, excluded: excluded || 0 },
      result: null,
      reason: `no folded ring night had a readable raw plethysmogram on this box, so nothing was segmented (${excludedNights.slice(0, 4).join(', ') || 'no night offered'})`
    });
  const kept = rows.filter((r) => r.keepsImplausibleRate);
  const stepped = rows.filter((r) => r.offsetStepsOverBound > 0);
  const result = {
    nightsChecked: rows.length,
    nightsWithOffsetSteps: rows.filter((r) => r.segments > 1).length,
    nightsWithStepOverBoundMs: stepped.length,
    stepBoundMs: STEP_BOUND_MS,
    segments: rows.reduce((t, r) => t + r.segments, 0),
    ratedSegments: rows.reduce((t, r) => t + r.ratedSegments, 0),
    unratedSegments: rows.reduce((t, r) => t + r.unratedSegments, 0),
    nightsKeepingAnImplausibleRate: kept.length,
    nightsKeepingItOnAnUNSEGMENTEDRecording: kept.filter((r) => r.segmentedSegments === 0).length,
    nightsKeepingItOnASEGMENTEDRecording: kept.filter((r) => r.segmentedSegments > 0).length,
    nightsWhoseSingleAxisPpmWasImplausible: rows.filter((r) => Number.isFinite(r.singleAxisWorstPpm) && Math.abs(r.singleAxisWorstPpm) > IMPLAUSIBLE_PPM).length,
    nightsWhosePublishedPpmIsImplausible: rows.filter((r) => Number.isFinite(r.published.ppm) && Math.abs(r.published.ppm) > IMPLAUSIBLE_PPM).length,
    /* THE PROVENANCE ARM OF THE SAME QUESTION. The counts above say the rate is impossible; these
       two say what it was measured over. A night every fragment of which is drawn carries no second
       clock, so its rate is not a drift figure any re-fold could repair. */
    nightsEveryFragmentDrawn: rows.filter((r) => r.fragments > 0 && r.fragmentsDrawnAxis === r.fragments).length,
    nightsWithAnIndependentFragmentAxis: rows.filter((r) => r.fragmentsIndependentAxis > 0).length,
    /* The reasons folded corpus-wide, so the split between the provenance rule and the statistic is
       readable without opening 65 night rows. */
    drawnReasons: rows.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r.drawnReasons || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    /* ∅ — A CORPUS THAT RATED NOTHING HAS NO WORST RATE. `reduce(max, 0)` reported `0` for both of
       these, which reads as "the worst rate measured was 0 ppm" and is the one number that would
       make the criterion look met by a run that rated nothing. `null` is the answer; `checked` and
       `ratedSegments` above say how much was looked at. */
    maxRatedAbsPpm: nullableMax(rows.map((r) => r.maxRatedAbsPpm)),
    maxOffsetStepMs: nullableMax(rows.map((r) => r.maxOffsetStepMs))
  };
  const population = { checked: rows.length, eligible: eligible || rows.length, excluded: excluded || 0 };
  if (kept.length)
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `${kept.length} night(s) keep a rate outside ±${IMPLAUSIBLE_PPM} ppm per segment: ${kept
        .slice(0, 6)
        .map((r) => `${r.night} (${r.implausibleRatedSegments} segment(s), worst ${r.maxRatedAbsPpm.toFixed(1)} ppm)`)
        .join(', ')}`
    });
  return makeVerdict({ ...base, status: 'PASS', population, result, reason: null });
}

/* ── THE WALK ────────────────────────────────────────────────────────────────────────────────── */

/* ⚠️ A READ THAT FAILED IS NOT AN EMPTY SET (row 2026-10-21-forty-one-corpus-enumerators-report-no-
   population: three walkers read an unreadable root as an empty one, so a mount the machine does not
   hold scored zero and said nothing). The ROOT read carries no catch — the caller exits 2 naming the
   errno. A single night directory that will not read is reduced coverage: NAMED and counted, never
   folded into "this night has nothing". */
export function foldedRingNights(uploads = CORPUS.dir) {
  const trio = join(uploads, 'trio');
  const out = [];
  const unreadable = [];
  for (const n of readdirSync(trio)
    .filter((n) => NIGHT_RE.test(n))
    .sort()) {
    const dir = join(trio, n);
    let f = null;
    try {
      f = readdirSync(dir).find((x) => /^PpgDexFinger_.*\.node-export\.json$/.test(x)) || null;
    } catch (e) {
      unreadable.push({ night: n, errno: (e && e.code) || String((e && e.message) || e) });
      continue;
    }
    if (f) out.push({ night: n, export: join(dir, f) });
  }
  return { nights: out, unreadable };
}

/* Returns the fragments AND why there are none, because "this night was never captured" and "this
   night's directory would not read" are two different facts and only one of them is about the ring. */
export function ringFragments(night, uploads = CORPUS.dir) {
  const dir = join(uploads, 'vigil-archive', 'captures', night);
  let names = [];
  try {
    names = readdirSync(dir)
      .filter((n) => RE_RING_PPG.test(n))
      .sort();
  } catch (e) {
    const code = (e && e.code) || String((e && e.message) || e);
    return { frags: [], absent: code === 'ENOENT', errno: code === 'ENOENT' ? null : code };
  }
  const out = [];
  let unstattable = 0;
  for (const n of names) {
    const full = join(dir, n);
    let bytes = 0;
    try {
      bytes = statSync(full).size;
    } catch {
      unstattable++;
      continue;
    }
    // A zero-byte session is the ring connecting and writing nothing. It is absence, not a clean
    // fragment, so it is never parsed and never counted toward a night's coverage.
    if (bytes > 0) out.push({ full, bytes });
  }
  return { frags: out, absent: out.length === 0 && !unstattable, errno: null, unstattable };
}

export function publishedAxisOf(exportPath) {
  const d = JSON.parse(readFileSync(exportPath, 'utf8'));
  const rec = d.recording || {};
  const ha = rec.hostAxis || {};
  return {
    ppm: ha.ppm == null ? null : ha.ppm,
    anchors: ha.anchors == null ? null : ha.anchors,
    maxStepMs: ha.maxStepMs == null ? null : ha.maxStepMs,
    totalMs: ha.totalMs == null ? null : ha.totalMs,
    drawn: ha.drawn == null ? null : ha.drawn,
    timingSource: ha.timingSource == null ? null : ha.timingSource,
    carriesOffsetSegments: 'offsetSegments' in rec,
    carriesClockSeam: 'clockSeam' in rec
  };
}

/* One fragment, parsed and then DROPPED. The record for a 121 MB session is ~800 MB of typed arrays,
   so holding a night's fragments at once would break the 8 GB standing rule on the 305-fragment
   night. Only the scalars survive the call. */
function measureFragment(PPG, frag) {
  let rec = null;
  try {
    rec = PPG.parsePPG(readFileSync(frag.full, 'utf8'), undefined);
  } catch (e) {
    return {
      bytes: frag.bytes,
      rows: 0,
      unreadable: 1,
      segments: 0,
      rated: 0,
      unrated: 0,
      rateReasons: {},
      resyncs: 0,
      singleAxisPpm: null,
      drawnAxis: 0,
      independentAxis: 0,
      drawnShare: null,
      quantizedShare: null,
      drawnReasons: {},
      spreadMs: null,
      reason: String((e && e.message) || e).slice(0, 120)
    };
  }
  const ha = (rec && rec.hostAxis) || null;
  /* 🔴 A NIGHT THE MODEL DID NOT SEGMENT STILL PUBLISHES A RATE, and reading `offsetSegments` alone
     counts it as nothing. `ppgdex-dsp.js` writes the array only where `multiSeg` holds, so an
     unstepped recording offers ZERO segment rows while `hostAxis.ppm` keeps whatever the single axis
     said — measured on 2026-07-30, 0 segments and -9484.4 ppm. Counting rated segments over the
     array alone would therefore report "no night keeps an impossible rate" while twenty nights do,
     which is the examined-nothing shape with the criterion pointed away from the population.
     So an unsegmented recording contributes ONE IMPLIED segment carrying that rate, flagged, and the
     criterion sees it. This is what the per-segment model actually answers for such a night: one
     segment, one rate, unchanged. */
  const segs =
    rec && Array.isArray(rec.offsetSegments) && rec.offsetSegments.length
      ? rec.offsetSegments
      : ha && Number.isFinite(ha.ppm)
        ? [{ flatOffsetMs: null, ppm: ha.ppm, rateReason: null, implied: true }]
        : [];
  const red = reduceSegments(segs);
  const out = {
    bytes: frag.bytes,
    rows: (rec && rec.n) || 0,
    unreadable: 0,
    singleAxisPpm: ha && Number.isFinite(ha.ppm) ? ha.ppm : null,
    singleAxisMaxStepMs: ha && Number.isFinite(ha.maxStepMs) ? ha.maxStepMs : null,
    /* THE RATE'S PROVENANCE TRAVELS BESIDE THE RATE (§7: ask whether there IS a second clock
       first, and read `deviceDrawn` ahead of `independent`). Row
       2026-10-25-the-committed-ring-folds-carry-no-drawn-axis-verdict refuted the re-fold this
       census sizes from provenance: the ring's device column is drawn on the host, so the rate
       describes a counter with no oscillator. `deviceDrawn` does not gate `independent` in
       `clock.js`, so a drawn column still publishes a confident `ppm` — exactly the pair this file
       counts. Re-measured here from the raw bytes so the arithmetic and the provenance sit in one
       row, and no reader can quote a ppm from this census as a clock. */
    drawnAxis: ha && ha.deviceDrawn === true ? 1 : 0,
    independentAxis: ha && ha.independent === true ? 1 : 0,
    drawnShare: ha && Number.isFinite(ha.drawnShare) ? ha.drawnShare : null,
    /* 🔴 TWO RULES DECIDE `deviceDrawn` ON THIS NODE, AND ONLY ONE OF THEM IS A STATISTIC. Publishing
       the share alone would print `drawn` beside a 0.18 % concentration, which reads as a
       contradiction — the one `ppgdex-dsp.js` wrote `drawnReason` to prevent. The node's verdict is
       `site === 'finger' ? true : quantizedShare >= 0.67`, so an O2Ring is settled on PROVENANCE
       whatever the statistic saw, and the spine's own share is computed over ANCHORS that segment
       re-anchoring leaves unconcentrated. So the REASON travels with the verdict, digit-blind, and
       `quantizedShare` is published beside the spine's `drawnShare` because the node decides on the
       first and the fleet's refusals read the second. The threshold is not restated here: a third
       copy of 0.67 would drift away from the two that decide. */
    quantizedShare: ha && Number.isFinite(ha.quantizedShare) ? ha.quantizedShare : null,
    /* ONLY THE PERCENTAGES. A digit-blind pass over the whole sentence groups the reasons, and it
       also turned `O2Ring` into `ONRing` and the citation `DA-V §2.7 F17` into `DA-V §N FN` — a
       device this corpus does not hold and a section that does not exist. The share is the only part
       that varies per fragment, so blinding it alone groups the same keys and keeps the sentence
       readable. */
    drawnReasons: ha && ha.deviceDrawn === true ? { [String(ha.drawnReason || 'no reason given').replace(/\d+(?:\.\d+)?\s*%/g, 'N %')]: 1 } : {},
    spreadMs: ha && Number.isFinite(ha.spreadMs) ? ha.spreadMs : null,
    resyncs: rec && Array.isArray(rec.clockResyncs) ? rec.clockResyncs.length : 0,
    ...red,
    impliedSegments: segs.some((x) => x && x.implied) ? 1 : 0,
    segmentedSegments: segs.some((x) => x && x.implied) ? 0 : segs.length
  };
  rec = null;
  return out;
}

export function runCensus({ uploads = CORPUS.dir, night = null, limit = null, log = () => {} } = {}) {
  const folded = foldedRingNights(uploads);
  const eligibleRows = folded.nights.filter((r) => !night || r.night === night);
  const capturesRoot = join(uploads, 'vigil-archive', 'captures');
  const before = snapshotNights(capturesRoot);
  const PPG = realm(SPINE).PPGDSP;
  const rows = [];
  const excludedNights = [];
  const unreadableNights = [...folded.unreadable];
  let n = 0;
  for (const el of eligibleRows) {
    if (limit != null && n >= limit) break;
    n++;
    const got = ringFragments(el.night, uploads);
    if (got.errno) {
      unreadableNights.push({ night: el.night, errno: got.errno });
      excludedNights.push(el.night);
      log(`  ⚠ ${el.night} — the capture directory would not read (${got.errno})`);
      continue;
    }
    if (!got.frags.length) {
      excludedNights.push(el.night);
      log(`  ⊘ ${el.night} — no readable raw ring plethysmogram on this box`);
      continue;
    }
    let published = null;
    try {
      published = publishedAxisOf(el.export);
    } catch (e) {
      unreadableNights.push({ night: el.night, errno: `the folded export would not parse: ${String((e && e.message) || e).slice(0, 80)}` });
    }
    const measured = got.frags.map((f) => measureFragment(PPG, f));
    const row = nightRow(el.night, published, measured);
    rows.push(row);
    log(
      `  ${row.keepsImplausibleRate ? '✗' : '·'} ${row.night}  frags ${String(row.fragments).padStart(3)}  segs ${String(row.segments).padStart(4)}` +
        `  rated ${row.ratedSegments}  steps>${STEP_BOUND_MS / 1000}s ${row.offsetStepsOverBound}` +
        `  published ppm ${row.published.ppm == null ? 'null' : row.published.ppm.toFixed(1)}` +
        `  single-axis ppm ${row.singleAxisWorstPpm == null ? 'null' : row.singleAxisWorstPpm.toFixed(1)}` +
        `  drawn ${row.fragmentsDrawnAxis}/${row.fragments}`
    );
  }
  const after = snapshotNights(capturesRoot);
  return {
    rows,
    eligible: eligibleRows.length + folded.unreadable.length,
    excludedNights: [...new Set([...excludedNights, ...folded.unreadable.map((u) => u.night)])],
    unreadableNights,
    before,
    after,
    capturesRoot
  };
}

/* NOTHING THIS TOOL WRITES MAY CARRY AN ABSOLUTE HOME PATH (owner ruling 2026-10-28, `home-paths.mjs`).
   `secret-scan` is a REQUIRED check on `main`, it reads only the commits a branch ADDS, and
   `npm run check` never runs it — so the first report arrives after the local gate is green, and a
   fix commit does not clear it, because the finding stays in the commits already pushed. Measured on
   this unit 2026-10-29: two `home-path` findings in `analysis/ring_offset_census.json`.
   A path reaches the artifact in TWO shapes. The field itself: the population primitive stores the
   root it enumerated, verbatim and absolute (`corpus-scope-core.mjs:235`), and `collapseHome` answers
   that one at the site. A SENTENCE around it: a read error's message embeds the file it could not
   read, so no field name predicts where the path lands, and only the serialized text sees it.
   The guard REPORTS what it replaced. A silent redaction is a secret shipped once and never seen, and
   because the two known sites are collapsed before the write, a line printed here names a shape
   nobody predicted rather than the root this tool always resolves. */
export function homeBlind(text, home = homedir()) {
  const s = String(text);
  if (!home || home === '/') return { text: s, replaced: 0 };
  const parts = s.split(home);
  return { text: parts.join('~'), replaced: parts.length - 1 };
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────── */

export function verdictSample() {
  /* COMPUTED, never quoted: the adoption gate runs this and validates the object, and a literal
     would go stale the moment the criterion moved. Two synthetic fragments, one of which keeps a
     rate no crystal can hold, so the FAIL branch is the one exercised. */
  const frags = [
    {
      bytes: 1000,
      rows: 10,
      unreadable: 0,
      singleAxisPpm: -8119.7,
      resyncs: 0,
      drawnAxis: 1,
      independentAxis: 1,
      drawnShare: 0.998,
      quantizedShare: 0.0001,
      drawnReasons: { 'O2Ring finger layout — the device column is host-synthesised by construction (DA-V §N.N FN), whatever the N % delta share says': 1 },
      spreadMs: 412,
      ...reduceSegments([
        { flatOffsetMs: -12717.7, ppm: null, rateReason: 'spans 1980 s, under the 2400 s a rate needs' },
        { flatOffsetMs: -190174.6, ppm: null, rateReason: '1 anchor(s) — below the 3 a rate needs' }
      ])
    },
    {
      bytes: 1000,
      rows: 10,
      unreadable: 0,
      singleAxisPpm: 12.0,
      resyncs: 1,
      drawnAxis: 1,
      independentAxis: 1,
      drawnShare: 0.991,
      quantizedShare: 0.83,
      drawnReasons: { 'device inter-sample deltas concentrate on one value (N % share) — a synthesised counter, not a clock, whatever ppm it reports': 1 },
      spreadMs: 377,
      ...reduceSegments([{ flatOffsetMs: 0, ppm: 3020.5, rateReason: null }])
    }
  ];
  const rows = [
    nightRow('2026-09-24', { ppm: -8119.7, anchors: 5783, maxStepMs: 16128.8, totalMs: -190164.5, drawn: true, timingSource: 'host', carriesOffsetSegments: false, carriesClockSeam: false }, frags)
  ];
  return verdictObject(rows, {
    eligible: 10,
    excluded: 9,
    excludedNights: ['2026-07-17'],
    commit: null,
    commitReason: 'the documented sample is computed from synthetic fragments, not from a checkout',
    at: '2026-10-29T00:00:00Z'
  });
}

function selftest() {
  const fails = [];
  /* The helper counts, because a TYPED total is the defect `selftest-all.mjs` documents: delete an
     assertion and a hardcoded number keeps reporting the old one. `ran` is incremented here and
     nowhere else, and the summary interpolates it in the one spelling the runner parses. */
  let ran = 0;
  const eq = (name, got, want) => {
    ran++;
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  // A segment the model DECLINES to rate is unrated with a reason — never 0 ppm (§∅).
  const r = reduceSegments([
    { flatOffsetMs: 0, ppm: null, rateReason: 'spans 666 s, under the 2400 s a rate needs' },
    { flatOffsetMs: -20000, ppm: null, rateReason: 'spans 28 s, under the 2400 s a rate needs' }
  ]);
  eq('unrated segments counted', [r.segments, r.rated, r.unrated], [2, 0, 2]);
  eq('both reasons fold to one digit-blind key', Object.values(r.rateReasons), [2]);
  eq('the offset step between two segments is measured', [r.maxOffsetStepMs, r.offsetStepsOverBound], [20000, 1]);
  eq('no rated segment means no implausible rate', [r.maxRatedAbsPpm, r.implausibleRated], [null, 0]);
  // A rated segment outside the crystal bound is the thing the criterion refuses.
  const b = reduceSegments([{ flatOffsetMs: 0, ppm: 3020.5, rateReason: null }]);
  eq('an implausible rated segment is counted', [b.rated, b.implausibleRated, b.maxRatedAbsPpm], [1, 1, 3020.5]);
  const ok = reduceSegments([{ flatOffsetMs: 0, ppm: -11.4, rateReason: null }]);
  eq('a crystal-plausible rate is rated and not refused', [ok.rated, ok.implausibleRated], [1, 0]);
  // An empty segmentation is not a step — one continuous stretch has nothing to step between.
  eq('no segmentation offers no step', reduceSegments(null).maxOffsetStepMs, null);
  // The night row keeps the published numbers apart from the measured ones.
  const row = nightRow('2026-09-24', { ppm: -8119.7, anchors: 5783, maxStepMs: 1, totalMs: 1, drawn: true, timingSource: 'host', carriesOffsetSegments: false, carriesClockSeam: false }, [
    { bytes: 1, rows: 1, unreadable: 0, singleAxisPpm: -8119.7, resyncs: 0, ...r }
  ]);
  eq('the published ppm survives beside a per-segment refusal', [row.published.ppm, row.ratedSegments, row.keepsImplausibleRate], [-8119.7, 0, false]);
  // NOT_RUN over nothing, and the FAIL branch names the night.
  const nr = verdictObject([], { eligible: 74, excluded: 74, excludedNights: ['2026-07-17'], commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' });
  eq('an empty census is NOT_RUN, never a PASS', [nr.status, nr.population.checked], ['NOT_RUN', 0]);
  /* The two readings a reviewer must not be able to conflate: a drawn device column is counted, and
     counting it does not fold into the rate or change it. `independent` stays true on both fragments
     because `clock.js` publishes `deviceDrawn` additively — a confident rate over no oscillator. */
  const drawnRow = nightRow('2026-09-24', null, [
    {
      bytes: 1,
      rows: 1,
      unreadable: 0,
      singleAxisPpm: -8119.7,
      resyncs: 0,
      drawnAxis: 1,
      independentAxis: 1,
      drawnShare: 0.998,
      quantizedShare: 0.0001,
      drawnReasons: { 'O2Ring finger layout — the device column is host-synthesised by construction (DA-V §N.N FN), whatever the N % delta share says': 1 },
      spreadMs: 412,
      ...r
    },
    { bytes: 1, rows: 1, unreadable: 0, singleAxisPpm: -12.0, resyncs: 0, drawnAxis: 0, independentAxis: 1, drawnShare: 0.4, quantizedShare: 0.4, drawnReasons: {}, spreadMs: 900, ...r }
  ]);
  eq(
    'a drawn device axis is counted beside the rate, never folded into it',
    [drawnRow.fragmentsDrawnAxis, drawnRow.fragmentsIndependentAxis, drawnRow.maxDrawnShare, drawnRow.singleAxisWorstPpm],
    [1, 2, 0.998, -8119.7]
  );
  const vs = verdictSample();
  eq('a kept implausible rate FAILs with the night named', [vs.status, vs.result.nightsKeepingAnImplausibleRate, vs.reason.includes('2026-09-24')], ['FAIL', 1, true]);
  eq('a night drawn end to end is reported as such, beside its impossible rate', [vs.result.nightsEveryFragmentDrawn, vs.result.nightsWithAnIndependentFragmentAxis], [1, 1]);
  /* WHICH RULE DECIDED IT, kept apart: the provenance rule and the delta statistic fold to two keys,
     so a drawn verdict over a 0.01 % share no longer reads as a contradiction. */
  eq('the two drawn rules fold to two distinguishable reasons', Object.values(vs.result.drawnReasons).sort(), [1, 1]);
  eq('a fragment with no drawn verdict contributes no reason', [drawnRow.fragmentsDrawnAxis, Object.values(drawnRow.drawnReasons), drawnRow.maxQuantizedShare], [1, [1], 0.4]);
  eq('the criterion is pre-stated and bounded at zero', [vs.criterion.threshold, vs.criterion.direction, vs.criterion.unit], [0, 'lte', 'nights']);
  eq('population closes', vs.population.checked + vs.population.excluded, vs.population.eligible);
  /* The two reads that are NOT the same fact. A root that is not there offers no night; a root that
     will not read was never examined, and scoring it zero is the defect the backlog row names. */
  const gone = ringFragments('2026-01-01', '/nonexistent-corpus-root');
  eq('a capture directory that is not there is absence, with no errno', [gone.frags.length, gone.absent, gone.errno], [0, true, null]);
  const notDir = ringFragments('2026-01-01', join(ROOT, 'tools/ring-offset-census.mjs'));
  eq('a read that failed names its errno and is not absence', [notDir.absent, notDir.errno], [false, 'ENOTDIR']);
  const impl = reduceSegments([{ flatOffsetMs: null, ppm: -9484.4, rateReason: null, implied: true }]);
  eq('an unsegmented recording contributes one rated segment, so its rate is judged', [impl.segments, impl.rated, impl.implausibleRated], [1, 1, 1]);
  eq('a corpus that rated nothing has no worst rate, and never a 0', [nullableMax([]), nullableMax([null, 3, 7])], [null, 7]);
  const unrated = verdictObject([row], { eligible: 1, excluded: 0, commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' });
  eq('an all-unrated census reports null for the worst rate, not 0', [unrated.status, unrated.result.maxRatedAbsPpm, unrated.result.ratedSegments], ['PASS', null, 0]);
  const pass = verdictObject(
    [
      nightRow('2026-08-03', { ppm: 13.9, anchors: 1, maxStepMs: 1, totalMs: 1, drawn: true, timingSource: 'host', carriesOffsetSegments: false, carriesClockSeam: false }, [
        { bytes: 1, rows: 1, unreadable: 0, singleAxisPpm: 13.9, resyncs: 0, ...ok }
      ])
    ],
    { eligible: 74, excluded: 73, commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' }
  );
  eq('a corpus that keeps no implausible rate PASSes', [pass.status, pass.result.nightsKeepingAnImplausibleRate], ['PASS', 0]);
  /* The three shapes the write guard meets: the path alone, the path inside a read error's sentence,
     and a line that holds no home path at all. The `home` parameter is passed, so the rule is pinned
     without reading this machine's environment.
     ⚠ THE SYNTHETIC HOME IS `/h/u`, THE SPELLING `home-paths.mjs:106` USES, AND IT IS NOT DECORATION.
     A fixture spelled with a real `/home/<name>/` prefix matches the `home-path` rule itself
     (`.gitleaks.toml:49`, keyed on the name that follows), so the assertions that prove this guard
     would red the gate the guard exists to keep green. Measured 2026-10-29: three such fixtures, plus
     the comment that explained them, in the first commit of this unit. */
  eq('the guard collapses a path that stands alone', homeBlind('/h/u/Tepna/uploads', '/h/u'), { text: '~/Tepna/uploads', replaced: 1 });
  eq('the guard collapses a path inside a sentence', homeBlind("ENOENT: no such file, open '/h/u/x/PpgDex.json'", '/h/u'), {
    text: "ENOENT: no such file, open '~/x/PpgDex.json'",
    replaced: 1
  });
  eq('the guard reports nothing to collapse', homeBlind('uploads/trio/2026-08-03', '/h/u'), { text: 'uploads/trio/2026-08-03', replaced: 0 });
  if (fails.length) {
    for (const f of fails) console.error('✗ ' + f);
    console.error(`✗ ring-offset-census selftest: ${fails.length} failure(s)`);
    process.exit(1);
  }
  console.error(`✓ ring-offset-census selftest: ${ran} assertions passed`);
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json'], valued: ['--out', '--night', '--limit'], positional: false }, { tool: 'ring-offset-census' });
  if (argv.includes('--selftest')) selftest();
  else if (argv.includes('--verdict-sample')) console.log(JSON.stringify(verdictSample()));
  else {
    const val = (f) => {
      const i = argv.indexOf(f);
      return i < 0 ? null : argv[i + 1];
    };
    const json = argv.includes('--json');
    const limitRaw = val('--limit');
    const limit = limitRaw == null ? null : Number(limitRaw);
    if (limit != null && !(Number.isInteger(limit) && limit > 0)) {
      console.error('--limit takes a positive integer');
      process.exit(2);
    }
    const t0 = Date.now();
    console.error('  corpus search:\n' + formatCorpusSearch(CORPUS));
    let census;
    try {
      census = runCensus({ night: val('--night'), limit, log: (s) => console.error(s) });
    } catch (e) {
      /* THE ROOT, not a night. An unreadable corpus root is a discontinuity: it refuses and names
         the errno, because scoring it zero is the defect this class of tool keeps shipping. */
      console.error(`✗ the corpus root would not enumerate (${(e && e.code) || (e && e.message) || e})`);
      console.error('  corpus search:\n' + formatCorpusSearch(CORPUS));
      process.exit(2);
    }
    const { rows, eligible, excludedNights, unreadableNights, before, after, capturesRoot } = census;
    /* `gitCommitOf` returns BOTH halves — a sha, or null with the sentence saying why. A worktree's
       `.git` is a file, so the null branch is the common case here, not the exotic one. */
    const { commit, reason: commitReason } = gitCommitOf(ROOT);
    /* The population verdict names the tree it WALKED, not a path this file guesses: `capturesRoot`
       is the resolved root, and a corpus that resolved elsewhere says so in its own evidence. */
    const pop = populationVerdict(before, after, { commit, commitReason, tool: 'tools/ring-offset-census.mjs', evidence: [collapseHome(capturesRoot)] });
    /* The primitive stores the root it ENUMERATED, so the field is absolute whatever this file does.
       Collapsing it keeps the verdict honest — it still names the tree walked, and a corpus that
       resolved elsewhere still says so — and keeps `homeBlind` a tripwire rather than a line every
       run prints. */
    if (pop && pop.result && typeof pop.result.root === 'string') pop.result.root = collapseHome(pop.result.root);
    const v = verdictObject(rows, { eligible, excluded: excludedNights.length, excludedNights, commit, commitReason, evidence: ['uploads/trio', 'uploads/vigil-archive/captures'] });
    const out = val('--out');
    if (out) {
      const blind = homeBlind(
        JSON.stringify({ schema: 'tepna.ring-offset-census/1', at: v.at, producedBy: v.producedBy, verdict: v, population: pop, excludedNights, unreadableNights, nights: rows }, null, 1) + '\n'
      );
      if (blind.replaced) console.error(`⚠ ${blind.replaced} absolute home path(s) collapsed to ~ before the write`);
      writeFileSync(out, blind.text);
      console.error(`→ ${out}`);
    }
    console.error(`  corpus population: ${pop.status} — ${pop.reason || 'the night set held still across the run'}`);
    /* THE WALK'S OWN ACCOUNT OF ITS RULE. `ruleLine` names what the night rule refused and what it
       let through, so a root that offered nothing reads differently from a rule that admitted
       nothing. It is silent when the rule refused nothing, so an absent line is also a fact. */
    const ruleAccount = ruleLine(pop);
    if (ruleAccount) console.error('  ' + ruleAccount);
    console.error(
      `  ${rows.length} night(s) segmented, ${excludedNights.length} excluded` +
        (unreadableNights.length ? `, ${unreadableNights.length} unreadable (${unreadableNights.map((u) => `${u.night}: ${u.errno}`).join('; ')})` : '') +
        `, in ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    printVerdict(v, { json });
    process.exit(v.status === 'FAIL' ? 1 : 0);
  }
}
