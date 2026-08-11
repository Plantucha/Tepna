<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ECGDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
First exhaustive mutation sweep of ecgdex-dsp.js: 1755 tested, 526 killed, 22 invalid, 1207 survivors,
5.7 h wall. 526/1733 = 30.4 % of distinguishable mutants killed — the LOWEST rate in the fleet.

The fleet map sampled ecgdex at 62 %. The error is +31.6 points, larger than oxydex's +24.2, and it
lands the second-highest sampled file at the bottom of the measured table.

Seven files in, the 60-mutant sample carries no usable signal:

  sampled  33   37   40   42   55   58   62
  MEASURED 39.0 37.3 40.4 25.5 33.7 33.8 30.4
  error    -6.0 -0.3 -0.4 +16.5 +21.3 +24.2 +31.6

Every measured rate lies in a 15-point band (25.5-40.4 %). The sample spans 29 points and the two move
if anything in opposite directions (r = -0.46; with n=7 the sign is suggestive, the absence of positive
signal is not). The error grows monotonically with the sampled value.

The fleet is far more homogeneous than the map suggested: one population near 34 %, not a range from
33 % to 62 %.

integrator is the only estimate left and the highest row at 68 %. The brief now records the
falsifiable prediction, BEFORE the sweep, that it will measure near 34 %.

canary: NONE (first sweep); it learned one at L68, carried here, so the next ecgdex sweep is guarded.
The battery from #1151 claims 1006 of the 1207 survivors (83.3 %). Two family fn names are corrected
to the real internal names (_movementOnsets, ecgBuildNodeExport), worth 12 more claimable survivors.

One family remains unresolvable and is documented rather than hidden: rmssd/mean/median/std are ARROW
CONSTS, and functionRange matches only `function NAME(`. That family runs and claims nothing until the
tool learns arrow assignments — surfaced by probe-coverage's unresolved-fn warning.
