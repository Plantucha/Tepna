#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
// project root, or http://www.apache.org/licenses/LICENSE-2.0
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ring-rate-cause.mjs — WHY THE RING QUOTES A RATE NO CRYSTAL CAN HOLD, DECOMPOSED PER FRAGMENT.
//
// `ring-offset-census.mjs` (#4095) counted the nights: 50 of 65 keep a rate outside ±50 ppm even
// under the per-segment model, the worst reading −30 681 ppm. The owner ruled on 2026-10-29 that the
// O2Ring has a crystal and cannot drift past single digits of ppm, so every one of those nights
// carries an error in acquisition or in processing. This tool says WHICH, per fragment, in terms
// that add up to the published number.
//
// THE IDENTITY THE DECOMPOSITION RESTS ON. `DexClock.hostAxis` publishes `ppm = sm[n-1] / span`,
// where `sm` is the running median of the divergence `hostMs - devMs` and `span` is the device axis
// it was measured over (`clock.js`). It is an END-POINT RATIO, not a fit, so one late host stamp at
// the tail of a short fragment moves it without limit. Drop the smoothing and the same quantity is
// an identity over the two spans:
//
//   spanPpm = (hostSpan - devSpan) / devSpan
//   hostSpan - devSpan = (n-1)(stepTrue - stepNom)  +  G  -  J*stepNom  +  jitter
//
//   stepNom   the DRAWN step — the modal device delta, 7 953 045 ns, i.e. an ASSUMED 125.738 Hz
//   stepTrue  the delivered inter-sample interval, measured on the host column over clean intervals
//   G         host time inside gaps: samples the ring never delivered
//   J         device steps the counter SKIPPED, i.e. loss the ring accounted for itself
//
// So four named causes, each in ppm of the same span, plus what the smoothing then does to the end:
//
//   drawn-constant-error   (n-1)(stepTrue - stepNom)   the constant is wrong, nothing drifted
//   undelivered-samples    +G                          a dropout the device axis did not span
//   device-counted-skips   -J*stepNom                  a dropout it did span
//   host-stamp-jitter      the residual                per-frame re-anchoring, ±330 ms measured
//   end-window-median      axisPpm - spanPpm           the last 21 anchors against the whole span
//
// WHAT IT IS FOR. The criterion is NOT the decomposition — a threshold read off the numbers it
// judges is `UNKNOWN` (§🧾). It is whether the node published a rate outside ITS OWN pre-stated
// floors: `ppgdex-dsp.js PPG_RATE_MIN_SPAN_S` (2400 s, enforced on a SEGMENTED recording) and
// `clock.js CK_AXIS_DRAWN_SHARE` (0.67, the share at which a device column stops being a clock).
// Both are read out of the sources that declare them and this file fails closed without them, so
// there is no third copy to drift. An unsegmented recording reaches `hostAxis.ppm` with neither
// floor applied, which is the shape `ring-offset-census.mjs` measured as 30 of its 50 nights.
//
// HOW IT READS 9.4 GB WITHOUT HOLDING IT. One fragment at a time, byte-scanned, scalars only
// (standing rule: never hold more than 8 GB). The host stamp is parsed on the anchor rows alone —
// row 1 and every `PPG_AXIS_EVERY`-th, exactly the rows `parsePPG` anchors on — so the expensive
// parse runs on 0.2 % of 200 M rows. The device column is read per row because the modal share is
// the drawn-axis statistic and a jump is one row wide.
//
//   node tools/ring-rate-cause.mjs                      # the report (stderr) + verdict
//   node tools/ring-rate-cause.mjs --json               # the verdict object on stdout
//   node tools/ring-rate-cause.mjs --out p --all-fragments   # every fragment record, not the worst
//   node tools/ring-rate-cause.mjs --out <path>         # also write the per-fragment result
//   node tools/ring-rate-cause.mjs --night 2026-08-30   # one night
//   node tools/ring-rate-cause.mjs --limit 5            # the first N eligible nights
//   node tools/ring-rate-cause.mjs --verdict-sample     # the documented object, computed
//   node tools/ring-rate-cause.mjs --selftest
import vm from 'node:vm';
import { openSync, readSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { snapshotNights, populationVerdict, ruleLine, gitCommitOf } from './corpus-scope-core.mjs';
import { collapseHome } from './home-paths.mjs';
import { formatCorpusSearch } from './regen-goldens-core.mjs';
import { CORPUS, foldedRingNights, ringFragments, nullableMax, homeBlind } from './ring-offset-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { classicify } = createRequire(import.meta.url)(join(ROOT, 'tools/build-core.js'));

/* ── THE FLOORS, READ FROM THE SOURCES THAT DECLARE THEM ─────────────────────────────────────── */

/* A CONSTANT RESTATED IS A CONSTANT THAT DRIFTS. `ring-offset-census.mjs` declined to copy 0.67 for
   exactly this reason, and the two numbers below decide what this tool calls a defect — so they are
   read out of `clock.js` and `ppgdex-dsp.js`, and an unreadable declaration REFUSES. Failing closed
   is the rule the build's own list-reading follows (CLAUDE.md §2c): a missing list is never an
   empty one. */
export function readDeclaredNumber(text, name) {
  const m = new RegExp('\\b(?:const|var|let)\\s+' + name + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\b').exec(String(text));
  return m ? Number(m[1]) : null;
}

export function floors(root = ROOT) {
  const spanS = readDeclaredNumber(readFileSync(join(root, 'ppgdex-dsp.js'), 'utf8'), 'PPG_RATE_MIN_SPAN_S');
  const drawnShare = readDeclaredNumber(readFileSync(join(root, 'clock.js'), 'utf8'), 'CK_AXIS_DRAWN_SHARE');
  const anchorEvery = readDeclaredNumber(readFileSync(join(root, 'ppgdex-dsp.js'), 'utf8'), 'PPG_AXIS_EVERY');
  return { rateMinSpanS: spanS, drawnShare, anchorEvery };
}

/* ── THE REALM: `hostAxis` ITSELF, NEVER A SECOND IMPLEMENTATION ─────────────────────────────── */

/* The quoted ppm has to BE the quoted ppm. Re-deriving the running median here would measure this
   file's idea of `clock.js`, and the whole point is to explain the number the node published, so
   `clock.js` is loaded and called. It needs no DOM — measured 2026-10-29, a `window`/`globalThis`
   sandbox is enough — so this realm is three lines rather than the census's forty. */
export function clockRealm(root = ROOT) {
  const sb = { console };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(classicify(readFileSync(join(root, 'clock.js'), 'utf8')), ctx, { filename: 'clock.js' });
  return sb.DexClock;
}

/* ── PURE, so the selftest drives every branch without a corpus ──────────────────────────────── */

/* 🔴 ONE PARSER. `parseTimestamp` is single-sourced in `clock.js` (CLAUDE.md §✅) and a byte-identical
   regex here would be the mirror that rule exists to prevent — it would also carry its own range
   validation, where `_ckMk` already refuses a component `Date.UTC` would silently roll onto a wrong
   instant. So the host column is read through the realm this file already loads for `hostAxis`.
   Only DIFFERENCES of `tMs` are used, so no anchor and no zone is owed; a stamp-less field is
   `null` and the row carries no anchor, never a fabricated one (§∅). */
export function hostMsOf(DexClock, s) {
  const at = DexClock.parseTimestamp(String(s));
  return at && Number.isFinite(at.tMs) ? at.tMs : null;
}

/* The modal device delta IS the drawn step, so it is measured, never assumed: the one thing this
   tool may not do is re-calibrate 125.738 Hz (`ext:memory/o2ring-timestamp-is-drawn`). A capped key
   set keeps a fragment of real timestamps from growing an unbounded map; the cap is REPORTED,
   because a share computed over a truncated key set is a different number. */
export function modalOf(counts) {
  let key = null;
  let best = 0;
  let total = 0;
  for (const [k, v] of counts) {
    total += v;
    if (v > best) {
      best = v;
      key = k;
    }
  }
  return { key, count: best, total, share: total ? best / total : null, distinct: counts.size };
}

/* THE DEVICE'S OWN LOSS ACCOUNTING. A delta of k modal steps means the counter counted k-1 samples
   it never delivered, so the axis SPANS that dropout and the host column does not have to. Measured
   2026-10-29 on one night's eight fragments: four jumps of ~57 steps on one, and a second fragment
   whose every delta is the modal one — a night holds both, which is why loss is reported twice and
   never summed into one number. A delta that is not a whole multiple of the step is counted as the
   floor of what it buys, and a BACKWARD delta is counted apart, because a counter that goes back is
   a resync and not loss. */
export function skippedStepsOf(counts, modalNs) {
  let steps = 0;
  let jumps = 0;
  let back = 0;
  if (!Number.isFinite(modalNs) || modalNs <= 0) return { skippedSteps: 0, devJumps: 0, devBackwards: 0 };
  for (const [d, c] of counts) {
    if (d === modalNs) continue;
    if (d < 0) {
      back += c;
      continue;
    }
    const k = Math.round(d / modalNs);
    if (k > 1) steps += (k - 1) * c;
    jumps += c;
  }
  return { skippedSteps: steps, devJumps: jumps, devBackwards: back };
}

/* The DELIVERED inter-sample interval, measured on the host column over the anchor intervals that
   hold no gap. A median of per-interval means: the mean over 500 rows averages the ±1 ms rounding
   and the per-frame re-anchor jitter away, and the median then rejects the intervals that carry a
   dropout. Both are needed — a plain span/(n-1) counts the dropouts as signal, which is the
   arithmetic that makes a 20 s fragment read −87 000 ppm. */
export function robustStepMs(anchors, anchorEvery, stepNomMs) {
  const per = [];
  for (let i = 1; i < anchors.length; i++) {
    const dh = anchors[i].hostMs - anchors[i - 1].hostMs;
    const rows = Math.round((anchors[i].devMs - anchors[i - 1].devMs) / stepNomMs);
    if (!(rows > 0) || !Number.isFinite(dh)) continue;
    per.push(dh / rows);
  }
  if (!per.length) return { stepMs: null, intervals: 0 };
  per.sort((a, b) => a - b);
  const mid = per.length >> 1;
  const stepMs = per.length % 2 ? per[mid] : (per[mid - 1] + per[mid]) / 2;
  return { stepMs, intervals: per.length, anchorEvery };
}

/* Host time inside gaps, at anchor granularity: an interval that took longer than its rows can
   account for is the ring not delivering. Measured against `stepTrue`, so the drawn constant's own
   error is NOT counted here — the two causes stay separate, which is the whole deliverable. */
export function gapTimeMs(anchors, stepTrueMs, stepNomMs) {
  let g = 0;
  let intervals = 0;
  let worst = 0;
  if (!(stepTrueMs > 0)) return { gapMs: 0, gapIntervals: 0, worstGapMs: 0 };
  for (let i = 1; i < anchors.length; i++) {
    const rows = Math.round((anchors[i].devMs - anchors[i - 1].devMs) / stepNomMs);
    const excess = anchors[i].hostMs - anchors[i - 1].hostMs - rows * stepTrueMs;
    /* HALF A ROW IS JITTER, NOT A GAP. The host column is millisecond-rounded and re-anchored per
       frame, so every interval carries a few ms either way; only an excess that buys whole samples
       is loss. The bound is one row of the measured step, never a tuned number. */
    if (excess > stepTrueMs) {
      g += excess;
      intervals++;
      if (excess > worst) worst = excess;
    }
  }
  return { gapMs: g, gapIntervals: intervals, worstGapMs: worst };
}

/* THE DECOMPOSITION. Signs follow `hostAxis`: its divergence is `hostMs - devMs`, so a device axis
   running LONG than the host reads NEGATIVE ppm. Every term is ppm of the same device span, so they
   sum to `spanPpm` by construction and the residual is what no named cause explains. */
export function decompose({ n, hostSpanMs, devSpanMs, stepNomMs, stepTrueMs, gapMs, skippedSteps, axisPpm }) {
  if (!(devSpanMs > 0) || !(n > 1)) return null;
  const per = 1e6 / devSpanMs;
  const spanPpm = (hostSpanMs - devSpanMs) * per;
  const ratePpm = stepTrueMs == null ? null : (n - 1) * (stepTrueMs - stepNomMs) * per;
  const lossPpm = gapMs * per;
  const skipPpm = -(skippedSteps || 0) * stepNomMs * per;
  const named = (ratePpm || 0) + lossPpm + skipPpm;
  const jitterPpm = spanPpm - named;
  /* The smoothing's own contribution, which is the part no identity can show: `hostAxis` reads the
     running median at the LAST anchor, not the span, and the clamped window biases it by five
     anchors' drift (`clock.js`, CLAUDE.md §7). On a short fragment this term is the whole answer. */
  const endWindowPpm = Number.isFinite(axisPpm) ? axisPpm - spanPpm : null;
  const terms = {
    'drawn-constant-error': ratePpm,
    'undelivered-samples': lossPpm,
    'device-counted-skips': skipPpm,
    'host-stamp-jitter': jitterPpm,
    'end-window-median': endWindowPpm
  };
  let cause = null;
  let mag = -1;
  for (const [k, v] of Object.entries(terms)) {
    if (Number.isFinite(v) && Math.abs(v) > mag) {
      mag = Math.abs(v);
      cause = k;
    }
  }
  return { spanPpm, ...terms, cause, causePpm: cause ? terms[cause] : null, causeShare: Number.isFinite(axisPpm) && axisPpm !== 0 && cause ? terms[cause] / axisPpm : null };
}

/* Did the node publish this rate inside the floors it declares? Two independent reasons it may not
   have, counted separately: the span is under the one a rate needs, and the device column is too
   concentrated to be a clock at all. Neither is applied to an unsegmented recording today. */
export function outsideFloors(row, f) {
  const reasons = [];
  if (!Number.isFinite(row.axisPpm)) return { outside: false, reasons };
  if (Number.isFinite(f.rateMinSpanS) && Number.isFinite(row.devSpanMs) && row.devSpanMs / 1000 < f.rateMinSpanS) reasons.push('span-under-rate-floor');
  if (Number.isFinite(f.drawnShare) && Number.isFinite(row.quantizedShare) && row.quantizedShare >= f.drawnShare) reasons.push('device-column-drawn');
  return { outside: reasons.length > 0, reasons };
}

/* ── THE FRAGMENT WALK ───────────────────────────────────────────────────────────────────────── */

const SEMI = 0x3b;
const NL = 0x0a;
const CR = 0x0d;
const KEY_CAP = 65536;

/* One fragment, byte-scanned. Returns scalars and ~n/500 anchors; nothing else survives the call.
   The two columns are read differently ON PURPOSE: the device integer is parsed per row because the
   modal share and a one-row jump both need every delta, the host string only on the rows
   `parsePPG` anchors on, because `parseTimestamp` was half of `parsePPG` and this file reads 9.4 GB.
*/
export function measureFragmentFile(path, { anchorEvery, DexClock, bufBytes = 1 << 22 } = {}) {
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(bufBytes);
  let carry = null;
  let rows = 0;
  let devFirst = null;
  let devPrev = null;
  let devLast = null;
  let hostFirst = null;
  let hostLastRow = 0;
  let unparsedHost = 0;
  let malformed = 0;
  const deltas = new Map();
  let capped = false;
  let other = 0;
  const anchors = [];
  const takeLine = (line) => {
    let end = line.length;
    if (end && line[end - 1] === CR) end--;
    if (!end) return;
    if (line[0] === 0x50) return; // the header row — "Phone timestamp;…"
    const a = line.indexOf(SEMI);
    if (a < 0) {
      malformed++;
      return;
    }
    const b = line.indexOf(SEMI, a + 1);
    if (b < 0) {
      malformed++;
      return;
    }
    let dev = 0;
    let digits = 0;
    for (let i = a + 1; i < b; i++) {
      const c = line[i];
      if (c < 0x30 || c > 0x39) {
        digits = 0;
        break;
      }
      dev = dev * 10 + (c - 0x30);
      digits++;
    }
    if (!digits) {
      malformed++;
      return;
    }
    rows++;
    if (devFirst === null) devFirst = dev;
    else {
      const d = dev - devPrev;
      if (deltas.has(d)) deltas.set(d, deltas.get(d) + 1);
      else if (deltas.size < KEY_CAP) deltas.set(d, 1);
      else {
        other++;
        capped = true;
      }
    }
    devPrev = dev;
    devLast = dev;
    /* `parsePPG`'s own anchor rule, in its own terms: row 1 and every PPG_AXIS_EVERY-th ACCEPTED
       row. The count is the accepted one, so a malformed row shifts the phase here exactly as it
       does there. */
    if (rows === 1 || rows % anchorEvery === 0) {
      const h = hostMsOf(DexClock, line.latin1Slice(0, a));
      if (h === null) unparsedHost++;
      else {
        if (hostFirst === null) hostFirst = h;
        hostLastRow = rows;
        anchors.push({ devMs: (dev - devFirst) / 1e6, hostMs: h - hostFirst, row: rows });
      }
    }
  };
  try {
    for (;;) {
      const got = readSync(fd, buf, 0, bufBytes, null);
      if (got <= 0) break;
      let chunk = got === bufBytes ? buf : buf.subarray(0, got);
      if (carry) chunk = Buffer.concat([carry, chunk]);
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(NL, from);
        if (nl < 0) break;
        takeLine(chunk.subarray(from, nl));
        from = nl + 1;
      }
      carry = from < chunk.length ? Buffer.from(chunk.subarray(from)) : null;
    }
    if (carry) takeLine(carry);
  } finally {
    closeSync(fd);
  }
  const modal = modalOf(deltas);
  const skip = skippedStepsOf(deltas, modal.key);
  /* 🔴 THE TWO SPANS MUST COVER THE SAME ROWS, AND THE HOST COLUMN IS ONLY READ ON ANCHOR ROWS.
     Taking the device span over the whole file against a host span that stops at the last anchor
     attributes every row after it to drift — measured against this file's own selftest fixture:
     458 ms of real divergence read as 2046 ms, a 4.5x error, because 200 of 1200 rows had no host
     stamp. The anchor span is also exactly what `hostAxis` measured (`clock.js`: `span` is the
     device axis between the first and last anchor), so the decomposition and the quoted ppm
     describe one stretch of signal. The whole-file numbers travel beside it as data. */
  const last = anchors.length ? anchors[anchors.length - 1] : null;
  return {
    rows,
    ...skip,
    malformed,
    unparsedHost,
    deltaKeysCapped: capped,
    deltaKeysOther: other,
    modalDevNs: modal.key,
    quantizedShare: modal.share,
    distinctDevDeltas: modal.distinct,
    devSpanMs: last ? last.devMs : null,
    hostSpanMs: last ? last.hostMs : null,
    anchoredRows: last ? last.row : 0,
    rowsAfterLastAnchor: last ? rows - last.row : rows,
    devSpanFileMs: devFirst === null || devLast === null ? null : (devLast - devFirst) / 1e6,
    hostLastRow,
    anchors
  };
}

/* One fragment's row: the measured scalars, the rate `hostAxis` itself publishes over the same
   anchors, and the decomposition that accounts for it. The anchors are dropped on return. */
export function fragmentRow(raw, DexClock, f) {
  const stepNomMs = Number.isFinite(raw.modalDevNs) ? raw.modalDevNs / 1e6 : null;
  const ha = raw.anchors.length >= 3 ? DexClock.hostAxis(raw.anchors) : { ok: false, reason: `${raw.anchors.length} anchor(s)` };
  const robust = stepNomMs ? robustStepMs(raw.anchors, f.anchorEvery, stepNomMs) : { stepMs: null, intervals: 0 };
  const gaps = stepNomMs ? gapTimeMs(raw.anchors, robust.stepMs, stepNomMs) : { gapMs: 0, gapIntervals: 0, worstGapMs: 0 };
  /* THE SKIPS INSIDE THE ANCHORED SPAN, derived rather than re-counted: the device span in whole
     steps minus the intervals actually delivered IS the number of samples the counter spanned and
     never handed over. Exact, and it cannot disagree with the span it is subtracted from. */
  const nAnch = raw.anchoredRows || 0;
  const skipped = stepNomMs && nAnch > 1 && Number.isFinite(raw.devSpanMs) ? Math.max(0, Math.round(raw.devSpanMs / stepNomMs) - (nAnch - 1)) : 0;
  const row = {
    rows: raw.rows,
    anchoredRows: nAnch,
    rowsAfterLastAnchor: raw.rowsAfterLastAnchor,
    devSpanFileMs: raw.devSpanFileMs,
    malformed: raw.malformed,
    unparsedHostAnchors: raw.unparsedHost,
    anchors: raw.anchors.length,
    devSpanMs: raw.devSpanMs,
    hostSpanMs: raw.hostSpanMs,
    spanS: Number.isFinite(raw.devSpanMs) ? raw.devSpanMs / 1000 : null,
    stepNomMs,
    nominalHz: stepNomMs ? 1000 / stepNomMs : null,
    stepTrueMs: robust.stepMs,
    deliveredHz: robust.stepMs ? 1000 / robust.stepMs : null,
    rateIntervals: robust.intervals,
    quantizedShare: raw.quantizedShare,
    distinctDevDeltas: raw.distinctDevDeltas,
    deltaKeysCapped: raw.deltaKeysCapped,
    skippedSteps: skipped,
    skippedStepsFile: raw.skippedSteps || 0,
    devJumps: raw.devJumps || 0,
    devBackwards: raw.devBackwards || 0,
    ...gaps,
    axisPpm: ha && Number.isFinite(ha.ppm) ? ha.ppm : null,
    axisOk: !!(ha && ha.ok),
    axisReason: ha && ha.ok ? null : String((ha && ha.reason) || 'no reason given'),
    axisSpreadMs: ha && Number.isFinite(ha.spreadMs) ? ha.spreadMs : null,
    axisDrawn: ha ? ha.deviceDrawn === true : null,
    axisDrawnShare: ha && Number.isFinite(ha.drawnShare) ? ha.drawnShare : null
  };
  const dec = decompose({
    n: nAnch,
    hostSpanMs: raw.hostSpanMs,
    devSpanMs: raw.devSpanMs,
    stepNomMs,
    stepTrueMs: robust.stepMs,
    gapMs: gaps.gapMs,
    skippedSteps: skipped,
    axisPpm: row.axisPpm
  });
  const fl = outsideFloors(row, f);
  return { ...row, ...(dec || {}), outsideFloors: fl.outside, floorReasons: fl.reasons };
}

export function nightRow(night, frags) {
  const rated = frags.filter((x) => Number.isFinite(x.axisPpm));
  const worst = rated.length ? rated.reduce((a, b) => (Math.abs(b.axisPpm) > Math.abs(a.axisPpm) ? b : a)) : null;
  const causes = {};
  for (const x of rated) if (x.cause) causes[x.cause] = (causes[x.cause] || 0) + 1;
  return {
    night,
    fragments: frags.length,
    rows: frags.reduce((t, x) => t + x.rows, 0),
    ratedFragments: rated.length,
    /* ∅ — a night that rated nothing has no worst rate, and never a seeded 0. */
    worstAxisPpm: worst ? worst.axisPpm : null,
    worstCause: worst ? worst.cause : null,
    worstCauseShare: worst ? worst.causeShare : null,
    worstSpanS: worst ? worst.spanS : null,
    causes,
    fragmentsOutsideFloors: frags.filter((x) => x.outsideFloors).length,
    fragmentsUnderRateFloor: frags.filter((x) => x.floorReasons.includes('span-under-rate-floor')).length,
    fragmentsDrawnColumn: frags.filter((x) => x.floorReasons.includes('device-column-drawn')).length,
    maxQuantizedShare: nullableMax(frags.map((x) => x.quantizedShare)),
    minDeliveredHz: frags.reduce((a, x) => (Number.isFinite(x.deliveredHz) && (a === null || x.deliveredHz < a) ? x.deliveredHz : a), null),
    maxDeliveredHz: nullableMax(frags.map((x) => x.deliveredHz)),
    maxNominalHz: nullableMax(frags.map((x) => x.nominalHz)),
    skippedSteps: frags.reduce((t, x) => t + (x.skippedSteps || 0), 0),
    gapMs: frags.reduce((t, x) => t + (x.gapMs || 0), 0),
    frags
  };
}

/* THE COMMITTED ARTIFACT CARRIES THE WORST FRAGMENT, AND IT SAYS WHAT IT LEFT OUT. The full walk
   holds 708 fragment records and writes 985 KB, 12x the largest artifact this tree tracks, so the
   default projection keeps each night's decisive fragment and counts the rest in `fragsOmitted`.
   An omission that is not counted is the absence-as-value bug in artifact form (§∅), so the count
   is a field and never an empty list. `--all-fragments` writes every record for a local read. */
export function projectNight(row, { allFragments = false } = {}) {
  if (allFragments) return { ...row, fragsOmitted: 0 };
  const frags = row.frags || [];
  if (frags.length <= 1) return { ...row, frags, fragsOmitted: 0 };
  const rated = frags.filter((f) => Number.isFinite(f.axisPpm));
  /* The worst by |ppm| when any fragment published a rate, else the first — never an empty `frags`,
     because a night that rated nothing still has to show the shape the reader is judging. */
  const keep = rated.length ? rated.reduce((a, f) => (Math.abs(f.axisPpm) > Math.abs(a.axisPpm) ? f : a)) : frags[0];
  return { ...row, frags: [keep], fragsOmitted: frags.length - 1 };
}

export function verdictObject(rows, { eligible, excluded, excludedNights = [], floorsUsed, commit, commitReason, at, evidence = [] } = {}) {
  const criterion = {
    name: `fragments_publishing_a_rate_outside_the_node_own_floors (span < ${floorsUsed.rateMinSpanS} s or device concentration >= ${floorsUsed.drawnShare})`,
    threshold: 0,
    unit: 'fragments',
    direction: 'lte'
  };
  const base = { gate: 'ring-rate-cause', criterion, evidence: ['tools/ring-rate-cause.mjs', ...evidence], tool: 'tools/ring-rate-cause.mjs', commit, commitReason, at };
  if (!rows.length)
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: eligible || 0, excluded: excluded || 0 },
      result: null,
      reason: `no folded ring night had a readable raw plethysmogram on this box, so no rate was decomposed (${excludedNights.slice(0, 4).join(', ') || 'no night offered'})`
    });
  const allFrags = rows.flatMap((r) => r.frags);
  const rated = allFrags.filter((x) => Number.isFinite(x.axisPpm));
  const outside = allFrags.filter((x) => x.outsideFloors);
  const causes = {};
  for (const x of rated) if (x.cause) causes[x.cause] = (causes[x.cause] || 0) + 1;
  const nightCauses = {};
  for (const r of rows) if (r.worstCause) nightCauses[r.worstCause] = (nightCauses[r.worstCause] || 0) + 1;
  const result = {
    nightsChecked: rows.length,
    fragmentsChecked: allFrags.length,
    rowsRead: rows.reduce((t, r) => t + r.rows, 0),
    fragmentsRated: rated.length,
    fragmentsPublishingOutsideFloors: outside.length,
    fragmentsUnderRateFloor: allFrags.filter((x) => x.floorReasons.includes('span-under-rate-floor')).length,
    fragmentsDrawnColumn: allFrags.filter((x) => x.floorReasons.includes('device-column-drawn')).length,
    rateMinSpanS: floorsUsed.rateMinSpanS,
    drawnShareFloor: floorsUsed.drawnShare,
    anchorEvery: floorsUsed.anchorEvery,
    /* THE ANSWER, counted two ways: per fragment, and per night by its worst fragment, because the
       order asks for one cause per night and a night holds fragments that differ. */
    causeByFragment: causes,
    causeByNightWorstFragment: nightCauses,
    nightsWorseThan50Ppm: rows.filter((r) => Number.isFinite(r.worstAxisPpm) && Math.abs(r.worstAxisPpm) > 50).length,
    maxAbsAxisPpm: nullableMax(rated.map((x) => Math.abs(x.axisPpm))),
    /* The delivered rate, measured over clean intervals on the host column — reported so the drawn
       constant's error is readable, and never fed back into it. */
    deliveredHzMin: rows.reduce((a, r) => (Number.isFinite(r.minDeliveredHz) && (a === null || r.minDeliveredHz < a) ? r.minDeliveredHz : a), null),
    deliveredHzMax: nullableMax(rows.map((r) => r.maxDeliveredHz)),
    nominalHz: nullableMax(rows.map((r) => r.maxNominalHz)),
    skippedSteps: rows.reduce((t, r) => t + r.skippedSteps, 0),
    gapMs: Math.round(rows.reduce((t, r) => t + r.gapMs, 0))
  };
  const population = { checked: rows.length, eligible: eligible || rows.length, excluded: excluded || 0 };
  if (outside.length)
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `${outside.length} of ${rated.length} rated fragment(s) publish a rate outside the node's own floors (${result.fragmentsUnderRateFloor} under ${floorsUsed.rateMinSpanS} s of span, ${result.fragmentsDrawnColumn} over a drawn device column); the dominant named cause per night is ${Object.entries(
        nightCauses
      )
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`
    });
  return makeVerdict({ ...base, status: 'PASS', population, result, reason: null });
}

/* ── THE WALK ────────────────────────────────────────────────────────────────────────────────── */

export function runCause({ uploads = CORPUS.dir, night = null, limit = null, log = () => {} } = {}) {
  const f = floors();
  if (!Number.isFinite(f.rateMinSpanS) || !Number.isFinite(f.drawnShare) || !Number.isFinite(f.anchorEvery)) {
    const miss = Object.entries(f)
      .filter(([, v]) => !Number.isFinite(v))
      .map(([k]) => k);
    throw new Error(`the declared floor(s) ${miss.join(', ')} would not read — this tool keeps no copy of them`);
  }
  const folded = foldedRingNights(uploads);
  const eligibleRows = folded.nights.filter((r) => !night || r.night === night);
  const capturesRoot = join(uploads, 'vigil-archive', 'captures');
  const before = snapshotNights(capturesRoot);
  const DexClock = clockRealm();
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
    const frags = [];
    for (const fr of got.frags) {
      let raw = null;
      try {
        raw = measureFragmentFile(fr.full, { anchorEvery: f.anchorEvery, DexClock });
      } catch (e) {
        /* §∅ — reduced coverage is NAMED and counted, never folded into "this night has nothing".
           The message carries the path, so it is blinded at the write, not here. */
        unreadableNights.push({ night: el.night, errno: `a fragment would not read: ${String((e && e.message) || e).slice(0, 120)}` });
        continue;
      }
      frags.push(fragmentRow(raw, DexClock, f));
      raw = null;
    }
    if (!frags.length) {
      excludedNights.push(el.night);
      continue;
    }
    const row = nightRow(el.night, frags);
    rows.push(row);
    log(
      `  ${row.fragmentsOutsideFloors ? '✗' : '·'} ${row.night}  frags ${String(row.fragments).padStart(3)}` +
        `  rated ${String(row.ratedFragments).padStart(3)}  worst ${row.worstAxisPpm == null ? 'null' : row.worstAxisPpm.toFixed(0).padStart(7)} ppm` +
        `  over ${row.worstSpanS == null ? 'null' : row.worstSpanS.toFixed(0).padStart(5)} s` +
        `  cause ${row.worstCause || 'none'}` +
        `  delivered ${row.minDeliveredHz == null ? 'null' : row.minDeliveredHz.toFixed(3)}–${row.maxDeliveredHz == null ? 'null' : row.maxDeliveredHz.toFixed(3)} Hz`
    );
  }
  const after = snapshotNights(capturesRoot);
  return {
    rows,
    floorsUsed: f,
    eligible: eligibleRows.length + folded.unreadable.length,
    excludedNights: [...new Set([...excludedNights, ...folded.unreadable.map((u) => u.night)])],
    unreadableNights,
    before,
    after,
    capturesRoot
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────── */

export function verdictSample() {
  /* COMPUTED, never quoted: the adoption gate runs this and validates the object, and a literal
     would go stale the moment the criterion moved. Two synthetic fragments — one long and inside the
     floors, one 20 s fragment whose tail jitter carries the rate — so the FAIL branch is exercised
     with both floor reasons present. */
  const f = { rateMinSpanS: 2400, drawnShare: 0.67, anchorEvery: 500 };
  const long = {
    rows: 400000,
    malformed: 0,
    unparsedHostAnchors: 0,
    anchors: 800,
    devSpanMs: 3181218,
    hostSpanMs: 3177000,
    spanS: 3181.2,
    stepNomMs: 7.953045,
    nominalHz: 125.738,
    stepTrueMs: 7.9425,
    deliveredHz: 125.904,
    rateIntervals: 799,
    quantizedShare: 1,
    distinctDevDeltas: 1,
    deltaKeysCapped: false,
    skippedSteps: 0,
    devJumps: 0,
    devBackwards: 0,
    gapMs: 0,
    gapIntervals: 0,
    worstGapMs: 0,
    axisPpm: -1261.2,
    axisOk: true,
    axisReason: null,
    axisSpreadMs: 4361,
    axisDrawn: true,
    axisDrawnShare: 0.72
  };
  const short = { ...long, rows: 2296, anchors: 5, devSpanMs: 18260, hostSpanMs: 20000, spanS: 18.26, axisPpm: -87838.1, axisSpreadMs: 312 };
  const mk = (r) => {
    const dec = decompose({
      n: r.rows,
      hostSpanMs: r.hostSpanMs,
      devSpanMs: r.devSpanMs,
      stepNomMs: r.stepNomMs,
      stepTrueMs: r.stepTrueMs,
      gapMs: r.gapMs,
      skippedSteps: r.skippedSteps,
      axisPpm: r.axisPpm
    });
    const fl = outsideFloors(r, f);
    return { ...r, ...dec, outsideFloors: fl.outside, floorReasons: fl.reasons };
  };
  const rows = [nightRow('2026-08-30', [mk(long), mk(short)])];
  return verdictObject(rows, { eligible: 74, excluded: 73, floorsUsed: f, commit: null, commitReason: 'verdict sample', at: '2026-10-29T00:00:00Z', evidence: ['uploads/vigil-archive/captures'] });
}

function selftest() {
  const fails = [];
  let ran = 0;
  const eq = (what, got, want) => {
    ran++;
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) fails.push(`${what}\n    got  ${a}\n    want ${b}`);
  };
  const near = (what, got, want, tol) => {
    ran++;
    if (!(Number.isFinite(got) && Math.abs(got - want) <= tol)) fails.push(`${what}\n    got  ${got}\n    want ${want} ±${tol}`);
  };

  /* THE FLOORS FAIL CLOSED. A declaration this file cannot read must never read as a zero floor,
     which would pass every fragment and report the defect gone. */
  eq('a declared const is read', readDeclaredNumber('const PPG_RATE_MIN_SPAN_S = 2400;', 'PPG_RATE_MIN_SPAN_S'), 2400);
  eq('a declared var is read', readDeclaredNumber('  var CK_AXIS_DRAWN_SHARE = 0.67; // share', 'CK_AXIS_DRAWN_SHARE'), 0.67);
  eq('an absent declaration is null, never 0', readDeclaredNumber('const OTHER = 5;', 'PPG_RATE_MIN_SPAN_S'), null);
  eq('a mention that is not a declaration is not read', readDeclaredNumber('// see PPG_RATE_MIN_SPAN_S 2400', 'PPG_RATE_MIN_SPAN_S'), null);
  const live = floors();
  eq('the three live floors all read', [Number.isFinite(live.rateMinSpanS), Number.isFinite(live.drawnShare), Number.isFinite(live.anchorEvery)], [true, true, true]);

  /* THE HOST COLUMN THROUGH THE ONE PARSER. These assertions are not a second test of `clock.js`:
     they pin that this file reads the column through it and gets floating wall-clock ms, because a
     local regex here is exactly the mirror §✅ forbids. */
  const CK = clockRealm();
  eq('a capture-host stamp parses to floating wall-clock ms', hostMsOf(CK, '2026-07-25T22:28:15.326'), Date.UTC(2026, 6, 25, 22, 28, 15, 326));
  eq('a space separator parses', hostMsOf(CK, '2026-07-25 22:28:15.326'), Date.UTC(2026, 6, 25, 22, 28, 15, 326));
  eq('a stamp with no fraction parses', hostMsOf(CK, '2026-07-25T22:28:15'), Date.UTC(2026, 6, 25, 22, 28, 15, 0));
  eq('an out-of-range hour is refused, never rolled', hostMsOf(CK, '2026-07-25T25:28:15.326'), null);
  eq('an out-of-range month is refused', hostMsOf(CK, '2026-13-25T22:28:15.326'), null);
  eq('a stamp-less field is null', hostMsOf(CK, 'sensor'), null);

  /* THE DRAWN STEP IS MEASURED. Re-calibrating the constant is the one remedy this tool may not
     propose (`ext:memory/o2ring-timestamp-is-drawn`), so the step comes from the file. */
  eq(
    'the modal delta and its share',
    modalOf(
      new Map([
        [7953045, 99],
        [500000, 1]
      ])
    ),
    { key: 7953045, count: 99, total: 100, share: 0.99, distinct: 2 }
  );
  eq('an empty delta set has no modal step, and no 0', modalOf(new Map()), { key: null, count: 0, total: 0, share: null, distinct: 0 });
  eq('a counter that never jumped skips nothing', skippedStepsOf(new Map([[7953045, 1000]]), 7953045), { skippedSteps: 0, devJumps: 0, devBackwards: 0 });
  eq(
    'a jump of 57 steps is 56 samples the counter spanned',
    skippedStepsOf(
      new Map([
        [7953045, 1000],
        [453323565, 1]
      ]),
      7953045
    ),
    { skippedSteps: 56, devJumps: 1, devBackwards: 0 }
  );
  eq(
    'a backward delta is a resync, counted apart from loss',
    skippedStepsOf(
      new Map([
        [7953045, 10],
        [-900000000, 2]
      ]),
      7953045
    ),
    { skippedSteps: 0, devJumps: 0, devBackwards: 2 }
  );
  eq(
    'a delta under one step buys no samples',
    skippedStepsOf(
      new Map([
        [7953045, 10],
        [4000000, 3]
      ]),
      7953045
    ),
    { skippedSteps: 0, devJumps: 3, devBackwards: 0 }
  );
  eq('no modal step means no skip arithmetic at all', skippedStepsOf(new Map([[1, 1]]), null), { skippedSteps: 0, devJumps: 0, devBackwards: 0 });

  /* THE DELIVERED INTERVAL. A plain span/(n-1) counts a dropout as rate, which is the arithmetic
     that makes a 20 s fragment read tens of thousands of ppm. */
  const step = 7.953045;
  const clean = [0, 1, 2, 3, 4].map((i) => ({ devMs: i * 500 * step, hostMs: i * 500 * 7.9425 }));
  near('a clean run measures the delivered interval', robustStepMs(clean, 500, step).stepMs, 7.9425, 1e-9);
  const withGap = clean.map((a, i) => (i >= 3 ? { devMs: a.devMs, hostMs: a.hostMs + 4000 } : a));
  near('the median rejects the interval that holds the dropout', robustStepMs(withGap, 500, step).stepMs, 7.9425, 1e-9);
  eq('one anchor is not a measurement of a rate', robustStepMs([{ devMs: 0, hostMs: 0 }], 500, step), { stepMs: null, intervals: 0 });
  eq('four gap intervals of 4 s are found and the worst named', gapTimeMs(withGap, 7.9425, step), { gapMs: 4000, gapIntervals: 1, worstGapMs: 4000 });
  eq(
    'millisecond rounding is jitter, not a gap',
    gapTimeMs(
      clean.map((a, i) => ({ devMs: a.devMs, hostMs: a.hostMs + (i % 2) })),
      7.9425,
      step
    ),
    { gapMs: 0, gapIntervals: 0, worstGapMs: 0 }
  );
  eq('with no delivered interval there is no gap arithmetic', gapTimeMs(clean, null, step), { gapMs: 0, gapIntervals: 0, worstGapMs: 0 });

  /* THE DECOMPOSITION. Every term is ppm of one span, so they sum to the identity by construction
     and `host-stamp-jitter` is what no named cause explains. */
  const n = 400001;
  const pure = decompose({ n, hostSpanMs: (n - 1) * 7.9425, devSpanMs: (n - 1) * step, stepNomMs: step, stepTrueMs: 7.9425, gapMs: 0, skippedSteps: 0, axisPpm: -1300 });
  near('a wrong constant over a clean recording is the drawn-constant term', pure['drawn-constant-error'], -1326, 2);
  eq('and it is the cause', [pure.cause, Math.abs(pure['host-stamp-jitter']) < 1e-6], ['drawn-constant-error', true]);
  near('the terms sum to the span identity', pure['drawn-constant-error'] + pure['undelivered-samples'] + pure['device-counted-skips'] + pure['host-stamp-jitter'], pure.spanPpm, 1e-6);
  const lossy = decompose({ n: 2296, hostSpanMs: 20000, devSpanMs: 18260, stepNomMs: step, stepTrueMs: step, gapMs: 1740, skippedSteps: 0, axisPpm: 95000 });
  eq('a dropout the axis did not span is undelivered-samples', lossy.cause, 'undelivered-samples');
  const skipped = decompose({ n: 30868, hostSpanMs: 247100, devSpanMs: 247300, stepNomMs: step, stepTrueMs: step, gapMs: 0, skippedSteps: 224, axisPpm: -800 });
  eq('a dropout the axis did span is device-counted-skips', skipped.cause, 'device-counted-skips');
  const tail = decompose({ n: 2296, hostSpanMs: 18260, devSpanMs: 18260, stepNomMs: step, stepTrueMs: step, gapMs: 0, skippedSteps: 0, axisPpm: -5000 });
  eq('a rate the span identity does not hold is the end window', [tail.cause, Math.round(tail['end-window-median'])], ['end-window-median', -5000]);
  eq(
    'a fragment with no device span decomposes to nothing, never to 0 ppm',
    decompose({ n: 10, hostSpanMs: 100, devSpanMs: 0, stepNomMs: step, stepTrueMs: step, gapMs: 0, skippedSteps: 0, axisPpm: 1 }),
    null
  );
  eq('one row is not a span', decompose({ n: 1, hostSpanMs: 0, devSpanMs: 100, stepNomMs: step, stepTrueMs: step, gapMs: 0, skippedSteps: 0, axisPpm: 1 }), null);

  /* THE CRITERION. Both floors are the NODE's, and an unpublished rate is outside nothing. */
  const f = { rateMinSpanS: 2400, drawnShare: 0.67, anchorEvery: 500 };
  eq('a short fragment is under the rate floor', outsideFloors({ axisPpm: -9484, devSpanMs: 20000, quantizedShare: 0.1 }, f), { outside: true, reasons: ['span-under-rate-floor'] });
  eq('a drawn column is outside whatever its span', outsideFloors({ axisPpm: -1261, devSpanMs: 9e6, quantizedShare: 1 }, f), { outside: true, reasons: ['device-column-drawn'] });
  eq('both reasons are reported, not the first', outsideFloors({ axisPpm: -87838, devSpanMs: 18260, quantizedShare: 1 }, f).reasons, ['span-under-rate-floor', 'device-column-drawn']);
  eq('a long fragment with a measured column is inside the floors', outsideFloors({ axisPpm: -12, devSpanMs: 9e6, quantizedShare: 0.02 }, f), { outside: false, reasons: [] });
  eq('a fragment that published no rate is outside nothing', outsideFloors({ axisPpm: null, devSpanMs: 20, quantizedShare: 1 }, f), { outside: false, reasons: [] });

  /* THE NIGHT ROW. ∅ — a night that rated nothing has no worst rate. */
  const fr = (over) => ({
    rows: 10,
    axisPpm: over,
    cause: 'drawn-constant-error',
    causeShare: 1,
    spanS: 3000,
    quantizedShare: 1,
    deliveredHz: 125.9,
    nominalHz: 125.738,
    outsideFloors: true,
    floorReasons: ['device-column-drawn'],
    skippedSteps: 0,
    gapMs: 0
  });
  const nr = nightRow('2026-08-30', [fr(-100), fr(-30681), fr(-5)]);
  eq('the worst fragment is the worst by magnitude, and its cause travels', [nr.worstAxisPpm, nr.worstCause, nr.ratedFragments], [-30681, 'drawn-constant-error', 3]);
  const none = nightRow('2026-08-31', [{ ...fr(null), axisPpm: null, cause: null, outsideFloors: false, floorReasons: [] }]);
  eq('a night that rated nothing has no worst rate and no cause', [none.worstAxisPpm, none.worstCause, none.fragmentsOutsideFloors], [null, null, 0]);

  /* THE VERDICT. `checked + excluded = eligible`, a non-PASS carries a reason, and PASS over
     nothing is invalid — `makeVerdict` enforces the contract, these assertions pin the branches. */
  const empty = verdictObject([], { eligible: 74, excluded: 74, excludedNights: ['2026-07-25'], floorsUsed: f, commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' });
  eq('a corpus with no readable fragment is NOT_RUN with a reason', [empty.status, empty.result, !!empty.reason], ['NOT_RUN', null, true]);
  const bad = verdictObject([nr], { eligible: 1, excluded: 0, floorsUsed: f, commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' });
  eq('a fragment published outside the floors FAILs, and the count is fragments', [bad.status, bad.result.fragmentsPublishingOutsideFloors, bad.criterion.unit], ['FAIL', 3, 'fragments']);
  eq('the causes are counted per fragment and per night', [bad.result.causeByFragment['drawn-constant-error'], bad.result.causeByNightWorstFragment['drawn-constant-error']], [3, 1]);
  const okRow = nightRow('2026-09-01', [{ ...fr(-12), quantizedShare: 0.02, outsideFloors: false, floorReasons: [] }]);
  const good = verdictObject([okRow], { eligible: 1, excluded: 0, floorsUsed: f, commit: null, commitReason: 'selftest', at: '2026-10-29T00:00:00Z' });
  eq('a corpus inside the floors PASSes with no reason', [good.status, good.reason], ['PASS', null]);
  const sample = verdictSample();
  eq(
    'the documented object is the FAIL branch, computed',
    [sample.schema, sample.gate, sample.status, sample.population.checked + sample.population.excluded === sample.population.eligible],
    ['tepna.verdict/1', 'ring-rate-cause', 'FAIL', true]
  );
  eq('and its short fragment carries both floor reasons', sample.result.fragmentsUnderRateFloor, 1);

  /* THE BYTE SCANNER, against a file written for it: the header row, CRLF, a malformed row, the
     anchor phase, and a device jump — the five things the stream has to get right over 9.4 GB. */
  const tmp = join(tmpdir(), `ring-rate-cause-selftest-${process.pid}.txt`);
  const lines = ['Phone timestamp;sensor timestamp [ns];channel 0'];
  let ns = 0;
  for (let i = 0; i < 1200; i++) {
    const ms = Math.round(i * 7.9425);
    const d = new Date(Date.UTC(2026, 6, 25, 22, 28, 15, 0) + ms);
    const stamp = `${d.toISOString().slice(0, 19)}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
    lines.push(`${stamp};${ns};${100 + (i % 7)}`);
    ns += i === 600 ? 7953045 * 57 : 7953045;
    if (i === 300) lines.push('a malformed row with no second field');
  }
  writeFileSync(tmp, `${lines.join('\r\n')}\r\n`);
  const raw = measureFragmentFile(tmp, { anchorEvery: 500, DexClock: CK });
  unlinkSync(tmp);
  eq('the header and the malformed row are not samples', [raw.rows, raw.malformed], [1200, 1]);
  eq('the modal step is the drawn one and the jump is the counter spanning a dropout', [raw.modalDevNs, raw.skippedSteps, raw.devJumps], [7953045, 56, 1]);
  eq(
    'the anchor rows are row 1 and every 500th, as parsePPG counts them',
    raw.anchors.map((a) => a.row),
    [1, 500, 1000]
  );
  eq('the span stops at the last anchor, and the rows past it are named', [raw.anchoredRows, raw.rowsAfterLastAnchor], [1000, 200]);
  near('the device span carries the jump, the host span does not', raw.devSpanMs - raw.hostSpanMs, 56 * 7.953045 + 999 * (7.953045 - 7.9425), 2);
  const sr = fragmentRow(raw, CK, { rateMinSpanS: 2400, drawnShare: 0.67, anchorEvery: 500 });
  eq('the anchored skip count is derived from the span, not re-counted', sr.skippedSteps, 56);
  eq('and a 8 s fragment over a drawn column is outside both floors', sr.floorReasons, ['span-under-rate-floor', 'device-column-drawn']);

  /* THE PROJECTION. A dropped record that is not counted is absence as a value (§∅). */
  const pn = {
    night: '2026-01-01',
    frags: [
      { axisPpm: -10, rows: 1 },
      { axisPpm: 900, rows: 2 },
      { axisPpm: null, rows: 3 }
    ]
  };
  eq('the projection keeps one fragment', projectNight(pn).frags.length, 1);
  eq('and it keeps the worst by absolute ppm', projectNight(pn).frags[0].axisPpm, 900);
  eq('and it counts what it dropped', projectNight(pn).fragsOmitted, 2);
  eq('--all-fragments keeps every record', projectNight(pn, { allFragments: true }).frags.length, 3);
  eq('--all-fragments omits nothing', projectNight(pn, { allFragments: true }).fragsOmitted, 0);
  eq(
    'a night that rated nothing still shows a fragment',
    projectNight({
      night: 'x',
      frags: [
        { axisPpm: null, rows: 1 },
        { axisPpm: null, rows: 2 }
      ]
    }).frags.length,
    1
  );
  eq('a one-fragment night omits nothing', projectNight({ night: 'x', frags: [{ axisPpm: 1 }] }).fragsOmitted, 0);

  if (fails.length) {
    for (const x of fails) console.error(`✗ ${x}`);
    console.error(`✗ ring-rate-cause selftest: ${fails.length} failure(s)`);
    process.exit(1);
  }
  console.error(`✓ ring-rate-cause selftest: ${ran} assertions passed`);
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json', '--all-fragments'], valued: ['--out', '--night', '--limit'], positional: false }, { tool: 'ring-rate-cause' });
  if (argv.includes('--selftest')) selftest();
  else if (argv.includes('--verdict-sample')) console.log(JSON.stringify(verdictSample()));
  else {
    const val = (flag) => {
      const i = argv.indexOf(flag);
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
    console.error(`  corpus search:\n${formatCorpusSearch(CORPUS)}`);
    let walk;
    try {
      walk = runCause({ night: val('--night'), limit, log: (s) => console.error(s) });
    } catch (e) {
      /* THE ROOT AND THE FLOORS, not a night: an unreadable corpus root and an unreadable floor are
         both discontinuities, and this exits 2 naming which one — never scores them zero. */
      console.error(`✗ ${(e && e.message) || e}`);
      console.error(`  corpus search:\n${formatCorpusSearch(CORPUS)}`);
      process.exit(2);
    }
    const { rows, floorsUsed, eligible, excludedNights, unreadableNights, before, after, capturesRoot } = walk;
    const { commit, reason: commitReason } = gitCommitOf(ROOT);
    const pop = populationVerdict(before, after, { commit, commitReason, tool: 'tools/ring-rate-cause.mjs', evidence: [collapseHome(capturesRoot)] });
    const v = verdictObject(rows, { eligible, excluded: excludedNights.length, excludedNights, floorsUsed, commit, commitReason, evidence: ['uploads/trio', 'uploads/vigil-archive/captures'] });
    const out = val('--out');
    if (out) {
      /* Blinded, because a read error's sentence carries the path it could not read and no field
         name predicts it. Projected, and the projection counts its own omissions. */
      const allFragments = argv.includes('--all-fragments');
      const nights = rows.map((r) => projectNight(r, { allFragments }));
      const blind = homeBlind(
        `${JSON.stringify({ schema: 'tepna.ring-rate-cause/1', at: v.at, producedBy: v.producedBy, verdict: v, population: pop, floors: floorsUsed, fragmentRecords: allFragments ? 'every rated fragment' : "each night's worst fragment by |ppm|, the rest counted in fragsOmitted", excludedNights, unreadableNights, nights }, null, 1)}\n`
      );
      if (blind.replaced) console.error(`⚠ ${blind.replaced} absolute home path(s) collapsed to ~ before the write`);
      writeFileSync(out, blind.text);
      console.error(`→ ${out}`);
    }
    console.error(`  corpus population: ${pop.status} — ${pop.reason || 'the night set held still across the run'}`);
    const ruleAccount = ruleLine(pop);
    if (ruleAccount) console.error(`  ${ruleAccount}`);
    console.error(
      `  ${rows.length} night(s) decomposed, ${excludedNights.length} excluded` +
        (unreadableNights.length ? `, ${unreadableNights.length} unreadable (${unreadableNights.map((u) => `${u.night}: ${u.errno}`).join('; ')})` : '') +
        `, in ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    printVerdict(v, { json });
    process.exit(v.status === 'FAIL' ? 1 : 0);
  }
}
