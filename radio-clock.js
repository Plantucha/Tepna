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
 * ════ A HOLE IN THE ANCHOR SEQUENCE IS PUBLISHED, NOT REFUSED ════════════
 * The link drops, the collector keeps appending, and the file then reads as one
 * continuous stretch. `anchorGaps` reads the sequence's own holes on the
 * controller column, and every answer `radioAxis` gives carries them.
 *
 * MEASURED 2026-11-02 (Heron) over the 11 sidecars the box now holds: 1 251 472
 * rows, 222 device streams, 3 sensors, 0 rows dropped. 197 of the 222 streams
 * hold a hole over 60 s, and the holes total 2 222 016 s. The widest single hole
 * runs 25 653 s on a ring stream. The Verity ACC stream of 7981 anchors
 * reproduces the ledger row that asked for the statistic: 2 holes, the widest
 * 13 644 s, 22 351 s in all, over a 14.1 h span.
 *
 * TWO STREAMS READ COVERAGE 0.000, each 2 anchors about 2 h apart, so the
 * sequence spans a recording and measures nothing inside it. Five more carry
 * ONE anchor, where a span, a hole and a share are all absent and `null` — the
 * two counts stay real, because the anchors were read (§∅).
 *
 * AND IT COSTS NO BAND VERDICT, measured rather than argued: all four banded
 * streams (both H10 nights, jitter-aid) read gapCount 0 and coverage 1.000 with
 * a widest hole of 1 to 5 s, so every hole on this corpus sits in a stream the
 * spine or this reader had already refused. All 222 verdicts are byte-identical
 * before and after the statistic.
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

  /* A HOLE IN THE ANCHOR SEQUENCE IS NOT A SMALL INTERVAL. The collector emits
     one anchor per connection event, and its own header puts that cadence at
     about 0.2 s (`capture-host/radioclock.py:9`), so a minute with none is
     about three hundred events the link did not deliver. The bound is
     pre-stated at 60 s and fitted to nothing (§🧾): the ledger row that asked
     for this statistic counted its holes over the same 60 s, so the counts this
     reader publishes are comparable with the row's own. */
  var CK_RADIO_GAP_MS = 60000;

  /* THE DELAY'S FLOOR IS SHARP WHERE ITS SPREAD IS WIDE, so the window that
     reads the floor is pre-stated here and fitted to nothing (§🧾). A frame
     waits in the device buffer and then for the next connection event, so the
     device-to-anchor delay has a HARD MINIMUM and a long upper tail: the tail
     is the link's delivery noise and the floor is the clock. `stackJitterMs` is
     a half-IQR about a running median, so it measures the tail. The ledger row
     `2026-11-02-the-radio-band-reads-the-delay-spread-and-discards-its-floor`
     measured both edges on six box sidecars (Wren, 2026-11-02): H10 ECG floor
     MAD 2.2 ms against a bulk IQR of 32 ms, Verity PPG 9.3 ms against 180 ms.
     The window is the row's own 5 min, so the numbers this reader publishes are
     comparable with the row's. */
  var CK_RADIO_FLOOR_WIN_MS = 300000;

  /* The sidecar's declared columns (§3 of the brief). Read BY NAME from the
     file's own header line — never by position. A sibling reader compared a
     literal against column 1 while the box wrote a different vocabulary there,
     and 335 of 335 rows placed nothing (#4210). */
  var RC_COLUMNS = ['Phone timestamp', 'device', 'meas', 'last_sensor_ns', 'conn_handle', 'event_counter', 'anchor_us', 'vs_rx_ns', 'acl_rx_ns'];

  /* THE SEAM MARKER, READ WHEN THE FILE CARRIES IT AND NEVER REQUIRED. #4272 appended
     `device_clock` and `anchor_epoch` to the collector's header on 2026-11-02, and the archive
     predates both: measured 2026-11-04 over 14 archived sidecars, 10 carry the nine-column form,
     3 carry the eleven-column form and 1 holds no header at all. Requiring the column would refuse
     every older night by header SHAPE, which answers a different question — §∅ carries the absence
     forward, it does not reject the file.
     WHY NOT `conn_handle`, WHICH EVERY NIGHT ALREADY CARRIES. It does not mark the seam. Measured
     over the same 14 files: of 26 099 anchor intervals over CK_RADIO_GAP_MS, 484 sit on a row where
     the handle changed and 25 615 do not. The two ring files are the decisive pair — each holds one
     multi-hour gap and ZERO handle changes, so the gaps that most need a seam are exactly the ones
     a handle read would miss. */
  var RC_SEAM_COLUMN = 'anchor_epoch';

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
      /* §∅ — the header may name no seam column (an older night) and the cell may sit blank, and
         both are `null`. NEVER 0: `anchor_epoch` counts this device's link establishments from 1,
         so a 0 here would claim a segment no link ever opened. */
      var seg = RC_SEAM_COLUMN in ix ? _num(f[ix[RC_SEAM_COLUMN]]) : null;
      st.anchors.push({ devMs: devNs / 1e6, hostMs: anchorUs / 1e3, seg: seg });
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

  /* anchorGaps(anchors) → { n, dropped, spanMs, maxGapMs, maxGapShare,
     gapCount, gapTotalMs, coveredShare, backwards, gapOverMs }.
     THE HOLES IN THE ANCHOR SEQUENCE, read on the HOST column. The link drops,
     the collector keeps appending, and the file then reads as one continuous
     stretch: `hostAxis` runs linear between neighbouring anchors, so a
     correction asked for inside a hole comes from two anchors hours apart and
     from no measurement of its own. Neither criterion already here can see it —
     `anchorStep` reads the DIVERGENCE between neighbours, and two clocks that
     drift together across a hole diverge by nothing across it.
     THIS ANNOTATES AND IT REFUSES NOTHING, which applies §∅'s owner ruling
     (2026-09-17): a discontinuity refuses, reduced coverage annotates. The band
     states something about the anchors that EXIST — whether the two clocks are
     independent, and how tightly the controller delivers — and each one stays a
     real paired reading whatever happened between them. A hole invalidates
     something narrower, which belongs to a different caller: a correction at an
     instant inside it. So this reader publishes the hole, and the consumer that
     asks `correctionAt` for such an instant owes the refusal.
     A BACKWARDS INTERVAL IS A NEW CLOCK AND NOT A NEGATIVE HOLE
     (`capture-host/radioclock.py:110`), so it carries its own count and stays
     out of the sum rather than shortening it. */
  function anchorGaps(anchors) {
    var list = anchors || [];
    var n = 0;
    var dropped = 0;
    var hMin = Infinity;
    var hMax = -Infinity;
    var maxGap = 0;
    var gapCount = 0;
    var gapTotal = 0;
    var backwards = 0;
    var prev = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !isFinite(a.devMs) || !isFinite(a.hostMs)) {
        dropped++; // §∅ — an unreadable anchor is counted, never read as an interval of zero
        continue;
      }
      n++;
      if (a.hostMs < hMin) hMin = a.hostMs;
      if (a.hostMs > hMax) hMax = a.hostMs;
      if (prev != null) {
        var d = a.hostMs - prev;
        if (d < 0) backwards++;
        else {
          if (d > maxGap) maxGap = d;
          if (d > CK_RADIO_GAP_MS) {
            gapCount++;
            gapTotal += d;
          }
        }
      }
      prev = a.hostMs;
    }
    /* One readable anchor spans nothing and bounds no interval, so every
       statistic over the sequence is absent rather than zero. The two counts
       above are real either way and stay. */
    if (n < 2) return { n: n, dropped: dropped, spanMs: null, maxGapMs: null, maxGapShare: null, gapCount: null, gapTotalMs: null, coveredShare: null, backwards: null, gapOverMs: CK_RADIO_GAP_MS };
    var span = hMax - hMin;
    return {
      n: n,
      dropped: dropped,
      spanMs: span,
      /* The widest FORWARD interval, whether or not it reached the bound: the
         bound counts holes, and this says how wide the widest one grew. */
      maxGapMs: maxGap,
      /* A zero-span sequence divides by nothing, and a sequence that crossed a
         clock change has no single duration to divide BY: both shares are then
         absent rather than 0 or 1. The second case matters more than it looks —
         a backwards jump leaves `hMax - hMin` a readable number that is not a
         span, and a coverage share over it reads 1.000 on a sequence whose
         anchors cover a second of the hours it appears to hold. */
      maxGapShare: span > 0 && backwards === 0 ? maxGap / span : null,
      gapCount: gapCount,
      gapTotalMs: gapTotal,
      coveredShare: span > 0 && backwards === 0 ? (span - gapTotal) / span : null,
      backwards: backwards,
      gapOverMs: CK_RADIO_GAP_MS
    };
  }

  /* anchorSeams(anchors) → { marked, n, dropped, segments, lastSegment, anchorsBeforeLastSeam }.
     §🔒.7 — ONE DEVICE CLOCK PER AXIS, AND A RESYNC IS A CHANGE OF CLOCK. `anchor_us` is a
     controller counter whose epoch does not survive a controller reset, so a link establishment
     starts a NEW anchor series. An axis built across one takes its correction from two anchors that
     never shared a clock.
     `marked` is the question a caller must ask FIRST, before `segments`: an unmarked sequence reads
     `segments: 1` the same way a single-segment marked one does, and the two mean opposite things.
     One says the collector stamped one link; the other says nothing was stamped at all. */
  function anchorSeams(anchors) {
    var list = anchors || [];
    var n = 0;
    var dropped = 0;
    var marked = false;
    var segments = 0;
    var prevSeg = null;
    var lastChangeAt = 0;
    var readable = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !isFinite(a.devMs) || !isFinite(a.hostMs)) {
        dropped++; // §∅ — an unreadable anchor is counted, never read as a segment of its own
        continue;
      }
      var seg = a.seg == null || !isFinite(a.seg) ? null : a.seg;
      if (seg != null) marked = true;
      if (n === 0 || seg !== prevSeg) {
        segments++;
        lastChangeAt = n;
      }
      prevSeg = seg;
      readable.push(a);
      n++;
    }
    /* An unmarked sequence carries ONE run by construction, because every `seg` reads `null` and
       equals its neighbour. The count is honest and `marked:false` is what says not to trust it. */
    return {
      marked: marked,
      n: n,
      dropped: dropped,
      segments: n > 0 ? segments : 0,
      /* The anchors at or after the LAST change, which is the only series on the current clock.
         CLAUDE.md §🔒.7: build the axis from anchors at or after the last resync. */
      lastSegment: readable.slice(lastChangeAt),
      anchorsBeforeLastSeam: lastChangeAt
    };
  }

  /* anchorFloor(anchors, correctionAt, opts) → { winMs, n, dropped, windows,
     usedWindows, floorOffsetMs, floorMadMs, bulkIqrMs, floorOverBulk, reason }.
     THE SHARP EDGE OF THE DELAY, READ ABOUT THE SPINE'S OWN CURVE. The residual
     this bins is `r_i - correctionAt(devMs_i)`, which is the series whose
     HALF-IQR the spine publishes as `stackJitterMs` — so the two statistics
     describe the same residual and differ only in which edge of it they read.
     The constant the residual carries (the spine's `r0`) cancels: a MAD of
     window minima and an IQR are both shift-invariant.
     WHY THE SPINE'S CURVE AND NOT A LINE OF THIS READER'S OWN. The row's own
     method ran Theil-Sen through the window minima. That answers a different
     question — how straight the floor is — where this one answers how tightly
     the floor holds about the correction a consumer actually gets, which is the
     running median and nothing else (`clock.js:817`). A second drift model here
     would drift from the one the axis publishes, which is the reason this whole
     module delegates.
     IT ANNOTATES AND IT DECIDES NOTHING, and that is the owner's §∅ ruling
     applied, not caution: the floor would be the better band criterion only if
     a floor-mapped axis holds BETWEEN NIGHTS, and the row names that test (PAT
     stability over the per-connection offset, −867…+1321 ms between nights)
     as the one nobody has run. The number ships; the gate does not move on it.
     ⚠ A SHARP FLOOR IS NOT A CORRECT ONE. Any distribution bounded below has a
     sharp floor, a uniform ±J wobble included, and there the floor sits J below
     the clock rather than on it. The suite plants that control beside the
     one-sided one, because a reader who takes a small `floorMadMs` for accuracy
     would move the band onto a biased edge. */
  function anchorFloor(anchors, correctionAt, opts) {
    opts = opts || {};
    var winMs = opts.winMs != null ? Number(opts.winMs) : CK_RADIO_FLOOR_WIN_MS;
    var list = anchors || [];
    /* An EXPLICIT `opts.median` is honoured even when it is not callable, the
       same idiom `radioAxis` uses for the spine: a caller that injects the
       median can see this refusal, and absent the key the loaded DexClock is
       the one source. */
    var med = Object.prototype.hasOwnProperty.call(opts, 'median') ? opts.median : root.DexClock && root.DexClock._ckMedian;
    function absent(reason, n, dropped, extra) {
      /* §∅ — every count this function READ stays real, and everything derived
         from a population it could not form is `null` with a named reason,
         never a 0 that reads as a perfectly sharp floor. The counts travel in
         `extra` because a refusal that discards what it measured cannot be told
         from one that measured nothing. */
      var out = {
        winMs: winMs,
        n: n,
        dropped: dropped,
        windows: null,
        usedWindows: null,
        anchorsPerWindow: null,
        floorBelowMedianMs: null,
        floorMadMs: null,
        ceilAboveMedianMs: null,
        ceilMadMs: null,
        asymmetry: null,
        bulkIqrMs: null,
        floorOverBulk: null,
        reason: reason
      };
      for (var ek in extra || {}) {
        if (Object.prototype.hasOwnProperty.call(extra, ek)) out[ek] = extra[ek];
      }
      return out;
    }
    if (typeof med !== 'function') {
      /* §👥.3 — an absent spine refuses BY NAME. `_ckMedian` is exported for
         exactly this delegation, and a local copy is the second estimator this
         module exists not to keep. */
      return absent('clock.js is not loaded, so DexClock._ckMedian cannot read the floor', 0, 0);
    }
    if (typeof correctionAt !== 'function') {
      return absent('the host axis published no correction curve, so there is no series to read the floor about', 0, 0);
    }
    var n = 0;
    var dropped = 0;
    var hMin = Infinity;
    var i;
    for (i = 0; i < list.length; i++) {
      var a0 = list[i];
      if (!a0 || !isFinite(a0.devMs) || !isFinite(a0.hostMs)) {
        dropped++;
        continue;
      }
      n++;
      if (a0.hostMs < hMin) hMin = a0.hostMs;
    }
    if (n < 1) return absent('no readable anchor carries a delay, so the floor is absent', n, dropped);
    if (!(winMs > 0)) return absent('the floor window must be a positive duration, so no window could be formed', n, dropped);
    /* The minimum per window, keyed on the HOST column: the windows are wall
       time the link had to deliver in, and the device column is the thing under
       test. A map keyed by the window index holds one number per window, so a
       14 h stream at 0.2 s cadence keeps 169 entries and not its 250 000 rows. */
    var mins = Object.create(null);
    var maxs = Object.create(null);
    var cnt = Object.create(null);
    var res = [];
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !isFinite(a.devMs) || !isFinite(a.hostMs)) continue;
      var r = a.hostMs - a.devMs - correctionAt(a.devMs);
      if (!isFinite(r)) {
        /* A curve that answers a non-finite correction leaves this anchor
           unreadable, which is a drop and never a residual of zero. */
        dropped++;
        n--;
        continue;
      }
      res.push(r);
      var k = Math.floor((a.hostMs - hMin) / winMs);
      if (!(k in mins) || r < mins[k]) mins[k] = r;
      if (!(k in maxs) || r > maxs[k]) maxs[k] = r;
      cnt[k] = (cnt[k] || 0) + 1;
    }
    var keys = Object.keys(mins);
    /* The windows the stream SPANS, against the `usedWindows` that hold an
       anchor: the two differ by exactly the holes `anchorGaps` counts. An
       explicit loop, because a spread over an `apply`-ed array would blow the
       stack on a small window. */
    var lo = Infinity;
    var hi = -Infinity;
    for (i = 0; i < keys.length; i++) {
      var kz = Number(keys[i]);
      if (kz < lo) lo = kz;
      if (kz > hi) hi = kz;
    }
    var cs = [];
    for (i = 0; i < keys.length; i++) cs.push(cnt[keys[i]]);
    cs.sort(function (x, y) {
      return x - y;
    });
    var counts = { windows: hi - lo + 1, usedWindows: keys.length, anchorsPerWindow: med(cs) };
    if (keys.length < 2) {
      /* ONE WINDOW IS ONE NUMBER, and a MAD over one number is 0 — which reads
         as a perfectly sharp floor measured on nothing. The floor of the
         estimator IS the estimator's own: two minima are the fewest that can
         scatter. */
      return absent('the anchors fill ' + keys.length + ' window(s) of ' + winMs + ' ms, and a scatter needs two', n, dropped, counts);
    }
    if (!(counts.anchorsPerWindow >= 2)) {
      /* 🔴 AND ONE ANCHOR IN A WINDOW IS ITS OWN MINIMUM AND ITS OWN MAXIMUM.
         Over a population of such windows the floor series, the ceiling series
         and the bulk are ONE series, so `floorMadMs` would report the bulk
         scatter under the floor's name and `asymmetry` would read the ratio of
         two numbers that are both noise about one median. The counts above are
         what a caller needs to fix it — a longer `winMs` or a denser capture —
         so they stay real while every scatter statistic refuses. */
      return absent('the median window holds ' + counts.anchorsPerWindow + ' anchor(s), so a window minimum is its only sample and no floor is separable from the bulk', n, dropped, counts);
    }
    var mv = [];
    for (i = 0; i < keys.length; i++) mv.push(mins[keys[i]]);
    mv.sort(function (x, y) {
      return x - y;
    });
    var floorMid = med(mv);
    var dev = [];
    for (i = 0; i < mv.length; i++) dev.push(Math.abs(mv[i] - floorMid));
    dev.sort(function (x, y) {
      return x - y;
    });
    var mad = med(dev);
    /* THE OTHER END OF THE SAME WINDOWS. A sharp floor alone says nothing about
       which edge is the clock — see the asymmetry note below — so the maxima are
       read in the same pass and cost one more number per window. */
    var xv = [];
    for (i = 0; i < keys.length; i++) xv.push(maxs[keys[i]]);
    xv.sort(function (x, y) {
      return x - y;
    });
    var ceilMid = med(xv);
    var xdev = [];
    for (i = 0; i < xv.length; i++) xdev.push(Math.abs(xv[i] - ceilMid));
    xdev.sort(function (x, y) {
      return x - y;
    });
    var cmad = med(xdev);
    /* The BULK edge, for the comparison the row states: a full IQR of the same
       residual. The spine's `stackJitterMs` is a HALF-IQR of it, so the two
       differ by a factor of two by construction and a reader comparing them
       straight would halve the tail. The row quoted full IQRs (32 ms, 180 ms),
       so this one does too. */
    res.sort(function (x, y) {
      return x - y;
    });
    var half = res.length >> 1;
    var iqr = half > 0 ? med(res.slice(res.length - half)) - med(res.slice(0, half)) : null;
    var bulkMid = med(res);
    return {
      winMs: winMs,
      n: n,
      dropped: dropped,
      windows: counts.windows,
      usedWindows: counts.usedWindows,
      /* 🔴 THE NUMBER WITHOUT WHICH `floorMadMs` CANNOT BE COMPARED. A minimum
         is an EXTREME-VALUE statistic, so how close a window's minimum gets to
         the true floor depends on how many anchors the window held. Measured on
         one shape at two cadences: the same one-sided 8/180 ms plant reads
         `floorOverBulk` 0.2916 at 300 anchors per window and 0.0450 at 1500 —
         the floor did not sharpen, the sampling did. So a reader comparing two
         streams' floors owes this count the way §7 owes an anchor count beside
         a `ppm`. `asymmetry` carries no such debt: it moved 2.486 → 2.191 over
         the same change. */
      anchorsPerWindow: counts.anchorsPerWindow,
      /* HOW FAR BELOW THE PUBLISHED CORRECTION THE FLOOR SITS, and deliberately
         not the floor's raw position. The residual carries the spine's own `r0`
         as a constant (see the head of this function), so a raw position is
         readable but means nothing between two streams; a DEPTH below the same
         series' median is frame-free and is the quantity a per-connection
         offset correction would have to remove. Negative by construction. */
      floorBelowMedianMs: bulkMid != null ? floorMid - bulkMid : null,
      ceilAboveMedianMs: bulkMid != null ? ceilMid - bulkMid : null,
      ceilMadMs: cmad,
      /* 🔴 THE NUMBER THAT SAYS WHETHER THE FLOOR IS THE CLOCK, and the reason
         `floorMadMs` alone cannot say it. ANY distribution bounded below reads a
         sharp floor: measured on this suite's own plants at 300 anchors per
         window, a uniform ±32 ms wobble reads `floorOverBulk` 0.0955 and the
         one-sided 8/180 ms plant reads 0.2916 — the SYMMETRIC one reads
         sharper, and at 1500 anchors per window the order reverses. What
         separates them at BOTH cadences is the SHAPE: a one-sided delay sits
         far below its ceiling (`asymmetry` 2.486 and 2.191) and a symmetric one
         sits in the middle (0.898 and 0.961). A
         remedy that moved the band onto a tight floor would have moved it onto
         the biased edge of a symmetric stream, which is why this ships as a
         shape statistic and the band stays where it is.
         Still NOT decided by any of this: whether the floor holds BETWEEN
         NIGHTS, which is the row's own decisive test and needs the beat path. */
      asymmetry: (function () {
        if (bulkMid == null) return null;
        var below = bulkMid - floorMid;
        var above = ceilMid - bulkMid;
        /* A zero-width side divides by nothing — a constant residual has no
           shape to report, and 0 or Infinity would both read as one. */
        return below > 0 && above > 0 ? above / below : null;
      })(),
      floorMadMs: mad,
      bulkIqrMs: iqr,
      /* ONE NUMBER THE ROW'S CLAIM LIVES IN: the floor's scatter as a share of
         the bulk spread. A zero-width bulk divides by nothing, so the share is
         absent rather than 0 or Infinity. */
      floorOverBulk: iqr != null && iqr > 0 ? mad / iqr : null,
      reason: null
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
    /* The holes are a property of the SEQUENCE, so they are read before any
       refusal and published on every answer this function gives. A caller that
       learns why its band was rejected learns the coverage behind it in the
       same object. */
    var gp = anchorGaps(anchors);
    /* The seams are read over the SAME whole sequence, and both ride on every answer. `gaps`
       therefore keeps describing the FILE's anchor sequence even when the axis below is built on
       one segment of it — `seams.anchorsBeforeLastSeam` is what says they differ. */
    var sm = anchorSeams(anchors);
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
        gaps: gp,
        seams: sm,
        floor: null,
        n: anchors && anchors.length ? anchors.length : 0,
        reason: 'clock.js is not loaded, so DexClock.hostAxis cannot build the radio axis',
        deviceDrawn: null,
        axis: null
      };
    }
    /* §🔒.7 — one device clock per axis. A marked sequence that changed segment is two clocks, so
       the axis takes the anchors at or after the LAST establishment and counts what it dropped.
       🔴 AN UNMARKED SEQUENCE KEEPS ITS BAND, AND THAT IS THE RULING RATHER THAN CAUTION. Without
       the seam column a hole has two readings — the link re-established inside it and reset the
       counter, or it held while no frame arrived — and nothing in a nine-column row tells them
       apart. A refusal there is exactly the generalisation CLAUDE.md §∅ forbids ("do not generalise
       into 'refuse when in doubt'"), and the suite pins the same answer: `clock · radio-clock ·
       absence` asserts a 401 s hole leaves the band at 'radio'. So the absence travels instead:
       every answer carries `seams.marked:false` beside `gaps.gapCount`, which is the pair a consumer
       needing a rate reads. Measured 2026-11-04 over the 14 archived sidecars, a refusal arm here
       moved the published reason on 205 of 227 streams and erased the device-epoch diagnosis (#4365)
       on 5, while changing no band at all — the 6 streams this function accepts carry 0 gaps. */
    var used = sm.marked && sm.segments > 1 ? sm.lastSegment : anchors;
    var n = used && used.length ? used.length : 0;
    if (n < CK_RADIO_MIN_ANCHORS) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        gaps: gp,
        seams: sm,
        floor: null,
        n: n,
        reason: 'need ≥' + CK_RADIO_MIN_ANCHORS + ' radio anchors, got ' + n + (used === anchors ? '' : ' in the segment after the last link establishment, of ' + sm.n + ' readable in the file'),
        deviceDrawn: null,
        axis: null
      };
    }
    var ax = spine(used, opts.axis || {});
    if (!ax || ax.ok !== true) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        gaps: gp,
        seams: sm,
        floor: null,
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
        gaps: gp,
        seams: sm,
        floor: null,
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
        gaps: gp,
        seams: sm,
        floor: null,
        n: ax.n,
        reason: 'the device column is DRAWN (' + (ax.drawnReason || 'its inter-anchor deltas concentrate on one value') + '), so the anchors and the device stamps are not two clocks',
        deviceDrawn: true,
        axis: ax
      };
    }
    /* The spine ACCEPTED these anchors, and both of its statistics are blind to
       a single wild one (see the header). A discontinuity refuses here. */
    var st = anchorStep(used);
    if (st.ratio == null || st.ratio >= CK_RADIO_STEP_OVER_SPAN) {
      return {
        ok: false,
        band: 'rejected',
        timingSource: null,
        spreadMs: null,
        gaps: gp,
        seams: sm,
        floor: null,
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
      gaps: gp,
      seams: sm,
      /* THE OTHER EDGE OF THE SAME RESIDUAL, beside the one the band read. It
         rides on the accepted answers only, because it is read about the
         spine's curve and a refused axis published none — a refusal carries
         `floor: null`, which is the absence and not a floor of zero. */
      floor: anchorFloor(used, ax.correctionAt, opts.floor || {}),
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
    CK_RADIO_GAP_MS: CK_RADIO_GAP_MS,
    CK_RADIO_FLOOR_WIN_MS: CK_RADIO_FLOOR_WIN_MS,
    RC_COLUMNS: RC_COLUMNS,
    RC_SEAM_COLUMN: RC_SEAM_COLUMN,
    parseRadioClock: parseRadioClock,
    radioAxis: radioAxis,
    anchorStep: anchorStep,
    anchorGaps: anchorGaps,
    anchorSeams: anchorSeams,
    anchorFloor: anchorFloor,
    classify: classify
  };
  /* The IIFE argument is typed as a union by the gate, so the attach is cast
     once here — the same move dex-coload.js, provenance-banner.js and
     clock-seam.js make. */
  /** @type {any} */ (root).DexRadio = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
