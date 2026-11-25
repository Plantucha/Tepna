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
  function hypnoHtml(summary, truth) {
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
    /* ── THE GENERATOR'S OWN PLAN, UNDER THE SCORED SERIES (demo path only) ───────────────────
       `truth` reaches this function from the DEMO, never from `compute`, so a recording cannot grow
       a truth strip and the simulator cannot lose one. The two strips sit on the same epoch grid, so
       a column above a column is the same 30 s, and a reader sees where the stager and the plan
       part without any agreement number standing between them.

       NO AGREEMENT FIGURE IS PRINTED HERE. Agreement is a metric and this node's registry grades
       none, so a number beside these strips would mint a grade the registry never gave. The test
       lane measures it against a pre-stated floor instead. */
    var tr = '';
    if (truth && truth.hypnogram && truth.hypnogram.length) {
      var th = truth.hypnogram,
        tcols = '',
        bothN = 0,
        ts;
      for (i = 0; i < th.length; i++) {
        ts = th[i].absent ? null : th[i].stage;
        tcols +=
          '<div class="eg-ep ' + (ts == null ? 'eg-ep-nul' : STAGE_CLASS[ts] || 'eg-ep-nul') + '" title="' + esc('planned · epoch ' + th[i].epoch + ' · ' + (ts == null ? 'absent' : ts)) + '"></div>';
        if (i < hyp.length && hyp[i].stage != null && ts != null) bothN++;
      }
      tr =
        '<div class="eg-hyp">' +
        tcols +
        '</div><p class="chart-note">' +
        esc(
          'The strip above is the stager and this one is the generator\u2019s own plan, on the same ' +
            (summary.epochSec || 30) +
            ' s grid: ' +
            th.length +
            ' planned epochs against ' +
            hyp.length +
            ' scored, and ' +
            bothN +
            ' epochs where both name a stage. A column is the plan and not a score, so it is authored arithmetic and carries no evidence grade. The test lane holds the agreement against its own floor; this figure prints none.'
        ) +
        '</p>';
    }
    return (
      row('Hypnogram', hyp.length + ' epochs', (summary.epochSec || '—') + ' s each · median-smoothed') +
      '<div class="eg-hyp">' +
      eps +
      '</div><div class="eg-legend">' +
      legend +
      '</div><p class="chart-note">A hatched column is an epoch with no stage. The stager scores one EEG channel, so this is not a polysomnogram score.</p>' +
      tr
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

  /* ── THE CHART SPINE ──────────────────────────────────────────────────────────────────────────
     The five SVG figures below share these helpers, and they deliberately do NOT import
     `ecgdex-render.js lineChart` or `oxydex-render.js barChart`. Those two draw one series over an
     axis in SECONDS from a flat sample array; every figure here draws a per-EPOCH series on the 30 s
     grid, several of them stacked, and three of them are not line charts at all. What this file
     takes from those two is the three rules their comments earned, not their code:

       1 · A NULL IS A GAP, NOT A ZERO (§∅). A non-finite value leaves the domain and BREAKS the
           path, so an absent stretch draws as a gap. A line ruled across an hour of absent signal
           is a claim about that hour.
       2 · AN EMPTY BUCKET IS NULL. A card holds about 680 px and an 8 h night holds 960 epochs, so
           the series is averaged into columns. A column whose every epoch is absent has no value,
           and 0 would draw it as silence that was measured.
       3 · THE AXIS STATES ITS OWN ENDS. A chart scaled to its own extremes says nothing about the
           size of what it draws, so every figure prints its top and bottom.
  */
  var C = { axis: 'rgba(255,255,255,.16)', grid: 'rgba(255,255,255,.07)', dim: '#6F8096' };

  /* The band hexes mirror `.eg-seg-*` in EEGDex.src.html, which stays the authority: an SVG stroke
     cannot carry a CSS class that also sets a segment width. */
  var BAND_COLOR = { delta: '#5EC8B0', theta: '#3DE0D0', alpha: '#58A6FF', sigma: '#A78BFA', beta: '#F0A860' };

  /* Stage DEPTH as a fraction of the plot height, mirroring the `.eg-ep-*` heights in
     EEGDex.src.html for the same reason as STAGE_COLOR: an SVG staircase cannot read a CSS height. */
  var STAGE_DEPTH = { W: 1, REM: 0.82, N1: 0.62, N2: 0.42, N3: 0.22 };

  var CH = { W: 680, P: { l: 46, r: 12, t: 12, b: 22 } };

  /* 240 columns is about 2.6 px each at 680 px, so a column is visible. An 8 h night then averages
     4 epochs into a column rather than drawing 960 columns under one pixel wide. */
  var MAX_COLS = 240;

  /* Ten shades of ONE accent. A cell's lightness is its power and its hue carries no second
     meaning, so the figure needs no legend for the hue. Ten rather than a smoother twenty because
     the runs below MERGE on equal levels, and a finer scale merges less and costs markup. */
  var SPEC_LEVELS = 10;
  var SPEC_ACCENT = '#3DE0D0';

  /* The spectrogram gets its OWN, smaller column budget: it draws 45 cells per column against a
     line chart's one point, so 240 columns cost it 45 times what they cost a line. 120 columns is
     5.3 px each at 680 px, which is 4 min a column over an 8 h night. */
  var SPEC_COLS = 120;

  /* ∅ · WHY AN EPOCH CARRIES NO SPECTRUM, in the reader's words. The seven keys are
     `eegdex-dsp.js epochAbsence`, which stays the authority; an untranslated key prints raw. */
  var ABSENCE_WHY = {
    'no-samples': 'no samples reached this epoch',
    'no-sample-rate': 'no sample rate, so the epoch has no duration',
    'epoch-too-short': 'the epoch holds under one window',
    'signal-absent': 'every sample in the epoch is absent',
    'partial-hole': 'a hole inside an otherwise present epoch',
    'flat-signal': 'the epoch never moves, so it carries no spectrum',
    'no-spectrum': 'the transform returned no power'
  };
  var ABSENCE_COLOR = {
    'no-samples': '#6F8096',
    'no-sample-rate': '#8B7FB0',
    'epoch-too-short': '#A78BFA',
    'signal-absent': '#FF6B7A',
    'partial-hole': '#F0A860',
    'flat-signal': '#FFD166',
    'no-spectrum': '#58A6FF'
  };

  /* Equal-width epoch groups. `cols <= n` makes every group hold at least one epoch, so no figure
     below has to carry an empty-group arm that could never run. */
  function buckets(n, maxCols) {
    var cols = n < maxCols ? n : maxCols,
      out = [],
      i;
    for (i = 0; i < cols; i++) out.push([Math.floor((i * n) / cols), Math.floor(((i + 1) * n) / cols)]);
    return out;
  }

  /* Rule 1 and rule 2 in one place: the mean over the FINITE members of a group, and `null` when
     the group holds none. Every figure below reads its series through this. */
  function meanOf(vals, from, to) {
    var s = 0,
      c = 0,
      v,
      i;
    for (i = from; i < to; i++) {
      v = vals[i];
      if (v != null && isFinite(v)) {
        s += v;
        c++;
      }
    }
    return c ? s / c : null;
  }

  /* One subpath per contiguous run of finite points, so the line LIFTS across a gap. */
  function pathOf(pts) {
    var d = '',
      open = false,
      i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].y == null || !isFinite(pts[i].y)) {
        open = false;
        continue;
      }
      d += (open ? ' L' : d ? ' M' : 'M') + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
      open = true;
    }
    return d;
  }

  function svg(H, body) {
    return '<svg viewBox="0 0 ' + CH.W + ' ' + H + '" preserveAspectRatio="none" role="img" style="width:100%;height:auto;display:block">' + body + '</svg>';
  }

  function tx(x, y, s, anchor) {
    return '<text x="' + x + '" y="' + y + '" fill="' + C.dim + '" font-size="9" text-anchor="' + anchor + '" font-family="IBM Plex Mono,monospace">' + esc(s) + '</text>';
  }

  /* Six x labels along the epoch axis: a wall clock when the recording declared a start, else the
     elapsed hours. §🔒.5 — the clock comes from `clock()`, which owns the one formatter. */
  function xTicks(H, n, epochSec, t0Ms) {
    var out = '',
      i,
      frac,
      ep,
      lab;
    for (i = 0; i <= 5; i++) {
      frac = i / 5;
      ep = Math.round(frac * (n > 1 ? n - 1 : 0));
      lab = t0Ms == null ? num((ep * (epochSec || 30)) / 3600, 1) + ' h' : clock(t0Ms + ep * (epochSec || 30) * 1000);
      out += tx((CH.P.l + frac * (CH.W - CH.P.l - CH.P.r)).toFixed(1), H - 6, lab, 'middle');
    }
    return out;
  }

  /* The two axis lines plus the y ends. Every figure draws the same frame, so a reader moving
     between them reads the same geometry. */
  function frameOf(H, topTxt, botTxt) {
    var P = CH.P;
    return (
      '<line x1="' +
      P.l +
      '" y1="' +
      (H - P.b) +
      '" x2="' +
      (CH.W - P.r) +
      '" y2="' +
      (H - P.b) +
      '" stroke="' +
      C.axis +
      '"/>' +
      '<line x1="' +
      P.l +
      '" y1="' +
      P.t +
      '" x2="' +
      P.l +
      '" y2="' +
      (H - P.b) +
      '" stroke="' +
      C.axis +
      '"/>' +
      tx(P.l - 5, P.t + 8, topTxt, 'end') +
      tx(P.l - 5, H - P.b - 2, botTxt, 'end')
    );
  }

  /* ── 1 · THE SPECTROGRAM ──────────────────────────────────────────────────────────────────────
     One column per epoch group, one cell per 1 Hz bin, up to the ceiling the engine declares. The
     shade is log10 power against the night's OWN 5th-to-95th centile of finite bins, quantized to
     twelve levels, so a quiet night is not drawn as an empty card and a loud one does not saturate.

     ADJACENT CELLS AT THE SAME LEVEL MERGE INTO ONE RECT. Forty-five bins over 240 columns is
     10 800 cells, and a per-cell rect puts about a megabyte of markup into one card. Merging the
     runs leaves the same picture, because two cells of one colour and one rect of that colour paint
     the same pixels. An epoch group with no spectrum at all draws ONE rect in its reason's colour,
     because a dark column would otherwise read as measured silence (§∅). */
  function spectroHtml(summary) {
    var sp = summary && summary.spectra;
    if (!sp) return '<p class="eg-empty">This summary carries no per-epoch spectrum.</p>';
    if (!sp.series) return '<p class="eg-empty">' + esc('No spectrogram — ' + (sp.reason || 'no reason given')) + '</p>';
    var rows = sp.series,
      n = rows.length,
      nb = sp.ceilHz,
      P = CH.P,
      i,
      j,
      e,
      v;
    var all = [];
    for (i = 0; i < n; i++) {
      if (!rows[i].bins) continue;
      for (j = 0; j < nb; j++) {
        v = rows[i].bins[j];
        if (v > 0) all.push(Math.log10(v));
      }
    }
    if (!all.length) return '<p class="eg-empty">No epoch in this night carries a spectrum.</p>';
    all.sort(function (a, b) {
      return a - b;
    });
    var lo = all[Math.floor(0.05 * (all.length - 1))],
      hi = all[Math.floor(0.95 * (all.length - 1))];
    if (!(hi > lo)) hi = lo + 1;
    var cellH = 3.4,
      H = Math.round(P.t + nb * cellH + P.b),
      bks = buckets(n, SPEC_COLS),
      cw = (CH.W - P.l - P.r) / bks.length,
      body = frameOf(H, nb + ' Hz', '0 Hz') + xTicks(H, n, sp.epochSec, summary.t0Ms),
      absentCols = 0,
      cells = 0;
    /* ONE GROUP PER LEVEL, so the fill and the opacity are written ten times rather than once per
       rect. The merged runs of an 8 h night number in the hundreds, and those two attributes cost
       more than the rects that carry them. */
    var byLevel = [],
      lvi;
    for (lvi = 0; lvi <= SPEC_LEVELS; lvi++) byLevel.push('');
    /* The 30 Hz line marks where the five bands stop while the total runs to the ceiling, so a
       reader can see that the top of this figure is outside every band. */
    var y30 = P.t + (nb - 30) * cellH;
    body += '<line x1="' + P.l + '" y1="' + y30.toFixed(1) + '" x2="' + (CH.W - P.r) + '" y2="' + y30.toFixed(1) + '" stroke="' + C.grid + '" stroke-dasharray="3 3"/>';
    body += tx(CH.W - P.r - 2, y30 - 3, '30 Hz — the bands stop here', 'end');
    for (i = 0; i < bks.length; i++) {
      var from = bks[i][0],
        to = bks[i][1],
        x = P.l + i * cw,
        lv = [],
        withBins = 0;
      for (e = from; e < to; e++) if (rows[e].bins) withBins++;
      if (!withBins) {
        var why = rows[from].reason || 'no-spectrum';
        absentCols++;
        body +=
          '<rect x="' +
          x.toFixed(1) +
          '" y="' +
          P.t +
          '" width="' +
          (cw + 0.6).toFixed(1) +
          '" height="' +
          (nb * cellH).toFixed(1) +
          '" fill="' +
          (ABSENCE_COLOR[why] || C.dim) +
          '" opacity=".5"><title>' +
          esc('epochs ' + from + '–' + (to - 1) + ' · ' + (ABSENCE_WHY[why] || why)) +
          '</title></rect>';
        continue;
      }
      for (j = 0; j < nb; j++) {
        var s2 = 0,
          c2 = 0;
        for (e = from; e < to; e++) {
          var bb = rows[e].bins;
          if (!bb) continue;
          v = bb[j];
          if (v != null && isFinite(v) && v > 0) {
            s2 += v;
            c2++;
          }
        }
        if (!c2) lv.push(null);
        else {
          var q = Math.round((SPEC_LEVELS * (Math.log10(s2 / c2) - lo)) / (hi - lo));
          lv.push(q < 1 ? 1 : q > SPEC_LEVELS ? SPEC_LEVELS : q);
        }
      }
      var run = 0;
      for (j = 1; j <= nb; j++) {
        if (j < nb && lv[j] === lv[run]) continue;
        if (lv[run] != null) {
          /* The bins run upward in frequency and the cells run downward in y, so bin `j-1` is the
             TOP of a run that starts at bin `run`. */
          cells++;
          byLevel[lv[run]] += '<rect x="' + x.toFixed(1) + '" y="' + (P.t + (nb - j) * cellH).toFixed(1) + '" width="' + (cw + 0.6).toFixed(1) + '" height="' + ((j - run) * cellH).toFixed(1) + '"/>';
        }
        run = j;
      }
    }
    for (lvi = 1; lvi <= SPEC_LEVELS; lvi++) {
      if (byLevel[lvi]) body += '<g fill="' + SPEC_ACCENT + '" opacity="' + (lvi / SPEC_LEVELS).toFixed(2) + '">' + byLevel[lvi] + '</g>';
    }
    return (
      row('Total Power', num(summary.bands ? summary.bands.totalPower : null, 3), powerSub(summary)) +
      svg(H, body) +
      '<p class="chart-note">' +
      esc(
        'Each column is ' +
          (n / bks.length).toFixed(1) +
          ' epochs averaged, each cell one ' +
          sp.binHz +
          ' Hz bin up to the engine’s ' +
          nb +
          ' Hz ceiling. Shade is log₁₀ power against this night’s own 5th-to-95th centile of ' +
          all.length +
          ' finite bins, in ' +
          SPEC_LEVELS +
          ' levels, so it compares epochs inside this night and not across nights. ' +
          absentCols +
          ' of ' +
          bks.length +
          ' columns carry no spectrum and are drawn in their own reason’s colour. ' +
          cells +
          ' rects paint the rest, merged from ' +
          (bks.length - absentCols) * nb +
          ' cells.'
      ) +
      '</p>' +
      absenceLegend(rows, 'Every epoch in this night carries a spectrum.')
    );
  }

  /* The legend the spectrogram and the absence timeline share: one entry per reason PRESENT, with
     its epoch count. A reason with no epoch never appears, so the legend cannot imply an absence
     the night did not carry. */
  function absenceLegend(rows, allText) {
    var seen = {},
      order = [],
      out = '',
      i,
      k,
      r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i].reason || (rows[i].absentReason != null ? rows[i].absentReason : null);
      if (!r) continue;
      if (!seen[r]) {
        seen[r] = 0;
        order.push(r);
      }
      seen[r]++;
    }
    if (!order.length) return '<p class="chart-note">' + esc(allText || 'Every epoch in this night carries a spectrum.') + '</p>';
    for (i = 0; i < order.length; i++) {
      k = order[i];
      out += '<span class="eg-lg"><span class="eg-dot" style="background:' + (ABSENCE_COLOR[k] || C.dim) + '"></span>' + esc((ABSENCE_WHY[k] || k) + ' — ' + seen[k] + ' epochs') + '</span>';
    }
    return '<div class="eg-legend">' + out + '</div>';
  }

  /* ── 2 · BAND POWER OVER TIME ─────────────────────────────────────────────────────────────────
     Five lines, one per band, each the band's own relative share per epoch group. The five share
     ONE y axis because they are shares of the same total, so a reader can see delta trade against
     beta. They are five independent series and not a stack: they do not sum to 100, for the same
     reason the band bar leaves a remainder — the bands stop at 30 Hz and the total runs to the
     ceiling. */
  function bandSeriesHtml(summary) {
    var sp = summary && summary.spectra;
    if (!sp) return '<p class="eg-empty">This summary carries no per-epoch spectrum.</p>';
    if (!sp.series) return '<p class="eg-empty">' + esc('No band series — ' + (sp.reason || 'no reason given')) + '</p>';
    var rows = sp.series,
      n = rows.length,
      bks = buckets(n, MAX_COLS),
      P = CH.P,
      H = 180,
      i,
      j,
      k,
      v;
    /* One pass per band over the epochs, then the group means. `vals` holds a null for every epoch
       with no spectrum, so `meanOf` drops it and an all-absent group stays null. */
    var series = {},
      ymx = 0,
      drawn = 0;
    for (j = 0; j < BAND_ORDER.length; j++) {
      k = BAND_ORDER[j];
      var vals = [];
      for (i = 0; i < n; i++) vals.push(rows[i].rel ? rows[i].rel[k] : null);
      var pts = [];
      for (i = 0; i < bks.length; i++) {
        v = meanOf(vals, bks[i][0], bks[i][1]);
        if (v != null && v > ymx) ymx = v;
        pts.push(v);
      }
      series[k] = pts;
    }
    if (!(ymx > 0)) return '<p class="eg-empty">No epoch in this night published a band share.</p>';
    var sx = function (col) {
      return P.l + (bks.length < 2 ? 0 : (col / (bks.length - 1)) * (CH.W - P.l - P.r));
    };
    var sy = function (y) {
      return H - P.b - (y / ymx) * (H - P.t - P.b);
    };
    var body = frameOf(H, num(ymx, 1) + ' %', '0 %') + xTicks(H, n, sp.epochSec, summary.t0Ms),
      legend = '';
    for (j = 0; j < BAND_ORDER.length; j++) {
      k = BAND_ORDER[j];
      var pp = [];
      for (i = 0; i < series[k].length; i++) pp.push({ x: sx(i), y: series[k][i] == null ? null : sy(series[k][i]) });
      var d = pathOf(pp);
      if (!d) continue;
      drawn++;
      body += '<path d="' + d + '" fill="none" stroke="' + BAND_COLOR[k] + '" stroke-width="1.3" stroke-linejoin="round" opacity=".92"/>';
      /* THE SERIES CARRIES THE BADGE (owner 2026-08-16). Each legend entry is a registry abbr, so
         the grade on the line is the grade the registry gave that band. */
      legend += '<span class="eg-lg">' + evBadge(BAND_LABEL[k]) + '<span class="eg-dot" style="background:' + BAND_COLOR[k] + '"></span>' + esc(BAND_LABEL[k] + ' · ' + BAND_EDGE[k]) + '</span>';
    }
    return (
      svg(H, body) +
      '<div class="eg-legend">' +
      legend +
      '</div><p class="chart-note">' +
      esc(
        drawn +
          ' of ' +
          BAND_ORDER.length +
          ' bands drew a line, over ' +
          bks.length +
          ' groups of ' +
          (n / bks.length).toFixed(1) +
          ' epochs. The axis runs to the largest group mean, ' +
          num(ymx, 1) +
          ' %. The five are independent shares of (0, ' +
          sp.ceilHz +
          '] Hz power and do not sum to 100 %. A line LIFTS over a group whose every epoch is absent, because a segment drawn across it would claim a share this night never measured.'
      ) +
      '</p>'
    );
  }

  /* ── 3 · SLOW-WAVE ACTIVITY PER NREM PERIOD ───────────────────────────────────────────────────
     One bar per NREM stretch and the engine's OWN least-squares line over them. The renderer never
     fits anything: `swa.fit` carries the slope and the intercept that produced the published
     percentage, so the line a reader sees is the line the number came from. A second fit here would
     be a second calculation of one claim, and the two would part the moment either side changed. */
  function swaHtml(summary) {
    var sw = summary && summary.swa;
    if (!sw) return '<p class="eg-empty">This summary carries no slow-wave trend.</p>';
    var per = sw.periods || [];
    if (!per.length) return '<p class="eg-empty">' + esc('No NREM stretch to draw — ' + (sw.reason || 'no reason given')) + '</p>';
    var P = CH.P,
      H = 170,
      ymx = 0,
      i,
      v;
    for (i = 0; i < per.length; i++) {
      v = per[i].deltaPower;
      if (v != null && isFinite(v) && v > ymx) ymx = v;
    }
    if (sw.fit) {
      v = sw.fit.intercept + sw.fit.slope * (per.length - 1);
      if (v > ymx) ymx = v;
      if (sw.fit.intercept > ymx) ymx = sw.fit.intercept;
    }
    if (!(ymx > 0)) return '<p class="eg-empty">Every NREM stretch in this night measured no delta power.</p>';
    var span = CH.W - P.l - P.r,
      bw = (span / per.length) * 0.62,
      sy = function (y) {
        return H - P.b - (y / ymx) * (H - P.t - P.b);
      },
      cx = function (k) {
        return P.l + ((k + 0.5) / per.length) * span;
      };
    var body = frameOf(H, num(ymx, 2), '0'),
      bars = '',
      labs = '';
    for (i = 0; i < per.length; i++) {
      v = per[i].deltaPower;
      if (v == null || !isFinite(v)) continue;
      bars +=
        '<rect x="' +
        (cx(i) - bw / 2).toFixed(1) +
        '" y="' +
        sy(v).toFixed(1) +
        '" width="' +
        bw.toFixed(1) +
        '" height="' +
        (H - P.b - sy(v)).toFixed(1) +
        '" fill="' +
        BAND_COLOR.delta +
        '" opacity=".72" rx="2"><title>' +
        esc('stretch ' + (i + 1) + ' · epochs ' + per[i].fromEpoch + '–' + per[i].toEpoch + ' · ' + per[i].epochs + ' epochs · delta power ' + num(v, 3)) +
        '</title></rect>';
      labs += tx(cx(i).toFixed(1), H - 6, String(i + 1), 'middle');
    }
    body += bars + labs;
    if (sw.fit) {
      body +=
        '<line x1="' +
        cx(0).toFixed(1) +
        '" y1="' +
        sy(sw.fit.intercept).toFixed(1) +
        '" x2="' +
        cx(per.length - 1).toFixed(1) +
        '" y2="' +
        sy(sw.fit.intercept + sw.fit.slope * (per.length - 1)).toFixed(1) +
        '" stroke="#FF6B7A" stroke-width="1.6" stroke-dasharray="5 3"/>';
    }
    var pop = sw.population || {};
    return (
      row(
        'SWA Decay',
        sw.decayPctPerPeriod == null ? '—' : num(sw.decayPctPerPeriod, 2) + ' %/period',
        sw.decayPctPerPeriod == null ? sw.reason || 'absent, with no reason given' : 'against the first stretch'
      ) +
      svg(H, body) +
      '<p class="chart-note">' +
      esc(
        'One bar per NREM stretch, ' +
          (pop.measured == null ? '—' : pop.measured) +
          ' of ' +
          (pop.stretches == null ? '—' : pop.stretches) +
          ' measured and ' +
          (pop.excluded == null ? '—' : pop.excluded) +
          ' excluded. '
      ) +
      (sw.fit
        ? esc(
            'The dashed line is the engine’s own least squares, slope ' +
              num(sw.fit.slope, 3) +
              ' a stretch from ' +
              num(sw.fit.intercept, 3) +
              ' at the first, which is the fit the percentage above reports. '
          )
        : esc('No line is drawn, because this summary carries no fit — ' + (sw.reason || 'no reason given') + '. ')) +
      esc('A stretch is a run of N2 or N3 epochs, so the x axis counts stretches and not hours.') +
      '</p>'
    );
  }

  /* ── 4 · THE SPINDLE RASTER OVER THE HYPNOGRAM ────────────────────────────────────────────────
     One tick per detection, at its own second, over a faint stage staircase. The engine publishes
     every detection with its start, its width, its epoch and its stage, so this figure draws the
     events the density counted rather than the density itself.

     NO SLOW-WAVE EVENTS ARE DRAWN. The owner's chart list asks for a spindle AND slow-wave raster,
     and this engine holds no slow-wave event detector — `swa` measures delta POWER per stretch, not
     individual waves. A row drawn from the power would be a different thing wearing the name, so
     the row is absent and the note says why.

     On the simulator path the generator's PLANTED spindles draw underneath, so a reader sees the
     detector against the plant. A recording has no plant and the second row is simply absent. */
  function spindleRasterHtml(summary, truth) {
    var sp = summary && summary.spindles;
    if (!sp) return '<p class="eg-empty">This summary carries no spindle answer.</p>';
    var ev = sp.spindles || [],
      dur = summary.durSec,
      hyp = summary.hypnogram || [],
      P = CH.P,
      H = 150,
      i,
      s;
    if (!(dur > 0)) return '<p class="eg-empty">This summary states no duration, so no event has a place on a time axis.</p>';
    var span = CH.W - P.l - P.r,
      hypTop = P.t + 16,
      hypBot = H - P.b - 26,
      hypH = hypBot - hypTop,
      sxSec = function (sec) {
        return P.l + (sec / dur) * span;
      };
    var body = frameOf(H, 'W', 'N3') + xTicks(H, hyp.length || 1, summary.epochSec, summary.t0Ms);
    /* The staircase is a STEP line and not a smoothed one: a stage holds for its whole epoch, and a
       slope between two epochs would draw a transition that took 30 s.

       ONE PATH PER STAGE, AND RUNS MERGE. An 8 h night holds 960 epochs, and a line element per
       epoch writes the stroke and the width 960 times over five distinct values. A sleeper holds
       one stage for many epochs at a time, so the merged runs number in the dozens. */
    var ep = summary.epochSec || 30,
      stepD = {},
      runStart = 0,
      stageKeys = Object.keys(STAGE_DEPTH),
      ki,
      kk;
    for (i = 1; i <= hyp.length; i++) {
      if (i < hyp.length && hyp[i].stage === hyp[runStart].stage) continue;
      s = hyp[runStart].stage;
      if (s != null && STAGE_DEPTH[s] != null) {
        stepD[s] = (stepD[s] || '') + 'M' + sxSec(runStart * ep).toFixed(1) + ',' + (hypBot - STAGE_DEPTH[s] * hypH).toFixed(1) + 'H' + sxSec(i * ep).toFixed(1);
      }
      runStart = i;
    }
    for (ki = 0; ki < stageKeys.length; ki++) {
      kk = stageKeys[ki];
      if (stepD[kk]) body += '<path d="' + stepD[kk] + '" fill="none" stroke="' + (STAGE_COLOR[kk] || C.dim) + '" stroke-width="1.6" opacity=".45"/>';
    }
    var plantRow = hypBot + 8,
      detRow = hypTop - 10;
    /* THE TICKS CARRY NO PER-EVENT HOVER, and that is a measurement rather than a saving. An 8 h
       night holds over a thousand detections across 620 px, so two ticks sit inside one pixel and
       a pointer cannot reach one of them. A title per event would weigh more than the whole
       figure and would never open. The per-event second, stage, length and peak ratio travel in
       the export, which is where a reader can hold them. */
    var tickD = {};
    for (i = 0; i < ev.length; i++) {
      kk = STAGE_DEPTH[ev[i].stage] == null ? 'W' : ev[i].stage;
      tickD[kk] = (tickD[kk] || '') + 'M' + sxSec(ev[i].atSec).toFixed(1) + ',' + (detRow - 7) + 'v8';
    }
    for (ki = 0; ki < stageKeys.length; ki++) {
      kk = stageKeys[ki];
      if (tickD[kk]) body += '<path d="' + tickD[kk] + '" fill="none" stroke="' + (STAGE_COLOR[kk] || C.dim) + '" stroke-width="1.1"/>';
    }
    body += tx(P.l - 5, detRow - 1, 'found', 'end');
    var planted = truth && truth.spindles ? truth.spindles : null;
    if (planted) {
      var plantD = '';
      for (i = 0; i < planted.length; i++) {
        plantD += 'M' + sxSec(planted[i].atSec).toFixed(1) + ',' + plantRow + 'v8';
      }
      if (plantD) body += '<path d="' + plantD + '" fill="none" stroke="' + C.dim + '" stroke-width="1.1" opacity=".85"/>';
      body += tx(P.l - 5, plantRow + 7, 'planted', 'end');
    }
    var pop = sp.population || {};
    return (
      row(
        'Spindles',
        sp.density == null ? '—' : num(sp.density, 2) + ' /min',
        sp.density == null ? sp.reason || 'absent, with no reason given' : (pop.detections == null ? '—' : pop.detections) + ' detections over ' + num(pop.eligibleMin, 0) + ' staged NREM min'
      ) +
      svg(H, body) +
      '<p class="chart-note">' +
      esc(
        'Each upper tick is one detection at its own second, coloured by the stage it was found in, over the stage staircase. ' +
          ev.length +
          ' detections are drawn and ' +
          (pop.excludedByHole == null ? '—' : pop.excludedByHole) +
          ' were dropped for touching an absent span. '
      ) +
      (planted
        ? esc('The lower ticks are the ' + planted.length + ' spindles the simulator planted, so the two rows read as the detector against its own plant.')
        : esc('A recording carries no planted row, so the lower row is absent here.')) +
      esc(' Each stage draws one path, so a colour names the stage and no tick carries its own hover: over a thousand events share 620 px, and the per-event detail travels in the export.') +
      esc(' No slow-wave events are drawn: this engine measures delta power per NREM stretch and detects no individual slow wave, so a row drawn from the power would carry a name it did not earn.') +
      '</p>'
    );
  }

  /* ── 5 · THE ABSENCE TIMELINE ─────────────────────────────────────────────────────────────────
     The night as one strip, with every unscored stretch shaded in ITS OWN reason's colour. This is
     the complement of `% Analyzable`: the KPI says how much was scored and this figure says where
     the rest went and why. Runs of one reason merge, so the strip holds one rect per stretch and
     not one per epoch. */
  function absenceHtml(summary) {
    var hyp = (summary && summary.hypnogram) || [];
    if (!hyp.length) return '<p class="eg-empty">No epochs to draw.</p>';
    var P = CH.P,
      H = 86,
      span = CH.W - P.l - P.r,
      top = P.t + 6,
      h = H - P.b - top - 6,
      cw = span / hyp.length,
      i,
      run = 0,
      cur = hyp[0].absentReason || null,
      rects = '',
      spans = 0,
      absent = 0;
    var emit = function (from, to, why) {
      var x = (P.l + from * cw).toFixed(1),
        w = ((to - from) * cw + 0.6).toFixed(1);
      if (!why) return '<rect x="' + x + '" y="' + top + '" width="' + w + '" height="' + h.toFixed(1) + '" fill="' + SPEC_ACCENT + '" opacity=".16"/>';
      spans++;
      absent += to - from;
      return (
        '<rect x="' +
        x +
        '" y="' +
        top +
        '" width="' +
        w +
        '" height="' +
        h.toFixed(1) +
        '" fill="' +
        (ABSENCE_COLOR[why] || C.dim) +
        '" opacity=".78"><title>' +
        esc('epochs ' + from + '–' + (to - 1) + ' · ' + (ABSENCE_WHY[why] || why)) +
        '</title></rect>'
      );
    };
    for (i = 1; i <= hyp.length; i++) {
      var r = i < hyp.length ? hyp[i].absentReason || null : '\u0000';
      if (r === cur) continue;
      rects += emit(run, i, cur);
      run = i;
      cur = r;
    }
    var body = frameOf(H, '', '') + rects + xTicks(H, hyp.length, summary.epochSec, summary.t0Ms);
    var q = summary.quality || {};
    return (
      row('% Analyzable', pct(q.analyzablePct), hyp.length - absent + ' of ' + hyp.length + ' epochs scored') +
      svg(H, body) +
      absenceLegend(hyp, 'Every epoch in this night was scored.') +
      '<p class="chart-note">' +
      esc(
        'The pale strip is the scored night and each shaded stretch is unscored, in its own reason’s colour. ' +
          spans +
          ' stretches hold ' +
          absent +
          ' of ' +
          hyp.length +
          ' epochs. Two stretches of one reason stay apart, because a merged strip would read as one longer absence than the night carried.'
      ) +
      '</p>'
    );
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

  function renderSummary(summary, truth) {
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
    fill('egHypnoCard', 'egHypno', sn + hypnoHtml(summary, truth));
    fill('egArchCard', 'egArch', sn + archHtml(summary));
    fill('egBandsCard', 'egBands', sn + bandHtml(summary));
    /* THE FIVE FIGURES, each one carrying the same `synthNote` as the tables above. A chart over the
       simulator says what it is in its own card, because a reader who scrolls to one figure never
       saw the sentence on the first (owner order 2026-11-14, board #6258). */
    fill('egSpectroCard', 'egSpectro', sn + spectroHtml(summary));
    fill('egBandTimeCard', 'egBandTime', sn + bandSeriesHtml(summary));
    fill('egSwaCard', 'egSwa', sn + swaHtml(summary));
    fill('egRasterCard', 'egRaster', sn + spindleRasterHtml(summary, truth));
    fill('egAbsenceCard', 'egAbsence', sn + absenceHtml(summary));
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

  /* ── THE FORMULA HYPNOGRAM ─────────────────────────────────────────────────────────────────────
     The second stage source's own strip, drawn only when the reader turned the switch on AND a
     model file arrived. It never replaces the strip above, and the two are never merged.

     NOT ONE NUMBER IS PRINTED HERE, and that is the state this PR ships in. The brief's own rule is
     that the screen shows no figure before the three published thresholds each hold a ledger
     citation, and no blind read has judged this port yet. So the surface carries the SHAPE, the
     model's identity and the limits — and the registry grades the series `experimental`, which is one
     rank above `heuristic`, the lowest tier the ladder holds (@kestrel, #8464 rule 5 and #8668).

     THE COLUMN HEIGHTS ARE BORROWED FOR DRAWING ONLY. The formula names four classes and the strip
     above names five stages, so this figure reuses the five-stage ladder's heights to place four
     classes and the note says so. A borrowed height is a drawing choice; it claims no equivalence
     between `light` and N2, and the class name in every hover is the formula's own.

     §∅ — an epoch the evaluator refused is HATCHED, exactly as an unscored epoch is above, and the
     reason it carries is the evaluator's own. */
  /* The file the reader must supply, named on the surface for a reader who holds only the page. */
  var MODEL_FILE_NAME = 'eeg-stage-model-two-pass-2026-11-24.json';
  var MODEL_FILE_SHA16 = '27d0114dd8c5b43e';
  var MODEL_FILE_ALT = 'eeg-stage-model-base-2026-11-17.json';
  var MODEL_FILE_ALT_SHA16 = '500f1a71f6ca3e18';
  var FORMULA_DRAW = { wake: 'eg-ep-w', light: 'eg-ep-n2', deep: 'eg-ep-n3', REM: 'eg-ep-rem' };

  function formulaHtml(f) {
    if (!f) return '';
    if (f.err) {
      /* A refusal is the surface. It names what is absent, and it draws no strip: §∅ — a figure over
         an absence would read as a night that scored badly rather than one nothing scored. */
      return (
        row('Formula hypnogram', 'no series', 'the formula refused') +
        '<p class="chart-note">' +
        esc('The stage formula scored nothing: ' + f.err + '. The hypnogram above is this node’s own stager and it stands on its own.') +
        '</p>' +
        /* A READER WITH ONLY THE PAGE HOLDS NO MODEL FILE (@kestrel, #8668). The page carries no
           coefficients, so the text names the file to look for and the bytes that identify it. */
        (/no model file/.test(f.err)
          ? '<p class="chart-note">' +
            esc(
              'Two files in the root of this repository fit it. ' +
                MODEL_FILE_NAME +
                ' (first 16 hash characters ' +
                MODEL_FILE_SHA16 +
                ') scores two passes and needs the whole night. ' +
                MODEL_FILE_ALT +
                ' (' +
                MODEL_FILE_ALT_SHA16 +
                ') scores one pass and takes a shorter import. Drop one of them where you dropped the recording.'
            ) +
            '</p>'
          : '')
      );
    }
    var eps = (f.epochs || []).length,
      cols = '',
      legend = '',
      i,
      e,
      st,
      seen = {},
      keys = ['wake', 'light', 'deep', 'REM'];
    if (!eps) return row('Formula hypnogram', 'no epochs', 'the night holds none');
    for (i = 0; i < eps; i++) {
      e = f.epochs[i];
      st = e.stage;
      if (st != null) seen[st] = true;
      cols +=
        '<div class="eg-ep ' +
        (st == null ? 'eg-ep-nul' : FORMULA_DRAW[st] || 'eg-ep-nul') +
        '" title="' +
        esc('epoch ' + i + ' · ' + (st == null ? 'not scored — ' + (e.reason || 'no reason given') : st)) +
        '"></div>';
    }
    for (i = 0; i < keys.length; i++) {
      /* The legend carries the CLASS NAMES and no count, because a count is a number. A class the
         night never reads is still listed, so an absent class is visible as an absence. */
      legend +=
        '<span class="eg-lg"><span class="eg-dot" style="background:' +
        STAGE_COLOR[{ wake: 'W', light: 'N2', deep: 'N3', REM: 'REM' }[keys[i]]] +
        '"></span>' +
        esc(keys[i] + (seen[keys[i]] ? '' : ' (none)')) +
        '</span>';
    }
    legend += '<span class="eg-lg"><span class="eg-dot eg-ep-nul"></span>not scored</span>';
    return (
      row('Formula hypnogram', 'a second stage source', 'off unless you turn it on') +
      '<div class="eg-hyp">' +
      cols +
      '</div><div class="eg-legend">' +
      legend +
      '</div>' +
      '<p class="chart-note">' +
      esc(
        'Model ' +
          (f.id || 'unnamed') +
          (f.modelSha16 ? ' · file ' + f.modelSha16 : '') +
          '. The column heights come from the five-stage ladder above and place four classes, so a height names no stage of that ladder; the hover carries the class the formula named.'
      ) +
      '</p>' +
      '<p class="chart-note">' +
      esc(
        'What this series is not: the coefficients were fitted on sleep-laboratory derivations and a small number of forehead recordings; a frontal derivation recognises deep sleep less well than a central one; the formula scores after the night and never during it; a model of two passes reads up to 160 epochs away, so it needs the whole night and it refuses a shorter import by name; a hatched column is an epoch it refused, and it carries the reason the evaluator gave. It is a research aid and not a diagnosis, and no figure stands beside it until a blind read of this port holds a citation.'
      ) +
      '</p>'
    );
  }

  /* THE DOM WRITE LIVES HERE, beside every other write of this node. `formulaHtml` escapes each
     value it interpolates, and the assembled markup then goes out through the one `setHTML` helper
     the node already uses — a write in the app shell would be a second, unescapable sink. */
  function renderFormula(card, title, f) {
    if (!card || !title) return;
    if (!f) {
      setHTML(card, '');
      card.style.display = 'none';
      title.style.display = 'none';
      return;
    }
    setHTML(card, formulaHtml(f));
    card.style.display = '';
    title.style.display = '';
  }

  global.EEGUI = {
    synthNote: synthNote,
    renderSummary: renderSummary,
    hypnoHtml: hypnoHtml,
    formulaHtml: formulaHtml,
    renderFormula: renderFormula,
    FORMULA_DRAW: FORMULA_DRAW,
    archHtml: archHtml,
    bandHtml: bandHtml,
    qualityHtml: qualityHtml,
    spectroHtml: spectroHtml,
    bandSeriesHtml: bandSeriesHtml,
    swaHtml: swaHtml,
    spindleRasterHtml: spindleRasterHtml,
    absenceHtml: absenceHtml,
    absenceLegend: absenceLegend,
    buckets: buckets,
    meanOf: meanOf,
    pathOf: pathOf,
    powerSub: powerSub,
    ARCH_ROWS: ARCH_ROWS,
    ABSENCE_WHY: ABSENCE_WHY,
    SPEC_LEVELS: SPEC_LEVELS,
    SPEC_COLS: SPEC_COLS,
    MAX_COLS: MAX_COLS
  };
})(window);

// ESM-from-birth dual-mode (mirrors motiondex-render): the IIFE attaches window.EEGUI for the
// classic co-load consumers; this re-export lets the owned ESM bundle's eegdex-app.js import it.
export const EEGUI = window.EEGUI;
