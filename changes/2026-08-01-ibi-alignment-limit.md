<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md
---
Corrects a claim made hours earlier: that IBI sequences are a **better alignment signal** than ACC↔ACC (r = 0.532 against a 0.032 null — a 16× margin, versus ACC's 0.29/0.065). The correlation is real; the conclusion was not.

The two methods disagreed on the lag — **IBI 1.50 s, ACC 0.20 s** — and the stronger correlation was reported as the better instrument rather than the 1.3 s gap being treated as a falsification. Matching beats directly (each R-peak → nearest following pulse foot, which should be pulse arrival time: ~100–400 ms, tight) yields **near-uniform deltas across the whole RR interval**, with modes jumping 10 → 1010 ms between nights.

**The control makes it a finding rather than a bug report:** wrist and finger — both optical, same code, same host clock — centre at **−6 to +34 ms on 4 of 6 nights** (mode exactly 0 ms), so the timebase and the export are sound. But only **5–26% of beats** land within 100 ms of their counterpart. Beat correspondence in consumer PPG during sleep is that poor, in both streams independently.

ACC↔ACC remains the better sub-second instrument here. The published 0.2–0.4 ms IBI synchronisation (doi:10.1088/1361-6501/ae6a09) is not contradicted — it rests on beat correspondence this corpus does not have.

Also applies a precision fix to `WEARABLE-SYNC`: the ~3.3 s H10↔Verity offset is **host-stamping**, not device-clock divergence. The devices' own `sensor timestamp [ns]` values sit in different device-local epochs and yield only per-device rate, so the phone stamp is the only cross-device timeline that exists — which is why the offset matters and why it cannot be side-stepped.
