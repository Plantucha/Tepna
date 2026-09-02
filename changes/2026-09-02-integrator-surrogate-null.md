<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
The Integrator's apnea chance-null is now a surrogate test scored through the SAME greedy matching
it publishes, replacing a closed form that modelled a different statistic and over-withheld.

The analytic λ assumed independent per-desat trials; the statistic is an exclusive greedy matching,
so λ overstated chance by 21 % (8.28 vs E[nConf] 6.84 over 1500 null nights) and the gate published
at **0.95 % against its own nominal 5 %** — it withheld real findings. The null is now circular-shift
surrogates of the real surge train, shifted in covered-time so none lands in a recording gap, scored
by `_matchDesatsToSurges`, which the observed pass also calls. Shifts are EventCoupling's prime-second
set (B = 80): no PRNG, no seed, deterministic bytes. Under the code's own homogeneous null the
published rate moves **0.95 % → 4.85 %** against a 4.94 % attainable size.

MINOR because the export gains fields: `expectedConfirmedAnalytic` (the closed form kept as a
diagnostic, now with the exact `1 − e^(−rate·win)` term instead of the linear approximation that
overstated it a further 6.6 %), `nullMethod`, `nullDraws`, `pFloor`. `expectedConfirmed` now carries
the surrogate mean. `pAtLeastObserved` gains a decimal — at 3 dp the floor 1/81 rounds to 0.012, below
the exported `pFloor` of 0.0123, which is incoherent; caught by this change's own test group.

Direction for a reader: nights previously withheld may now publish. Measured on 52 real corpus
nights — published before 0, after 1, one flip (2026-07-04, p 0.207 → 0.012, AHI 0.51), none the
other way. `belowChance`'s 0.05 threshold is unchanged.
