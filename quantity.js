/*
 * quantity.js — Tepna boundary-only units-as-quantities (CORE, brief Phase 6)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Enforce CLAUDE.md §Units STRUCTURALLY: SI/metric is canonical; conversion
 * happens ONLY at the I/O edge; you cannot add mmHg to bpm. A Quantity is a
 * tagged { value, unit, dim } — math stays in metric, imperial is a thin
 * presentation layer (brief §6). Adopt at the adapter boundary first (frames
 * carry SI), then the profile/display layer.
 *
 * ⚠ FIRST CONCRETE TARGET (independent review §8 item 1 — highest-value catch):
 * the Baevsky SI/CSI unit guard. HRVDex's d_si / d_csi read Mode / MxDMn straight
 * from the Welltory summary columns and ASSUME SECONDS with no bound. A vendor
 * export in MILLISECONDS mis-scales d_si by up to 10⁶× (it divides by BOTH
 * Mode·MxDMn) and d_csi by ~10³× — "plausible but wrong", exactly what the Clock
 * Contract prevents for time, now on amplitudes. `guardBaevsky()` here is the
 * pure boundary guard; wire it at the HRVDex summary-CSV ingest in HRVDex's
 * Phase-9 pass (a node edit → gated) so every future summary vendor inherits it.
 * DOM-free; loadable in node:vm.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // dimension of each known unit — adding across dimensions is forbidden.
  var DIM = {
    kg: 'mass',
    lb: 'mass',
    cm: 'length',
    m: 'length',
    in: 'length',
    ft: 'length',
    C: 'temp',
    F: 'temp',
    s: 'time',
    ms: 'time',
    'mmol/L': 'glucose',
    'mg/dL': 'glucose',
    bpm: 'rate',
    mmHg: 'pressure',
    '%': 'fraction',
    'mL/kg/min': 'vo2'
  };
  // canonical (metric/SI) unit per dimension — the single source of truth.
  var CANON = { mass: 'kg', length: 'm', temp: 'C', time: 's', glucose: 'mmol/L' };

  // → metric. Pure boundary conversion; never call mid-computation.
  function toMetric(value, unit) {
    if (value == null || !isFinite(value)) return null;
    switch (unit) {
      case 'lb':
        return value * 0.45359237; // → kg
      case 'in':
        return value * 0.0254; // → m
      case 'ft':
        return value * 0.3048; // → m
      case 'cm':
        return value / 100; // → m
      case 'F':
        return ((value - 32) * 5) / 9; // → °C
      case 'ms':
        return value / 1000; // → s
      case 'mg/dL':
        return value / 18.0182; // → mmol/L (glucose)
      case 'kg':
      case 'm':
      case 'C':
      case 's':
      case 'mmol/L':
        return value; // already metric
      default:
        return value; // dimensionless / already-canonical clinical units
    }
  }
  // metric → an imperial/display unit, for the display switch ONLY (read field,
  // convert to metric immediately for math, convert back only to render).
  function toDisplay(metricValue, unit) {
    if (metricValue == null || !isFinite(metricValue)) return null;
    switch (unit) {
      case 'lb':
        return metricValue / 0.45359237;
      case 'in':
        return metricValue / 0.0254;
      case 'ft':
        return metricValue / 0.3048;
      case 'cm':
        return metricValue * 100;
      case 'F':
        return (metricValue * 9) / 5 + 32;
      case 'ms':
        return metricValue * 1000;
      case 'mg/dL':
        return metricValue * 18.0182;
      default:
        return metricValue;
    }
  }

  // A tagged quantity stored ALWAYS in its canonical metric unit.
  function Quantity(value, unit) {
    if (!(this instanceof Quantity)) return new Quantity(value, unit);
    var dim = DIM[unit] || 'dimensionless';
    var canon = CANON[dim] || unit;
    this.dim = dim;
    this.unit = canon; // stored canonical
    this.value = toMetric(value, unit); // stored metric value
  }
  Quantity.prototype.as = function (unit) {
    if ((DIM[unit] || 'dimensionless') !== this.dim) throw new Error('dimension mismatch: cannot express ' + this.dim + ' as ' + unit);
    return toDisplay(this.value, unit);
  };
  Quantity.prototype.add = function (other) {
    if (!(other instanceof Quantity)) throw new Error('add expects a Quantity');
    if (other.dim !== this.dim) throw new Error('dimension mismatch: cannot add ' + this.dim + ' + ' + other.dim);
    return new Quantity(this.value + other.value, this.unit);
  };

  /* ── Baevsky SI/CSI unit guard ────────────────────────────────────────────
     Mode (most-frequent RR) and MxDMn (RR variation range) are physiologically
     RR-derived → in SECONDS they are O(0.1–2). In MILLISECONDS they are O(100–
     2000). The two bands are cleanly separable (an RR-derived seconds value is
     always < ~3; a ms value always > ~50), so a single threshold disambiguates.
       asSecondsRR(v) → seconds, dividing by 1000 iff v landed in the ms band.
       guardBaevsky(mode, mxdmn) → { modeS, mxdmnS, assumedMs, flagged }
     `flagged` = the post-conversion value is outside a plausible RR range
     ([0.05, 3.0] s) → surface (never silently use), per the epistemic creed. */
  var RR_MS_THRESHOLD = 10; // a seconds RR-quantity is < ~3; ms is > ~50 — 10 is a safe split
  var RR_MIN_S = 0.05,
    RR_MAX_S = 3.0;

  function asSecondsRR(v) {
    if (v == null || !isFinite(v)) return { valueS: null, assumedMs: false, flagged: true };
    var assumedMs = v >= RR_MS_THRESHOLD;
    var valueS = assumedMs ? v / 1000 : v;
    var flagged = !(valueS >= RR_MIN_S && valueS <= RR_MAX_S);
    return { valueS: valueS, assumedMs: assumedMs, flagged: flagged };
  }

  function guardBaevsky(mode, mxdmn) {
    var m = asSecondsRR(mode),
      x = asSecondsRR(mxdmn);
    return {
      modeS: m.valueS,
      mxdmnS: x.valueS,
      assumedMs: m.assumedMs || x.assumedMs,
      flagged: m.flagged || x.flagged,
      reason: m.flagged || x.flagged ? 'Baevsky Mode/MxDMn outside plausible RR range after unit normalization — value surfaced, not silently scaled' : null
    };
  }

  // Baevsky Stress Index from GUARDED (seconds) inputs — the canonical formula,
  // unit-safe. amo50 = AMo (% of RR in the modal bin). meanRRs in seconds.
  function baevskySI(amo50, modeS, mxdmnS) {
    if (
      ![amo50, modeS, mxdmnS].every(function (v) {
        return v != null && isFinite(v);
      }) ||
      modeS <= 0 ||
      mxdmnS <= 0
    )
      return null;
    return amo50 / (2 * modeS * mxdmnS);
  }

  root.Quantity = Quantity;
  root.DexUnits = {
    Quantity: Quantity,
    toMetric: toMetric,
    toDisplay: toDisplay,
    DIM: DIM,
    CANON: CANON,
    asSecondsRR: asSecondsRR,
    guardBaevsky: guardBaevsky,
    baevskySI: baevskySI,
    RR_MS_THRESHOLD: RR_MS_THRESHOLD
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DexUnits;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
