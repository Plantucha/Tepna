---
bump: patch
type: fixed
brief: none
---

`function_of_mutant` could not read the only name format it is ever given, so the mutation gate's
`by function` summary has reported nothing since it shipped.

## The defect

`mutmut results` prints mutant names **module-qualified** — `gattmap.x__norm__mutmut_1` — and
`mutate_diff.py` passes them through verbatim from `split_results`. The parser required the stem to
start with `x_`:

```
gattmap.x__norm__mutmut_1      ->  ''        ← production form
x__norm__mutmut_1              ->  '_norm'   ← works
gattmap.x_configure__mutmut_3  ->  ''
x_configure__mutmut_3          ->  'configure'
```

**Every mutant therefore grouped under `?`.** Measured on a real refusal 2026-09-19: 166 undecided,
`by function: 166 ?`, zero attributed.

## Why it was invisible, which is the part worth keeping

**Both documented shapes in the docstring are bare** (`x__floor_by_t__mutmut_12`,
`xǁCounterǁscaled__mutmut_2`), **the tests were written from those examples**, and nothing ever fed the
function the form it actually receives. Test green, production inert, from the day it landed.

And the docstring states what it was for: separating *"ALL of them in one pathological function"* from
*"spread across several"* — the measurement that decides whether the remedy is **scheduling or the
mutants themselves**. It was added because three refusals (116, 553, a 145-min kill) could not be told
apart. **The remedy for that blindness has been blind its entire life.**

## The fix

`stem.rsplit(".", 1)[-1]` before the existing logic. `rsplit` on the **last** dot is the conservative
read: a dotted prefix can only be a module path (`pkg.mod.x_f`), because the method form separates with
`ǁ`, never `.` — the dots in `Counter.scaled` are produced by the join afterwards and are never in the
input.

Declining still beats guessing: `gattmap.not_a_mutant`, `gattmap.junk__mutmut_1` and `gattmap.x__mutmut_1`
all stay `""`. Stripping a qualifier must not turn a decline into a guess that names the module.

## Tests

Re-pointed at the qualified form — **a test on the bare form re-certifies the blindness** — while
keeping the bare cases, since both are real. Plus the end-to-end shape `mutate_diff.py` actually builds
(`{"mutant": <qualified>, "module": …}`), which returned `[("?", 7)]` before.

Mutation-verified both directions: reverting the strip kills 2; splitting on the **first** dot instead
of the last kills the nested-package assertion.

## Scope held

**Parser only** (`capture-host/mutation_diff.py`). The unconditional *"Re-run under less load"* advice is
in `capture-host/tools/mutate_diff.py`, which has an in-flight change — left alone rather than taken
"while I was in there", which would be the §2d collision.

## ⚠️ One unrelated observation from gating

The first gate run failed `test_retry_sleep_connected.py::test_run_oxyii_publishes_a_DOWN_link_while_it
_waits_out_a_stall`. **A second run of the same command on the same tree passed** (EXIT=0, 7383 passed),
and it passes in isolation. My change is deterministic and confined to a parser in a different module,
so it cannot produce an intermittent failure there.

The slow run is the one that failed — **460 s vs 247 s** — which is the load signature. A structurally
identical defect is recorded as `2026-09-06-runner-gate-events-leak-between-tests`, but that row is
`fixed #2279`, so this is a residual or a new instance rather than that one. Recorded here rather than
claimed: **n=1**, and one observation is not a flake characterisation.
