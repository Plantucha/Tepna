# Papers audit — June 2026 (triggered by stale-figure + v1.0-number discovery)

## The systemic issue (affects every SIMULATION paper)
All simulation papers were computed on the **v1.0 generator** at **small pilot N**. Two things
invalidate those numbers:
1. **Generator fix v1.1** (CPAP residual AHI: removed the AHI=15 clamp pileup). Changes every
   synthetic AHI distribution → every Results table/abstract derived from it is stale.
2. **20k re-run capability** (worker pool). The "Draft v1 · pilot" Ns (30–626) are superseded.

→ Each simulation paper must be **re-run at 20k on v1.1, then rewritten**. Real-data papers
(sigma, odi-bias real arm) and the perspective (synthetic-frontier) are NOT affected by the
generator and need only an error/style audit.

## Per-paper status
| Paper | Data | Numbers state | Action |
|---|---|---|---|
| hrv-age-confound | sim | **DONE** — 20k v1.1, figure regenerated (line gone) | journal rewrite |
| nights-icc | sim (30 subj) | STALE. v1.0. 1k-v1.1 spot: ICC ODI 0.872 / rMSSD **0.925** (was .893) / CV 0 | re-run 20k v1.1 + rewrite |
| treatment-response | sim (48/43) | STALE. v1.0 | re-run 20k v1.1 + rewrite |
| cgm-hrv-coupling | sim (40pt/332n) | STALE. v1.0 | re-run 20k v1.1 + rewrite |
| robustness-benchmark | sim (600) | STALE. v1.0 | re-run 20k v1.1 + rewrite |
| qrs-yield | sim FULL (54 win) | STALE v1.0; FULL-lane waveform → 20k infeasible (hours) | re-run at max feasible N on v1.1 |
| rmssd-equivalence | sim FULL (54 win) | STALE v1.0; same FULL-lane limit | re-run feasible N on v1.1 |
| odi4-ahi-bias | 5 real nights + synth power | real arm OK; synth power-analysis arm uses gen | audit; re-derive synth arm on v1.1 |
| sigma-no-reference | REAL devices/data | unaffected by generator | error/style audit only |
| synthetic-data-frontier | perspective, no tool | unaffected | error/style audit only |

## Concrete errors found
- **API inconsistency (real bug):** `treatment-response.html` Reproducibility cites
  `processNight().odi4.rate`; `nights-icc.html` cites `processNight().odi`. Both can't be right —
  reconcile against `oxydex-dsp.js` / the harness `score.odi`.
- **Stale figure (FIXED):** `papers/figures/hrv-ambiguity.png` was the old pilot render showing the
  AHI=15 vertical line. Regenerated from the v1.1 tool — line gone.
- **N/“pilot” language everywhere:** abstracts + tables state pilot Ns (30/48/600/54…) that the 20k
  capability supersedes; the index tags ("626 nights (pilot)", "30 stable subjects", …) likewise.

## Journal-style gaps (apply in rewrite)
- Abstracts use inline **bold Background/Methods/Results/Conclusion** + a bolded "This is synthetic
  ground truth…" sentence — fine as structured abstract, but move the hedge into Limitations and
  report effect sizes with 95% CI and exact p in Results.
- Report N, estimate, CI, and test consistently (some papers give R²/AUC without CI or n).
- Keep the honest sim-vs-real labelling, but in formal Limitations prose, not bolded inline.

## Worker-pool conversion status (for fast 100k re-runs)
- **hrv-confound** — DONE (lean `pulse` pool + ETA), validated; 100k running.
- **cgm-coupling** — DONE (single `cgmcouple` pool + ETA). UNTESTED live (preview busy w/ hrv 100k); test on first free preview.
- **treatment-response** — TODO. Two-pool (`oxy` + `pulse`), join per-night ODI/rMSSD. Needs live test.
- **nights-icc** — TODO. Two-pool (`oxy` + `iccpg`: rMSSD/night + CV/day). Needs live test.
- Lean worker kinds already in `cohort-worker.js`: `pulse`, `cgmcouple`, `iccpg` (+ existing `oxy`).
- Generator now **v1.5** — all prior pilot numbers stale; final runs must be v1.5.

## Plan (paper-by-paper; each ~10–20 min run + rewrite)
1. hrv-age-confound — journal rewrite (numbers already final). [TEMPLATE]
2. nights-icc → 3. treatment-response → 4. cgm-coupling → 5. robustness : convert to worker pool, run 20k v1.1, rewrite.
6–7. qrs FULL-lane: run at feasible N on v1.1, rewrite.
8. odi4-ahi-bias: re-derive synth power arm on v1.1, rewrite.
9–10. sigma / frontier: error+style audit, light rewrite.
