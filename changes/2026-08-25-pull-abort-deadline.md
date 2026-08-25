---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Add pull_deadline(), §8a's abort deadline for the close-triggered held-link pull: drop_at - guard_band,
with a refusal when that has already passed and no deadline at all when no drop is scheduled. Makes
"a pull must never delay the power drop" impossible by construction rather than improbable by
measurement — which §14's 50 s wait-for-flush window turns from insurance into the mechanism.
