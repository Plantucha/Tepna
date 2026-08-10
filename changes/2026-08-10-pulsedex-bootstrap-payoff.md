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
