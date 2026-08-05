<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---

Register a PMD stream's live nominal rate as 0 (unknown) until negotiation lands, so the monitor
stops painting healthy streams amber.

`telemetry.stream_health` grades WEAK as `eff_fs < 0.7 * nominal_fs`, so the denominator has to be
the rate the device actually agreed to. `run_polar` registered `pmd.SAMPLE_HZ[meas]` instead — the
rate the hardware *ships* at — and only re-registered with `used_fs` after negotiation. In that
window the denominator was a number nobody had chosen. `PROJECT_HZ` picks ACC 50 and MAG 20, and a
config narrows further (vigil runs ACC 25 / MAG 10), so ACC delivering its negotiated 25 Hz was
scored against 200 → 0.125, and MAG against 50 → 0.21. Both paint amber while the link is perfect,
and it re-fires on every reconnect — `link_epoch` reached 5 and 6 on the night of 2026-08-04 alone.

Measured, not inferred: that night's Verity `_MAG.txt` holds 287,004 samples over 7.75 h at a mean
10.28 Hz, one sample per host-arrival stamp (median 1, max 2 — not batched), inter-arrival p99
0.098 s and max 0.924 s. It is never silent long enough to be a real stall and never slow enough to
be a real weak; the amber was arithmetic, not signal.

0 already means "irregular / rate unknown" and routes `stream_health` to the silence-only branch —
the same honesty PPI has always used — so an unknown rate can no longer manufacture WEAK, while
genuine silence is still caught. Two canaries: one pinning that a 0 nominal never grades WEAK at any
effective rate (and still stalls on silence), one reading the registration line itself, since it sits
behind a live BLE session no unit test reaches. The second was verified against the re-applied
defect, not just against the fix.
