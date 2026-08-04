---
bump: patch
type: added
nodes: []
brief: R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md
---

Spawns the follow-up the brief lifecycle requires after resolving R5's bias item, and answers the
question that immediately follows it: the bias was a cross-node estimator confound, so is the σ an
artifact too? No. Removing the estimator term (SD 0.489 bpm) moves the O2Ring leg from 2.60 to 2.554 —
under 2 %, inside the uncertainty those papers already state — and the 3.5 % variance share is an upper
bound, because both statistics are computed from the same RR series and subtracting in quadrature
assumes an independence they do not have. Saying so matters: the obvious inference from "the bias is an
artifact" is "the σ papers are wrong too", and that is false. What is owed instead: pick one epoch-HR
statistic fleet-wide (a third option, mean-of-rates, reads +0.203 the other way), name it in the epoch
block so a consumer can refuse a mismatched pair, and either isolate the mechanism inside real RR or
stop claiming one.
