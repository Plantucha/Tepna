---
bump: patch
type: fixed
brief: none
---

A seam sidecar's totals now agree with its rows by construction, and a reader that ever finds them disagreeing refuses the file by name. `_SeamSidecar.feed` incremented `self.seams` before writing the row, inside a `try` whose handler deliberately swallows because an annotation must never end a recording — so a write that raised would have left the count one ahead of the rows and the final line would claim a seam the file does not carry. The count now follows the row. `solid_night_inputs.clocks` sums the seams across ALL of a file's final lines (a resumed file-set writes one per writer instance — the 2026-09-24 H10 carries three) and returns UNKNOWN with a named reason when that sum does not equal the rows, rather than trusting either side. This closes the narrow surviving risk from `2026-09-25-seam-row-without-its-writers-final-line`, which is WITHDRAWN: its own cited file carries three final lines including `seams=1 examined=3577` for the seam row it says went uncounted, and across 132 corpus sidecars (66 rig, 66 box) none disagree. The tripwire therefore fires on nothing today and exists to notice the day it does.
