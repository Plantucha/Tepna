# Pilot re-run results (≥1k synthetic patients) — June 2026

## RE-TEXTURE — synth-gen/2.1 + cohort-gen/1.9, hrv-confound rerun (2026-07-07)
- Running the parent rerun at 20k surfaced 3 rMSSD-scatter artifacts (hard floor line, hard ceiling line, overplot vertical edge). Owner chose a full generator re-texture (no footnotes). See `briefs/SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS-2026-07-07-BRIEF.md`.
- **synth-gen/2.1** `buildRR`: dropped τ=2 relaxor, white-noise 3→1.0, HRV-level-scaled fast variability `texF` (bulk α1 protected); SubjectA rsaGain re-fit (1.199/0.866/1.523/1.950/2.268). **cohort-gen/1.9** `rsaGainFor = clamp(√(t²−7²)/19.15, 0.06, 4.35)`.
- Verified on the real PulseDex chain (~8.9k nights): rendered≈target ±1 ms (25–60); **floor spreads 8.6–19** (pileup 0.32→0.02%), **ceiling spreads to ~76** (0.18→0.01%), **DFA-α1 0.757** (baseline 0.775).
- **hrv-confound rerun @20k (112,200 nights):** age −3.8/decade, AHI −2.4/10-AHI, R² 0.599, interaction negligible (+0.07 ms/decade·10AHI, p<0.001), AUC 0.685→0.771, **misattribution 25%→29%**; slope recovery vs planted inputs now ~10% off (reads through the realistic texture). Paper `hrv-age-confound.html` + 3 figures regenerated (N-aware 1px/alpha overplot fix in `hrv-confound-analysis.js`).
- **Part 2 COMPLETE (2026-07-07) — all 6 papers rerun on 2.1/1.9; N-aware overplot fix ported into every dense-scatter tool.** Six material conclusion changes surfaced (documented in each paper's revision note):
  - **rmssd-equivalence** (N=240, 220 windows): optical PPG−Pulse bias **collapsed +12.6→+0.3 ms** (r 0.57→0.93). With richer true beat-to-beat variance the fixed PAT jitter adds far less relative offset; optical is now near-interchangeable in bias, retaining only ~22× wider limits (PAT-jitter dispersion ≈4.0 ms). Thesis flipped from "diverges sharply" to "unbiased but noisier."
  - **qrs-yield** (N=400, 727 windows): optical apnea-specific recall dip **washed out** (clean 96.4% ≈ apnea 96.3%, was 0.9% gap); precision 92→89%; rMSSD inflation **+16%→+83%**. Fragility is real but no longer apnea-localized; QRS-vs-optical asymmetry unchanged/stronger.
  - **cgm-hrv-coupling** (6,000 pts / 48,471 nights): shared-driver conclusion **holds** (partial|AHI ≈0). within coupling −0.18→−0.11 (richer rMSSD variance dilutes it); glucose↔AHI +0.54→+0.42, rMSSD↔AHI −0.32 (stable). Hypo flag recall **0.008→1.00** (detector fix). uploads/cgm-hrv-coupling-stats.json regenerated.
  - **nights-icc** (6,000 subj): rMSSD ICC **0.929 unchanged** (variance ratio, texture-robust); CGM-CV still 0. ODI-4 ICC **0.885→0.745** (cohort-gen 1.6→1.9 AHI-ceiling change compressed between-subject apnea spread → 2 nights for ICC≥0.80, was 1).
  - **treatment-response** (912 tx / 918 flat, ≥10 nights): fusion still best (exact 91%, AUC 0.99). ODI-4 localization **95→73%** exact (shallower ODI step); rMSSD held (87%) and now **localizes better than ODI-4** — a reversal. Cohort smaller (time-bounded; ≥10-night population attrits on coverage).
  - **robustness-benchmark** (RR/HRV arm refreshed at 2,400 on 2.1/1.9): rMSSD abs-err median 0.57→0.80 ms; GlucoDex nocturnal-hypo recall **0.00→1.00** (hypo-detector fix). Oxy ODI-AHI calibration, coverage, hard-failure ledger, Figure 1 texture-independent → retained from committed 20k run.
- REMAINING (follow-up brief Part 5 only): `tools/release.mjs` (Node — left for the owner) then flip both briefs DONE.

## Part 3–4 COMPLETE (2026-07-07) — provenance cascade + gates

- **Corrected scope (empirically derived, differs from the brief's Part 3 list).** `synth-gen.js` is inlined into **six** app bundles — OxyDex, PulseDex, GlucoDex, PpgDex, HRVDex, Integrator — all of which drifted on the 2.0→2.1 re-texture. **ECGDex and CPAPDex do not inline it** and rebuilt byte-identical (proving the build core is faithful). The brief named PulseDex/ECGDex/HRVDex — wrong in both directions (ECGDex unaffected; OxyDex/GlucoDex/PpgDex/Integrator affected).
- **EXPORT-INERT re-bundle.** Every provenance fixture runs `compute({committed static input})` (real Polar RR/ECG, Welltory CSV, Lingo CGM, purpose-built synthetic txt, or in-code goldens) with **unchanged DSP code** — synth-gen.js is the demo cohort generator, off the compute/emit path. So all outputHashes + inputHashes are byte-identical; only manifestHash moved. Re-bundled all six via `tools/build-core.js` (driven headless in run_script over raw project bytes = byte-identical to `tools/build.mjs`).
- **Ledgers updated:** `BUILD-MANIFEST.json` (6 manifestHashes) + `FIXTURE-PROVENANCE.json` (9 fixtures re-recorded manifestHash, outputHash/inputHashes untouched, EXPORT-INERT note added). New hashes: OxyDex 7016053b8ee4 · PulseDex 4c732d37ea19 · GlucoDex 9b7feec22831 · PpgDex d34cbfc49e5d · HRVDex 11ea1f782360 · Integrator f19fde9a7913.
- **Gates green:** `verify-provenance.html` GATE A (8/8) + GATE B all reproduce; `Dex-Test-Suite.html?full` all-green (2117 passed, 2 skipped, 137 groups, all rigs booted) — the equiv legs confirm compute({committed input}) ≡ committed export byte-identical.
- **Release prep:** changeset `changes/2026-07-07-synth-gen-v21-retexture-reruns.md` (bump minor, type fixed) + regenerated `tests/changes-list.json`. `tools/release.mjs` (Node) intentionally left for the owner; briefs kept IN-PROGRESS until it is run.
- `papers/papers.html` updated: six rerun cards refreshed to Draft v2 + a new "Material conclusion changes (July 2026)" block in the open-findings list.


Captured live from each analysis tool's stats.json export after a streaming run.

## sensor-trio-nights — NEW PAPER: fully synthetic power result + anecdotal real comparison (June 20 2026)
- New tool `sensor-trio-power-analysis.*` (own synthetic trio generator; does NOT touch cohort-gen.js) + Monte-Carlo sweep reusing the `sigma-no-reference-analysis.js` TCH kernel. Analysis tool only — no app re-bundle / no provenance change.
- Config: 720 MC trials/cell (Web-Worker pool, per-trial deterministic seed), window 3,600 s, AR(1) φ=0.9, N ∈ {1,2,3,5,8,12,20}, ρ ∈ {0,0.15,0.3,0.5,0.7}; planted σ 1.7 / 2.2 / 6.2 bpm (O2Ring / H10 / Verity).
- **σ-vs-N (dynamic):** one ~1 h window pins every device to ±0.5 bpm; ±0.25 at ~5–8 windows; ±0.15 at ~12–20 (worst-across-devices 2 / 8 / 20). Corners are COUPLED — Verity's noise sets a shared floor, so absolute CI half-widths are similar across devices.
- **Regime = bias, not N:** dynamic recovers each true σ (bias ≈0 at N=8); resting under-recovers the instantaneous devices (H10 −0.471 bpm/−21%, Verity −0.174) because the TCH strips shared HRV; smoothed O2Ring +0.063.
- **Assumption test:** P(≥1 negative TCH variance) — ρ=0 never; ρ=0.15 ~3% @N=1 → ~48% @N=20; ρ≥0.3 nearly always caught. Below a few windows a correlated-error failure ≈ sampling noise.
- **Anecdotal real window (1, 7,057 s):** σ̂ 1.67 / 2.17 / 6.22 bpm — matches planted totals (anecdotal comparison, not a validation set); within-window block-bootstrap CIs bracket them; no negative variance; H10↔O2Ring control r≈0.74.
- Committed **uploads/sensor-trio-power-stats.json**; 3 hi-res figures (`papers/figures/sensor-trio-fig1-ci-vs-n.png`, `-fig2-regime.png`, `-fig3-real-overlay.png`). PAPER **papers/sensor-trio-nights.html** written in house style (layman + sample-size sections, 3 figures, byline, SPDX, disclaimer/dxl- stamp) + index.html entry. Paper framed **fully synthetic**; the single real window is an anecdotal comparison only.
- TOOL PARALLELIZED: added `sensor-trio-worker.js` + house Web-Worker pool (K=min(8,cores)) with live ETA, per-machine rate persist, single-instance lock, IndexedDB checkpoint/resume, cancel. Per-trial deterministic seeding → result is pool-size-independent and bit-reproducible (verified: two 500-trial runs identical). Canonical run is **720 trials/cell**, 6× workers, ~13 s, no UI freeze (the minutes/windows answers are coarse-grained and bounded, so 720 resolves them; an 8,760-trial verification gave identical conclusions, only smoother CI estimates). Added a WINDOW-DURATION sweep (“how many minutes per window?”, N=1, 1–60 min): at a single window ~60 min is the floor for ±0.5 bpm (O2Ring >60 min), ±0.25/±0.15 unreachable in ≤1 h — finer precision needs more windows, not longer ones. stats.json + all 4 figures (incl. new Figure 4; fig2 gray-box bug fixed) regenerated at 720; paper updated (new §3.5 + Table 5; §6 table renumbered to Table 6). Worker-pool how-to: `WORKER-POOL-PATTERN.md`.

## robustness — RE-RUN: 20,000 patients, COMBINED OxyFix + cohort-gen v1.7 (June 20 2026)
- Combined pass: OxyDex ceiling-baseline ODI fix (v22.36) + cohort-gen **v1.7** soft AHI-ceiling saturation (asymptote 95; replaces v1.2 hard jittered clamp 80–92, removing the residual vertical pileup at the cap). v1.7 drops one rng()/night → reshuffles downstream draws, so AHI + every AHI-dependent cohort moved (not a pure same-seed detector isolation). Both folded into ONE re-run per user direction.
- Gate: Dex-Test-Suite **all-green on v1.7**. cohort-gen is in no app bundle → app buildHashes unaffected, no re-bundle.
- From-seed-0 run, FAST lane, 6× worker pool, ~50 min, all 20,000 patients; coverage all 16 cells ≥1,092; 0 fatal / 0 throw / 0 OOB / 0 kernel-mismatch; fusion overlap 99.7% (19,930/20,000); ledger 4,829 (recall_low_severe 4,786 + no_overlap 52).
- **ODI-4 vs truth-AHI calibration, before (v16) → after (v17):**
  - overall slope **0.136 → 0.384**, bias −12.97 → **−7.87**, R² 0.917 → 0.963 (n=114,934 nights)
  - bias by severity: none −1.35→−1.02 · mild −5.13→−3.72 · mod −12.26→−8.10 · **severe −30.79→−17.22**
  - slope by severity: none 0.229→0.38 · mild 0.224→0.42 · mod 0.166→0.384 · severe 0.136→0.413
  - gradient flattened, none NOT inflated, severe undercount ≈halved
- **Per-event desat recall ~unchanged** (median 0.04→0.04): the fix moved ODI's RATE, not the desat-PROFILE nadir detector (still trailing-mean baseline; documented next step). Rate-level calibration is the faithful measure.
- Companion arms stable (detectors unchanged; inputs reshuffled by v1.7): rMSSD abs-err median 0.57 ms, CPAP residual-AHI 0.49 /h, GlucoDex nocturnal-hypo recall 0 (single-night-slice caveat).
- Digest committed **uploads/cohort-robustness-summary-20k-v17-oxyfix.json** (v16 retained as before). PAPER robustness-benchmark.html rewritten (abstract/layman/Table 2 before→after/§3.3/green callout/Fig 1 caption/§3.4/repro pins 1.6→1.7).
- Outstanding: regenerate the Figure 1 raster (middle panel) from the v17 summary — caption currently marks the panel as the pre-fix characterization with the corrected gradient in Table 2.

## ODI ceiling-baseline fix — OxyDex v22.36 (June 2026)
- detectODI baseline switched: trailing MEAN (computeBaselineArr) → trailing p90 CEILING (computeCeilingBaselineArr, O(n) 101-bin SpO₂ histogram). detectODI ONLY (minimal first cut); other nadir detectors still on the mean baseline (documented divergence, optional 2nd pass).
- Before→after, v1.6 synthetic cohort, representative re-run N=220 nights (identical SpO₂ scored under both baselines), mean ODI-4 − truth-AHI bias:
  - none −1.3→−0.9 · mild −7.9→−6.2 · moderate −14.2→−10.3 · **severe −30.6→−15.7** (severe halved, gradient flattened, none NOT inflated)
  - overall ODI-4↔AHI OLS slope 0.42→0.69 (recovers more events); reproduces the committed 20k pre-fix severe bias −30.8 closely (replica −30.6).
- Full-pipeline SubjectA pilot (real processNight, 5 nights), ODI-4 before→after: n1 6.4→12.0 · n2(severe,AHI38) 7.6→14.9 · n3 0.9→1.9 · n4 0.5→0.8 · n5 0.1→0.8; pilot slope 0.23→≈0.44 (R²≈0.94).
- AHI surrogate ×1.1 **retained** (re-examined, not re-fit): corrected ODI still under-represents AHI (truth-AHI≈1.4×ODI through origin >1 → no over-shoot); inflating it would over-fit the simulator (brief guardrail).
- Gates: Dex-Test-Suite **545/34 green** (added a ceiling-baseline contract assertion in group 13 + Node runner shares it). verify-provenance **all-green**, OxyDex buildHash **09c77b53517c UNCHANGED** (JS-only change; template untouched), fixtures stay `reproducible ✓`. OxyDex.html re-bundled (targeted manifest swap of oxydex-util.js + oxydex-dsp.js; template byte-identical).
- Fixture note: committed OxyDex *export* fixtures (tests/fixtures/oxydex.summary.json, uploads/OxyDex_*_summary.json, fusion exports ingesting OxyDex ODI) still carry **pre-fix** ODI/AHI values. Provenance GATE B (buildHash) stays green because the hash is unchanged; a GATE-C regenerate-and-diff would flag them. They were not regenerated here: the multi-night exports don't record which raw inputs produced each, so they can't be faithfully reproduced per-fixture. The test suite validates export SHAPE (not ODI values), so it stays green. **Outstanding:** drive the live app on the original O₂Ring inputs (or re-run cohort-runner 20k) to refresh these export values + the robustness paper's 20k Table 2 / Figure 1 middle panel.
- Papers: odi4-ahi-bias.html (characterized→corrected: abstract, Table 1 before/after, Table 2 cohort by-severity, §3.1/§5 + figure caption), robustness-benchmark.html (§3.3 corrected callout + abstract/layman), index.html changelog entry.

## cgm-coupling — DONE on v1.6, 2,318 patients / 18,741 nights (cgmcouple worker)
- within r −0.18 (CI −0.19…−0.16), pooled −0.17, between −0.24; partial|AHI −0.01 (shared-driver confirmed)
- driver legs: glucose↔AHI +0.54, rMSSD↔AHI −0.32; hypo recall ≈0.01 (single-night-slice caveat, 547 hypo nights)
- §1 blocker closed: cgmcouple worker branch implemented + validated. Tool now durable (checkpoint/lock/ETA), cap 100k.
- PAPER rewritten (numbers/table/figure/refs/author + layman + sample-size sections). Figure regenerated at 800pt density.

## robustness — DONE: 20,000 patients on v1.6 (STRETCH run, per user)
- 0 fatal / 0 throws / 0 OOB / 0 kernel-mismatch; 99.7% fusion overlap (19,931/20,000)
- failure ledger 4,830: recall_low_severe 4,787 + no_overlap 52 (both soft/structural)
- ODI vs truth-AHI bias by severity: none −1.4, mild −5.1, mod −12.3, severe −30.8 (R² 0.77→0.92) — severity-proportional undercount confirmed at scale
- all 16 strata ≥1,092 patients; digest saved uploads/cohort-robustness-summary-20k-v16.json
- PAPER updated (abstract/tables/figure caption/discussion/repro/sample-size) + index entry
- ALL 7 simulation pilots now done on corrected generator. Both layman + sample-size sections added to all 8 papers.

## FINAL — hrv-confound at 20k on CORRECTED generator (v1.1), Web-Worker pool
- N = 20,000 patients → **112,515 nights**, ~19 min (rrgluco pool) / ~11 min (lean pulse pool, 31 pt/s, 6 cores)
- age slope **−4.18 ms/decade**, AHI **−2.54 ms/10 AHI**, R² **0.630**
- interaction p<0.001 but magnitude +0.02 ms/decade·10AHI → effectively additive
- AUC raw **0.717 → adj 0.798**, misattribution **23.2%** (28129 flagged / 6513 false-old)
- ref healthy n=46,761 · eqn rMSSD = 65.6 − 0.418·age − 0.254·AHI
- AUC/misattribution rose vs v1.0 because removing the AHI=15 pileup (treated nights w/ +6 CPAP rMSSD bonus sitting on the AHI≥15 boundary) cleaned the screen
- PAPER + index UPDATED. Parallelism: 6× Web Workers, lean `pulse` kind added to cohort-worker.js. Live ETA + pre-run estimate added to the tool.

## treatment-response — DONE at 100k/arm scale on v1.5 (minNights=10, 1h cap)
- N = 5,953 measured patients (2,981 intervention + 2,972 flat controls), ~60 min, two-pool Web Workers (oxy+pulse)
- localization (fused): exact 96.9%, within±1 98.8%, med err 0; ODI-4 95.5%/97.9%; rMSSD 88.2%/95.9%
- detection AUC: fused 0.990, ODI-4 0.974, rMSSD 0.958; flat med R² 0.25–0.28, tx med R² 0.78–0.92
- PAPER + index UPDATED. Figure regenerated (papers/figures/treatment-response.png). References + author added.
- Tool converted to durable worker pool (checkpoint/resume + lock + ETA), cap raised to 100k/arm.

## (superseded — v1.0 generator, pre-fix) hrv-confound 1k — DONE
- N = 1000 patients → **5699 nights**
- age slope: **−4.18 ms/decade** (was ≈3.8)
- apnea slope: **−2.45 ms / 10 AHI** (was ≈2.9)
- interaction p = **0.733** (n.s. → additive confound confirmed on full N)
- AUC raw **0.652 → adj 0.703** (was 0.62→0.68)
- misattribution (old-and-healthy among flagged) = **19.5%** (1425 flagged, 278 false-old)
- model R² 0.574, ref healthy n=1773
- runtime ≈ 182 s, streaming fix held (no crash)
- PAPER UPDATED: hrv-age-confound.html + index entry. Figure regen pending.

## nights-icc — DONE at 3,000 subjects on v1.5 (two-pool Web Workers)
- (initial v1.5 run, superseded by v1.6 below)
## nights-icc — FINAL: v1.6 (raised CGM coverage), 5,556 subjects, 3 separate hi-res figures
- ODI-4 ICC₁ 0.885 (5018 subj/40,983 nights); rMSSD 0.929 (4873/39,855); CGM-CV 0 (4059 subj/32,406 days)
- latent ODI 0.940, rMSSD 0.930. CGM coverage fix: CV subjects 1818→4059 (near parity); ICC still 0 (state, not trait — not a coverage artifact)
- v1.6 = v1.5 + realistic CGM adoption; rMSSD/ODI byte-identical (RNG stream unchanged), so hrv/treatment unaffected
- PAPER split into 3 separate figures (curves/bars/repro), numbers + index + changelog updated
- ODI-4: ICC₁ **0.872** (903 subj / 7395 nights), min for ICC≥0.90 = 2 nights; latent 0.931
- rMSSD: ICC₁ **0.925** (904 subj / 7673 nights), already ≥0.90 at a single night; latent 0.923
- CGM-CV: ICC₁ **0** (varBetween 0; 597 subj / 4758 days) — day-level state, no length helps
- within-CV: ODI 37.6%, rMSSD 7.7%, CV 16.4%
- PAPER UPDATE PENDING

## FIGURE ARTIFACT (user-spotted) — vertical line at AHI≈15
- Cause: cohort-gen.js CPAP residual `ahi = Math.min(ahi, clamp(ahi*0.6, 0, 15))`
  → every treated night with baseAHI≥25 collapses to EXACTLY 15 → hard vertical line.
  Plus per-patient vertical streaks (flat-arc nights share ~constant AHI, varying rMSSD).


