/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   MotionDex · RENDER  (motiondex-render.js)
   ────────────────────────────────────────────────────────────────────────
   Paints the single-signal motion summary from MOTIONDSP.compute() into the
   SHARED fleet scaffold (ans-design.css): a .kpi-grid of .kpi tiles + .card
   sections for position / effort / actigraphy / quality, each revealed with
   its .section-title. Markup mirrors the fleet's kpi() (badge leads the label
   inside .kpi-label > .kpi-ev) so MotionDex reads as a fleet member.
   Every surfaced number carries an evidence badge (COVERAGE MANDATE) via
   MotionRegistry.badgeForLabel.
   ESM-from-birth dual-mode: attaches window.MOTIONUI + re-exports it.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var POS_LABEL = { supine: 'Supine', prone: 'Prone', left: 'Lateral L', right: 'Lateral R', upright: 'Upright', unknown: 'Unknown' };
  var POS_ORDER = ['supine', 'left', 'right', 'prone', 'upright', 'unknown'];

  function pct(f) {
    return f == null || !isFinite(f) ? '—' : (f * 100).toFixed(0) + '%';
  }
  function num(v, d) {
    return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d);
  }
  /* §∅ — THE ABSENCE SUBLABEL NAMES ITS OWN REASON. This slot held the literal 'no chest ACC' for
     every absent rate, so a chest stream that recorded and carried no respiration read as a missing
     sensor. The producer owns the reason (`respRateReason`), and the reader states it. */
  function respAbsenceWhy(eff) {
    if (!eff) return 'no chest ACC';
    if (eff.respRateReason === 'no-respiratory-effort') return 'no respiratory effort';
    if (eff.reason === 'unit-unknown') return 'ACC unit unknown';
    return 'no chest ACC';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }
  // set a container's HTML and reveal it + its section title (both start display:none)
  function fill(cardId, titleId, html) {
    var c = $(cardId);
    if (c) {
      c.innerHTML = html;
      c.style.display = '';
    }
    var t = $(titleId);
    if (t) t.style.display = '';
  }
  // fallback !== false matches every sibling render helper (oxy/pulse/ppg/ecg/gluco/hrv). MotionDex
  // was the fleet's sole hardcoded `false`, which fails OPEN: an unresolved label returned '' and the
  // number rendered UNBADGED — the bug CLAUDE.md's coverage mandate rates as severe as a wrong unit.
  function evBadge(label, fallback) {
    return global.MotionRegistry ? global.MotionRegistry.badgeForLabel(label, fallback !== false) : '';
  }
  // fleet .kpi tile — badge LEADS the label inside .kpi-label > .kpi-ev (the cohesion-gated pattern)
  function kpi(label, val, sub) {
    var b = evBadge(label);
    return (
      '<div class="kpi"><div class="kpi-label">' +
      (b ? '<span class="kpi-ev">' + b + '</span>' : '') +
      esc(label) +
      '</div><div class="kpi-val">' +
      esc(val) +
      '</div><div class="kpi-sub">' +
      esc(sub || '') +
      '</div></div>'
    );
  }
  function row(label, val, sub) {
    return '<div class="mx-row"><span>' + evBadge(label) + ' ' + esc(label) + '</span><b>' + esc(val) + (sub ? '</b> <span class="kpi-sub">' + esc(sub) + '</span>' : '</b>') + '</div>';
  }

  /* ∅ — THE STATED POPULATION IS THE DENOMINATOR THAT WAS USED, NEVER THE TRACK LENGTH.
     `bodyPosition()` divides every dwell fraction by COVERED epochs (motiondex-dsp.js:1008), and its
     track keeps a dense `unknown` entry for each NON-RECORDING epoch, so `track.length` is the SPAN.
     The row printed "of N epochs" from that span, so every gap overstated the population the percent
     describes: a 60 s supine file under a 180 s span read "of 6 epochs" for a 2-epoch measurement.
     Row 2026-11-08-motiondex-supine-row-states-the-wrong-denominator owns the defect. The span is
     still worth the reader's attention, so it stays BESIDE the population, never as it. An absent
     `coveredEpochs` is NAMED here, because a substituted span is a population nobody measured. */
  function positionPop(pos) {
    var cov = pos && pos.coveredEpochs;
    if (typeof cov !== 'number' || !isFinite(cov)) return 'recorded epoch count absent';
    var span = pos.track ? pos.track.length : null;
    return cov + ' recorded epochs' + (typeof span === 'number' && span > cov ? ' of ' + span + ' in the span' : '');
  }

  // fraction of RECORDED (present!=null) epochs in which effort was present — coverage-honest:
  // no-chest-ACC epochs (present:null) are excluded from the denominator, never scored as absent.
  function effortPresentPct(series) {
    if (!series || !series.length) return null;
    var rec = 0,
      on = 0;
    for (var i = 0; i < series.length; i++) {
      if (series[i].present == null) continue;
      rec++;
      if (series[i].present) on++;
    }
    return rec ? Math.round((on / rec) * 100) : null;
  }

  function positionBar(dwellFrac) {
    if (!dwellFrac) return '';
    var seg = '',
      legend = '',
      i;
    for (i = 0; i < POS_ORDER.length; i++) {
      var p = POS_ORDER[i],
        f = dwellFrac[p] || 0;
      if (f <= 0) continue;
      seg += '<span class="mx-seg mx-seg-' + p + '" style="flex:' + f.toFixed(4) + '" title="' + esc(POS_LABEL[p]) + ' ' + pct(f) + '"></span>';
      legend += '<span class="mx-lg"><i class="mx-dot mx-seg-' + p + '"></i>' + esc(POS_LABEL[p]) + ' ' + pct(f) + '</span>';
    }
    return '<div class="mx-bar">' + seg + '</div><div class="mx-legend">' + legend + '</div>';
  }

  // movement timeline — one bar per 30 s epoch: moving (accent) / still (grey) / NOT RECORDING (hatched).
  // The hatched state is deliberate: a gap is not stillness, and the eye should be able to tell them apart.
  function activitySpark(epochs) {
    if (!epochs || !epochs.length) return '';
    var maxC = 0,
      i;
    for (i = 0; i < epochs.length; i++) if (epochs[i].count > maxC) maxC = epochs[i].count;
    var bars = '';
    for (i = 0; i < epochs.length; i++) {
      var e = epochs[i];
      var cls = e.moving == null ? 'mx-sp mx-sp-nul' : e.moving ? 'mx-sp' : 'mx-sp mx-sp-off';
      var h = e.count != null && maxC > 0 ? Math.max(8, Math.round((e.count / maxC) * 100)) : 100;
      var ttl = e.moving == null ? 'not recording' : (e.moving ? 'moving' : 'still') + ' · ' + num(e.count, 2);
      bars += '<span class="' + cls + '" style="height:' + h + '%" title="' + esc(ttl) + '"></span>';
    }
    return '<div class="mx-spark">' + bars + '</div>';
  }

  // effort sparkline — one bar per epoch: present (accent) / absent (grey) / no-coverage (hatched)
  function effortSpark(series) {
    if (!series || !series.length) return '';
    var maxAmp = 0,
      i;
    for (i = 0; i < series.length; i++) if (series[i].amp > maxAmp) maxAmp = series[i].amp;
    var bars = '';
    for (i = 0; i < series.length; i++) {
      var e = series[i];
      var cls = e.present == null ? 'mx-sp mx-sp-nul' : e.present ? 'mx-sp' : 'mx-sp mx-sp-off';
      var h = e.amp != null && maxAmp > 0 ? Math.max(8, Math.round((e.amp / maxAmp) * 100)) : 100;
      var ttl = e.present == null ? 'no chest ACC' : (e.present ? 'effort present' : 'effort absent') + ' · ' + num(e.amp, 4) + ' g';
      bars += '<span class="' + cls + '" style="height:' + h + '%" title="' + esc(ttl) + '"></span>';
    }
    return '<div class="mx-spark">' + bars + '</div>';
  }

  /* ── D17 · THE NODE'S OWN REFUSALS AND UNEXAMINED CHANNELS ──────────────
     `motiondex-dsp.js` writes six reason families over 17 sites and this file read NONE of them.
     `:1089` nulls `immobileFrac` on a device-clock seam and writes `immobileFracReason: 'clock-seam'`
     beside the null; `pos`/`act` refuse a whole block as `{ hasData: false, reason: 'unit-unknown' }`.
     Both drew the same em-dash a night with no covered epoch draws, and a refused block drew the same
     nothing a stream that never arrived draws. A refusal nobody renders reads as a clean result.

     FOUR STATES, never two: a refusal names its reason · an unexamined channel reads UNKNOWN · a
     recorded count annotates · a MEASURED zero stays silent, because a note on every clean night is
     noise. Every token is the node's OWN spelling, never a borrowed word standing in for it.
     Decision mine under CLAUDE.md §7, posted to the board as #4090. */
  /* A state with no token renders NO value element: an empty `<b>` is a container standing where a
     value would go, and the count such a state carries already sits in its own label. */
  function mxNote(label, value, sentence) {
    return '<div class="mx-row"><span>' + esc(label) + '</span>' + (value == null ? '' : '<b><code>' + esc(value) + '</code></b>') + '</div>' + '<div class="kpi-sub">' + esc(sentence) + '</div>';
  }

  function _mxProvenanceNote(summary) {
    if (!summary || typeof summary !== 'object') return '';
    var pos = summary.position || {},
      act = summary.activity || {},
      out = '';

    // ── a refused BLOCK: the card above it renders nothing, which is what a missing stream renders ──
    if (pos.hasData === false && pos.reason)
      out += mxNote('⏱ Position block refused', pos.reason, 'The node published no dwell track for this recording. The absent Position card is a refusal, not a stream that never arrived.');
    if (act.hasData === false && act.reason)
      out += mxNote('⏱ Actigraphy block refused', act.reason, 'The node published no epoch track for this recording. The absent Actigraphy card is a refusal, not a stream that never arrived.');

    // ── a refused FIGURE beside the figures that stand ──
    if (act.immobileFracReason)
      out += mxNote(
        '⏱ Immobile time refused',
        act.immobileFracReason,
        'A device-clock seam crosses this recording, so the immobile fraction over it describes no continuous stretch of signal. The em-dash above is that refusal. Movement index still stands, because a magnitude over covered epochs is not a span.'
      );

    /* ── the ARRIVAL seam channel. The owner ruled on 2026-11-05 that a night with no sidecar reads
       UNKNOWN, never seam-free, so a non-finite count states the node's own reason token. ── */
    var s = summary.seams;
    if (!s || typeof s !== 'object') {
      out += mxNote('❓ Seam channel UNKNOWN', null, 'This recording carries no seam channel at all, so nothing examined the box arrival stamps.');
    } else if (typeof s.seams !== 'number' || !isFinite(s.seams)) {
      out += mxNote(
        '❓ Seam channel UNKNOWN',
        s.reason || null,
        'The sidecar reader published no seam count, so nothing examined the box arrival stamps. The figures above stand, and an unexamined channel is not a clean one.'
      );
    } else if (s.seams > 0) {
      out += mxNote(
        '📄 Recorded seams · ' + s.seams,
        s.reason || null,
        'The box recorded a gap in the arrival stamps. ' +
          (typeof s.placed === 'number'
            ? s.placed + ' of them ' + (s.placed === 1 ? 'lands' : 'land') + ' on this axis.'
            : 'The reader published no placement for them, so how many land on this axis is UNKNOWN.')
      );
    }

    // ── a device-clock STEP the parser found. A measured zero stays silent. ──
    if (typeof summary.clockResyncs === 'number' && summary.clockResyncs > 0)
      out += mxNote('📄 Device-clock steps · ' + summary.clockResyncs, null, 'The parser re-anchored the axis at each step, so an epoch index either side of one describes a different clock.');

    // ── reduced COVERAGE annotates (owner ruling 2026-09-17), so the epoch counts above read honestly ──
    if (typeof act.blankedEpochs === 'number' && act.blankedEpochs > 0)
      out += mxNote('📄 Blanked epochs · ' + act.blankedEpochs, null, 'The box called these epochs absent. The recorded-epoch counts above cover less of the night than its span.');

    return out;
  }

  // renderSummary(summary) → paints every section of the shared scaffold
  function renderSummary(summary) {
    var grid = $('mxKpiGrid');
    if (!summary || !summary.streams || (!summary.streams.acc && !summary.streams.chestAcc)) {
      if (grid) grid.innerHTML = '<div class="mx-empty">No IMU samples parsed. Drop Polar Sensor Logger <code>_ACC / _GYRO / _MAGN</code> files (Verity or H10).</div>';
      return;
    }
    var pos = summary.position || {},
      act = summary.activity || {},
      eff = summary.effort || {},
      sqi = summary.sqi || {};

    // ── KPI grid ──
    var k = '';
    k += kpi('Supine time', pos.hasData ? pct(pos.supineFrac) : '—', 'positional-OSA target ↓');
    k += kpi('Immobile time', act.hasData ? pct(act.immobileFrac) : '—', 'below movement threshold');
    k += kpi('Movement index', act.hasData ? num(act.movementIndex, 2) : '—', 'per-epoch activity');
    k += kpi('Respiratory rate', eff.hasData ? num(eff.rateBrpm, 1) + ' br/min' : '—', eff.hasData ? eff.nBreaths + ' breaths' : respAbsenceWhy(eff));
    k += kpi('Signal quality', sqi.conf != null ? num(sqi.conf, 2) + '×' : '—', sqi.flags && sqi.flags.length ? sqi.flags.join(', ') : 'clean');
    if (grid) grid.innerHTML = k;
    var kt = $('mxKPI');
    if (kt) kt.style.display = '';

    // ── position ──
    if (pos.hasData) fill('mxPositionCard', 'mxPosition', positionBar(pos.dwellFrac) + row('Supine time', pct(pos.supineFrac), positionPop(pos)));

    // ── effort (incl. the per-epoch presence series — standalone read + the fusion's input) ──
    if (eff.hasData) {
      var presentPct = effortPresentPct(eff.series);
      var e = effortSpark(eff.series);
      e += row('Respiratory rate', num(eff.rateBrpm, 1) + ' br/min', eff.nBreaths + ' breaths');
      e += row('Effort amplitude', num(eff.amplitudeG, 4) + ' g', 'RMS, 0.1–0.6 Hz band');
      // Was a SECOND row labelled 'Effort amplitude' — a coverage percentage under an amplitude
      // label and its 'RMS, 0.1–0.6 Hz band' unit context. Distinct quantity, so it gets its own
      // registry id rather than a relabel onto effortAmp.
      e += row('Effort present', presentPct == null ? '—' : presentPct + '%', 'of recorded epochs');
      fill('mxEffortCard', 'mxEffort', e);
    }

    // ── actigraphy (incl. the per-epoch movement timeline — standalone read + the §2.4 HRV-gate input) ──
    if (act.hasData) {
      var a = activitySpark(act.epochs);
      a += row('Activity counts', num(act.totalCounts, 1), 'Σ dynamic g');
      a += row('Movement index', num(act.movementIndex, 2), 'per 30 s epoch');
      a += row('Immobile time', pct(act.immobileFrac), (act.coveredEpochs != null ? act.coveredEpochs : (act.epochs || []).length) + ' recorded epochs');
      fill('mxActivityCard', 'mxActivity', a);
    }

    // ── quality ──
    /* The node's refusals LEAD this card, because they qualify every figure above them. A card that
       opened only on `sqi.conf` would hide a refusal on the very night that earned it, so the note
       alone is enough to reveal the section. */
    var prov = _mxProvenanceNote(summary);
    if (sqi.conf != null || prov) {
      var q = prov;
      if (sqi.conf != null) {
        q += row('Signal quality', num(sqi.conf, 2) + '×', sqi.flags && sqi.flags.length ? sqi.flags.join(', ') : 'clean');
        q +=
          '<div class="mx-row"><span>Streams</span><b>ACC ' +
          (summary.streams.acc || 0) +
          ' · GYRO ' +
          (summary.streams.gyro || 0) +
          ' · MAGN ' +
          (summary.streams.mag || 0) +
          ' · chest ' +
          (summary.streams.chestAcc || 0) +
          '</b></div>';
        q += '<div class="mx-row"><span>Recording span</span><b>' + (summary.durSec ? (summary.durSec / 60).toFixed(0) + ' min' : '—') + '</b></div>';
      }
      fill('mxQualityCard', 'mxQuality', q);
    }
  }

  global.MOTIONUI = { renderSummary: renderSummary, positionBar: positionBar, effortSpark: effortSpark, activitySpark: activitySpark, effortPresentPct: effortPresentPct, positionPop: positionPop };
})(window);

// ESM-from-birth dual-mode (mirrors glucodex-render): the IIFE attaches window.MOTIONUI for the
// classic co-load consumers; this re-export lets the owned ESM bundle's motiondex-app.js import it.
export const MOTIONUI = window.MOTIONUI;
