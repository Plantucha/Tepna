/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   OxyDex · METRIC REGISTRY DATA  (oxydex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   The per-node DATA map for the System-Cohesion layer (SYSTEM-COHESION-BRIEF
   §1 + §3). LOCAL to OxyDex — declared here, not imported (same shared-logic /
   local-data split as crossnight-envelope.js ↔ OXY_DEFS). The SHARED logic
   (badge/legend/tier/persistence) lives in metric-registry.js.

   Each entry carries the SAME label/unit/goodDirection the crossnight envelope
   already uses (so the registry is the single source feeding both screen and
   envelope) PLUS the two new cohesion axes:
     • depth    ∈ basic | advanced | research   → disclosure tiering
     • evidence ∈ validated | emerging | experimental | heuristic → epistemic badge
     • cite     → short provenance (literature ref OR "internal composite"); hover.

   Evidence taxonomy (brief §3, OxyDex assignments):
     measured    : raw sensor stats — meanSpo2, minSpo2, meanHr/minHr/maxHr, spo2Nadir, duration, motion
     validated   : odi4, odi3, t90, t95, desatProfile… (validated DERIVED metrics)
     emerging    : cvhrIndex/ahiEst, sleepEff (motion), spo2Drift
     experimental: nsi, sleepStability, hd94, hypoxicBurden (fixed-94% AUC), the research:{} dump
     heuristic   : vo2est  (ansAge + bpProj REMOVED 2026-06-21, review WP-A)
   Load AFTER metric-registry.js, BEFORE oxydex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* keep label/unit/goodDirection identical to oxydex-cross.js OXY_DEFS so the
   registry and the self-describing envelope never diverge. */
  var OXY_REGISTRY = {
    /* ── VALIDATED — established, externally validated, clinically meaningful ── */
    odi4: {
      label: 'ODI-4',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'validated',
      cite: 'AASM 4% oxygen desaturation index. Caveat: still modestly UNDER-counts AHI on severe nights (dense desaturations sag the detection baseline; truth-AHI ≈ 1.4× ODI-4) even after the v22.36 ceiling-baseline correction — read low ODI-4 on a clinically severe night with care'
    },
    odi3: { label: 'ODI-3', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'AASM 3% oxygen desaturation index' },
    meanSpo2: { label: 'Mean SpO₂', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Nocturnal mean oxygen saturation — direct oximeter reading' },
    minSpo2: { label: 'Min SpO₂', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Lowest recorded SpO₂ (nadir) — direct oximeter reading' },
    t90: { label: 'T90', unit: '%', goodDirection: 'down', depth: 'basic', evidence: 'validated', cite: '% recording below 90% SpO₂ — sleep-apnoea severity marker' },
    t95: { label: 'T95% Time', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: '% recording below 95% SpO₂' },
    t88: { label: 'T88 Time', unit: 'min', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Minutes below 88% SpO₂ — CMS supplemental-O₂ threshold' },
    hypoxicBurden: { label: 'Hypoxic burden', unit: '%·min/h', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Internal fixed-94% AUC — Σ(94−SpO₂)/60/hr, a whole-night integral below a flat 94% line (computeHypoxicBurden). NOT Azarbarzin 2019: that sleep-apnoea-specific hypoxic burden is event/baseline-referenced and is implemented separately as Hypoxic Load (computeHypoxicLoad). Sibling of the fixed-94 HD94 (hd94) and tiered to match it. FINDING 8: retiered from a false validated/Azarbarzin badge — a validated tier requires a citation matching the method (literature-use policy §2).' },
    desatProfile: { label: 'Desat profile', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Area/depth/duration of desaturation events' },
    meanHr: { label: 'Mean HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Mean nocturnal heart rate — direct pulse reading' },
    meanPi: {
      label: 'Perfusion Idx',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Mean perfusion index — direct O2Ring live-header reading (byte [7]÷10); present only on Health-Box OXYFRAME captures, absent on the ViHealth CSV export (OXYDEX-PULSE-RESOURCING §4)'
    },
    minHr: { label: 'Min HR', unit: 'bpm', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Lowest nocturnal heart rate — direct pulse reading' },
    maxHr: { label: 'Max HR', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Highest nocturnal heart rate — direct pulse reading' },

    /* ── EMERGING — published, less standardized / device-dependent ─────────── */
    ahiEst: { label: 'CVHR / AHI est', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'CVHR-derived AHI estimate — oximetry surrogate, not PSG' },
    cvhrIndex: { label: 'CVHR index', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Cyclical-variation-of-HR index (Hayano)' },
    sleepEff: { label: 'Sleep Eff', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Motion-derived sleep efficiency — actigraphy proxy, not EEG' },
    spo2Drift: { label: 'SpO₂ drift', unit: '%/night', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: '7-day rolling chronic-drift indicator' },
    hrSpikes: { label: 'HR Spikes', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Autonomic-arousal surrogate from HR rises' },

    /* ── EXPERIMENTAL — plausible node composite, not externally validated ──── */
    nsi: { label: 'NSI', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Nocturnal Stress Index — OxyDex composite (dip-rate + AUC-90 + T95 + AAI), internal' },
    sleepStability: { label: 'Sleep stability', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'OxyDex sleep-stability score — internal composite' },
    sbii: {
      label: 'SBII',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Sleep-breathing instability index — Σ(D²·T)/TRT, SHHS-calibrated quintiles; best oximetry predictor of CVD mortality (Hui 2024, Respirology 29:825). Oximetry-derived, single-cohort — emerging, not yet consensus-standard'
    },
    pred3p: {
      label: 'pRED-3p',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: '% recording time with ≥3% desaturation events, SHHS-calibrated quintiles; CVD-morbidity predictor (Hui 2024, Respirology 29:825). Oximetry-derived, single-cohort — emerging'
    },
    desSev: {
      label: 'DesSev',
      unit: '%-min/hr',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Area-based desaturation severity, fully automated (Kulkas 2013) — published oximetry index, not yet consensus-standard — emerging'
    },
    /* CT thresholds — raw cumulative time below SpO₂ cut-offs (direct signal integration) */
    ct90: { label: 'CT<90', unit: 'min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Cumulative time SpO₂<90% — direct integration of the recorded signal' },
    ct89: { label: 'CT<89', unit: 'min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Cumulative time SpO₂<89% — direct integration of the recorded signal' },
    ct88: { label: 'CT<88', unit: 'min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Cumulative time SpO₂<88% — direct integration of the recorded signal' },
    ct85: { label: 'CT<85', unit: 'min', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Cumulative time SpO₂<85% — direct integration of the recorded signal' },
    odri: { label: 'ODRI', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Oxygen-desaturation resaturation index — internal composite' },
    spo2Skew: { label: 'SpO₂ Skew', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Distribution skew of SpO₂ — internal shape metric' },
    hd94: { label: 'HD94/hr', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Hypoxic-dose rate below 94% — internal composite' },

    /* ── HEURISTIC — convenience estimate / population proxy ────────────────── */
    /* ANS age + BP projection REMOVED 2026-06-21 (external-review WP-A): a
     population regression dressed as a personal age, and cuffless BP from
     oximetry — neither survives its own disclaimer as a surfaced metric. See
     DEX-METRIC-REMOVAL-AUDIT-BRIEF.md. VO₂ retained at research depth only. */
    vo2est: { label: 'VO₂max est', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Nocturnal HR-ratio VO₂max estimate — population proxy, not CPET' },

    /* ── Coverage expansion (2026-06) — the cards/table render ~75 metrics; the
     set below classifies the high-traffic ones so they don't fall through to
     the experimental default. Genuinely internal composites are deliberately
     left to the fallback (= experimental), which is the honest level. ─────── */
    /* measured / recording — validated */
    duration: { label: 'Duration', unit: 'min', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Total recording span — direct' },
    motion: { label: 'Motion', unit: '%', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Accelerometer restless fraction — direct' },
    spo2Nadir: { label: 'SpO₂ Nadir', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Lowest sustained SpO₂ (nadir) — direct oximeter reading' },
    maxSpo2: { label: 'Max SpO₂', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Highest recorded SpO₂ — direct oximeter reading' },
    spo2Std: { label: 'SpO₂ Std Dev', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'SD of nocturnal SpO₂ — signal-stability statistic, direct' },
    /* HR / pulse-variability proxies (1 Hz pulse, NOT RR intervals) — experimental */
    rmssd: { label: 'RMSSD', unit: 'bpm*', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: '1 Hz pulse-rate RMSSD proxy — not RR-interval HRV' },
    hrVarSd: { label: 'HR-Var SD', unit: 'bpm', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'SD of 1 Hz pulse rate — variability proxy (not RR SDNN)' },
    hrFloor: { label: 'HR Floor', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: '5th-percentile nocturnal pulse — resting-tone marker' },
    hrSlope: { label: 'HR Slope', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Overnight HR drift slope' },
    nocDip: { label: 'Noc. Dip', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Nocturnal HR dipping (intra-night)' },
    sd1: { label: 'SD1', unit: 'bpm*', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Poincaré SD1 from 1 Hz pulse — proxy' },
    sd1sd2: { label: 'SD1/SD2', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Poincaré SD1/SD2 ratio — proxy' },
    /* training-zone heuristics from HR */
    readiness: { label: 'Readiness', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'experimental', cite: 'OxyDex recovery-readiness composite — internal' },
    z2win: { label: 'Z2 Window', unit: 'bpm', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Karvonen zone-2 training window — population heuristic' },
    mafHr: { label: 'MAF HR', unit: 'bpm', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Maffetone aerobic ceiling — 180−age heuristic' },
    karvZone: {
      label: 'Training Zone',
      unit: 'bpm',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Karvonen HR training zones (Z1–Z5) — %-HRR population heuristic, not individualized'
    },
    /* motion-derived sleep — emerging */
    sol: { label: 'SOL', unit: 'min', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Sleep-onset latency — motion-derived proxy' },
    waso: { label: 'WASO', unit: 'min', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Wake after sleep onset — motion-derived proxy' },
    oscWindows: { label: 'Osc Windows', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Periodic-breathing oscillation windows' },

    /* ── CROSSNIGHT metric (OXYDEX-CROSSNIGHT -III §1) — PB BURDEN as a rate (oscillation episodes
     per hour), trended night-to-night by the Integrator Longitudinal view. DISTINCT from
     `periodicBreathing` below: that one grades a single emitted episode EVENT, this one grades the
     per-night RATE. Same derived-SpO₂-oscillation provenance, so the same EXPERIMENTAL tier — never
     `measured`. Registry entry added by the REGISTRY-PROJECTION Phase-2 residue pass: OXY_DEFS.pbIndex
     had no registry counterpart, so its longitudinal badge fell to the experimental FALLBACK rather
     than a graded lookup, and `registry-defs-parity` could only ⊘ SKIP it. ───────────────────────── */
    pbIndex: {
      label: 'PB Index',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Periodic-breathing oscillation episodes per hour — derived SpO₂-oscillation signature, not an airflow-scored event'
    },

    /* ── EVENT-STREAM metric (OXYDEX-NODE-EXPORT-ENVELOPE §2b) — the tier the Integrator/render
     resolve for an emitted periodic_breathing ganglior_event. A PB/Cheyne-Stokes episode is a
     DERIVED SpO₂-oscillation signature across many breaths (not a single scored respiratory event),
     so it sits at EXPERIMENTAL — below a scored desaturation (odi4 validated / odi3 emerging) but
     still real signal. NEVER `measured` (OxyDex infers respiration from an SpO₂ proxy). ─────────── */
    periodicBreathing: {
      label: 'Periodic breathing',
      unit: '',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Periodic-breathing / Cheyne-Stokes oscillation episode — derived SpO₂ oscillation signature, not an airflow-scored event'
    }
  };

  /* ── Alias map: UI label (as rendered today) → registry id ─────────────────
   Lets the render helpers resolve a badge from the EXISTING label string with
   zero call-site churn (Preservation Rule). Match is case/space-insensitive on
   the normalized label; aliases cover UI variants ("ODI-4 Rate" → odi4). */
  var OXY_LABEL_ALIAS = {
    'odi-4': 'odi4',
    'odi-4 rate': 'odi4',
    odi4: 'odi4',
    'odi-3': 'odi3',
    'odi-3 rate': 'odi3',
    'mean spo₂': 'meanSpo2',
    'mean spo2': 'meanSpo2',
    '7d spo₂': 'spo2Drift',
    'spo₂': 'meanSpo2',
    spo2: 'meanSpo2',
    'min spo₂': 'minSpo2',
    'min spo2': 'minSpo2',
    'min o₂': 'minSpo2',
    'min o2': 'minSpo2',
    t90: 't90',
    't90% time': 't90',
    't90 time': 't90',
    't<90%': 't90',
    't<90': 't90',
    't90 (time <90%)': 't90',
    't95% time': 't95',
    t95: 't95',
    't95% time below': 't95',
    't95 (time <95%)': 't95',
    't88 time': 't88',
    t88: 't88',
    'hypoxic burden': 'hypoxicBurden',
    'hypoxic burden rate': 'hypoxicBurden',
    'hd94/hr': 'hd94',
    'mean hr': 'meanHr',
    'min hr': 'minHr',
    'max hr': 'maxHr',
    'hr spikes': 'hrSpikes',
    nsi: 'nsi',
    'sleep eff': 'sleepEff',
    'sleep efficiency': 'sleepEff',
    odri: 'odri',
    'spo₂ skew': 'spo2Skew',
    'spo2 skew': 'spo2Skew',
    sbii: 'sbii',
    'sbii quintile': 'sbii',
    'pred-3p': 'pred3p',
    'pred 3p': 'pred3p',
    pred: 'pred3p',
    'pred quintile': 'pred3p',
    dessev: 'desSev',
    'ct<90': 'ct90',
    'ct<89': 'ct89',
    'ct<88': 'ct88',
    'ct<85': 'ct85',
    'training zone': 'karvZone',
    'sleep stability': 'sleepStability',
    'vo₂max est': 'vo2est',
    'vo2max est': 'vo2est',
    'vo₂max estimate': 'vo2est',
    'vo2max estimate': 'vo2est',
    'cvhr index': 'cvhrIndex',
    'cvhr / ahi est': 'ahiEst',
    /* coverage expansion */
    duration: 'duration',
    motion: 'motion',
    'spo₂ nadir': 'spo2Nadir',
    'spo2 nadir': 'spo2Nadir',
    'max spo₂': 'maxSpo2',
    'max spo2': 'maxSpo2',
    'spo₂ std dev': 'spo2Std',
    'spo2 std dev': 'spo2Std',
    'spo₂ std': 'spo2Std',
    'spo2 std': 'spo2Std',
    sleep: 'duration',
    rmssd: 'rmssd',
    'hr-var sd': 'hrVarSd',
    'hr-var proxy': 'hrVarSd',
    'hr floor': 'hrFloor',
    'hr floor (p5)': 'hrFloor',
    'hr slope': 'hrSlope',
    'noc. dip': 'nocDip',
    'noc dip': 'nocDip',
    sd1: 'sd1',
    'sd1/sd2': 'sd1sd2',
    readiness: 'readiness',
    'recovery readiness': 'readiness',
    'z2 window': 'z2win',
    'maf hr': 'mafHr',
    'training zones': 'karvZone',
    sol: 'sol',
    waso: 'waso',
    'waso %': 'waso',
    'osc windows': 'oscWindows',
    'oscillation windows': 'oscWindows',
    /* event-stream impulse label → grade (OXYDEX-NODE-EXPORT-ENVELOPE §2b) */
    'periodic breathing': 'periodicBreathing',
    periodic_breathing: 'periodicBreathing',
    /* night-row chip + center-KPI short labels */
    z2: 'z2win',
    'hr⌊': 'hrFloor',
    'hr-var': 'hrVarSd',
    hrsl: 'hrSlope',
    sleepeff: 'sleepEff',
    ahi: 'ahiEst'
  };

  function _norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/<[^>]*>/g, '') // strip any embedded HTML
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* idForLabel(label) → registry id | null (used by render helpers) */
  function idForLabel(label) {
    var k = _norm(label);
    if (OXY_REGISTRY[k]) return k; // already an id
    return OXY_LABEL_ALIAS[k] || null;
  }

  /* Pure metadata labels (not metrics) — never badge these even with fallback. */
  var _META_DENY = { date: 1, start: 1, end: 1, source: 1, 'sample rate': 1, recording: 1, 'active flags': 1 };

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — the zero-touch
   hook the render helpers call to place an evidence dot IMMEDIATELY BEFORE any label
   (CLAUDE.md coverage mandate: inline .ev sits before the label in dense/crowded text).
   With fallback=true (the render default), a label with no registry entry gets
   a hollow EXPERIMENTAL badge instead of nothing — realizing the cohesion
   brief's "no entry ⇒ visible experimental, forces coverage" rule, so a metric
   is never silently unbadged. Pure metadata (date/start/…) stays unbadged. */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(OXY_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  /* depthForLabel(label) → 'basic'|'advanced'|'research'|null (optional gating) */
  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(OXY_REGISTRY, id).depth : null;
  }

  global.OXY_REGISTRY = OXY_REGISTRY;
  global.OxyRegistry = {
    REGISTRY: OXY_REGISTRY,
    ALIAS: OXY_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel
  };
})(window);
