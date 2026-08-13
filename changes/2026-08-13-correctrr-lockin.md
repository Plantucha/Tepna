---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

PpgDex's `correctRR` could LOCK to a stale reference and emit a constant interval series for minutes.
Only an ACCEPTED interval updates the running median, and a REJECTED one is replaced by that median —
a feedback loop. If the reference ever drifts (one motion burst suffices), every CORRECT interval falls
outside the 30 % band, is rejected, is replaced by the stale value, and never updates the reference,
which therefore cannot recover.

Measured on the real corpus: 25 minutes locked at 786 ms while the true interval was 1143 ms
(1143/786 = 1.454), reported as 76 bpm against ECG's 52.4 and the O2Ring's 52, with rmssd and sdnn
rounding to 0 because every value was the same substitute. Three-way adjudicated, PpgDex is the outlier
in 98 % of >15 bpm disagreements; ~2.6 % of epochs across 29 of 49 corpus nights are affected.

Fixed by noticing the LOOP rather than widening the band: after 8 consecutive rejections the reference
is re-seeded from the RAW local intervals — the values the old reference kept refusing — and the
accepted window is re-primed. Widening PPI_ECTOPY_THR would let genuine ectopy through everywhere to
fix a fault that only occurs once the reference is already wrong.

Verified against two independent sensors: the locked epochs go 76 -> 52 bpm, matching ECG (52.2-52.6)
and the ring (52-53), with rmssd/sdnn physiological again. Export-inert on all five committed
fixtures - none of them trips the trap, which is why it shipped.
