---
bump: minor
type: fixed
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

**A pinned span was detected, reported, and never subtracted.** `pinnedSpans` has found O2Ring in-band
blanking since #2317 and the export has published it as `quality.pinnedCoverage` — but no consumer ever
excluded it, so every rMSSD / SD1 / LF:HF was computed as though the blanked samples were signal. The
detector was built and the reporting was built; the **consumption** was not. That is the §∅ failure one
layer up: a number describing absence, sitting beside numbers computed as if there were none.

Owner ruling (P5, 2026-09-12): *a pinned span is an ABSENCE and is excluded LIKE A GAP.* So this is
deliberately the same term in the same conjunction as `spansGapIn`, not a new mechanism — and it is
`BLE-TRANSPORT-REDESIGN` §1.2's Done-when: *a planted blanking run propagates to a null metric or a
coverage-annotated one, and to nothing else.*

⚠️ **IT WAS A HALF-FIX FIRST, and the half that was missing is the one that looks finished.**
`timeDomain` excludes through **two** arguments feeding different metrics: `omit` filters the base
behind SDNN / meanRR / HR, `cleanMask` gates the successive-difference loop behind rMSSD / pNN50.
Adding the pinned term to `cleanIn` alone moved rMSSD and left SDNN counting the blanked run. Caught by
tracing to the consumer rather than by a test, and the gate now asserts **both** channels — on the
planted pair, SDNN goes 4.4 → 125.5, which is the assertion that would otherwise have stayed silent.

⚠️ **`nInputIntervals` is now published, because without it neither counter is a rate.**
`nGapSpanIntervals` has shipped as a bare count since #2333 and `nPinSpanIntervals` was about to join
it. Both count over every **input** interval while the export's series is the **kept** subset, so
dividing by `nn.length` mixes two populations — measured while writing this, it produced a per-file
**"800 %"**, which is the only reason the mismatch was caught before it reached this file. That is
§1.5 of the same brief ("instrument the DENOMINATOR, not the failures") applied to the two counters
that needed it.

**CORPUS**, from the committed `tools/pin-coverage.mjs` (not a scratch script — a published number
whose producer has vanished is the 255th uncheckable one):

```
tree              found  analysed  threw   affected files        pinned / INPUT intervals   median  p90
vigil-archive       665       664      1   372 (56.02 %)   14805 / 1131273  = 1.309 %       6.19 %  28.57 %
tepna-smoketest    2141      1943    198   590 (30.37 %)   17602 / 1232779  = 1.428 %       5.26 %  33.33 %
```

**2607 files, 32 407 intervals** that were counted as measurements and no longer are. The interval rate
replicates tightly (1.309 % vs 1.428 %); the **file** rates do not (56.0 % vs 30.4 %), and that tracks
the throw counts — 1 against 198 — since a file the parser rejects cannot be counted as affected. Both
denominators are stated rather than averaged into one headline. `max 100.00 %` is a fully-blanked
fragment, plausible where the earlier 800 % was the bug above.

**Scope.** The in-JS detector only. The P5 ruling also asked for the `_PPGRUNS.txt` sidecar to be read
and cross-checked; that is a separate PR, per the owner, and `ppgdex-dsp.js:374` already records that
**the file wins** for what was observed.

`npm run check` — all 16 steps passed, across all four generated trees.
