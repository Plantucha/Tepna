---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`mutate.mjs`'s operator table is now asserted by NAME. Reported by a peer scanning for tests that walk
a pinned constant without pinning its size — and **calibrated down by them rather than filed as an
alarm**, which is the part worth copying: total emptying already broke the two `OPS.find` lookups, so
the table was never exposed to complete loss.

The exposure was **partial**. Drop every operator except the two the selftest names and every
assertion still passes, while the sweep measures a fraction of the operator set and reports a kill
rate for it as though it were the whole. That is the same shape as a fleet score computed over a
denominator nobody checked.

⚠️ **A `length > 0` floor would have been the same defect one level up**, so the set is asserted by
name rather than by count — a silent ADDITION is caught as well as a removal, because a new operator
nobody scored is the same lie in the other direction.

The assertion earned itself immediately: my first version listed `arith + → -` and `arith - → +`,
which do not exist. The real set has `negate: drop !` and `num → 0`. It caught a wrong expectation
before it caught a wrong table. Verified against the failure it exists for — deleting the `negate`
operator now reds three assertions where it previously reddened none.
