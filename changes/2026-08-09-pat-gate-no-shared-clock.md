<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [integrator]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
`PATGate.verdict` refuses with `NO SHARED CLOCK` when handed a `hostAxis` reporting `independent === false`. Every quantity the gate weighs compares TWO DEVICES, so it presupposes they sit on one timebase; `independent === false` says the capture host's column was derived from the device stamp, so each device rides its own crystal and per-device wander lands directly in the beat-lag scatter, indistinguishable from the physiology the gate exists to measure. Measured 2026-08-09: all six H10 nights checked show a host↔device residual spread of 0.98 ms — one stamp quantum — against 101.89–5124 ms where a real second clock exists, so the entire raw corpus is phone-captured; the PAT verdict built on it attributed 84–99 ms of scatter to PTT variability, an attribution that is not identifiable without a shared clock. The axis argument is optional and LAST, so callers that pass nothing are byte-for-byte unchanged and only an explicit `false` refuses — the refusal names itself in `label` and carries the measured `spreadMs` in `why` so it can be audited rather than inferred. Verified red-by-value: 7 assertions fail without it.
