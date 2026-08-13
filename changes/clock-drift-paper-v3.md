---
bump: patch
type: changed
brief: PAT-COMPENDIUM-2026-08-10-BRIEF.md
---

`papers/wearable-clock-drift.html` v3 — the correction that corrects the correction. v2 refuted v1's
quartz-drift explanation and replaced it with a physiological one: that beat-level cross-device PAT is
blocked by **~96 ms of beat-to-beat scatter in the peripheral foot time**, "a property of pulse-wave
timing, not of timekeeping". That figure is now **withdrawn as an artifact**, on three counts and one
that subsumes them.

The pairing ran inside `PHYS = [200,650]`, a 450 ms acceptance band whose uniform standard deviation is
`450/√12 = 129.90 ms` — the reported spread is recoverable in closed form from the analysis window, so
nothing about the cardiovascular system was being observed. The ECG axis was derived from the lossy
`[ms]` column and rounded to a nominal 130 Hz (**46–126 ppm**, **1.25–4.16 s per night**), and the
O2Ring's marker-inflated *row* rate was read as its *sample* rate (**~6,900 ppm**). Subsuming all of it:
every one of the 54 pairings came from the phone corpus, where `hostAxis.independent` is **false** —
host-column residual spread **0.98 ms**, exactly one stamp quantum, because that column is derived from
the device's own stamp. There is no second clock in the corpus both earlier versions used, so it could
not bound an inter-device quantity at all.

What replaces it is an open question, not a new mechanism. With the axis fixed and the ring avoided, box
captures give a within-5-min-bin σ of **10–23 ms on three of six nights** against a 60 ms bar — but that
is one session and not gate-backed, so it withdraws the old verdict without establishing a new one. The
"0 of 54 pairings" gate is itself defective: it weighed a statistic that **saturates at its own pairing
window**, and treated `PHYS` as a plausibility filter when it is a **censoring cut** discarding data on
**16 of 19** box site-nights (one at **97.4 %**, uncensored median lag 831 ms). The usable box corpus is
**2 site-nights**, not ~8. The leading blocker candidate is now a **per-connection BLE buffering offset**
whose spread between recordings of the same two devices is **2.2 s** against a within-night σ of 29–36 ms.

**The title changed**, which is itself a correction: v2's *"but the clock was never the problem"* is
false — a clock error was the problem, not a crystal but this suite's own `fs` derivation.
`papers/dead-ends.html` (wall 2.7) and `papers/papers.html` asserted the same ~96 ms and are corrected in
the same revision, so no sibling page contradicts the withdrawal.

Adds §7.1 (Table 4, v2 → v3 disposition) and the rule this second episode adds to v2's: *when a
correction replaces one mechanism with another, the replacement inherits none of the original's scrutiny
and needs its own.* Both wrong mechanisms were plausible, quantified and stable across nights; the second
survived longer precisely because it was the product of a correction.
