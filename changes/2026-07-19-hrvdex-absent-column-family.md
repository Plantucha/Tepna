<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [hrvdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
**An absent HRV column no longer arithmetics its way into a confident number.**

Every objective column parses absent → `null` (`numOrNull` — that part was already right). JS coercion then
hides the absence: `null >= 0` is **true**, `null + 1` is **1**, `null / x` is **0**. So any expression that
gated *some* of its factors and consumed the rest ungated published a real number for data never recorded.

Measured by executing the module — a complete row, then the same row with one column nulled:

| column absent | before | true value | after |
|---|---|---|---|
| `_stress` | `d_welfare` **4200** | 91.3 | `NaN` |
| `_pnn50` | `d_otr` **500** (saturation rail) | 2.78 | `NaN` |
| `_rmssd` | `d_sd1` **0** → `d_dfa_proxy` **1** | 29.7 / 0.86 | `NaN` |
| `_sns` | `d_abs` **+1** (and `_psns` → −1) | 0.33 | `NaN` |

`d_abs` is the clearest: `null + 60 > 0` passes, so the balance resolved to `(60−0)/(60+0)` — **maximal
parasympathetic dominance asserted from a column that does not exist**. `d_otr` is the nastiest, because its
gate `r._pnn50 >= 0` was *itself* satisfied by the absence it was meant to catch, and the row then rode
`100/(null+0.01)` onto the 500 rail — reading as extreme overtraining.

18 sites fixed via one shared `_all(...)` presence gate. The file already contained this fix applied
correctly to `d_rsa`, carrying a comment from an earlier audit about *"an absent HF divided into a real meanRR
[yielding] a confident 0"* — the class was diagnosed once and closed at one site.

`_all()` rejects non-numbers as well as null, so a stray string column cannot coerce its way to a value either.

`computeCAMQ` used the same `>= 0` test in its parasympathetic arm, where an absent pNN50 contributed a real
`0` to the mean **and** incremented the divisor. The synthetic row scores **70 → 74** once the absent term
stops dragging: the composite was being penalised for a measurement nobody took.

## Both guarding gates were hollow, and both are rebuilt

- `d_welfare gated on subjective inputs PRESENT (>0), never a fake 0` — a source regex over the *current*
  text, unanchored, so it prefix-matched and stayed green while the stress denominator went ungated. A regex
  pinned to the code it was written against cannot notice what that code forgets.
- `a single _hasSubj predicate … is defined once` + its loop asserting `<name> = _hasSubj ?` — asserts the gate
  **exists**, not that it **covers** the composite's factors. `d_pti` was in that list and passed while
  multiplying the *objective* `_rmssd`, which `_hasSubj` says nothing about.

Both are replaced by a 23-assertion behavioural group that drives the real `computeDerived` with one column
nulled at a time. **Every leg is paired with a control on the intact row** — without that half, "return NaN
always" would satisfy the gate. Mutation-verified in both directions: reverting the fix reds 34 assertions
printing exactly 4200 / 500 / 0 / 1; forcing `_all()` to `false` reds every control.

## Provenance

`computeHash` moved (`591735cc78f3` → `1208227c3184`) — a DSP change is inside the closure, so **export-inertness
is not claimed**. Both HRVDex fixtures reproduce byte-identical (their committed inputs carry complete columns —
the fix reaches only absent-column rows) and were re-verified against the real corpus with
`tools/verify-fixtures.mjs`. Suite 3299 passing, zero skips. `Data Unifier` / `OverDex` / docs rebuilt as
downstream inliners.

§1.10 (DMY file-lock never threaded) and §1.11 (dead storage-failure warning) are confirmed-open but are
different defect classes in the same file; they land separately rather than being folded into this one.
