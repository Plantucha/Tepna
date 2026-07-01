# BRIEF — New paper: "How many nights to measure a sensor? Sample-size for reference-free σ across a device trio"

**Author of brief:** design/analysis agent · June 2026
**For:** AI coder/author picking this up fresh (self-contained — read top to bottom)
**Type:** New pilot in the Tepna working series. **Simulation-powered + real-data validation**, the
same shape as the other pilots (synthetic ground truth → confirmed on real captures).
**Depends on / reuses:** the Verity-σ-corner tooling (`VERITY-SIGMA-CORNER-BRIEF.md`) and
`sigma-no-reference-analysis.*`. **Companion to** `papers/sigma-no-reference.html` (which establishes
the reference-free σ *method*) and `papers/nights-icc.html` (the "how many nights?" template).
**Honor `CLAUDE.md`** (Clock Contract; this is an analysis tool, NOT a bundled detector — no
re-bundle/provenance unless you touch a `*-dsp.js` node).

---

## 0. TL;DR
`sigma-no-reference` showed you can get a per-device error σ with **no calibrated reference** via the
three-cornered hat (TCH) over a simultaneous O2Ring + Polar H10 + Verity window. But it leaves the
practitioner's real question unanswered: **how many co-recorded nights (windows) do you actually need
to pin each device's σ to a usable precision?** This paper answers that. It is the **device-metrology
analog of nights-icc**: nights-icc = "how many nights to pin a *person's* metric (ICC + Spearman–
Brown)"; this = "how many trio-windows to pin a *sensor's* error σ (TCH CI vs N)". Deliver a curve of
σ-CI-width vs N_windows per device + a minimum-N recommendation, **powered by simulation with known σ**
(so there is a result now) and **validated on the real trio windows** as they accumulate.

## 1. The question & why it's distinct from the companions
- `sigma-no-reference`: *can* we get σ with no reference? (yes — method paper). Its Verity corner is a
  single window → no CI. THIS paper turns "one window" into "how many windows do you need."
- `nights-icc`: how many nights to make a per-subject *metric* reliable (ICC₁, Spearman–Brown). Same
  "how many nights" question, different unknown: there the unknown is between- vs within-subject
  variance of a metric; here it is the **measurement-error variance of an instrument**.
- Novelty beyond a rehash:
  1. **Regime dependence.** TCH pairwise-variance estimates are noisier when *true* HR variance is low
     (resting). The current real data sits in exactly that low-variance regime (pairwise r≈0.5 despite
     near-zero bias). So the answer is not one number — it is "how many nights *of what kind*," and the
     paper quantifies the resting-vs-dynamic difference. This is the scientific reason the capture
     protocol needs a non-resting session.
  2. **Assumption-testability.** TCH assumes uncorrelated device errors (σ²_A = ½(V_AB+V_AC−V_BC));
     a negative recovered variance is the tell of correlated errors / an over-concordant pair. "How
     many windows before the uncorrelated-error assumption is even *checkable*" is itself a result.

## 2. Method — Part 1: simulation-powered TCH precision (the result you can produce NOW)
Build a small synthetic generator for the trio (NEW analysis tool, e.g.
`sensor-trio-power-analysis.html` + `.js`; do NOT touch `cohort-gen.js`):
- **Truth signal:** a synthetic 1-Hz "true HR" series per window with a controllable variance regime —
  `resting` (slow drift, small variance, e.g. SD≈3 bpm over the window) and `dynamic`
  (exercise/recovery ramp, large variance, SD≈15–20 bpm). Window length matches reality (~1–2 h,
  ≈3,600–7,200 s).
- **Three sensors = truth + independent noise** with **known** per-device σ set to the paper's real
  estimates so the sim is realistic: σ_O2Ring≈1.7, σ_H10≈2.2, σ_Verity≈6.2 bpm (Gaussian; also run a
  variant with mild AR(1)/quantization to test robustness). Optionally inject a *correlated* error
  component between a pair to show how TCH degrades (negative-variance rate) — this calibrates the
  assumption-testability finding.
- **Estimator under test:** the SAME per-window TCH kernel + cross-window aggregation built in the
  Verity-corner work (reuse it; don't reimplement). For N_windows = 1,2,3,5,8,12,20: draw N windows,
  recover each device's σ̂, repeat ~1,000 Monte-Carlo trials.
- **Outputs (the headline):**
  - **σ-recovery vs N_windows** per device: bias of σ̂, and CI half-width (or RMSE of σ̂ vs the planted
    σ). Expect CI ≈ 1/√N shrinkage; the noisy corner (Verity) needs more windows for the same ±.
  - **Minimum-N table** per device for target precisions (e.g. σ to ±0.5 and ±1.0 bpm).
  - **Regime panel:** the same curves under `resting` vs `dynamic` truth — show resting needs more
    windows (low true variance ⇒ noisier variance-difference estimates), quantifying why a non-resting
    session is worth several resting ones.
  - **Assumption panel:** rate of negative/unstable TCH solutions vs N and vs injected error
    correlation — "below k windows you can't tell a correlated-error failure from noise."
- This arm has **ground truth (the planted σ)**, so it gives a defensible "how many nights" answer
  immediately, before all real captures exist — same philosophy as the rest of the suite.

## 3. Method — Part 2: real-data validation (confirm the sim's recommended N)
- Use the real trio windows produced by the Verity-corner pipeline (raw PPG→PPGDSP for Verity, raw
  ECG→Pan-Tompkins for the H10 gold leg, O2Ring native; Clock-Contract aligned). Today: 1 window
  (06-16/17, 7,057 s). As the capture protocol adds windows, plot the **running σ̂ ± CI per device vs
  cumulative N_windows** and overlay the simulation's predicted CI band.
- **Success = real σ̂ stabilizes and its CI tracks the simulation's 1/√N prediction**, and the
  H10↔O2Ring control leg stays tight (bias≈0, SD≈2.7) every window. Divergence flags either a capture
  problem (alignment/SQI) or genuine error correlation — both reportable.
- No PSG/lab reference is needed or used — that is the entire point (reference-free).

## 4. The deliverable answer (what the paper concludes)
A practitioner-facing recommendation, e.g.:
- "O2Ring and H10 σ are pinned to ±X bpm from **~1–2** trio-windows; Verity (wrist PPG) needs **~k**
  windows for the same precision."
- "Resting nights are inefficient for σ metrology; **one dynamic (exercise/recovery) session ≈ m
  resting nights**."
- "Fewer than **j** windows cannot distinguish a correlated-error failure from sampling noise — report
  σ only with N_windows and a CI."
Mirror nights-icc's deliverable: a minimum / recommended / diminishing-returns table, but in
**windows** not subjects, per device and per regime.

## 5. Paper structure (match the house style of the other pilots)
- `papers/sensor-trio-nights.html` (new), byline **Michal Planicka · corresponding author — Tepna
  Project**, SPDX header from `licensing/SPDX-HEADERS.txt`, health intended-use disclaimer + `dxl-`
  stamp (BRIEF §6.5 / `licensing/dex-license.css`), same CSS as the other papers (copy a recent one,
  e.g. `nights-icc.html`, as the shell).
- Sections: **0. Layman overview (delete before submission)** (plain-English: "every sensor is a bit
  wrong; with three on at once you can measure each one's wrongness without a lab device — how many
  nights of wearing all three do you need?"), Abstract (Background/Methods/Results/Conclusion), 1.
  Intro (link sigma-no-reference + nights-icc), 2. Methods (sim generator + TCH estimator + real
  pipeline), 3. Results (σ-vs-N curves, regime panel, assumption panel, real overlay), 4. Discussion,
  5. Reproducibility, **6. Sample size & statistical power** (here it is self-referential and elegant:
  the paper's subject *is* sample size — state the Monte-Carlo trial count and the real N_windows
  achieved), References.
- **Figures** (separate, high-res, dark theme = tool's native render, captured at a readable scale —
  the house convention): (1) σ-CI-width vs N_windows per device; (2) resting vs dynamic regime; (3)
  real running-σ overlay on the sim band. Generate from the live tool; export
  `sensor-trio-power-stats.json`.
- Add an entry to `papers/papers.html` (status: simulation complete / real validation accumulating) and
  log in `papers/RERUN-RESULTS.md`.

## 6. Tooling notes / reuse
- **Reuse, don't reinvent:** the per-window TCH kernel + cross-window aggregation + CI come from the
  Verity-corner work (`VERITY-SIGMA-CORNER-BRIEF.md`, in `sigma-no-reference-analysis.js`). This paper
  adds (a) the synthetic trio generator and (b) the Monte-Carlo sweep over N_windows.
- **Durability/UX:** follow the house pattern used across the analysis tools — live ETA, and if the
  Monte-Carlo is long, a worker pool + IndexedDB checkpoint/lock (see `hrv-confound-analysis.js` /
  `cohort-runner.html` for the template). A power sim is light, so this may be unnecessary — judge by
  runtime.
- **Not a bundled detector.** Editing the new analysis tool needs no re-bundle/provenance. You only
  *run* `ppgdex-dsp.js`/`ecgdex-dsp.js` for the real arm (don't modify them); if you ever do modify a
  node, the full CLAUDE.md gate applies.
- Clock Contract: any real-file parsing uses the mirrored `parseTimestamp` (regex → floating-ms),
  never `new Date(str)`.

## 7. Guardrails / honesty
- Set the simulation's planted σ to the **real estimates** (1.7 / 2.2 / 6.2) so the "how many nights"
  numbers are realistic — but report that the recommendation scales with the true σ ratio (a noisier
  device needs more windows), so it generalizes beyond these exact values.
- Be explicit that the simulation answers the **precision/power** question (how N_windows controls the
  σ CI) under stated noise assumptions; the **real arm** tests whether those assumptions hold for
  these actual devices. Don't conflate the two.
- Until the real arm has several windows, report it as "validation accumulating" with the honest
  N_windows — never imply more real robustness than captured (same rule as the sigma paper).
- Do not tune the estimator to make sim and real agree; agreement (or its absence) is the result.

## 8. Definition of done
- [ ] New tool `sensor-trio-power-analysis.*`: synthetic trio generator (resting/dynamic, known σ,
      optional correlated-error injection) + Monte-Carlo sweep over N_windows reusing the TCH kernel.
- [ ] Outputs: σ-recovery (bias + CI/RMSE) vs N per device; minimum-N table; regime comparison;
      negative-variance/assumption-instability vs N.
- [ ] Real arm: running σ̂ ± CI vs cumulative N_windows overlaid on the sim band; H10↔O2Ring control.
- [ ] Paper `papers/sensor-trio-nights.html` in house style: layman + sample-size sections, 3 separate
      hi-res figures, refs, byline, SPDX, disclaimer/`dxl-` stamp.
- [ ] `papers/papers.html` entry + `papers/RERUN-RESULTS.md` log; `sensor-trio-power-stats.json` export.
- [ ] If any `*-dsp.js` node was modified (shouldn't be): full CLAUDE.md gate.

## 9. Pointers
- Method paper: `papers/sigma-no-reference.html`; "how many nights" template: `papers/nights-icc.html`.
- TCH kernel / tooling to reuse: `sigma-no-reference-analysis.js` (TRIO/TRIOS, TCH math, exporters) +
  `VERITY-SIGMA-CORNER-BRIEF.md`.
- Worker/durability templates: `hrv-confound-analysis.js`, `cohort-runner.html`.
- Real inputs (current single window): `uploads/verity-ppg-derived-2026-06-17-HR.txt`,
  `uploads/h10-ecg-derived-2026-06-17-HR.txt`, `uploads/O2Ring S 2100_20260616221235.csv`; raw parts
  `Polar_Sense_*_PPG_part*`, `Polar_H10_*_ECG_part*`.
- Derivation detectors (run, don't modify): `ppgdex-dsp.js`, `ecgdex-dsp.js`.
- House rules: `CLAUDE.md`; licensing `licensing/LICENSING-BRIEF.md`, `licensing/SPDX-HEADERS.txt`,
  `licensing/dex-license.css`.
