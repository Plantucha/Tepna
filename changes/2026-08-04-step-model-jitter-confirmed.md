<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md
---
`predict_step_split`'s over-prediction is confirmed as host-stamp delivery jitter — and the claim that it *couldn't* be confirmed was wrong.

§2.1 said the jitter explanation "cannot be settled from what is recorded", naming a poll-issue-time column as the route. That reasoned from the one test that would be **direct** and never asked whether an **oblique** one existed. It did, it needed no new recording, and it ran on 220 sidecars that had been sitting on the capture box the whole time.

Re-measured over the full 2026-07-25 → 08-04 corpus — **62 sessions, 324,073 intervals**, an order of magnitude past the original 66 — the over-prediction reproduces at **1.24x** flat / **1.45x** double (pooled 1.31x, median per session 1.64x, IQR 1.01–2.21; the original 1.85x sits inside that spread). Two measurements then identify the cause:

- **A phase accumulator is WORSE** (1.35x/1.63x). Carrying fractional phase across polls was the author's own leading hypothesis — that summing `|eps|` double-counts jitter which cancels — and it is **refuted**, recorded rather than dropped. The equidistributed-phase assumption is not what fails.
- **Running-median smoothing of the host stamps removes the excess monotonically**, crossing 1.00 between raw and width 3 (raw 1.24/1.45 → med-3 0.87/0.76 → med-21 0.64/0.32). An excess living at the adjacent-sample scale is delivery jitter; real clock divergence is the low-frequency part and would survive smoothing.

The jitter measures **20.8 ms** robust sigma against each session's own 21-median (IQR 13.3–29.7, max 315.8) — 2.1 % of a ring second — and its integrated pressure (5,192) is the same order as the entire observed step count (5,617). Consistent with `DexClock.hostAxis`'s own reason for medianing rather than fitting.

⚠️ The function still ships as a **bound**, unchanged in behaviour — but a bound whose slack now has a measured cause instead of a plausible one. Docstring and brief both carry the warning **not** to pick a smoothing width by the ratio it produces: signal and noise share a band here, so any width that flattens the bias also destroys the divergence being measured (med-21 under-reads doubles by 3x). That is selecting on the outcome.

Also corrects §1 from "blocked on a deploy" to "needs one night worn": `/opt/tepna` is at `d6b8fa5` with the 12-column writer and the daemon was restarted 12:22:07 EDT, so the running process emits `ppg_n`. No sidecar carries it because all 220 predate the restart — the box *had* the code, unexecuted. Having the code and running it are two facts, and a sidecar can only witness the second.

No behavioural change; documentation and provenance only.
