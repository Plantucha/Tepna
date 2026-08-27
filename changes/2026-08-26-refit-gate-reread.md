---
bump: patch
type: changed
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

The 15-night re-fit gate was re-read against what changed this week. It **stays shut**, but for
different reasons than it was written with, and leaving the old ones in place would have made it
un-auditable.

**Discharged:** the gate required Box 2 first (*"if the harness cannot reproduce what is already
published, re-fitting is measuring with an uncalibrated instrument"*) — Box 2 is executed and the
harness reproduces Table 1's half-widths and Table 5 exactly. Also discharged is the argument I myself
added for keeping it: a re-fit can no longer erase the evidence of the table desync, because #1824
recorded that evidence in the brief and in the paper's provenance section. Spent reasons are marked
spent rather than left to accumulate.

🔴 **New and stronger:** a σ re-fit is not cosmetic for Table 3. The negative-variance onset is
ρ\* = σ₀_H10 / σ₀_Verity — a pure function of the planted σ — so re-fitting moves that table's
*qualitative* conclusion, not just its cells. And the corner the ratio divides by is σ_Verity, the one
figure with three irreconcilable values (1.42 / 3.51 / 0.94–1.03), so a 15-night hat would fix the
detectability claim on an unexplained number. That makes the existing unblock condition — explain the
discrepancy via the pooled-seconds hat — load-bearing for Table 3 too, a wider dependency than the gate
was written to cover. When it does unblock, the re-fit owes an extra step: recompute ρ\* under the new
triple and state it beside the regenerated table.
