<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
The bootstrap loop closes end-to-end — pulsedex 25.5 % → 31.9 %, and compareIntervalSeries goes from unclassifiable to 18 classifications.

Two bootstrap tests (36 assertions total) were written for functions with ZERO kills, which made their
survivors unclassifiable by construction. Re-sweeping and re-probing measures what that bought:

  RATE      144/565 = 25.5 %   →   183/574 = 31.9 %      +39 killed, +6.4 points
  compareIntervalSeries  54 survivors → 36    NO CONTROLS → 12/12 → 18 distinguishable, 18 RECORDED
  fragmentation          19 survivors →  8    NO CONTROLS →  9/11  (2 still blind, progress not done)

That is the whole loop demonstrated: a test kills mutants → the kills become positive controls → the
controls let the prober reach a verdict → the survivors get classified. Before the test,
`compareIntervalSeries`'s 54 survivors could not be classified at all no matter how good the battery
was; after it, 18 are recorded as having no distinguishing input and 18 are named as real gaps.

Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 · cpapdex 26 · pulsedex 37 · glucodex 23 = 241.

Still blind, each diagnosed rather than merely reported:
  parseRRInput   8/12 — the ≤2-column skip, the intervalCol bound, and both blockerCol clauses need
                 delimited rows the current cases do not produce.
  fragmentation  9/11 — the `altRun > 4` threshold and the pas denominator are unexercised; the
                 alternating series are all maximal, so no case sits at the run-length boundary.

SECOND PASS — the two remaining blind families were blind for reasons the battery could not fix by
being wider, only by being SHAPED differently.

  fragmentation  9/11 → 11/11, +5 recorded. THE SAME LINE APPEARS TWICE:
                 `if (altRun >= 4) pasNN += altRun;` sits both INSIDE the run loop (L404, for an
                 alternating stretch that ends before the series does) and AFTER it (L408, for one
                 that runs to the last beat). Every alternating case in the battery ended with a
                 monotone tail, so `altRun` was 0 at loop exit and L408 could never fire — it stayed
                 blind through two widenings for that reason alone. The fix is the MIRROR shape: a
                 monotone head then alternation to the final beat. And only altRun EXACTLY 4
                 separates `>= 4` from `> 4` — measured, altTail(4,5) gives pas 44.4 vs 0 while
                 altTail(4,6) gives 50 under both.
  parseRRInput   8/12 → 10/12. A declared `blocker` column (header cell matching /^\s*blocker\s*$/i)
                 and rows with a single column unblinded two; the ≤2-column skip and the intervalCol
                 bound remain.

The generalisable part: "widen the battery" is the wrong instinct when a control stays blind. Twice
now the cause was that a specific SHAPE was absent — a series ending in alternation, a row with one
column — and adding more of the shapes already present would never have found it. The diagnosis has
to name the branch.

pulsedex 42 recorded. Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 · cpapdex 26 ·
pulsedex 42 · glucodex 23 = 246.
