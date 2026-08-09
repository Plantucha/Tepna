<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
O2Ring timebase — the bad-host acceptance the brief owed, as a committed CI test.

§6 owed a demonstration on a bad-host night that the device-crystal axis beats the host-disciplined one.
The local corpus is home/stratum-1, so instead this SYNTHESISES the failure: it perturbs a finger
recording's host (Phone-timestamp) column with a holdover-grade +2000 ppm frequency error and proves the
protective property directly — the device-crystal axis's SPAN is byte-identical under a good vs a corrupted
host (its rate is the 125.000 crystal, only its absolute t0 rides the host, by design), while the
host-disciplined axis's span stretches with the bad clock (~1798 ppm at the test's anchor density,
converging to the injected 2000). Invariance is magnitude-independent — a crystal identical under 2000 ppm
is identical under any error — which is exactly why it is the safe default when the host cannot be trusted.

Corroborated on the real trio corpus (2026-08-01, a drawn-axis night, `/tmp` harness against the paired
H10 ECG): a +2000 ppm host gave BYTE-identical crystal HR/rMSSD/duration (52.5 bpm / 56.6 ms / 33825.232 s)
while the host-disciplined HR error vs the ECG grew from −0.2 to −1.2 bpm. This changeset ships the
committed, CI-run form of that (shared-assertion group `device-crystal-timebase · bad-host`). Test-only —
no bundle, no golden. Full node suite green.
