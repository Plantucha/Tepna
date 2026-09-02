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
    /* 🔓 WAS FLAGGED DORMANT — AND THE FLAG WAS FALSE (DEEP-AUDIT-VI F4, 2026-09-01). `dormant: true`
       asserts "no compute site exists, so the metric reaches no export and no surface". This metric is
       computed in `ECGDSP.accExtras` (`rracc`/`rraccSummary`) and surfaced by `_accCardRR` — both since
       the initial commit, 2026-07-01 — while the flag arrived 2026-08-18 (#1455) claiming a sweep had
       "confirmed per-name — id, label and every alias". It was wrong when it was written, not stale:
       the sweep examined something other than the surfaces it reported on.
       THE FLAG'S OWN CONTRACT says promotion means removing it AND re-adjudicating the grade. So the
       grade was adjudicated, by measurement rather than by inheritance — and it went DOWN.
       MEASURED 2026-09-01 over 45 real H10 nights (whole smoketest corpus, longest ECG fragment per
       night with its ACC sibling, the shipped `accExtras` agreement block): RRacc vs the ECG-derived
       EDR respiration gives median r **0.07** (−0.34 … +0.58), median MAE **2.5 br/min** (0.92 … 4.37),
       median bias **+1.58**, limits of agreement typically **−4 … +7.5 br/min**, and a median **27 %**
       of paired 5-min epochs disagreeing by more than 3 br/min. Against a mean RRacc near 16 br/min
       those limits are ±44 %. The card's standing defence — that a low r reflects EDR's narrow nightly
       range and Bland–Altman governs when the spread is small — does not rescue it: by the statistic
       it nominates, the two do not agree. Full per-night table:
       docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md. `experimental` is what that supports. */
    rraccRate: {
      label: 'ACC Resp Rate',
      unit: 'br/min',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Respiration from chest-axis accelerometer FFT (0.15–0.45 Hz) — device-dependent surrogate. Against EDR over 45 real nights: median r 0.07, MAE 2.5 br/min, LoA −4…+7.5 br/min (docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md) — not cross-validated by the ECG'
    },
    edrAgreement: {
      label: 'RRacc–EDR Agreement',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Bland–Altman agreement of ACC-respiration vs ECG-derived respiration. It is the AGREEMENT STATISTIC, not a verdict — and measured over 45 real nights the verdict is negative (median r 0.07, LoA −4…+7.5 br/min on a ~16 br/min mean; docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md). Read the number; it does not certify either signal'
    },
    /* 🔓 WAS FLAGGED DORMANT — AND THE FLAG WAS FALSE, the same way (see `rraccRate` above). This one
       is surfaced by `_accCardAgreement` ("Disagreement", ecgdex-app.js) AND reaches the node export as
       `respiration.disagreementRatePct`, which is the second half of what `dormant` denies. The grade
       needs no re-adjudication: `heuristic` was already the honest tier for a >3 br/min rule of thumb,
       and the 45-night measurement (median 27 % of pairs over that threshold) is consistent with it. */
    edrDisagree: {
      label: 'EDR Disagreement',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'heuristic',
      cite: 'Share of paired epochs with |RRacc − EDR| > 3 br/min — an internal rule-of-thumb threshold flag, not a validated agreement statistic (Pearson r / MAE / bias are the agreement stats)'
    },
    /* THE ACC CARD'S POSTURE, registered so it can be badged (DEEP-AUDIT-VI F4). The card surfaces a
       named body position, a tilt angle and per-posture % pills — measurements reaching the eye, so
       the coverage mandate applies and they needed a graded id rather than a deny.
       `experimental`, inherited from the FLEET SIBLING rather than invented here: MotionDex's
       `supineFrac` grades the same gravity-vector quantity `experimental` because the device frame is
       uncalibrated and the named posture is a convention, not a measurement — and a chest strap adds
       mount-orientation dependence on top. The card's own prose has always said so ("Posture
       labelling depends on sensor mounting; tilt angle is mount-independent"); the badge now says it
       where the mandate requires, beside the number. */
    accPosture: {
      label: 'Body position',
      unit: '%',
      goodDirection: 'neutral',
      depth: 'basic',
      evidence: 'experimental',
      cite: 'Gravity-vector body position from the chest-strap accelerometer — UNCALIBRATED device frame, mount-orientation dependent; the named posture is a convention. Fleet sibling: MotionDex supineFrac, same quantity, same tier'
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
    hf: {
      label: 'HF power',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'validated',
      cite: 'High-frequency power (0.15–0.4 Hz) — parasympathetic band (Task Force 1996) · calibration corrected 2026-07-19 (§3.1)'
    },
    lf: {
      label: 'LF power',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'validated',
      cite: 'Low-frequency power (0.04–0.15 Hz) (Task Force 1996) · calibration corrected 2026-07-19 (§3.1)'
    },
    vlf: {
      label: 'VLF power',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'validated',
      cite: 'Very-low-frequency power — resolvable overnight (Task Force 1996) · calibration corrected 2026-07-19 (§3.1)'
    },
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
    /* ADJUDICATED emerging → experimental, 2026-09-02 (DEEP-AUDIT-VI-FOLLOWUPS §1.5, the sibling of
       #1455's `rraccRate` re-tier). Measured against the CPAP device's own mask-on `RespRate.2s`
       channel on 22 co-recorded nights (24 paired, 2 excluded as fallback-15), bands frozen before
       the run: MAE **1.90** br/min (bar ≤1.5) · Bland-Altman bias −1.01, LoA [−5.80, +3.78],
       width **9.58** (bar ≤6). Both fail, so the tier claim "externally validated" fails with them.
       ⚠️ `r` is NOT cited as evidence here: the reference varies by only 0.54 br/min SD across
       nights (14.8–16.8), so a correlation is suppressed by range restriction by construction —
       the honest statistics on a near-constant truth are the absolute-agreement ones.
       🔴 The decisive control: a CONSTANT 15.0 br/min — this metric's own hardcoded fallback
       (`ecgdex-dsp.js` respFromEDR) — scores MAE **0.80** against the same reference, and a
       constant 15.8 scores 0.42. The estimator is beaten by the constant it falls back to, with
       ~5× the reference's spread (est SD 2.50 vs 0.54) and misses to 7.4 and 20.0 br/min against a
       truth that never left 14.8–16.8. Directional only — which is what `experimental` means.
       NOTE the sibling `respRate` (line 54) is a DIFFERENT estimator (per-epoch median, not
       whole-record autocorrelation) and is NOT adjudicated by this measurement; it keeps its grade
       until measured on its own. */
    edrResp: {
      label: 'EDR resp rate',
      unit: 'br/min',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Respiration from R-peak amplitude modulation (EDR) — surrogate; re-tiered 2026-09-02 against CPAP RespRate on 22 nights (MAE 1.90, LoA width 9.58; a constant 15 scores MAE 0.80)'
    },

    /* CPC high-frequency coupling (Thomas 2005). ONLY HFC is registered, and the reason is the
       validation rather than the literature: across 39 nights paired to device-scored ResMed
       residualAHI (1.1-8.0, 7 abnormal-band), HFC falls with apnea burden at r = -0.408
       [-0.641, -0.106], p = 0.009, with Pearson and Spearman agreeing (-0.408 / -0.348) and
       surviving Bonferroni over the four predictors tested. It also beats the incumbent `cvhrIndex`,
       which does not correlate at all (r = -0.151, p = 0.36).
       LFC and VLFC are EXPORTED BUT DELIBERATELY UNREGISTERED. The published prediction that LFC
       rises with apnea burden did NOT hold here (r = -0.045, flat). VLFC is nominally positive
       (r = +0.356, p = 0.025) but fails Bonferroni, and its Pearson/Spearman diverge sharply
       (0.356 vs 0.138), which is the signature of a few high-leverage nights. Decisively, the three
       shares are COMPOSITIONAL — measured to sum to 100.0 +/- 0.1 per night — so HFC falling FORCES
       LFC+VLFC to rise; badging all three would publish one finding as three.
       `emerging`, not higher: this is one subject's corpus against a treated-apnea label, and
       CLAUDE.md §📚 forbids upgrading a badge on "the literature says". */
    cpcHfc: {
      label: 'CPC HFC',
      unit: '%',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Cardiopulmonary coupling, high-frequency band 0.10-0.40 Hz = stable NREM (Thomas 2005); validated here against device-scored residual AHI, r = -0.408, p = 0.009, n = 39'
    },

    /* ── EXPERIMENTAL — ECGDex composites / single-lead screens ────────────── */
    /* `estAHI` and `apneaRisk` RETIRED 2026-07-31 (ECGDEX-CARDIOPULMONARY-COUPLING §10). Both were
       `cvhrIndex` wearing AHI's units, cut-points and words; §9 measured `cvhrIndex` against
       device-scored residual AHI at r = −0.151 (p = 0.36) over 39 paired nights. `experimental` was
       the right TIER for an unvalidated proxy — but the tier ladder grades how well a metric is
       evidenced, not whether it is the quantity it claims to be, so no badge could have made
       "Est. AHI ≈ 7 /h · Mild" honest. The surviving apnea surfaces are `cvhrIndex` and `cpcHfc`,
       each named for what it measures. See ecgdex-profile.js for why nothing replaced them. */
    sigmaLnRmssd: { label: 'bσ(ln RMSSD)', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Within-window ln-RMSSD instability slope — ECGDex composite' },
    varLnRmssd: { label: 'bs²(ln RMSSD)', unit: '/h', goodDirection: 'down', depth: 'research', evidence: 'experimental', cite: 'Within-window ln-RMSSD variance slope — ECGDex composite' },
    /* `cite` records the NULL explicitly (FOLLOWUPS §4). This rides the `apnea` export block beside
       `cvhrIndex` and `cpc`, which is exactly the context that invites a reader to assume it tracks
       apnea burden. Measured against device-scored residual AHI over the same 39 paired nights that
       validated `cpcHfc`, it does not. Tier UNCHANGED — `experimental` never rested on an AHI claim
       — but the cite now says so, so nobody promotes it on the assumption. */
    surgeEsc: {
      label: 'Surge escalation',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Overnight CVHR-surge escalation trend — ECGDex composite. NOT an apnea-burden marker: r = −0.095 (p = 0.56) vs device-scored residual AHI, 39 nights'
    },

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
    // §6.5 — the ectopy chart card renders "PVC burden" and fell through to the `experimental`
    // fallback while the registry grades the metric `measured`. No new entry: an alias, so the card
    // inherits the graded tier by construction instead of minting its own.
    'pvc burden': 'ectopy',
    'pvc load': 'ectopy',
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
    // CPC HFC — only the HFC band is a registered metric (see the note at cpcHfc); LFC/VLFC are
    // exported unbadged, so they deliberately have NO alias and resolve to null.
    'cpc hfc': 'cpcHfc',
    hfc: 'cpcHfc',
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
    /* DEEP-AUDIT-V §2.8 F14 — the advanced table renders this label for `r.crc.plvDuringSurges /
       r.crc.plvBaseline`, i.e. the SAME phase-locking value `crcPLV` registers. Unresolved it took
       badgeForLabel's fabricated-`experimental` path, silently (that branch bypasses
       MetricRegistry.entry's console.warn) — while CPAPDex, the BORROWING node, renders the same
       quantity at `emerging` citing ECG_REGISTRY as the authority. The owner node under-graded what
       its own consumer graded correctly. Aliased to crcPLV (:173), NOT crCoupling — verified against
       the value the render site actually passes. */
    'plv surge vs base': 'crcPLV',
    'coupling strength': 'couplingStrength',
    'edr resp rate': 'edrResp',
    /* THE ACC CROSS-CHECK CARD'S OWN STRINGS (DEEP-AUDIT-VI F4). The card renders prose labels, not
       registry labels — 'ACC breathing', 'ECG/EDR breathing', 'Δ br/min' — so every one of them
       resolved to nothing and the chips shipped unbadged while the registry graded all three. Aliased
       to the ids that OWN each quantity, verified against the value each chip prints. */
    'acc breathing': 'rraccRate',
    'ecg/edr breathing': 'edrResp',
    'δ br/min': 'edrAgreement',
    'body position': 'accPosture',
    posture: 'accPosture',
    /* 'cvhr/h' is the hero subscore's short label. It resolves to `cvhrIndex` so that surface is
       BADGED — it previously read 'Apnea/h', which mapped to nothing, so the mandate-required badge
       silently rendered empty (CLAUDE.md §🎫). Retired alongside it: 'est. ahi' / 'apnea risk'. */
    'cvhr/h': 'cvhrIndex',
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
    if (label != null && ECG_REGISTRY[label]) return String(label);
    var k = _norm(label);
    if (ECG_REGISTRY[k]) return k;
    if (ECG_LABEL_ALIAS[k]) return ECG_LABEL_ALIAS[k];
    /* A REGISTRY ENTRY'S OWN `label` IS AN AUTHORITY (DEEP-AUDIT-V §2.8). Resolution checked the
       key and the alias map but never the entries' declared labels — so OXY_REGISTRY.meanPi,
       whose label is literally 'Perfusion Idx' and whose grade is `measured`, did not resolve
       from that exact string and rendered a fabricated `experimental` disc. Matching an entry
       to its own label invents nothing; it uses the grade the registry already declared. Built
       lazily and cached, and it runs LAST so an explicit alias always wins. */
    if (!_labelIdx) {
      _labelIdx = {};
      for (var _lk in ECG_REGISTRY) {
        var _le = ECG_REGISTRY[_lk];
        if (_le && _le.label) {
          var _ln = _norm(_le.label);
          if (_ln && !(_ln in _labelIdx)) _labelIdx[_ln] = _lk;
        }
      }
    }
    return _labelIdx[k] || null;
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
