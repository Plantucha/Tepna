<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator, glucodex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
The Integrator counted long-gap interpolation as measured glucose, and — worse — counted it as *coverage*, blinding the one guard that exists to catch exactly that.

GlucoDex settled this in its own node (`DEEP-AUDIT-2026-07-11` §5) and its comment states the contract plainly: *"A LONG gap (a sensor change, a dropout) is hours of straight line the sensor never saw; it must NOT be counted as measured glucose."* The Integrator never received the same treatment — it excluded `COMPRESSION` (f===3) and **kept** `GAP_LONG` (f===4). The node reported TIR 0 % on such a night; the Integrator reported 11.6 % from the same data.

`coverage` was `win.length / expected` — the **raw** slice count, including every interpolated and artifact cell — so a fully-interpolated window self-reported `coverage ≈ 1.00` and sailed through `minCoverage`. Restoring the old behaviour shows the full failure: a window that is 100 % straight-line interpolation returns `coverage: 1.00, nocturnalMean: 120, tir70_140: 100`. A complete fabrication, presented as measurement.

Both halves are fixed and asserted **separately**, because excluding the values without fixing coverage would still let a 100 %-interpolated window through as "well covered".

The Integrator reads these flags as bare **numeric literals** and never imports GlucoDex's `FLAG` name — which is why the node-side fix could not propagate, and why grepping for `GAP_LONG` finds nothing there. It is now named locally with the owning definition cited. `nCells` still reports the raw slice (it is honestly named) and now carries a warning not to re-derive coverage from it.

Also corrects the two stale GlucoDex docs the finding names: the export comment claimed "keep OK/GAP/COMPRESSION" while flag 4 was already being emitted, and `cellsNote` enumerated only flags 0/2/3. `cellsNote` now distinguishes short from long gap-interp and tells any consumer computing statistics to exclude both 3 and 4 — the contract the Integrator violated for want of it being written down.

7 new assertions, mutation-verified in both directions: re-admitting `GAP_LONG` republishes the 100 %-interpolated window with mean 120 / TIR 100, and reverting coverage to the raw slice lets a half-interpolated window pass `minCoverage 0.8`. Short gap-interp (f===2) is asserted to still count — interpolating one missed 5-min reading is sound, per GlucoDex's own comment — so the fix is not over-broad.

Export-inert — proven: the Integrator TCH golden re-ran and reproduced byte-identical (`verifiedUnder → 36690ef704d0`).
