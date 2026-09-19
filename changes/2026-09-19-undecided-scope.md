---
bump: patch
type: fixed
brief: RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md
---

The diff-scoped mutation gate scoped what it RAN to the changed functions but harvested UNDECIDED
from `mutmut results`, which takes no glob and lists the whole workspace — so every mutant generated
for a function the diff never touched came back `not checked` and blocked the run. Scoped the
harvest, counted the exclusions, and conditioned the remediation advice on the statuses present.
