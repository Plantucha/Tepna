---
bump: patch
type: fixed
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

A counting helper's `0` could not be told from a scan that never saw the construct. `generated_under_glob`
returned 0 for every coroutine for five weeks and for every indented method before that, and 0 is also the
right answer for a function with no mutable operator — so the crash guard took the benign arm. The counts
now travel with the population they were taken over, and mutmut's own registration table gives an
independent second count of the same mutants; a zero over an empty population, or two counts that
disagree, refuses UNKNOWN naming the helper instead of passing.
