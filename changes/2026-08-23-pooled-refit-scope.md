---
bump: patch
type: changed
brief: INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md
---

Scopes the pair-specific skew re-fit before anyone implements it. The naive reading — re-fit on the
one pair a coupling scores — is WORSE than what ships: `_pooledPeak` divides summed per-channel z by
sqrt(nChannels) precisely so the shared-signal jitter averages down, so a single-pair fit estimates
the same quantity from fewer events.

It is justified only if the pairs have genuinely different TRUE offsets, which the physics allows —
a desaturation trails its apnea by circulation time while an arousal surge trails both. The data to
decide already exists: `ownOffsetSec` is published per channel beside the pooled offset, so only a
corpus pass is needed. Pre-stated band recorded: justified only if the between-channel difference is
consistent in sign across nights AND exceeds the within-channel night-to-night spread.

Also corrects a number that travelled: the ~3.3 s quoted for this item in FINISHED-WORK §D is a
H10↔Verity wearable offset, while this fit is CPAP↔wearable with a tens-of-seconds floor.

Docs only; no code, no bundle changes.
