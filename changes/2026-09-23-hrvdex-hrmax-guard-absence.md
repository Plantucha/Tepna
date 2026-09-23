---
bump: patch
type: fixed
brief: none
---
`_hr` is `numOrNull` in the DSP, and `updateProfile` computed its resting HR as `allRows.reduce((s, r) => s + r._hr, 0) / allRows.length` — so a row carrying no heart rate contributed **0 to the numerator and 1 to the denominator**. The mean sank, and every consumer sank with it.

The consequence is a validity check becoming **more permissive**: `hrmax_manual > _hrRest0 + 45` is easier to clear against a depressed resting HR, so an implausible manual HRmax was accepted and rendered without its "⚠ entry low" hint. Measured on a case that could occur — four rows at a resting 100 bpm and four carrying no HR, against a manual HRmax of 140: the old mean is **50** (threshold 95, accepted), the measured mean is **100** (threshold 145, correctly rejected). Absence loosening a guard is the quiet direction.

🔴 **The twin found a SECOND site I had missed** — the Karvonen `hrRest` at `:395`, the identical whole-array mean, feeding Heart Rate Reserve and all five zone boundaries. It was caught because the scan asserts *"no such mean survives"* rather than pinning the one line I had just edited. Both are fixed; with no measured HR there is no reserve, so the zone table is skipped rather than drawn from five NaNs.

⚠️ Also corrected: that site's comment claimed *"use median from data"* while the code has always computed a **mean**. The comment now says what the code does — changing the statistic would be a behaviour change beyond this fix, and `inferFromData` separately computes a filtered median, so the file genuinely carries two resting-HR definitions and only one admitted it.

⚠️ Checked and deliberately left: the empty-dataset `: 60` was a THRESHOLD default, not a published measurement, and the relative test is now simply skipped when there is no basis (the absolute conditions still apply). `_rhrProj`/`vo2Proj`, this value's other consumer, writes `window._projVO2`, which has **no reader** repo-wide — verified today, as the comment at `:89` measured on 2026-09-05.
