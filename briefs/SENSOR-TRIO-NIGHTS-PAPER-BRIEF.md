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
>    on the full corpus with a committed-artifact tool.
>
>    > ### ⛔ THAT ATTRIBUTION IS REFUTED BY ITS OWN SOURCE — checked 2026-08-20
>    >
>    > `TRIO-ARTIFACT-GATE` §2 **measured** what censoring does to the Verity σ, and it does not do
>    > this. Its own table: median σ **1.94 (N=10, censored) → 1.85 (N=15, uncensored)** — a move of
>    > **0.09 bpm (−4.6 %), in the WRONG DIRECTION**, under a section whose stated conclusion is *"The
>    > **median is robust** (1.94 → 1.85), so the papers' **headline σ stands**. It is the **mean and
>    > the CI** that were optimistic."*
>    >
>    > The open discrepancy is a **median** discrepancy — published **1.42** [0.96–1.88] against
>    > re-derived **3.51** [2.72–4.97] / **3.17**, i.e. **~2.5×**. A mechanism measured at −4.6 % on the
>    > median cannot produce it, and censoring pushes the median DOWN where the gap needs it UP.
>    > Citing §2 here reads as support because §2 *is* about Verity σ being optimistic — but it is about
>    > the **CI**, and this is the **point estimate**. Same node, same quantity name, different statistic.
>    >
>    > ⚠️ Note also that neither of §2's medians (1.94 / 1.85) equals the published **1.42**, so the
>    > paper's headline is a *third* derivation — three numbers for "Verity σ" whose commensurability
>    > nobody has established.
>    >
>    > **The better-supported candidate is CORPUS COMPOSITION, not censoring.** The paper states its
>    > number over a **twenty-six-night** corpus; the re-fit ran **N = 17, box-captured, host-axis
>    > corrected**. This brief's own provenance section (below) establishes that the other capture tree
>    > is **phone-captured** — `spreadMs = 1.000`, `independent = false`, the top of §7's phone band —
>    > so the two derivations may not be over the same population at all. That is a *hypothesis*, not a
>    > result: I have not established which nights the paper's 26 comprise.
>    >
>    > **The discriminator, and it is cheap:** re-run `tools/tch-fused-corpus.mjs` over the paper's own
>    > 26-night set and over its box-captured subset. If the gap tracks capture tree or N rather than
>    > any quality gate, the attribution above is simply wrong and the paper's number is a
>    > different-population estimate rather than a censored one. **Until that runs, the discrepancy is
>    > UNEXPLAINED** — which is a different and more honest state than "explained by censoring", and it
>    > does not change the standing instruction not to swap the numbers in. **Do not swap these numbers into the paper
>    >
>    > ### 🔬 IT RAN, 2026-08-20 — and it refuted the replacement hypothesis too
>    >
>    > One estimator (`tools/tch-fused-corpus.mjs`), one corpus (`uploads/trio`), population split by a
>    > covariate **read per night from the exports** (`quality.timingSource`) rather than by which tree
>    > someone folded. 54 solvable nights, 10 negative-variance excluded, 53/54 carrying per-beat `conf`.
>    > Decision bands were written down **before** the run.
>    >
>    > **A CONTROL was planted and it FIRED.** The corpus was re-folded under current code on
>    > 2026-08-15 (#1309 — 16 stale `PpgDexFinger` exports predating #1229, one unusable ECGDex removed),
>    > *after* the 2026-08-08 re-derivation above. So "the exports changed underneath it" was the obvious
>    > explanation. It is wrong. Re-running the identical tool on the pre-re-fold corpus, reconstructed
>    > from git at `5a64fe44^`:
>    >
>    > | corpus state | BOX n | O2 | H10 | Verity |
>    > |---|---|---|---|---|
>    > | pre-re-fold (existed 2026-08-08) | 12 | 3.28 [2.96–3.36] | 1.35 [1.21–1.41] | **1.03** [0.75–1.33] |
>    > | post-re-fold (current) | 25 | 3.13 [2.82–3.36] | 1.24 [1.14–1.41] | **0.94** [0.72–1.37] |
>    >
>    > The re-fold moves Verity by **0.09 bpm**. Not the cause.
>    >
>    > 🔴 **The load-bearing result: NEITHER corpus state reproduces 3.51.** Pre-re-fold gives **1.03**.
>    > So the 3.51 is not obtainable from `uploads/trio` at the state that existed when it was written,
>    > and its stated **N = 17** matches neither arm (n = 12 then, n = 25 now). The two figures were
>    > therefore **never over the same population**, and no single mechanism — censoring, capture tree,
>    > or re-fold — needs to explain a gap between quantities that were never the same measurement.
>    >
>    > **What this run positively establishes on `uploads/trio`:** the H10 corner reproduces the paper
>    > well (**1.24–1.35** against a published **1.28**); O2 sits somewhat high (**3.13–3.28** against
>    > **2.41**); and **Verity is the QUIETEST corner, not the noisiest** (0.94–1.03), in *both* corpus
>    > states. The banner's headline — *"both derivations put Verity noisiest"* and *"the ordering
>    > inverts"* — does **not** hold on this corpus under this tool.
>    >
>    > ⚠️ **The pre-stated decision bands did not apply, and that is reported rather than forced.** They
>    > asked whether box-vs-phone explains a 2.5× gap (box 0.94 vs phone 0.50 [0.40–0.67], n = 19). Both
>    > arms sit *below* the published 1.42, so the bands' premise — that 3.51 is reproducible and needs
>    > explaining — was falsified by the control before the comparison could be made. Answering them
>    > anyway would have been fitting a verdict to a dead premise.
>    >
>    > ⚠️ **Still not the paper's statistic.** `tch-fused-corpus` prints its own caveat: *"A median over
>    > nights is NOT the pooled-seconds hat the papers quote; it is the across-night distribution."*
>    > Everything above is a median over nights; closing that last gap means running the pooled hat, not
>    > another median.
>    >
>    > ### 📐 THE REAL SHAPE OF THIS: "Verity σ" NAMES FOUR DIFFERENT QUANTITIES (2026-08-20)
>    >
>    > Tracing the numbers rather than the mechanisms settles why nothing reconciles. **The paper itself
>    > publishes TWO triples, and says so** — `papers/sensor-trio-nights.html` reads verbatim:
>    > *"Planted σ = 2.7 / 1.9 / 1.9 (the pre-fused raw-ECG estimates; the fused real hat is
>    > 2.41 / 1.28 / 1.42, §3.4)."*
>    >
>    > | triple (O2 / H10 / Verity) | what it actually is | where |
>    > |---|---|---|
>    > | **2.72 / 1.86 / 1.94** | **planted σ, 10-night hat** — the *truth the Monte-Carlo tables simulate* | `TRIO-POWER-N15` §115 |
>    > | **2.41 / 1.28 / 1.42** | **fused real hat** — the headline | paper §3.4 |
>    > | **2.60 / 1.58 / 1.85** | **15-night hat**, post detector-fix — never shipped | `TRIO-POWER-N15` |
>    > | **2.99 / 1.78 / 3.51** | the 2026-08-08 re-derivation | banner above |
>    > | **3.13 / 1.24 / 0.94** | median over nights, box arm, one tool one corpus | the run above |
>    >
>    > **So the "discrepancy" has been computed between rows of this table as though they were the same
>    > row.** A planted σ is an *input* to a simulation; a fused real hat is an *output* of an estimator;
>    > a median-over-nights is a *third* statistic the tool itself warns is not the pooled hat. They are
>    > not rival measurements of one quantity, and no mechanism — censoring, capture tree, re-fold — was
>    > ever going to reconcile them, which is exactly what three eliminations in a row demonstrated.
>    >
>    > ⚠️ **This does NOT dissolve the whole problem, and saying so would be too convenient.** Two things
>    > still want explaining: the 2026-08-08 **3.51** matches no row and is not reproducible from
>    > `uploads/trio` at either corpus state; and this run's **Verity 0.94** sits well below every
>    > published row while its **H10 1.24** lands almost on the fused hat's 1.28 — a corner-specific
>    > divergence, not a global offset, which is the shape a detector or gating difference makes rather
>    > than a population one.
>    >
>    > **What this changes for anyone picking the thread up:** stop hunting for a mechanism that moves a
>    > σ by 2.5x, and start by naming which row you mean. `TRIO-POWER-N15` box 2 — *reproduce the
>    > published tables at the 10-night hat* — is the right next action precisely because it pins **one**
>    > row with the harness that produced it, and it is un-gated (#1602 gates only the re-fit).
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
> ### 2026-08-08, second pass — the gap is mostly NOT about the Verity corner
>
> `tools/tch-window-sensitivity.mjs` decomposes it. **σ is a monotonic function of how much of the
> night you hand the hat — for every corner.** Same 17 nights, same estimator, same code; only the
> number of simultaneous seconds changes:
>
> | window | σ_O2Ring | σ_H10 | σ_Verity |
> |---|---|---|---|
> | 3 600 s | 2.34 | 1.41 | **2.36** |
> | 11 214 s ← the papers' 291,561 s ÷ 26 nights | 2.54 | 1.57 | **2.78** |
> | full night (median 15 630 s) | 2.99 | 1.78 | **3.51** |
>
> Verity **+49 %**, O2Ring **+28 %**, H10 **+26 %** from a one-hour window to a whole night. So roughly
> **a fifth of the Verity gap closes on window length alone**, and it does so *without anyone making an
> error*: **neither paper states window length as a parameter.** Two honest analysts with the same
> devices, the same nights and the same estimator can publish σ differing by half again.
>
> That is this repo's own §7 discipline arriving one layer up. `CLAUDE.md` §7 already says
> `hostAxis.ppm` must never be quoted without its span, *"the same H10 reads −20.3 ppm over 373 min and
> −65.8 over 10.9."* The same is now measured for σ: **a reference-free σ is not a number, it is a
> number per window length.** Both σ-papers should state theirs and report the sensitivity.
>
> **Second axis — night selection.** Nights where the Verity corner tracks the chest ECG (r ≥ 0.70)
> give σ_Ver **2.72**; decorrelated nights (r < 0.70) give **3.91**. A quality gate that drops
> decorrelated nights therefore lowers the published σ *by selection, not by measurement* — the
> mechanism `TRIO-ARTIFACT-GATE` §2 named. (The shipped worker gate — σ>12 **and** decorrelated from
> both peers — excludes **0 of 17** here, so it is not what did it; a looser gate would have.)
>
> **Third, ruled out:** pooling all 267,846 s into one solve gives σ_Ver **4.15**, *higher* than the
> median-over-nights 3.51. The published figure is not a pooling artifact.
>
> ⚠️ **The residual is NOT attributable, and this is the honest stopping point.** The papers' corpus
> (2026-06-10 … 07-05) is **not re-derivable here** — its box raw is gone from this machine and the
> `Ecg nightly` tree is phone-captured, a different provenance tier. **Corpus and method are
> confounded**, exactly as `TRIO-ARTIFACT-GATE` warned in its own case, so no cause can be assigned to
> what remains. What *can* be said: a stated-nowhere methods parameter moves every corner by 26–49 %,
> which is on its own enough to require the papers to state it.
>
> ### What is owed next (and what is deliberately NOT done here)
>
> - **The corpus is NOT committed, and that is now a SETTLED DECISION, not an open question.**
>   Asked and answered by the owner **2026-08-08: the data is not to be published.** `uploads/*` is
>   gitignored with per-file `!` opt-ins under a header framing it as real biosignal data "chosen for
>   publication", and this corpus is 57 MB of one person's per-second overnight HR. **Do not re-propose
>   committing it**, and do not treat the papers' irreproducibility-from-a-fresh-clone as a gap to close
>   that way — it is a deliberate privacy posture, and it is the same one that makes the suite 100 %
>   local. The reproducibility route that IS open is the one already taken: commit the *tools*, keep the
>   data local, and state the corpus's provenance in the paper. Regenerate locally in two commands:
>   `node tools/trio-batch.mjs --src /home/michal/tepna-smoketest/captures --out <dir>` then
>   `node tools/tch-fused-corpus.mjs --dir <dir>`.
> - **Re-seeding the sim is still blocked, but the blocker is now NAMED:** state a window length,
>   re-fit at it, and report the sensitivity band beside the point estimate. The planted σ stays at
>   2.7 / 1.9 / 1.9 until then.
> - **Both σ-papers owe a window-length statement** — this is a correction to published methods, not a
>   new result, and it applies to `sigma-no-reference` as much as to this paper.
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

## 10. The pooled-seconds hat — DERIVED 2026-08-26, before writing any code

Assigned as the named unblock for two things at once (the 15-night re-fit lane, and Table 3's
defensibility — the onset ρ\* = σ₀_H10/σ₀_Verity divides by the unreproducible Verity corner). The first
question was whether this is a new estimator or a composition of parts that already exist. **It is a
composition.** Derivation first, per the standing rule that a number must be understood before it is
computed.

### The algebra

With `x_i(t) = s(t) + e_i(t)`, a pairwise difference cancels the true signal, so
`V_XY = σ_X² + σ_Y²` under independence and the three-cornered hat is **linear** in the pairwise
variances:

> `σ_A² = ½(V_AB + V_AC − V_BC)`

Decompose a variance pooled over nights, with `w_n` the **seconds** fraction of night *n* and `μ_n` that
night's pairwise bias:

> `V_pool = Σ w_n·Var_n  +  [ Σ w_n·μ_n² − (Σ w_n·μ_n)² ]`
> `       =  within-night (seconds-weighted)  +  BETWEEN-night bias variance`

Two consequences, and they are the whole answer:

1. **The solve commutes with any LINEAR pooling.** So *pool the pairwise variances, then solve* is
   identical to *solve per night, then take the same seconds-weighted mean*. Composition is legitimate;
   no new estimator is required.
2. **A MEDIAN is not linear, so median-over-nights does not commute** — and it also discards the between
   term entirely. It differs from the pooled hat for **two independent reasons**, not one. This is the
   formal content of `tch-fused-corpus.mjs`'s own printed caveat (*"a median over nights is NOT the
   pooled-seconds hat the papers quote; it is the across-night distribution"*).

### The parts already exist — verified in source, not assumed

- **`sigma-no-reference-analysis.js:412`** builds `pHV/pHO/pVO` by concatenating **per-second**
  differences across all windows, then `pooledPair = { HV: ba(pHV), … }`.
- **`ba = AnalysisStats.blandAltman`** returns `sd` over that whole concatenated array against **one
  global mean** — so it is a genuine pooled variance (within **+** between), seconds-weighted by
  construction because each second contributes exactly one element. It is **not** an average of
  per-window SDs, which is the thing that would have made this invalid.
- **`analysis-stats.js` ends in `module.exports = AnalysisStats`** — the math is directly Node-importable.
  ⚠️ The analysis-tools-inline trap therefore does **not** apply to the kernel; only the browser tool's
  *ingest* is bundled, and a Node corpus fold already exists in `tools/tch-fused-corpus.mjs`
  (per-second aligned series, `tchSigmasFused`).

**So Friday's unit is plumbing + validation + attribution, not estimator design.**

### 🔑 The attribution test — the unit may close WITHOUT a new number

The derivation hands over a falsifiable account of the σ_Verity spread (published **1.42** ·
re-derived **3.51** · re-run **0.94–1.03**), which is the actual deliverable — *explain* the three, do not
mint a fourth. The gap between any two estimators over the same nights is predicted **exactly**:

> `σ²_pooled − σ²_per-night(seconds-weighted) = ½(B_AB + B_AC − B_BC)`,  `B_XY` = across-night variance of the pairwise BIAS

So the estimators differ by a term that is **computable from the corpus**, and there are three distinct
choices in play — equal-night weighting (a median), seconds weighting (pooled), and per-second confidence
weighting (the fused hat, `tchSigmasFused`). **Test:** compute `B_XY` on the corpus and check whether the
predicted gaps reproduce the observed spread. If they do, the unit closes **by attribution** — the three
figures were never estimating the same quantity — and no fourth number is needed or wanted.

⚠️ **Pre-stated so the result cannot be fitted after the fact:** the attribution succeeds only if the
predicted gap matches the observed one **in sign and within its uncertainty**. A between-night term that
is real but too small to explain a 2.5× spread is a *partial* answer and must be reported as one, with
the residual named. Anything else is the fabricated-authority failure this brief already guards against.

## 11. The pooled-seconds hat, EXECUTED 2026-08-27 — the identity is exact, my hypothesis is refuted, and 3.51 is the outlier

§10 derived the hat and pre-registered a test: the gap between estimators should equal
`½(B_AB + B_AC − B_BC)`, `B` = between-night bias variance, and if that term explains the σ_Verity
spread the unit closes **by attribution**. It was run over 54 nights / 939,566 pooled seconds via the
new `tools/tch-pooled-hat.mjs` (6/6 planted-truth selftest, including the identity and a demonstration
that a median ≠ a seconds-weighted mean when night lengths differ).

### The algebra is confirmed exactly

| corner | σ²_pooled − σ²_weighted | ½(B_AB + B_AC − B_BC) | \|Δ\| |
|---|---|---|---|
| h10 | 0.001169268 | 0.001169268 | 6.7e-16 |
| verity | 0.001762890 | 0.001762890 | 1.6e-16 |
| o2 | 0.016817029 | 0.016817029 | 3.4e-15 |

The derivation holds to floating point. **The prediction it makes, however, is falsified.**

### ❌ B is 0.1 % — the mechanism I pre-registered does NOT explain the spread

| pair | within (seconds-weighted) | **B** (between) | pooled | B share |
|---|---|---|---|---|
| H10↔Verity | 3.657 | **0.003** | 3.659 | **0.1 %** |
| H10↔O2 | 14.155 | 0.018 | 14.173 | 0.1 % |
| Verity↔O2 | 14.135 | 0.019 | 14.154 | 0.1 % |

The per-night pairwise **biases barely vary across nights**, so the between-night term is negligible and
pooled ≈ seconds-weighted to 0.0007 bpm in σ_Verity. Per the pre-stated rule this is **not** a partial
success to be talked up: the predicted mechanism contributes essentially nothing, and the honest verdict
is **refuted**.

### ✅ But estimator CHOICE does move σ_Verity by ~1.9×, and that is the real finding

Same 54 nights, four estimators:

| estimator | σ_Verity | note |
|---|---|---|
| fused-weight median over nights | **0.72** [0.44–1.10] | **n = 44** — 10 nights excluded |
| unweighted median over nights | **0.95** [0.77–1.23] | n = 54 |
| plain median over nights | **1.14** | n = 54 |
| **pooled-seconds** | **1.35** | 939,566 s |

**0.72 → 1.35 is a factor of 1.9 from estimator choice alone, on identical data.** That comfortably
covers the published **0.94–1.03** and reaches close to **1.42**. So two of the three disputed figures
are reconciled — not by between-night bias, but by *median-vs-pooled non-linearity and confidence
weighting*.

🔴 **3.51 is not reachable by any estimator choice over this corpus.** The whole family spans 0.72–1.35.
Whatever produced 3.51 differs in **corpus, filtering, or quantity** — not in weighting. That is a
narrowing worth having: it retires an entire class of explanation for the headline discrepancy.

### ⚠️ A selection effect found on the way, and it matters more than the number

The **fused** estimator yields **10/54 negative-variance nights against 0/54 unweighted**, so its σ_Verity
median of 0.72 is taken over **n = 44** — the 10 nights where its own solve failed are dropped. Excluding
the nights an estimator cannot solve, then quoting the median of the rest, is the
[[uncertainty-band-as-gate-anti-selects]] pattern in a new place: **the exclusion is correlated with the
quantity being estimated.** The fused figure is the lowest of the four and is computed on the most
favourable subset. It should not be quoted without its n and its 10 exclusions.

## 12. Where 3.51 came from, 2026-08-27 — a RETIRED GENERATION, and no surviving configuration reproduces it

§11 retired the weighting class: no estimator choice over the current corpus reaches 3.51 (family spans
0.72–1.35). This hunt asked what does. **Pre-registered before looking:** 3.51 belongs to a different
generation/corpus; the discriminating evidence is which corpus+filter reproduces it, not more estimator
variants; **"reproduces" means landing within ±0.10 bpm (3.41–3.61)**, a band fixed in advance and not
widened afterwards.

### The producing configuration is named in the repo, and it is a THIRD axis

`PAPERS-ROADMAP` §Qualifiers records it in terms:

> *"A reference-free σ is not a number — it is a number **PER WINDOW LENGTH**. Measured on 17 nights,
> same estimator, same code, varying only how many simultaneous seconds reach the hat: σ rises
> monotonically for every corner — **Verity 2.36 → 3.51 (+49 %)**, O2Ring 2.34 → 2.99 (+28 %), H10
> 1.41 → 1.78 (+26 %) from a one-hour window to a whole night (`tools/tch-window-sensitivity.mjs`).
> **Neither σ-paper states window length as a parameter.**"*

So **3.51 = the Verity corner at whole-night window on the 17 box-captured nights available 2026-08-08.**

⚠️ **Window length was in neither my hypothesis nor my enumerated search space** (corpus × estimator ×
night-subset). The answer came from outside the enumeration, which is worth recording: enumerating a
search space is only as good as the axes you know exist, and this one was documented in a brief I had not
read. The doc-search-first mandate found it in one query.

### But that axis does NOT reproduce 3.51 today — and neither does any other

Re-run on the current corpus, every configuration in the enumerated space:

| configuration | σ_Verity | in 3.41–3.61? |
|---|---|---|
| window sweep 3600 s → whole-night, all 54 nights | **0.58 → 0.72** | no |
| box-era subset (≥2026-07-16), plain / fused | **1.15 / 0.94** | no |
| the roadmap's own window 07-16…08-08 (n=23), plain | **median 1.19**, **max 2.365** | no |
| pooled-seconds hat, 939,566 s (§11) | **1.35** | no |
| full estimator family (§11) | 0.72 – 1.35 | no |

**Not one night in the roadmap's own date window reaches the floor** — the noisiest is 2.365 against a
3.41 threshold. The window-length effect is real (+49 % is reproduced in kind: 0.58 → 0.72 is +24 % here)
but it operates on a corner that is now ~3× quieter, so it cannot carry σ_Verity to 3.51 from any
starting point available today.

### The discriminator is GENERATION, and it is measurable

**`ppgdex-dsp.js` has changed 20 times since 2026-08-08**, including fixes that act directly on beat and
interval quality:

- `e633682f` — filtfilt ran **unpadded from zero state**, so *both record ends carried a DC-sized transient*
- `344f1fbe` — the frequency domain was computed over **`correctRR`'s substituted intervals**
- `0b784c66` — the crystal axis **ran backward**, *"and was hiding real dropouts"*
- `1938a436` · `fdbcb027` · `084db04e` — the noise rule refusing at a boundary; `cvhrFromNN` returning 0
  when it could not measure; `std` returning 0 for n<2

The exports in `uploads/trio` were regenerated under the current generation. **3.51 was produced by a
PpgDex that no longer exists**, on a corner these fixes quieten. That is consistent with the standing
finding that this paper's material spans multiple generations — the σ figures do too, not only the
simulation tables.

### 🔴 The verdict, against the pre-stated band

**No surviving configuration reproduces 3.51.** Located as a *generation*, not reproducible as a
*measurement*. Both halves are the deliverable: the figure is explained (whole-night window × retired
PpgDex × the 17 box nights of 2026-08-08) and it is **not** recoverable from anything that exists now.

**Correction owed to the published methods, and it is now two-part:**

1. **State window length as a parameter.** `PAPERS-ROADMAP` already calls this *"a correction owed to
   published methods"*; §11 and this section confirm it is load-bearing — a σ without its window is
   underdetermined by up to +49 %.
2. **State the generation.** A σ quoted from a reference-free hat is a function of the DSP that produced
   the intervals, and that DSP moved 20 times in three weeks. A caption naming the corpus and the window
   is still not enough to make the number re-derivable.

⚠️ **What would settle it beyond inference:** check out `ppgdex-dsp.js` at its 2026-08-08 state, regenerate
the 17 nights' exports, and re-run the whole-night hat. That is a real unit and is **not** done here —
the generation attribution above rests on the code having demonstrably changed on the relevant paths, not
on a re-run. Recorded as inference, labelled as inference.

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
