---
bump: patch
type: added
brief: none
---

Seam exposure is decided by **input provenance**, not by whether a node detects seams — measured, so
the asymmetry between two identical functions isn't re-read as a bug in three months.

Kestrel assigned a fleet sweep to roll out the refuse-vs-annotate ruling. The enumeration reduced it to
one shared function, and the measurement then retired most of what was left.

## The finding

`beatConfidence` is shared by ECGDex and PpgDex, and its executable body is **identical — 2135
characters each** once comments are stripped. But:

- ECGDex feeds it **A-peak sample indices** (`ecgdex-dsp.js:1143`, via `hrConfidence:1232`)
- PpgDex feeds it **`round(footSec·fs)`** — time-derived (`tests/dex-tests.js:8173`)

A sample index cannot carry a clock seam; a time-derived index does. Only PpgDex guards it with
`clock-seam`, and **that asymmetry is correct**.

## Measured, with a positive control

Device-counter steps planted into an ECG record built to the real `_ECG.txt` shape (ISO-T stamps,
BigInt ns, E-notation ms): control, +86 s, +2792 d, and a both-columns real gap.

The plant **registered** — `devMsAt` maxStep **482,457,608 ms** on the +2792 d case — and
`beatConfidence` returned 120 values, 2 distinct `[1, 0.97]`, **identical in every case**.

**Positive control:** injected noise *does* move it — 400 µV collapses it to 1 distinct value, 900 µV
gives 4 distinct and 141 → 210 peaks. The instrument sees signal quality and not the device clock.
Without that control, "identical" would have been indistinguishable from a metric that never moves.

**The `fs` channel is live, not inert.** `fs` is an argument to `beatConfidence` and it *did* move
across the plant (130.000333 → 130.000667, ~2.6 ppm). Confidence was unchanged anyway — a dismissal on
evidence rather than on absence.

## Two things the sweep turned up on the way

**No assertion holds the two bodies equal.** All 16 `beatConfidence` references in `tests/dex-tests.js`
are behavioural or reachability checks; none asserts source text. So `ppgdex-dsp.js:2121`'s *"Byte-for-byte
MIRROR"* is accurate about code and **verified by nothing** — a future body edit would diverge them
silently. It is also imprecise as written: the raw bodies differ (3122 vs 2708 chars) because the
*comments* do.

**MotionDex is exposed, and my earlier lean that it wasn't is withdrawn.** `Immobile time` bins by
`Math.floor(relSecOf(...) / epoch)` — time-derived, same class as PpgDex. It already annotates coverage
correctly (tri-state `moving: null`, uncovered epochs leave the denominator); what it lacks is refusal
across a discontinuity. **Not built here** — the ruling is still unmerged, and I won't cite a §∅ clause
that isn't on `main`.
