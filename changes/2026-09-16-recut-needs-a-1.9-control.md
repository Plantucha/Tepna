---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The re-cut assumes the generator is the only thing that changed since each paper was published. For
`qrs-yield` that is false, and it is not subtle.

Driving the tool at the paper's stated `nSubj: 400` reproduces the structure exactly — 365 PPG windows
against a published 365, 189,213 true beats against 189,179 (+0.02 %) — and recall to within a third
of a point (96.09 % vs 96.4 %). Three other columns move by amounts no cohort-shape refit can produce:

| | published (1.9) | measured |
|---|---|---|
| recall (all) | 96.4 % | 96.09 % |
| **precision** | **88.8 %** | **98.8 %** |
| **SQI apnea** | **0.78** | **0.977** |
| **rMSSD bias** | **+83.0 %** | **−10.4 %** (sign flip) |

**A generator that reshapes the severe tail cannot flip the sign of a bias while leaving recall and
beat counts intact.** The captured object carries `rmssdNote: "genuine (PPG truth + pulse-foot
detection)"` — a comparison *basis* the published run plausibly did not use. The parsimonious reading
is that the optical pipeline or the tool's scoring changed between publication and now. That is a
**hypothesis**; what is established is only that the movement is inconsistent with a generator-only
explanation.

## Why this is filed against the brief, not the paper

Re-cutting a paper and labelling the deltas *"cohort-gen 2.0"* silently attributes **every intervening
tool change** to the generator.

Three papers were already re-cut on that assumption (#2557, #2562, #2563). **They are not
invalidated** — each was checked against its own published values and the quantities that should not
have moved didn't, which is exactly the control that would have caught this. But the assumption they
rest on is now known false in at least one tool, so the remaining re-cuts owe a **second control**:
re-run under cohort-gen **1.9** as well, and attribute only the 1.9 → 2.0 difference to the generator.

That control is cheap and needs no inference — 1.9 is recoverable with
`git show 5c36ff59^:cohort-gen.js` (the commit that introduced 2.0). A paired 1.9/2.0 run separates
the generator term from the tool-drift term outright.

`qrs-yield` is **not** re-cut here. Doing so would have published a sign-flipped bias under a heading
that blames the generator for it.

Filed as `2026-09-16-recut-conflates-generator-and-tool-drift`.
