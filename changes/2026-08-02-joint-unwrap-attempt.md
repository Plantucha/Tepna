<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, suite]
brief: JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md
---
Locate why drift unwrapping fails — per-block offset precision, not the algorithm — and make the constant-offset precondition checkable.

Two unwrap implementations were measured. A sequential per-pair unwrap degraded three-source closure
from 101/101/58 ppm to -266/209/-202. A wrapped-residual slope regression removes propagation entirely
(grid-search the slope, score residuals modulo one RR) and keeps closure as a free check, but its own
phase-concentration metric reads 0.15-0.59 on real nights: the wrapped residuals are near-uniform, so
there is nothing to regress. Concentration rises monotonically with block length, locating the blocker
as per-block offset precision relative to one RR. Ships _wrappedSlopeFit as a diagnostic beside the raw
slope, never replacing it. Also exports maxTolerableDriftPpm, making explicit that a constant offset's
validity is a property of the CONSUMER's resolution: event pairing tolerates 4762 ppm over a night,
beat matching 3.2, pat-gate 2.4 — so the CPAP path is safe by three orders of magnitude, not by luck.
