---
bump: minor
type: added
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

**The matched-filter estimator lands and the fiducial's pre-stated ≤30 ms band is MET: per-pattern
SE 19.1 ms on the 2026-08-20 morning calibration (vs the threshold baseline's 82–129 ms).**

`buzz-onset-extract.mjs --xcorr`: whole-pattern normalized cross-correlation of two devices' HF-energy
series (all bursts at once; the aperiodic pattern makes the peak unique), per-event xcorr for the
spread, a boxcar template train for per-device command→artifact latency, parabolic sub-sample
refinement, and a LOW-CONFIDENCE flag when the peak r < 0.6 (night run C reads r 0.38 from its poorer
coupling — reported as unresolved, not as a lag).

Honesty engineering, gate-tested (13 selftest assertions): the estimator's PRECISION is
rise-shape-insensitive but its ACCURACY carries a coupling-centroid bias (~rise/2, constant per
geometry) — asserted from both sides (matched couplings recover a planted +150 ms exactly; mismatched
couplings pin the bounded positive bias; the threshold baseline's slope bias is the control). The
first synthetic was itself wrong — index-anchored carriers + a shared noise seed correlated at lag 0
and faked a ~+100 ms error on an exact-recovery case; rebuilt as a true time-shift (carrier phase on
t−onset, per-stream seeds). Brief §5b records the morning calibration: pooled H10↔Verity systematic
+140 ± 35 ms across sessions, H10 latency stable (command stamp alone ≈ ±50 ms anchor), the intensity
floor (motor 60; coupling-limited, not motor-limited), and the two vendor discoveries (motor-write
demo-buzz; contact-loss self-buzz).

Analysis tooling + docs only — no bundle, manifest, or fixture moves.
