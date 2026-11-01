/* ════ Tepna · radio-clock sidecar reader (radio-clock.js) ─────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS. RADIO-CLOCK-SIDECAR-2026-09-07 §4, the consumer half. The
 * collector on the capture box writes one `<stamp>_<MAC>_RADIOCLOCK.csv` per
 * sensor, holding the Nordic controller's own connection-event anchor beside
 * the device stamp of the frame that arrived in that event. This module reads
 * that file and answers ONE question: does the controller clock discipline the
 * device axis well enough to carry `timingSource:'radio'`?
 *
 * THE BANDS ARE PRE-STATED, in that brief, before anyone measured them:
 * under 2 ms the anchors replace the host stamps and the node may publish
 * `'radio'`; 2 to 50 ms they are a lower-jitter host stamp and nothing else;
 * over 50 ms, or below three anchors, or on a refusal, the sidecar is ignored
 * with a named reason. The brief's own sentence governs this file: a `'radio'`
 * result that came from a spread the table does not admit is a bug, not a good
 * night.
 *
 * ════ WHAT THE FIRST REAL CORPUS SAYS (Magpie, 2026-11-01) ════════════════
 * Six sidecars, two nights, three sensors, 938 176 rows, 142 device streams.
 * The band statistic reads 0 radio, 4 jitter-aid, 138 rejected:
 *
 *   H10    ACC  n=97954 / 99106   12.43 / 15.20 ms   → the 2-50 ms band
 *   H10    ECG  n=30982 / 31435   16.39 / 18.82 ms   → the 2-50 ms band
 *   Verity PPG  n=25910 / 25578   82.47 / 84.23 ms   → over 50 ms, ignored
 *   Verity ACC  n=7981            94.15 ms           → over 50 ms, ignored
 *   Verity ACC  n=8086            refused, -1 000 004 ppm
 *   Verity PPI  n=5708 / 5624     refused, zero device span
 *   O2Ring      128 streams       refused, about -996 000 ppm
 *
 * So NO real stream reaches the under-2 ms band, and the best one is the H10
 * accelerometer at 12.43 ms. `timingSource:'radio'` is reachable in this code
 * and unreached on this corpus. The brief says a measured no is a result, and
 * its header now carries these numbers.
 *
 * THE STREAM COUNT IS NOT THE SENSOR COUNT. The O2Ring contributes 128 of the
 * 142 because its frames carry no device clock: the collector writes payload
 * bytes into `last_sensor_ns` AND into `meas`, so one ring file reads as 64
 * measurement types. A reader keyed on the sensor would have averaged them.
 *
 * ════ THE THREE REFUSALS ARE THE SPINE'S, NOT NEW ONES ════════════════════
 * Every degenerate case above is already named by `DexClock.hostAxis`, which
 * is why this module delegates instead of deciding:
 *
 *   PPI    — 5707 of 5708 rows share one `last_sensor_ns`, so the device axis
 *            has zero span. The residual about a running median over a
 *            CONSTANT key is 0.000 ms, which the under-2 ms band would admit.
 *            A stream with no clock would have certified the best tier.
 *   O2Ring — its frames carry no device clock, so the collector writes eight
 *            payload bytes into `last_sensor_ns`. 131 747 of 153 424 rows
 *            repeat a value and the rate reads about -996000 ppm, which the
 *            plausibility bound refuses.
 *   Verity — one corrupt stamp among 8086 ACC rows trips the same bound on one
 *            night, and on the sibling night the same defect leaves `ppm` in
 *            bound while `spreadMs` reads 885 511 619 376 ms.
 *
 * ════ A SINGLE WILD ANCHOR SURVIVES BOTH SPINE STATISTICS ═════════════════
 * `stackJitterMs` is a half-IQR and `maxStepMs` walks the SMOOTHED series, so
 * both are median-based and neither sees ONE corrupt anchor. Measured on a
 * planted sub-2 ms stream of 601 anchors with one row displaced: the spine
 * returns `ok:true`, `stackJitterMs` 1.04 ms and `maxStepMs` 0.88 ms while the
 * RAW divergence steps 885 000 000 001 ms between two adjacent anchors — and
 * the band read `'radio'`. The real file's `maxStepMs` reads 120.45 ms, which
 * is no larger than the night's own jitter and names nothing. That displacement is the real Verity ACC defect,
 * which on one night trips the rate bound and on its sibling leaves `ppm` at
 * 0.003 ppm with `spreadMs` at 885 511 619 376 ms.
 *
 * §∅'s owner ruling (2026-09-17) decides it: a DISCONTINUITY refuses, reduced
 * COVERAGE annotates. So `radioAxis` applies ONE admission criterion of its
 * own, and only where the spine has already accepted: two clocks cannot
 * diverge, between two ADJACENT connection events, by more than the whole
 * recording lasted. The bound is unitless and pre-stated at a ratio of 1 (§🧾
 * — never fitted to the data it judges); the real healthy streams sit five
 * orders of magnitude inside it, worst ratio 1.53e-5. Drift is NOT a
 * discontinuity: a 1000 ppm ramp keeps its band, because the criterion reads
 * the step between neighbours and not the night's total divergence.
 *
 * THE DENOMINATOR IS THE SMALLER OF THE TWO SPANS. A corrupt sample inflates
 * only its own column's span, by about as much as the step it creates, so a
 * ratio against that column reads about 1 and passes by luck: measured 1.00003
 * for the real device-column defect and 0.9999993 for a planted host-column
 * twin. The smaller span stays the recording's real duration, and the two then
 * read 17469 and 1.5e6. Both halves are planted in the suite.
 *
 * ════ A DRAWN DEVICE COLUMN IS REFUSED ON PROVENANCE ══════════════════════
 * `clock.js:623` publishes `deviceDrawn` ADDITIVELY and deliberately does not
 * let it gate `independent`, because a synthetic fixture's uniform
 * `devMs = i * 1000` cannot be told from a fabricated counter. A reader that
 * MINTS a timing source cannot inherit that choice: `'radio'` asserts the
 * device stamps and the controller anchors are two clocks, and a drawn device
 * column makes the assertion false. ECGDex's remedy — relabel to `'host'` —
 * does not transfer, because there are no samples to place here, only the
 * question of which clock placed them. So this reader refuses and names the
 * provenance. The flag is forwarded on every answer, and `null` where the
 * spine refused and never decided it.
 *
 * IT COSTS NOTHING ON THE CORPUS ABOVE, measured: of the 7 streams whose
 * anchors the spine accepts, 0 read `deviceDrawn:true`, and all 142 band
 * verdicts are byte-identical before and after the arm. It is the hole the
 * suite's `clock · drawn-axis · source-scan` ratchet exists to keep shut, and
 * the suite's own plants were re-cut to a realistic device axis to earn it —
 * the discipline `clock.js:638` asks of a node adopting the flag.
 *
 * ════ `null` IS NOT A SMALL NUMBER ════════════════════════════════════════
 * `hostAxis.stackJitterMs` is `null` when `independent` is false, because a
 * host column that is the device stamp rounded would report its own rounding
 * as jitter. In JS `null < 2` is true, so a band test written as a bare
 * comparison publishes the BEST tier on an axis with no second clock at all.
 * `classify` therefore reads the three states separately and the suite plants
 * a red control on each.
 *
 * LOAD ORDER. This module calls `DexClock.hostAxis`, so a bundle inlining it
 * must inline `clock.js` first (`dex-coload.js` `shared:`). An absent spine is
 * a named refusal here, never a silent disablement — CLAUDE.md §👥.3.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* The pre-stated bands, as named constants rather than literals at the call
     site, so a reader can check them against the brief's table by name. */
  var CK_RADIO_BEST_MS = 2; // under this: the anchors ARE the second clock
  var CK_RADIO_AID_MS = 50; // under this: a lower-jitter host stamp, nothing more
  var CK_RADIO_MIN_ANCHORS = 3; // the spine's own floor, restated so a caller can read it
  /* The admission criterion of this reader's own: `rawStepMs / hostSpanMs`. A
     ratio of 1 says the divergence between two neighbouring anchors reached the
     whole recording's length, which is a broken clock and not a rate. */
  var CK_RADIO_STEP_OVER_SPAN = 1;

  /* The sidecar's declared columns (§3 of the brief). Read BY NAME from the
     file's own header line — never by position. A sibling reader compared a
     literal against column 1 while the box wrote a different vocabulary there,
     and 335 of 335 rows placed nothing (#4210). */
  var RC_COLUMNS = ['Phone timestamp', 'device', 'meas', 'last_sensor_ns', 'conn_handle', 'event_counter', 'anchor_us', 'vs_rx_ns', 'acl_rx_ns'];

  function _num(cell) {
    /* §∅ — a blank cell is NOT MEASURED, which is `null`, never 0. Measured on
       the first corpus: `vs_rx_ns` is blank in 938 176 of 938 176 rows, so a
       `?? 0` here would have manufactured a controller-receive time for every
       row the collector declined to stamp. */
    if (cell == null) return null;
    var s = String(cell).trim();
    if (s === '') return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  /* parseRadioClock(text) → { ok, header, rows, streams, offsetFrom, reason }
     `streams` is keyed `<device>|<meas>`, because the three Polar streams
     interleave in ONE file: read per device alone and 5862 of 39 599 rows read
     non-monotonic, which is stream interleaving and not a clock step. */
  function parseRadioClock(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string' || text === '') {
      return { ok: false, reason: 'no sidecar text to read', rows: 0, streams: null, header: null, offsetFrom: null };
    }
    var lines = text.split(/\r?\n/);
    var head = null;
    var li = 0;
    for (; li < lines.length; li++) {
      var ln = lines[li];
      if (ln === '' || ln.charAt(0) === '#') continue;
      head = ln.split(';').map(function (h) {
        return h.trim();
      });
      li++;
      break;
    }
    if (!head) {
      return { ok: false, reason: 'the sidecar carries no header line', rows: 0, streams: null, header: null, offsetFrom: null };
    }
    var ix = Object.create(null);
    for (var h = 0; h < head.length; h++) ix[head[h]] = h;
    var absent = [];
    for (var c = 0; c < RC_COLUMNS.length; c++) if (!(RC_COLUMNS[c] in ix)) absent.push(RC_COLUMNS[c]);
    if (absent.length) {
      return {
        ok: false,
        reason: 'the sidecar header names no ' + absent.join(', ') + ' column',
        rows: 0,
        streams: null,
        header: head,
        offsetFrom: null
      };
    }

    var streams = Object.create(null);
    var rows = 0;
    var nVs = 0;
    var nAcl = 0;
    for (; li < lines.length; li++) {
      var line = lines[li];
      if (line === '') continue;
      var f = line.split(';');
      if (f.length < head.length) continue; // a torn tail is a short row, not a zero row
      rows++;
      var vs = _num(f[ix.vs_rx_ns]);
      var acl = _num(f[ix.acl_rx_ns]);
      if (vs != null) nVs++;
      if (acl != null) nAcl++;
      var anchorUs = _num(f[ix.anchor_us]);
      var devNs = _num(f[ix.last_sensor_ns]);
      if (anchorUs == null || devNs == null) continue; // ambiguous is absent, never guessed
      var key = String(f[ix.device]).trim() + '|' + String(f[ix.meas]).trim();
      var st = streams[key];
      if (!st) {
        st = streams[key] = {
          device: String(f[ix.device]).trim(),
          meas: String(f[ix.meas]).trim(),
          anchors: [],
          hostRx: []
        };
      }
      /* The axis is device-vs-controller: `devMs` from the frame's own stamp,
         `hostMs` from the controller's anchor. Both are free-running and the
         spine measures their divergence relative to its first anchor, so the
         absolute epochs do not need to agree. */
      st.anchors.push({ devMs: devNs / 1e6, hostMs: anchorUs / 1e3 });
      st.hostRx.push(vs != null ? vs : acl);
    }

    /* WHICH COLUMN CARRIES THE CONTROLLER-TO-HOST OFFSET. §4 of the brief
       defines `ctrl_host_offset` on `vs_rx_ns`, the kernel receive time of the
       vendor event. The shipped collector leaves that column blank, so the
       only available host receive time is the ACL packet's. Name which one was
       read; do not let a reader assume the brief's column. */
    var offsetFrom = nVs > 0 ? 'vs_rx_ns' : nAcl > 0 ? 'acl_rx_ns' : null;
    if (offsetFrom == null && rows > 0) {
      return {
        ok: false,
        reason: 'no host receive column carries a value: vs_rx_ns and acl_rx_ns are both blank on all ' + rows + ' rows',
        rows: rows,
        streams: null,
        header: head,
        offsetFrom: null
      };
    }
    return { ok: true, header: head, rows: rows, streams: streams, offsetFrom: offsetFrom, reason: null };
  }

  /* anchorStep(anchors) → { rawStepMs, hostSpanMs, devSpanMs, spanMs, ratio }.
     The largest divergence step between ADJACENT anchors, against the span it
     happened in. THE DENOMINATOR IS THE SMALLER OF THE TWO CLOCKS' SPANS, and
     that is the whole trick: a corrupt sample inflates the span of the column it
     sits in, and only that column, by about as much as the step it creates.
     Measured both ways — the real Verity defect sits in the DEVICE column and a
     device-span ratio reads 1.00003, a planted twin in the HOST column reads
     0.9999993, and each would have passed by luck. The smaller span stays the
     recording's real duration, so the ratio reads 17469 and 1.5e6 instead. */
  function anchorStep(anchors) {
    var none = { rawStepMs: null, hostSpanMs: null, devSpanMs: null, spanMs: null, ratio: null };
    if (!anchors || anchors.length < 2) return none;
    var hMin = Infinity;
    var hMax = -Infinity;
    var dMin = Infinity;
    var dMax = -Infinity;
    var step = 0;
    var prev = null;
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (!a || !isFinite(a.devMs) || !isFinite(a.hostMs)) continue; // §∅ — an unreadable anchor is skipped, never zeroed
      if (a.hostMs < hMin) hMin = a.hostMs;
      if (a.hostMs > hMax) hMax = a.hostMs;
      if (a.devMs < dMin) dMin = a.devMs;
      if (a.devMs > dMax) dMax = a.devMs;
      var r = a.hostMs - a.devMs;
      if (prev != null) {
        var d = Math.abs(r - prev);
        if (d > step) step = d;
      }
      prev = r;
    }
    if (prev == null) return none;
    var hostSpan = hMax - hMin;
    var devSpan = dMax - dMin;
    var span = Math.min(hostSpan, devSpan);
    return {
      rawStepMs: step,
      hostSpanMs: hostSpan,
      devSpanMs: devSpan,
      spanMs: span,
      ratio: span > 0 ? step / span : step > 0 ? Infinity : 0
    };
  }

  /* classify(stackJitterMs, independent) → the band name. Three states, read
     separately: a `null` jitter is NOT a small jitter (see the header). */
  function classify(stackJitterMs, independent) {
    if (independent !== true) return 'rejected';
    if (stackJitterMs == null || !isFinite(stackJitterMs)) return 'rejected';
    var j = Math.abs(stackJitterMs);
    if (j < CK_RADIO_BEST_MS) return 'radio';
    if (j < CK_RADIO_AID_MS) return 'jitter-aid';
    return 'rejected';
  }

  /* radioAxis(anchors, opts) → the band verdict for ONE device stream.
     Delegates the whole axis to `DexClock.hostAxis`: the width-21 running
     median, the three-anchor floor, the plausibility bound and the HALF-IQR
     jitter estimator all live there, and a second copy would drift from them.
     The estimator choice is load-bearing — MAD read 1.2 ms against a 5.5 ms
     plant, because delivery jitter is bimodal (clock.js, measured 2026-08-23). */
  function radioAxis(anchors, opts) {
    opts = opts || {};
    // An EXPLICIT opts.hostAxis is honoured even when it is not callable, so a caller that
    // injects the spine can see this refusal; absent the key, the loaded DexClock is the spine.
    var spine = Object.prototype.hasOwnProperty.call(opts, 'hostAxis') ? opts.hostAxis : (root.DexClock && root.DexClock.hostAxis) || null;
    if (typeof spine !== 'function') {
      /* §👥.3 — an absent spine refuses by name. Guarding it into silence is
         how an unguarded alias becomes a disabled feature nobody can see. */
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: anchors && anchors.length ? anchors.length : 0,
        reason: 'clock.js is not loaded, so DexClock.hostAxis cannot build the radio axis',
        deviceDrawn: null,
        axis: null
      };
    }
    var n = anchors && anchors.length ? anchors.length : 0;
    if (n < CK_RADIO_MIN_ANCHORS) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: n,
        reason: 'need ≥' + CK_RADIO_MIN_ANCHORS + ' radio anchors, got ' + n,
        deviceDrawn: null,
        axis: null
      };
    }
    var ax = spine(anchors, opts.axis || {});
    if (!ax || ax.ok !== true) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: ax && ax.n != null ? ax.n : n,
        reason: 'the host axis refused the radio anchors: ' + ((ax && ax.reason) || 'the spine named no reason'),
        /* A refused axis publishes no `deviceDrawn`, and an absent flag is `null`
           here rather than `false` — the provenance was never decided. Measured
           on the real corpus: 135 of 142 streams take this path. */
        deviceDrawn: ax && ax.deviceDrawn != null ? ax.deviceDrawn : null,
        axis: ax || null
      };
    }
    /* §7 — A DRAWN DEVICE COLUMN IS NOT A SECOND CLOCK, AND THE SPINE SAYS SO
       WITHOUT GATING ON IT. `clock.js:623` publishes `deviceDrawn` additively,
       because a synthetic fixture's uniform `devMs = i * 1000` is by
       construction indistinguishable from a fabricated counter, so `independent`
       stays true for a drawn axis. A reader that MINTS a timing source cannot
       inherit that: `'radio'` claims the device stamps and the controller
       anchors are two clocks, and a drawn device column makes that claim false.
       ECGDex's remedy (relabel to `'host'`) does not transfer — there are no
       samples to place here, only the question of which clock placed them, so
       this reader refuses and names the provenance.
       Measured 2026-11-01 over the 6 deployed sidecars: of the 7 streams whose
       anchors the spine accepts, 0 read `deviceDrawn:true`, so this arm costs no
       band verdict on the corpus it was written against. It is the hole the
       suite's `clock · drawn-axis · source-scan` ratchet exists to keep shut. */
    /* FAIL CLOSED ON AN UNRESOLVED FLAG. Board #1687 measured the other shape of
       this read: a `deviceDrawn !== true` test over artifacts that carry no such
       key read TRUE of all 173 and defaulted to ADMIT. The spine writes the flag
       on every axis it accepts, so the arm below fires only for a shim or an
       older `clock.js` in a bundle that predates it (§☎·✅ — 6 of 8 app bundles
       carry the spine at all). An undecided provenance is not a clean one. */
    if (ax.deviceDrawn !== true && ax.deviceDrawn !== false) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: ax.n,
        reason: "the host axis published no deviceDrawn flag, so the device column's provenance is undecided and 'radio' cannot be minted",
        deviceDrawn: null,
        axis: ax
      };
    }
    if (ax.deviceDrawn === true) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: ax.n,
        reason: 'the device column is DRAWN (' + (ax.drawnReason || 'its inter-anchor deltas concentrate on one value') + '), so the anchors and the device stamps are not two clocks',
        deviceDrawn: true,
        axis: ax
      };
    }
    /* The spine ACCEPTED these anchors, and both of its statistics are blind to
       a single wild one (see the header). A discontinuity refuses here. */
    var st = anchorStep(anchors);
    if (st.ratio == null || st.ratio >= CK_RADIO_STEP_OVER_SPAN) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        n: ax.n,
        reason:
          st.ratio == null
            ? 'the anchors carry no readable divergence step, so continuity cannot be decided'
            : 'the anchors carry a discontinuity: the divergence steps ' +
              st.rawStepMs.toFixed(0) +
              ' ms between two adjacent anchors, which is ' +
              st.ratio.toFixed(2) +
              ' times the ' +
              st.spanMs.toFixed(0) +
              ' ms the stream spans',
        deviceDrawn: ax.deviceDrawn == null ? null : ax.deviceDrawn,
        axis: ax,
        step: st
      };
    }
    var jitter = ax.stackJitterMs;
    var band = classify(jitter, ax.independent);
    var reason = null;
    if (band === 'radio') {
      reason = null;
    } else if (ax.independent !== true) {
      reason = 'the controller anchors carried nothing the device stamps did not already have (independent:false), so they are not a second clock';
    } else if (jitter == null) {
      reason = 'the host axis published no jitter estimate, so the band cannot be decided';
    } else if (band === 'jitter-aid') {
      reason = 'radio jitter ' + Math.abs(jitter).toFixed(2) + ' ms sits in the ' + CK_RADIO_BEST_MS + '-' + CK_RADIO_AID_MS + ' ms band: a lower-jitter host stamp, not a second clock';
    } else {
      reason = 'radio jitter ' + Math.abs(jitter).toFixed(2) + ' ms is over the ' + CK_RADIO_AID_MS + ' ms bound, so the sidecar is ignored';
    }
    return {
      ok: band !== 'rejected',
      band: band,
      /* The ONLY place `'radio'` is minted. The brief: a `'radio'` result from
         a spread the table does not admit is a bug, not a good night. */
      timingSource: band === 'radio' ? 'radio' : null,
      spreadMs: jitter,
      n: ax.n,
      reason: reason,
      deviceDrawn: ax.deviceDrawn == null ? null : ax.deviceDrawn,
      axis: ax,
      step: st
    };
  }

  var API = {
    CK_RADIO_BEST_MS: CK_RADIO_BEST_MS,
    CK_RADIO_AID_MS: CK_RADIO_AID_MS,
    CK_RADIO_MIN_ANCHORS: CK_RADIO_MIN_ANCHORS,
    CK_RADIO_STEP_OVER_SPAN: CK_RADIO_STEP_OVER_SPAN,
    RC_COLUMNS: RC_COLUMNS,
    parseRadioClock: parseRadioClock,
    radioAxis: radioAxis,
    anchorStep: anchorStep,
    classify: classify
  };
  /* The IIFE argument is typed as a union by the gate, so the attach is cast
     once here — the same move dex-coload.js, provenance-banner.js and
     clock-seam.js make. */
  /** @type {any} */ (root).DexRadio = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
