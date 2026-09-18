---
bump: patch
type: fixed
brief: PINNED-SPAN-POPULATIONS-2026-09-18-BRIEF.md
---

Corrects §5.2 of the pinned-span brief, which merged (#2640) carrying a refuted claim.

§5.2 said the two O2Ring rails are endemic and the mid-range value 100 is episodic (3 of 54 nights),
and concluded that a pooled-statistics detector would be tuned on a population 96 percent device
behaviour and 4 percent the hunted one. That inverts. The joined histogram counted values INSIDE
`class_b_quality` regions, `class_b_runs` has no mid-range rule, and `rail_value` returns None on a
single-valued file — so a 100-run in a file with normal rails produced no region and was invisible.
"Episodic" was a detector blind spot reported as a device property. From a census counting every
constant run: value 100 is ENDEMIC, >=1,050,674 samples on 50 of 54 nights, roughly twice either rail.

§5.2a records the more useful half. The brief claimed the figures were "confirmed independently on
this side rather than relayed", and they were reproduced exactly and blind — but from the producing
session's own region-scoped export, so the blind spot came with them. Two sessions agreeing through a
shared instrument is ONE measurement. Reproducing someone's numbers confirms the JOIN, never the
INSTRUMENT. This is the only one of seven instrument bugs that produced AGREEMENT rather than a
contradiction, which is what made it credible.

§5.2b restates §2's magnitude claim per device. "Rails are short, freezes are long" holds for the
O2Ring at value 100 (rail max 258 vs 27,712) and the H10 is a counter-example (rail max 1,665 vs mid
max 1,514, its mid runs sitting within ~1K of that file's rail). The detector-gap half still holds
everywhere; the magnitude half was written as general and is not.

Untouched: the three-population framing, now better supported; the ECG saturation row; the ACC census;
the pre-registered ECG refutation.
