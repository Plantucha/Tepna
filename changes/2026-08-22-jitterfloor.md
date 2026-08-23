<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---
The production-layer delivery-jitter floor, sudo-free by design (brief §Task 2, layer 2):
capture-host/jitterfloor.py post-processes the PMDARRIVAL sidecars capture already writes — the
same userspace stamps hostAxis is fed — so it needs no privileges and no new capture surface. Two
estimators: vs-device (residual of host inter-arrivals against the device-clock schedule; REFUSED
when the device axis is drawn, detected by clock.js's modal-delta-concentration test, because a
drawn axis would launder host jitter into agreement) and folded (base interval by relative-score
candidate testing, missed frames removed modulo the base). The jitter scale is the half-IQR, not
MAD: alternating +/-J residuals — delivery jitter's common shape — are bimodal, the median lands
ON a cluster, and MAD collapsed to 1.2 ms against a 5.5 ms plant (measured); the merged btmon
sibling (tools/ble-jitter-probe.py) carried the same defect and gets the same estimator in this
change. First real night (2026-08-21): H10 ecg/acc 23 ms — half the H10's 45 ms connection
interval, the CI-quantization signature the Clock Contract predicts — Verity ppg 56 ms / acc
210 ms, night floor 14 ms (the O2Ring 1 Hz stream), consistently above the 4.5-6 ms HCI-layer
floor the probe measured. Next layer (brief): an additive hostAxis stackJitterMs diagnostic.
