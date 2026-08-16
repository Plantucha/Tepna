---
bump: patch
type: fixed
brief: HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md
---

Delete the entire pinned cross-language reference table and the suite still reported "the spine core
matches capture-host/allan.py to 1e-9". Measured, not reasoned: emptying it left the group 15/15 green.

Both Allan known-answer gates compared by looping over the pinned table. An empty table means the loop
never executes, `worst` stays at its initialised 0, and the tolerance assertion passes having compared
nothing. The sibling leg `got.length >= PY.length` is trivially true in the same state, so it could not
catch it either. The gate that pins this repo's only cross-language contract could lose its entire
reference and stay green.

Adds a row-count leg to each table and initialises `worst` to Infinity when the table is empty, so the
absence is caught twice. Verified by emptying each table in turn: each now reds exactly its own group
with two failures and leaves the other untouched.

This is not hypothetical vandalism. A `count=1` bulk regex aimed at a different `var PY` in this file
replaced one of these tables while a sibling gate was being written, and only an unrelated row-count
leg in that sibling reported the discrepancy. The generalisable point, and the reason this landed as
its own unit: a pinned table should assert its own size regardless of what the assertion was added to
protect. It costs one line, it is not aimed at any particular bug, and it is the only thing standing
between a lost reference and a green suite.
