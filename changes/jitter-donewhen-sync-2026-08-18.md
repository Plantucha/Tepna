---
bump: patch
type: fixed
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---

**A brief left contradicting itself, in the direction that causes a regression.**

#1489 resolved §1 — `sdnnRobust` measures **1.84 %** against the ~±3.5 % bar the shipped `sdnnNote`
string claims, so the string is accurate and owes no correction. But §5's Done-when still read *"the
shipped `sdnnNote` string is **still open** — a compute-path edit to a user-facing accuracy claim,
owner's call."*

So the brief said "no correction owed" in one place and "compute-path edit to a user-facing accuracy
claim" in another. **A reader ranking work by Done-whens would have edited a correct shipped string** —
a real regression, produced by the brief contradicting itself rather than by anything in the code.

Struck through rather than deleted, so the superseded reasoning stays legible.

**The transferable rule: resolving a finding means sweeping every Done-when that cited it, not only the
section it was found in.** The finding and its consequences live in different places, and only the
consequence is actionable.
