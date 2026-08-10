<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [GlucoDex, CPAPDex, HRVDex, PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Register the 68 remaining functions the existing probes already execute — glucodex 33, cpapdex 14,
hrvdex 11, pulsedex 10.

probe-reach reports NAMED-BUT-NOT-REACHED = 0 for all four files. The inputs were never the problem:
these functions were already being called, sometimes a million times a run, while their survivors sat
unclaimed because a family reports only on mutants inside the line range of the fn it NAMES.

  glucodex   341 -> 464 claimable   (66.1 % -> 89.9 %)
  hrvdex     217 -> 227             (72.8 % -> 76.2 %)
  cpapdex    133 -> 147             (27.3 % -> 30.1 %)
  pulsedex   registered; no current sweep on disk to measure against

cpapdex gains least because its largest cluster is selfTest (122 survivors), which NO probe executes
— that is a "neither", not a registration, and needs a family with new inputs.

All four now report REACHED-NOT-NAMED = 0.

No classifications are emitted. Registration is not classification: each family must still separate
its own controls, and one whose probe reaches a function without its output depending on it will
report BLIND and void, correctly.
