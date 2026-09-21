---
bump: patch
type: fixed
brief: none
---

The mypy ratchet was right and `main` had drifted past it. **The baseline is not re-banked — the
regression is removed**, and the count returns to 41.

## Why this is a fix rather than a re-bank

`MYPY_BASELINE=41` read RISEN against `main` itself, so every branch cut from main inherited an advisory
that looked like the brancher's fault. The obvious response — bank 42 — is the wrong one: the ratchet's
rule is *"the count may only go DOWN"*, and banking would have **blessed a type regression** instead of
removing it.

## The measurement, both conditions satisfied

**Pristine `origin/main`**, zero modifications, check.sh's exact invocation
(`mypy --ignore-missing-imports --explicit-package-bases .`) — **42 errors**, against `check.sh:113`
`MYPY_BASELINE=41`.

**And the error-set delta, not just the count**, against `4383e4d0` (#2631, the commit that banked 41):

| | |
|---|---|
| appeared | **1** — `gattmap.py: Incompatible types in assignment (expression has type "int", target has type "dict[str, Any] \| str \| None")` |
| disappeared | **0** |

A clean +1, no swap. That matters: a count that merely *matches* can hide one regression arriving as
another departs, which is why the delta is the evidence and the count is only its summary.

## The cause, and why the annotation states a fact

`gattmap.py`'s `loaded_rec` literal seeds three values (`db_hash: str|None`, `chars: dict`,
`source: str`), so it infers `dict[str, dict | str | None]`. Eleven lines later the `recorded_at`
stamp — an `int`, added when the stamp was made to survive a reload — is assigned into it.

The value type **is** genuinely heterogeneous, so `dict[str, Any]` records what is true rather than
silencing the checker. Behaviour-inert: no runtime path changes.

**After the fix the error set is IDENTICAL to the banking commit's** — appeared 0, disappeared 0 — so
the count is 41 for the same 41 reasons, not a coincidental total.

`check.sh` EXIT=0: 7376 passed, coverage 100.00%, `mypy … 41 (baseline 41, at baseline)`.
