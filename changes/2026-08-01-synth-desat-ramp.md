<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md
---
`synth-gen` glided SpO₂ toward its target with a first-order lag at `k = 0.28`, whose *initial* rate is `k × depth` — so a 10 % desaturation opened at 2.8 %/s and a 15 % one at 4.2 %/s, against the 1.5 %/s ceiling `selfGateDesat` uses to tell a systemic desaturation from a probe squeeze. OxyDex correctly rejected them: **232 of 242** events on the AHI-38 night, giving ODI-4 **1.4/h**.

Because severe nights plant deeper events, the rejection scaled with severity — which on its own reproduced the severity-dependent ODI-4 deficit that `papers/odi4-ahi-bias.html` reports as its central finding.

Saturation is rate-limited by circulation and lung oxygen stores, not exponentially relaxing, so the fix imposes the limit directly rather than shrinking `k` (which would also flatten shallow events that were never the problem). The caps are **measured**, not inherited from the brief that asked for them: 36 real nights of 1 Hz `timeseries.spo2` and 342 events carrying `onsetTMs` give onset→nadir p50 **7 s**, depth p50 **5 %**, implied **0.714 %/s**, with only **0.20 %** of real one-second falls exceeding the ceiling.

With the detector unchanged, ODI-4 vs planted AHI goes from slope **0.051** (R² 0.137) to **0.946** (R² 0.997), and the deficit flattens from 2.2 → 36.6 to a constant 2.2–4.9. The same 242 events are found either way; the difference is entirely the gate. **The severity-dependent under-count does not survive a physiological fixture** — the paper's status banner now says so.

Gated by rendering the two severest nights in-realm every run rather than pinning 3.7 MB of gitignored bytes; restoring the old glide reds all eight assertions.
