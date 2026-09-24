---
bump: patch
type: fixed
brief: none
---
A beat too noisy to classify was typed **'N' — normal**, and then counted as one.

Declining to call ectopy on a dirty beat is correct and deliberate: the guard's own comment says *"only call ectopy on clean beats (avoids artifact-driven false runs)"*, and that half is kept. The defect is the second half — the beat was then assigned the type `'N'`, asserting the normality the code had just declined to establish.

**Both consequences ran the same way, toward reassurance:**

- a real PVC inside a noisy stretch was counted as a normal beat, so it never reached the numerator;
- and it still counted in `pvcBurden = (nV / n) * 100`, where `n` was **every** beat — so each unassessable beat strictly diluted the rate.

Measured on a planted record of 40 beats with 8 dirty ones: the old code reported **10.0 %** where the beats actually assessed give **12.5 %** — a 20 % understatement, in a figure whose severity bands sit at 0.5 % and 3 %.

`bigemCycles` carried a third form of it: the test `types[k - 1] === 'N'` let an unassessed beat *complete* a bigeminy pattern it was never shown to be part of. `'N'` must mean a beat observed to be normal.

Unclassifiable beats now take their own state `'U'`, the burdens rate over `beatsAssessed`, and `beatsAssessed`/`beatsUnassessed` publish the basis. Per §∅'s 2026-09-17 ruling this is reduced **coverage**, which annotates rather than refuses — the burden still publishes, with what it rests on beside it. If nothing was assessable the rate is null, not 0.

**Traced before writing, both directions.** `types` has exactly one consumer outside the classifier — `tWaveAlternans` — and its own `sqi[k] < 0.6` filter already dominates the 0.55 classify threshold, so the new state changes nothing there. Verified rather than assumed.

⚠️ **I predicted fixture movement and was wrong, so the reason is recorded rather than the prediction quietly dropped.** The morph burdens are carried through the reshape but are **not selected into the node-export**, so no golden can move: all four moved by `manifestHash`/`computeHash` only. The fix is live where a reader actually sees it — the ectopy KPI and the PVC severity band (`ecgdex-app.js:580`, `:803`, `:1373`) — and the twin is its only coverage.

The twin plants five PVCs with the fifth inside the noise, and the **control proves that beat is real**: with every beat clean, `nPVC` is 5 rather than 4. Neither version can detect it while it is noisy — the difference is that the old one called it normal. Reverting the module reds 5 of 6, with `{"N":36,"V":4}` and burden `10` verbatim.
