---
bump: patch
type: fixed
brief: MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md
---

A second module-level mutation exclusion, for `webmon.py`, authorized by the owner on 2026-10-11: its
`make_app` is one 1,791-line factory holding 57 nested handlers, so every handler edit scopes the whole
factory and mutant GENERATION does not finish inside the gate's own cap — measured twice in CI and once
locally, all three in the generation phase.

The permitted module keys became an owner-named ALLOWLIST rather than a count. A bound of two would say
"two modules are declarable" and hand the second slot to whichever module asked first, which is the
general permission neither ruling gave; naming them keeps the fence as narrow as the rulings, and a
module key for anything unnamed refuses even as the only entry in the file.

A module key's time number now also says WHICH PHASE it measures: `statsPassSec` (the traced stats pass,
which bounds `capture.py`) or `generationCapSec` (mutant generation, which bounds `webmon.py`). Filing a
generation cap under the stats-pass field would have been one phase's measurement under another's name.
