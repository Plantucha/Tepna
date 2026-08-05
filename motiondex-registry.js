/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   MotionDex · METRIC REGISTRY DATA  (motiondex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to MotionDex — sibling of glucodex-registry.js; SHARED logic lives in
   metric-registry.js. MotionDex has no *-cross.js (yet); labels mirror the
   motiondex-app.js KPI grid + metrics table.

   Evidence tiers (honest, NOT over-claimed — MOTIONDEX-BUILD §3):
     measured     : frame-INVARIANT direct statistics — activity counts, movement
                    index, immobile time, signal quality/confidence, coverage.
     experimental : frame-DEPENDENT or surrogate — body-position dwell (uncalibrated
                    device frame; the named-posture mapping is a convention, not
                    device-validated — Rocha'26 would lift it to measured AFTER a
                    calibration step this node does not yet do), respiratory-effort
                    rate/amplitude (chest-ACC surrogate, Ryser'22).
     emerging     : (none at birth — sleep/wake staging is an Integrator FUSION that
                    consumes this export, not a single-signal MotionDex metric).
   Classic module (executed classically by both test runners for registry-defs-parity;
   a top-level `export` here is an immediate SyntaxError there — keep it classic).
   Load AFTER metric-registry.js, BEFORE motiondex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var MOTION_REGISTRY = {
    /* ── MEASURED — frame-invariant direct statistics / coverage / quality ─── */
    activityCounts: {
      label: 'Activity counts',
      unit: '',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Σ de-gravitated acceleration over the night — direct actigraphic statistic'
    },
    movementIndex: { label: 'Movement index', unit: '', goodDirection: 'down', depth: 'basic', evidence: 'measured', cite: 'Mean per-epoch activity count — direct (lower = more restful)' },
    immobileFrac: { label: 'Immobile time', unit: '%', goodDirection: 'up', depth: 'basic', evidence: 'measured', cite: 'Fraction of 30 s epochs below the movement threshold — direct' },
    sqiConf: {
      label: 'Signal quality',
      unit: '×',
      goodDirection: 'up',
      depth: 'advanced',
      evidence: 'measured',
      cite: 'Motion SQI (clip / flatline / sensor-off) → Ganglior conf — direct quality statistic'
    },

    /* ── EXPERIMENTAL — frame-dependent (uncalibrated) or surrogate ────────── */
    supineFrac: {
      label: 'Supine time',
      unit: '%',
      goodDirection: 'down',
      depth: 'basic',
      evidence: 'experimental',
      cite: 'Gravity-vector body position (Rocha 2026) — UNCALIBRATED device frame; posture label is a convention. Lower supine = positional-OSA target'
    },
    uprightFrac: {
      label: 'Upright time',
      unit: '%',
      goodDirection: 'down',
      depth: 'advanced',
      evidence: 'experimental',
      cite: 'Gravity-vector upright dwell — a coarse wake/out-of-bed proxy (uncalibrated frame)'
    },
    lateralFrac: { label: 'Lateral time', unit: '%', goodDirection: 'up', depth: 'research', evidence: 'experimental', cite: 'Gravity-vector left/right dwell (uncalibrated frame)' },
    respRate: {
      label: 'Respiratory rate',
      unit: 'br/min',
      goodDirection: 'down',
      depth: 'advanced',
      /* emerging, NOT validated: real-corpus validated (26 nights / 172 h / 19,193 epochs of
         chest ACC vs ResMed CPAP `Flow.40ms` breath-by-breath reference — MAE 1.01 br/min,
         95% CI 0.91–1.12; 91.6% within 2 br/min) but on a SINGLE subject, which does not meet
         the Literature-Use Policy bar for `validated`. Posture robustness is untested (corpus
         gravity-roll IQR 13.1–17.9°, i.e. one posture). */
      evidence: 'emerging',
      cite: 'Chest-ACC spectral ridge tracking (Viterbi) validated against CPAP flow, 26 nights — MAE 1.01 br/min; time-domain blend per Charlton 2016, Physiol Meas 37(4):610'
    },
    effortAmp: {
      label: 'Effort amplitude',
      unit: 'g',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'RMS of the 0.1–0.6 Hz chest-ACC effort waveform (Ryser 2022) — surrogate'
    },
    effortPresent: {
      label: 'Effort present',
      unit: '%',
      goodDirection: 'up',
      depth: 'research',
      evidence: 'experimental',
      cite: 'Fraction of recorded epochs with detectable 0.1–0.6 Hz chest-ACC effort — coverage, not amplitude'
    }
  };

  /* label → id aliases (render/app labels that are not the canonical id) */
  var MOTION_LABEL_ALIAS = {
    'activity counts': 'activityCounts',
    'movement index': 'movementIndex',
    'immobile time': 'immobileFrac',
    immobility: 'immobileFrac',
    'signal quality': 'sqiConf',
    'motion sqi': 'sqiConf',
    'supine time': 'supineFrac',
    supine: 'supineFrac',
    'upright time': 'uprightFrac',
    upright: 'uprightFrac',
    'lateral time': 'lateralFrac',
    lateral: 'lateralFrac',
    'respiratory rate': 'respRate',
    'resp rate': 'respRate',
    'effort amplitude': 'effortAmp',
    'effort present': 'effortPresent'
  };

  function _norm(s) {
    var out = String(s == null ? '' : s).toLowerCase();
    // Strip any HTML tags, repeating until STABLE — a single `<[^>]*>` pass is incomplete
    // (a malformed/nested tag like `<<b>b>` reconstructs one), which CodeQL flags as
    // js/incomplete-multi-character-sanitization. Labels here are trusted, but a robust
    // strip is the correct form.
    var prev;
    do {
      prev = out;
      out = out.replace(/<[^>]*>/g, '');
    } while (out !== prev);
    return out.replace(/\s+/g, ' ').trim();
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
    if (label != null && MOTION_REGISTRY[label]) return String(label);
    var k = _norm(label);
    if (MOTION_REGISTRY[k]) return k;
    if (MOTION_LABEL_ALIAS[k]) return MOTION_LABEL_ALIAS[k];
    /* A REGISTRY ENTRY'S OWN `label` IS AN AUTHORITY (DEEP-AUDIT-V §2.8). Resolution checked the
       key and the alias map but never the entries' declared labels — so OXY_REGISTRY.meanPi,
       whose label is literally 'Perfusion Idx' and whose grade is `measured`, did not resolve
       from that exact string and rendered a fabricated `experimental` disc. Matching an entry
       to its own label invents nothing; it uses the grade the registry already declared. Built
       lazily and cached, and it runs LAST so an explicit alias always wins. */
    if (!_labelIdx) {
      _labelIdx = {};
      for (var _lk in MOTION_REGISTRY) {
        var _le = MOTION_REGISTRY[_lk];
        if (_le && _le.label) {
          var _ln = _norm(_le.label);
          if (_ln && !(_ln in _labelIdx)) _labelIdx[_ln] = _lk;
        }
      }
    }
    return _labelIdx[k] || null;
  }

  /* Pure metadata / section-separator / handshake rows — never badge. */
  var _META_DENY = {
    date: 1,
    start: 1,
    end: 1,
    source: 1,
    device: 1,
    'sample rate': 1,
    recording: 1,
    duration: 1,
    'recording span': 1,
    streams: 1,
    'acc samples': 1,
    'gyro samples': 1,
    'magn samples': 1,
    'chest acc samples': 1,
    tier: 1
  };

  /* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — places an
   evidence dot IMMEDIATELY BEFORE a label (CLAUDE.md coverage mandate). */
  function badgeForLabel(label, fallback) {
    if (!global.MetricRegistry) return '';
    var n = _norm(label);
    if (n.charAt(0) === '—' || n.charAt(0) === '→') return ''; // separators / handshakes
    var id = idForLabel(label);
    if (!id) {
      if (fallback && !_META_DENY[n]) return global.MetricRegistry.badge('experimental', '');
      return '';
    }
    var d = global.MetricRegistry.entry(MOTION_REGISTRY, id);
    return global.MetricRegistry.badge(d.evidence, d.cite);
  }

  function depthForLabel(label) {
    var id = idForLabel(label);
    if (!id) return null;
    return global.MetricRegistry ? global.MetricRegistry.entry(MOTION_REGISTRY, id).depth : null;
  }

  global.MOTION_REGISTRY = MOTION_REGISTRY;
  global.MotionRegistry = {
    REGISTRY: MOTION_REGISTRY,
    ALIAS: MOTION_LABEL_ALIAS,
    idForLabel: idForLabel,
    badgeForLabel: badgeForLabel,
    depthForLabel: depthForLabel
  };
})(window);
