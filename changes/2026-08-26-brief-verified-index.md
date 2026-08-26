---
bump: minor
type: added
brief: DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md
---

**`tools/brief-verified-index.mjs` — rank the open-brief queue by when each brief was last VERIFIED,
not by how open it looks.**

Triage was being done by status label and open-item count, and both mislead. Measured over three
briefs picked that way: two carried real contradictions and one was already correct — and the correct
one was the one **re-measured most recently** (08-23, against 08-20 and 08-16 for the two that were
wrong). Staleness tracks time-since-verification.

First run over 72 open briefs: **11 never claim a verification at all.**

⚠️ **Git mtime is not a verification date, which is why the tool reads prose.** `git log -1` says
someone EDITED the file; editing is not checking. Both columns are printed side by side so the gap is
visible — `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS` was created 07-18, edited 08-20, and has never once
claimed a verification.

⚠️ **Absence of a date is a finding, not a blank.** Never-verified briefs print `NEVER` and sort
first — rendering them as an empty cell would be the well-formed-zero failure this repo keeps paying
for. Within that tier they sort by `Created`, because "written yesterday, no time to check it" and
"written in July and never re-read" are not the same row.

Does **not** claim a stated date is true: a brief asserting "verified 2026-08-20" is taken at its
word. This ranks candidates; it does not audit them.
