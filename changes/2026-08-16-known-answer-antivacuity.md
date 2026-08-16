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

A structural scan for the same shape then found two more, in gates nobody was looking at because no
incident pointed there. `OxyDex computeSmartSummary` walks a 20-row threshold table raising every
assertion inside the loop: empty it and the group goes **174 → 35 assertions and still reports green**,
so 139 checks vanish with no signal, because nothing in the suite pins an expected assertion count. The
Clock Contract's `parseTimestamp` per-node conformance table behaves the same way (54 → 27, green).
Both now assert their real size.

⚠️ The pinned number is each table's actual size, never a `> 0` floor — a floor is this same defect one
level up, detecting only total loss, which is the failure least likely to happen quietly. That earned
itself immediately: the first draft guessed 179 rows for the OxyDex table by counting nested brackets,
and the leg failed loudly rather than passing on a wrong premise. The real count is 20.

