/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · METRIC REGISTRY DATA  (ppgdex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to PpgDex — clone of oxydex-registry.js; SHARED logic lives in
   metric-registry.js. Labels mirror the ppgdex-app.js render + ppgdex-cross.js
   defs so the registry and the self-describing envelope never diverge.

   PpgDex = raw wrist-PPG → PPI → HRV + pulse-wave morphology. Optical pulse
   intervals give valid time-domain HRV; morphology/reflection indices are more
   device-dependent → emerging.

   Evidence (brief §3):
     measured     : direct optical/quality stats — Pulse HR, perfusion index, rise time,
                    motion-rejected %, % analyzable, correction %, mean SQI
     validated    : established HRV from PPI — rMSSD, SDNN, ln rMSSD, pNN50
     emerging     : device-dependent — dicrotic notch, augmentation index, CVHR index, DFA α1
     experimental : PpgDex composite — HRV Score
     heuristic    : population projections — VO₂max estimate (ANS age REMOVED
                    2026-06-21, external-review WP-A)
   Load AFTER metric-registry.js, BEFORE ppgdex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PPG_REGISTRY = {
    /* ── MEASURED — direct optical reading / quality statistic ─────────────── */
    hr: { label: 'Pulse HR', unit: 'bpm', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Mean heart rate — direct from pulse-peak intervals' },
    pi: { label: 'Perfusion Idx', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'AC/DC perfusion index — direct optical contact measure' },
    riseTime: { label: 'Rise time', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Foot→systolic-peak rise time — direct pulse-wave timing' },
    motion: { label: 'Motion-rejected', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'ACC+GYRO motion-gated rejection — direct quality stat' },
    // Waveform-derived SpO₂ trend (owner-ordered ship 2026-08-20; O2RING-RAW-DUAL-WAVELENGTH ④-REOPENED).
    // EXPERIMENTAL by definition: a per-session self-calibrated regression against the co-recorded device
    // SpO₂ (pooled corpus r 0.500), functional red+IR evidence only — never a replacement for device SpO₂.
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
    analyzable: { label: '% Analyzable', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Fraction of recording analyzable — direct coverage' },
    correction: { label: 'Correction', unit: '%', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'PPIs corrected during cleaning — direct quality stat' },
    meanSqi: { label: 'Mean SQI', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Mean signal-quality index — direct per-pulse quality' },
    cleanPulses: { label: 'Clean pulses', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: '% pulses with SQI ≥ 0.5 — direct quality statistic' },
    motionIdx: { label: 'Mean motion idx', unit: '', goodDirection: 'down', depth: 'advanced', evidence: 'measured', cite: 'Mean ACC-variance∪GYRO motion index — direct from inertial sensors' },
    accHz: { label: 'ACC Hz', unit: 'Hz', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Accelerometer sample rate — direct device statistic' },
    gyroHz: { label: 'GYRO Hz', unit: 'Hz', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Gyroscope sample rate — direct device statistic' },
    agreement: { label: 'Agreement', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'measured', cite: 'Self-PPI vs device-PPI mean agreement — direct validation statistic' },
    meanAbsDev: { label: 'Mean abs dev', unit: 'ms', goodDirection: 'down', depth: 'research', evidence: 'measured', cite: 'Self-vs-device mean absolute PPI deviation — direct' },
    meanPPI: { label: 'Mean PPI', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Mean pulse-to-pulse interval — direct from the optical waveform' },
    ledAgreement: {
      label: 'LED agreement',
      unit: '%',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'measured',
      cite: '3-LED optical consensus — % of kept beats where ≥2 of 3 photodiode channels place a systolic peak within ±50 ms (optical bSQI); direct quality statistic'
    },

    /* ── VALIDATED — established HRV from pulse-peak intervals ──────────────── */
    rmssd: { label: 'rMSSD', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'RMSSD — short-term parasympathetic HRV (Task Force 1996)' },
    sdnn: { label: 'SDNN', unit: 'ms', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'SDNN — overall HRV (Task Force 1996)' },
    /* The Allan-deviation slope of the disagreement between our beat detector and the device firmware's.
       EMERGING, not validated: overlapping Allan deviation is itself a standard, cited instrument
       (NIST SP 1065), but applying it to two DETECTORS rather than two oscillators is this suite's own
       construction and has no external validation behind it — the tier tracks the application, not the
       statistic. Deliberately not `measured`: it is an inference about detector noise, not a reading. */
    detectorStability: {
      label: 'Detector stability',
      unit: 'slope',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'Overlapping Allan deviation of the self-vs-firmware beat-time difference; slope names the noise type (Riley, NIST SP 1065, 2008)'
    },
    lnRMSSD: { label: 'ln rMSSD', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'Log-RMSSD — readiness HRV scale' },
    pnn50: { label: 'pNN50', unit: '%', goodDirection: 'up', depth: 'advanced', evidence: 'validated', cite: 'pNN50 — % successive PPI > 50 ms (Task Force 1996)' },
    sd1: { label: 'SD1', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD1 — short-term HRV (≈ RMSSD/√2)' },
    sd2: { label: 'SD2', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'validated', cite: 'Poincaré SD2 — long-term HRV dispersion' },
    triIdx: {
      label: 'Triangular index',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'validated',
      cite: 'HRV triangular index — geometric time-domain HRV (Task Force 1996); PPI-derived but robust, not subject to the PRV frequency-domain caveat'
    },

    /* ── EMERGING — published, device-dependent ────────────────────────────── */
    dicrotic: { label: 'Dicrotic notch', unit: '', goodDirection: 'up', depth: 'advanced', evidence: 'emerging', cite: 'Dicrotic-notch detection — pulse-wave reflection, device-dependent' },
    ai: { label: 'Aug. index', unit: '%', goodDirection: 'down', depth: 'research', evidence: 'emerging', cite: 'Augmentation index — arterial reflection, device-dependent' },
    reflectionIdx: {
      label: 'Reflection index',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'PPG reflection index (diastolic÷systolic peak) — wave reflection / stiffness proxy, device-dependent'
    },
    sdppgBA: {
      label: 'SDPPG b/a',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: '2nd-derivative PPG b/a ratio (Takazawa 1998) — arterial-stiffness/aging proxy, rises toward 0 with stiffness; device-dependent'
    },
    agingIdx: {
      label: 'Aging index',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'SDPPG aging index (b−c−d−e)/a (Takazawa 1998) — vascular-aging proxy, device-dependent'
    },
    notchTime: { label: 'Notch time', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Foot→dicrotic-notch timing — direct pulse-wave fiducial' },
    pulseWidth: { label: 'Pulse width', unit: 'ms', goodDirection: 'up', depth: 'research', evidence: 'measured', cite: 'Pulse width at half systolic amplitude — direct pulse-wave timing' },

    /* ── EXPERIMENTAL · FINGER SITE — same algorithm, DIFFERENT SITE ⇒ the grade is RE-EARNED ──
       PPGDEX-O2RING-FINGER-SITE §5, per CLAUDE.md §🎫 and LITERATURE-USE-POLICY: a tier is never
       inherited on "same code". These ids exist so the O2Ring finger pleth cannot silently pick up
       the Verity wrist entries above — note `notchTime`/`pulseWidth` sit at `measured` for the
       wrist, which is exactly the inheritance §5 forbids.

       Why the finger site enters LOWER, and it is NOT bit depth (§2.3 corrected that claim): the
       ring AC-couples and gain-normalises ON-DEVICE, so an UNKNOWN VENDOR TRANSFER FUNCTION sits in
       the chain. Shape metrics — notch timing, augmentation index, SDPPG derivatives — are exactly
       the quantities such a filter distorts, and it cannot be characterised from our side until the
       tri-device corpus is run. Timing/rate metrics are unaffected and keep their own grades: HR,
       PPI and rate-domain HRV come off the SAME audited pipeline and are NOT re-tiered here.
       Promote only on evidence that the finger pleth reproduces plausible fiducials. */
    /* ── DORMANT BY DESIGN — declared, graded, and NOT COMPUTED (21 entries) ────────────────────
       `dormant: true` marks a metric this registry PRE-DECLARES: the grade and citation are settled
       so that when the per-site split ships it inherits a reviewed tier instead of inventing one at
       the point of use. Nothing computes these, nothing renders them, and no guide card exists.

       WHY THE FLAG, rather than leaving the intent in the prose above: measured 2026-08-17, these 21
       are 32 % of this node's registry, and NOTHING machine-readable said so. A dormant grade can
       drift — a later edit, a fleet-wide tier sweep, a copy-paste from a live sibling — with no gate
       able to see that the entry was never in service. The flag makes the intent checkable, and
       `ppgdex · dormant-registry` asserts both halves: a dormant metric has NO guide card, and a
       non-dormant one is not silently parked.

       ⚠ DORMANT IS NOT A LOWER TIER. Each carries its real `evidence` (`experimental` here, for the
       reason the block below states — the ring's unknown on-device transfer function). Promotion is
       removing the flag when the metric ships, not editing the grade. */
    dicroticFinger: {
      dormant: true,
      label: 'Dicrotic notch (finger)',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Dicrotic-notch detection at the O2Ring FINGER site — unknown on-device transfer function; enters below the wrist grade until the tri-device corpus validates it (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    aiFinger: {
      dormant: true,
      label: 'Aug. index (finger)',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Augmentation index at the O2Ring FINGER site — reflection timing is site-sensitive AND filtered on-device; not the wrist-validated quantity (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    reflectionIdxFinger: {
      dormant: true,
      label: 'Reflection index (finger)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'PPG reflection index at the O2Ring FINGER site — diastolic÷systolic amplitude ratio, distorted by the ring’s on-device AC-coupling/gain normalisation (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    sdppgBAFinger: {
      dormant: true,
      label: 'SDPPG b/a (finger)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: '2nd-derivative PPG b/a (Takazawa 1998) at the O2Ring FINGER site — a 2nd derivative amplifies any unknown filter in the chain, so the wrist’s emerging grade is not inherited (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    agingIdxFinger: {
      dormant: true,
      label: 'Aging index (finger)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'SDPPG aging index (b−c−d−e)/a (Takazawa 1998) at the O2Ring FINGER site — same 2nd-derivative caveat as sdppgBAFinger (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    notchTimeFinger: {
      dormant: true,
      label: 'Notch time (finger)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Foot→dicrotic-notch timing at the O2Ring FINGER site — the wrist entry is `measured`, which a site change does NOT confer: notch LOCATION is what an unknown on-device filter moves (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    pulseWidthFinger: {
      dormant: true,
      label: 'Pulse width (finger)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Pulse width at half systolic amplitude, O2Ring FINGER site — amplitude-referenced, so on-device gain normalisation moves the half-amplitude crossing (PPGDEX-O2RING-FINGER-SITE §5)'
    },
    /* ── ANKLE site (PPGDEX-SITE-WIRING §2) ──────────────────────────────────────────────────────
       A Verity Sense is a STRAP. On this deployment it is worn on the LEFT ANKLE, and the parser
       cannot recover that from the waveform — three optical columns say "Verity", not "wrist".

       The ankle is not a milder wrist. It sits much further along the arterial tree, so the
       reflected wave returns at a different delay relative to the systolic peak, and the vessels
       are stiffer and smaller. Every quantity below is DEFINED by that relationship, so a
       wrist-validated grade does not survive the move — the same §5 reasoning that put the O2Ring
       finger entries below the wrist, for a different physical reason (there it was an unknown
       on-device filter; here it is a genuinely different pulse). Timing/rate metrics are again
       untouched: HR, PPI and rate-domain HRV come off the same audited pipeline and do not care
       where on the body the beat was seen. */
    dicroticAnkle: {
      dormant: true,
      label: 'Dicrotic notch (ankle)',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Dicrotic-notch detection at an ANKLE site — notch visibility falls with distance from the heart and rising vessel stiffness; the wrist grade is not inherited (PPGDEX-SITE-WIRING §2)'
    },
    aiAnkle: {
      dormant: true,
      label: 'Aug. index (ankle)',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Augmentation index at an ANKLE site — AI is DEFINED by reflected-wave arrival relative to the systolic peak, and that timing is exactly what moves down the arterial tree; not the wrist-validated quantity (PPGDEX-SITE-WIRING §2)'
    },
    reflectionIdxAnkle: {
      dormant: true,
      label: 'Reflection index (ankle)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'PPG reflection index at an ANKLE site — diastolic÷systolic amplitude ratio, and the reflection it measures is site-determined (PPGDEX-SITE-WIRING §2)'
    },
    sdppgBAAnkle: {
      dormant: true,
      label: 'SDPPG b/a (ankle)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: '2nd-derivative PPG b/a (Takazawa 1998) at an ANKLE site — Takazawa\u2019s norms are finger-derived and a 2nd derivative amplifies any waveform difference; the wrist grade is not inherited (PPGDEX-SITE-WIRING §2)'
    },
    agingIdxAnkle: {
      dormant: true,
      label: 'Aging index (ankle)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'SDPPG aging index (b−c−d−e)/a (Takazawa 1998) at an ANKLE site — same site-transfer caveat as sdppgBAAnkle (PPGDEX-SITE-WIRING §2)'
    },
    notchTimeAnkle: {
      dormant: true,
      label: 'Notch time (ankle)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Foot→dicrotic-notch timing at an ANKLE site — the wrist entry is `measured`, which a site change does NOT confer: notch timing is the single quantity most directly moved by arterial distance (PPGDEX-SITE-WIRING §2)'
    },
    pulseWidthAnkle: {
      dormant: true,
      label: 'Pulse width (ankle)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Pulse width at half systolic amplitude, ANKLE site — peripheral pulses broaden and steepen with distance, so the wrist `measured` grade does not transfer (PPGDEX-SITE-WIRING §2)'
    },
    /* ── ASSUMED site — the site was NEVER OBSERVED (PPGDEX-SITE-WIRING §3) ──────────────────────
       `site` is derived from the file LAYOUT: 3 optical columns ⇒ "wrist". That identifies the
       DEVICE (a Verity Sense), not the limb. A strap goes where the wearer puts it, and this
       deployment's went on an ankle while being labelled wrist throughout.

       So when `siteSource` is not `declared`, the site is an assumption, and a site-sensitive
       metric cannot hold a site-validated tier on an assumption. These entries are what an
       undeclared wrist resolves to. They sit at `experimental` because an unknown site could be
       ANY site, so the honest grade is the weakest the metric could deserve.

       Note the deliberate asymmetry with the FINGER entries, which do NOT require a declaration:
       a 1-column O2Ring pleth comes from a finger ring, so there the layout really does fix the
       site. Wrist is the only site this suite infers that the hardware does not guarantee. */
    dicroticAssumed: {
      dormant: true,
      label: 'Dicrotic notch (site assumed)',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Dicrotic-notch detection with the optical site ASSUMED, not observed — the wrist grade rests on a limb nobody confirmed; declare the site to earn it back (PPGDEX-SITE-WIRING §3)'
    },
    aiAssumed: {
      dormant: true,
      label: 'Aug. index (site assumed)',
      unit: '%',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Augmentation index with the optical site ASSUMED — AI is site-defined, so a wrist tier on an unconfirmed limb is a grade the metric did not earn (PPGDEX-SITE-WIRING §3)'
    },
    reflectionIdxAssumed: {
      dormant: true,
      label: 'Reflection index (site assumed)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'PPG reflection index with the optical site ASSUMED — the reflection it measures is site-determined (PPGDEX-SITE-WIRING §3)'
    },
    sdppgBAAssumed: {
      dormant: true,
      label: 'SDPPG b/a (site assumed)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: '2nd-derivative PPG b/a with the optical site ASSUMED — Takazawa norms are site-specific (PPGDEX-SITE-WIRING §3)'
    },
    agingIdxAssumed: {
      dormant: true,
      label: 'Aging index (site assumed)',
      unit: '',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'experimental',
      cite: 'SDPPG aging index with the optical site ASSUMED — same site-transfer caveat as sdppgBAAssumed (PPGDEX-SITE-WIRING §3)'
    },
    notchTimeAssumed: {
      dormant: true,
      label: 'Notch time (site assumed)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Foot→dicrotic-notch timing with the optical site ASSUMED — `measured` is a claim about a KNOWN fiducial at a KNOWN site (PPGDEX-SITE-WIRING §3)'
    },
    pulseWidthAssumed: {
      dormant: true,
      label: 'Pulse width (site assumed)',
      unit: 'ms',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Pulse width at half systolic amplitude with the optical site ASSUMED — pulse shape is site-determined (PPGDEX-SITE-WIRING §3)'
    },
    sd1sd2: { label: 'SD1/SD2', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Poincaré SD1/SD2 ratio — nonlinear short/long-term HRV balance' },
    ellArea: { label: 'Ellipse area', unit: 'ms²', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'Poincaré ellipse area — overall HRV dispersion (geometric)' },
    cvhrIndex: { label: 'CVHR index', unit: '/h', goodDirection: 'down', depth: 'advanced', evidence: 'emerging', cite: 'Cyclical-variation-of-HR index — PPI apnea surrogate' },
    dfaAlpha1: { label: 'DFA α1', unit: '', goodDirection: 'up', depth: 'research', evidence: 'emerging', cite: 'DFA short-term scaling exponent — device/length-dependent' },
    /* Frequency-domain (Lomb–Scargle on PPI = pulse-rate variability). Established HRV method
     (Task Force 1996) BUT PPG-PRV freq-domain is device/motion-dependent and not interchangeable
     with ECG-HRV — esp. LF & under sympathetic load (Schäfer & Vagedes 2013, Int J Cardiol 166:15)
     → emerging, not validated. Time-domain HRV above stays validated; geometric Tri-index too. */
    vlf: {
      label: 'VLF',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'VLF power (Lomb–Scargle, PPI) — PRV freq-domain; needs long records, least reliable in short PPG (Schäfer & Vagedes 2013) · calibration corrected 2026-07-19 (§3.1)'
    },
    lf: {
      label: 'LF',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'LF power (Lomb–Scargle, PPI) — PRV freq-domain, device/motion-dependent vs ECG-HRV (Schäfer & Vagedes 2013) · calibration corrected 2026-07-19 (§3.1)'
    },
    hf: {
      label: 'HF',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'HF power (Lomb–Scargle, PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013) · calibration corrected 2026-07-19 (§3.1)'
    },
    lfhf: {
      label: 'LF/HF',
      unit: '',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'emerging',
      cite: 'LF/HF sympatho-vagal balance (PPI) — PRV freq-domain diverges from ECG-HRV under load (Schäfer & Vagedes 2013)'
    },
    lfnu: {
      label: 'LF n.u.',
      unit: 'n.u.',
      goodDirection: 'down',
      depth: 'research',
      evidence: 'emerging',
      cite: 'LF normalized units (PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)'
    },
    hfnu: {
      label: 'HF n.u.',
      unit: 'n.u.',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'HF normalized units (PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)'
    },
    totalPower: {
      label: 'Total power',
      unit: 'ms²',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Total spectral power (Lomb–Scargle, PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)'
    },
    sampEn: {
      label: 'SampEn',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'emerging',
      cite: 'Sample entropy — nonlinear regulatory complexity (Richman & Moorman 2000); length/parameter-dependent'
    },

    /* ── EXPERIMENTAL — PpgDex composite ───────────────────────────────────── */
    hrvScore: { label: 'HRV Score', unit: '', goodDirection: 'up', depth: 'basic', evidence: 'experimental', cite: 'PpgDex autonomic-readiness composite — internal' },

    /* ── HEURISTIC — population projection / proxy ─────────────────────────── */
    /* ANS Age REMOVED 2026-06-21 (external-review WP-A) — a population age
     regression. VO₂ retained at research depth. The validated rMSSD/SDNN PPG
     HRV bench carries the autonomic story. */
    vo2: { label: 'VO₂max Est', unit: 'ml/kg/min', goodDirection: 'up', depth: 'research', evidence: 'heuristic', cite: 'HR-ratio VO₂max estimate — population proxy, not CPET' },
    posture: {
      label: 'Posture',
      unit: '',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'heuristic',
      cite: 'limb-acc orientation proxy for body position; wear-site not auto-detected, low reliability'
    }
  };

  var PPG_LABEL_ALIAS = {
    'pulse hr': 'hr',
    'mean hr': 'hr',
    hr: 'hr',
    'pulse rate': 'hr',
    'perfusion idx': 'pi',
    perfusion: 'pi',
    'perfusion index': 'pi',
    'perfusion %': 'pi',
    'rise time': 'riseTime',
    'motion-rejected': 'motion',
    'motion-rej': 'motion',
    'motion rejected': 'motion',
    '% analyzable': 'analyzable',
    analyzable: 'analyzable',
    correction: 'correction',
    'correction rate': 'correction',
    'mean sqi': 'meanSqi',
    'clean pulses': 'cleanPulses',
    'clean beats': 'cleanPulses',
    'mean motion idx': 'motionIdx',
    'motion idx': 'motionIdx',
    'pulses rejected': 'motion',
    'acc hz': 'accHz',
    'gyro hz': 'gyroHz',
    agreement: 'agreement',
    'mean abs dev': 'meanAbsDev',
    'mean ppi': 'meanPPI',
    'led agreement': 'ledAgreement',
    ledagreement: 'ledAgreement',
    '3-led agreement': 'ledAgreement',
    '3-led consensus': 'ledAgreement',
    'led consensus': 'ledAgreement',
    'led agree': 'ledAgreement',
    '3-led agree': 'ledAgreement',
    rmssd: 'rmssd',
    sdnn: 'sdnn',
    'detector stability': 'detectorStability',
    'ln rmssd': 'lnRMSSD',
    pnn50: 'pnn50',
    sd1: 'sd1',
    sd2: 'sd2',
    'sd1/sd2': 'sd1sd2',
    sd1sd2: 'sd1sd2',
    'ellipse area': 'ellArea',
    'dicrotic notch': 'dicrotic',
    'aug. index': 'ai',
    'augmentation index': 'ai',
    'aug index': 'ai',
    'reflection index': 'reflectionIdx',
    'reflection idx': 'reflectionIdx',
    'sdppg b/a': 'sdppgBA',
    'sdppg ba': 'sdppgBA',
    'b/a': 'sdppgBA',
    'b/a ratio': 'sdppgBA',
    'aging index': 'agingIdx',
    agi: 'agingIdx',
    'notch time': 'notchTime',
    'pulse width': 'pulseWidth',
    'cvhr index': 'cvhrIndex',
    'dfa α1': 'dfaAlpha1',
    'dfa a1': 'dfaAlpha1',
    'triangular index': 'triIdx',
    'tri index': 'triIdx',
    'tri idx': 'triIdx',
    vlf: 'vlf',
    lf: 'lf',
    hf: 'hf',
    'lf/hf': 'lfhf',
    lfhf: 'lfhf',
    'lf n.u.': 'lfnu',
    'lf nu': 'lfnu',
    'hf n.u.': 'hfnu',
    'hf nu': 'hfnu',
    'total power': 'totalPower',
    sampen: 'sampEn',
    'sample entropy': 'sampEn',
    'hrv score': 'hrvScore',
    'vo₂max est': 'vo2',
    'vo2max est': 'vo2',
    'est. vo₂max': 'vo2',
    'est. vo2max': 'vo2',
    'est vo₂max': 'vo2',
    posture: 'posture',
    'limb orientation': 'posture',
    'limb position': 'posture'
  };

  function _norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
    if (label != null && PPG_REGISTRY[label]) return String(label);
    var k = _norm(label);
    if (PPG_REGISTRY[k]) return k;
    if (PPG_LABEL_ALIAS[k]) return PPG_LABEL_ALIAS[k];
    /* A REGISTRY ENTRY'S OWN `label` IS AN AUTHORITY (DEEP-AUDIT-V §2.8). Resolution checked the
       key and the alias map but never the entries' declared labels — so OXY_REGISTRY.meanPi,
       whose label is literally 'Perfusion Idx' and whose grade is `measured`, did not resolve
       from that exact string and rendered a fabricated `experimental` disc. Matching an entry
       to its own label invents nothing; it uses the grade the registry already declared. Built
       lazily and cached, and it runs LAST so an explicit alias always wins. */
    if (!_labelIdx) {
      _labelIdx = {};
      for (var _lk in PPG_REGISTRY) {
        var _le = PPG_REGISTRY[_lk];
        if (_le && _le.label) {
          var _ln = _norm(_le.label);
          if (_ln && !(_ln in _labelIdx)) _labelIdx[_ln] = _lk;
        }
      }
    }
    return _labelIdx[k] || null;
  }

  var _META_DENY = {
    date: 1,
    start: 1,
    'start (wall clock)': 1,
    end: 1,
    source: 1,
    'sample rate': 1,
    recording: 1,
    'active flags': 1,
    channel: 1,
    'channel used': 1,
    'pulses detected': 1,
    duration: 1,
    tier: 1
  };

  /* Site-aware: resolves the label to its id, then re-scopes that id onto the ACTIVE site before
     asking MetricRegistry for a disc. With no active site set this is identical to the old path. */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(PPG_REGISTRY, idForSite(id, ACTIVE.site, ACTIVE.siteSource));
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(PPG_REGISTRY, id).depth : null;
  }

  // ── SITE SCOPING (PPGDEX-O2RING-FINGER-SITE §5) ───────────────────────────────────────────────
  //  Map a base metric id onto its site-scoped entry. `site` comes from the PARSER (a layout fact —
  //  3 optical columns = wrist, 1 = finger), never from a guess.
  //  Deliberately CONSERVATIVE: only ids with a real `<id>Finger` entry are re-scoped. Everything
  //  else — HR, PPI, rate-domain HRV, the quality statistics — falls through to the base id on
  //  purpose, because those come off the same audited pipeline and a site change does not weaken
  //  them. The failure this prevents runs one way only: a finger number wearing a wrist grade.
  var SITE_SUFFIX = { finger: 'Finger', ankle: 'Ankle' };

  /*  `siteSource` is the third arg and OPTIONAL, per CLAUDE.md's back-compat rule — an existing
      two-arg call keeps its exact former meaning.

      THE ASYMMETRY, which is the whole point. `site` is derived from the file LAYOUT, and that
      identifies the DEVICE, not the limb:
        · 1 optical column  ⇒ an O2Ring, which IS a finger ring. The layout really does fix the
          site, so `finger` re-scopes with or without a declaration.
        · 3 optical columns ⇒ a Verity Sense, which is a STRAP and goes wherever the wearer puts
          it. On this deployment that is the LEFT ANKLE, labelled `wrist` throughout. So `wrist`
          is the one site this suite infers that the hardware does not guarantee, and it must be
          DECLARED before it can carry a wrist-validated tier.
      Hence: an undeclared wrist resolves to the `<id>Assumed` entry, not the base id. */
  function idForSite(id, site, siteSource) {
    if (!id || !site) return id;
    var suffix = SITE_SUFFIX[site];
    if (!suffix && site === 'wrist' && siteSource && siteSource !== 'declared') suffix = 'Assumed';
    if (!suffix) return id;
    var scoped = id + suffix;
    return Object.prototype.hasOwnProperty.call(PPG_REGISTRY, scoped) ? scoped : id;
  }
  function badgeForSite(id, site, siteSource) {
    if (!global.MetricRegistry) return '';
    var d = global.MetricRegistry.entry(PPG_REGISTRY, idForSite(id, site, siteSource));
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  /*  AMBIENT ACTIVE SITE — the fix for the defect that motivated all of the above.
      `idForSite` existed, was gated by the suite, and had NO CALLER: every rendered badge went
      through `badgeForLabel` → `idForLabel` → the BASE id, so an O2Ring finger recording drew the
      wrist grade and the §5 downgrade reached exactly zero pixels. Threading a site argument
      through every `evBadge(label)` call site would have missed the ones nobody enumerated — which
      is how the first hole opened. An ambient site consulted INSIDE `badgeForLabel` closes all of
      them at once, including call sites added later. PpgDex renders one session at a time, so the
      app sets this once per render; `null` restores the pre-existing label-only behaviour. */
  var ACTIVE = { site: null, siteSource: null };
  function setActiveSite(site, siteSource) {
    ACTIVE.site = site || null;
    ACTIVE.siteSource = siteSource || null;
  }
  function activeSite() {
    return { site: ACTIVE.site, siteSource: ACTIVE.siteSource };
  }

  global.PPG_REGISTRY = PPG_REGISTRY;
  global.PpgRegistry = {
    REGISTRY: PPG_REGISTRY,
    ALIAS: PPG_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel,
    idForSite: idForSite,
    badgeForSite: badgeForSite,
    setActiveSite: setActiveSite,
    activeSite: activeSite
  };
})(window);
