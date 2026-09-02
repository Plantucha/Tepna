<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
A mid-file H10 clock resync is no longer a 2.41e8-second "dropout" — the gap walk asks the phone
column, re-anchors the device axis, and surfaces the event to the export (DEEP-AUDIT-VI F1).

**The defect:** the H10 adopting real time mid-recording steps both device columns by the epoch
difference (+241,586,765 s measured) while the phone column advances 86 s; `parseECG`'s gap walk
trusted the device delta unconditionally, so three committed trio exports published sleep-stage
events in 2034, coverage spans of 2.41e8 s, coveragePct 0 — and the Integrator's `segmentsOverlap`
silently dropped the nights.

**The fix, physical at its core:** through a REAL dropout both clocks keep ticking (device delta ≈
phone delta); only a clock step makes them disagree. At a gap candidate the walk now parses the
seam's phone stamps (lazily — one string assignment per row otherwise): device excess > 60 s over
the phone delta ⇒ a RE-ANCHOR POINT, never a dropout — the relative and ns axes shift to continue
at phone pace, the honest gap (the phone delta) is recorded only if it clears the normal gap
threshold, and `clockResyncs[{idx, deviceStepMs, phoneDeltaMs, atRelMs}]` travels rec → analyze
reshape → `recording.clockResyncs` (attached only when present, the no-null-key discipline). An
over-24 h step with unparseable seam stamps still re-anchors, with `phoneDeltaMs: null` and NO gap
entry — an unmeasured duration stays visibly unmeasured (§2.6), never fabricated.

**Measured on the three poisoned nights** (patched DSP, raw files): 08-27 gap 2.42e11 ms → 86,398 ms
with `tMsAt` spanning its own 50 minutes and `hostAxis` flipping from the −999988 ppm refusal to
ok/applied/independent; 08-23 → 86 s; 08-26 → 57 s; a clean control night raises nothing. The
first probe also caught a baseline bug in the ns re-anchor (it corrected against the seam row's own
value) — fixed before commit. 19 new committed-twin assertions pin the class: resync vs real-dropout
discrimination (the control stays silent), pure-resync fabricates no gap, blind-seam honesty, the
export surface both ways, and the hostAxis refusal gone.

**ONE DEVICE CLOCK PER AXIS** (found by the refold, not the audit): the first fold of 08-27 refused
to merge the seam file with its 6.5 h sibling — "ECG sessions disagree on fs (129.968 vs 129.903)".
Re-anchoring is exact at the seam, but the host−device residual over the pre-sync rows is a
different oscillator state (+1508 ms over 9.5 s on 08-27 ≈ 160,000 ppm; −10,495 ppm on 08-23;
+506 ppm on 08-26 — versus ±20 ppm after the sync), and hostAxis measures divergence relative to
its FIRST anchor, so those rows were QUOTED into `fs` as a rate (485 ppm; the running median smooths
the ramp under the ±50,000 refusal, so nothing refused it). Anchors read off the pre-resync counter
are now dropped before the spine sees them (`hostAxis.anchorsDroppedPreResync`, present only when it
happened) and the seam's host↔device offset is surfaced as a NUMBER on
`clockResyncs[].hostOffsetMs` instead of being modelled as a slope. Measured on the raw files with
the patched DSP: 08-27 seam fs 129.965 vs sibling 129.968 (3 mHz apart — merges), 08-23 130.008,
08-26 129.974; hostAxis ok/applied on all three at −17 … +12 ppm. 8 more assertions pin it, and the
skew case was checked to FAIL with the drop disabled (−17,086 ppm quoted).

The three `uploads/trio/` 2026-08-23/26/27 exports are refolded from the fixed generation in the
same change.
