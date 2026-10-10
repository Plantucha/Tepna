---
bump: patch
type: fixed
brief: none
---

**Two residue rows whose fixes had landed, and the gap that let them sit OPEN.**

The 79-row sweep (rows post-dating #3091's 2026-09-25 re-verification; the other 82 are declared
excluded, not examined) found two rows a merged commit explicitly claims to close while the row's
state cell still read `OPEN` — both verified in code before closing, not taken on the claim:

- `2026-09-29-cpap-therapy-minutes-labelled-as-one-night-cover-three-days` → **fixed #3238**
  (`_span(window_note)` now names the window the minutes cover)
- `2026-09-22-cohort-gen-yield-moved-again` → **fixed #3213** (the decomposed yield pin)

Filed as its own row: nothing checks a `Closes residue <key>` claim against that row's state cell,
though the check is a regex over the log plus one table cell.
