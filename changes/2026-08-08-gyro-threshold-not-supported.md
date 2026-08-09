<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ppgdex]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---
Retracts the successor finding proposed alongside the F12 refutation. That entry argued the gyro motion gate saturates because whole-file p99 reaches 174 dps against a `v/40` normaliser; but the grid takes a per-cell PEAK, so the governing distribution is per-cell peaks, not raw samples. Measured across the 10 paired ACC+GYRO nights at the per-1 s-cell 95th percentile, the gyro full-scale that would make the gyro leg agree with the ACC leg's `v/120` mg is 21 dps median (range 12–130) — BELOW the 40 dps in use, so at 40 the gyro is less sensitive than the ACC leg, does not saturate on a typical night, and does not dominate `max(accNorm, gyNorm)`. Separately, F12's headline repro night (2026-07-18 Verity) is not in this corpus at all: Verity GYRO nights run 2026-06-09 → 2026-07-13, and the only 2026-07-18 data is CPAP. No threshold change shipped; `v/40` stands until either that night's files or a corpus-wide with/without-gyro `analyzablePct` comparison exists.
