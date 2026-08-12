<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Add tools/killcheck.mjs — the per-function kill measurement, in parallel.

The inner loop of the 99% programme is: write a test, re-apply that function's recorded survivors,
count how many now fail. Serially that is ~4 s per mutant — ten minutes for a 144-survivor function,
two or three times over, and ~83 h across the 499 functions in the work list.

The mutants are independent, so this is the one part of the loop that is embarrassingly parallel.
Measured: parseJSONL's 144 survivors in 3 s at 16-way against ~10 min serial, reproducing the
hand-measured 80 kills exactly. ~83 h becomes ~6 h.

TWO FAILURE MODES IT REFUSES TO HAVE, both hit while writing it:

1. A RED BASELINE MAKES EVERY MUTANT LOOK KILLED — measured in this repo on 2026-08-11, where one
   failing assertion reported killed=144 survived=0, a perfect score from a broken test. The baseline
   runs first and a red one aborts.

2. A WORKER THAT RESOLVES BACK TO THE REAL REPO MEASURES NOTHING. run-tests.mjs derives ROOT from
   import.meta.url, so a symlinked tests/ AND an absolute path to the repo's own runner both make the
   worker load the real, unmutated DSP. Both were hit, both reported KILLED 0 of 144 in 3 s on a
   function known to convert 80. Workers now get hard-linked trees beside the repo (same filesystem,
   since /tmp is tmpfs and cp -al cannot cross devices) and invoke their OWN runner. The mutated file
   is unlinked before writing, so a hard link is never written through into the real source.

Validated against a known answer, which is the only reason either bug was caught: without one, this
would have shipped as an instrument that measures nothing — the exact failure the programme keeps
finding elsewhere.

9 known-answer selftests on the pure parts (mutant application incl. truncated before/after, and
function-range resolution).
