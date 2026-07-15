/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PulseDex · METRIC REGISTRY DATA  (pulsedex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to PulseDex — the exact clone of oxydex-registry.js; SHARED logic
   (badge/legend/tier/persistence) lives in metric-registry.js.

   PulseDex ingests RAW RR-intervals → full HRV suite, so time/frequency/
   Poincaré metrics are genuine RR-based HRV → 'validated' here (unlike the
   1 Hz pulse-rate proxies in OxyDex). Labels/units mirror pulsedex-cross.js
   METRICS[] + the dashboard/table render so registry & envelope never diverge.

   Evidence (brief §3):
     measured     : raw RR statistics + coverage/quality — Pulse HR, Mean/Median/Min/Max RR,
                    Q1/Q3, NN50, Mode, AMo50, MxDMn, CV, N, coverage, artifacts
     validated    : established HRV — SDNN, rMSSD, pNN50, SDANN, SDNN index, ln rMSSD,
                    Tri Index, all spectral power + LF/HF + nu, SD1/SD2/area, Baevsky SI
     emerging     : nonlinear / fragmentation / surrogates — DFA α1, SampEn, decel/accel cap,
                    PIP/IALS/PSS/PAS, RSA proxy, resp rate, vagal eff, SDNN-Z
     experimental : Welltory-style composites — HRV/Stress/Energy/Focus/Coherence scores,
                    ANS SNS/PSNS, balances, EFC, CRS, ABS, OTR, recovery, HTN, health
     heuristic    : population projections — VO₂ estimates (ANS age + BP proxies
                    REMOVED 2026-06-21, external-review WP-A)
   Load AFTER metric-registry.js, BEFORE pulsedex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PULSE_REGISTRY = {
    /* ── MEASURED — raw RR statistics / direct quality ─────────────────────── */
    hr: { label: 'Pulse HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Mean heart rate — direct from RR intervals' },
    meanRR: { label: 'Mean RR', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Average RR interval — direct' },
    medianRR: { label: 'Median RR', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: '50th-percentile RR — direct' },
    minRR: { label: 'Min RR', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Shortest interval (post-clean) — direct' },
    maxRR: { label: 'Max RR', unit: 'ms', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Longest interval (post-clean) — direct' },
    q25: { label: 'Q1 (25th)', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: '25th-percentile RR — direct' },
    q75: { label: 'Q3 (75th)', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: '75th-percentile RR — direct' },
    nn50: { label: 'NN50', unit: 'count', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Pairs with |ΔRR|>50 ms — direct count' },
    modeRR: { label: 'Mode', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Most common RR bin — direct' },
    amo50: { label: 'AMo50', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: '% beats within Mode±25 ms — direct' },
    mxdmn: { label: 'MxDMn', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Max−Min RR range — direct' },
    cv: { label: 'CV', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'SDNN/MeanRR×100 — direct ratio' },
    nBeats: { label: 'N (beats)', unit: 'beats', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Sample size after cleaning — direct' },
    coverage: { label: 'Coverage', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'RR-sum vs wall-clock capture — direct' },
    artifacts: { label: 'Artifacts', unit: '%', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: '% beats corrected — direct quality stat' },

    /* ── VALIDATED — established RR-based HRV (Task Force 1996 & co.) ───────── */
    sdnn: { label: 'SDNN', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'SDNN — overall HRV (Task Force 1996)' },
    rmssd: { label: 'rMSSD', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'RMSSD — short-term parasympathetic HRV (Task Force 1996)' },
    lnRMSSD: { label: 'ln rMSSD', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'Log-RMSSD — readiness HRV scale' },
    pnn50: { label: 'pNN50', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'pNN50 — % successive RR > 50 ms (Task Force 1996)' },
    sdann: { label: 'SDANN', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'SDANN — SD of 5-min mean RR (Task Force 1996)' },
    sdnnIdx: { label: 'SDNN index', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'SDNN index — mean of 5-min SDNNs (Task Force 1996)' },
    triIdx: { label: 'Tri Index', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'HRV triangular index — geometric measure (Task Force 1996)' },
    tp: { label: 'Total Power', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Lomb–Scargle total spectral power (∫PSD = variance)' },
    hf: { label: 'HF Power', unit: 'ms²', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'HF power — parasympathetic (Task Force 1996)' },
    lf: { label: 'LF Power', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'LF power (Task Force 1996)' },
    vlf: { label: 'VLF Power', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'VLF power (Task Force 1996)' },
    lfhf: { label: 'LF/HF', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'LF:HF — sympatho-vagal balance (Task Force 1996)' },
    hfnu: { label: 'HF n.u.', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Normalised HF power — parasympathetic (Task Force 1996)' },
    lfnu: { label: 'LF nu', unit: 'nu', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Normalised LF power (Task Force 1996)' },
    sd1: { label: 'SD1', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD1 — short-axis (≈ RMSSD/√2)' },
    sd2: { label: 'SD2', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD2 — long-axis dispersion' },
    sd1sd2: { label: 'SD1/SD2', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD1/SD2 ratio — short/long balance' },
    ellArea: { label: 'Ellipse Area', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'π·SD1·SD2 — Poincaré complexity proxy' },
    si: { label: 'Baevsky SI', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Baevsky stress index — established autonomic-load index' },

    /* ── EMERGING — nonlinear / fragmentation / surrogates ─────────────────── */
    dfaAlpha1: { label: 'DFA α1', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'DFA short-term scaling exponent — device/length-dependent' },
    sampen: { label: 'SampEn', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Sample entropy — nonlinear complexity' },
    decelCap: { label: 'Decel Cap', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'PRSA deceleration capacity (Bauer 2006) — vagal/mortality marker' },
    accelCap: { label: 'Accel Cap', unit: 'ms', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'PRSA acceleration capacity — sympathetic' },
    rsaProxy: { label: 'RSA Proxy', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'HF/MeanRR² respiratory-sinus-arrhythmia proxy' },
    respRate: { label: 'Resp Rate', unit: 'br/min', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Respiration from HF spectral peak (RSA frequency) — surrogate' },
    vagalEff: { label: 'Vagal Eff', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Vagal efficiency (rMSSD/HR) — coupling proxy' },
    sdnnZ: { label: 'SDNN Z', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'SDNN z-score vs personal baseline' },
    pip: { label: 'PIP', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Fragmentation — % inflection points (>69% AF risk, 2025)' },
    ials: { label: 'IALS', unit: '', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Fragmentation — inverse average segment length' },
    pss: { label: 'PSS', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Fragmentation — % NN in short segments' },
    pas: { label: 'PAS', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Fragmentation — % NN in alternation segments' },

    /* ── EXPERIMENTAL — Welltory-style / PulseDex composites ───────────────── */
    hrvScore: { label: 'HRV Score', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'experimental', cite: 'PulseDex HRV composite score — Welltory-style, internal' },
    stress: { label: 'Stress', unit: '', goodDirection: 'down', depth: 'basic', evidence: 'experimental', cite: 'HRV-derived stress score — composite' },
    energy: { label: 'Energy', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'HRV-derived energy score — composite' },
    focus: { label: 'Focus est', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'HRV-derived focus score — composite' },
    coherence: { label: 'Coherence', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'PulseDex-native coherence — internal composite' },
    recovery: { label: 'Recovery', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'experimental', cite: 'Recovery sub-score — composite' },
    recovIndex: { label: 'Recov Index', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'Autonomic recovery index — composite' },
    ansSns: { label: 'ANS SNS', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Sympathetic-activation score — composite' },
    ansPsns: { label: 'ANS PSNS', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Parasympathetic-activation score — composite' },
    snsBal: { label: 'SNS bal', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'LF/HF-based sympathetic ratio — composite' },
    psnsBal: { label: 'PSNS bal', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'HF/LF-based parasympathetic ratio — composite' },
    abs: { label: 'ABS', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Autonomic Balance Score — composite' },
    efc: { label: 'EFC Ready', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Energy×0.4 + Focus×0.3 + Coherence×0.3 — composite readiness' },
    crs: { label: 'Cardiac CRS', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: '(Coh·rMSSD·pNN50)/Stress×1000 — internal composite' },
    sfg: { label: 'Stress-Focus', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Stress−Focus gap — composite' },
    fe: { label: 'Focus Effic', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Focus/(SNS+1) — composite' },
    pnse: { label: 'PNS Effic', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'rMSSD/(SDNN·pNN50) — composite' },
    otr: { label: 'OTR', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Overtraining-risk proxy — composite' },
    htn: { label: 'HTN Pattern', unit: '', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Hypertensive-like ANS score — composite' },
    health: { label: 'Health', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'Data-integrity health score (100 − 2×artifact%) — internal' },

    /* ── HEURISTIC — population projections / proxies ──────────────────────── */
    /* ANS Age + BP proxies (SBP/DBP Est) REMOVED 2026-06-21 (external-review WP-A).
     PulseDex computes true RR-interval HRV — the validated rMSSD/SDNN bench is
     the honest hero. VO₂ retained at research depth. */
    vo2: { label: 'VO₂max Est', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'HRV→VO₂max estimate — population proxy, not CPET' },
    vo2base: { label: 'VO₂ base', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Uth–Sørensen HR-ratio VO₂ estimate — proxy' }
  };

  /* ── Alias map: UI label (as rendered) → registry id ───────────────────── */
  var PULSE_LABEL_ALIAS = {
    'pulse hr': 'hr',
    'mean hr': 'hr',
    'mean hr (med)': 'hr',
    hr: 'hr',
    'mean rr': 'meanRR',
    'median rr': 'medianRR',
    'min rr': 'minRR',
    'max rr': 'maxRR',
    'q1 (25th)': 'q25',
    'q3 (75th)': 'q75',
    nn50: 'nn50',
    mode: 'modeRR',
    amo50: 'amo50',
    mxdmn: 'mxdmn',
    cv: 'cv',
    'n (beats)': 'nBeats',
    coverage: 'coverage',
    artifacts: 'artifacts',
    sdnn: 'sdnn',
    'sdnn (med)': 'sdnn',
    rmssd: 'rmssd',
    'rmssd (med)': 'rmssd',
    'ln rmssd': 'lnRMSSD',
    'ln(rmssd)': 'lnRMSSD',
    lnrmssd: 'lnRMSSD',
    pnn50: 'pnn50',
    'pnn50 (med)': 'pnn50',
    sdann: 'sdann',
    'sdnn index': 'sdnnIdx',
    'tri index': 'triIdx',
    'total power': 'tp',
    'total pwr': 'tp',
    'hf power': 'hf',
    hf: 'hf',
    'lf power': 'lf',
    lf: 'lf',
    'vlf power': 'vlf',
    'lf/hf': 'lfhf',
    /* ANS-activation bar labels — composite scores, not the spectral powers (HF/LF resolve above) */
    sns: 'ansSns',
    psns: 'ansPsns',
    'hf n.u.': 'hfnu',
    'hf nu': 'hfnu',
    'lf nu': 'lfnu',
    sd1: 'sd1',
    sd2: 'sd2',
    'sd1/sd2': 'sd1sd2',
    'ellipse area': 'ellArea',
    'baevsky si': 'si',
    'dfa α1': 'dfaAlpha1',
    'dfa a1': 'dfaAlpha1',
    sampen: 'sampen',
    'decel cap': 'decelCap',
    'accel cap': 'accelCap',
    'rsa proxy': 'rsaProxy',
    'resp rate': 'respRate',
    'vagal eff': 'vagalEff',
    'sdnn z': 'sdnnZ',
    pip: 'pip',
    ials: 'ials',
    pss: 'pss',
    pas: 'pas',
    'hrv score': 'hrvScore',
    stress: 'stress',
    'stress est': 'stress',
    energy: 'energy',
    'energy est': 'energy',
    'focus est': 'focus',
    coherence: 'coherence',
    recovery: 'recovery',
    'recov index': 'recovIndex',
    'ans sns': 'ansSns',
    'ans psns': 'ansPsns',
    'sns bal': 'snsBal',
    'psns bal': 'psnsBal',
    abs: 'abs',
    'efc ready': 'efc',
    'efc readiness': 'efc',
    'cardiac crs': 'crs',
    'stress-focus': 'sfg',
    'focus effic': 'fe',
    'pns effic': 'pnse',
    otr: 'otr',
    'htn pattern': 'htn',
    health: 'health',
    'vo₂max est': 'vo2',
    'vo2max est': 'vo2',
    'vo₂ adj': 'vo2',
    'vo2 adj': 'vo2',
    'vo₂ base': 'vo2base',
    'vo2 base': 'vo2base'
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
    if (PULSE_REGISTRY[k]) return k;
    return PULSE_LABEL_ALIAS[k] || null;
  }

  /* Pure metadata / non-metric rows — never badge even with fallback. */
  var _META_DENY = {
    date: 1,
    datetime: 1,
    start: 1,
    end: 1,
    source: 1,
    'sample rate': 1,
    recording: 1,
    duration: 1,
    mode: 0,
    'active flags': 1,
    'vo₂ gt': 1,
    'vo2 gt': 1,
    '— advanced / research —': 1
  };
  /* note: 'mode' is a real metric (modeRR) so it is NOT denied (set 0 above is ignored). */

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — resolves a label
   to its registry id → evidence → MetricRegistry.badge, to place an evidence dot
   IMMEDIATELY BEFORE the label (CLAUDE.md coverage mandate: inline .ev sits before
   the label in dense/crowded text). fallback gives an unknown non-meta label a
   hollow experimental disc so nothing is silently unbadged. */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(PULSE_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(PULSE_REGISTRY, id).depth : null;
  }

  global.PULSE_REGISTRY = PULSE_REGISTRY;
  global.PulseRegistry = {
    REGISTRY: PULSE_REGISTRY,
    ALIAS: PULSE_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel
  };
})(window);
