<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
`tools/pat-host-offset.mjs` — score PAT under an inter-device offset **read** from `DexClock.hostAxis` rather than estimated from accelerometer motion, in windows, with no pair selection at all.

Three changes from `pat-matchrate-strict.mjs`, each forced by a measurement in §3c–§3e.4:

1. **The offset is read, not estimated.** §3e measured the ACC anchors disagreeing with *themselves* by 1171–3094 ms inside a single pair — 13–34× the ±90 ms tolerance — so no model built on them can work, and the three that were tried came out three coin-flips. On a box capture both streams are stamped by the same daemon and each device carries `sensor timestamp [ns]` against `Phone timestamp` on the same row, which is exactly `DexClock.hostAxis`'s anchor contract. This drives the **shipped** `hostAxis`, not §3e.4's re-implementation.
2. **Windows, not whole nights.** §3e.4 measured the offset IQR growing monotonically with duration (123 min → 39 ms; 563 min → 128 ms). `--window` (default 120 min) is a stated parameter rather than an emergent property of which fragment happened to be biggest.
3. **No pair selection — it enumerates.** §3c found legacy `matchRate` spanning 0–77 % across pairs of one night and §3c.4 that choosing the best pair *by* the statistic is circular. The fix is not a better rule but to stop choosing: every pair and every non-overlapping window is scored and the whole distribution reported.

**Refusals are loud.** A window whose `hostAxis` returns `ok:false`, or `independent:false` (the host column was derived from the device stamp and is not a second clock), is reported with its reason and scored not at all — as is a parse/detect failure. Silently falling back to an uncorrected axis is how a measurement of the alignment becomes a measurement of nothing.

Gated in the Node lane by a new group that pins what this tool **adds** (the statistics are already gated, and `hostAxis` by the clock suite): the **double-count trap**. A stream's drawn axis is `t0Ms + idx/fs` and `t0Ms` already anchors the start to the host, so adding `hostAxis`'s *absolute* correction would count that anchoring twice — invisibly, because the error is a constant offset of exactly the kind leave-one-block-out absorbs. The correction must therefore be relative to the first anchor and exactly 0 there; the group asserts both that, and that `correctionAt(first)` is itself non-zero (measured 1 ms), which is *why* the subtraction is needed. **Mutation-verified:** removing the subtraction fails the group.

**A defect the first corpus run exposed, now gated.** `strictMatchRate` returns `NaN` on an empty stage-one lag list, and a permutation p of `count(surrogate ≥ NaN) + 1` over `n+1` is `(0+1)/41` = **0.024** — so two of sixty windows reported **no data as significant**. Windows with fewer than 50 lags, or a non-finite `matchRate`, are now refused loudly; `pOf` is NaN-safe. Mutation-verified against the shipped-bug state (2 assertions fail), after a first mutation that removed only one of the two guards and passed — the remaining guard covered it, which is why the mutant had to be taken all the way back.

No signal processing of its own — it orchestrates `DexClock`/`ECGDSP`/`PPGDSP` and imports both `matchRate` definitions and their circular-shift null — so no bundle and no `manifestHash` moves.
