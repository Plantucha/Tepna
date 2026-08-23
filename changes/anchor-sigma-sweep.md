---
bump: patch
type: added
brief: EXTERNAL-METHODS-SURVEY-FOLLOWUPS-2026-08-23-BRIEF.md
---

`tools/acc-shared-movement.mjs` gains `--sigmas`, sweeping `findAnchors`' `anchorSigma` over one
parse per night so every step differs only in the threshold. The decision band is written into the
tool's source, before the run, per the follow-up brief's own instruction.

Result: the band was NOT met and the default σ4 stays. Corroboration never reaches the pre-stated
0.20 (max 0.152 at σ12), refusals rise monotonically 5 → 13, and zero nights convert refusal →
alignment above σ4 while 8 nights that align at σ4 are lost above it. The hypothesis' mechanism held
— pooled candidates fall 20× against anchors 3.2× — but its operational claim was impossible by
construction: anchors are a subset of candidates, so the anchor count is non-increasing in σ,
measured with zero exceptions over 37 nights.

Analysis tool only; reads recordings, writes nothing, no shipped bundle changes.
