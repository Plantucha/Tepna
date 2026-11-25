/*
 * sq-table.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE SIGNAL-QUALITY TABLE, single-sourced (SIGNAL-QUALITY-TABLE-2026-11-14 §7.4). ECGDex
 * piloted the table and held every generic part of it inside its own two files. §7.4 moves
 * those parts here with the SECOND adopter, so two nodes read one declaration and no node
 * reads another node's render file.
 *
 * WHAT IS GENERIC AND WHAT STAYS IN THE NODE. This file holds the CELL shape (`sqCell`), the
 * sidecar-row state machine (`sqLedgerRow`), the capture-origin reader (`sqCaptureOrigin`),
 * the row and series declarations, and the two render helpers. Each node keeps its own
 * sidecar-ledger declaration and its own `<node>SignalQuality`, because the channel set and
 * the fact sources are node facts.
 *
 * THE TWO INJECTED HELPERS. `makeTable({ badge, lineChart })` closes over the node's badge
 * hook and its chart, so this file reaches no registry and draws no canvas of its own.
 *
 * REALMS: a DSP calls `sqCell` and `sqLedgerRow`, so a worker realm loads this file before
 * the delegating `*-dsp.js`, exactly as it loads `clock.js`.
 */
(function (global) {
  'use strict';

  var _SQ_UNMEASURED = 'unmeasured-and-unexplained';

  /* A cell. `value` is the number the fact is worth; `unit` names what the number counts, because
     several of these facts have more than one defensible unit and a bare percentage is how a share
     of BEATS gets read as a share of TIME. A non-finite value takes the caller's reason; a caller
     that forgot one leaves `_SQ_UNMEASURED`, which the test group reads as a defect rather than as
     an absence — an escape that is VISIBLE instead of silent. */
  function _sqCell(value, unit, reason, extra) {
    var ok = typeof value === 'number' && isFinite(value);
    var c = { value: ok ? value : null, unit: unit, reason: ok ? null : reason || _SQ_UNMEASURED };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) c[k] = extra[k];
    return c;
  }

  /* ── WHO WROTE THIS FILE — the one fact the sample text cannot answer ─────────────────────────────
     The capture box writes the SAME header as a Polar Sensor Logger export, byte for byte
     (`capture-host/writers.py:1888` against the layout above), and the same declared units, on
     purpose: the two are directly comparable. So an origin READ OUT OF THE TEXT would be invented.
     The FILENAME does carry it, and the box's own reader already names the two layouts and pins them
     with a test (`writers.py file_start_stamp`): this host writes the start instant as ONE contiguous
     token, `…_<id>_YYYYMMDDHHMMSS_TAG.ext`, and Polar Sensor Logger SPLITS it,
     `…_<id>_YYYYMMDD_HHMMSS_TAG.ext`. Read from the RIGHT for the same decidability reason that
     reader gives — neither the id nor the vendor prefix has a fixed field count.
     ⚠️ NO NAME MEANS UNKNOWN, NEVER "the box". A sidecar lane that reads `absent` under an unknown
     origin says the FILE is absent and nothing about a writer; only a named vendor export makes the
     box's own sidecars `not-applicable`, because no box ran. */
  function _sqCaptureOrigin(name) {
    var nm = typeof name === 'string' ? name.trim() : '';
    if (!nm) return { origin: null, basis: 'no filename reached this node, so the recording’s origin is unknown — not assumed to be either writer' };
    var base = nm.indexOf('.') >= 0 ? nm.slice(0, nm.lastIndexOf('.')) : nm;
    var parts = base.split('_');
    if (parts.length >= 3) {
      var d8 = parts[parts.length - 3],
        t6 = parts[parts.length - 2];
      if (/^(?:19|20)\d{6}$/.test(d8) && /^\d{6}$/.test(t6)) {
        return { origin: 'polar-sensor-logger', basis: 'the filename carries the vendor app’s split start stamp, `…_YYYYMMDD_HHMMSS_<stream>`' };
      }
    }
    if (parts.length >= 2 && /^(?:19|20)\d{12}$/.test(parts[parts.length - 2])) {
      return { origin: 'capture-host', basis: 'the filename carries this host’s contiguous start stamp, `…_YYYYMMDDHHMMSS_<stream>`' };
    }
    return { origin: null, basis: 'the filename carries neither writer’s start-stamp layout, so the recording’s origin is unknown' };
  }

  function _sqLedgerRow(row, r) {
    var st = row.state || null,
      why = row.state ? row.reason : null;
    /* EVERY ROW IN THIS LEDGER IS A FILE THE CAPTURE HOST WRITES. So the absence of one has two
       different causes, and they need different states: a box capture with no companion is `absent`
       (the writer ran and produced nothing, which is not a clean stream), and a vendor export is
       `not-applicable` (no box ran at all, so no companion could exist). An unknown origin is neither
       claim — the row stays `absent` and its reason says only that no file reached this node. */
    var org = (r && r.captureOrigin) || null;
    var vendor = !!(org && org.origin === 'polar-sensor-logger');
    var naWhy = function (file) {
      return 'this recording is a Polar Sensor Logger export (' + org.basis + '), and `' + file + '` is written by the capture host — no host ran on it, so this sidecar cannot apply';
    };
    var absentWhy = function (file, tail) {
      if (org && org.origin === 'capture-host') return 'the box wrote no `' + file + '` beside this capture, so ' + tail;
      return (
        'no `' +
        file +
        '` reached this node, and this recording’s origin is unknown (' +
        ((org && org.basis) || 'no origin was published') +
        '), so whether a writer should have produced one is unknown as well'
      );
    };
    if (row.state) {
      /* a fixed state is a fact about THIS NODE's readers, which no recording changes — the origin
         override below is the one thing that can still outrank it */
    } else if (row.lane === 'ecgRuns') {
      var rs = r && r.runs;
      if (!rs || rs.reason === 'no-runs-sidecar') {
        st = vendor ? 'not-applicable' : 'absent';
        why = vendor ? naWhy('_ECGRUNS.txt') : absentWhy('_ECGRUNS.txt', 'no blanking span is known — this is not a clean stream');
      } else if (rs.reason) {
        st = 'not-read';
        why = 'the reader ran and placed no row: ' + rs.reason;
      } else {
        st = 'read';
      }
    } else if (row.lane === 'ecgSeams') {
      var ss = r && r.seams;
      if (!ss || ss.reason === 'no-seam-sidecar') {
        st = vendor ? 'not-applicable' : 'absent';
        why = vendor ? naWhy('_ECGSEAMS.txt') : absentWhy('_ECGSEAMS.txt', 'the seam count is unknown rather than zero');
      } else if (ss.reason) {
        st = 'not-read';
        why = 'the reader ran and placed no row: ' + ss.reason;
      } else {
        st = 'read';
      }
    } else {
      var acc = r && r.deviceACC;
      if (!acc || !acc.length) {
        st = 'not-applicable';
        why = 'this recording carries no motion companion, so no motion sidecar can apply to it';
      } else if (acc._runsSidecar) {
        st = 'read';
      } else if (vendor) {
        st = 'not-applicable';
        why = naWhy('_ACCRUNS.txt');
      } else {
        st = 'absent';
        why = absentWhy('_ACCRUNS.txt', 'the held-value runs of the loaded motion companion are unknown');
      }
    }
    /* THE ORIGIN OUTRANKS EVERY OTHER CAUSE, AND ONLY EVIDENCE OUTRANKS IT. Every file in this ledger
       is written by the capture host, so on a vendor export none of them can exist — whatever this
       node's own reader state for it would otherwise be. A row that was actually READ keeps `read`:
       a placed census is evidence, and evidence beats an inference drawn from a filename. The prior
       state travels in the reason rather than being discarded, because "this node has no reader for
       it" stays true of the next recording. */
    if (vendor && st !== 'read') {
      why = naWhy(row.file) + '. This node’s own state for that file is otherwise `' + st + '`: ' + (why || 'it reads the file whenever one arrives');
      st = 'not-applicable';
    }
    return { key: row.key, file: row.file, label: row.label, state: st, reason: st === 'read' ? null : why };
  }

  /* ════════════════════════════════════════════════════════════════════════════════════════════
     SIGNAL QUALITY TABLE AND DRIFT PANELS — SIGNAL-QUALITY-TABLE-2026-11-14 §6 (boxes 6, 7, 8)
     ────────────────────────────────────────────────────────────────────────────────────────────
     The table draws the `signalQuality` object the node export carries, so the page and the
     exported bytes are ONE measurement read twice. The app reads it through
     each node's own `buildNodeExport`, which is the published surface — `<node>SignalQuality` is not on
     the DSP object, and EXPORT-PATH-UNREACHABLE-2026-08-01 is the brief about reaching for a function
     that the DSP only holds in lexical scope.

     §∅ — A NULL CELL PRINTS ITS REASON, never a bare dash. A dash alone reads as a rounding or a
     zero; the reason is the part a reader needs, and `_sqCell` already carries one on every null.
     A cell whose reason is absent prints that fact rather than an empty space.
     ════════════════════════════════════════════════════════════════════════════════════════════ */

  // One row per fact of §3, in the order the brief states them. `label` is also the badge key:
  // `evBadge` resolves it through the registry's own declared labels, so a typo here would
  // fabricate an `experimental` disc — the test asserts each one resolves to a `measured` entry.
  /* One row per quality fact: `k` is the key the export publishes, `id` is the metric this row
     DRAWS and `label` is what the reader sees. The badge resolves through `id`, never through
     `label`: `badgeForLabel` FABRICATES an `experimental` disc for anything it cannot resolve and
     that branch prints no warning, so a prose label is a silent under-grade waiting to happen,
     while an id is the registry's own key. It also states, in this file, which metric each series
     is — the binding the undeclared-metric gate reads. */
  /* ORDER: the score first, then what the score speaks for, then the clock, then the inputs the
     score is built from. The old order opened the table with its two TALLEST rows — coverage and
     flatline share are the only two carrying a before-and-after pair — so a reader met two blocks
     of prose before the first quality number. `kind: 'count'` marks the two rows that count things
     rather than measure a rate (§📏 is about units; this is about the decimals a count may claim).
     A row no channel measured sinks below the rule at render time, so a device that DOES report
     in-band SNR lifts that row back up without an edit here. */
  var SQ_ROWS = [
    { k: 'nodeSqi', id: 'meanSQI', label: 'Mean SQI' },
    { k: 'coverage', id: 'coverage', label: 'Coverage' },
    { k: 'epochs', id: 'sqEpochs', label: 'Epoch population', kind: 'count' },
    { k: 'timing', id: 'sqTiming', label: 'Axis rate' },
    { k: 'drift', id: 'sqDrift', label: 'Night drift' },
    { k: 'reference', id: 'sqReference', label: 'Reference Δ' },
    { k: 'flatline', id: 'sqFlatline', label: 'Flatline share' },
    { k: 'rail', id: 'sqRail', label: 'Rail census', kind: 'count' },
    { k: 'snr', id: 'sqSnr', label: 'In-band SNR' },
    { k: 'mains', id: 'sqMains', label: 'Mains ratio' }
  ];

  var SQ_DRIFT_SERIES = { divergence: 'sqDivergence', rate: 'sqWindowRate', allan: 'sqAllan' };

  /* The badge id of the sidecar census, which is one metric rather than one per row. */
  var SQ_LEDGER_ID = 'sqSidecarState';

  /* The two render helpers, closed over the three things that are node facts: the badge hook, the
     chart and the palette. THE FACTORY REFUSES A PARTIAL SET rather than defaulting around it. A
     badge stub that returns '' draws an unbadged number, which §🎫 calls a bug of wrong-unit
     severity, and an absent palette draws a colourless panel — both are defects that hide. A throw
     here lands at wiring time, where a gate sees it. */
  function makeTable(deps) {
    if (!deps || typeof deps.badge !== 'function' || typeof deps.lineChart !== 'function' || !deps.colors) throw new Error('SQTable.makeTable needs { badge, lineChart, colors }');
    var evBadge = deps.badge,
      lineChart = deps.lineChart,
      C = deps.colors;

    function _sqBadge(label) {
      /* The MODULE-LOCAL `evBadge` of this file, never `global.evBadge`. The two are the same function
       in a browser, because line 27 publishes it — but a realm that loads this module without that
       publication reaching it would draw a table with no disc in it, and the badge rule calls an
       unbadged number a bug of wrong-unit severity. The lexical name cannot be absent. */
      return evBadge(label);
    }

    /* A number for a reader. `null` stays null here — the CALLER decides what an absence prints,
     because only the caller holds the reason that must travel with it. */
    /* A COUNT IS NOT A RATE, AND TWO DECIMALS ON ONE IS A CLAIM THE NODE NEVER MADE. The rail census
     counts samples and the epoch population counts windows, so `161` and `94` printed as `161.00`
     and `94.00` read as measured hundredths of a sample. `kind: 'count'` prints the integer. A
     non-integer reaching a count row is a producer defect, so it falls through to the general
     formatter and SHOWS its fraction rather than being rounded into a tidy lie. */
    function _sqNum(v, kind) {
      if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
      if (kind === 'count' && v === Math.round(v)) return String(v);
      var a = Math.abs(v);
      if (a === 0) return '0';
      if (a >= 1000) return v.toFixed(0);
      if (a >= 1) return v.toFixed(2);
      return v.toPrecision(3);
    }

    var _SQ_NO_REASON = 'no reason travelled with this absence, which is itself a defect';

    /* The reason is the LAST thing in a cell and the quietest: a hairline rule on the left marks it as
     subordinate to the number above it, and a measure cap keeps the line length readable when the
     column is wide. Spacing is the point of the rule, not decoration — the old 3 px gap between the
     value, the unit and two prose blocks of the same size and colour made one grey slab of all four. */
    /* THE STYLE IS A CLASS, NOT AN INLINE RUN. An inline style cannot be overridden by a rule, and
     this block is read in two places that want different spacing: under a drift panel, where the
     hairline rule marks it as subordinate to the number above it, and inside the note under the
     tile grid, where the entry already carries its own key and the rule only adds clutter. */
    function _sqWhy(reason) {
      return '<div class="sq-why">' + (reason || _SQ_NO_REASON) + '</div>';
    }

    /* The before-and-after pair of §6: a fact a sidecar changes shows both sides, and an absent side
     shows its own reason. Box 7's vendor case is exactly this — every AFTER side null. */
    function _sqBeforeAfter(cell, book, site) {
      var hasB = Object.prototype.hasOwnProperty.call(cell, 'before'),
        hasA = Object.prototype.hasOwnProperty.call(cell, 'after');
      if (!hasB && !hasA) return '';
      var b = _sqNum(cell.before),
        a = _sqNum(cell.after);
      /* ONE LINE PER SIDE. The single run `before — (long reason) → after — (long reason)` put two
       nested parentheticals between the reader and the arrow, and the arrow is the only part that
       carries meaning. A labelled row per side reads as a pair and keeps each reason beside its own
       side. The `sq-ba-k` / `sq-ba-v` markers are what a leg reads, so an absent side stays
       machine-visible. */
      return (
        '<div class="sq-ba" style="font-size:10.5px;line-height:1.5;color:var(--text3);margin-top:7px">' +
        _sqBaRow('before', b, cell.beforeReason, book, site) +
        _sqBaRow('after', a, cell.afterReason, book, site) +
        '</div>'
      );
    }

    /* `data-ba` and `data-abs` ARE THE MACHINE-READABLE HALF of this pair. The pair used to be one
     run of prose (`123 → after —`), so the only way to count it was a substring search that also
     matched the reasons around it. A test that counts prose measures the prose. The two attributes
     say which side a row is and whether that side holds a number, so a leg reads the structure. */
    function _sqBaRow(key, num, reason, book, site) {
      return (
        '<div class="sq-ba-row" data-ba="' +
        key +
        '" data-abs="' +
        (num == null ? '1' : '0') +
        '" style="display:flex;gap:7px;align-items:baseline;margin-top:2px">' +
        '<span class="sq-ba-k" style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--text4,var(--text3));min-width:38px;flex:0 0 auto">' +
        key +
        '</span>' +
        '<span class="sq-ba-v" style="font-family:IBM Plex Mono,monospace;color:var(--text2);flex:0 0 auto">' +
        (num == null ? '—' : num) +
        '</span>' +
        (num == null ? '<span class="sq-ba-r" style="max-width:40ch">' + (book ? book('the ' + key + ' side of ' + site, null, reason) : reason || _SQ_NO_REASON) + '</span>' : '') +
        '</div>'
      );
    }

    /* A RATE NEVER TRAVELS ALONE. Clock Contract §7: `ppm` is a diagnostic, and quoting one without
     its anchor count and its span states a precision the measurement does not hold. Both cells that
     publish a ppm here — the host-axis rate and the night drift — already carried `anchors`, `spanMs`
     and, for the drift, `ppmUncertainty` in their own data; the TABLE dropped all three and printed
     the bare figure (measured 2026-11-15: `-6.67` under `ppm of the device rate against the host
     axis`, with nothing beside it). This reads whatever the cell published and stays silent when the
     cell published none of it, so it adds no fact of its own. */
    function _sqSpanTxt(ms) {
      if (!isFinite(ms) || ms <= 0) return null;
      if (ms >= 3600000) return (ms / 3600000).toFixed(ms >= 36000000 ? 0 : 1) + ' h';
      if (ms >= 60000) return Math.round(ms / 60000) + ' min';
      return Math.round(ms / 1000) + ' s';
    }

    function _sqQualifier(cell) {
      var bits = [];
      if (typeof cell.anchors === 'number' && isFinite(cell.anchors)) bits.push('from ' + cell.anchors + (cell.anchors === 1 ? ' anchor' : ' anchors'));
      var span = typeof cell.spanMs === 'number' ? _sqSpanTxt(cell.spanMs) : null;
      if (span) bits.push('over ' + span);
      if (typeof cell.ppmUncertainty === 'number' && isFinite(cell.ppmUncertainty)) bits.push('\u00b1 ' + _sqNum(cell.ppmUncertainty, 'ppm') + ' ppm at this span');
      /* NAME WHAT LIMITS THE NUMBER, because a short span reads high for a reason the estimator does
       not own. This block used to say the figure is an end-point read against the FIRST anchor's own
       raw residual, and that `r0` origin gives the rate an additive bias of about jitter / span. The
       repair it asked for has landed in `clock.js`, and measuring it corrected the reason. Two
       separate terms sat behind the one sentence, and which one dominates depends on ANCHOR DENSITY:

         · `r0`'s jitter — VARIANCE, not bias. One raw sample sets the origin, so its full jitter
           reaches the rate. It is zero-mean, so it cannot lean, and re-drawing the noise is what
           shows that. Cancelling `r0` removes it.
         · the running median's END CLAMP — a deterministic LOW bias of 5/(n−1) relative, because the
           old numerator stopped 5 anchors short of the end while the denominator ran the full span.
           Dividing by the distance between the two end windows' centres removes it exactly.

       `clock.js` now does both, and publishes `ppmEstimator` to name the arm. Measured 2026-11-16
       with zero jitter, so only the clamp term is left, against a PLANTED 50 ppm:

         n            16      22      31      41     101     451
         before   33.333  38.095  41.667  43.750  47.500  49.444   ← exactly 50·(n−1−5)/(n−1)
         after    33.333  50.000  50.000  50.000  50.000  50.000

       ⚠ THE TABLE THAT USED TO SIT HERE PLANTED 50 ppm AT 5 ms OF JITTER, and that is why it read a
       bias of the wrong sign. Over 60 s a 50 ppm drift is 3 ms against ±5 ms of jitter, so the figure
       there is noise and a single draw of it says nothing about a lean. Those rows reported one draw
       each, and the repair's own first measurement repeated the mistake.

       WHAT STILL LIMITS A SHORT SPAN, re-measured 2026-11-17 over 400 draws at the node's own
       391-anchor geometry, 60 s of ±5 ms uniform jitter against a planted 50 ppm: the published
       rate's PER-DRAW SPREAD is 31.3 ppm, which is 58 % of the value it qualifies, and the mean of
       the draws lands between 49.8 and 53.6 ppm across three generators of that one jitter band —
       the original probe's linear-congruential sequence, a mulberry32 and the platform
       `Math.random`. So the SPREAD is the quantity a reader needs, and the mean is
       generator-dependent. The clamp term
       is only 1.28 % of the span at that density, so almost all of what is left is host jitter
       swamping a 3 ms drift. A node cannot fix that by estimating better. It needs a longer span,
       and the §∅ question of whether `ok` should be true at all over an unresolvable rate is logged
       and not answered here.

       ⚠ THIS PARAGRAPH USED TO READ `56.80 ± 1.25 before the repair and 53.60 ± 1.56 after it`.
       Both ± figures were the STANDARD ERROR of a 400-draw mean, which is 1/20 of the spread and
       shrinks with the number of times the probe ran. It sized the probe session and no recording,
       and it read as a tight figure where the quantity under argument is 20 times wider. The
       re-measurement reproduces `53.60 ± 1.56` exactly from the original probe's own generator, a
       32-bit linear-congruential sequence seeded `31337 + k`, which is what identifies the committed
       figures as that probe's standard-error column. The pre-repair 56.80 belongs to an estimator
       the spine no longer publishes, so no figure here is quoted for it. `clock.js` carries the
       repair's own before-and-after table at a planted 2000 ppm, where the drift is resolvable and
       mean, standard error and standard deviation sit in separate columns. Read that table for the
       repair and this paragraph for the limit.

       So this clause names the LIMIT rather than the estimator's origin. It rides the two cells whose
       unit names the host axis, which are the two the measurement covers. The §3d night-drift cell
       runs a different estimator and says nothing here. */
      if (cell.unit === 'ppm of the device rate against the host axis' && bits.length) bits.push('a median read, so a span this short is limited by host jitter rather than by drift');
      if (!bits.length) return '';
      return '<div class="sq-qual" style="font-size:10px;color:var(--text3);margin-top:2px">' + bits.join(' \u00b7 ') + '</div>';
    }

    /* THE READING ORDER IS THE INFORMATION ORDER: value, then what it is measured in, then the pair a
     sidecar moves, then — last and quietest — the reason. One channel of one fact is this block.

     IT WAS A TABLE CELL UNTIL 2026-11-16, and the table is what cost the card its space (owner,
     measured on a two-channel recording: a 170 px label column, one fixed-width column per channel,
     and 10 rows whose height was set by the tallest prose in the row — the motion column's reason
     paragraphs — so a row carrying two numbers and a row carrying two dashes spent the same height.
     ONE FACT ON ONE CHANNEL IS NOW ONE TILE, and the tile is the `.q-stat` the owner approved for
     the quality strip above it (owner, 2026-11-16: "here should be all metrics with same look"),
     so the section carries no second metric idiom of its own. The value is a `.q-val` and takes NO
     status class, because this node grades none of these facts: the strip's green says a threshold
     was met, and borrowing it here would state a verdict nothing computed.

     THE TILE CARRIES NO PROSE (owner, 2026-11-16, rejecting the first version of this block and
     sending the strip itself back as the request). The first version kept the strip's classes and
     put the qualifier, the before-and-after pair and the absence reason INSIDE the tile, which made
     a tall ragged tile that reads as a second design rather than the approved one. The strip states
     every method and every exception in ONE `.q-note` under the grid, so this section does the
     same: the tile holds the disc, the number, the label, the channel and the unit, and every word
     that explains a tile sits in the note below, named by `<fact> \u00b7 <channel>`. Nothing is
     hidden. A `\u2014` still carries its own reason, one line lower. */
    function _sqTile(cell, row, chanLabel, hoisted, book, notes) {
      var n = cell ? _sqNum(cell.value, row.kind) : null;
      var site = row.label + ' in ' + chanLabel.toUpperCase();
      var body = '';
      if (!cell) body = _sqWhy('this channel publishes no cell for this fact, so the tile has nothing to read');
      else {
        if (n != null) body += _sqQualifier(cell);
        body += _sqBeforeAfter(cell, book, site);
        if (n == null && (hoisted || []).indexOf(cell.reason || _SQ_NO_REASON) < 0) body += _sqWhy(cell.reason);
      }
      if (body && notes) notes.push('<div class="sq-note-row"><span class="sq-note-k">' + row.label + ' \u00b7 ' + chanLabel + '</span>' + body + '</div>');
      return (
        '<div class="q-stat sq-stat">' +
        _sqBadge(row.id) +
        '<div class="q-val' +
        (n == null ? ' sq-val-abs' : '') +
        '">' +
        (n == null ? '\u2014' : n) +
        '</div>' +
        '<div class="q-lbl">' +
        row.label +
        '</div>' +
        '<div class="q-sub sq-sub-ch">' +
        chanLabel +
        '</div>' +
        (cell && cell.unit ? '<div class="q-sub">' + cell.unit + '</div>' : '') +
        '</div>'
      );
    }

    var _SQ_STATE_COLOR = { read: 'var(--green)', 'not-applicable': 'var(--text3)', 'not-read': 'var(--amber)' };

    /* sqTable(sq) → the per-channel fact cards and the sidecar census. It returns a named absence
     rather than '' when the object is not there: an empty card is a question a reader cannot answer. */
    function sqTable(sq, why) {
      if (!sq || !sq.channels)
        return (
          '<div class="mini-h">Signal quality table</div>' +
          '<div class="q-note">No cell of this table can be drawn, and here is why: <b>' +
          (why || _SQ_NO_REASON) +
          '</b>. The table reads the <code>signalQuality</code> object of the node export and computes nothing of its own, ' +
          'so a reason stands here rather than an empty card (EXPORT-PATH-UNREACHABLE-2026-08-01: an export path no one watches rots unseen).</div>'
        );
      var chans = [];
      for (var ck in sq.channels) if (Object.prototype.hasOwnProperty.call(sq.channels, ck)) chans.push(ck);
      /* THE REASON THAT GOVERNS A CHANNEL BELONGS AT THE TOP OF THE SECTION, not inside every card
       that carries it. A channel this node does not ingest publishes one sentence on most facts:
       measured 2026-11-15 on the committed synthetic, 8 of the 11 absent cells of the motion column
       read "this node ingests no motion channel on this recording", beside 8 dashes. §∅ asks that an
       absence carry its named reason, and every absence still does: the governing reason is stated
       ONCE, in that channel's scope card, with the count it covers, and only the cells carrying THAT
       reason go bare. A cell whose absence says something else keeps its own text, so a differing
       absence is never folded into a reason that is not its own. The MAJORITY test, not an equality
       test, is what makes this work on a real channel: an equality test hoisted nothing here,
       because two cells of the eleven said something else. */
      /* THE BEFORE-AND-AFTER REASONS REPEAT TOO, and for the same cause: one finding about the sidecar
       answers several facts, so two cells of the motion column carried the identical two-sentence
       pair (measured 2026-11-15, 8 lines of the card). The book prints the pair at the first cell
       that owes it and names that cell afterwards. The pair stays machine-readable either way: a
       leg reads `data-ba` and `data-abs`, never this prose. */
      var baBook = _sqReasonBook();
      var colWhy = {},
        hoisted = {};
      chans.forEach(function (ck) {
        var seen = Object.create(null),
          absentCells = 0,
          top = null,
          topN = 0;
        SQ_ROWS.forEach(function (row) {
          var c = sq.channels[ck] ? sq.channels[ck][row.k] : null;
          if (!c || _sqNum(c.value, row.kind) != null) return;
          absentCells++;
          var b = c.reason || _SQ_NO_REASON;
          seen[b] = (seen[b] || 0) + 1; // absence-ok: a tally key with no entry has counted nothing
          var n = seen[b];
          if (n > topN) {
            topN = n;
            top = b;
          }
        });
        colWhy[ck] = topN >= 3 && topN * 2 >= absentCells ? { body: top, n: topN, of: absentCells } : null;
        /* A CELL SAYS NOTHING THE SCOPE CARD ALREADY SAID. The scope card carries the majority hoist
         and the channel-level notes, so each of those bodies is struck from every cell below it. The
         ACC column printed `inputNote` in full twice: once at the head and once inside the
         coverage cell, because the first version of this suppression held ONE body. */
        var ch0 = sq.channels[ck] || {};
        hoisted[ck] = [colWhy[ck] ? colWhy[ck].body : null, ch0.scopeNote || null, ch0.inputNote || null].filter(function (x) {
          return x;
        });
      });
      var _sqChanName = function (ck) {
        return String((sq.channels[ck] || {}).stream || ck);
      };
      /* ONE SCOPE CARD PER CHANNEL THAT HAS SOMETHING TO SAY, and none for a channel that does not —
       the old SCOPE row drew a cell for every channel whether or not it carried a note, and a note
       is a paragraph, so one channel's finding set the height of the whole row. */
      var scopeCards = chans
        .map(function (ck) {
          var ch = sq.channels[ck] || {};
          var notes = [];
          if (ch.scopeNote) notes.push(ch.scopeNote);
          if (ch.inputNote) notes.push(ch.inputNote);
          var cw = colWhy[ck];
          if (!notes.length && !cw) return '';
          return (
            '<div class="sq-scope">' +
            '<div class="sq-scope-k">' +
            _sqChanName(ck) +
            ' · scope</div>' +
            notes
              .map(function (t) {
                return '<div class="sq-col-note sq-scope-p">' + t + '</div>';
              })
              .join('') +
            (cw
              ? '<div class="sq-col-why sq-scope-p">' + (cw.n === cw.of ? 'every absence on this channel' : cw.n + ' of the ' + cw.of + ' absences on this channel') + ' — ' + cw.body + '</div>'
              : '') +
            '</div>'
          );
        })
        .join('');
      /* A FACT NO CHANNEL MEASURED SINKS INTO ITS OWN CARD. It is still drawn, with its own reason —
       an absence is a result (§∅) — but it stops standing between two facts that carry numbers. The
       split is computed from the cells of THIS recording, so nothing here hardcodes which facts
       this node happens to compute today. */
      var measured = [],
        absent = [];
      SQ_ROWS.forEach(function (row) {
        var any = false;
        for (var i = 0; i < chans.length; i++) {
          var c = sq.channels[chans[i]] ? sq.channels[chans[i]][row.k] : null;
          if (c && _sqNum(c.value, row.kind) != null) {
            any = true;
            break;
          }
        }
        (any ? measured : absent).push(row);
      });
      /* A ROW GRID AGAIN, BECAUSE EVERY TILE IS NOW THE SAME HEIGHT. The first version carried prose
       inside the tile, so one fact's absence reason set the height of every tile beside it in its
       row (measured 2026-11-16: a 265 px row holding two tiles of 96 px). That is what pushed the
       tiles into a column flow, and the flow then needed a wrapper to stop a fact's two channels
       landing in different columns. Moving the prose under the grid removes the cause, so the
       section uses the strip's own `.q-grid` and both repairs go away with it. */
      var tileNotes = [];
      function _sqFactTiles(row) {
        return chans
          .map(function (ck) {
            var c = sq.channels[ck] ? sq.channels[ck][row.k] : null;
            return _sqTile(c, row, _sqChanName(ck), hoisted[ck], baBook, tileNotes);
          })
          .join('');
      }
      /* TWO CARDS, ONE NUMBER. `ecgdex-dsp.js` sets the axis-rate cell to `hostAxis.ppm` and builds
       the night figure as `night.ppm = hostAxis.ppm`, so on every recording that resolves a host
       axis the two cards print the same rate and differ only in what they attribute it to: the axis
       card names the host column, the night card names the §3d reference the profile selected. A
       reader who meets two rates with two labels reads two measurements and takes the agreement as
       corroboration, which is the one thing it cannot be. The card states the identity rather than
       hiding one fact, because the ATTRIBUTION of each is a separate fact worth reading — and it
       states it only for the channels where the two numbers are in fact equal, measured here, so a
       future node that computes an independent night rate silences this line by itself. */
      var dupChans = chans.filter(function (ck) {
        var c = sq.channels[ck];
        if (!c || !c.timing || !c.drift) return false;
        var t = c.timing.value,
          d = c.drift.value;
        return t != null && d != null && isFinite(t) && isFinite(d) && t === d;
      });
      var dupNote =
        dupChans.length === 0
          ? ''
          : ' <b>Axis rate and Night drift are one measurement on ' +
            (dupChans.length === chans.length ? 'every channel here' : dupChans.join(', ')) +
            '</b>: the night rate is the host-axis rate, attributed to the reference the drift profile named. Their agreement corroborates nothing.';
      var cards = measured.map(_sqFactTiles).join('');
      var absentCard = !absent.length
        ? ''
        : '<div class="sq-abs">' + '<div class="sq-abs-h">Not measured on any channel of this recording</div>' + '<div class="q-grid sq-grid">' + absent.map(_sqFactTiles).join('') + '</div></div>';
      /* THE SIDECAR LEDGER IS A CENSUS LINE, NOT A TABLE (owner, 2026-11-16: "eliminate side cars
       section, nothing is used"). The 25-row scroller spent about 260 px to say one thing on this
       recording — that no sidecar applied to it — and the row that would carry a defect is the one
       that says `not-read`: a validity file this node should have read and did not. So the counts
       are stated in one line, and a ROW is drawn only for a sidecar whose state is not
       `not-applicable`. Nothing is hidden that could be acted on: a `not-applicable` sidecar's
       reason is that the recording has no such stream, which the census states once, while every
       `read` and every `not-read` entry keeps its own line and its own reason. */
      var sc = Array.isArray(sq.sidecars) ? sq.sidecars : [];
      /* THE CENSUS COUNTS EVERY STATE THE LEDGER PUBLISHES, not the three this node expects to meet.
       The first line named `read`, `not-applicable` and `not-read`, and 3 of the 25 entries of the
       synthetic carry `absent`: the line summed to 22 of 25 listed and said nothing about the three
       it could not place. A tally cannot drop a state it has never heard of. `read` is printed at
       zero, because how many validity files this node actually read is the first thing a reader
       asks and an absent clause reads as an unasked question. */
      var scTally = Object.create(null);
      sc.forEach(function (r) {
        var st = r.state || 'state not stated';
        scTally[st] = (scTally[st] || 0) + 1; // absence-ok: a tally key with no entry has counted nothing
      });
      if (!scTally.read) scTally.read = 0;
      var _scRank = function (x) {
        return x === 'read' ? 0 : x === 'not-read' ? 1 : 2;
      };
      var scCensus =
        sc.length +
        ' listed · ' +
        Object.keys(scTally)
          .sort(function (a, b) {
            return _scRank(a) - _scRank(b) || (a < b ? -1 : a > b ? 1 : 0);
          })
          .map(function (k) {
            return scTally[k] + ' ' + k;
          })
          .join(' · ');
      /* THE SAME REASON ON SIXTEEN FILES IS ONE FINDING, SO IT IS STATED ONCE. Measured 2026-11-16 on
       the synthetic ambulatory recording: 16 of the 25 sidecars drew a row, 13 of them `not-read`
       and 3 `absent`, and each row repeated the same sentence — no such file reached this node, and
       the recording published no origin, so whether a writer should have produced one is unknown.
       The census spent 421 px to say that twice. A group names its state, counts its files, lists
       them, and gives the sentence once. A `read` sidecar keeps its own row: its label is a fact
       about that one file, and a recording has few of them. */
      var scGroups = [];
      sc.filter(function (r) {
        return r.state !== 'not-applicable';
      }).forEach(function (r) {
        var isRead = r.state === 'read';
        var reason = isRead ? null : r.reason || _SQ_NO_REASON;
        /* THE FILE NAME INSIDE THE REASON IS WHY THE REASONS LOOKED DIFFERENT. Each absent sidecar's
         sentence quotes its own file in backticks, so 13 sentences that state one finding share no
         byte-equal text and nothing groups. The elision replaces the backticked name — and ONLY a
         backticked run equal to this row's own file, so no other quoted token is touched — with a
         visible ellipsis. The names are not lost: they are the row's file list, right beside the
         sentence they belong to. */
        var shape = isRead ? null : reason.split('`' + r.file + '`').join('`\u2026`');
        var key = isRead ? 'read\u0000' + r.file : r.state + '\u0000' + shape;
        var g = null;
        for (var i = 0; i < scGroups.length; i++) if (scGroups[i].key === key) g = scGroups[i];
        if (!g) {
          g = { key: key, state: r.state, reason: shape, label: isRead ? r.label : null, files: [] };
          scGroups.push(g);
        }
        g.files.push(r.file);
      });
      /* WHAT APPLIED STAYS OPEN; WHAT DID NOT APPLY FOLDS (owner, 2026-11-16: "nothing is used").
       A `read` sidecar changed a number above, so it is a fact about this recording and it stays on
       the page. Every other entry describes the node's reader inventory or a file that did not
       arrive, which is the same on every recording this node sees, and 14 of those rows cost 393 px
       measured on the synthetic ambulatory recording. They fold into a closed disclosure that
       states the counts, so nothing is removed and the shut state costs one line. */
      var _scRowHtml = function (g) {
        return (
          '<div class="sq-sc-row">' +
          '<span class="sq-state" style="color:' +
          (_SQ_STATE_COLOR[g.state] || 'var(--text3)') +
          '">' +
          g.state +
          (g.files.length > 1 ? ' \u00d7 ' + g.files.length : '') +
          '</span>' +
          '<span class="sq-sc-f">' +
          g.files.join(' ') +
          '</span>' +
          '<span class="sq-sc-r">' +
          (g.reason || g.label || '') +
          '</span>' +
          '</div>'
        );
      };
      var scOpen = scGroups.filter(function (g) {
        return g.state === 'read';
      });
      var scShut = scGroups.filter(function (g) {
        return g.state !== 'read';
      });
      var _scCount = function (gs) {
        var by = {};
        gs.forEach(function (g) {
          by[g.state] = (by[g.state] || 0) + g.files.length; // absence-ok: a tally key with no entry has counted nothing
        });
        return Object.keys(by)
          .map(function (k) {
            return by[k] + ' ' + k;
          })
          .join(' \u00b7 ');
      };
      var scBlock =
        (scOpen.length ? '<div class="sq-sc">' + scOpen.map(_scRowHtml).join('') + '</div>' : '') +
        (scShut.length
          ? '<details class="sq-sc-more"><summary>' +
            _scCount(scShut) +
            ' \u2014 show each file and the reason it carries</summary>' +
            '<div class="sq-sc">' +
            scShut.map(_scRowHtml).join('') +
            '</div></details>'
          : '');
      return (
        '<div class="mini-h">Signal quality per channel <span class="mini-sub">' +
        (sq.epochSec ? sq.epochSec + ' s windows' : 'window grid not stated') +
        ' · ' +
        chans.length +
        (chans.length === 1 ? ' channel' : ' channels') +
        '</span></div>' +
        (scopeCards ? '<div class="sq-scopes">' + scopeCards + '</div>' : '') +
        '<div class="q-grid sq-grid">' +
        cards +
        '</div>' +
        absentCard +
        (tileNotes.length ? '<div class="q-note sq-notes">' + tileNotes.join('') + '</div>' : '') +
        '<div class="sq-foot">' +
        '<div class="sq-sc-h">' +
        _sqBadge(SQ_LEDGER_ID) +
        'Validity sidecars <span class="mini-sub">' +
        scCensus +
        '</span></div>' +
        scBlock +
        '<div class="q-note" style="margin-top:8px">Every value on these tiles is the byte the node export carries. A <b>—</b> is a fact no one measured, ' +
        'and the note above names the reason against that fact and that channel; a value a sidecar changes shows itself before and after that sidecar applies. ' +
        'A sidecar that did not apply to this recording is counted above and not listed; one this node should have read and did not keeps its own line.' +
        dupNote +
        '</div></div>'
      );
    }

    /* How many points a panel can actually draw. `_sqPanel` and its caller must agree on this, because
     the caller decides WHICH reason text to hand in from whether the panel will print one at all. */
    function _sqFinite(pts) {
      return pts.filter(function (p) {
        return isFinite(p.y);
      }).length;
    }

    /* ONE FINDING, PRINTED ONCE PER GROUP. On a phone capture `referenceReason`, `nightReason` and the
     axis's `inertReason` are the SAME finding — the host column is the device stamp rounded — so the
     three drift panels quoted one 180-character sentence four times, twice of them inside the rate
     panel alone (measured 2026-11-15 on the committed synthetic). A repeat teaches a reader nothing
     and buries the panel it sits under. §∅ asks that an absence carry its named reason, and it does:
     the reason is placed ONCE, at the first site that owes it, and every later site names that site
     instead of restating it. A back-reference is therefore only ever recorded for a site that really
     printed the text, which is why the caller asks the book only when the panel is empty. */
    function _sqReasonBook() {
      var seen = Object.create(null);
      /* `quietRepeat` is for a site whose own prefix already carries the fact, and which sits directly
       above a second site that will point at the same finding anyway. Two adjacent pointers to one
       sentence are the repeat this book exists to remove, so such a site states its prefix and stops. */
      return function (label, prefix, reason, quietRepeat) {
        var body = reason || _SQ_NO_REASON,
          first = seen[body];
        if (first === undefined) {
          seen[body] = label;
          return prefix ? prefix + ' \u2014 ' + body : body;
        }
        if (quietRepeat) return prefix || '';
        var back = 'the same finding as ' + first + ' above';
        return prefix ? prefix + ' \u2014 ' + back : back;
      };
    }

    /* One panel: a header with the series badge, then the chart, or a named reason in place of it. */
    function _sqPanel(badgeId, label, sub, pts, color, opts, reason) {
      var finite = _sqFinite(pts);
      var head = '<div class="mini-h" style="margin-top:10px">' + _sqBadge(badgeId) + label + ' <span class="mini-sub">' + sub + '</span></div>';
      /* AN EMPTY PANEL'S REASON IS DRESSED LIKE AN EMPTY CELL'S. Both say the same kind of thing — this
       was not measured, and here is why — so they share one treatment: the hairline rule on the left
       marks the text as subordinate to the title above it, and the measure cap keeps it readable on
       a wide card. A flush-left `q-note` read as body copy of the panel instead. */
      if (finite < 2) return head + _sqWhy(reason);
      return head + lineChart(pts, color, opts);
    }

    /* sqDriftPanels(dp, ax) → the three §3d series: the raw divergence, the per-window rate, and the
     Allan deviation of the divergence. Each carries its own badge, and an empty series states why
     rather than drawing an axis with no line on it. */
    function sqDriftPanels(dp, ax) {
      if (!dp)
        return (
          '<div class="mini-h">Clock drift</div>' +
          '<div class="q-note">This recording carries no drift profile, so none of the three series exists. ' +
          'The profile needs a device clock and a host column from the same rows.</div>'
        );
      var wins = Array.isArray(dp.windows) ? dp.windows : [];
      var refName = dp.reference && dp.reference.name ? dp.reference.name : null;
      var noRef = dp.referenceReason || 'this recording names no §3d time reference';
      var divPts = wins.map(function (w) {
        return { x: w.tMin, y: w.residFirstMs == null ? null : w.residFirstMs };
      });
      var ratePts = wins.map(function (w) {
        return { x: w.tMin, y: w.ppm == null ? null : w.ppm };
      });
      var stab = ax && ax.stability ? ax.stability : null;
      var curve = stab && Array.isArray(stab.curve) ? stab.curve : [];
      /* BOTH AXES ARE LOG, because the only thing this curve is read FOR is its SLOPE: `clock.js`
       classifies the noise by a log-log least squares (`CK_ALLAN_NOISE`, boundaries at −0.75, −0.25,
       +0.25, +0.75). On the linear y this panel drew before, every slope looked like the same smooth
       decay and the printed class could not be checked against the picture it sat under.
       σ is a deviation, so a non-positive term has no logarithm. Such a term is EXCLUDED and counted
       rather than clamped, and the count rides in the caption (§∅: a dropped sample is stated). */
      var allanAll = curve.filter(function (c) {
        return c && c.tauSec > 0 && isFinite(c.adevPpm);
      });
      var allanPts = allanAll
        .filter(function (c) {
          return c.adevPpm > 0;
        })
        .map(function (c) {
          return { x: Math.log(c.tauSec) / Math.LN10, y: Math.log(c.adevPpm) / Math.LN10 };
        });
      var allanDropped = allanAll.length - allanPts.length;
      /* THE NOISE LABEL IS A CONCLUSION OF A FIT, so it never travels alone. `clock.js` publishes the
       unrounded `slope` with its standard error and the τ count the fit read, and it publishes
       `meaning` exactly when the slope sits within 1.96 SE of a category boundary — which says the
       noise TYPE is not supported by this fit. A panel that prints the label alone presents an
       unsupported category as a measurement, so the label here always carries slope ± SE over the
       τ count, and the unsupported case says so in place of the label. */
      var slopeTxt = null;
      if (stab && stab.slope != null && isFinite(stab.slope)) {
        slopeTxt =
          'slope ' +
          stab.slope.toFixed(2) +
          (stab.slopeSE != null && isFinite(stab.slopeSE) ? ' ± ' + stab.slopeSE.toFixed(2) : ' (no SE published)') +
          (stab.nTau == null ? '' : ' over ' + stab.nTau + ' τ');
      }
      var allanSub =
        'σ(τ) of the raw divergence · averaging time τ on the x axis · both axes log' +
        (slopeTxt == null ? '' : ' · ' + slopeTxt) +
        (stab && stab.meaning ? ' · class unsupported by this fit' : stab && stab.noise ? ' · ' + stab.noise : '') +
        (allanDropped > 0 ? ' · ' + allanDropped + ' τ dropped: σ is not positive there, so it has no logarithm' : '');
      /* THE AXIS PUBLISHES ITS OWN REASONS, so this ladder QUOTES them and writes no prose over them
       (§∅: the named reason must be the node's own). `deviceDrawn` is read BEFORE `independent`,
       because the two answer different questions: `drawnReason` says the DEVICE column is a
       synthesised counter and not a clock, while `inertReason` says the HOST column is the device
       stamp rounded. clock.js publishes the two separately, because both can be non-null and neither
       implies the other — and a drawn axis still reads `independent: true`, so a ladder gating on
       `independent` alone prints the wrong reason for a drawn stream. That shape is what the
       drawn-axis provenance gate reds. Either reason may be absent on a hand-made axis, and then the
       panel says so rather than inventing one. */
      var allanWhy = !ax
        ? { p: null, b: 'this recording publishes no host axis, so the divergence it would average does not exist' }
        : ax.ok === false
          ? { p: 'the host axis refused this recording', b: ax.reason || _SQ_NO_REASON }
          : ax.deviceDrawn === true
            ? { p: 'no second timebase to average', b: ax.drawnReason || _SQ_NO_REASON }
            : ax.independent === false
              ? { p: 'no second clock to average', b: ax.inertReason || _SQ_NO_REASON }
              : stab && stab.note
                ? { p: null, b: stab.note }
                : { p: null, b: 'the axis published no Allan curve for this recording' };
      /* THE NIGHT FIGURE IS AN OBJECT, NEVER A NUMBER. `ecgdex-dsp.js` builds
       `{ppm, spanPpm, spanMs, anchors, ppmUncertainty, uncertaintyReason}`, and it is non-null
       whenever the recording names a host reference — which is every capture-host night, and no
       committed fixture. A `== null` guard passes that object to a numeric site, so `night.toFixed(1)`
       threw on the first real night, and the throw took down every section after this one, because
       it aborts `renderAll`. Read `.ppm`, and read it finite.
       §🔒.7 forbids a quoted `ppm` without its anchor count and its span, so the label carries both,
       and §7 forbids a rate that travels without the size of its own uncertainty. §∅: each absence
       states the node's own reason rather than printing nothing. */
      var winWhy = refName ? 'no window of this recording holds the three anchors a rate needs' : noRef;
      var nightObj = dp.night && typeof dp.night === 'object' ? dp.night : null;
      var nightPpm = nightObj && nightObj.ppm != null && isFinite(nightObj.ppm) ? nightObj.ppm : null;
      var nightUnc = nightObj && nightObj.ppmUncertainty != null && isFinite(nightObj.ppmUncertainty) ? nightObj.ppmUncertainty : null;
      var nightSpanH = nightObj && nightObj.spanMs != null && isFinite(nightObj.spanMs) ? nightObj.spanMs / 3600000 : null;
      /* THE FOUR REASON SITES OF THIS GROUP, IN DOCUMENT ORDER: the divergence panel's empty state, the
       rate panel's subtitle, the rate panel's empty state, the Allan panel's empty state. The book is
       asked in that order, and only for a site that will really print. A panel that DRAWS a line
       prints no reason, so its text never enters the book and no later site points at it. */
      var book = _sqReasonBook(),
        divDrawn = _sqFinite(divPts) >= 2,
        rateDrawn = _sqFinite(ratePts) >= 2,
        allanDrawn = _sqFinite(allanPts) >= 2;
      var whyDiv = divDrawn ? winWhy : book('Host divergence', null, winWhy);
      var nightTxt;
      if (nightPpm == null) {
        var nightWhy = nightObj ? 'the host axis published none for this recording' : dp.nightReason || null;
        nightTxt = nightWhy == null ? '' : ' · ' + book('the night rate line', 'no night rate', nightWhy, true);
      } else {
        nightTxt =
          ' · night ' +
          nightPpm.toFixed(1) +
          (nightUnc == null ? ' ppm (no uncertainty: ' + (nightObj.uncertaintyReason || _SQ_NO_REASON) + ')' : ' ± ' + nightUnc.toFixed(1) + ' ppm') +
          ' · ' +
          (nightObj.anchors == null ? '?' : nightObj.anchors) +
          ' anchors' +
          (nightSpanH == null ? ' · span absent' : ' over ' + nightSpanH.toFixed(1) + ' h');
      }
      return (
        '<div class="mini-h">Clock drift <span class="mini-sub">' +
        (refName ? 'reference ' + refName + (dp.reference.basis ? ' · ' + dp.reference.basis : '') : 'no reference named') +
        '</span></div>' +
        _sqPanel(
          SQ_DRIFT_SERIES.divergence,
          'Host divergence',
          'raw host − device residual per ' + (dp.epochSec || '?') + ' s window · hours from the first sample on the x axis',
          divPts,
          C.blue,
          {
            W: 680,
            H: 140,
            xfmt: function (x) {
              return (x / 60).toFixed(1) + 'h';
            },
            yfmt: function (y) {
              return y.toFixed(0) + ' ms';
            }
          },
          whyDiv
        ) +
        _sqPanel(
          SQ_DRIFT_SERIES.rate,
          'Per-window rate',
          'each window own raw residuals · hours from the first sample on the x axis' + nightTxt,
          ratePts,
          C.teal,
          {
            W: 680,
            H: 140,
            med: nightPpm == null ? undefined : nightPpm,
            xfmt: function (x) {
              return (x / 60).toFixed(1) + 'h';
            },
            yfmt: function (y) {
              return y.toFixed(1) + ' ppm';
            }
          },
          rateDrawn ? winWhy : book('Per-window rate', null, winWhy)
        ) +
        _sqPanel(
          SQ_DRIFT_SERIES.allan,
          'Allan deviation',
          allanSub,
          allanPts,
          C.amber,
          {
            W: 680,
            H: 140,
            xfmt: function (x) {
              var t = Math.pow(10, x);
              return t >= 3600 ? (t / 3600).toFixed(1) + 'h' : t >= 60 ? (t / 60).toFixed(0) + 'm' : t.toFixed(0) + 's';
            },
            yfmt: function (y) {
              /* the SERIES is log10(σ), so the tick exponentiates back to the ppm the reader wants */
              var v = Math.pow(10, y);
              return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toPrecision(2)) + ' ppm';
            }
          },
          allanDrawn ? allanWhy.b : book('Allan deviation', allanWhy.p, allanWhy.b)
        ) +
        '<div class="q-note" style="margin-top:8px">The top two panels read the <b>raw</b> anchor residuals, never the smoothed correction: the running median exists to keep delivery jitter out of the correction, ' +
        'so a per-window cell taken from it would under-report a real step. The bottom panel says how far to trust a rate read over a given span; it is null when the host column carries no clock of its own. ' +
        'Both of its axes are logarithmic, because the noise class is the slope of that log-log curve and a reader has to be able to check the printed class against the line.' +
        (stab && stab.meaning ? ' ' + stab.meaning : '') +
        '</div>'
      );
    }

    return { sqTable: sqTable, sqDriftPanels: sqDriftPanels };
  }

  global.SQTable = {
    SQ_UNMEASURED: _SQ_UNMEASURED,
    sqCell: _sqCell,
    sqCaptureOrigin: _sqCaptureOrigin,
    sqLedgerRow: _sqLedgerRow,
    SQ_ROWS: SQ_ROWS,
    SQ_DRIFT_SERIES: SQ_DRIFT_SERIES,
    makeTable: makeTable
  };
})(typeof self !== 'undefined' ? self : globalThis);
