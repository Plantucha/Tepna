/*
 * tools/circular-stats.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CIRCULAR STATISTICS — the null the suite's own phase statistic lacked.
 *
 * INTERDISCIPLINARY-LITERATURE §13h.1: the "phase concentration" this repo computes in
 * `_wrappedSlopeFit` (integrator-dsp.js — R = √(Σcos² + Σsin²)/n over per-block offsets wrapped
 * modulo one RR) IS the MEAN RESULTANT LENGTH of circular statistics, rebuilt under a local name.
 * The field's payoff is the significance test the ad-hoc version stopped short of: the RAYLEIGH
 * TEST answers "at this n, is this concentration distinguishable from a uniform phase?" — which is
 * exactly the falsifier JOINT-UNWRAP §5 needed ("is there a phase to regress") and answered with a
 * threshold read by eye (0.15–0.38 called noise, 0.79 called lock, nothing in between named).
 *
 * FORMULA (Zar's approximation, the one CircStat's circ_rtest ships — Berens 2009,
 * doi:10.18637/jss.v031.i10; Mardia & Jupp, Directional Statistics, doi:10.1002/9780470316979):
 *
 *     R  = n · R̄                       (resultant length from the mean resultant length)
 *     p  = exp( √(1 + 4n + 4(n² − R²)) − (1 + 2n) )
 *
 * Exact limits, both asserted by the gate: R̄ = 0 ⇒ the inner root is (2n+1)² ⇒ p = e⁰ = 1, uniform
 * is fully plausible. R̄ = 1 ⇒ p = exp(√(1+4n) − (1+2n)), astronomically small for any real n.
 *
 * ⚠️ WHAT THE p IS AND IS NOT. It tests against UNIFORMITY under an independence assumption. The
 * per-block offsets of one night are weakly dependent (adjacent blocks share physiology), so the p
 * is mildly anticonservative — fine for the diagnostic use it has here ("is there a phase AT ALL"),
 * not a licence to publish p-values as findings. Same posture as `slopeSE` in the Allan lane: a
 * quantity beside the statistic so a reader can judge it, not a gate.
 *
 * Node-lane only (tools + tests import it); nothing bundled. `integrator-dsp.js`'s own
 * `wrappedConcentration` field is left untouched — adding a p there is a compute-closure change that
 * re-verifies the Integrator golden, and it rides the next behavioural re-bundle (the same economics
 * as tau0Uniformity's arrival-lane wiring and CLAUDE.md §📦's version stamping).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/* Rayleigh test p-value for mean resultant length `rBar` over `n` angles.
   Returns null — never a fabricated 1.0 or 0.0 — when the inputs cannot carry the test:
   fewer than 2 angles (no dispersion to test) or rBar outside [0, 1] (not a mean resultant length). */
export function rayleighP(n, rBar) {
  if (!Number.isFinite(n) || n < 2 || !Number.isFinite(rBar) || rBar < 0 || rBar > 1) return null;
  const R = n * rBar;
  const inner = 1 + 4 * n + 4 * (n * n - R * R);
  // inner ≥ 1 + 4n − ... ; algebraically ≥ 1 whenever rBar ≤ 1, so the root is real. Clamp anyway:
  const p = Math.exp(Math.sqrt(Math.max(0, inner)) - (1 + 2 * n));
  // The approximation can exceed 1 by rounding at tiny n; a probability is capped, not apologised for.
  return Math.min(1, p);
}

/* Mean resultant length of a set of angles (radians) — the statistic the repo already computes
   inline in `_wrappedSlopeFit`; exported here so a test can pin the two against each other and so
   callers with raw angles need not re-derive it. */
export function meanResultantLength(angles) {
  if (!angles || angles.length === 0) return null;
  let sx = 0,
    sy = 0,
    n = 0;
  for (const a of angles) {
    if (!Number.isFinite(a)) continue;
    sx += Math.cos(a);
    sy += Math.sin(a);
    n++;
  }
  if (n === 0) return null;
  return { rBar: Math.sqrt(sx * sx + sy * sy) / n, n };
}
