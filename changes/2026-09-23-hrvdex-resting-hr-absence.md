---
bump: patch
type: fixed
brief: none
---
`inferFromData` filters heart rates to 30 < v < 120, so an empty list means the dataset carries no usable HR at all — and the fallback invented **60**, which a banner headed *"Auto-detected from your data"* then displayed as detected. The HR-range line one row below already handled absence correctly (`hrs.length ? … : '?–?'`).

It did not stop at the display. `restingHR` is the DENOMINATOR of the Uth-Sørensen VO₂ estimate, and both values are handed to `DXP().prefillFrom(…)`, which PERSISTS them into the shared detected tier that every node resolves against — so a fabricated 60 became a stored profile fact, and a VO₂ estimate derived from it became another.

`prefillFrom` already skips null (`if (detected[k] != null)`), so refusing upstream needed no change there — it gives that guard back the absence it was written for. Two further guards came with it: the HRmax plausibility test compares against the resting HR, and `null + 45` is 45, so an absent one would have waved through any manual HRmax above 45; and the VO₂ quotient divides by it, where `190 / null` is **Infinity**, which survives `Math.round` and is not a VO₂.

The twin pins the guard behaviourally — seed a real reading of 52, offer null, assert 52 survives — rather than assuming `prefillFrom` skips it. ⚠️ `inferFromData` reads module-scope `allRows` and writes a banner element, so the producer is asserted against the source; the limit is stated in the test.

⚠️ Deliberately out of scope: `updateProfile`'s own `_hrRest0` fallback (also 60) feeds both the HRmax guard and `_rhrProj`'s projected VO₂. Same class, different function and consumers — filed rather than folded in.
