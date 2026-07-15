/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · METRIC REGISTRY DATA  (ecgdex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (SYSTEM-COHESION-BRIEF §1+§3,
   COHESION-ROLLOUT-BRIEF). LOCAL to ECGDex — the exact clone of oxydex-registry.js:
   the SHARED logic (badge/legend/tier/persistence) lives in metric-registry.js.

   Labels/units/goodDirection mirror ecgdex-cross.js OXY-equivalent _DEFS (METRICS[])
   so the registry and the self-describing crossnight envelope never diverge.

   Evidence taxonomy (brief §3, ECGDex assignments):
     measured     : raw sensor / direct beat statistics — Mean HR, step count, coverage,
                    % analyzable, beat-correction %, signal-quality index, ectopy count
     validated    : established DERIVED HRV/repolarisation — rMSSD, SDNN, ln rMSSD, QTc, SD1, SD2
     emerging     : published, device-dependent — DFA α1, CVHR index, decel. capacity,
                    EDR resp rate, SD1/SD2, CR coupling, LF/HF
     experimental : ECGDex composites — AF screen, HRV stability, RSA efficiency
   Load AFTER metric-registry.js, BEFORE ecgdex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var ECG_REGISTRY = {
    /* ── VALIDATED — established, externally validated DERIVED metrics ──────── */
    rmssd: { label: 'rMSSD', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'RMSSD — short-term parasympathetic HRV (Task Force 1996)' },
    sdnn: { label: 'SDNN', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'SDNN — overall HRV over the analysis window (Task Force 1996)' },
    lnRMSSD: { label: 'ln rMSSD', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'Log-RMSSD — readiness-friendly parasympathetic HRV scale' },
    qtc: { label: 'QTc', unit: 'ms', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Rate-corrected QT (Bazett) — ventricular repolarisation marker' },
    sd1: { label: 'SD1', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD1 — short-term HRV (≈ RMSSD/√2)' },
    sd2: { label: 'SD2', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD2 — long-term HRV dispersion' },

    /* ── MEASURED — direct sensor reading / raw statistic of the signal ─────── */
    hr: { label: 'Mean HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Mean heart rate — direct from detected R-peaks' },
    steps: { label: 'Total steps', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Accelerometer step count — direct' },
    analyzable: { label: '% Analyzable', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Fraction of the recording that is analyzable — direct coverage' },
    coverage: { label: 'Coverage', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'On-body recording coverage — direct' },
    correction: { label: 'Correction', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Beats corrected during cleaning — direct quality statistic' },
    meanSqi: { label: 'Mean SQI', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Mean signal-quality index — direct per-beat quality' },
    ectopy: { label: 'Ectopy', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Detected ectopic-beat count (PVC + PAC) — direct classification' },

    /* ── EMERGING — published, less standardized / device-dependent ─────────── */
    dfaAlpha1: { label: 'DFA α1', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Detrended-fluctuation short-term scaling exponent — device-dependent' },
    cvhrIndex: { label: 'CVHR index', unit: '/h', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Cyclical-variation-of-HR index (Hayano) — oximetry/ECG apnea surrogate' },
    decelCapacity: {
      label: 'Decel. capacity',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Heart-rate deceleration capacity (Bauer 2006) — vagal/mortality marker'
    },
    respRate: { label: 'Resp Rate', unit: 'br/min', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'ECG-derived respiration (EDR) — surrogate, not a flow sensor' },
    sd1sd2: { label: 'SD1/SD2', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Poincaré SD1/SD2 ratio — nonlinear short/long balance' },
    ellArea: {
      label: 'Ellipse area',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Poincaré ellipse area S = π·SD1·SD2 (Brennan 2001) — derived nonlinear HRV descriptor; less standardized than the SD1/SD2 axes, device-dependent'
    },
    crCoupling: { label: 'CR Coupling', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Cardiorespiratory phase-locking value (PLV) — coupling strength' },
    lfhf: { label: 'LF/HF', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'LF:HF power ratio — sympatho-vagal balance proxy' },

    /* ── EMERGING — companion-accelerometer cross-checks (ACC sub-cards) ─────── */
    rraccRate: {
      label: 'ACC Resp Rate',
      unit: 'br/min',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Respiration from chest-axis accelerometer FFT (0.15–0.45 Hz) — device-dependent surrogate'
    },
    edrAgreement: {
      label: 'RRacc–EDR Agreement',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Bland–Altman agreement of ACC-respiration vs ECG-derived respiration — a cross-validation of two surrogate respiration signals'
    },
    edrDisagree: {
      label: 'EDR Disagreement',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: 'Share of paired epochs with |RRacc − EDR| > 3 br/min — an internal rule-of-thumb threshold flag, not a validated agreement statistic (Pearson r / MAE / bias are the agreement stats)'
    },
    stageConsensus: {
      label: 'Stage Consensus',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: 'ACC motion-vote vs HRV+EDR hypnogram agreement — directional cross-check, not validated staging'
    },

    /* ── EXPERIMENTAL — plausible ECGDex composite, not externally validated ── */
    afScreen: { label: 'AF Screen', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Atrial-fibrillation irregularity screen — directional only, not diagnostic' },
    hrvStability: { label: 'HRV Stability', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Overnight ln-RMSSD stability slope — ECGDex composite' },
    rsaEfficiency: { label: 'RSA Efficiency', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Inspiratory:expiratory HR ratio — cardiorespiratory composite' },

    /* ── MEASURED — raw beat statistics / direct morphology & ectopy ───────── */
    beatsNN: { label: 'Beats (NN)', unit: 'beats', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Accepted NN beats after SQI gate — direct count' },
    meanRR: { label: 'Mean RR', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Average NN interval — direct' },
    medianRR: { label: 'Median RR', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: '50th-percentile NN interval — direct' },
    minRR: { label: 'Min RR', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Shortest NN (post-clean) — direct' },
    maxRR: { label: 'Max RR', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Longest NN (post-clean) — direct' },
    nn50: { label: 'NN50', unit: 'count', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Pairs with |ΔNN| > 50 ms — direct count' },
    cv: { label: 'CV', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Coefficient of variation (SDNN/MeanRR) — direct ratio' },
    qrs: { label: 'QRS duration', unit: 'ms', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Ventricular depolarisation width — direct from median beat' },
    qt: { label: 'QT', unit: 'ms', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Q-onset → T-end (tangent) — direct from median beat' },
    pr: { label: 'PR interval', unit: 'ms', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'P-onset → QRS-onset — direct from median beat' },
    stLevel: { label: 'ST level', unit: 'µV', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'ST deviation at J+60 ms vs baseline — direct' },
    rAmp: { label: 'R amplitude', unit: 'µV', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Median-beat R height — direct' },
    tAmp: { label: 'T amplitude', unit: 'µV', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Median-beat T height — direct' },
    pvc: { label: 'PVCs (V)', unit: 'beats', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Ventricular ectopic count — direct beat classification' },
    pac: { label: 'PACs (S)', unit: 'beats', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Supraventricular ectopic count — direct beat classification' },
    couplets: { label: 'Couplets', unit: 'count', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Consecutive PVC pairs — direct count' },
    ventRuns: { label: 'Ventr. runs ≥3', unit: 'count', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: '≥3 consecutive PVCs (NSVT flag) — direct count' },
    bigeminy: { label: 'Bigeminy', unit: 'cycles', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'N-V alternation cycles — direct count' },
    cvhrEvents: { label: 'CVHR events', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Autonomic-surge events emitted — direct count' },

    /* ── VALIDATED — established time/frequency/geometric HRV & repolarisation  */
    pnn50: { label: 'pNN50', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'pNN50 — % successive NN > 50 ms (Task Force 1996)' },
    qtcFrid: { label: 'QTc (Fridericia)', unit: 'ms', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Fridericia rate-corrected QT — less rate-biased than Bazett' },
    hf: { label: 'HF power', unit: 'ms²', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'High-frequency power (0.15–0.4 Hz) — parasympathetic band (Task Force 1996)' },
    lf: { label: 'LF power', unit: 'ms²', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'Low-frequency power (0.04–0.15 Hz) (Task Force 1996)' },
    vlf: { label: 'VLF power', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Very-low-frequency power — resolvable overnight (Task Force 1996)' },
    hfnu: { label: 'HF nu', unit: 'nu', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'HF in normalized units (Task Force 1996)' },
    lfnu: { label: 'LF nu', unit: 'nu', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'LF in normalized units (Task Force 1996)' },
    totalPower: { label: 'Total power', unit: 'ms²', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'Total spectral power — Lomb–Scargle ∫PSD (Task Force 1996)' },
    sdann: { label: 'SDANN', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'SD of 5-min mean-RR over the night (Task Force 1996)' },
    sdnnIdx: { label: 'SDNN index', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Mean of 5-min SDNNs (Task Force 1996)' },
    triIdx: { label: 'Tri index', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'HRV triangular index — geometric (Task Force 1996)' },

    /* ── EMERGING — published nonlinear / coupling, device-dependent ───────── */
    sampen: {
      label: 'SampEn',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Sample entropy (m=2, r=0.2·SD) — ECGDex-tuned application, no published normal band at these settings'
    },
    accelCapacity: { label: 'Accel cap', unit: 'ms', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Heart-rate acceleration capacity (PRSA, Bauer 2006) — sympathetic' },
    pip: { label: 'PIP', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Percentage of inflection points — RR fragmentation (Costa 2017)' },
    rsaAmplitude: { label: 'RSA amplitude', unit: 'bpm', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Peak-to-trough HR swing across the respiratory cycle' },
    crcPLV: { label: 'CRC PLV', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'RR↔respiration phase-locking value — coupling strength' },
    couplingStrength: { label: 'Coupling strength', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'CSI-style cardiorespiratory sync index' },
    edrResp: { label: 'EDR resp rate', unit: 'br/min', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Respiration from R-peak amplitude modulation (EDR) — surrogate' },

    /* ── EXPERIMENTAL — ECGDex composites / single-lead screens ────────────── */
    estAHI: { label: 'Est. AHI', unit: '/h', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'CVHR/CPC apnea proxy from ECG alone — screen-only, not diagnostic' },
    apneaRisk: { label: 'Apnea risk', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'ECG-only apnea-risk category — directional screen' },
    sigmaLnRmssd: { label: 'bσ(ln RMSSD)', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Within-window ln-RMSSD instability slope — ECGDex composite' },
    varLnRmssd: { label: 'bs²(ln RMSSD)', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Within-window ln-RMSSD variance slope — ECGDex composite' },
    surgeEsc: { label: 'Surge escalation', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Overnight CVHR-surge escalation trend — ECGDex composite' },

    /* ── HEURISTIC — population projections / staging estimates ────────────── */
    /* ANS Age REMOVED 2026-06-21 (external-review WP-A). VO₂ + HR-derived sleep
     staging DEMOTED to research depth (never hero/KPI): cardiorespiratory
     staging is not EEG-validated. See DEX-METRIC-REMOVAL-AUDIT-BRIEF.md. */
    hrvScore: { label: 'HRV Score', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'heuristic', cite: 'Autonomic-readiness composite (rMSSD-calibrated) — directional only' },
    restingHR: { label: 'Resting HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'heuristic', cite: 'Nocturnal-floor resting-HR estimate — population-anchored' },
    expRmssd: { label: 'Expected rMSSD', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'heuristic', cite: 'Age-typical rMSSD for comparison — population norm' },
    vo2base: { label: 'VO₂max base', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Uth–Sørensen HRmax/HRrest estimate — population proxy, not CPET' },
    vo2adj: { label: 'VO₂max adj', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'HRV-adjusted VO₂max estimate — population proxy, not CPET' },
    totSleep: { label: 'Total sleep', unit: 'min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Cardiorespiratory sleep estimate — not EEG-validated staging' },
    deepMin: { label: 'Deep', unit: 'min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Estimated deep-sleep minutes — HR-pattern heuristic, not EEG' },
    remMin: { label: 'REM', unit: 'min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Estimated REM minutes — HR-pattern heuristic, not EEG' }
  };

  /* ── Alias map: UI label (as rendered today) → registry id ───────────────── */
  var ECG_LABEL_ALIAS = {
    rmssd: 'rmssd',
    'rmssd (med)': 'rmssd',
    'rmssd (median)': 'rmssd',
    sdnn: 'sdnn',
    'sdnn (med)': 'sdnn',
    'sdnn (median)': 'sdnn',
    'ln rmssd': 'lnRMSSD',
    lnrmssd: 'lnRMSSD',
    'ln(rmssd)': 'lnRMSSD',
    'mean hr': 'hr',
    hr: 'hr',
    'dfa α1': 'dfaAlpha1',
    'dfa a1': 'dfaAlpha1',
    'dfa alpha1': 'dfaAlpha1',
    dfaα1: 'dfaAlpha1',
    qtc: 'qtc',
    'qtc (bazett)': 'qtc',
    'qtc bazett': 'qtc',
    'cvhr index': 'cvhrIndex',
    cvhr: 'cvhrIndex',
    'decel. capacity': 'decelCapacity',
    'decel. cap.': 'decelCapacity',
    'decel capacity': 'decelCapacity',
    'decel cap.': 'decelCapacity',
    'decel cap': 'decelCapacity',
    'resp rate': 'respRate',
    sd1: 'sd1',
    sd2: 'sd2',
    'sd1/sd2': 'sd1sd2',
    'ellipse area': 'ellArea',
    'cr coupling': 'crCoupling',
    'rsa efficiency': 'rsaEfficiency',
    'lf/hf': 'lfhf',
    'beats (nn)': 'beatsNN',
    beats: 'beatsNN',
    'mean rr': 'meanRR',
    'median rr': 'medianRR',
    'min rr': 'minRR',
    'max rr': 'maxRR',
    nn50: 'nn50',
    cv: 'cv',
    'qrs duration': 'qrs',
    qrs: 'qrs',
    qt: 'qt',
    'pr interval': 'pr',
    'st level': 'stLevel',
    'r amplitude': 'rAmp',
    't amplitude': 'tAmp',
    'pvcs (v)': 'pvc',
    'pacs (s)': 'pac',
    couplets: 'couplets',
    'ventr. runs ≥3': 'ventRuns',
    bigeminy: 'bigeminy',
    'cvhr events': 'cvhrEvents',
    pnn50: 'pnn50',
    'qtc (fridericia)': 'qtcFrid',
    'hf power': 'hf',
    'lf power': 'lf',
    'vlf power': 'vlf',
    'hf nu': 'hfnu',
    'lf nu': 'lfnu',
    'total power': 'totalPower',
    sdann: 'sdann',
    'sdnn index': 'sdnnIdx',
    'tri index': 'triIdx',
    sampen: 'sampen',
    'accel cap': 'accelCapacity',
    pip: 'pip',
    'rsa amplitude': 'rsaAmplitude',
    'crc plv': 'crcPLV',
    'coupling strength': 'couplingStrength',
    'edr resp rate': 'edrResp',
    'est. ahi': 'estAHI',
    'apnea risk': 'apneaRisk',
    'bσ(ln rmssd)': 'sigmaLnRmssd',
    'bs²(ln rmssd)': 'varLnRmssd',
    'surge escalation': 'surgeEsc',
    'hrv score': 'hrvScore',
    'resting hr': 'restingHR',
    'rest hr': 'restingHR',
    'expected rmssd': 'expRmssd',
    'vo₂max base': 'vo2base',
    'vo₂max adj': 'vo2adj',
    'vo₂max est': 'vo2adj',
    'total sleep': 'totSleep',
    deep: 'deepMin',
    rem: 'remMin',
    'total steps': 'steps',
    steps: 'steps',
    '% analyzable': 'analyzable',
    analyzable: 'analyzable',
    coverage: 'coverage',
    'beat coverage': 'coverage',
    correction: 'correction',
    'correction rate': 'correction',
    'mean sqi': 'meanSqi',
    ectopy: 'ectopy',
    // ACC companion cross-checks — both the section-card titles and their dense sub-stats
    'acc respiratory rate (rracc)': 'rraccRate',
    'acc resp rate': 'rraccRate',
    rracc: 'rraccRate',
    'rracc vs edr agreement': 'edrAgreement',
    'rracc–edr agreement': 'edrAgreement',
    'pearson r': 'edrAgreement',
    'mae br/min': 'edrAgreement',
    disagreement: 'edrDisagree',
    'mean δ (bias)': 'edrAgreement',
    'sleep-stage consensus (acc motion vote)': 'stageConsensus',
    'stage consensus': 'stageConsensus',
    'staging consensus': 'stageConsensus',
    'af screen': 'afScreen',
    'hrv stability': 'hrvStability'
  };

  function _norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/<[^>]*>/g, '') // strip any embedded HTML
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* idForLabel(label) → registry id | null */
  function idForLabel(label) {
    var k = _norm(label);
    if (ECG_REGISTRY[k]) return k;
    return ECG_LABEL_ALIAS[k] || null;
  }

  /* Pure metadata labels (not metrics) — never badge these even with fallback. */
  var _META_DENY = { date: 1, start: 1, end: 1, source: 1, 'sample rate': 1, recording: 1, 'active flags': 1, tier: 1, duration: 1, scenario: 1, metric: 1, 'vo₂max gt': 1, 'vo2max gt': 1 };

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — resolves a label
   to its registry id → evidence → MetricRegistry.badge, to place an evidence dot
   IMMEDIATELY BEFORE the label (CLAUDE.md coverage mandate). */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var n = _norm(label);
    // section separators ('— Cardiac / HRV —', '— Morphology —') and empty rows never badge
    if (n === '' || n.charAt(0) === '\u2014' || n.charAt(0) === '\u2192') return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[n]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(ECG_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  /* depthForLabel(label) → 'basic'|'advanced'|'research'|null */
  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(ECG_REGISTRY, id).depth : null;
  }

  global.ECG_REGISTRY = ECG_REGISTRY;
  global.EcgRegistry = {
    REGISTRY: ECG_REGISTRY,
    ALIAS: ECG_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel
  };
})(window);
