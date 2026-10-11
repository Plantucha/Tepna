---
bump: patch
type: fixed
brief: PAPERS-AUDIT.md
---

Four preprints asserted numbers in prose, captions and abstracts that the SAME file's correction or
revision box already supersedes. Each corrected value is now a sourced CLAIM pin against
`analysis/published-numbers/*.json`; nothing is hand-typed.

Three of the items are not stale digits but withdrawn conclusions, and are marked withdrawn rather than
restated at the new value: odi4's "the synthetic prediction transfers to within 0.02" (the re-cut slope
sits ~0.15 from the synthetic figure, not 0.02), treatment-response's "rMSSD localizes better than
ODI-4" reversal (the respiratory channel is the stronger localizer again), and qrs-yield's +83 % rMSSD
inflation (the re-run flips its sign). `qrs-yield` and `rmssd-equivalence` have no published-numbers
source, so their superseded claims point at the in-file revision note instead of carrying a typed
number.
