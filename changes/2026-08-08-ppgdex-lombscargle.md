<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md
---
PpgDex's `lombScargle` is 129 lines producing every frequency-domain metric the node ships, it is **already exported**, and a full sweep left **21 surviving mutants** in it. The suite called it once, and the only numeric `lombScargle` test in the file is ECGDSP's — PpgDex's own is checked by *source regex*, which cannot see an arithmetic change.

19 assertions that **validate rather than pin**: a synthetic NN series carries a known respiratory sinusoid and the spectrum must recover it. 0.25 Hz reads **15.06 breaths/min**, 0.15 Hz reads **9.06**, two components of known amplitude land in the predicted (30/8)² ≈ 14 power ratio, `lfnu + hfnu = 100`, `totalPower = vlf + lf + hf`, and fewer than 8 beats returns `null` rather than a fabricated spectrum.

**The measured result is a negative one, and it is the point of this changeset.** Those assertions killed **2 of 21**. Adding a boundary battery — the `< 8` guard probed at exactly 7 and 8, components placed on the 0.04 and 0.15 Hz band edges, a 0.01 Hz drift so VLF is non-zero and its constants observable at all — took it to **3 of 21**.

That is the *best case* for the "export more helpers so they can be unit-tested" plan this brief proposed: a completely unasserted, already-public, purely functional 129-line routine, given a strong physical battery. It converted **14 %**, against HRVDex's 24 % for a much cheaper test. The remaining 18 are band-edge comparisons that spectral leakage makes unobservable, loop bounds, and constants whose mutation is absorbed — the same equivalent-mutant wall `clock.js` hit at 84 %.

Two of my own assertions were **wrong and are recorded as such**: I asserted a component exactly on a band edge lands in the upper band. It splits between both (measured lf 401 / hf 398 at 0.15 Hz), because a periodogram peak has finite width. The code was right; the expectation was mine. The assertion now states the split, which is both true and still exercises each edge comparison.

Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
