---
bump: patch
type: changed
brief: FINDINGS-AND-FIXES-BRIEF.md
---

`FINDINGS-AND-FIXES` §6's surviving generator artifact is now quantified: `cohort-gen.js:534` gives every
desaturation the same deterministic curve, so SpO₂ nadir and desat depth take exactly one value each
across 2000 events (86.6 % / 8.4 %, SD 0) — degenerate, not merely biased. Blast radius bounded to the 3
of 10 cohort-gen papers that report a nadir/depth quantity. Still unfixed deliberately: the edit moves 5
`manifestHash`es plus `computeHash` and owes a corpus re-stamp, which is an owner call on the series.
