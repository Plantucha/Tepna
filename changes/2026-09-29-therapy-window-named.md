---
bump: patch
type: fixed
brief: none
---

The `cpap_stream` detail line said "775 of 776 therapy min" beside a 6.75 h EDF — 776 min is 12.9 h,
about two nights — so a reader comparing it against one night could not tell a correct ratio from a
broken counter. The number was right: `capture.py` scopes both halves to the night ±1 day precisely so
numerator and denominator describe the same stretch, mirroring the EDF walk over DATALOG/<d-1|d0|d+1>.
The sentence now names that window, supplied by the caller that computed it rather than hardcoded in a
function that cannot see it. Numbers, state and every other field unchanged.
