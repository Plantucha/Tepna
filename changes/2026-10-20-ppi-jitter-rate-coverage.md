---
bump: patch
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

The PPI-jitter endpoint now reports the beat-count ratio, the epochs it dropped and the rate range it
covered, beside the two medians §4 gates every punch-list item on. A detector firing twice per beat
refused the jitter and left the population instead of scoring badly, so neither median could see it.
