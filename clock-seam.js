/* ════ Tepna · shared clock-seam tripwire (clock-seam.js) ──────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS. The Clock Contract §7 says a node that does not detect clock
 * steps owes a TRIPWIRE. This module is the one helper OxyDex, PulseDex and
 * HRVDex call (DEVICE-TIME-HANDLING-2026-10-29 §U3).
 *
 * ⚠️ WHAT THOSE THREE ALREADY HAD, because the unit was sized as though they had
 * nothing and that premise is wrong. PulseDex carries the TWO-CLOCK
 * discriminator (`PD_RESYNC_BOUND_MS`, the shared 60 s bound ECGDex, PpgDex and
 * MotionDex also use) and refuses its whole-record variability metrics with
 * `hrvReason:'clock-seam'`. OxyDex guards its span against the row count and
 * cadence (`clockNonMonotonic`, `durationInflated`) and relabels the coverage
 * block `discontinuous`. HRVDex was pinned structurally exempt in the suite.
 *
 * SO THIS IS A DIFFERENT INSTRUMENT, AND NAMING MATTERS MORE THAN USUAL. The
 * resync bound answers "do the device clock and the host clock disagree", which
 * needs two clocks and catches a step wherever it sits. The endpoint guard
 * answers "is first-to-last plausible", which catches a step only when it
 * survives to the ends. Neither sees a step that lands mid-file and leaves the
 * endpoints plausible on a single clock — a 90 s back-step in the middle of an
 * otherwise ordinary night — and that is this module's question. A node may run
 * both: they are not redundant, and the suite pins the bound so a reader cannot
 * read one as the other.
 *
 * THE RULING IT IMPLEMENTS (owner, 2026-09-17). A DISCONTINUITY refuses and a
 * reduced COVERAGE annotates: a window split by a seam is `null` with reason
 * `clock-seam`, while a window merely thinned by a dropout keeps its value with
 * the covered span beside it. The two look alike in a stamp column — both are a
 * long gap — so the discriminator is stated here rather than guessed per node.
 *
 * THE BAR IS THE FILE'S OWN DISTRIBUTION, NEVER A FIXED MILLISECOND VALUE
 * (§∅). A ring at 4 s and a beat series at 0.8 s cannot share a constant, and a
 * constant tuned on one corpus silently stops firing on the next device. So the
 * centre is the MEDIAN interval and the spread is the MAD of the intervals the
 * file itself carries.
 *
 * ⚠️ THE KNOWN FAILURE OF A SELF-SCALED BAR (memory `solid-night-verdict-inputs`,
 * 2026-09-24): a noisy night inflates its own bar and hides its own steps. That
 * is why this module publishes `medianMs`, `madMs`, `barMs`, `n` and
 * `dominantShare` beside every verdict — a reader can see the bar that judged
 * the file — and why a thin file gets `barMs: null` instead of a bar computed
 * from a handful of intervals. A null bar still judges a BACKWARD stamp, which
 * is decided by recovery rather than by the distribution (below).
 *
 * RUN LENGTH, NOT A LONE OUTLIER. A single wide interval in a jittery stream is
 * an outlier; a clock step separates two established runs of the file's own
 * cadence. A forward candidate is therefore declared a seam only when at least
 * CK_SEAM_MIN_RUN in-bar intervals sit on BOTH sides of it. A candidate that
 * fails that test is reported in `unsettled` with its reason, never dropped
 * silently — an unexamined gap would otherwise read as a clean file.
 *
 * WHAT IT REFUSES TO DECIDE. In a stream whose intervals ARE the signal (RR
 * beats, HRV sessions) a forward gap cannot be told from a clock jump by phase,
 * because there is no phase. The scan says so in `forwardDecidable: false`
 * rather than reporting zero forward seams, because a zero there would be a
 * manufactured absence (§∅).
 *
 * AND HOW MUCH IT CANNOT SEE EVEN THEN — measured while writing this module,
 * not reasoned about. On ONE clock a forward step and a dropout of the same
 * length are the same column of stamps. Phase is the only discriminator left,
 * so a step landing within the file's own jitter of a whole number of cadences
 * is invisible here: a 137 s step on a 4 s ring cadence reads as a 34-cadence
 * dropout, correctly, because nothing in the file says otherwise. The width of
 * that blind band is a property of the file, so the scan PUBLISHES it as
 * `forwardBlindShare` — the share of arbitrary forward steps this file's jitter
 * hides. A reader who needs the rest of them needs a SECOND clock, which is
 * what `PD_RESYNC_BOUND_MS` and its siblings use, and that is why this module
 * complements them instead of replacing them. A BACKWARD step needs no phase,
 * no cadence and no bar — but it does have to prove it is not a re-ordered BLE
 * packet, which the corpus forced and `CK_SEAM_RECOVER_RUN` states.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── pre-stated constants (§🧾: a threshold derived from the data it judges is
     not a criterion). Each is a shape decision, not a tuned knob. ────────── */
  // Two stamps make one interval; below that there is nothing to examine at all.
  var CK_SEAM_MIN_STAMPS = 2;
  /* A median and a MAD over fewer than this many intervals describe the handful
     they were drawn from, not the file. Below it the bar is `null` and only
     backward stamps are judged. */
  var CK_SEAM_MIN_INTERVALS = 8;
  // Robust sigmas above the median before an interval is a candidate.
  var CK_SEAM_K = 6;
  /* A perfectly drawn stream has MAD 0, which would put the bar ON the median
     and make every quantum of jitter a candidate. The spread floor is a fraction
     of the file's own cadence — still the file's distribution, never a constant. */
  var CK_SEAM_SIGMA_FLOOR_FRAC = 0.05;
  /* Share of intervals landing on one value before the stream counts as having a
     cadence at all. Same reasoning and same number as `CK_AXIS_DRAWN_SHARE` in
     clock.js: two thirds on one value is a rate, not a coincidence. */
  var CK_SEAM_REGULAR_SHARE = 0.67;
  // In-bar intervals needed on each side before a forward candidate is a seam.
  var CK_SEAM_MIN_RUN = 3;
  /* RECOVERY — how many samples a BACKWARD stamp gets to climb back over the
     level it fell from before it is called a clock step rather than delivery
     re-ordering. Measured on the real RR corpus (18 Polar Sensor Logger files,
     252 329 intervals, 2026-10-29): 81 backward stamps, every one of them
     recovering within 2 to 6 samples, 67 of them in 2. A clock step does not
     recover at all — it takes its whole magnitude to climb back, which is 23
     samples for a 90 s step on a 4 s cadence and about 90 on a 1 s one. 20
     leaves over 3x headroom above the worst real re-ordering and still sits far
     below any step worth refusing a window for. */
  var CK_SEAM_RECOVER_RUN = 20;

  function _med(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) {
      return x - y;
    });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Scan a stamp series in ROW ORDER for clock seams.
   * @param {Array<number>} stamps floating wall-clock ms, as the file lists them
   * @param {{minIntervals?:number,k?:number,minRun?:number,label?:string}} [opts]
   * @returns {Object} the scan verdict; `ok:false` only when nothing was examined
   */
  function seamScan(stamps, opts) {
    /* Read the options through ONE cast at the declaration, the idiom the type gate's own notes
       prescribe (tsconfig.json //d2): casting each property access instead would rewrite lines a
       source-text gate may be reading verbatim. */
    var o = /** @type {any} */ (opts || {});
    var label = o.label == null ? null : String(o.label);
    var minIntervals = o.minIntervals > 0 ? o.minIntervals | 0 : CK_SEAM_MIN_INTERVALS;
    var k = o.k > 0 ? +o.k : CK_SEAM_K;
    var minRun = o.minRun >= 0 ? o.minRun | 0 : CK_SEAM_MIN_RUN;

    /* A non-finite stamp is an ABSENT stamp (§∅) — it is skipped and COUNTED, so
       a caller can see how much of the column never parsed. It is never read as
       a zero, and it never joins the distribution. */
    var t = [],
      srcIdx = [],
      skipped = 0;
    var list = stamps && stamps.length ? stamps : [];
    for (var i = 0; i < list.length; i++) {
      var v = +list[i];
      if (!isFinite(v)) {
        skipped++;
        continue;
      }
      t.push(v);
      srcIdx.push(i);
    }
    if (t.length < CK_SEAM_MIN_STAMPS)
      return { ok: false, reason: 'fewer than ' + CK_SEAM_MIN_STAMPS + ' parseable stamps — nothing to examine', n: 0, stamps: t.length, skipped: skipped, label: label };

    // ── the intervals the file itself carries, in row order ──
    var d = [],
      at = [],
      idx = [];
    for (var j = 1; j < t.length; j++) {
      d.push(t[j] - t[j - 1]);
      at.push(t[j]);
      idx.push(srcIdx[j]);
    }
    var n = d.length;

    /* THE DISTRIBUTION comes from the FORWARD intervals only. A backward stamp is
       the defect being hunted; letting it into the centre would widen the bar that
       has to catch it. */
    var fwd = [];
    for (var f = 0; f < n; f++) if (d[f] > 0) fwd.push(d[f]);
    var medianMs = null,
      madMs = null,
      barMs = null,
      sigmaMs = null;
    if (fwd.length >= minIntervals) {
      medianMs = _med(fwd);
      var dev = [];
      for (var m = 0; m < fwd.length; m++) dev.push(Math.abs(fwd[m] - medianMs));
      madMs = _med(dev);
      sigmaMs = 1.4826 * madMs;
      var floor = Math.abs(medianMs) * CK_SEAM_SIGMA_FLOOR_FRAC;
      if (!(sigmaMs > floor)) sigmaMs = floor;
      barMs = medianMs + k * sigmaMs;
    }

    /* IS THERE A CADENCE? The dominant interval, counted at ms resolution. Without
       one there is no phase, so a forward gap cannot be classified (see the header). */
    var tally = Object.create(null),
      best = null,
      bestN = 0;
    for (var c = 0; c < fwd.length; c++) {
      var key = String(Math.round(fwd[c]));
      tally[key] = (tally[key] || 0) + 1;
      if (tally[key] > bestN) {
        bestN = tally[key];
        best = +key;
      }
    }
    var dominantShare = fwd.length ? bestN / fwd.length : null;
    var regular = dominantShare != null && dominantShare >= CK_SEAM_REGULAR_SHARE;
    var cadenceMs = regular ? best : null;
    var forwardDecidable = !!(regular && barMs != null);
    /* TWO DIFFERENT TOLERANCES, AND CONFLATING THEM COSTS POWER. `barMs` (median + k·sigma) decides
       whether an interval is UNUSUAL for this file. The phase test asks a narrower question — does
       this gap land on a whole number of cadences — and the answer only needs the file's own spread,
       so its tolerance is ONE sigma, not k of them. Measured on the ring corpus (42 real nights,
       2026-10-29): cadence 1000 ms on every night, sigma 50 ms, and ZERO gaps of any size, so the
       narrower band costs nothing observed and cuts the blind share below from 0.60 to 0.10. */
    var phaseTolMs = sigmaMs != null ? Math.max(sigmaMs, 1) : null;
    /* THE BLIND SHARE (see the header). A forward step is caught only off-phase, and the band is
       ±phaseTol around every cadence multiple, so this is the fraction of arbitrary forward steps
       this file's own spread hides. `null` — never 0 — with no cadence to be in phase with. */
    var forwardBlindShare = cadenceMs && phaseTolMs != null ? Math.min(1, +((2 * phaseTolMs) / cadenceMs).toFixed(4)) : null;

    // ── in-bar runs, for the run-length test below ──
    var inBar = [];
    for (var b = 0; b < n; b++) inBar.push(barMs == null ? d[b] >= 0 : d[b] >= 0 && d[b] <= barMs);
    function runBack(p) {
      var r = 0;
      for (var q = p - 1; q >= 0 && inBar[q]; q--) r++;
      return r;
    }
    function runFwd(p) {
      var r = 0;
      for (var q = p + 1; q < n && inBar[q]; q++) r++;
      return r;
    }

    /* The level each sample fell FROM: the running maximum over everything before it. A plain
       previous-stamp comparison cannot serve, because the stamp before a re-ordered one is itself
       inside the disordered patch. */
    var runMaxBefore = [];
    for (var rm = 0, hi = t[0]; rm < n; rm++) {
      runMaxBefore.push(hi);
      if (t[rm + 1] > hi) hi = t[rm + 1];
    }
    var seams = [],
      dropouts = [],
      reorders = [],
      unsettled = [],
      duplicates = 0;
    for (var s = 0; s < n; s++) {
      var gap = d[s];
      if (gap < 0) {
        /* ⚠️ A BACKWARD STAMP IS NOT AUTOMATICALLY A CLOCK STEP, and this module said it was until
           the corpus answered. A host-stamped beat stream arrives in BLE packets, and the first
           stamp of a packet can land one or two beats behind the last stamp of the one before:
           measured 81 times in 252 329 real RR intervals, 1.2 s to 2.1 s backwards, EVERY ONE
           recovering within 6 samples. Refusing those windows would refuse 11 of 18 real files for
           a delivery artefact.
           So the test is RECOVERY, which is run length again and needs no magnitude: a re-ordered
           packet climbs back over the level it fell from almost at once, while a stepped clock stays
           behind for its whole magnitude. A step that the file ENDS before resolving is `unsettled`,
           never clean — nothing examined it (§∅). */
        var recN = null;
        for (var rq = s + 1; rq <= n && rq - s <= CK_SEAM_RECOVER_RUN; rq++) {
          if (t[rq] > runMaxBefore[s]) {
            recN = rq - s;
            break;
          }
        }
        if (recN != null) {
          reorders.push({ idx: idx[s], atMs: at[s], deltaMs: gap, recoverN: recN });
        } else if (s + CK_SEAM_RECOVER_RUN <= n) {
          // A WHOLE recovery window was examined and the level never came back: that is a step.
          seams.push({ idx: idx[s], atMs: at[s], deltaMs: gap, kind: 'back-step', residualMs: null, recoverN: null, runBefore: runBack(s), runAfter: runFwd(s) });
        } else {
          // The file ended first. Not clean, not a seam — unexamined, and it says so (§∅).
          unsettled.push({ idx: idx[s], atMs: at[s], deltaMs: gap, reason: 'recovery-truncated', examined: n - s });
        }
        continue;
      }
      if (gap === 0) {
        duplicates++;
        continue;
      }
      if (barMs == null || gap <= barMs) continue;
      if (!forwardDecidable) {
        /* No cadence ⇒ no phase ⇒ this is reported as reduced coverage with an
           UNKNOWN multiple, and `forwardDecidable:false` tells the reader a seam
           could be hiding in it. `multiple: null`, never 1 (§∅). */
        dropouts.push({ idx: idx[s], atMs: at[s], deltaMs: gap, multiple: null });
        continue;
      }
      /* THE DISCRIMINATOR. Through a dropout the clock keeps ticking, so the gap
         lands on a whole number of cadences. A step lands off-phase.
         `cad`/`jit` are the same two numbers under a non-null name: the branch above returns for
         every file without a cadence, so by here they are decided. */
      var cad = /** @type {number} */ (cadenceMs),
        jit = /** @type {number} */ (phaseTolMs);
      var mult = Math.round(gap / cad);
      var residual = Math.abs(gap - mult * cad);
      if (residual <= jit) {
        dropouts.push({ idx: idx[s], atMs: at[s], deltaMs: gap, multiple: mult });
        continue;
      }
      var rb = runBack(s),
        ra = runFwd(s);
      if (Math.min(rb, ra) < minRun) {
        unsettled.push({
          idx: idx[s],
          atMs: at[s],
          deltaMs: gap,
          residualMs: residual,
          runBefore: rb,
          runAfter: ra,
          reason: 'off-phase gap with no established cadence on both sides (need ' + minRun + ')'
        });
        continue;
      }
      seams.push({ idx: idx[s], atMs: at[s], deltaMs: gap, kind: 'forward-jump', residualMs: residual, runBefore: rb, runAfter: ra });
    }

    return {
      ok: true,
      label: label,
      n: n,
      stamps: t.length,
      skipped: skipped,
      medianMs: medianMs,
      madMs: madMs,
      sigmaMs: sigmaMs,
      barMs: barMs,
      phaseTolMs: phaseTolMs,
      cadenceMs: cadenceMs,
      dominantShare: dominantShare,
      regular: regular,
      forwardDecidable: forwardDecidable,
      forwardBlindShare: forwardBlindShare,
      minRun: minRun,
      seams: seams,
      dropouts: dropouts,
      reorders: reorders,
      unsettled: unsettled,
      duplicates: duplicates,
      firstMs: t[0],
      lastMs: t[t.length - 1]
    };
  }

  /**
   * Does ONE window still describe one continuous stretch of signal?
   * `continuous` is `true`, `false`, or `null` when no scan examined the span —
   * absence is never reported as a clean window (§∅).
   *
   * ⚠️ MEMBERSHIP IS THE TRANSITION, NOT THE STAMP. A seam sits BETWEEN two
   * consecutive samples, and after a backward step the later sample carries the
   * EARLIER wall-clock stamp — so a test asking whether the seam's own stamp
   * falls inside the window misses every back-step the window spans (measured
   * while writing this module: an RR series stepped back 90 s read `continuous`
   * over the very window that contained the step). The test is therefore an
   * overlap against the open interval between the two stamps, which also leaves
   * a window ending exactly at the last pre-seam sample continuous, as it is.
   * A caller that knows its ROW span should pass `opts.rows` instead: row
   * indices cannot be reordered by a clock step.
   *
   * @param {Object|null} scan a `seamScan` result
   * @param {number} startMs window start (exclusive of the stamp at startMs)
   * @param {number} endMs window end (inclusive)
   * @param {{rows?:{from:number,to:number}}} [opts] row-index membership instead
   */
  function windowVerdict(scan, startMs, endMs, opts) {
    var spanMs = isFinite(startMs) && isFinite(endMs) ? endMs - startMs : null;
    if (!scan || scan.ok !== true)
      return { decided: false, continuous: null, reason: 'no-seam-scan', seams: [], dropoutMs: null, spanMs: spanMs, coveredMs: null, coveragePct: null, forwardDecidable: null };
    if (spanMs == null)
      return {
        decided: false,
        continuous: null,
        reason: 'window has no finite bounds',
        seams: [],
        dropoutMs: null,
        spanMs: null,
        coveredMs: null,
        coveragePct: null,
        forwardDecidable: scan.forwardDecidable
      };
    var rows = opts && opts.rows && isFinite(opts.rows.from) && isFinite(opts.rows.to) ? opts.rows : null;
    function spans(e) {
      // ROW MODE: the transition sits between rows e.idx-1 and e.idx, so the window
      // must hold both. WALL-CLOCK MODE: overlap against the open interval (lo, hi).
      if (rows) return e.idx - 1 >= rows.from && e.idx <= rows.to;
      var a = e.atMs,
        b = e.atMs - e.deltaMs;
      var lo = Math.min(a, b),
        hi = Math.max(a, b);
      return startMs < hi && lo < endMs;
    }
    var inside = [];
    for (var i = 0; i < scan.seams.length; i++) if (spans(scan.seams[i])) inside.push(scan.seams[i]);
    var dropoutMs = 0;
    for (var j = 0; j < scan.dropouts.length; j++) {
      var g = scan.dropouts[j];
      /* ONE cadence of the gap is the sample that was due; the rest is uncovered
         span. With no cadence nothing is subtracted, so the figure is the whole
         gap and `forwardDecidable:false` travels beside it. */
      if (spans(g)) dropoutMs += g.deltaMs - (scan.cadenceMs != null ? scan.cadenceMs : 0);
    }
    if (dropoutMs < 0) dropoutMs = 0;
    if (spanMs >= 0 && dropoutMs > spanMs) dropoutMs = spanMs; // coverage never goes negative
    var coveredMs = spanMs - dropoutMs;
    return {
      decided: true,
      continuous: inside.length === 0,
      // A refusing window carries the NAMED reason the ruling asks for, never a borrowed one.
      reason: inside.length ? 'clock-seam' : null,
      seams: inside,
      dropoutMs: dropoutMs,
      spanMs: spanMs,
      coveredMs: coveredMs,
      // Rounded because this number is EXPORTED — a float tail here is bytes nobody reads.
      coveragePct: spanMs > 0 ? +((100 * coveredMs) / spanMs).toFixed(1) : null,
      forwardDecidable: scan.forwardDecidable
    };
  }

  /** The scan as it ships on a node export: counts and the bar that judged them. */
  function seamSummary(scan) {
    if (!scan || scan.ok !== true) return { scanned: false, reason: scan && scan.reason ? scan.reason : 'no-seam-scan', seams: null, dropouts: null, barMs: null, forwardDecidable: null };
    return {
      scanned: true,
      reason: null,
      n: scan.n,
      seams: scan.seams.length,
      dropouts: scan.dropouts.length,
      reorders: scan.reorders.length,
      unsettled: scan.unsettled.length,
      medianMs: scan.medianMs,
      madMs: scan.madMs,
      barMs: scan.barMs,
      cadenceMs: scan.cadenceMs,
      dominantShare: scan.dominantShare,
      forwardBlindShare: scan.forwardBlindShare,
      forwardDecidable: scan.forwardDecidable
    };
  }

  var API = {
    seamScan: seamScan,
    windowVerdict: windowVerdict,
    seamSummary: seamSummary,
    CK_SEAM_MIN_STAMPS: CK_SEAM_MIN_STAMPS,
    CK_SEAM_MIN_INTERVALS: CK_SEAM_MIN_INTERVALS,
    CK_SEAM_K: CK_SEAM_K,
    CK_SEAM_SIGMA_FLOOR_FRAC: CK_SEAM_SIGMA_FLOOR_FRAC,
    CK_SEAM_REGULAR_SHARE: CK_SEAM_REGULAR_SHARE,
    CK_SEAM_MIN_RUN: CK_SEAM_MIN_RUN,
    CK_SEAM_RECOVER_RUN: CK_SEAM_RECOVER_RUN
  };
  /* The IIFE argument is typed as a union by the gate, so the attach is cast once here — the same
     move dex-coload.js and provenance-banner.js make, and the reason clock.js's lone error is left
     alone (editing the spine churns every bundle's manifestHash). */
  /** @type {any} */ (root).DexSeam = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
