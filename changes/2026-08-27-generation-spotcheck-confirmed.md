---
bump: patch
type: changed
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

§12's one inferential link is now **demonstrated**. The generation attribution for σ_Verity = 3.51 rested
on "the code demonstrably changed on the relevant paths"; a one-night spot-check converts it to a
measurement.

**Pre-registered before the run**, band set from the measured night-to-night dispersion (n=23, median
1.189, MAD 0.234, robust σ 0.347): CONFIRMS at `σ_old − σ_current ≥ +0.70`, REFUTES at `|Δ| ≤ 0.234` or
Δ negative, INCONCLUSIVE between.

**Night 2026-08-04**, stated before running — deliberately *not* the 2.365 maximum, because that night
carries only 4,756 s (1.3 h) and testing a whole-night-window claim on a 1.3-hour night confounds the axis
under test. 2026-08-04: σ 2.139 over 22,472 s.

**Design isolates the generation.** `ppgdex-dsp.js` at `95986ceb` (2026-08-08; 1,012 lines different from
today) swapped into a scratch worktree, the night regenerated via `trio-batch` into the **scratchpad only**
(`uploads/` read as source, never written), with the **H10 and O2 corners byte-identical in both arms**.

| arm | σ_Verity | σ_H10 | σ_O2 |
|---|---|---|---|
| current `344f1fbe` | 2.139 | 1.643 | 3.214 |
| 2026-08-08 `95986ceb` | **4.248** | 1.846 | 3.133 |

**Δ = +2.109 bpm, three times the CONFIRM threshold.** The old generation puts the Verity corner at 4.25,
in and above the 3.51 regime the current generation cannot reach. ⚠️ **n = 1 — the full 17 nights were NOT
run**; direction and magnitude are established, the corpus-median claim is not.

🔑 **Unbudgeted finding: one corner's DSP change moves ALL THREE recovered σ.** H10 shifted 1.643 → 1.846
with `ecgdex-dsp.js` byte-identical in both arms, because `σ²_H10 = ½(V_HV + V_HO − V_VO)` contains two
pairwise variances the Verity corner participates in. **So the published H10 discrepancy (1.28 vs 1.78)
cannot be attributed to ECGDex** — a PpgDex generation change alone shifts it. Any per-corner σ from a
reference-free hat is a function of *every* corner's generation, not just its own.
