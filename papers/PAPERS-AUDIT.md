# Papers audit — reconciled 2026-07-08 (was: June 2026 stale-figure + v1.0-number discovery)

> **2026-07-08 reconciliation (closes PAPERS-ROADMAP §6 criterion (a)).** The June backlog below has
> been **worked off**: every simulation paper flagged STALE-v1.0 was re-run to **synth-gen 2.1 /
> cohort-gen 1.9** (robustness-benchmark at full **20k on generator v1.7**), and the one concrete API
> bug is fixed. This file was the tracking doc while that happened; it is now a **record of a closed
> backlog** with a single documented residual. Verified by reading each paper's `meta` line + Reproducibility.

## The systemic issue (June — now RESOLVED)
All simulation papers were originally computed on the **v1.0 generator** at small pilot N. Two things
invalidated those numbers: (1) generator fix v1.1 (CPAP residual-AHI clamp removed) changed every
synthetic AHI distribution; (2) the 20k worker-pool re-run capability superseded the pilot Ns (30–626).
→ Each simulation paper was to be **re-run and rewritten**. **That work is now done** (see table);
real-data papers (sigma, the odi-bias real arm, ppg-ecg-hrv-validation) and the perspective
(synthetic-frontier) were never generator-affected.

## Per-paper status — CURRENT (2026-07-08)
| Paper | Data | Re-run state | Style/rewrite | Verdict |
|---|---|---|---|---|
| hrv-age-confound | sim | ✅ synth-gen 2.1 / cohort-gen 1.9 (Draft v1, updated Jul) | journal style applied | **DONE** |
| nights-icc | sim | ✅ synth-gen 2.1 / cohort-gen 1.9, 6,000 subj (Draft v2) | done | **DONE** |
| treatment-response | sim | ✅ synth-gen 2.1 / cohort-gen 1.9 (Draft v2, exact 91% / AUC 0.99) | done | **DONE** |
| cgm-hrv-coupling | sim | ✅ synth-gen 2.1, 6,000 pt / 48,471 nt (Draft v2) | done | **DONE** |
| robustness-benchmark | sim | ✅ **20k, generator v1.7** + companion arm synth-gen 2.1 (Draft v2) | done | **DONE** |
| qrs-yield | sim FULL | ✅ re-run feasible N on synth-gen 2.1 (Draft v2, ≈363 win/arm) | done | **DONE** |
| rmssd-equivalence | sim FULL | ✅ re-run synth-gen 2.1 / cohort-gen 1.9, 240 pt (Draft v2) | done | **DONE** |
| odi4-ahi-bias | 5 real nt + synth power | real arm current + detector fix (v22.36); **synth power arm still on v1.6 cohort (Table 2, N=220)** | done | **DONE w/ residual** ↓R1 |
| sigma-no-reference | REAL | n/a (generator-independent) | error/style audit only | **DONE** |
| sensor-trio-nights | sim (self-contained MC) | n/a — own generator, not cohort-gen; 720 trials/cell (Draft v1) | done | **DONE** (added to ledger 2026-07) |
| synthetic-data-frontier | perspective | n/a | error/style audit only | **DONE** |
| ppg-ecg-hrv-validation | REAL | n/a (real co-recordings; **Draft v2, Jul — 4→20 paired nights**) | done | **DONE** (v2 supersedes v1, 2026-07-21) |
| ppg-quality-gate-pooling | REAL | n/a (same 20-night corpus; Draft v1, Jul) | done | **DONE** (new, 2026-07-21) |
| timestamp-pathology | methods (real+synth) | n/a — live over shipping parser (Draft v1, Jul) | done | **DONE** (new, 2026-07) |
| dead-ends | synthesis | n/a — regenerates from source tools (Draft v1, Jul) | done | **DONE** (new, 2026-07) |
| cpap-flow-reference | REAL (n-of-1 methods) | n/a — generator-independent; 26 nights / 172 h real corpus (Draft v1, Jul) | drafted | **DRAFT** ↓R2 (new, 2026-07-22) |
| acc-respiratory-rate | REAL (n-of-1) | n/a — generator-independent; 19,193 real epochs vs CPAP flow (Draft v1, Jul) | drafted | **DRAFT** ↓R2 (new, 2026-07-22) |
| effort-typing-null | REAL (n-of-1, negative) | n/a — generator-independent; 401 scored events (Draft v1, Jul) | drafted | **PARKED** ↓R3 (new, 2026-07-22) |

## Open residuals on the 2026-07-22 additions

**R2 — the three respiratory papers are DRAFT until the corpus is re-run through the tool.**
`resp-acc-analysis.html` now exists and runs the **shipped** `MOTIONDSP.respiratoryRate` rather than a
reimplementation, and it reproduces the original harness on four spot-checked nights (clock offsets
within **8 s**, per-night MAE within **0.06 br/min**). What is outstanding is the **full 26-night
end-to-end re-run through the tool**, plus emitting figures into `papers/figures/`. Until then the
headline figures trace to the original external harness, which does not satisfy the house rule
*"no number without a tool that reproduces it"*. Each paper carries a visible banner saying exactly
this — do not clear it early.

**R3 — `effort-typing-null` is PARKED, not merely draft.** Four reasons, in order: the mechanism
behind the 0.99× ratio is **unexplained** (the CPAP-pressure candidate was tested against
`MaskPress.2s` and *fails* — ρ = −0.174, p = 0.0008, the opposite of its prediction); obstructive
**n = 31**; the event labels are the CPAP manufacturer's algorithm rather than PSG scoring; and an
adversarial literature review surfaced a prior report whose direction may run *opposite* to the
assumed mechanism. Publishing an unexplained negative is a weaker position than an explained one.
The engineering consequence is already actioned separately in
`briefs/INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22-BRIEF.md`.

**Shared bounding limitation on all three.** Single subject, and — measured, not assumed — a single
sleeping posture (gravity-roll IQR 13.1–17.9°). Doheny 2020's supine-vs-lateral effect could not be
replicated (1.02× vs their 1.54×) *by absence of exposure*, not by contradiction. No
posture-robustness claim may be made from this corpus; the synthetic adversarial twin in
`tests/dex-tests.js` gates that property instead.

## Concrete errors found (June) — DISPOSITION
- **API inconsistency (real bug) — ✅ FIXED.** June: `treatment-response` cited
  `processNight().odi4.rate` while `nights-icc` cited `processNight().odi`. Verified 2026-07-08: **both
  now cite `processNight().odi4.rate`** (nights-icc Reproducibility, treatment-response Reproducibility),
  matching `odi4-ahi-bias`. Reconciled against the harness `.odi4.rate` accessor. No longer divergent.
- **Stale figure — ✅ FIXED (June).** `papers/figures/hrv-ambiguity.png` regenerated from the v1.1 tool;
  the AHI=15 vertical line is gone.
- **Pilot-N language — ✅ CLEARED.** The re-run drafts state current Ns (6,000 / 20k / 240 / 2,400…)
  in abstracts, tables, and the `papers.html` index tags.

## Residuals (explicitly parked, not silently dropped)
- **R1 — odi4-ahi-bias synthetic power-analysis arm (Table 2) still cites the v1.6 cohort (N=220).**
  This is superseded in substance by **robustness-benchmark §3.3 / Table 2**, which re-measured the
  same ODI-4↔truth-AHI severity calibration at **20k on generator v1.7** with the ceiling-baseline fix.
  The odi4 paper's *headline* arm (5 real nights + the corrected-detector slope 0.23→0.69 story) is
  current; only its illustrative synth power table is old. **Parked**: fold the 20k v1.7 severity
  numbers in (or cross-reference robustness-benchmark) at the odi4 paper's next revision — low priority,
  the conclusion is unchanged and the current figure is already available in the sibling paper.

## Journal-style conventions (now applied across the re-run drafts)
Structured abstract with the synthetic hedge moved into Limitations prose (not bolded inline); effect
sizes + 95% CI + exact p in Results; N/estimate/CI/test reported consistently; honest
sim/real/perspective labelling retained in Limitations. The three July papers (ppg-ecg, timestamp,
dead-ends) follow the same template.

## Worker-pool conversion (June tracking) — COMPLETE for the shipped re-runs
hrv-confound, cgm-coupling, treatment-response, nights-icc all ran through their lean worker pools
(`pulse`, `cgmcouple`, `iccpg`, `oxy` in `cohort-worker.js`); robustness-benchmark ran the full 20k
pool. Generator is now **synth-gen 2.1 / cohort-gen 1.9** (robustness 20k artifact pinned at v1.7);
all prior pilot numbers are superseded and the shipped drafts reflect the current generator.

## Net
**Criterion (a) of PAPERS-ROADMAP §6 is met:** the re-run/rewrite backlog is closed, with one minor
residual (R1) explicitly parked and covered elsewhere. Combined with §6 criterion (b) (both "now"
candidates 2.1 + 2.2 shipped), the roadmap is "done for now" except the MED-effort now-candidate 2.3
(cross-signal plausibility QC) and the node-gated 3.1–3.6.
