---
bump: patch
type: fixed
brief: none
---

§∅: `oxydex-dsp.js`'s Autonomic Arousal Index published **0** when the recording duration could not be
established — in range, indistinguishable from a genuinely calm night, on a user-visible
`heuristic`-tier metric that also feeds a `HIGH_AROUSAL_IDX` flag keyed at ≥5.

Four sites, because fixing only the source moves the fabrication rather than removing it: `null / 5`
is `0` in JavaScript, so both arithmetic consumers would have converted the absence straight back
into a number. The two threshold consumers needed no change — `null >= 3` is false, so they abstain,
which is the wanted behaviour.

The test suite already knew: the failing assertion sat in a block titled "every guard refuses, null
never throws", where six siblings pin `null` on degenerate input and `computeCrossSignal(0) → "0"` was
the lone exception.

`computeHash` moved 9c7bce4bb325 → 0adf53789e68; `verify-fixtures` re-ran and the outputs reproduced
(2 stamped, 15 current), so inertness is proven rather than asserted.
