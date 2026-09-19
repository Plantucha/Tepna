---
bump: patch
type: changed
brief: MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md
---

Drain stamp: the brief's done-when count dates from 2026-09-11 and five PRs have since landed in its own
`Affects:` surface (`tools/mutate_diff.py`, `mmeta.py`), four of them on 09-18. Records the landings and
names the two boxes most likely advanced — line 186's "no diagnostic names a cause the code did not check",
against which #2644 removed exactly such a diagnostic, and line 114's zero-mutant-module guard, against
which the `^def` anchor fix changed what `generated_count` can see. Deliberately does NOT re-tick either:
that is the brief owner's assessment and needs their reading of coverage. Sizing from the stale count is
the failure this stamp exists to prevent — four assignments on 09-18 were sized against states that had
already moved.
