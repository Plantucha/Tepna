---
bump: patch
type: fixed
brief: none
---

`tools/probe-equivalence.mjs` emits the control denominator that was **sampled**, not the one that
ran, so a partial control drop is visible in `tools/mutate-equivalence.json` and not only on the
console. #2910 taught the console to report load failures; the string that lands permanently in the
ledger still read `${ctlRan}/${ctlRan}`, so a sample of 12 with 8 load failures recorded
`4/4 same-function controls separated` — full marks with two thirds of the reach evidence absent.
