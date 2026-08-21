---
bump: minor
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

**`filtfilt` ran unpadded from zero state, so both ends of every PPG record carried a transient the
size of the DC pedestal** (PPGDEX-ALGORITHM-DEEP-DIVE §4 #1). Odd-reflected padding, `pad = 3·fs/lo`,
supplied by `bandpass` because the settling length is set by the high-pass corner. Measured on a
synthetic raw channel: edge/mid SD **12.07× → 1.00×**; interior bit-identical beyond 2× pad.

On the real equiv night the edge artefact was costing real beats — `cleanBeatPct` **98 → 100**,
`analyzablePct` 98 → 100, `correctionRatePct` **4.8 → 0**, `ppiCorrFootPct` 4.8 → 0.

⚠️ #1 also prescribed *"subtract record median"*. Implemented, measured, **dropped**: padding alone
achieves the whole edge fix, while the median flipped `cadenceSamples`'s 120 bpm + notch-1.2 case
from ratio 1.040 to 2.000 — reading the HR half, the sub-harmonic defect that gate exists to catch.
