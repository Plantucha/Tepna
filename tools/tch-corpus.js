/*
 * tools/tch-corpus.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * CORPUS HOMOGENEITY — is a multi-night median a corpus figure, or a statement about which code
 * happened to produce which night?
 *
 * WHY THIS FILE EXISTS. `WEARABLE-HOST-AXIS-FOLLOWUPS` §F3 reported PpgDex's three-cornered-hat σ
 * moving 2.71 → 3.44 bpm after the host-axis change, and correctly refused to attribute it: the two
 * runs covered different night sets (37 vs 28 estimated). It left the resolution as "a per-night
 * matched comparison", and recorded that the old per-night σ values were never kept.
 *
 * Measured 2026-08-04, the matched comparison cannot be run on the corpus as it stands, and the reason
 * is worse than an unmatched night set. **The corpus is CODE-MIXED.** Of 40 trio nights, 25 carry
 * `quality.timingSource` — the field the host-axis work added — and 15 do not; the 15 were exported
 * before that change and never regenerated. The split is perfectly confounded with DATE (every night
 * 2026-06-10…07-13 is post, every night 07-16…07-30 is pre), so a comparison between date ranges is
 * also a comparison between code versions, and neither can be held fixed.
 *
 * The size of the confound, same run, same estimator:
 *
 *     cohort            n    σ ECGDex   σ PpgDex   σ OxyDex
 *     ALL (mixed)      35      0.65       2.71       1.12
 *     POST host-axis   23      0.49       2.54       1.11
 *     PRE  host-axis   12      1.03       4.02       1.35
 *
 * The cohorts differ by 1.5 bpm on PpgDex, so ANY median over this corpus moves with the mix — and
 * both of §F3's numbers (2.71 and 3.44) sit inside that range. §F3's "not attributable" was right, and
 * this is the mechanism.
 *
 * THE RULE ENCODED HERE, and it is the same one `drift-report.js` encodes for a ppm: a multi-night
 * median is a MEASUREMENT only when the nights were produced by ONE code version. Otherwise it is
 * still printed — suppressing it would cost the diagnostic — but it is marked, and the per-cohort
 * medians are shown beside it so a reader sees what the mix is worth.
 *
 * Pure: no fs, no console, no DOM, no Date. Input in, verdict out. Classic module so BOTH test lanes
 * reach it (the .mjs harness executes its night loop at import and is untestable from either).
 */
(function (root) {
  'use strict';

  /* A night's producing-code COHORT, from a marker the export itself carries. Provenance is computed,
     not remembered — the same principle as `quality.timingSource` (which is the marker used here) and
     as `computeHash` replacing the hand-written "EXPORT-INERT" claim.

     `marker` is tri-state, and the distinction is load-bearing (the 2026-09-01 refold's false MIXED
     banner counted 46 no-wearable nights as pre-host-axis):
       undefined — NO wearable export was seen. Absence of the device is not old-code evidence; the
                   night carries NO cohort. Returns null.
       null      — a wearable export was seen and the field was absent from it: the older cohort's
                   signature. 'pre-host-axis'.
       any value — the field was present. 'post-host-axis'. */
  function cohortOf(marker) {
    if (marker === undefined) return null;
    return marker === null ? 'pre-host-axis' : 'post-host-axis';
  }

  /**
   * Split nights into producing-code cohorts.
   *
   * @param nights [{ night:'YYYY-MM-DD', marker, solved? }]
   *        marker = the tri-state cohortOf input · solved = whether the night contributed a σ solution
   *        (optional; when any night carries it, the mixed/confounded verdict fires only when two
   *        cohorts BOTH contribute solutions — an unsolved cohort cannot confound a median it never
   *        enters).
   * @returns { total, cohorts:{name→[night]}, uncohorted, solvedUncohorted, solvedByCohort,
   *            hasSolvedInfo, homogeneous, dateConfounded, spans:{name→{first,last}} }
   *          `null` when there is nothing to judge (empty input). A corpus whose every night is
   *          uncohorted is NOT null — it must reach corpusVerdict, which refuses it.
   */
  function cohortSplit(nights) {
    if (!nights || !nights.length) return null;
    var cohorts = {};
    var solvedByCohort = {};
    var markersSeen = 0;
    var uncohorted = 0;
    var solvedUncohorted = 0;
    var hasSolvedInfo = false;
    var any = false;
    var i, c, n;
    for (i = 0; i < nights.length; i++) {
      n = nights[i];
      if (!n || !n.night) continue;
      any = true;
      if (n.solved !== undefined) hasSolvedInfo = true;
      c = cohortOf(n.marker);
      if (c === null) {
        uncohorted++;
        if (n.solved === true) solvedUncohorted++;
        continue;
      }
      if (c === 'post-host-axis') markersSeen++;
      if (!cohorts[c]) cohorts[c] = [];
      cohorts[c].push(n.night);
      if (n.solved === true) solvedByCohort[c] = (solvedByCohort[c] || 0) + 1;
    }
    if (!any) return null;
    var names = Object.keys(cohorts).sort();
    var spans = {};
    for (i = 0; i < names.length; i++) {
      var list = cohorts[names[i]].slice().sort();
      cohorts[names[i]] = list;
      spans[names[i]] = { first: list[0], last: list[list.length - 1] };
    }

    /* DATE CONFOUNDING is a SEPARATE and worse fact than mixing. If the cohorts merely interleave, a
       matched comparison is still possible — pair the nights. If each cohort occupies its own
       contiguous date range, then code version and date are the same variable and NO subsetting of
       this corpus can separate them; the only remedy is to regenerate. Detected by asking whether the
       cohorts' date spans overlap at all. */
    var confounded = false;
    if (names.length > 1) {
      confounded = true;
      for (i = 0; i < names.length && confounded; i++)
        for (var j = i + 1; j < names.length; j++) {
          var a = spans[names[i]],
            b = spans[names[j]];
          if (a.first <= b.last && b.first <= a.last) {
            confounded = false;
            break;
          }
        }
    }

    return {
      total: nights.length,
      cohorts: cohorts,
      spans: spans,
      markersSeen: markersSeen,
      uncohorted: uncohorted,
      solvedUncohorted: solvedUncohorted,
      solvedByCohort: solvedByCohort,
      hasSolvedInfo: hasSolvedInfo,
      homogeneous: names.length === 1,
      dateConfounded: confounded
    };
  }

  /**
   * Whether a corpus-wide median may be quoted, in the same four-state shape `driftVerdict` uses.
   * `homogeneous` is the only state that licenses the number.
   */
  function corpusVerdict(split) {
    if (!split) return { state: 'empty', quotable: false, why: 'no nights' };
    var names = Object.keys(split.cohorts).sort();
    /* ── FAIL CLOSED ON EVERY SHAPE A BROKEN READER CAN PRODUCE ─────────────────────────────────
       A reader that silently stops populating markers must never yield a green verdict — that is a
       verdict produced by reading nothing, and it happened on the first wiring of this module:
       `runNight` rebuilt its row object and dropped the field, and a corpus measured at 25/15
       reported "all 40 from one producing code version". Three refusals, one per shape:
       1. A SOLVED night with no cohort is a contradiction: a night cannot solve without a wearable
          export, and a wearable export always yields a cohort (null ⇒ pre, value ⇒ post). The only
          producer of that shape is a reader that dropped the field — refuse.
       2. No cohort on ANY night: "no wearable anywhere" is indistinguishable from "the reader read
          none", and a corpus with no wearable has no trio σ to quote anyway — refuse.
       3. No POST marker on any cohorted night: an all-legacy corpus is genuinely indistinguishable
          from a reader that reads the export but never the field — refuse, as before. */
    if (split.solvedUncohorted > 0)
      return {
        state: 'unreadable',
        quotable: false,
        why: split.solvedUncohorted + ' solved night(s) carry no cohort — a solved night has a wearable export, so its marker was dropped by the reader, not absent from the data'
      };
    if (!names.length) return { state: 'unreadable', quotable: false, why: 'no night carried any cohort evidence — indistinguishable from a reader that read none' };
    if (split.markersSeen === 0) return { state: 'unreadable', quotable: false, why: 'no night carried a producing-code marker — indistinguishable from a reader that read none' };
    var uncNote = split.uncohorted > 0 ? ' (' + split.uncohorted + ' night(s) without a wearable carry no cohort and are not old-code evidence)' : '';
    if (split.homogeneous) return { state: 'homogeneous', quotable: true, why: 'all ' + (split.total - split.uncohorted) + ' cohorted night(s) from one producing code version' + uncNote };
    /* ── THE BANNER NEEDS TWO COHORTS IN THE MEDIAN, NOT TWO COHORTS IN THE DIRECTORY ───────────
       A mixed corpus is refused because the median moves with the mix — but a cohort whose nights
       never produced a solution contributes nothing to any median, so it cannot confound one. When
       the caller says which nights solved, the mixed/confounded verdict fires only when two cohorts
       BOTH contribute solutions; otherwise the solved set is single-generation and quotable, with
       the non-contributing cohort named rather than hidden. Callers that pass no solved info keep
       the stricter directory-level verdict. */
    if (split.hasSolvedInfo) {
      var contributing = [];
      for (var k = 0; k < names.length; k++) if ((split.solvedByCohort[names[k]] || 0) > 0) contributing.push(names[k]);
      if (contributing.length <= 1) {
        var silent = [];
        for (var m = 0; m < names.length; m++) if (contributing.indexOf(names[m]) < 0) silent.push(names[m] + ' ' + split.cohorts[names[m]].length + ' night(s), none solved');
        var nSolved = contributing.length ? split.solvedByCohort[contributing[0]] : 0;
        if (!nSolved) return { state: 'unreadable', quotable: false, why: 'no cohorted night produced a solution — nothing to quote (' + silent.join(', ') + ')' };
        return {
          state: 'homogeneous',
          quotable: true,
          why: 'all ' + nSolved + ' solved night(s) from one producing code version (' + contributing[0] + '); non-contributing: ' + silent.join(', ') + uncNote
        };
      }
    }
    var parts = [];
    for (var i = 0; i < names.length; i++) parts.push(names[i] + ' ' + split.cohorts[names[i]].length);
    return {
      state: split.dateConfounded ? 'confounded' : 'mixed',
      quotable: false,
      why:
        'corpus mixes producing-code versions (' +
        parts.join(', ') +
        ')' +
        (split.dateConfounded
          ? ' AND each cohort occupies its own date range, so code version and date are the same variable — regenerate, do not subset'
          : ' — pair the nights for a matched comparison')
    };
  }

  /* The line itself. A mixed corpus still prints its median — hiding it would cost the diagnostic —
     but the verdict CLOSES the line, so a reader who stops early has still met it. */
  function corpusLine(split) {
    var v = corpusVerdict(split);
    if (v.state === 'empty') return null;
    if (v.state === 'homogeneous') return '    ⌘ corpus: ' + v.why + ' — medians are corpus figures';
    if (v.state === 'unreadable') return '    ⌘ corpus: ⚠ UNREADABLE — ' + v.why + '\n      A median over this corpus is not a measurement until the marker is readable.';
    var names = Object.keys(split.cohorts).sort(),
      out = [],
      i;
    for (i = 0; i < names.length; i++) out.push('      · ' + names[i] + ': ' + split.cohorts[names[i]].length + ' night(s), ' + split.spans[names[i]].first + ' … ' + split.spans[names[i]].last);
    return '    ⌘ corpus: ⚠ ' + v.state.toUpperCase() + ' — ' + v.why + '\n' + out.join('\n') + '\n      A median over this corpus is a statement about the MIX, not about the sensors.';
  }

  root.TchCorpus = {
    cohortOf: cohortOf,
    cohortSplit: cohortSplit,
    corpusVerdict: corpusVerdict,
    corpusLine: corpusLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TchCorpus;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
