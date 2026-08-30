---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

**The mypy ratchet's first live catch on `main`, fixed rather than re-baselined.**

The CI job began reporting `RATCHET BROKEN: 123 > 122` on every open PR. One new error had entered
`main` through the lap gap — a PR measured clean against its own merge-ref, and the error
materialised on `main` only in combination.

**Named by measurement, not by reading candidates off the job log.** A sort-independent multiset
comparison of `main`'s current error set against the 122-era set returns exactly one difference:

```
tools/mutate_diff.py | Incompatible types in assignment
                       (expression has type "str | None", variable has type "str")
```

That matters because the visible errors in the log suggested other candidates entirely — a file
that turned out to contribute nothing to the delta. **A list of errors you can see is not a list of
errors that changed**; only the paired set difference answers the question actually being asked.

**The defect is a name collision across two kinds.** `_why` was bound in the module-exclusion loop
as the reason a module left mutation scope (`str`), then re-assigned lower down as the reason the
whole run must refuse (`str | None`). mypy binds a name at its first assignment, so the second one
is a type error. Two meanings, two names: the first is now `_excl_why`. No behaviour changes — the
refusal path and the exclusion path each keep the value they always had.

⚠️ **Fixed, never re-baselined.** Raising the floor to meet a new error is the one response that
would have made the ratchet decorative, and it is exactly what this PR's own new rule refuses
without declared provenance. The count only goes down.

**Credit where it is due: this was the PRE-EXISTING `N > BASE` check**, not the equality and
direction rules added in this PR — those are not on `main` yet. The original ratchet caught a real
regression on its own, which is the strongest available argument for tightening rather than
loosening it.

⚠️ Note also that `mypy` is **not a required context**, so the red blocked nobody. It is fixed
anyway: a gate that is permanently red stops being read, and a floor nobody trusts is a floor
nobody defends.
