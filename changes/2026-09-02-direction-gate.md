<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
A standing gate compares every DECIDABLE `goodDirection` against the code that decides good/bad, across
all 8 nodes (FOLLOWUPS §2.5c).

A registry `goodDirection` inverts the READING of a number — "higher is better" against a render that
colours high values red — and nothing compared it to anything. The two inversions found so far (#2083:
`ssiIdx`, `nadirBinLt4`) were both caught by hand while doing something else, never by a sweep.

**Swept: 352 entries carry a direction across the 7 previously unswept nodes and 0 do not. 25 distinct
metrics are decidable, and all 25 agree — 0 inversions outside OxyDex.**

A decision is attributable only when the comparison, its verdict token and the metric's identity are in
ONE expression: a render/app colour ternary on a line carrying `evBadge('<label>')`, or the DSP findings
row `push('<id>', '<Label>', <value>, <value> <op> <n> ? <severity> : …)`. The rest is undecidable by
instrument, recorded in the brief by reason class — the `push` severity row is an OxyDex-only idiom
(verified by reading every `push('` site elsewhere), other nodes decide severity in multi-line `if/else`
blocks where identity and verdict are not in one expression, and **MotionDex has no value-based good/bad
at all**, so its 10 directions are unverifiable rather than wrong.

**Gated, not tabled, and deliberately NOT ratcheted on coverage** — a render reflow would red a count for
a non-defect, which is §2.2's "gate asserts a plural" class. Coverage is proven by planted controls, one
per source class: an inverted render ternary and an inverted severity row must both be caught, and the
agreeing shape must NOT be flagged.

Two extractor caveats are pinned by their own legs, both found by getting them wrong first: **neighbour
attribution** (a ±4-line window scored PpgDex `cleanPulses` by the `motionRejectedPct` line two rows
below) and **the second band** (`>= 90 ? 'ok' : >= 75 ? 'warn' : 'bad'` matches twice; scoring the middle
band produced 11 false inversions). A third surfaced in review of the gate itself — the caveat leg keyed
on a metric absent from the probe registry and so never ran: a conditional control that cannot fire is
not a control.

No registry is touched, so nothing is re-stamped for a no-op.
