---
bump: patch
type: fixed
brief: none
---

My #2672 test asserted a property of the **branch** rather than of the code, so it failed for anyone
whose commits touched `.py`. Found by Wren.

## The defect

`test_EVERY_advisory_leg_gets_a_state_not_just_mypy` asserted `format == "EMPTY_SCOPE"`. That leg is
**diff-scoped** — `git diff --name-only origin/main...HEAD -- '*.py'` — so its scope is empty only when
the branch has no Python commits. I wrote the test on a docs-shaped branch, saw `EMPTY_SCOPE`, and
pinned it. The next person to touch a `.py` file gets `OK` and a red test.

Reproduced here: **same tree, same code, one Python commit flips it.** The sharpest case Wren measured
was a worktree byte-identical to `main` that still failed — because the leg keys on the **diff**, not
the content. And CI merged through it green, so the check that failed locally was not failing in the
lane that gates.

## ⚠️ The obvious fix is vacuous, and I measured that rather than assuming it

The prescribed fix was *"assert the value is a member of the declared vocabulary"*. **It cannot work
here, because the only declaration IS the emission sites.** I built exactly that — derive the state set
from `check.sh`, then check membership — then mutated `AT_BASELINE` to `WOBBLE`. **The test still
passed**: `WOBBLE` became "declared" the moment it was emitted. A vocabulary check needs a declaration
*separate* from the emitter, which this script does not have and which would be a hand-maintained
duplicate if bolted on — the thing the owner's question 2 says now needs a specific reason.

## What it asserts instead

What the name promises and nothing it cannot back: **both legs appear**, each value is a **non-empty
uppercase token**, and **none is `UNSPECIFIED`**. Branch-shape independent, and falsifiable.

⚠️ **I deleted that last assertion while rewriting, and a mutation caught it.** Dropping a leg's
`adv_states` entry desynchronises the parallel arrays and surfaces as `format=UNSPECIFIED` — which is
uppercase, so the token-shape check accepts it happily, and which is *not* an absent key, because the
summary loop iterates `adv_names`. The `UNSPECIFIED` exclusion is the only assertion that makes the
test's own name true, and it was already there. **Restored, not reinvented.**

## Mutations

| mutation | result |
|---|---|
| drop the format leg's state | **fails** (`UNSPECIFIED`) |
| drop the whole `advisory-state` line | **fails** |
| mutate a state literal to `WOBBLE` | *survives* — and correctly so: the test promises emission, not a vocabulary |

Verified under **both** branch shapes: 0 Python commits and 1. `check.sh` EXIT=0, 7401 passed, coverage
100.00%.

## Not changed

The `run_advisory` rc-derived default and `EMPTY_SCOPE` are both correct and untouched — the mechanism
was never the bug. This is the test only.
