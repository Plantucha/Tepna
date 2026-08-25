---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Record the owner's design ruling as §8: pull over the still-held link on observing the recording
close, rather than firing after the power drop. Adds the pull-cost envelope split by scope
(which=latest max 41.1 s vs which=all max 104.7 s, 0 of 433 over 170 s), which widens the margin
against the 180 s grace, and flags that an observed maximum is not a bound — the pull needs a hard
abort deadline inside the grace so blocking the drop is impossible by construction.
