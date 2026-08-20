/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * block-scatter.mjs — the per-block scatter primitives, shared by the JOINT-UNWRAP tools
 * ------------------------------------------------------------------------------------------------
 * These four pure functions were defined inside `integrator-block-precision.mjs` and exported from
 * it. That worked exactly once. `unwrap-night-covariates.mjs` needs the same scatter definition —
 * the whole point of that tool is to regress a covariate against the SAME number its sibling
 * reports — and importing them from a script with top-level side effects does not do that:
 *
 *   `integrator-block-precision.mjs` parses `process.argv` at module scope and then calls
 *   `process.exit()` — for `--selftest`, and again for a missing `--dir`. An importer inherits the
 *   importer's argv, so `import { robustSigma } from './integrator-block-precision.mjs'` inside a
 *   tool run with `--selftest` runs the SIBLING's selftest and exits 0 before the importer's own
 *   assertions ever run. Measured 2026-08-20: the new tool printed the sibling's seven green lines
 *   and `selftest: all green`, having executed none of its own fifteen.
 *
 * That is §4b's family — a check that reported success about something it never examined — and it
 * is why these live in a module with NO top-level statements: nothing to run, nothing to exit.
 * `ppi-match.mjs` and `circular-stats.mjs` are the same shape and the reason the pattern is already
 * house style here.
 *
 * The definitions are unchanged; `integrator-block-precision.mjs` re-exports them so its own
 * selftest and every existing caller keep working against one implementation.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { quantile } from './ppi-match.mjs';

/* Robust sigma from the IQR. 1.349 is the IQR of a unit normal, so this reads on the same scale as
   an sd for clean data and ignores the outlying block that an sd would let dominate. */
export function robustSigma(a) {
  if (!a || a.length < 4) return null;
  return (quantile(a, 0.75) - quantile(a, 0.25)) / 1.349;
}

export function sd(a) {
  if (!a || a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}

/* Least-squares line through (x,y); returns residuals in y units. */
export function lineResiduals(x, y) {
  const n = x.length;
  if (n < 3) return null;
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n,
    my = sy / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) * (x[i] - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  const res = [];
  for (let i = 0; i < n; i++) res.push(y[i] - (my + slope * (x[i] - mx)));
  return { slope, res };
}

/* Remove a linear rate from a timebase: b'(t) = b - ppm*1e-6*(b - t0). Pure; t0 anchors the
   correction at the first beat so the transform is identity at the start and grows, matching the
   convention `hostAxis` uses (CLAUDE.md §7). */
export function dedrift(times, ppm, t0) {
  if (!ppm) return times.slice();
  const k = ppm * 1e-6;
  return times.map((t) => t - k * (t - t0));
}
