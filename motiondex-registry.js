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
      evidence: 'experimental',
      cite: 'Chest-ACC thoraco-abdominal effort (Ryser 2022) — surrogate; descriptive, direction is nominal'
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

  function idForLabel(label) {
    var k = _norm(label);
    if (MOTION_REGISTRY[k]) return k;
    return MOTION_LABEL_ALIAS[k] || null;
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
