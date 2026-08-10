<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [MotionDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Register the 28 motiondex functions the existing probes already execute.

probe-coverage reported this battery claiming 92 of 287 survivors, and the obvious reading — "the
batteries are too narrow" — was wrong. probe-reach counts which functions each probe actually runs:

  REACHED, NOT NAMED   28
  NAMED, NOT REACHED    0

Zero. The inputs were never the problem. Every one of these functions was being called, some of them
enormously often — respViterbi 168 times per probe run, xyzPlausible 38 711, toG five million — while
their survivors sat unclaimed, because a family only reports on mutants inside the line range of the
fn it NAMES.

Claimable: 92 -> 238 (32.1 % -> 82.9 %). No probe was re-run and no input changed; each function is
registered under the probe that most exercises it, since a survivor needs only one family to claim it.

This does not make them classified. Each new family must still separate its own controls, and one
whose probe reaches a function without its output depending on it will report BLIND and void —
correctly. No classifications are emitted here: the available motiondex sweep predates the
inferAccUnit bootstrap (#1133), so a fresh sweep is owed before recording verdicts.
