<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The vigil monitor gave the Polar Verity Sense no derived heart rate and no pulse analysis.

Issue #410 renamed the Verity's stream key `ppg` -> `ppg_vs` and fixed three `s.key==='ppg'`
comparisons. It missed four more, and `OV` / `current` are both keyed by the RAW stream key, so each
missed site silently excluded the armband:

  * `ovRates` looped over the literal `['ecg','ppg','o2ppg']` -> `OV['ppg']` cannot exist -> the Verity
    had NO derived ♥ rate in Overview at all.
  * `analyzePulse` was gated on `current==='ppg' || current==='o2ppg'` -> never ran for `ppg_vs`.
  * the scope title fell through to "Raw multi-channel capture", and the empty state read "Raw capture
    — no analysis on the box (weak CPU by design)" — telling the operator the analysis does not exist
    when it existed and was merely unreachable. That is the worst of the four: a false negative that
    reads as a design decision.

Replaced with two family predicates beside the existing `isPpgKey`: `isPulseKey` (pleth or o2ppg) and
`isBeatKey` (ecg or pulse), and `ovRates` now iterates the REAL registered stream keys instead of a
literal list that has to be maintained in parallel with the registry.

Guarded by a source scan asserting no bare `==='ppg'` comparison survives, plus a test that extracts the
three predicates FROM the shipped monitor and classifies the keys the box actually registers. The scan
strips comments first — the comment documenting #410 quotes the defect verbatim, so a naive scan flags
its own documentation. Verified to fail when the gate is reintroduced.

Note `o2ppg2w` is deliberately NOT pulse-analysable: PR #995 established it is not a plethysmogram.

Out-of-suite Python/HTML only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.
