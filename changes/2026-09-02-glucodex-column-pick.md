<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [glucodex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
`locateColumns` picked Dexcom Clarity's serial **Index** column as the glucose column the moment ONE
"Low" cell (the string Clarity writes for below-range readings) appeared in the 60-row sample —
every headline metric (mean, GMI, TIR, LBGI) was then computed on ROW NUMBERS, silently
(DEEP-AUDIT-VI F6; the audit's executed repro measured mean 501 mg/dL / GMI 15.3 / TIR 11.1). Even
on a clean file the real column won by exactly one hit: the score had no penalty for a serial
integer column.

Two guards in the pick, both measured:

1. **Serial-integer disqualification** — a column whose numeric cells are all integers advancing by
   exactly ±1 is a row counter, not a measurement; it can never be the glucose column, whatever its
   band coverage.
2. **Header declaration bonus** — a header cell matching /gluco/i outranks band statistics (+1 >
   the whole score range), but only for a still-mostly-numeric column; the "Glucose Rate of Change"
   decoy also matches and loses on band coverage, as planted.

Export-inert on every committed input, **proven by re-run** (regen tool: all 3 existing fixtures
content-unchanged). New committed adversarial twin `synthetic_glucodex_clarity_low.csv` (Clarity
layout: Index 1..576, six Low cells in a planted 03:00 hypo, Transmitter-Time and Rate-of-Change
decoys) + minted golden, wired as `equiv.glucodex_clarity_low` in both runners; the invariant group
reds on pre-F6 code by construction (measured: old code mean = 289 ≈ avg(1..576), n = 576; fixed
code mean = 103, daypart n = 570). `verify-fixtures` green (suite green, 1 stamped, 13 current).
