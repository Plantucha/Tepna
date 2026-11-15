---
bump: patch
type: fixed
brief: none
---

Report absence as null in the OxyDex research block, where nine members published a 0 over an unmeasured stream. A pulseless night read hrRange 0, split-night HR means of 0, a 0 bpm arousal and SampEn 0.0022. It also placed the circadian nadir at the exact midpoint of the night. A fully unread night added spo2Range 0 and t95BurdenScore 0.

Time-in-range now scores the measured seconds, not every row. The circadian fit subtracts the measured mean, because a hole leaves the DC offset in the amplitude.
