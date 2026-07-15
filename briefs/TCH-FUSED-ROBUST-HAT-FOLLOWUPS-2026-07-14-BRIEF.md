<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-14 · **Follows:** `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md`

# Fused-hat follow-ups — where `beatConfidence` + robust-variance generalize across the Dex fleet

Discovered while building the fused hat: the artifact fragility we fixed for the three-cornered hat is
**not** trio-specific. `RMSSD`/`SDNN`/`CV`/`MAGE` are all **variance-family estimators with breakdown point
0**, so the SAME transient that inflated σ_H10 → 9.6 bpm inflates every one of them the same way; and
`beatConfidence` (window-relative density × SQI, AF-safe via `min`) is a signal-agnostic per-second trust
that any beat/event series can consume. This is the transfer map, not yet executed.

## Transfer map (surveyed: the node DSPs compute these)
| # | finding | target | directness |
|---|---|---|---|
| 1 | `beatConfidence` → ECGDex's **own** HRV (`buildNN`/`epochEngine`), not just the trio | ECGDex | **drop-in** — closes the 06-12 loop for ECGDex's own `RMSSD`/`SDNN`/epoch exports. *(Promoted into the parent brief as an explicit step.)* |
| 2 | `beatConfidence` on the RR series | PulseDex, HRVDex | drop-in structure; each needs an RR-plausibility "quality" channel to stand in for SQI |
| 3 | **robust / confidence-weighted variance** for `RMSSD`/`SDNN` | all HRV nodes (PulseDex · HRVDex · ECGDex · OxyDex) | principle-direct — same estimator, same fix (weighted or Qₙ-based scale) |
| 4 | density × quality window gate → **event counts** (a sustained motion segment fabricates false events) | OxyDex **ODI**, CPAPDex **AHI** | principle-transfer; "density" = event rate. Aligns with `DEEP-AUDIT-2026-07-14`'s OxyDex-ODI findings |
| 5 | robust scale for CGM variability | GlucoDex `CV`/`SD`/`MAGE` (compression lows inflate them) | principle-transfer; no beats → adapt to level-jump / change-point detection |
| 6 | **dead-cue audit** — a quality input silently ≈ 0 corpus-wide (ECGDex `bSQI`: `detectPeaksB`'s global-`mx` floor → 0–55 beats/night, so the 0.28-weight `matchB` term is dead) | any node with a quality cue | audit lesson — verify each quality axis actually varies |
| 7 | "local per-sample gate misses **sustained collective** artifact" (Chandola collective anomaly) | any Malik/local-median RR/ECG/PPG cleaner | design lesson — pair local gates with a window-relative, self-calibrating one |

## Notes
- **Detector B is worth a real fix regardless** (finding 6): an adaptive/windowed threshold revives it (prototyped: 25k–43k beats vs 0–55), which un-deads `bSQI` and re-enables two-detector agreement as a genuine quality axis. It was NOT usable as a hard consensus gate (false-flagged a clean 70-min block on 06-10), but as a *soft SQI term* it's currently contributing nothing.
- **AF-safety is the invariant to preserve everywhere:** any gate keys on signal quality / cross-sensor inconsistency, never on rhythm irregularity — real arrhythmia is high-variability but clean, and must survive.

## Do (when picked up — each its own executable brief + gates)
1. ECGDex-own-HRV — see the parent brief's step.
2. PulseDex/HRVDex robust HRV (`beatConfidence` on RR + weighted `RMSSD`/`SDNN`).
3. OxyDex ODI / CPAPDex AHI artifact-event suppression (coordinate with `DEEP-AUDIT-2026-07-14`).
4. GlucoDex robust variability.
5. Fix `detectPeaksB` (adaptive threshold) → revive `bSQI`.
