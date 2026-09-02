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
    /* ── EXPERIMENTAL — waveform-derived SpO₂ (0x05 raw stream, owner-ordered 2026-08-20) ── */
    spo2wMedian: {
      label: 'SpO₂w median',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Waveform-derived SpO₂ trend median — 0x05 ratio-of-ratios, per-session self-calibrated vs device SpO₂'
    },
    spo2wMin: {
      label: 'SpO₂w min',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Waveform-derived SpO₂ trend minimum — same channel; extremes compressed by the regression'
    },
    spo2wTrackR: {
      label: 'SpO₂w track r',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Pearson r of the waveform ratio vs device SpO₂ this session — the self-calibration quality gate (≥0.3 required)'
    },
    spo2wBias: {
      label: 'SpO₂w bias',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: '1 Hz comparator mean error vs the device output — ~0 by construction (OLS zeroes the mean residual); reported for honesty, the fan carries the content'
    },
    spo2wMae: {
      label: 'SpO₂w MAE',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: '1 Hz comparator mean |error| vs the device output — ECGDex alignFirmwareRR pattern transposed; the per-decile fan beside it is the decay view'
    },
    spo2wWithin2: {
      label: 'SpO₂w within ±2%',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Share of compared seconds where the waveform 1 Hz signal is within ±2 % of the device output'
    },
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
    hypoxicBurden: {
      label: 'Hypoxic burden',
      unit: '%·min/h',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Internal fixed-94% AUC — Σ(94−SpO₂)/60/hr, a whole-night integral below a flat 94% line (computeHypoxicBurden). NOT Azarbarzin 2019: that sleep-apnoea-specific hypoxic burden is event/baseline-referenced and is implemented separately as Hypoxic Load (computeHypoxicLoad). Sibling of the fixed-94 HD94 (hd94) and tiered to match it. FINDING 8: retiered from a false validated/Azarbarzin badge — a validated tier requires a citation matching the method (literature-use policy §2).'
    },
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
    fftCycleSec: {
      label: 'FFT Cycle Length',
      unit: 's',
      goodDirection: 'none',
      depth: 'research',
      evidence: 'emerging',
      cite:
        'Periodic-breathing / Cheyne-Stokes cycle length from the SpO2 periodogram. The PHYSIOLOGY is ' +
        'established and has a genuinely characteristic period; this SpO2-derived, device-dependent ' +
        'estimate is not standardized, hence emerging rather than validated. Reported only when the ' +
        'peak clears a fitted AR(1) background (Mann & Lees 1996, Climatic Change 33:409-445, ' +
        'doi 10.1007/BF00142586) — NULL otherwise, because before 2026-08-16 this returned an argmax ' +
        'unconditionally and fabricated a cycle on featureless nights (~42 % of pure AR(1) runs). ' +
        'Corpus support: 19/103 nights at the band edge against a 42 % null, p = 3.3e-7.'
    },
    ahiEst: {
      label: 'ODI-4 / AHI est',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'AHI estimate = ODI-4 × 1.1 (oxydex-dsp.js computeAHIestimates) — an OXIMETRY surrogate, not PSG and NOT CVHR-derived; CVHR is the separate cvhrIndex entry'
    },
    cvhrIndex: { label: 'CVHR index', unit: '/hr', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Cyclical-variation-of-HR index (Hayano)' },
    sleepEff: { label: 'Sleep Eff', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Motion-derived sleep efficiency — actigraphy proxy, not EEG' },
    spo2Drift: { label: 'SpO₂ drift', unit: '%/night', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: '7-day rolling chronic-drift indicator' },
    hrSpikes: { label: 'HR Spikes', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Autonomic-arousal surrogate from HR rises' },

    /* ── DEEP-AUDIT-III §6.5 — SURFACED BUT UNREGISTERED until 2026-07-27 ─────
       `badgeForLabel(label, true)` mints an `experimental` disc for any label the registry cannot
       resolve, so these rendered fully badged while having NO entry at all — the badge looked like a
       grade and was really a fallback. Tiers are stated here so the claim is auditable:
         · MOS — implements the published McGill criteria (Nixon 2004), but that score was validated
           in CHILDREN for adenotonsillectomy planning; OxyDex applies it to adult unattended home
           oximetry. `audits/REFERENCE-GUIDE-AUDIT-FINDINGS.md` already requires MOS be "honestly
           distinguished from the pediatric McGill score", so `validated` would be a fabricated
           citation. EXPERIMENTAL until validated in this population.
         · deltaIndex — the 12-s mean-absolute-difference delta index IS a published oximetry
           parameter, so EMERGING; upgrading to `validated` requires the exact citation checked
           against what this code computes, and a tier is never upgraded on "the literature says".
         · pbEpisodes — periodic breathing has real diagnostic criteria, but this is OxyDex's own
           detector on oximetry alone. EMERGING.
         · everything else — internal composites or detector-derived descriptors, same class as the
           `nsi` entry below, which already reads `experimental` with an "internal" cite. */
    mos: {
      label: 'MOS',
      unit: '',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: "McGill-criteria oximetry grade (ODI-4 + CT<90) — published criteria (Nixon 2004) applied OUTSIDE their validated paediatric population; not the paediatric McGill score. HEURISTIC per the OxyDex Reference guide's pre-existing grade (§6.5: the doc's call predates this entry and is the more conservative one)"
    },
    deltaIndex: {
      label: 'Δ-Index',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Mean absolute difference of successive 12-s SpO₂ means — published oximetry variability parameter'
    },
    pbEpisodes: {
      label: 'PB Episodes',
      unit: '',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Periodic-breathing episode count — OxyDex detector on oximetry alone (no airflow/effort channel)'
    },
    oscIndex: {
      label: 'SpO₂ oscillation index',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Crossings of a node-local 95% SpO₂ level (SPO2_OSC_THRESHOLD) — OxyDex-only, no external validation'
    },
    episodeRange: {
      label: 'Episode range',
      unit: 's',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: "Duration range of detected episodes — inherits the detector's standing, not a direct measurement"
    },
    periodicityPattern: {
      label: 'Periodicity pattern',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Descriptor of the oscillation pattern — OxyDex classification, internal'
    },
    pnn3: { label: 'pNN3', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'pNN-family variant at a 3 ms threshold on PULSE rate — not the validated pNN50 on RR' },
    aai: {
      label: 'AAI',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: "Autonomic arousal index — OxyDex surrogate from pulse-rate rises, internal. HEURISTIC per the OxyDex Reference guide's pre-existing grade"
    },
    wtdsi: {
      label: 'WtDSI',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: "Weighted desaturation severity index — OxyDex composite, internal. HEURISTIC per the OxyDex Reference guide's pre-existing grade"
    },
    sfi: { label: 'SFI', unit: '/hr', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Sleep fragmentation index — OxyDex composite, internal' },

    /* ── ADJUDICATED 2026-08-16 (owner-ratified) — the 68-label fabricated-tier debt.
       Every tier below is a CLAIM about how well that number is established, assigned one at a
       time against the ladder these files already use (meanSpo2/minHr = measured · odi3/odi4/t88 =
       validated · hypoxicBurden/pnn3 = experimental · MOS = heuristic), NOT filled in to turn a
       gate green — that is the fabricated authority §🎫 exists to prevent.
       The rule that did most of the work: an ESTABLISHED EXTERNAL METHOD applied to a signal it
       was not validated on is `emerging`, never `validated`. DFA α1, deceleration capacity and
       ApEn are real published methods computed here on PULSE rate rather than ECG RR.
       Anything the code itself hedges — `proxy`, `-equiv`, `~est` — is `heuristic`. ── */
    stabilityR2: {
      label: 'Stability R²',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'experimental',
      cite: "Fit quality (r²) of the cross-night stability regression — a property of this suite's model, not of the subject"
    },
    scoreTrend: { label: 'Trend', unit: 'pts/night', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'OLS slope of the nightly composite score across the loaded nights' },
    spo2NightCV: { label: 'SpO2 Night CV', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Between-night coefficient of variation of mean SpO₂' },
    pbTrend: { label: 'PB Trend', unit: '/night', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'OLS slope of the periodic-breathing index across nights' },
    poorNightsPct: {
      label: 'Poor Nights (<50)',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: "Share of nights scoring under 50 on this suite's composite score"
    },
    odi4Delta: {
      label: 'ODI-4 Δ (first→last)',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Difference between first and last night ODI-4 — the DIFFERENCE is ours; ODI-4 itself is the standard 4% criterion'
    },
    solTrend: { label: 'SOL Trend', unit: 'min/night', goodDirection: 'down', depth: 'advanced', evidence: 'heuristic', cite: 'OLS slope of estimated sleep-onset latency across nights' },
    posShifts: { label: 'Pos Shifts', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Posture-shift count derived from the accelerometer' },
    lcsp: {
      label: 'LCSP',
      unit: 'min',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: 'Longest continuous stable period — a sleep-consolidation stand-in, not a scored measure'
    },
    remProxy: {
      label: 'REM ~est',
      unit: 'min',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: "REM estimate from oximetry + pulse rate. The '~est' is deliberate: recall/precision against PSG labels has never been measured (REM-STAGING)"
    },
    deepProxy: { label: 'Deep ~est', unit: 'min', goodDirection: 'up', depth: 'advanced', evidence: 'heuristic', cite: 'Deep-sleep estimate from the same basis, with the same absent validation' },
    hrRest: {
      label: 'HR Rest',
      unit: 'bpm',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Resting pulse rate — a direct reading, same class as the registered Min HR / Max HR'
    },
    hrMaxKpi: { label: 'HR Max', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Peak pulse rate — direct reading' },
    vo2Conf: {
      label: 'Confidence',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: 'Confidence attached to the VO₂ estimate — a self-assessment of another metric, not a measurement'
    },
    dfaAlpha1: {
      label: 'DFA',
      unit: 'α1',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: "Peng detrended fluctuation α1 — established method, computed here on the SpO₂ SERIES (oxydex-dsp.js computeDFA maps r.spo2), not on pulse rate and not on ECG RR; HR-DFA thresholds do not apply, as the DSP's own dfaLabel says"
    },
    ssiIdx: {
      label: 'SSI',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: "Sympathetic-surge index (oxydex-dsp.js computeSympSurge: 0.4·spikeRate + 0.4·postDipAct + 0.2·aaiLoad), surfaced as 'Symp Surge' — this suite's own construction. NOT a sleep-stability index, which is what this cite said while the DSP scored it as surge; direction corrected with it (the DSP scores <0.3 as severity 0, so LOWER is better)"
    },
    cdiIdx: { label: 'CDI', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Cyclic desaturation index, bespoke detector' },
    hypLoad: {
      label: 'HypLoad',
      unit: '%·min',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Hypoxic load — same family as the registered hypoxicBurden (experimental) and no better established'
    },
    recIdx: { label: 'RecIdx', unit: '', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Recovery index, bespoke' },
    oxyCrash: { label: 'OxyCrash', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Bespoke rapid-desaturation rate' },
    spo2CoV: { label: 'SpO₂ CoV', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Coefficient of variation of the sensed SpO₂ series' },
    tAucWeighted: { label: 'T-AUC Wt', unit: '%·min', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: "Weighted time-area below threshold — the WEIGHTING is this suite's" },
    auc90Rate: {
      label: 'AUC-90 Rate',
      unit: '%·min/h',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'validated',
      cite: 'Area under 90% per hour — a standard oximetry burden measure, sibling of the registered T88'
    },
    dip3Rate: {
      label: 'Dip-3/hr',
      unit: '/hr',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'validated',
      cite: '3% desaturation index — the same standardised criterion as the registered ODI-3'
    },
    nadirCount: { label: 'Nadir Count', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Count of nadir events below the stated threshold' },
    nadirDepth: { label: 'Nadir Depth', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Mean depth of those nadirs, in the sensed unit' },
    nadirRecov: { label: 'Nadir Recov', unit: 's', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Mean recovery time after a nadir — the recovery definition is ours' },
    circadianScore: { label: 'Circadian', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'Circadian score, bespoke composite' },
    decelCap: {
      label: 'Decel Cap',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Bauer deceleration capacity — established method, computed on pulse-derived rate rather than ECG RR'
    },
    apEn: { label: 'ApEn', unit: '', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Pincus approximate entropy — established method, unvalidated on this signal' },
    bradyCount: { label: 'Bradycardia', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Count of epochs below the stated HR threshold' },
    tachyCount: { label: 'Tachycardia', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Count of epochs above the stated HR threshold' },
    wasoWindows: {
      label: 'WASO Win',
      unit: 'count',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Wake-after-sleep-onset windows inferred from oximetry and motion, not PSG'
    },
    ultradianCycles: { label: 'Ultradian Cycles', unit: 'count', goodDirection: 'up', depth: 'advanced', evidence: 'heuristic', cite: 'Count of detected ultradian cycles — the detector is ours' },
    ultradianValleys: { label: 'HR Valleys', unit: 'count', goodDirection: 'up', depth: 'advanced', evidence: 'experimental', cite: 'Valley count from the same detector' },
    crcIdx: { label: 'CRC Index', unit: '', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Cardio-respiratory coupling index, bespoke' },
    /* OXYDEX-FFT-CYCLE-NULL §6 — `computeSpO2FFT`'s two published fields. Both reach the user (the CSV
       carries "FFT Peak Freq (Hz)" / "FFT Cycle Length (s)") and neither had a registry row, so any
       badge helper resolving them fell through to the fabricated-`experimental` default rather than a
       graded one — a tier that happened to be right for the wrong reason.
       `experimental`, and NOT higher, matching the published guide card (`ev-experimental`): the metric
       now has a genuine null — it returns `null` rather than a periodogram argmax when no peak clears a
       fitted background, and publishes `snr`/`threshold`/`rhoLag1` so the verdict is auditable — but the
       claim that the surviving peak is a *physiological* cycle has no external reference behind it.
       `heuristic` would undersell the null work; `emerging` would assert a validation nobody has done. */
    peakCycSec: {
      label: 'FFT Cycle Length',
      unit: 's',
      goodDirection: 'neutral',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Periodogram peak converted to a period, gated by a fitted-background significance test; null when no peak clears it'
    },
    peakFreqHz: {
      label: 'FFT Peak Freq',
      unit: 'Hz',
      goodDirection: 'neutral',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Dominant SpO2 frequency (DFT), same significance gate as FFT Cycle Length'
    },
    pbDivergeCount: { label: 'PB Diverge', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Count of periodic-breathing divergence events, bespoke detector' },
    pbDivergePct: { label: 'Diverge %', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Share form of the divergence count' },
    couplingScore: { label: 'Coupling', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Coupling score, bespoke composite' },
    spo2IQR: { label: 'SpO₂ IQR', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Interquartile range of the sensed SpO₂ series' },
    condMeanBelow94: {
      label: 'Cond Mean',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Conditional mean of SpO₂ while below 94% — a statistic of the sensed series'
    },
    condPctBelow94: { label: 'Cond %', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Share of the recording below 94%' },
    nadirBinLt4: {
      label: 'Nadir >91%',
      unit: 'count',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Histogram bin of sensed event nadirs by ABSOLUTE LEVEL (nadir >91%), not by drop depth — oxydex-dsp.js:4524 bins on `nad`; the level and the depth are different quantities (baseline 99→92 is a 7% drop and still >91%). Direction corrected with it: the render treats fewer as better'
    },
    nadirBin46: {
      label: 'Nadir 90-91%',
      unit: 'count',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Histogram bin of sensed event nadirs by ABSOLUTE LEVEL (90–91%), not by drop depth — see nadirBinLt4'
    },
    nadirBin69: {
      label: 'Nadir 88-89%',
      unit: 'count',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Histogram bin of sensed event nadirs by ABSOLUTE LEVEL (88–89%), not by drop depth — see nadirBinLt4'
    },
    nadirBinGt9: {
      label: 'Nadir <88%',
      unit: 'count',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Histogram bin of sensed event nadirs by ABSOLUTE LEVEL (<88%, summed from the two lowest bins), not by drop depth — see nadirBinLt4'
    },
    rmssdProxy: {
      label: 'RMSSD proxy',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Named `proxy` in the code — pulse-interval analogue of RMSSD, not RR-interval RMSSD'
    },
    hrIQR: { label: 'HR IQR', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'heuristic', cite: 'Interquartile range of the sensed pulse rate' },
    hrPbContrast: { label: 'PB HR Δ', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Pulse-rate contrast between periodic-breathing and non-PB windows' },
    meanHrPb: { label: 'Mean HR PB', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Mean pulse rate within PB windows' },
    meanHrRest: { label: 'Mean HR Rest', unit: 'bpm', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Mean pulse rate outside PB windows' },
    pnn3Equiv: { label: 'pNN3-equiv', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Named `-equiv` — a pNN50-style analogue on pulse intervals' },
    rsaProxy: { label: 'RSA proxy', unit: '', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'Named `proxy` in the code' },
    breathsPerMin: {
      label: 'Breaths/min',
      unit: '/min',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Respiratory rate derived from RSA in the pulse signal, not from a respiratory band'
    },
    rsaPeakFreq: {
      label: 'RSA Peak Freq',
      unit: 'Hz',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Spectral peak of the RSA band — method standard, application unvalidated here'
    },
    rsaPeakPow: { label: 'RSA Power', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Power in the RSA band' },
    oscEpisodeCount: { label: 'Flagged Windows', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Windows the oscillation detector flagged' },
    oscPeakCrossings: { label: 'Peak Crossings', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Crossing count from the same detector' },
    restlessWindows: { label: 'Restless Windows', unit: 'count', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Motion-derived restlessness count' },
    arousalIndex: { label: 'Arousal Index', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'experimental', cite: 'Arousal index inferred without EEG' },
    hbTotal: {
      label: 'Total Burden',
      unit: '%·min',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Hypoxic-burden aggregate — the registered hypoxicBurden sits at experimental; this is no better established'
    },
    hbRate: { label: 'Burden Rate', unit: '%·min/h', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Per-hour form of the burden aggregate' },

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
    },

    /* ── §2.5 REGISTRATION SWEEP (DEEP-AUDIT-VI-FOLLOWUPS, 2026-09-02) ─────────────────────────
       35 metrics the OxyDex reference GRADES and the DSP computes, with no registry entry to grade
       them against: `cohesion-badges` could not compare a tier it had no authority for, so each card
       carried a badge nothing backed. Grades are derived from the CODE, by one rule stated once:
         · `measured`     — a direct readout of sensed values; no tuned threshold, no model
         · `heuristic`    — a tuned or rule-of-thumb threshold decides the number
         · `experimental` — a bespoke composite/score, or an established method transferred to a
                            signal it was not validated on (the `dfaAlpha1` precedent: name the
                            transfer in the cite rather than inheriting the method's standing)
       WHERE THAT RULE WOULD RAISE A BADGE, IT IS NOT TAKEN. Eight entries (MODL, HR Nadir Timing,
       Circadian HR Amplitude, LF/HF Power, O₂-HR Efficiency, RMSSD Arc, SPI, Vagal Index) keep the
       guide's more conservative `heuristic`: a grade that understates trust is not a false claim,
       and upgrading one on a rule I authored is the fabricated authority the badge mandate exists to
       prevent. They are recorded in the FOLLOWUPS stamp so a later pass can decide deliberately.
       Four entries go the other way and the guide is corrected with them — it claimed `measured`,
       which means DIRECTLY SENSED, for two threshold counts and two derived estimates. */
    bluntedArousalFlag: {
      label: 'BLUNTED AROUSAL Flag',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Flag: PB divergence >=75% AND >=6 oscillation episodes (oxydex-dsp.js:3767) — two tuned cuts, not a validated criterion'
    },
    biCv: {
      label: 'Breathing Irregularity CV (biCV)',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'CV of the inter-event interval series (see IEI) — a dispersion ratio over a bespoke interval definition'
    },
    csScore: {
      label: 'CS Score',
      unit: '/3',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'experimental',
      cite: 'Constructed 0-3 indicator count for CSR-like breathing (cycle 40-130 s + BLUNTED_AROUSAL + CRC<0.2 + low-ODI/high-PB). Not a likelihood and not validated: night-level agreement with CPAP PB scoring was kappa -0.039'
    },
    circadianHrAmp: {
      label: 'Circadian HR Amplitude / Nadir Hour',
      unit: 'bpm',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Least-squares cosine fit to the nightly HR vector — the cosinor method applied to a single night, a transfer this suite has not validated'
    },
    clusteringIdx: {
      label: 'Clustering Index',
      unit: '',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Fraction of desaturation nadirs in the second half of the recording; the >0.6 / <0.4 reading is a rule of thumb'
    },
    desatAsym: {
      label: 'Desaturation Asymmetry',
      unit: 'ratio',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: "|mean dip slope| / |mean recovery slope| (oxydex-dsp.js:2360); the >1.5 abrupt / <0.7 gradual bands are this suite's own"
    },
    dipSlope: {
      label: 'Dip Slope',
      unit: '%/s',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Mean rate of fall from baseline to nadir, negative %/s — descriptive of the detected event set, no validated cut'
    },
    hrAsym: {
      label: 'HR Asymmetry',
      unit: 'bpm/s',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Mean HR acceleration rate minus mean deceleration rate over 10-sample rolling windows — a bespoke difference'
    },
    hrCv: {
      label: 'HR CV',
      unit: '%',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'SD/mean x100 of motion-free HR — an SDNN proxy normalised by rate, not an HRV standard'
    },
    hrDecelRuns: {
      label: 'HR Deceleration Runs',
      unit: 'count',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Runs with a >=3 bpm decrease sustained >=30 s (oxydex-dsp.js:1623) — two tuned cuts'
    },
    hrNadirTiming: {
      label: 'HR Nadir Timing',
      unit: 'h',
      goodDirection: '',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Hour from recording start of the lowest 5-min smoothed HR — a readout of sensed HR, no model'
    },
    hrQuartileTrend: {
      label: 'HR Quartile Trend',
      unit: 'bpm',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Mean HR in Q4 minus Q1 of the recording — a bespoke trend contrast'
    },
    iei: {
      label: 'IEI',
      unit: 's',
      goodDirection: '',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Mean and SD of the QUIET interval between desaturation events (next start minus previous end, oxydex-dsp.js computeIEI) — an inter-event gap, not a nadir-to-nadir cycle length'
    },
    intraNightNsi: {
      label: 'Intra-Night NSI',
      unit: '',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'experimental',
      cite: 'The Nocturnal Stress Index computed over three 90-min epochs — a bespoke composite, per-epoch'
    },
    lfHfPower: {
      label: 'LF / HF Power',
      unit: 'ms2',
      goodDirection: '',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'DFT band power 0.04-0.15 Hz (LF) and 0.15-0.40 Hz (HF) (oxydex-dsp.js:4934) — the Task-Force HRV bands applied to oximeter PULSE rate, a transfer this suite has not validated'
    },
    longestCleanRun: {
      label: 'Longest Clean Run',
      unit: 'min',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Longest uninterrupted run of SpO2 > 95% (oxydex-dsp.js:1481) — a single tuned threshold; it does not test motion or artifact flags'
    },
    modl: {
      label: 'MODL',
      unit: '%',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Mean SpO2 of samples inside detected desaturation events — a readout of sensed SpO2 over the detected set'
    },
    motionBursts: {
      label: 'Motion Bursts',
      unit: 'count',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Count of motion runs lasting >=3 consecutive samples (oxydex-dsp.js:1465) — a tuned minimum length'
    },
    o2HrEfficiency: {
      label: 'O₂-HR Efficiency',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: "Per-event HR rise divided by SpO2 drop — a bespoke coupling ratio; the <0.3 blunted / <0.8 moderate bands are this suite's own"
    },
    postDipHrResponse: {
      label: 'Post-Dip HR Response',
      unit: 'bpm',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'measured',
      cite: 'Mean HR difference between each desaturation nadir and 60 s later — a difference of sensed HR at defined offsets'
    },
    rmssdArc: {
      label: 'RMSSD Arc',
      unit: 'ms/h',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'OLS slope of 30-min windowed RMSSD across the night — a bespoke trend over a pulse-rate RMSSD proxy'
    },
    recoveryCv: {
      label: 'Recovery CV',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'SD/mean x100 of the inter-event interval series — same source as IEI, expressed as a percentage'
    },
    recoverySlope: {
      label: 'Recovery Slope',
      unit: '%/s',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Mean rate of resaturation from nadir to event close — descriptive of the detected event set'
    },
    sleepPressureIdx: {
      label: 'Sleep Pressure Index (SPI)',
      unit: '',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Weighted composite of WASO (0.4), motion bursts (0.15) and sleep-onset latency — a bespoke construction with authored weights'
    },
    spo2Autocorr1: {
      label: 'SpO₂ Autocorrelation lag-1',
      unit: 'r',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Pearson correlation of consecutive SpO2 samples — a standard statistic used here as a bespoke smoothness index'
    },
    spo2Ceiling: {
      label: 'SpO₂ Ceiling',
      unit: 'count',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'Count of runs of >=5 consecutive samples at SpO2 >= 99% (oxydex-dsp.js computeSpO2Ceiling) — two tuned cuts; a sensor-ceiling indicator, not a physiological measurement'
    },
    spo2NadirTiming: {
      label: 'SpO₂ Nadir Timing',
      unit: 'h',
      goodDirection: '',
      depth: 'secondary',
      evidence: 'measured',
      cite: 'Hours from recording start of the first and last detected desaturation nadir — a readout of event times'
    },
    spo2SampEn: {
      label: 'SpO₂ SampEn',
      unit: '',
      goodDirection: '',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Sample entropy of the SpO2 series — an established complexity measure applied to oximetry, a transfer this suite has not validated'
    },
    spo2HrDecouplingPct: {
      label: 'SpO₂–HR Decoupling %',
      unit: '%',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'experimental',
      cite: 'Percentage of 30-s windows in which SpO2 and HR move in opposite directions (oxydex-dsp.js:1654) — a constructed agreement statistic, not a sensed quantity'
    },
    spo2HrLag: {
      label: 'SpO₂–HR Lag',
      unit: 's',
      goodDirection: '',
      depth: 'research',
      evidence: 'experimental',
      cite: 'MEDIAN of per-window argmax SpO2-HR cross-correlation lag, searched over 0-120 s (oxydex-dsp.js:5085) — an estimate, not a sensed quantity'
    },
    spo2StableWindows: {
      label: 'Stable SpO₂ Windows',
      unit: 'count',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Count of 5-min windows with SpO2 SD < 1% (oxydex-dsp.js:1566) — a single tuned threshold'
    },
    uarsScore: {
      label: 'UARS Score',
      unit: '/3',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'experimental',
      cite: 'Constructed 0-3 indicator count for upper-airway resistance (cycle <40 s + AAI>=3 + low-ODI/oscillations + SFI>=2). Not a likelihood and not validated'
    },
    vagalIndex: {
      label: 'Vagal Index',
      unit: '',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Weighted composite of pNN3, HR floor and longest clean run — a bespoke construction with authored weights'
    },
    worst10MinSpo2: {
      label: 'Worst 10-min SpO₂',
      unit: '%',
      goodDirection: 'up',
      depth: 'secondary',
      evidence: 'measured',
      cite: 'Lowest mean SpO2 over any 10-min sliding window — a readout of sensed SpO2'
    },
    worst30MinT95: {
      label: 'Worst 30-min T95',
      unit: '%',
      goodDirection: 'down',
      depth: 'secondary',
      evidence: 'heuristic',
      cite: 'Highest T95 over any 30-min rolling window; T95 itself is a threshold statistic (time below 95%)'
    }
  };

  /* ── Alias map: UI label (as rendered today) → registry id ─────────────────
   Lets the render helpers resolve a badge from the EXISTING label string with
   zero call-site churn (Preservation Rule). Match is case/space-insensitive on
   the normalized label; aliases cover UI variants ("ODI-4 Rate" → odi4). */
  var OXY_LABEL_ALIAS = {
    // §6.5 — the labels these metrics actually render with
    mos: 'mos',
    'δ-index': 'deltaIndex',
    'delta index': 'deltaIndex',
    'pb episodes': 'pbEpisodes',
    'spo₂ oscillation index': 'oscIndex',
    'spo2 oscillation index': 'oscIndex',
    'episode range': 'episodeRange',
    'periodicity pattern': 'periodicityPattern',
    pnn3: 'pnn3',
    aai: 'aai',
    wtdsi: 'wtdsi',
    sfi: 'sfi',
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
    /* aliases for the 2026-08-16 adjudication — see the block above */
    'stability r²': 'stabilityR2',
    trend: 'scoreTrend',
    'spo2 night cv': 'spo2NightCV',
    'pb trend': 'pbTrend',
    'poor nights (<50)': 'poorNightsPct',
    'odi-4 δ (first→last)': 'odi4Delta',
    'sol trend': 'solTrend',
    'pos shifts': 'posShifts',
    lcsp: 'lcsp',
    'rem ~est': 'remProxy',
    'deep ~est': 'deepProxy',
    'hr rest': 'hrRest',
    'hr max': 'hrMaxKpi',
    confidence: 'vo2Conf',
    dfa: 'dfaAlpha1',
    ssi: 'ssiIdx',
    cdi: 'cdiIdx',
    hypload: 'hypLoad',
    recidx: 'recIdx',
    oxycrash: 'oxyCrash',
    'spo₂ cov': 'spo2CoV',
    't-auc wt': 'tAucWeighted',
    'auc-90 rate': 'auc90Rate',
    'dip-3/hr': 'dip3Rate',
    'nadir count': 'nadirCount',
    'nadir depth': 'nadirDepth',
    'nadir recov': 'nadirRecov',
    circadian: 'circadianScore',
    'decel cap': 'decelCap',
    apen: 'apEn',
    bradycardia: 'bradyCount',
    tachycardia: 'tachyCount',
    'waso win': 'wasoWindows',
    'ultradian cycles': 'ultradianCycles',
    'hr valleys': 'ultradianValleys',
    'crc index': 'crcIdx',
    'pb diverge': 'pbDivergeCount',
    'diverge %': 'pbDivergePct',
    coupling: 'couplingScore',
    'spo₂ iqr': 'spo2IQR',
    'cond mean': 'condMeanBelow94',
    'cond %': 'condPctBelow94',
    /* BOTH SPELLINGS RESOLVE. The depth-shaped labels ('nadir<4%' …) were what the render displayed
       until 2026-09-02, when they were corrected to the LEVEL the code actually bins on; they stay
       here so any surface still carrying the old string keeps its badge instead of falling through to
       the fabricated-`experimental` path. New labels added beside them, not instead of them. */
    'nadir >91%': 'nadirBinLt4',
    'nadir 90-91%': 'nadirBin46',
    'nadir 88-89%': 'nadirBin69',
    'nadir <88%': 'nadirBinGt9',
    'odi-4 / ahi est': 'ahiEst',
    'nadir<4%': 'nadirBinLt4',
    'nadir 4-6': 'nadirBin46',
    'nadir 6-9': 'nadirBin69',
    'nadir>9%': 'nadirBinGt9',
    'rmssd proxy': 'rmssdProxy',
    'hr iqr': 'hrIQR',
    'pb hr δ': 'hrPbContrast',
    'mean hr pb': 'meanHrPb',
    'mean hr rest': 'meanHrRest',
    'pnn3-equiv': 'pnn3Equiv',
    'rsa proxy': 'rsaProxy',
    'breaths/min': 'breathsPerMin',
    'rsa peak freq': 'rsaPeakFreq',
    'rsa power': 'rsaPeakPow',
    'flagged windows': 'oscEpisodeCount',
    'peak crossings': 'oscPeakCrossings',
    'restless windows': 'restlessWindows',
    'arousal index': 'arousalIndex',
    'total burden': 'hbTotal',
    'burden rate': 'hbRate',
    'frag index': 'sfi',
    'motion %': 'motion',
    'nsi mean': 'nsi',
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
    /* OXYDEX-FFT-CYCLE-NULL §6 — the CSV headers and the reference guide's card title. The guide names
       the card "SpO₂ FFT" with the formula "Dominant Frequency (DFT)", so both spellings of the
       subscript are covered: `_norm` lowercases but does not fold ₂ to 2, and the guide emits the HTML
       entity, so a reader copying either form resolves. */
    'fft cycle length': 'peakCycSec',
    'fft cycle length (s)': 'peakCycSec',
    'fft peak freq': 'peakFreqHz',
    'fft peak freq (hz)': 'peakFreqHz',
    'spo₂ fft': 'peakFreqHz',
    'spo2 fft': 'peakFreqHz',
    'dominant frequency (dft)': 'peakFreqHz',
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
  var _labelIdx = null; // lazy label→id index, built once (see idForLabel)
  function idForLabel(label) {
    /* AN EXACT REGISTRY ID RESOLVES TO ITSELF (DEEP-AUDIT-V Tier 3.5 — the camelCase blind spot).
       `_norm` LOWERCASES, so a render site passing a real registry id — `evBadge('usageHours')` —
       normalised to `usagehours`, matched no key and no alias, and fell through to
       `badgeForLabel`'s fabricated-`experimental` fallback. The registry had the metric all along
       and graded it properly: CPAPDex's `residualAHI` and `usageHours` are `measured` and rendered
       `experimental` — a TWO-tier under-grade on the two headline therapy numbers, silent because
       the fallback bypasses `MetricRegistry.entry`'s console.warn. Checking the RAW label first
       only ADDS resolution for tokens that are literally registry keys; every prose label still
       takes the normalise-then-alias path exactly as before. Applied to all EIGHT registry clones
       together — a lone fixed sibling is how the next audit re-finds half of one bug. */
    if (label != null && OXY_REGISTRY[label]) return String(label);
    var k = _norm(label);
    if (OXY_REGISTRY[k]) return k; // already an id
    if (OXY_LABEL_ALIAS[k]) return OXY_LABEL_ALIAS[k];
    /* A REGISTRY ENTRY'S OWN `label` IS AN AUTHORITY (DEEP-AUDIT-V §2.8). Resolution checked the key
       and the alias map but never the entries' declared labels — so OXY_REGISTRY.meanPi, whose label
       is literally 'Perfusion Idx' and whose grade is `measured`, did not resolve from that exact
       string and rendered a fabricated `experimental` disc. Matching an entry to its own label
       invents nothing; it uses the grade the registry already declared. Built lazily and cached, and
       it runs LAST so an explicit alias always wins. */
    if (!_labelIdx) {
      _labelIdx = {};
      for (var _lk in OXY_REGISTRY) {
        var _le = OXY_REGISTRY[_lk];
        if (_le && _le.label) {
          var _ln = _norm(_le.label);
          if (_ln && !(_ln in _labelIdx)) _labelIdx[_ln] = _lk;
        }
      }
    }
    return _labelIdx[k] || null;
  }

  /* Pure metadata labels (not metrics) — never badge these even with fallback. */
  /* `best night` / `worst night` render a DATE (`bestNight.date`), and `hr range` renders
     `minHr + '–' + maxHr` — TWO separately-registered `measured` metrics in one field, which is the
     chart-caption rule (§🎫) arriving in a KPI. None of the three is a measurement that can carry one
     tier, so they are denied rather than tiered. Owner-ratified 2026-08-16. */
  var _META_DENY = { date: 1, start: 1, end: 1, source: 1, 'sample rate': 1, recording: 1, 'active flags': 1, 'best night': 1, 'worst night': 1, 'hr range': 1 };

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
