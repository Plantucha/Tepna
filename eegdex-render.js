/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   EEGDex · RENDER  (eegdex-render.js)
   ────────────────────────────────────────────────────────────────────────
   Paints the single-channel EEG summary from EEGDSP.compute() into the
   SHARED fleet scaffold (ans-design.css): a .kpi-grid of .kpi tiles plus
   .card sections for the hypnogram, the band shares and the quality block,
   each revealed with its .section-title. The markup mirrors the fleet's
   kpi() (the badge LEADS the label inside .kpi-label > .kpi-ev) so EEGDex
   reads as a fleet member.

   Every surfaced number carries an evidence badge (COVERAGE MANDATE) from
   EegRegistry.badgeForLabel, so every label below is either a registry abbr
   or a term on the registry's meta denylist. A label that is neither would
   MINT an 'experimental' badge for a metric the registry never graded, which
   is a fabricated grade rather than a missing one.

   This file paints refusals as first-class rows. A metric this engine cannot
   measure shows an em dash and ITS OWN reason, never a zero and never a
   borrowed reason (§∅).
   ESM-from-birth dual-mode: attaches window.EEGUI + re-exports it.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* Column height encodes stage DEPTH, so the series reads as a hypnogram and not as a bar chart.
     The classes and the hex values live in EEGDex.src.html; this table is the mirror the legend
     needs, because a legend dot cannot carry a CSS class that sets its height. */
  var STAGE_CLASS = { W: 'eg-ep-w', N1: 'eg-ep-n1', N2: 'eg-ep-n2', N3: 'eg-ep-n3', REM: 'eg-ep-rem' };
  var STAGE_COLOR = { W: '#F0A860', REM: '#A78BFA', N1: '#58A6FF', N2: '#3DE0D0', N3: '#5EC8B0' };
  var STAGE_ORDER = ['W', 'REM', 'N1', 'N2', 'N3'];

  /* BAND_LABEL holds the registry ABBRS, so each row badges from the registry grade. BAND_EDGE
     states the edges the CODE uses (eegdex-dsp.js BANDS), half-open as it bands them. */
  var BAND_ORDER = ['delta', 'theta', 'alpha', 'sigma', 'beta'];
  var BAND_LABEL = { delta: 'δ rel', theta: 'θ rel', alpha: 'α rel', sigma: 'σ rel', beta: 'β rel' };
  var BAND_EDGE = { delta: '[0.5, 4) Hz', theta: '[4, 8) Hz', alpha: '[8, 12) Hz', sigma: '[12, 16) Hz', beta: '[16, 30) Hz' };

  /* The three refused metrics, with the SAME reason keys the DSP publishes (EEGDSP.REFUSALS). A key
     this table does not know prints the raw reason rather than a friendly sentence, because an
     unknown reason is still the honest one.

     `spindleDensity` LEFT this table when the detector landed: it is a measured row below, and a
     surface that still refused it would say the engine cannot see what it now counts. */
  var REFUSAL_LABEL = { contactPct: '% Contact', frontalAsym: 'FAA', calmScore: 'Calm' };
  var REFUSAL_ORDER = ['contactPct', 'frontalAsym', 'calmScore'];
  var REFUSAL_WHY = {
    'no-contact-sidecar': 'no contact sidecar — the headband montage this metric needs is not ingested',
    'single-channel-ingest': 'one EEG channel — the frontal pair this metric needs is absent',
    'depends-on-refused-inputs': 'a derived score over the two refusals above'
  };

  /* ∅ · WHY AN ARCHITECTURE NUMBER IS ABSENT, in the reader's words. The DSP's reason keys are the
     authority and this map only translates them; an untranslated key prints raw. */
  var ARCH_WHY = {
    'no-scored-epoch': 'no epoch was scored',
    'no-sleep-epoch': 'no epoch was scored as sleep',
    'no-sleep-onset': 'sleep never began in this recording',
    'no-rem-epoch': 'no epoch was scored REM',
    'under-two-scored-epochs': 'under two scored epochs, so no transition exists'
  };

  /* The twelve architecture rows, in the order a reader walks a night: how much, how well, of what,
     how long until, how broken. Each entry is [registry abbr, key, decimals, suffix]. The abbr IS
     the badge key, so a row whose label is not a registry abbr would mint nothing and the coverage
     gate would catch it. */
  var ARCH_ROWS = [
    ['TST', 'TST', 2, ' h'],
    ['SE', 'SE', 1, ' %'],
    ['Wake %', 'wakePct', 1, ' %'],
    ['N1 %', 'n1Pct', 1, ' %'],
    ['N2 %', 'n2Pct', 1, ' %'],
    ['N3 %', 'n3Pct', 1, ' %'],
    ['REM %', 'remPct', 1, ' %'],
    ['SOL', 'latencySleepMin', 1, ' min'],
    ['REM Lat', 'latencyRemMin', 1, ' min'],
    ['WASO', 'wasoMin', 1, ' min'],
    ['Shifts', 'stageShifts', 0, ''],
    ['REM Per', 'remPeriods', 0, '']
  ];

  function num(v, d) {
    return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 1 : d);
  }

  function pct(v, d) {
    return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 1 : d) + ' %';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  /* ── THE FILE'S ONE HTML SINK ─────────────────────────────────────────────────────────────────
     Every builder below returns markup, so exactly one place has to put markup into the DOM. The
     fleet's shape is that the sink stays in a SINGLE helper rather than at each call site, and a
     test group asserts that of `sensor-trio-night.js` for the same reason: one sink is a line a
     reviewer can hold in their head.

     WHY IT IS SAFE, which `tools/xss-sink-gate.mjs` cannot see across a function boundary (its own
     LIMITS paragraph says so): every value the builders interpolate passes through `esc()` or a
     number formatter, and the only raw markup is `MetricRegistry.badge()` output through
     `evBadge()`. The two device-supplied strings — the EDF channel label and its physical dimension
     — reach HTML only through `row()` and `kpi()`, which escape them. Escaping HERE would escape
     the markup itself, so the gate's remedy does not apply to this line; it is named in that
     gate's ALLOW table with this reason, and the gate reds if the line ever stops existing. */
  function setHTML(el, html) {
    el.innerHTML = html;
  }

  function fill(cardId, titleId, html) {
    var c = $(cardId);
    if (c) {
      setHTML(c, html);
      c.style.display = '';
    }
    var t = $(titleId);
    if (t) t.style.display = '';
  }

  /* `fallback !== false` is load-bearing, and MotionDex measured why: a hardcoded `false` fails OPEN
     and renders the numbers UNBADGED. The default stays ON, so a label this node forgot to register
     is loud instead of silent. */
  function evBadge(label, fallback) {
    return global.EegRegistry ? global.EegRegistry.badgeForLabel(label, fallback !== false) : '';
  }

  /* fleet .kpi tile — badge LEADS the label inside .kpi-label > .kpi-ev (the cohesion-gated pattern) */
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
    return '<div class="eg-row"><span>' + evBadge(label) + ' ' + esc(label) + '</span><b>' + esc(val) + (sub ? '</b> <span class="kpi-sub">' + esc(sub) + '</span>' : '</b>') + '</div>';
  }

  /* §🔒.5 — the clock has ONE formatter. This file never builds a second one: with EEGDSP absent the
     cell reads as an em dash, which is an absent stamp and not a guessed one. */
  function clock(tMs) {
    if (tMs == null) return '—';
    return global.EEGDSP && typeof global.EEGDSP.fmtClock === 'function' ? global.EEGDSP.fmtClock(tMs) : '—';
  }

  /* ── THE HYPNOGRAM ────────────────────────────────────────────────────────────────────────────
     One column per epoch, at that stage's depth. An epoch with no stage is HATCHED at full height
     rather than drawn at some stage's height: §∅, an absence has no depth, and a column drawn at
     Wake's height would read as a scored Wake epoch. */
  function hypnoHtml(summary) {
    var hyp = (summary && summary.hypnogram) || [];
    if (!hyp.length) return '<p class="eg-empty">No epochs to draw.</p>';
    var counts = (summary && summary.stageCounts) || {};
    var eps = '',
      legend = '',
      i,
      h,
      s;
    for (i = 0; i < hyp.length; i++) {
      h = hyp[i];
      eps +=
        '<div class="eg-ep ' + (h.stage == null ? 'eg-ep-nul' : STAGE_CLASS[h.stage] || 'eg-ep-nul') + '" title="' + esc(clock(h.tMs) + ' · ' + (h.stage == null ? 'unscored' : h.stage)) + '"></div>';
    }
    for (i = 0; i < STAGE_ORDER.length; i++) {
      s = STAGE_ORDER[i];
      /* An absent count prints an em dash. The stager initialises all five keys, so a 0 here IS a
         measured zero — but a fallback that wrote 0 for an absent key would make the two the same. */
      legend += '<span class="eg-lg"><span class="eg-dot" style="background:' + STAGE_COLOR[s] + '"></span>' + s + ' ' + (counts[s] == null ? '—' : counts[s]) + '</span>';
    }
    var nul = summary && summary.quality ? summary.quality.nUnscorable : null;
    legend += '<span class="eg-lg"><span class="eg-dot eg-ep-nul"></span>unscored ' + (nul == null ? '—' : nul) + '</span>';
    return (
      row('Hypnogram', hyp.length + ' epochs', (summary.epochSec || '—') + ' s each · median-smoothed') +
      '<div class="eg-hyp">' +
      eps +
      '</div><div class="eg-legend">' +
      legend +
      '</div><p class="chart-note">A hatched column is an epoch with no stage. The stager scores one EEG channel, so this is not a polysomnogram score.</p>'
    );
  }

  /* ── THE BAND SHARES ─────────────────────────────────────────────────────────────────────────
     Each segment's width IS that band's median share of total power, so the bar is never scaled to
     make the five add up. The bands stop at 30 Hz while the total runs to 45 Hz, and the five
     medians are taken independently, so the unfilled remainder is real and the note names it. */
  function bandHtml(summary) {
    var b = summary && summary.bands;
    if (!b) return '<p class="eg-empty">No spectrum in this summary.</p>';
    if (b.reason) return '<p class="eg-empty">' + esc('No band summary — ' + b.reason) + '</p>';
    var rel = b.rel || {},
      pop = b.population || {},
      bar = '',
      rows = '',
      i,
      k;
    for (i = 0; i < BAND_ORDER.length; i++) {
      k = BAND_ORDER[i];
      if (rel[k] == null) continue;
      bar += '<span class="eg-seg eg-seg-' + k + '" style="width:' + rel[k] + '%" title="' + esc(BAND_LABEL[k] + ' ' + num(rel[k], 1) + ' % · ' + BAND_EDGE[k]) + '"></span>';
    }
    for (i = 0; i < BAND_ORDER.length; i++) {
      k = BAND_ORDER[i];
      rows += row(BAND_LABEL[k], pct(rel[k]), BAND_EDGE[k]);
    }
    rows += row('α/θ', num(b.alphaTheta, 3), b.alphaTheta == null ? b.ratioReason || 'refused' : 'median over ' + (pop.ratioEpochs == null ? '—' : pop.ratioEpochs) + ' epochs with theta power');
    /* The edge carries the CEILING in its own subtext, because 95 % of a 45 Hz band is a different
       claim from 95 % of the channel, and a reader cannot see the ceiling in the number. */
    rows += row(
      'SEF95',
      b.sef95 == null ? '—' : num(b.sef95, 2) + ' Hz',
      b.sef95 == null ? b.sefReason || 'refused' : 'median over ' + (pop.sefEpochs == null ? '—' : pop.sefEpochs) + ' epochs · 95 % of (0, 45] Hz power'
    );
    return (
      '<div class="eg-bar">' +
      bar +
      '</div><p class="chart-note">Each width is that band’s own median share of (0, 45] Hz power, over ' +
      (pop.withBands == null ? '—' : pop.withBands) +
      ' of ' +
      (pop.epochs == null ? '—' : pop.epochs) +
      ' epochs. The five medians are independent, and the bands stop at 30 Hz. They sum to ' +
      num(b.relSum, 1) +
      ' %, not 100 %. The unfilled part of the bar is the share that no band claims.</p>' +
      rows
    );
  }

  /* ── SLEEP ARCHITECTURE, AND THE TWO TREND NUMBERS BESIDE IT ────────────────────────
     Twelve rows from one DSP function, then the spindle density and the slow-wave trend. Every
     absent number prints its OWN reason from `architectureAbsence`, so a dash never reads as a zero
     and never borrows the reason of the row above it. */
  function archHtml(summary) {
    if (!summary) return '<p class="eg-empty">Nothing analyzed.</p>';
    var a = summary.architecture || {},
      ab = summary.architectureAbsence || {},
      sp = summary.spindles || null,
      sw = summary.swa || null,
      out = '',
      i,
      e,
      why;
    for (i = 0; i < ARCH_ROWS.length; i++) {
      e = ARCH_ROWS[i];
      if (a[e[1]] == null) {
        why = ab[e[1]];
        out += row(e[0], '—', why ? ARCH_WHY[why] || why : 'absent, with no reason given');
      } else out += row(e[0], num(a[e[1]], e[2]) + e[3], '');
    }
    /* THE POPULATION TRAVELS WITH THE RATE. A density over 6 staged NREM minutes is a different
       number from the same density over 360, and only the subtext can say which one this is. */
    if (!sp) out += row('Spindles', '—', 'this summary carries no spindle answer');
    else if (sp.density == null) out += row('Spindles', '—', sp.reason || 'absent, with no reason given');
    else
      out += row(
        'Spindles',
        num(sp.density, 2) + ' /min',
        (sp.population ? sp.population.detections + ' detections over ' + num(sp.population.eligibleMin, 0) + ' staged NREM min' : '') +
          (sp.byStage ? ' · N2 ' + num(sp.byStage.N2, 2) + ' · N3 ' + num(sp.byStage.N3, 2) : '')
      );
    if (!sw) out += row('SWA Decay', '—', 'this summary carries no slow-wave trend');
    else if (sw.decayPctPerPeriod == null) out += row('SWA Decay', '—', sw.reason || 'absent, with no reason given');
    else out += row('SWA Decay', num(sw.decayPctPerPeriod, 2) + ' %/period', 'least squares over ' + (sw.population ? sw.population.measured : '—') + ' NREM stretches, against the first');
    return out + '<p class="chart-note">Every number here comes from the staged series, so each one inherits the stager and none of them is a polysomnogram score. A dash carries its own reason.</p>';
  }

  /* The power unit is the EDF header's own physical dimension. With no declared dimension the tile
     says so: µV² over an undeclared amplitude is a calibration claim this node cannot make. */
  function powerSub(summary) {
    return summary && summary.unit ? 'median epoch · (' + summary.unit + ')²' : 'median epoch · amplitude unit undeclared';
  }

  /* ── QUALITY, AND THE REFUSALS ───────────────────────────────────────────────────────────────
     The refusals LEAD nothing and trail nothing: they sit in the same table as the provenance, with
     one row each, because a refusal qualifies every figure above it. */
  function qualityHtml(summary) {
    if (!summary) return '<p class="eg-empty">Nothing analyzed.</p>';
    var q = summary.quality || {},
      ref = summary.refused || {},
      out = '',
      i,
      k,
      r;
    var scored = q.nEpochs != null && q.nUnscorable != null ? q.nEpochs - q.nUnscorable : summary.nEpochs != null && q.nUnscorable != null ? summary.nEpochs - q.nUnscorable : null;
    out += row('% Analyzable', pct(q.analyzablePct), (scored == null ? '—' : scored) + ' of ' + (summary.nEpochs == null ? '—' : summary.nEpochs) + ' epochs scored');
    /* Every label below sits on the registry's meta denylist, so none of them mints a badge. */
    out += row('Channel', summary.channel || '—', summary.source ? 'source ' + summary.source : '');
    out += row('Sample rate', summary.fs == null ? '—' : num(summary.fs, 0) + ' Hz', '');
    out += row('Duration', summary.durSec == null ? '—' : num(summary.durSec / 60, 0) + ' min', '');
    out += row('Start', clock(summary.t0Ms), summary.t0Reason || '');
    for (i = 0; i < REFUSAL_ORDER.length; i++) {
      k = REFUSAL_ORDER[i];
      r = ref[k];
      if (!r) continue;
      out += row(REFUSAL_LABEL[k], '—', REFUSAL_WHY[r.reason] || r.reason || 'refused');
    }
    return out;
  }

  /* ── EVERY SIMULATOR SURFACE SAYS WHAT IT IS (owner order 2026-11-14, board #6256 item 7) ──
     The label rides `summary.source`, which `compute` carries from the frame, so an EDF run cannot
     claim it and a demo cannot lose it. The app's own status text used to carry this sentence and
     `renderSummary` then overwrote the status line at the end of its own run, so the demo showed no
     label at all. One owner of the sentence, and it is this function. */
  function synthNote(summary) {
    if (!summary || summary.source !== 'synthetic') return '';
    return '<p class="chart-note">\u26a0 synthetic \u2014 not a recording: authored arithmetic from the EEGDex simulator, so every number below describes the generator rather than a person.</p>';
  }

  function renderSummary(summary) {
    var st = $('egStatus');
    if (!summary || summary.err) {
      if (st) {
        st.textContent = summary && summary.err ? summary.err + (summary.reason ? ' (' + summary.reason + ')' : '') : 'nothing to render';
      }
      return;
    }
    var arch = summary.architecture || {},
      b = summary.bands || {},
      pop = b.population || {};
    var k = '';
    k += kpi('% Analyzable', pct(summary.quality ? summary.quality.analyzablePct : null), (summary.nEpochs == null ? '—' : summary.nEpochs) + ' epochs');
    k += kpi('TST', arch.TST == null ? '—' : num(arch.TST, 2) + ' h', 'sleep epochs × ' + (summary.epochSec || '—') + ' s');
    k += kpi('SE', pct(arch.SE), 'of scored epochs, not of the span');
    k += kpi('N3 %', pct(arch.n3Pct), 'of total sleep time');
    k += kpi('REM %', pct(arch.remPct), 'of total sleep time');
    var spk = summary.spindles || null;
    k += kpi(
      'Spindles',
      spk && spk.density != null ? num(spk.density, 2) + ' /min' : '—',
      spk && spk.density != null ? 'over ' + num(spk.population ? spk.population.eligibleMin : null, 0) + ' staged NREM min' : (spk && spk.reason) || 'no spindle answer'
    );
    k += kpi('Total Power', num(b.totalPower, 3), powerSub(summary));
    k += kpi('α/θ', num(b.alphaTheta, 3), b.alphaTheta == null ? b.ratioReason || 'refused' : 'median over ' + (pop.ratioEpochs == null ? '—' : pop.ratioEpochs) + ' epochs');
    var grid = $('egKpiGrid');
    if (grid) setHTML(grid, k);
    var title = $('egKPI');
    if (title) title.style.display = '';
    var sn = synthNote(summary);
    fill('egHypnoCard', 'egHypno', sn + hypnoHtml(summary));
    fill('egArchCard', 'egArch', sn + archHtml(summary));
    fill('egBandsCard', 'egBands', sn + bandHtml(summary));
    fill('egQualityCard', 'egQuality', sn + qualityHtml(summary));
    if (st) {
      st.textContent =
        (summary.source === 'synthetic' ? 'synthetic — not a recording · ' : '') +
        (summary.channel || 'EEG') +
        ' · ' +
        (summary.nEpochs == null ? '—' : summary.nEpochs) +
        ' epochs · ' +
        (summary.fs == null ? '—' : num(summary.fs, 0) + ' Hz');
    }
  }

  global.EEGUI = {
    synthNote: synthNote,
    renderSummary: renderSummary,
    hypnoHtml: hypnoHtml,
    archHtml: archHtml,
    bandHtml: bandHtml,
    qualityHtml: qualityHtml,
    powerSub: powerSub,
    ARCH_ROWS: ARCH_ROWS
  };
})(window);

// ESM-from-birth dual-mode (mirrors motiondex-render): the IIFE attaches window.EEGUI for the
// classic co-load consumers; this re-export lets the owned ESM bundle's eegdex-app.js import it.
export const EEGUI = window.EEGUI;
