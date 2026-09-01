<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---
CFD re-scored against the window-oracle reference and rejected; the reference reproduces from `main`.

**The #2034-head caveat is discharged.** From post-#2034 `main` all four reference nights reproduce
exactly (07-24 405 · 08-12 315 · 08-17 215 · 08-18 355, all SIGNAL RECOVERED); the corpus tally from
`main` is 4 RECOVERED · 19 PARTIAL · 6 NO RECOVERY (one borderline null-margin night flipped vs the
#2034-head 4/20/5).

**CFD is REJECTED against pre-stated bands.** The constant-fraction discriminator (f=0.10,
sub-sample interpolated on the same consensus beats) keeps all four signal nights RECOVERED inside
the 200–500 ms rail (modes ~+10–30 ms later, as a later fiducial must), but on the paired per-night
out-of-sample narrowSD it is worse on 16 of 29 scored nights, better on 10, median ΔSD +0.1 ms, with
the tally unchanged. Judged by the independent ECG reference — the metric §3's point 1 said inter-LED
IQR could not be — CFD buys nothing over the shipping tangent foot. §3's non-adoption now stands on
the right reason.

**Tooling, additive:** `tools/pat-fiducial.mjs` generalises the half-amplitude crossing to
`fractionAmplitudeIndex` (one crossing implementation; `halfAmplitudeIndex` is its 0.5 projection,
`CFD_FRAC = 0.10` a named constant), `ppgFootTimes` emits `cfdTimes` under the same
index-parallel/NaN contract as `halfTimes`, and `pat-window-oracle` grows `--fiducial foot|cfd|half`
with `foot` the default and verdict-identical to the pre-flag tool. No bundle code moves.
