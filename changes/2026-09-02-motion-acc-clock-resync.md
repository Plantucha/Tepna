<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [motiondex]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
A mid-file device-clock resync no longer makes MotionDex publish a 7.66-year night — the ACC sibling
of DEEP-AUDIT-VI F1, executed before it was ported (FOLLOWUPS §1.1), plus the PpgDex half of §1.3
answered by measurement.

**The defect, executed rather than inferred.** F1 recorded that the sibling `_ACC.txt` carries the
identical ns step and that the consequence had never been run. It has now: on the real 2026-08-27
file the counter jumps +241,586,764 s at row 470 while the phone advances 85.8 s, `relSecOf` PREFERS
that counter, and MotionDex published `recording.durSec` **241,589,697 — 7.66 years for a 50-minute
recording** — declaring a window ending **2034-04-22**, which is what the Integrator's gap-aware
overlap tests against. It does not crash: it returns a plausible-looking summary in 1.9 s, which is
why nothing caught it.

**Scoped by census, not by assumption.** Over all 1278 corpus ACC files: **137** files' worst step is
a real DROPOUT — device delta ≈ phone delta, both clocks ticked, the counter is right about those and
they are left untouched — and exactly **3** are resyncs, the same three nights F1 found on the ECG
side. 0 seams had unparseable stamps.

**The fix is F1's discriminator, deliberately identical** (through a real dropout both clocks tick;
only a clock step makes them disagree), with the same 60 s bound and 24 h ceiling, because the two
nodes are reading the same step in the same device's two files and a second constant would eventually
disagree with the first. `_clockResyncs` is attached only when it happened, so a clean stream keeps
today's bytes; an over-24 h step whose seam stamps do not parse still re-anchors with
`phoneDeltaMs: null` and adds no duration (§2.6).

**The new segment anchors on the seam row's HOST offset, not by subtracting the step** — Clock
Contract §7's ONE DEVICE CLOCK PER AXIS (#2075). Subtracting alone leaves the axis continuous but
carries the pre-sync segment's error forward as a constant: measured on 08-27, the host−device
residual walks 1.449 s across the 10.6 s BEFORE the seam (136,064 ppm — the ACC sibling of the
+1508 ms/9.5 s F1 measured on the same night's ECG) and then holds flat. Host-anchoring confines that
to the 469 pre-seam rows instead of offsetting all 148,860.

**Measured after:** `durSec` 3,019 s; post-seam drift **−18 / −21 / −16 ppm** across the three nights
— one consistent H10 crystal, and a clean control night reads −22 ppm with zero resyncs. Those are
median-of-decile figures: an endpoint-only read gives 2081 ppm on 08-27 because the final row is a BLE
batch-jitter outlier, which is also the whole of the apparent 7.6 s span discrepancy.

**§1.3, the PpgDex half — the split is NOT owed, and that is a measurement.** `ppgdex-dsp.js` has no
step detection at all, so §7's rule applies: a node that detects no steps has not shown it has none.
Census: **0 of 3674 corpus `_PPG.txt` files carry a resync** (84 real dropouts, 402 with no ns
column). The resync is H10 firmware behaviour and the PPG stream is the Verity's. The exposure is
real but unreached, and the existing guard is narrower than it looks: planted with the true step
magnitude, `hostAxis` REFUSES (±50,000 ppm) so `fs` is never corrected by a fabricated rate — but the
refusal protects the RATE and **not the AXIS**, and `relSec` still spans 2.416e8 s. Recorded as a
6-assertion tripwire group rather than a prose caveat, so the day the input class arrives, a gate says
so.

22 assertions across the two groups, including a real-dropout control, a clean-stream byte-stability
leg, and a blind-seam leg that caught a bug in the first version of this fix (the unparseable-stamp
fallback re-admitted the step it was removing).
