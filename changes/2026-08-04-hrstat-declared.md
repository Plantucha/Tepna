---
bump: minor
type: added
nodes: [ECGDex, OxyDex, PpgDex, Integrator]
brief: R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md
---

Each HR-hat corner now declares WHICH statistic its epoch `hr` is, and the Integrator reports when the
three do not agree. ECGDex and PpgDex publish `hrStat: 'rate-of-mean'` (60000/mean(RR)); OxyDex
publishes `'median-rate'`, and that difference is 0.299 bpm on real RR — the whole of the "OxyDex
under-reads HR by 0.36 bpm" finding the hat was used to support. The Integrator's epoch adapter is a
whitelist, so the field had to be named there too; an undeclared node resolves to null and counts as
unknown, never as agreeing. The hat appends a ⚠ naming each leg's statistic and publishes `hrStats` /
`hrStatMixed` so a consumer can gate on the confound instead of parsing prose. Reported rather than
refused: the σ effect is under 2%, so suppressing an otherwise-good hat would lose more than it
protects. Note each node builds epochs twice — an internal one and a whitelisted export projection —
so the label is repeated at the export seam; without that it shipped inert, present in every bundle
and absent from every golden.
