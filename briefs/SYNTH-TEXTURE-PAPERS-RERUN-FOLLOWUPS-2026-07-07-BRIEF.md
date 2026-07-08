<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-07 (Parts 1–4 EXECUTED & gate-verified; only Part 5 `tools/release.mjs` remains — Node-only, left for the owner. Part 1: generator re-texture + hrv-confound. **Part 2:** all 6 papers rerun on 2.1/1.9 at ~20%-over-diminishing-returns N, overplot fix ported fleet-wide, six material conclusion changes documented per paper + in `papers/RERUN-RESULTS.md` + `papers/papers.html`. **Part 3 (corrected scope):** the re-texture drifted SIX bundles — OxyDex/PulseDex/GlucoDex/PpgDex/HRVDex/Integrator all inline `synth-gen.js` (NOT ECGDex/CPAPDex — the brief's PulseDex/ECGDex/HRVDex list was wrong in both directions). All six owned-rebuilt (`tools/build-core.js`); EXPORT-INERT (every fixture is `compute({committed static input})` with unchanged DSP → outputHashes byte-identical, only manifestHash re-recorded in `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json`). **Part 4:** `verify-provenance` GATE A/B green + `Dex-Test-Suite.html?full` all-green (2117 passed, 2 skipped, 137 groups, all rigs booted). Changeset `changes/2026-07-07-synth-gen-v21-retexture-reruns.md` + `tests/changes-list.json` added. Do NOT flip DONE until `release.mjs` is run.) · **Created:** 2026-07-07 · **Follows:** `SYNTH-TEXTURE-PAPERS-RERUN-2026-06-24-BRIEF.md`

# Synth-gen v2.1 RR-texture re-fit — spread the HRV floor/ceiling tails, then finish the paper reruns

> **Why this exists.** Executing the parent `SYNTH-TEXTURE-PAPERS-RERUN` at scale (a 20k-patient
> `hrv-confound` run on the then-current synth-gen/2.0 + cohort-gen/1.8) surfaced **three figure
> artifacts** that only appear at N, all in the rMSSD scatters:
> 1. a hard **bottom line** — every low-HRV night stacked on one rendered rMSSD (~17.6 ms);
> 2. a hard **top line** — every high-HRV night stacked on ~61 ms;
> 3. a **vertical density edge** that shifted right as N grew.
>
> Diagnosis (empirically, on the real PulseDex chain): (1)+(2) were `cohort-gen rsaGainFor`'s hard
> gain clamp `[0.30, 3.2]` **plus** the v2.0 texture's intrinsic ~15.5 ms non-RSA variance floor;
> (3) was pure **overplotting** (the AHI histogram is smooth — no data discontinuity). The owner chose
> the **full fix** (re-texture the generator, no footnotes). Part 1 below is DONE; Parts 2–5 remain.

---

## Part 1 — DONE & verified (2026-07-07): generator re-texture + first paper

**Source changes (self-consistent, committed to the raw `.js`):**
- **`synth-gen.js` → `synth-gen/2.1`** (`buildRR`): (a) dropped the fastest relaxor `τ=2` from the
  broadband bank (`bwTau` now `[3,4,6,…,256]`) — it dominated lag-1/rMSSD but sits below DFA-α1's
  4–16-beat box; (b) white-noise term `gaussFrom(r)*3 → *1.0`; (c) **HRV-level-scaled fast variability**
  `texF = min(1, max(0.30, 0.30 + 0.70·rsaGain/0.9))` applied to the broadband `bw` and the white
  noise — bulk/high-HRV nights (gain ≥ 0.9, target ≳ 22 ms) keep FULL texture so α1 is untouched;
  low-HRV nights get a proportionally lower floor so the tail spreads. SubjectA `NIGHTS[].rsaGain`
  re-fit to the new transfer: `1.199 / 0.866 / 1.523 / 1.950 / 2.268` (targets 24/18/30/38/44 ms).
- **`cohort-gen.js` → `cohort-gen/1.9`** (`rsaGainFor`): `clamp(√(t²−7²)/19.15, 0.06, 4.35)` (was
  `√(t²−15.5²)/18.426`, clamp `[0.30, 3.2]`). Ceiling 3.2→4.35 spreads the top; floor const 15.5→7 +
  min clamp 0.30→0.06 give low targets DISTINCT gains so the bottom spreads.

**Verified on the REAL PulseDex chain** (`_texturetest2.html` + `_texworker.js`, ~8.9k nights):
target→rendered is monotonic and calibrated (rendered ≈ target ±1 ms, 25–60); **floor spreads
8.6–19 ms** (pileup 0.32%→0.02%); **ceiling spreads to ~76 ms** (pileup 0.18%→0.01%); **DFA-α1
median 0.757** (baseline 0.775 — texture preserved). ⚠️ Keep `_texturetest2.html` + `_texworker.js` —
they are the re-verification harness for any further texture touch (throwaway, `_`-prefixed).

**hrv-confound paper (1 of 6) — fully rerun at 20k on 2.1/1.9:**
- Numbers (n = 112,200 nights): age **−0.383 ms/yr** (−3.8/decade), AHI **−0.239 ms/event**
  (−2.4/10-AHI), R² 0.599, interaction β +7×10⁻⁴ (p<0.001 but negligible → effectively additive),
  **AUC raw 0.685 → adj 0.771**, **misattribution 0.286 (29%)**.
- **Two real deltas the rerun surfaced** (now reflected in the paper prose): slope recovery vs the
  planted inputs (−0.42 / −0.22) is now **~10% off** (the detector reads through the realistic texture,
  not the latent target), and misattribution rose **25%→29%**.
- `papers/hrv-age-confound.html` prose + version pins updated; figures regenerated with the overplot
  fix: `papers/figures/hrv-vs-age.png`, `hrv-vs-ahi.png`, `hrv-roc.png`. `hrv-confound-analysis.js`
  got the reusable **N-aware point style** (`ptStyle()`/`dot()`: 1px + low alpha at large N).

---

## Part 2 — REMAINING: rerun the other 5 papers (Track P, raw JS — no re-bundle needed)

Same pattern per paper: **(a)** port the `ptStyle()`/`dot()` overplot fix into that tool's scatter
draw(s); **(b)** run at **20k** (or the tool's feasible cap — FULL-lane tools are slower); **(c)** save
each figure to its committed `papers/figures/*.png` path; **(d)** rewrite the paper's prose numbers +
version pin to `synth-gen 2.1 / cohort-gen 1.9`. Scope rule still holds: **oxy + CGM legs are
byte-identical** (only rMSSD/HRV legs move) — do NOT re-run or re-figure the oxy/CGM-only results.

| Paper | Tool(s) | What moves | Keep as committed |
|---|---|---|---|
| **rmssd-equivalence** | `qrs-equiv-analysis.*`, `qrs-equiv-worker.js` | all 3 corners (true-RR + ECG + PPG, all from `buildRR`) — scatter/agreement, Table 1 | — (feasible N; FULL lane) |
| **qrs-yield** | `qrs-yield-analysis.*`, `qrs-yield-worker.js` | recall, SQI-vs-recall, PPG rMSSD | mechanism unchanged (perfusion-model) |
| **nights-icc** | `nights-icc-analysis.*` (`iccpg` worker) | **rMSSD ICC leg only** | **ODI ICC + CGM-CV ICC legs byte-identical → keep** |
| **treatment-response** | `treatment-response-analysis.*` | rMSSD/HRV recovery arm | ODI-4 arm stable |
| **cgm-hrv-coupling** | `cgm-hrv-coupling-analysis.*` (`cgmcouple` worker), `uploads/cgm-hrv-coupling-stats*.json` | rMSSD axis + the coupling r/CI/partial-r | glucose leg byte-identical |
| **robustness-benchmark** | `cohort-runner.html`, `uploads/cohort-robustness-summary*.json` | RR/HRV detection-robustness rows | oxy/gluco robustness rows stable |

**Figure-save method that works here** (native download goes to the browser, not the project): drive
the tool in the agent preview, then per figure run a `save_screenshot` step whose `code` lifts the
target `<canvas>` into a full-screen overlay drawn at 2× (see the hrv-confound save calls for the exact
snippet), saving straight to the `papers/figures/*.png` path. Numbers: intercept the tool's
`dlStats` Blob via a temporary `URL.createObjectURL` override to read the exact stats JSON.

**Watch for** (things the rerun may surface, as it did for hrv-confound): significance flips that are
really "everything is significant at large N" (report magnitude, not just p); any conclusion that
*materially* changes (a coupling slope crossing significance by magnitude) → note it in the paper AND
here. Cite `synth-gen 2.1 / cohort-gen 1.9` in every affected `papers/*.html` meta line.

**Explicitly NOT re-run** (texture-independent, unchanged from the parent brief): `odi4-ahi-bias`,
`sigma-no-reference` (real data), `sensor-trio-*` (own generator).

---

## Part 3 — REMAINING: app-fixture + provenance cascade (Track A, node-side)

Because `synth-gen` changed, the **fixed SubjectA arc** now renders different RR → the bundled apps'
export fixtures move. This is the gated provenance chain (CLAUDE.md §🔏):
1. Regenerate SubjectA app export fixtures for **PulseDex, ECGDex, HRVDex** (drive the live apps on the
   SubjectA inputs and re-export — never hand-edit). OxyDex/GlucoDex fixtures are **byte-identical**
   (oxy/CGM streams unchanged) → leave them.
2. Re-bundle those apps with the **owned build** (`node tools/build.mjs --app PulseDex …`, NOT
   `super_inline_html`); `build.mjs` auto-writes each bundle's `BUILD-MANIFEST.json` `manifestHash` +
   re-stamps its code-gated fixtures.
3. Re-record moved fixtures in `FIXTURE-PROVENANCE.json` (`ManifestGate.sha16` over raw bytes).
4. Gate: `node tools/build.mjs --check` (drift) + `verify-provenance.html` GATE A/B all-green.

*(This is why Part 1 deliberately did NOT touch the bundles — the node build owns that step cleanly.)*

---

## Part 4 — REMAINING: regression gates
- `Dex-Test-Suite.html?full` all-green — the **equivalence legs** (`env.equiv.*` for PulseDex/HRVDex/
  ECGDex/PpgDex) WILL move (their committed exports were produced by the old texture); regenerate those
  node fixtures (Part 3) so `compute({committed input}) ≡ committed export` holds again.
- `verify-provenance.html` GATE A/B green (Part 3).

## Part 5 — REMAINING: release + docs bookkeeping
- `changes/*.md` changeset — **bump `minor`** (generator behavior change; `type: fix`), then
  `node tools/release.mjs` + `node tests/gen-changes-list.mjs`.
- `papers/RERUN-RESULTS.md` — add the v2.1/1.9 re-texture + hrv-confound rerun entry (started below).
- Flip THIS brief to DONE and the parent `SYNTH-TEXTURE-PAPERS-RERUN` to DONE once Parts 2–5 land.
- Keep `DOCS-INDEX.md` + `tests/docs-ledger-list.json` in sync (this brief already added).

### Done when
- [ ] All 6 papers rerun on 2.1/1.9 (figures + prose + pins); scope rule (oxy/CGM byte-identical) held.
- [ ] SubjectA fixtures regenerated, apps re-bundled, `verify-provenance` + `Dex-Test-Suite?full` green.
- [ ] Changeset + release + RERUN-RESULTS updated; both briefs flipped to DONE.
- [ ] No conclusion materially changed OR any that did is documented in the paper + here.

## Cross-references
- Parent: `SYNTH-TEXTURE-PAPERS-RERUN-2026-06-24-BRIEF.md` (rerun matrix, scope rule) · `SYNTH-TEXTURE-2026-06-24-BRIEF.md` (the v2.0 texture this re-fits).
- CLAUDE.md §🔏 (provenance re-bundle checklist) · §🧪 (equivalence gate) · §📦 (releases/changesets).
- Verification harness: `_texturetest2.html` + `_texworker.js` (measures rMSSD transfer + DFA-α1 on the real chain).
