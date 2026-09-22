---
bump: minor
type: added
brief: ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md
---

Both cardiac nodes now export the ADEV CURVE, not only its projections: clock.js's hostAxis stability and PpgDex's detector stability publish `curve: [{tauSec, adevPpm, n}]`, ECGDex and PpgDex carry it into their node exports, and the Integrator's readDetectorStability forwards it unchanged. Every scalar beside it (slope, optimalTauSec, ppmUncertainty, atShortest/atLongest) is a projection of exactly these points, and none of them can show where the floor sits or whether the slope was fitted across a KNEE — which is what §7's "the slope names the mechanism" needs. tools/adev-curve.mjs is the consumer the residue row required first: it re-derives the published slope from the published curve (FAIL when they disagree), splits the ladder to find a knee (SHORTFALL, a finding not a failure) and prints the ladder. Measured on a real H10 night: export 5173 → 5575 bytes (+402, +7.8 %) for a 6-point curve, slope byte-identical.
