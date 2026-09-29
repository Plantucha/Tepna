---
bump: patch
type: added
brief: none
---

`audits/ABSENCE-SURVEY-2026-09-22.json` had 290 confirmed findings and nowhere to record what happened
to any of them, so `capture-host/mmeta.py:112` sat CONFIRMED for six days while the same defect was
found again independently and fixed by #3216. `tools/absence-ledger.mjs` writes a sidecar state file —
`open` · `fixed` · `accepted-with-reason`, keyed by content + occurrence rather than by line — seeded
from a hand-read of the seven capture-host findings whose snippet no longer matches the file. The
survey's own output is not edited: it records what was found, the sidecar records what was done.
