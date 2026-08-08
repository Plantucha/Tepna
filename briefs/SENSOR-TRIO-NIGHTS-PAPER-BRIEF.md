**Status:** PROPOSED (**the re-fit is now RUNNABLE and has been RUN — and it does not reproduce the paper's Verity/H10 σ**; the blocker below was misdiagnosed, see the 2026-08-08 banner) · **Created:** (undated — pre-2026-07-03, grandfathered)

> ## ⚠️ 2026-08-08 — the blocker was STRUCTURAL, not a sample-size problem, and it is now fixed
>
> Both this brief and `TRIO-ARTIFACT-GATE` framed the re-fit as blocked on **N** (10 → 15), with
> `TRIO-ARTIFACT-GATE`'s 2026-08-04 header going further: *"NOT data-blocked, and never was — 25
> committed nights against a target of 15."* **That is true of `tools/tch-multinight.mjs` and false of
> the estimator this paper actually publishes**, and the difference is not one of degree:
>
> | | needs | committed corpus carried |
> |---|---|---|
> | `tch-multinight` classic/ρ-on | 5-min `epochs[].hr` × 3 | ✅ — runs fine, always did |
> | **the paper's fused-weight hat** | per-second HR × 3 **+ per-corner `c`** | ❌ **0 of 40 OxyDex exports carried ANY HR timeseries** |
>
> The O2Ring corner was **not in the file** — `timeseries` held 5-min epoch medians and 1 Hz SpO₂ and
> nothing else — and neither beat series carried `c` (only a 0/1 Malik `corrected` flag). So the fused
> hat was un-runnable on committed data **at any N**; no number of extra nights would have unblocked
> it. It stayed invisible for the reason this repo keeps finding: the *other* estimator runs happily on
> the same exports and returns plausible numbers, so every gate was green.
>
> **Fixed** by the additive `ms;hr;c` export contract (`OxyDex timeseries.hr` 1 Hz · `ECGDex
> timeseries.rr.conf` · `PpgDex timeseries.ppi.conf` — both nodes already *computed* the confidence and
> discarded it). New consumer: **`node tools/tch-fused-corpus.mjs --dir <corpus>`**, which solves each
> night twice (fused vs unweighted) and **refuses by name** when a corner is absent rather than
> silently falling back to c=1.
>
> ### The re-fit, run — N = 17, box-captured, host-axis corrected
>
> ```
> corpus σ (median [IQR] over nights, bpm)          fused             unweighted
>   O2Ring    (OxyDex)                          2.99 [2.73–3.37]   3.03 [2.85–3.53]
>   Polar H10 (ECGDex)                          1.78 [1.61–2.04]   1.67 [1.58–1.98]
>   Verity    (PpgDex)                          3.51 [2.72–4.97]   3.59 [2.93–4.95]
> ```
>
> **Three results, and only the first is comfortable:**
>
> 1. **The O2Ring corner lands near the published 2.41** — 2.99 here, and 2.45 on an independent
>    25-night derivation from the other capture tree.
> 2. **Verity and H10 are NOT reproduced.** The paper publishes Verity **1.42** [0.96–1.88] and H10
>    **1.28**; two independent derivations give Verity **3.51 / 3.17** and H10 **1.78 / 1.74**. The
>    paper's ordering (O2Ring noisiest, Verity nearly quietest) **inverts** — both derivations put
>    **Verity noisiest**. The doubling discriminator is clean on every night (Verity∶H10 median-HR
>    ratio 0.94–1.04), so this is not mis-detection inflating σ; it is the real beat-to-beat spread.
>    The likeliest cause is the one `TRIO-ARTIFACT-GATE` §2 already named — *"Verity's CI was optimistic
>    because a quality gate had been censoring the hard nights"* — and this is that finding reproduced
>    on the full corpus with a committed-artifact tool. **Do not swap these numbers into the paper
>    yet**: a σ that moves 2.5× on re-derivation needs its discrepancy explained, not published.
> 3. **The fused weighting barely matters on this corpus** — fused vs unweighted differ by ≤0.12 bpm on
>    every corner. Most artifact rejection already happened upstream, where ECGDex *drops* beats below
>    c=0.5 rather than down-weighting them. The "artifact-robust" qualifier is doing far less work than
>    its name implies — a measured negative worth carrying into `PAPERS-ROADMAP` §2.2's wall list.
>
> ### ⚠️ A provenance trap that cost this pass an hour — `Ecg nightly` is PHONE-captured
>
> `TRIO-ARTIFACT-GATE`'s 2026-08-04 note says the `Ecg nightly` fold **"REPRODUCED the committed
> corpus."** It reproduced the *dates and the σ magnitudes*; it did **not** reproduce the timing
> provenance, and nothing surfaced that:
>
> ```
> committed uploads/trio  PpgDex quality.timingSource:  device+host ×25   (box — a real second clock)
> re-derived from "Ecg nightly":                        device      ×25   (phone — no second clock)
> raw check: DexClock.hostAxis(…).spreadMs = 1.000, independent = false
> ```
>
> 1.000 ms is the exact top of `CLAUDE.md` §7's phone band (0.13–1.00 ms) against the box's
> 101.89–5124 ms — the host column is the device stamp *rounded*, which §7 calls "the absence of a
> measurement wearing the shape of one." Commit order rules out a code explanation (the corpus landed
> in #773 at 19:26, the `independent` check in #746 at 10:01 the same day). **So `Ecg nightly` and the
> committed corpus are different capture trees, and re-deriving one from the other silently downgrades
> the provenance tier.** The N=17 figures above are therefore taken from the **box** tree
> (`/home/michal/tepna-smoketest/captures`, `device+host` ×17, 3-source closure consistent).
>
> ### What is owed next (and what is deliberately NOT done here)
>
> - **The corpus is NOT committed.** `uploads/*` is gitignored with per-file `!` opt-ins under a header
>   framing it as real biosignal data "chosen for publication"; this corpus is **57 MB of one person's
>   per-second overnight HR**, so adding it under a negation rule is an owner decision about repo weight
>   and publication, not a mechanical step. Regenerate in two commands:
>   `node tools/trio-batch.mjs --src /home/michal/tepna-smoketest/captures --out <dir>` then
>   `node tools/tch-fused-corpus.mjs --dir <dir>`.
> - **Explain the Verity gap before re-seeding the sim.** The planted σ stays at 2.7 / 1.9 / 1.9.
> - The June → July-13 committed nights **cannot** be upgraded to `ms;hr;c` — their box raw is not on
>   this machine.

> **⚠️ "Do not start the paper" was misleading — the paper ALREADY SHIPS, and has since June 2026.**
> The previous header read as though nothing existed yet; a reader following it would have set out to
> write a paper that is already published. All six §8 *Definition of done* boxes verify in the tree:
> `sensor-trio-power-analysis.html`/`.js` exist and carry the synthetic generator (resting/dynamic),
> the `N_windows` Monte-Carlo sweep, injected-ρ correlated-error testing and the negative-variance
> instability check; `papers/sensor-trio-nights.html` is written in house style with the minimum-N
> **Table 1** (±0.5 / ±0.25 / ±0.15) and the H10↔O2Ring control leg; it is listed in `papers/papers.html`
> and logged in `papers/RERUN-RESULTS.md`; `sensor-trio-power-stats.json` is exported. No `*-dsp.js` was
> modified.
>
> **What is genuinely blocked is a RE-FIT of the shipped paper, not its authorship.**
> `TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md` states plainly: *"The re-fit is NOT landed"* — the
> N = 10 → 15 power re-run *"changes the CI, which is that paper's entire deliverable."* The paper is
> self-consistent about this: its real arm already runs on the twenty-six-night corpus, but its
> **simulation is still seeded at the pre-fused planted σ (2.7 / 1.9 / 1.9)**, and the sample-size curves
> — the actual deliverable — come from that simulation. So the numbers a reader would cite are precisely
> the ones awaiting the re-fit.
>
> **Therefore: do not re-write this paper, and do not stamp this brief DONE on the file's existence.**
> The remaining work is the `ms;hr;c` confidence-carrying corpus re-derivation owned by
> `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` (still LIVE), then re-fitting the planted σ and
> re-running the sweep. Until then the paper stands as published, with its own limitations section
> carrying the caveat.

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
> **All six boxes below were VERIFIED IN THE TREE and ticked 2026-08-04.** The header has said since
> 2026-08-04 that they "verify in the tree", but they were left unchecked — so the list still read as
> six items of unstarted work while the header said the opposite. Independently re-verified before
> ticking; each box records what was checked.

- [x] **Tool exists and carries all four parts.** `sensor-trio-power-analysis.js` (86 KB) + `.html`:
      resting/dynamic regimes, a Monte-Carlo sweep over `N_windows`, injected-ρ correlated-error testing,
      and the negative-variance instability check.

      ⚠ **But it does NOT "reuse the TCH kernel" — it carries its OWN `threeCorneredHat`.** The bundle
      inlines only its own JS and its GPU worker; `integrator-tch.js` is never loaded, though it exports
      both `threeCorneredHat` and `classic`. So the simulation behind this paper's sample-size curves —
      its entire deliverable — was running on a **second, ungated** implementation of the hat.
      The two are algebraically identical today (checked character-for-character), so this is not a bug
      report; it is two copies of one rule with nothing that fails when they diverge.
      **Now bound numerically** by `sensor-trio · tch-parity` (11 assertions, both lanes): the tool's own
      function is *extracted from source and executed*, then compared against `IntegratorTCH.classic` on
      five planted triples. Two mutants confirm it fails by value — swapping two output terms (8 legs) and
      **clamping negative variance to 0 (8 legs)**. That second one is why the negative-variance case is
      in the table: a clamp passes every well-behaved input, and negative variance is TCH's characteristic
      failure. ⚠ `classic(Vab,Vac,Vbc)` is the variance-level entry; `threeCorneredHat` takes three
      *series* — comparing against the wrong one returns `undefined` on every row, which is how this gate
      first failed.

- [x] **Outputs present** — σ-recovery, bias/RMSE, minimum-N table, regime comparison, negative-variance
      instability vs N all appear in the tool source.
- [x] **Real arm present** — cumulative-N running σ̂ overlaid on the sim band, with the H10↔O2Ring control.
- [x] **Paper in house style** — `papers/sensor-trio-nights.html` (40 KB): SPDX, `dxl-` stamp, byline,
      8 figure/canvas elements, Table 1, a plain-language section and a References section (Gray & Allan's
      1974 TCH paper — a conference proceeding that predates DOIs, so the absence of a `doi.org` link there
      is correct, not a missing citation).
- [x] **Registered** — listed in `papers/papers.html`, logged in `papers/RERUN-RESULTS.md`, and the tool
      exports `sensor-trio-power-stats.json`.
- [x] **No `*-dsp.js` was modified** by this work, so the full-gate clause does not apply.

**The brief stays PROPOSED**: what remains genuinely blocked is the N = 10 → 15 **re-fit** of the shipped
paper (see the header and `TRIO-POWER-N15-FINDINGS`), not any of the authorship above.

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
