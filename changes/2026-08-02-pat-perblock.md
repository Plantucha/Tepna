<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
Correct a wrong-quantity comparison: PAT is limited by pulse transit time, not by clock alignment.

Three briefs claimed the alignment precision PAT needs is reachable, citing a per-block IQR of
43-112 ms against pat-gate.js's <=60 ms bar. That IQR is the block-OFFSET FIT residual; the gate scores
the beat-to-beat PULSE-ARRIVAL IQR. Scored properly through PatGate.verdict under per-block alignment
across six nights: median lag 405-496 ms passes the physiological window, but residIQR is 139-197 ms
and the spread of per-block PAT medians is 325-535 ms, so every night returns WEAK COUPLING. With
correspondence at 90%+ per block and the offset refit locally, the residual is pulse transit time
varying with posture, blood pressure and vasomotor tone — physiology, not clocks.
