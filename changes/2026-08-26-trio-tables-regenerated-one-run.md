---
bump: patch
type: changed
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

`papers/sensor-trio-nights.html` — all four simulation tables are now produced by **one run**, and the
paper carries a *Provenance of the simulation tables* section so a reader can re-derive every one of
them from a single command (`node tools/trio-power-headless.mjs --trials 50000`). Run stamp: 2026-08-26,
lane `webgpu`/`amd/rdna-3`, 50,000 trials/cell, 4.1 s, deterministic. Planted σ **2.72 / 1.86 / 1.94**
— the committed 10-night hat, **unchanged; no σ re-derived or swapped**, so the standing instruction
against swapping re-derived σ into the paper is honoured.

Tables 1 and 5 **reproduced exactly** (Table 1's half-widths at the prior 20,000 values; Table 5's
20/60/>60 unchanged), which is what licenses reading the other two as defects. Table 2 (bias) is
replaced — its figures belonged to the superseded planted σ 1.7/2.2/3.0 and were never re-run when the
σ were re-planted; flatness in N is now verified (≤0.002 across N=1…20) rather than asserted.

🔴 **Table 3 is replaced and a published claim reverses.** The paper argued a moderate error correlation
is detectable (*"ρ=0.3 is caught ~55% at N=1 … ρ≥0.5 every time"*). At the shipped σ, ρ = 0.15, 0.30 and
0.50 produce **no** negatives at any N; only ρ=0.70 registers. This is analytic, not sampling noise, so
no trial count could have reproduced the old table: with `c = ρ·σ₀_H10·σ₀_Ver` the H10 corner recovers
`σ²_H10 − c`, so a negative requires **ρ > σ₀_H10/σ₀_Verity** — 0.918 at the shipped hat, 0.648 under the
interim σ, both matching measurement, and no committed σ yields the ≈0.3 onset implied before. Because
the paired devices have near-equal error floors the threshold sits just under ρ=1, so the
negative-variance tell cannot certify independence at any N; the surrounding prose and Table 6's tier
rows were corrected to say so.

`tools/trio-power-headless.mjs` also exports the fourth table (window minutes) and the full bias curve,
and quotes bias at **N=8** — the N the paper's caption specifies — rather than the deepest cell. The
rendered figures are deliberately **not** regenerated and remain 720-trial output, as their captions
state.
