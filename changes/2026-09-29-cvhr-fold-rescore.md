---
bump: patch
type: fixed
brief: none
---

Re-score CVHR on the **fold's** night selection, and the sweep's number does not survive it.

`tools/gap-s-sweep.mjs` scored the largest `_ECG.txt` and the largest `_PPG.txt` per date; the fold
merges every concurrent session. On the union of fragments, four of the six "< 2 h overlap" nights
overlap 3.0–11.3 h — those four were the instrument's selection, not the drop. Residue
`2026-09-22-cvhr-overlap-four-of-six-were-the-sweeps-selection` recorded that the restricted-window
ρ of 0.255 over 17 nights therefore describes the sweep's scoring.

**Measured: ρ = −0.0139 over n = 23**, all 23 nights, 86 of 90 fragments scored. The 0.255 does not
merely describe the sweep's scoring — it **vanishes**. The sweep's verdict read *"restricting both
nodes to the hours they BOTH covered lifts the cross-node ρ from 0.05 to 0.26"*; on the fold's view
there is no rank correlation to lift. No band is proposed and no threshold is moved.

**The committed merged view is the control and it runs first**: all 23 nights' fragment counts, union
hours and fractions must reproduce `GAP-S-SWEEP-2026-09-22.json#overlapTest.mergedSessionsView`, or the
run refuses before scoring anything. It caught two wrong formulations of mine — a `.map` arity trap, and
an outer-span overlap defended with an identity that is true of any set measure and so distinguished
nothing (2026-09-16 read 22.4 h against 6.9 h, because a date directory holds an 04:42 capture and a
22:38 one). A night is the measure of its sessions, not the distance between the first and last.

**Refusals are results, counted by layer**: 0 nights refused; 4 of 45 Verity fragments did — 3
header-only daytime aborts that named themselves, 1 with nothing to report. Nine stream-nights carry a
coverage shortfall over 1 h between the union window and the covered rows, published per night because
the largest is 6.1 h of window over 2.5 h of rows.

**Two pre-stated expectations were refuted and are reported as refuted**: the row predicted a partial
refusal on a PpgDex clock seam (none occurred), and I pre-stated that a 0.2–0.4 result would have to be
called INDETERMINATE again (it does not apply at −0.014).

Two rows opened: the fold's session-merge rule is module-local to `trio-batch.mjs` (so every other tool
re-derives it), and two of PpgDex's three CVHR guards null the index without naming which fired.
