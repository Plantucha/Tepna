---
bump: minor
type: added
brief: CPAP-SPOOL-ACQUISITION-2026-08-25-BRIEF.md
---

`cpap_inventory_adapter.py` — the impure half that reads the three inventories and hands them to the
pure oracle, plus **a defect fix in the merged oracle that this adapter's own tests found**.

## 🔴 `night_key` was eating real filenames — a bug in already-merged code (#1924)

It concatenated **every digit** in the string, so the live-envelope filename
`AS11_20260827_BRP.edf.meta.json` became `"1120260827"`, whose leading eight are `"11202608"` — year
1120, rejected, **night silently lost**. The protocol name is part of the filename; this is the
ordinary input, not an exotic one.

⚠️ **My first fix broke the other case**: scanning digit *runs* returns `None` for
`2026-08-27T22:14:05`, which has no eight-digit run at all. The existing test caught that within one
run. Now two passes — scan runs, then strip only `- : T` and space (never `_`) and scan again — with
**both cases planted as a pair**, because each one alone is satisfied by a version that breaks the
other.

## Each source reports whether it was CONSULTED, and none of them derives it

| source | how "consulted" is decided |
|---|---|
| card | **verbatim** from the harvest result's flag — never from `state`, which splits both ways: a completed walk with short reads is `error` + consulted, a walk that never happened is `error` + unconsulted |
| spool | the **ledger file** existing and parsing — an absent ledger is *"we never transacted"*, not *"the device listed nothing"* |
| envelopes | the envelope **directory** existing |

A result with **no** `consulted` key is treated as unconsulted: a hook we do not understand must not
be assumed generous.

## Not wired, and the reason is collaboration rather than caution

`capture.py`'s `_cpap_loop(..., on_complete=None)` hook is merged, but the **call site belongs to the
session that owns that region** and is actively editing it. Passing the callee is a one-line change
there, handed over rather than taken. The `find_unwired` entry states exactly what retires it.

Two suppressions from #1924 are **removed** as spent — the adapter now consumes `qc_field` and
`journal_lines` — and the tool reported them stale before a human did, which is that allowlist's
retirement rule working.

**50 tests, 100 % statement + branch on both modules.**
