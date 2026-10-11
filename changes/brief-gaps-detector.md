---
bump: minor
type: added
brief: BRIEF-GAPS-2026-10-11-BRIEF.md
---

**A text-network gap detector over the briefs — built, measured, SHORTFALL.**

`tools/brief-gaps.mjs` ranks pairs of briefs that are close in bge-m3 mean-vector space, share no
citation path of length ≤ 2, and carry no `Supersedes`/`Superseded-by` relation. Output is a reading
list plus one `tepna.verdict/1` (gate `brief-gaps`). It never writes a supersession and never closes
anything: adjacency is not equivalence.

Pre-stated benchmark: hide the 36 hand-marked supersession pairs and measure recall@50, threshold
chosen on one half and reported on both. **Measured 0.167 on the held-out half against a floor of 0.5
→ SHORTFALL**, so the brief stays PROPOSED.

The diagnostic is the deliverable: the marked pairs' median rank is the top **1.2 %** of 147,696 pairs
and recall reaches **0.778 at k = 5,000**, so the ranking carries real signal — but 50 pairs is the top
0.034 % of the space, which made the floor unreachable by construction. What this owes next is a
criterion stated with the pair count in hand, not a bigger model.

Built on `DONE-WHEN-CROSS-BRIEF`'s negative result and meeting each item its §7 demands of a fourth
attempt, including a planted "same decision, disjoint vocabulary" pair. §7.4's conclusion — that the
honest fix for the class is social, not analytic — is left standing.
