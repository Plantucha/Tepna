---
bump: patch
type: changed
brief: MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md
---

Two open items in `MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS` answered with evidence rather than executed,
because in both cases the evidence says DO NOT BUILD.

§9 (promote cross-device clock alignment to the spine, gated on "once a second consumer appears — not
before"): the trigger looked met and is NOT. `grep -l crossCorr` returns four files and zero second
consumers — `resp-acc-analysis.recoverOffset` aligns two devices' CLOCKS by drift-consistency;
`integrator-longitudinal.crossCorrelations` correlates METRIC vs METRIC across nights;
`oxydex-dsp.computeSpO2HRLag` measures SpO2-vs-HR PHYSIOLOGICAL coupling inside one device; and
`tools/beat-correspondence.nccAnchor` recovers a BEAT-INDEX lag validated by margin, not drift. The
near-miss is `nccAnchor` — it genuinely is a cross-correlation lock, but its ambiguity is "which beat"
(resolvable only mod one RR interval) and merging it with `recoverOffset` would force one abstraction
over two different failure modes. Promoting on that grep would have moved a spine capability for a user
that does not exist. The brief now carries the table so the next session reads it instead of re-running
the grep; the identifiers invite the wrong conclusion, which is AUDIT-PROMPT class 15 expressed in
function names rather than in output.

§1 (the paper-editorial leg): the item reads "replace the numbers in all three papers". It is not that,
because THE PAPER AND ITS OWN INDEX ABSTRACT ALREADY DISAGREE — 18,856 vs 19,193 epochs, CI 0.92-1.10 vs
0.91-1.12, 91.7 % vs 91.6 % within 2 br/min, and MAE 0.61 vs 0.56 at 70 % coverage. Both say 26 nights
and both say MAE 1.01, which is why it survived review: the headline agrees and every denominator around
it does not. A 337-epoch gap means at most one describes the analysis actually run. NOT fixed here —
deciding which is right needs the corpus re-run this item explicitly reserves for a session that did not
build the tool, and copying one surface onto the other would convert an open question into a false
claim. Both carry DRAFT banners, so nothing is presented as final meanwhile.

Also verified, so nobody re-checks: §6's prohibition ("no posture-robustness claim anywhere — code,
paper, or registry cite") is HONORED — the registry, the abstract and the limitations section each state
posture robustness is untested, and the paper reports the 1.02x non-replication as absence of exposure
rather than as a contradiction. §7's ("never promote the subject-fitted bias to a default") is ALREADY
GATED, contrary to what its prose implies: `biasApplied === 0` on the default path plus an opt-in shift
assertion.

Docs-only. No code, no bundle. docs-ledger 38 green.
