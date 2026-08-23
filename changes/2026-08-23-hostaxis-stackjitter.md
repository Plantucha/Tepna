<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [clock]
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---
hostAxis publishes stackJitterMs (§Task 2 layer 3, additive): the half-IQR of the residual the
running median removed (r_i − sm[i]) — the BLE/host-stack delivery-jitter component, isolated
from the drift that spreadMs carries. Same estimator as the two sibling instruments
(tools/ble-jitter-probe.py at the HCI layer, capture-host/jitterfloor.py on the PMDARRIVAL
sidecars), so the three layers are directly comparable: HCI floor ~4.5-6 ms, production sidecar
floor 14 ms, H10 streams ~23 ms = half the 45 ms connection interval (2026-08-21 night). NULL
when independent is false (a rounded host column would report its quantisation as jitter — same
reasoning as stability), and gated by nothing downstream: a diagnostic, not a knob. Documented
lower bound: a running median TRACKS structured jitter (a strict ±J alternation reads ~0 by
parity-majority; measured), so the number means "at least this much stack noise" — recovery is
honest on aperiodic jitter (uniform ±4.5 plant → 2.51 vs ideal 2.25, gate-asserted). Existing
fields (ok, ppm, spreadMs, independent, stability) untouched.
