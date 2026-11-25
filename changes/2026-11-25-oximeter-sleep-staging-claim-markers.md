---
bump: patch
type: changed
brief: none
---

The sleep-staging paper binds Table 6 to a committed record. The scorer behind the readout re-ran
over the saved posteriors, and 9 of its 11 arms reproduce the October line to every digit, pooled
and per cohort. The paper now carries 17 CLAIM markers that the suite resolves against
`analysis/published-numbers/oximeter-sleep-staging-2026-11-25.json`.

Two arms do not reproduce. The wrist-only nets read 0.662 and 0.656 against a published 0.658 and
0.652, because 44 of their 3,008 posterior files are absent from the tree, all in one clinic. The
record and the paper carry both numbers and a count of the absent nights. Neither number is
corrected.

`tools/paper-claim-marker-baseline.json` drops the paper, 15 entries to 14. The baseline may only
shrink.
