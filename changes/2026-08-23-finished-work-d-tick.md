---
bump: patch
type: changed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

Records group D's `nightqc.ok` item as DONE (#1664) with its result, the `outside-band` naming
correction, and the eight mutation kills — seven of them pre-existing in `summarize`, which the
diff-scoped gate assigns to whoever touches the function.

Also records that `mutate_diff.py` reports STALE survivors on a reused scratch: it refreshes `tests/`
but carries mutmut's results database forward, so a mutant recorded as surviving before the killing
test existed keeps reading as one. `mutmut run <mutant>` flips it with no source change. The failure
direction is a false RED immune to the fix; CI uses a fresh checkout and is unaffected.

And notes that §B4's routine invocation landed in two independent halves the same day — the box side
in the nightqc digest (#1663, another session) and the analysis side in trio-batch's arrival sidecar
(#1659) — because a future reader will otherwise wonder which one the item meant.

Docs only; no code, no bundle changes.
