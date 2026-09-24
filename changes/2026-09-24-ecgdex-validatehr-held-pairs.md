---
bump: patch
type: fixed
brief: none
---
The ECG-vs-device HR validation compared **held samples against held samples**, and the error it reported was diluted in the flattering direction.

`validateHR` forward-filled the device series before comparing it — and the CVHR grid it is measured against holds forward too. So a stretch where **neither** sensor recorded anything produced two nearly-equal fabricated values, a delta of ~0, and a contribution to the mean-absolute error that pulled it **down**. A validation that flatters itself is worse than no validation: the one number a reader consults to decide whether beat detection is working was part-manufactured, and the bias ran toward "agreement".

**The fill is simply gone.** Nothing else had to change: `_alignDevSeconds` already leaves NaN where the device reported nothing, `_rollMedian` already skips non-finite entries, and the pairing guard already requires `isFinite(d)`. Removing the fabrication let three existing guards do the job they were written for.

PpgDex's `holdOverGaps` holds samples too and documents exactly why it is allowed to: a hold may shape a filter tail, but *"no REPORTED measurement rests on it"* — `gapBeats` drops every beat touching a gap. Every number `validateHR` returns is a reported measurement, so it gets no such licence.

The comparison now publishes its **denominator** — `comparableSec`, `devMeasuredSec` and `coverage` — and the card reads "over 234 of 540s" beside the error, the same shape MotionDex already uses for its rate coverage. No threshold is imposed on `coverage`: a bar not derived from data would be the fabricated authority §🎫 forbids, so the reader gets the number instead.

Export-inert, computed not asserted: `computeHash` moved `401c7cfe2007 → d893fa929cba` (re-verification owed and done), and across all four regenerated goldens — including the real-corpus `ECGDex_2026-06-27_equiv` — the only fields that moved are `manifestHash`/`computeHash`. No measured value changed.

The twin is exact by construction: the device stops at 290 s and the grid freezes at 300 s, so the width-9 median never spans the boundary and all 234 surviving pairs differ by exactly 10 bpm. Restoring the fill reds it three ways — it would have added 300 fabricated pairs and reported **5.6 bpm** for a true **10.0**, a 44 % understatement.
