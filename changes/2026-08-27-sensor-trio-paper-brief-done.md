---
bump: patch
type: changed
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

`SENSOR-TRIO-NIGHTS-PAPER-BRIEF` flips to **DONE**. All six §8 boxes were verified in the tree and ticked
2026-08-04, the paper ships, and there were **zero open boxes** — it sat `PROPOSED` on a single caveat:
the re-fit runs but does not reproduce the paper's Verity/H10 σ. **That caveat is now an explained
finding, not an open question**, and the explanation is published rather than only recorded here.

| the σ that would not reproduce | what it is |
|---|---|
| 1.42 / 0.94–1.03 | **estimator choice** — σ_Verity spans 0.72 → 1.35 (×1.9) on identical nights (§11) |
| 3.51 | a **retired PpgDex generation** (§12), demonstrated on one night: 2.14 → 4.25 under `95986ceb` with the other two corners byte-identical (§13) |
| H10 1.28 vs 1.78 | **not attributable to ECGDex** — the hat is coupled, so a PpgDex-only swap moved σ_H10 1.643 → 1.846 with the ECG code unchanged (§13) |

The correction is landed where readers meet the numbers (#1866): `sigma-no-reference` limitation (xi), its
invalid per-corner attribution replaced with the coupling algebra, and the same caveat on
`sensor-trio-nights` Table 4. Where the producing generation is unrecorded the papers **say so** — the
headline 2.41 / 1.28 / 1.42 is marked *not presently re-derivable* rather than retro-stamped.

⚠️ **The 15-night re-fit is deliberately not claimed.** It belongs to `TRIO-POWER-N15-FINDINGS`' `[⛔]`
box and stays gated on the σ_Verity discrepancy, which §12/§13 narrowed to a generation without clearing.
Flipping this brief does not unblock that one, and the closing section says so explicitly.

DOCS-INDEX row synced by line with an identity assertion (its cell carried a "do not re-write it" warning
whose premise — an unexplained non-reproduction — is what this closes).
