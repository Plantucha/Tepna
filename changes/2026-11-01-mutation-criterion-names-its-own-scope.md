---
bump: patch
type: fixed
brief: none
---

Each mutation gate's pre-stated criterion now names its own scope and its own count. The Python diff gate emits `blocking_survivors_in_changed_functions`, since `entry_matches_function` selects whole functions. Its bound takes what `split_inherited` and `classify` leave. The JS diff gate emits `blocking_survivors_on_changed_lines`, because `tools/mutate.mjs` filters each mutant through the touched line set. The old `survivors_on_changed_lines` over-stated the count in both lanes and misnamed the scope in one. A pin in each lane now holds its name beside the reason the two differ (residue `2026-10-31-the-mutation-verdicts-criterion-names-lines-not-functions`).
