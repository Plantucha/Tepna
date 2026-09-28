---
bump: patch
type: fixed
brief: none
---

A QTc trend point whose `tMin` is absent or non-numeric is **dropped**, where it used to be placed at ECG
start and paired with whatever glucose sat at t0. Closes residue
`2026-09-24-glucodex-qtc-trend-tmin-sentinel`.

`glucodex-app.js` read `const ms = ecgStartMs + (pt.tMin || 0) * 60000`. The surrounding loop already
dropped a point with a null `qtc`, so the guard idiom was adjacent — the time axis simply had none.
Absence entering a correlation as the value **0** is §∅ at the axis rather than at the sample: the point
does not vanish, it acquires a real glucose partner and becomes a pair in the QTc⟷glucose correlation.

## ⚠️ `Number.isFinite`, not the bare `isFinite` — and that is the substance, not a style note

The same file uses `isFinite(e.tMin)` at :931, and **that form cannot fix this row**:

```
value      isFinite()   Number.isFinite()   (x || 0) * 60000
null       true         false               0
[]         true         false               0
"12"       true         false               720000
```

`isFinite(null)` and `isFinite([])` are both **true**, and both coerce to 0 — so the loose guard admits
two of the exact shapes this rejects and re-places them at ECG start. A guard must test the type it is
about to use, not a coercion of it.

`qtc` rides the same condition for the same reason: `pt.qtc != null` admitted `NaN`, `[]` and a string,
and `qs` feeds `DSP.pearson` directly — a non-number there is arithmetic on a shape, not a measurement.

## ⚠️ Preventive, and the PR says so

`trend` is read first from `json.morphology.qtcTrend`, **a field ECGDex does not yet write** (the block
comment above the loop says so). The fallback path builds `tMin` from `ecgdex-dsp.js`'s
`+(w0 / 60).toFixed(1)`, always finite. So no shipped export reaches this today — this closes the door
before the producer exists rather than after it ships, which is the one time a silent default is cheap to
remove.

## Executed, not scanned

10 assertions running the **shipped loop** over `tMin` absent · null · NaN · `'12'` · `[]` · `{}`, and over
a non-numeric `qtc`, asserting each is dropped rather than paired — plus an anti-vacuity leg that
well-formed points still pair **at their own time**, not at t0. On `origin/main` the first leg reports
`got 6 · want 0`: every malformed point was admitted.

Executed rather than text-scanned for a reason the neighbouring ∅ group records: its own first draft failed
against its own fix, because the comment explaining the defect quoted it verbatim. Mine quotes
`(pt.tMin || 0)` too. The one source assertion here strips **block** comments rather than by line prefix —
the neighbouring stripper drops lines starting with `*`, `//` or `/*`, which misses a block comment's
continuation lines, and this file does not prefix them. That gap reported the defect it was documenting
until I fixed the stripper; found by running it.

**`computeHash` did not move: `29851650bc4c → 29851650bc4c`** — an app-layer edit, export-inert and proven
by the hash rather than asserted. `manifestHash e4eed3538784 → 73f42e1f4977` as expected.
