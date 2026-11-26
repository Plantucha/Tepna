---
bump: patch
type: fixed
brief: none
---

ECGDex read two absences as measurements. An unmeasured `analyzablePct` entered the cross-night
weighting as `|| 0`, so the floor clamp weighted the night exactly like one measured at 0 %
analyzable — the worst night — and the weight is the only place a night's quality reaches the
published trend label. The weight keeps the floor coefficient, so no published number moves; the
absence now travels beside it, and the section note counts the recordings it covers.

`_gait` answered `totalSteps: 0, walking: false` when the ACC sample rate could not resolve the
0.5–3.5 Hz step band. The detector never ran, so the count and the conclusion are null with the
`lowfs` reason beside them, in the node summary, the export and the card.
