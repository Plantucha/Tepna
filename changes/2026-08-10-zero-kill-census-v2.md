<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Census the zero-kill functions across every swept file — ~320 survivors, six now cleared, and the three lessons that made them clear.

⚠️ This content was written once before and LOST: #1128 squash-merged before the census commit was
made, so it sat orphaned on a merged branch. Re-added here, updated with what the six bootstraps
actually converted at. A squash merge takes the branch as it was AT MERGE TIME — a commit pushed to
the same branch afterwards is not in it, and nothing says so.

The three zero-kill functions handled first were each found BY ACCIDENT while probing something else.
Scanning every swept file for functions with ≥8 survivors and zero kills finds nine, ~320 survivors,
about a fifth of everything the fleet has mapped. Six are now done:

  genSynthetic 90 (5/6) · compareIntervalSeries 54 (3/8) · inferAccUnit 31 (6/9)
  locateColumns 30 (3/9) · _nightFromInput 20 (6/8) · fragmentation 19 (4/8)

WHAT THE SIX TAUGHT, beyond the counts — each converted because its test attacked a DISCRIMINATION
rather than a happy path, and twice the first attempt failed the same way:

  · inferAccUnit — test the BOUNDS, not the bands. 1000/1/9.81 confirms three bands exist and
    exercises none of the six comparisons. Every band edge returns null, which is what separates `>`
    from `>=`, and mistaking g for mg is a 1000× error in every downstream metric.
  · locateColumns — the band predicate survived until a SECOND numeric column existed, because with
    one column the scorer picks it whatever the band test says. A DISCRIMINATOR IS ONLY TESTED WHEN
    SOMETHING HAS TO BE DISCRIMINATED. With a device counter beside glucose, the mutant reports a
    serial number as blood glucose.
  · fragmentation — the same line occurs TWICE (in the run loop and after it) and only a series
    ENDING in alternation reaches the second.

So when a control stays blind, "widen the battery" is the wrong instinct: three times the cause was a
missing SHAPE, and more of the shapes already present would never have found it.

Two remain and they are not alike. `cvhrFromNN` (57) is reachable — its output is already exported as
cvhrIndex/cvhrEvents — but it is called from deep inside analyze(), so a test must build a synthetic
PPG that survives beat detection, SQI and correction while carrying a controlled apnea-band
oscillation. That is a project. `getFilteredRows` (11) cannot be fixed this way at all: it reads
`document`, so its behaviour is a function of the DOM rather than of its argument.
