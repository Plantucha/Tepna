---
bump: minor
type: added
brief: MUTATION-DECLARED-EXCLUSION-2026-10-03-BRIEF.md
---

The diff-scoped mutation gate can now be told, once and in writing, that a function's measurement cost is not the diff's: a declared bounded list of exact `module.py::function` keys — each carrying a reason, a date and a cost whose provenance is required — lets the gate report `NOT_APPLICABLE` instead of an `UNKNOWN` that every future PR on that function rediscovers. The declaration is allowed exactly one transition, `UNKNOWN → NOT_APPLICABLE`: it can never rewrite a `FAIL`, never yields `PASS`, short-circuits while any survivor is blocking, requires every refused function in the run to be declared, and fails closed on a refusal line it cannot decode exactly. Functions the gate refused are also ingested into an `unmeasured` ledger with a growth gate, so a function that was never mutated leaves a trace where the survivor ledger — which records survivors — can hold none.
