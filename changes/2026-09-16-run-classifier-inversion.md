---
bump: patch
type: fixed
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

capture-host: the run-sidecar hold classifier was inverted. It keyed on run-length concentration,
which a never-repeating stream maximises, so it labelled the most variable signal `held` and the
documented zero-order hold `variable`. A hold now requires an actual repetition (dominant run length
≥ 2) as well as concentration.
