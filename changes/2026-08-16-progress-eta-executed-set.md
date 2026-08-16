---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

The suite's progress line planned its denominator by matching `tests/group-timings.json` TITLES, but
group selection also matches TAGS — so `--group=clock` planned 36 groups while 58 actually ran and the
line read `[55/36]`. A counter whose numerator exceeds its denominator is not just untidy: the ETA
derived from it is wrong by the same ratio, in the optimistic direction.

The denominator is now the EXECUTED set. `listOnly` declares every group without running any body and
carries the tag, so applying the real matcher to it yields exactly the set `onGroup` fires for — 15 ms,
measured. The timings file is used only for per-group COST, which is what it is authoritative about;
groups missing from it fall back to the mean of those present and the header says how many are unpriced.
Verified: `--group=clock` 36 → **58**, `--group=oxydex` 36 → **61**, both matching a direct count.

⚠️ And the fix's first version re-created the bug it exists to prevent, one level up: scaling the
remaining plan by observed-vs-planned divided a real elapsed by a 1 ms first group and printed
`ETA 146m24s` for a run that takes 5. The correction now engages only after 5 % of the plan has run and
is clamped to [0.2, 5] — a hint that is out by more than 5x is not worth scaling by. First ETA is now
5m38s against a measured 4m55s, stable from group 1.
