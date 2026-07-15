/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   HRVDex · METRIC REGISTRY DATA  (hrvdex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to HRVDex — clone of oxydex-registry.js; SHARED logic lives in
   metric-registry.js. HRVDex has no *-cross.js; labels mirror the
   hrvdex-render.js KPI strip + readiness hero subscores.

   HRVDex ingests pre-computed daily HRV summaries (Welltory-style). The core
   HRV measures remain validated; the app layers many composites + projections.

   Evidence (brief §3):
     validated    : established HRV — rMSSD, SDNN, LF/HF, HF n.u., SD1/SD2, Baevsky SI,
                    Toichi CVI/CSI
     emerging     : nonlinear / surrogate — DFA α1 proxy, spectral entropy, SDNN z,
                    HRV momentum, vagal efficiency, CAI
     experimental : composite scores — HRV/Stress/Energy/Coherence, ANS load, recovery
                    index/debt, EFC, ABS, restoration index, PTI, overtraining risk
     heuristic    : population projections — VO₂ estimates (ANS age + BP proxies
                    REMOVED 2026-06-21, external-review WP-A)
   Load AFTER metric-registry.js, BEFORE hrvdex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var HRV_REGISTRY = {
    /* ── MEASURED — direct reading ──────────────────────────────────────────── */
    hrRest: { label: 'Resting HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Resting heart rate — direct reading from the daily HRV summary' },

    /* ── VALIDATED — established HRV ────────────────────────────────────────── */
    rmssd: { label: 'rMSSD', unit: 'ms', goodDirection: 'up', depth: 'basic', evidence: 'validated', cite: 'RMSSD — short-term parasympathetic HRV (Task Force 1996)' },
    sdnn: { label: 'SDNN', unit: 'ms', goodDirection: 'up', depth: 'basic', evidence: 'validated', cite: 'SDNN — overall HRV (Task Force 1996)' },
    lfhf: { label: 'LF/HF', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'LF:HF — sympatho-vagal balance (Task Force 1996)' },
    hfnu: { label: 'HF n.u.', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Normalised HF power — parasympathetic (Task Force 1996)' },
    sd1sd2: { label: 'SD1/SD2', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD1/SD2 ratio — short/long balance' },
    si: { label: 'Baevsky SI', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'validated', cite: 'Baevsky stress index — established autonomic-load index' },
    cvi: { label: 'Toichi CVI', unit: '', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Cardiac vagal index (Toichi 1997)' },
    csi: { label: 'Toichi CSI', unit: '', goodDirection: 'down', depth: 'research', evidence: 'validated', cite: 'Cardiac sympathetic index (Toichi 1997)' },

    /* ── EMERGING — nonlinear / surrogate ──────────────────────────────────── */
    dfaAlpha1: { label: 'DFA α1', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'DFA short-term scaling proxy — device/length-dependent' },
    spectralEnt: { label: 'Spectral Ent', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Spectral entropy — regulatory complexity' },
    sdnnZ: { label: 'SDNN Z-score', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'SDNN z-score vs 7-day baseline' },
    momentum: { label: 'HRV Momentum', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: '14-day ln(rMSSD) slope — trend signal' },
    vei: { label: 'VEI (rMSSD/HR)', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Vagal efficiency (rMSSD/HR) — coupling proxy' },
    cai: { label: 'CAI', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Cardiac autonomic index √(SD1×SD2)' },

    /* ── EXPERIMENTAL — composite scores ───────────────────────────────────── */
    /* NOTE (SIGNAL-ADAPTER-AND-FRONTIER §8 #5 / -III §1, 2026-06-25): the five composites that
     CANNOT be computed without Welltory's BLACK-BOX subjective scores (Stress/Energy/Coherence/
     Focus/SNS/PSNS) — ansLoad, efc, welfare, otr, crs — are demoted experimental→heuristic so they
     are visibly second-class on the NATIVE path, matching the welltory-summary adapter's
     provenance.derived:true quarantine + the 'heuristic'-tier stress_high event. The brief's
     explicit five-item set only; do NOT mass-re-tier other partly-subjective composites.

     TIER-SPLIT RATIONALE (SIGNAL-ADAPTER-FOLLOWUPS-V §2 — decision recorded, option b): siblings
     that ALSO read a black-box subjective input — pti (PSNS×rMSSD), abs (PSNS/SNS balance),
     coherence, focusEff (focus/(SNS+1)), and the stress/energy scores themselves — DELIBERATELY
     stay 'experimental'. The demoted five are the high-visibility KPI-grid / headline-readiness
     composites where a heuristic-dressed-as-measured read does the most harm; the rest are
     research-depth table cells. This is an intentional visibility-weighted split, NOT an oversight —
     it leaves two same-input-class composites at different tiers ON PURPOSE. Option (a) (re-tier
     every black-box-fed composite to heuristic) was considered and declined to avoid re-tiering ~6
     more cards + their guide entries + a cohesion re-sync for low marginal honesty gain. Revisit
     only if a future reader's confusion outweighs that cost. */
    hrvScore: { label: 'HRV Score', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'experimental', cite: 'HRVDex autonomic-readiness composite — internal' },
    stress: { label: 'Stress', unit: '', goodDirection: 'down', depth: 'basic', evidence: 'experimental', cite: 'HRV-derived stress score — composite' },
    energy: { label: 'Energy', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'HRV-derived energy score — composite' },
    coherence: { label: 'Coherence', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'HRV coherence — internal composite' },
    ansLoad: { label: 'ANS Load', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'heuristic', cite: 'Composite autonomic burden — internal' },
    recovIndex: { label: 'Recov Index', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'Autonomic recovery index vs baseline — composite' },
    recovDebt: { label: 'Recov Debt', unit: 'd', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Days with ARI<0.9 over 14 d — composite' },
    efc: { label: 'EFC Index', unit: '', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Energy-fatigue-capacity readiness — composite' },
    abs: { label: 'ABS', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Autonomic Balance Score — composite' },
    welfare: {
      label: 'Restoration Index',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Energy×Coherence/Stress — composite'
    } /* renamed from 'Welfare Idx' 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🟡 — neutral autonomic naming) */,
    pti: { label: 'PTI', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Parasympathetic tone index (PSNS × rMSSD) — composite' },
    otr: {
      label: 'Overtrain Risk',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'SNS/PSNS-load overtraining proxy — internal composite; HRV training-status monitoring per Bellenger 2016 (Sports Med 46:1461), but this specific index is not validated'
    },
    crs: {
      label: 'Cardiac Resilience',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Cardiac-resilience composite (Coherence×rMSSD×pNN50 / Stress) — internal, directional only'
    },
    focusEff: {
      label: 'Focus Efficiency',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Focus/sympathetic-efficiency ratio (focus/(SNS+1)) — internal composite'
    },
    pnsEff: { label: 'PNS Efficiency', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Parasympathetic-efficiency ratio (rMSSD/(SDNN×pNN50)) — internal composite' },
    ortho: {
      label: 'Orthostatic Load',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'HR/SDNN autonomic-load proxy — internal; NOT a true supine→stand orthostatic test'
    },
    camq: { label: 'CAMQ', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Cardiac Autonomic Modulation Quality (0–100) — internal parasympathetic composite' },

    /* ── HEURISTIC — population projections ────────────────────────────────── */
    /* ANS Age + BP proxies (SBP/DBP Est, BP Risk) REMOVED 2026-06-21
     (external-review WP-A) — a population regression dressed as a personal age,
     and cuffless BP from HRV; neither survives its disclaimer. VO₂ retained at
     research depth. See DEX-METRIC-REMOVAL-AUDIT-BRIEF.md. */
    vo2: { label: 'VO2max Est', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'HRV-adjusted VO₂max estimate — population proxy, not CPET' },
    vo2roll: { label: 'VO2 7d Avg', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Rolling 7-day VO₂max baseline — population proxy' }
  };

  var HRV_LABEL_ALIAS = {
    'resting hr': 'hrRest',
    'resting hr (bpm)': 'hrRest',
    'rest hr': 'hrRest',
    'resting heart rate': 'hrRest',
    rmssd: 'rmssd',
    sdnn: 'sdnn',
    'lf/hf': 'lfhf',
    'hf n.u.': 'hfnu',
    'hf nu': 'hfnu',
    'sd1/sd2': 'sd1sd2',
    'baevsky si': 'si',
    'toichi cvi': 'cvi',
    'toichi csi': 'csi',
    'dfa α1': 'dfaAlpha1',
    'dfa a1': 'dfaAlpha1',
    'spectral ent': 'spectralEnt',
    'sdnn z-score': 'sdnnZ',
    'sdnn z': 'sdnnZ',
    'hrv momentum': 'momentum',
    'vei (rmssd/hr)': 'vei',
    vei: 'vei',
    cai: 'cai',
    'hrv score': 'hrvScore',
    stress: 'stress',
    energy: 'energy',
    coherence: 'coherence',
    'ans load': 'ansLoad',
    'recov index': 'recovIndex',
    recovery: 'recovIndex',
    'recov debt': 'recovDebt',
    'efc index': 'efc',
    'efc readiness': 'efc',
    abs: 'abs',
    'autonomic balance score': 'abs',
    'welfare idx': 'welfare',
    'welfare index': 'welfare',
    'restoration index': 'welfare',
    pti: 'pti',
    'overtrain risk': 'otr',
    'otr index': 'otr',
    'otr index (capped 500)': 'otr',
    'cardiac resilience': 'crs',
    'cardiac resilience score': 'crs',
    resilience: 'crs',
    'focus efficiency': 'focusEff',
    'focus eff': 'focusEff',
    'pns efficiency': 'pnsEff',
    'pns eff': 'pnsEff',
    'orthostatic load': 'ortho',
    'orthostatic load (hr/sdnn)': 'ortho',
    camq: 'camq',
    'vo2max est': 'vo2',
    'vo₂max est': 'vo2',
    'vo2 7d avg': 'vo2roll',
    'vo₂ 7d avg': 'vo2roll'
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
    if (HRV_REGISTRY[k]) return k;
    return HRV_LABEL_ALIAS[k] || null;
  }

  var _META_DENY = { date: 1, start: 1, end: 1, source: 1, 'sample rate': 1, recording: 1, 'active flags': 1, tier: 1, today: 1 };

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — resolves a
   label to its registry id → evidence → MetricRegistry.badge, to place an
   evidence dot IMMEDIATELY BEFORE the label (CLAUDE.md coverage mandate: inline
   .ev sits before the label in dense/crowded text). fallback=true gives an
   unknown (non-meta) label a hollow EXPERIMENTAL badge so nothing is silently
   unbadged; pure metadata (date/start/…) stays bare. */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(HRV_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(HRV_REGISTRY, id).depth : null;
  }

  global.HRV_REGISTRY = HRV_REGISTRY;
  global.HrvRegistry = {
    REGISTRY: HRV_REGISTRY,
    ALIAS: HRV_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel
  };
})(window);
