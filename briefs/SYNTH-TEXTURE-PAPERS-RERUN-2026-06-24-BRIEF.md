<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SYNTH-TEXTURE — paper reruns & rewrites

**Status:** IN-PROGRESS — 2026-07-07 (execution surfaced 3 scale-only rMSSD-figure artifacts → owner chose a full generator re-texture; that re-fit + the hrv-confound rerun DONE. Follow-up now carries the rest: all 6 papers rerun on 2.1/1.9 + the provenance cascade (6 bundles owned-rebuilt EXPORT-INERT, both gates green) are EXECUTED; only `release.mjs` remains before DONE — see `SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS-2026-07-07-BRIEF.md`) · **Created:** 2026-06-24 · **Blocked-by:** `SYNTH-TEXTURE-2026-06-24-BRIEF.md` (DONE) · **Supersedes-scope:** the rerun list in that brief's §7 · **Follow-up:** `SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS-2026-07-07-BRIEF.md`

> The generator v-bump in `SYNTH-TEXTURE-2026-06-24-BRIEF.md` (new RR texture + `rsaGainFor` re-fit
> + `CohortGen/1.8` + `SYNTH.VERSION`) shifts every **RR-derived** number. This brief re-runs the
> affected analyses and rewrites the affected papers. **Do not start until the texture brief is DONE**
> (gates green, bundles green, arc lands) — running papers against a half-calibrated engine wastes the
> long FULL-lane runs.

## Scope rule — the change is RR-only (verify, then exploit it)
`buildRR` uses RNG seed offset `+202`; `renderOxy` uses `+101`; `renderGlucoAll` uses `9090`; and
`rsaGainFor` consumes **no** RNG. So **OxyDex (ODI / SpO₂ / desat) and GlucoDex (CV / mean / hypo /
dawn) outputs are byte-identical** before/after the change — **only RR-derived metrics move**
(PulseDex rMSSD/SDNN, ECGDex HRV+CVHR, PpgDex HRV/yield, HRVDex rows).

**Verify first (one byte-diff):** regenerate one patient's `oxyCSV` and `glucoCSV` old-vs-new — they
must be identical. If they are, every oxy/CGM-only result below stays as committed; only the
RR/HRV legs are re-run. If they are **not** identical, stop — something coupled the streams and the
scope rule is void.

## Rerun matrix
| Paper | Tool(s) | What moves | Regenerate | N / notes |
|---|---|---|---|---|
| **rmssd-equivalence** | `qrs-equiv-analysis.html/.js`, `qrs-equiv-worker.js`, `papers/rmssd-equivalence.html` | all 3 corners (true RR + ECG + PPG all from `buildRR`) | scatter + agreement figures, Table 1, prose | FULL-lane → 100k infeasible; run at the committed feasible N |
| **qrs-yield** | `qrs-yield-analysis.html/.js`, `papers/qrs-yield.html` | recall, SQI-vs-recall, PPG rMSSD | recall bars, scatters, Table 1, cards | FULL-lane; feasible N. §5 says artifact gate flat → yield driven by perfusion model, unchanged in mechanism |
| **hrv-age-confound** | `hrv-confound-analysis.html/.js`, paper | rMSSD vs age | figures + numbers | run at scale (the in-progress 100k run) |
| **nights-icc** | `nights-icc-analysis.html/.js`, paper | **rMSSD ICC leg only** | rMSSD ICC numbers/figure | ODI + CGM-CV legs **byte-identical → keep committed**; ~5,556 or 100k-capped, match committed N |
| **treatment-response** | `treatment-response-analysis.html/.js`, paper | rMSSD/HRV recovery arm | recovery figures + numbers | match committed N |
| **cgm-hrv-coupling** | `cgm-hrv-coupling-analysis.html/.js`, `papers/cgm-hrv-coupling.html`, `uploads/cgm-hrv-coupling-stats*.json` | **rMSSD side + the correlation** (glucose side stable) | r / CI / partial-r, Figure 1, stats JSON | glucose leg byte-identical; only the rMSSD axis + coupling move |
| **robustness-benchmark** | `cohort-runner.html`, `uploads/cohort-robustness-summary*.json` | **RR/HRV detection-robustness portions** | the RR/HRV rows of the summary + paper | oxy/gluco robustness rows stable |

## Explicitly NOT re-run (texture-independent)
- **`odi4-ahi-bias`** — synth arm is oxy ODI (no RR) → byte-identical; real arm was always gen-independent. **Both arms untouched** (corrects the texture brief's §7, which listed the synth arm).
- **`sigma-no-reference`** — real data.
- **`sensor-trio-*`** — own dedicated generator, does not touch `cohort-gen`/`synth-gen`.
- Real captures in `uploads/` / `uploads/synthetic/`.

## Per-paper rewrite rules
- Update the methods/provenance line in each paper to cite the new `SYNTH.VERSION` + `cohort-gen/1.8`.
- Numbers in prose must equal the regenerated figures/JSON (no stale hand-typed values).
- Keep honest caveats from the texture brief: α1 partial (0.85 vs ~1.16); the ~1.1% floor-compressed
  tail (footnote on `hrv-age-confound` / `treatment-response`).
- FINDINGS §6: the texture constants (30 / 0.35 / 3) are global — if a paper plots a *distribution*
  of a texture-derived metric (SampEn / DFA-α1 spread), jitter them per-patient before publishing that
  figure (or footnote that the spread is generator-uniform, not population variance).

### Done when
- [ ] Byte-diff confirms oxy + CGM outputs unchanged (scope rule holds).
- [ ] Each listed paper re-run at its feasible N; figures + committed result JSONs regenerated.
- [ ] Prose numbers + version pins updated in every affected `papers/*.html`.
- [ ] A FINDINGS §9-style status row per paper marked done; the NOT-re-run set confirmed untouched.
- [ ] Spawn `SYNTH-TEXTURE-PAPERS-FOLLOWUPS-…` only if a conclusion materially changed (e.g. a coupling
      slope flipped significance); otherwise note "no follow-up" here.
