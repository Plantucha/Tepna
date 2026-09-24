---
bump: patch
type: fixed
brief: RESIDUE 2026-09-16-patsd-zero-is-a-fallback
---

`patJitterSdMs` published `0` for three different situations: the ECG−Pulse pair absent, the
PPG−Pulse pair absent, or the optical SD genuinely not exceeding the electrical floor. Only the
third is a measurement. `papers/rmssd-equivalence.html` headlines this quantity, so a fabricated 0
reads as "the optical arm carries no PAT jitter" — that paper's central claim negated. Absent input
now yields null; a measured non-excess is still 0.

Sibling defect in the same object, fixed with it: `RESULT.pairs` omitted a comparison that was not
computed, so a consumer could not tell "this pair was not computed" from "this tool never emits that
pair" — which is how a partial run reads as a complete one. A missing pair is now present-and-null.
