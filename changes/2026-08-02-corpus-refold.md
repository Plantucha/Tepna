---
bump: patch
type: changed
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---

Re-measure the trio corpus under the host-disciplined time axis (34 complete trios across both source
trees). The re-folded artefacts are deliberately NOT committed: a `--force` re-fold also switches the
export profile (32 KB → 1,007 KB per night, plus `apnea`/`hrvStability` keys the committed corpus lacks
— 3.46 M lines, 44 MB), so committing it would fuse a timing fix with a shape change. Re-committing the
corpus is scoped as its own work-unit.

The prediction that justified the re-run held: three-source closure moved from 101.2 to −15.5 ppm on
2026-07-25 (which now passes its own consistency test) and from 58.4 to −11.4 ppm on 2026-07-28, while
ECGDex's three-cornered-hat σ stayed identical at 0.91 bpm — the signature of a corner the fix could
not reach.

Also corrects this brief family's claim that three-cornered hat was "the most exposed". It is not:
`tch-multinight`'s third corner is OxyDex, which ingests the O2Ring CSV (1 Hz, real wall-clock stamps),
not the drawn `sensor timestamp [ns]` PPG axis, and it aggregates to 5-minute epoch medians that an
≤18 s axis error cannot move.

No code change; corpus artefacts and brief only.
