/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · METRIC REGISTRY DATA  (cpapdex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   The per-node DATA map for the System-Cohesion layer (SYSTEM-COHESION-BRIEF
   §1 + §3) — the exact sibling of oxydex-registry.js. LOCAL to CPAPDex (the
   SHARED badge/legend/tier/persistence logic lives in metric-registry.js).

   Each entry carries label/unit/goodDirection PLUS the two cohesion axes:
     • depth    ∈ basic | advanced | research          → disclosure tiering
     • evidence ∈ measured | validated | emerging | experimental | heuristic
     • cite     → short provenance (hover).

   Evidence taxonomy for CPAPDex (CPAPDEX-KICKOFF Step 3):
     measured     : device-scored EVE/CSL event indices (the AirSense's own
                    firmware scoring is the ground truth this node INGESTS, not
                    computes) + direct PLD channel stats (pressure, leak, EPR,
                    resp-rate, tidal volume, snore) + SA2 raw oximetry stats.
     validated    : externally-validated derived metrics — CMS compliance, the
                    24 L/min large-leak quality threshold, flow-derived breath
                    rate, AASM ODI/T90 on the oximetry lane.
     emerging     : flow-limitation index, I:E ratio (device/method-dependent).
     experimental : node composites — leak CV, minute-ventilation stability,
                    snore↔pressure correlation.

   PHASE-9 EMIT / FRAME-SHAPE (SIGNAL-ADAPTER-PHASE9 node 4/4 · decision owned by
   GENERIC-EMIT-GATE-FOLLOWUPS-I §1 — recorded here so the next coder doesn't assume
   the FRAME is event-bearing): a `SignalFrame` has no event carrier, but CPAPDex's
   headline value is the device-scored EVE/CSL events above (graded `measured`). So
   the canonical `cpap` SignalFrame (signal-spec.js) carries the 25 Hz BRP FLOW
   waveform in `samples` (so it validates) and the decoded multi-signal set(s) —
   incl. the EVE/CSL annotations — ride as a `frame.edfSets` SIDECAR (the ECG
   deviceRR/ACC pattern). CPAPDex.compute (cpapdex-dsp.js) reads the sidecar →
   buildNight → CpapFusion.cpapBuildExport (ONE event source; byte-identical to the
   app's exportNight). EDF is BINARY + multi-file, so CPAPDex has NO text-stream
   adapter (the readAsText host boundary can't carry it — the app owns binary
   ingest); it goes emittable via SignalOrchestrate.canEmit('cpap') + the generic-
   emit gate's DRIVER-2 provider, not a DRIVER-1 adapter. The EXPORT itself IS
   event-bearing (ganglior_events) — only the INGEST frame is flow+sidecar.
   Load AFTER metric-registry.js, BEFORE cpapdex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CPAP_REGISTRY = {
    /* ── USAGE & ADHERENCE ──────────────────────────────────────────────── */
    usageHours: { label: 'Usage Hours', unit: 'hr', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Total mask-on hours (pressure > 0) — direct recording stat' },
    compliancePct: {
      label: '30-Day Compliance',
      unit: '%',
      goodDirection: 'up',
      depth: 'basic',
      evidence: 'validated',
      cite: 'Nights ≥4 h / 30 d. CMS PAP adherence: ≥4 h on ≥70% of nights across any 90-day window'
    },
    maskOnLatency: { label: 'Mask-On Latency', unit: 'min', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Time to first delivered pressure — direct' },

    /* ── PRESSURE PROFILE ───────────────────────────────────────────────── */
    medianPressure: { label: 'Median Pressure', unit: 'cmH₂O', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'P50 of delivered pressure (mask-on) — direct PLD channel' },
    p95Pressure: { label: '95th-%ile Pressure', unit: 'cmH₂O', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'P95 delivered pressure — direct PLD channel' },
    pressureRange: {
      label: 'Pressure Range',
      unit: 'cmH₂O',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      // NOT "auto-titration spread" — that read is retired (CPAP-REAL-CORPUS §F2). This
      // IQR is dominated by EPR's per-breath expiratory dips, so it does NOT isolate
      // auto-titration; pressureEnvIqr does.
      cite: 'IQR (P75−P25) of delivered pressure — includes EPR breath-to-breath swing'
    },
    pressureEnvIqr: {
      label: 'Pressure Envelope',
      unit: 'cmH₂O',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'measured',
      cite: 'IQR across 5-min P90 windows of delivered pressure — the EPR-immune, minutes-scale spread the CPAP-vs-APAP mode call is made on (CPAP-REAL-CORPUS §F2)'
    },
    eprDelta: { label: 'EPR Delta', unit: 'cmH₂O', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Median (Press − EprPress) — expiratory pressure relief depth' },
    epap95: {
      label: '95th-%ile EPAP',
      unit: 'cmH₂O',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'measured',
      cite: 'P95 expiratory pressure — dedicated EPAP lane on bilevel/BiPAP, else the EPR-relieved expiratory pressure (ready for machines without EPR)'
    },

    /* ── RESIDUAL EVENTS (device-scored EVE/CSL = ground truth) ─────────── */
    residualAHI: {
      label: 'Residual AHI',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'measured',
      cite: '(OA+CA+H)/usage h — AirSense firmware-scored EVE. Machine-scored, may undercount vs manual PSG; target <5 on therapy'
    },
    centralIndex: {
      label: 'Central Apnea Index',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'measured',
      cite: 'CA/usage h — device-scored. Elevated on CPAP may signal treatment-emergent central apnea (TECA); >5 warrants review / ASV eval'
    },
    obstructiveIndex: { label: 'Obstructive Index', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'OA/usage h — device-scored EVE' },
    hypopneaIndex: { label: 'Hypopnea Index', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'H/usage h — device-scored EVE' },
    reraIndex: {
      label: 'RERA Index',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'measured',
      cite: 'RERA/usage h — device-scored EVE (softer scoring). Estimated from flow-limitation shape; not all machines report it'
    },
    periodicBreathingPct: { label: 'Periodic Breathing', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: '% therapy in CSL Cheyne-Stokes/PB spans — device-scored' },

    /* ── LEAK DYNAMICS ──────────────────────────────────────────────────── */
    medianLeak: {
      label: 'Median Leak',
      unit: 'L/min',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'measured',
      cite: 'P50 mask leak (mask-on), L/s→L/min. Intentional vent leak (mask-dependent, ~20–40 L/min) is excluded by ResMed before reporting'
    },
    p95Leak: { label: '95th-%ile Leak', unit: 'L/min', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'P95 mask leak — direct PLD channel' },
    maxLeak: { label: 'Max Leak', unit: 'L/min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Peak mask leak — direct PLD channel' },
    largeLeakPct: {
      label: 'Large Leak %',
      unit: '%',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'validated',
      cite: '% therapy > 24 L/min (ResMed large-leak threshold). Above this, events are not reliably scored — residual AHI becomes untrustworthy'
    },
    leakCV: { label: 'Leak CV', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'SD/mean of leak — internal seal-stability composite' },

    /* ── VENTILATION ────────────────────────────────────────────────────── */
    respRateMedian: { label: 'Resp Rate', unit: '/min', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'P50 device respiratory rate — direct PLD channel' },
    respRateRange: { label: 'Resp Rate Range', unit: '/min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'IQR of device respiratory rate' },
    tidVolMedian: { label: 'Tidal Volume', unit: 'L', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'P50 device tidal volume — direct PLD channel' },
    minVentMedian: { label: 'Minute Ventilation', unit: 'L/min', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'P50 device minute ventilation — direct PLD channel' },
    minVentStability: {
      label: 'MinVent Stability',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'CV of minute ventilation — internal ventilation-stability composite'
    },

    /* ── FLOW LIMITATION & SNORE ────────────────────────────────────────── */
    flowLimMean: { label: 'Flow Limitation', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Mean device flow-limitation index — device-derived, less standardized' },
    flowLimitedPct: { label: 'Flow-Limited %', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: '% therapy with flow-limitation > 0.3 — device-derived' },
    snorePct: { label: 'Snore %', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: '% therapy with device snore index > 0.2 — direct PLD channel' },
    snorePressureCorr: {
      label: 'Snore↔Pressure',
      unit: 'r',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Pearson(snore, pressure) — internal pressure-adequacy composite'
    },

    /* ── FLOW-DERIVED BREATH DETECTION (CPAPDex computes from 25 Hz BRP) ─── */
    breathCount: { label: 'Breath Count', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Zero-crossing breaths on detrended 25 Hz flow' },
    breathRate: { label: 'Breath Rate', unit: '/min', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Flow-derived breath rate — cross-checks device resp rate' },
    ieRatio: { label: 'I:E Ratio', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Inspiratory/expiratory flow-time ratio — method-dependent' },

    /* ── OXIMETRY QC LANE (SA2 — only when oximeter connected) ──────────── */
    odi: { label: 'ODI', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'AASM 3% oxygen-desaturation index (self-gated) — SA2 lane' },
    t90Pct: { label: 'T90', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: '% valid SpO₂ samples below 90% — SA2 lane' },
    spo2Nadir: { label: 'SpO₂ Nadir', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Lowest valid SpO₂ — direct SA2 reading' },
    spo2Mean: { label: 'Mean SpO₂', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Mean valid SpO₂ — direct SA2 reading' },
    pulseMedian: { label: 'Pulse', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Median in-band pulse — direct SA2 reading' },
    pulseRange: { label: 'Pulse Range', unit: 'bpm', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'P95−P5 of in-band pulse — direct SA2 reading' }
  };

  /* ── Alias map: UI label (as rendered) → registry id ──────────────────────
   Covers the manifest "name" strings, the short KPI/chip labels, and unit-
   stripped variants so the render helpers resolve a badge from the existing
   label with zero call-site churn (Preservation Rule). */
  var CPAP_LABEL_ALIAS = {
    'usage hours': 'usageHours',
    usage: 'usageHours',
    'mask-on hours': 'usageHours',
    '30-day compliance': 'compliancePct',
    '30-day compliance %': 'compliancePct',
    compliance: 'compliancePct',
    'compliance %': 'compliancePct',
    'mask-on latency': 'maskOnLatency',
    latency: 'maskOnLatency',
    'median pressure': 'medianPressure',
    pressure: 'medianPressure',
    'p50 pressure': 'medianPressure',
    'median p': 'medianPressure',
    '95th-%ile pressure': 'p95Pressure',
    '95th-percentile pressure': 'p95Pressure',
    'p95 pressure': 'p95Pressure',
    p95: 'p95Pressure',
    'pressure range': 'pressureRange',
    'pressure range (iqr)': 'pressureRange',
    'p-range': 'pressureRange',
    'pressure envelope': 'pressureEnvIqr',
    'pressure envelope (iqr)': 'pressureEnvIqr',
    'p-envelope': 'pressureEnvIqr',
    'epr delta': 'eprDelta',
    epr: 'eprDelta',
    'epr Δ': 'eprDelta',
    '95th-%ile epap': 'epap95',
    '95th-percentile epap': 'epap95',
    epap95: 'epap95',
    epap: 'epap95',
    'p95 epap': 'epap95',
    'expiratory pressure': 'epap95',
    'residual ahi': 'residualAHI',
    ahi: 'residualAHI',
    'central apnea index': 'centralIndex',
    'central index': 'centralIndex',
    cai: 'centralIndex',
    'obstructive index': 'obstructiveIndex',
    'obstructive apnea index': 'obstructiveIndex',
    oai: 'obstructiveIndex',
    'hypopnea index': 'hypopneaIndex',
    hi: 'hypopneaIndex',
    'rera index': 'reraIndex',
    rera: 'reraIndex',
    'periodic breathing': 'periodicBreathingPct',
    'periodic breathing %': 'periodicBreathingPct',
    'pb %': 'periodicBreathingPct',
    pb: 'periodicBreathingPct',
    'median leak': 'medianLeak',
    'median leak rate': 'medianLeak',
    leak: 'medianLeak',
    '95th-%ile leak': 'p95Leak',
    '95th-percentile leak': 'p95Leak',
    'p95 leak': 'p95Leak',
    'max leak': 'maxLeak',
    'large leak %': 'largeLeakPct',
    'large leak': 'largeLeakPct',
    'll%': 'largeLeakPct',
    'leak cv': 'leakCV',
    'leak coefficient of variation': 'leakCV',
    'resp rate': 'respRateMedian',
    'respiratory rate': 'respRateMedian',
    rr: 'respRateMedian',
    'resp rate range': 'respRateRange',
    'tidal volume': 'tidVolMedian',
    'tid vol': 'tidVolMedian',
    tv: 'tidVolMedian',
    'minute ventilation': 'minVentMedian',
    'min vent': 'minVentMedian',
    mv: 'minVentMedian',
    'minvent stability': 'minVentStability',
    'ventilation stability': 'minVentStability',
    'flow limitation': 'flowLimMean',
    'flow lim': 'flowLimMean',
    fl: 'flowLimMean',
    'flow-limited %': 'flowLimitedPct',
    'flow limited %': 'flowLimitedPct',
    'snore %': 'snorePct',
    snore: 'snorePct',
    'snore↔pressure': 'snorePressureCorr',
    'snore-pressure': 'snorePressureCorr',
    'breath count': 'breathCount',
    'breath rate': 'breathRate',
    'breaths/min': 'breathRate',
    'i:e ratio': 'ieRatio',
    'ie ratio': 'ieRatio',
    'i:e': 'ieRatio',
    odi: 'odi',
    'odi-3': 'odi',
    t90: 't90Pct',
    't90%': 't90Pct',
    't<90%': 't90Pct',
    'spo₂ nadir': 'spo2Nadir',
    'spo2 nadir': 'spo2Nadir',
    'min spo₂': 'spo2Nadir',
    'min o₂': 'spo2Nadir',
    'mean spo₂': 'spo2Mean',
    'mean spo2': 'spo2Mean',
    'spo₂': 'spo2Mean',
    spo2: 'spo2Mean',
    pulse: 'pulseMedian',
    'pulse rate': 'pulseMedian',
    hr: 'pulseMedian',
    'pulse range': 'pulseRange'
  };

  function _norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function idForLabel(label) {
    var k = _norm(label);
    if (CPAP_REGISTRY[k]) return k;
    return CPAP_LABEL_ALIAS[k] || null;
  }

  /* Pure metadata labels (not metrics) — never badge these, even with fallback. */
  var _META_DENY = { date: 1, start: 1, end: 1, source: 1, 'sample rate': 1, recording: 1, 'active flags': 1, mode: 1, session: 1, sessions: 1, device: 1, serial: 1 };

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — the zero-touch
   hook the render helpers call to place an evidence dot IMMEDIATELY BEFORE any label
   (CLAUDE.md coverage mandate: inline .ev sits before the label).
   fallback=true gives an unknown label a hollow EXPERIMENTAL badge (cohesion
   "no entry ⇒ visible experimental" rule), so nothing is silently unbadged. */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(CPAP_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  /* evBadge(id) → badge straight from a registry id (render call-sites that know the id). */
  function evBadge(id) {
    if (!global.MetricRegistry || !id) return '';
    var d = global.MetricRegistry.entry(CPAP_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(CPAP_REGISTRY, id).depth : null;
  }

  /* ── Clinical context ported from the docs draft (manifest is canonical for the
   metric SET; this is prose only) ───────────────────────────────────────────
   WARNING surfaces near the AHI read; GLOSSARY backs abbreviation tooltips. */
  var CPAP_WARNING =
    'CPAP machine-reported events are scored by proprietary firmware algorithms and may differ from manual scoring. AHI values from CPAP logs are not equivalent to attended polysomnography.';

  var CPAP_GLOSSARY = {
    AHI: 'Apnea–Hypopnea Index',
    APAP: 'Automatic Positive Airway Pressure',
    ASV: 'Adaptive Servo-Ventilation',
    BiPAP: 'Bilevel Positive Airway Pressure',
    BR: 'Respiratory Rate',
    CAI: 'Central Apnea Index',
    CMS: 'Centers for Medicare & Medicaid Services',
    CPAP: 'Continuous Positive Airway Pressure',
    CV: 'Coefficient of Variation',
    EPAP: 'Expiratory Positive Airway Pressure',
    EPR: 'Expiratory Pressure Relief',
    FLI: 'Flow Limitation Index',
    HI: 'Hypopnea Index',
    IQR: 'Interquartile Range',
    'I:E': 'Inspiratory:Expiratory ratio',
    OAI: 'Obstructive Apnea Index',
    ODI: 'Oxygen Desaturation Index',
    OLS: 'Ordinary Least Squares',
    PAP: 'Positive Airway Pressure',
    PB: 'Periodic Breathing',
    RERA: 'Respiratory Effort–Related Arousal',
    SD: 'Standard Deviation',
    T90: '% of time with SpO₂ below 90%',
    TECA: 'Treatment-Emergent Central Apnea',
    UARS: 'Upper Airway Resistance Syndrome'
  };

  function glossary(abbr) {
    return CPAP_GLOSSARY[abbr] || CPAP_GLOSSARY[String(abbr || '').toUpperCase()] || null;
  }

  global.CPAP_REGISTRY = CPAP_REGISTRY;
  global.CpapRegistry = {
    REGISTRY: CPAP_REGISTRY,
    ALIAS: CPAP_LABEL_ALIAS,
    WARNING: CPAP_WARNING,
    GLOSSARY: CPAP_GLOSSARY,
    glossary: glossary,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    evBadge: evBadge,
    depthForLabel: depthForLabel
  };
})(window);
