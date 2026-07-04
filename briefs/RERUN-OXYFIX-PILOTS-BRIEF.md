# BRIEF — Re-run & rewrite the OxyDex-dependent pilots on the ceiling-baseline fix

**Author of brief:** design/analysis agent · June 2026
**For:** AI coder picking this up fresh (self-contained — read top to bottom)
**Context:** The OxyDex ODI-4 **ceiling-baseline fix** (see `OXYDEX-ODI-CEILING-FIX-BRIEF.md`) is
DONE — executed, validated, gated, re-bundled, documented. That fix removes the severity-proportional
ODI-4 **under-count** (trailing-mean baseline self-suppression → ceiling baseline). Every pilot whose
results depend on OxyDex ODI-4 / desaturation / AHI-surrogate now has **stale numbers** and must be
re-run on the corrected detector and rewritten.
**Honor `CLAUDE.md`.** ⚠️ **UPDATED June 20 2026 — combined v1.7 rerun.** The generator is now
**`cohort-gen/1.7-pilot`**: it replaces the v1.2 hard-jittered AHI ceiling (`clamp(…, 0, 80+rng()*12)`)
with a **soft asymptotic AHI-ceiling saturation** toward cap 95 (`ahi = 95·(1−exp(−ahiJit/95))`),
removing the residual vertical pileup at the cap in the ODI–AHI calibration scatter (§6 clamp-pileup
class). Because that line **drops one `rng()` draw per night** (the old `80+rng()*12` ceiling), it
**reshuffles every downstream per-night draw** — so v1.7 changes **AHI itself and every AHI-dependent
cohort** (ODI, rMSSD, CGM, CPAP all move). We therefore **fold the generator de-pile and the OxyDex
ceiling-baseline detector fix into ONE combined rerun** rather than rerunning twice. Consequences for
the four pilots:
- The before/after is now **detector fix + generator v1.7 together**, against the committed pre-fix
  v1.6 numbers. State this in each paper (it is no longer a pure same-seed isolation of the detector).
- The earlier **"rMSSD/CGM legs byte-identical"** claims (for treatment-response & nights-icc) **no
  longer hold** under v1.7 — the legs shift slightly via the RNG reshuffle even though the rMSSD/CGM
  **detectors are unchanged**. Reword to *"rMSSD/CGM detectors unchanged; their cohort inputs moved
  with the v1.7 generator."*
- Gate green on v1.7 (`Dex-Test-Suite` all-green). `cohort-gen.js` is in NO app bundle, so app
  `buildHash`es are unaffected (no re-bundle); only the sim-derived paper numbers/figures regenerate.

---

## 0. TL;DR — what to do
Re-run these **four** pilots on the fixed OxyDex and update their papers; leave the other five alone.
Order: **robustness-benchmark → odi4-ahi-bias → treatment-response → nights-icc.** Use the existing
durable worker-pool + snapshot pattern in each tool (already built). Capture the new ODI→truth-AHI
calibration; it is the proof the fix worked and feeds the odi4-ahi-bias rewrite.

## 1. Dependency analysis (why these four, not the others)
The generator is unchanged, so only OxyDex's *scoring* of the same patients moved. Affected = any pilot
reading OxyDex ODI-4 / desat metrics / the ×1.1 AHI surrogate.

**RE-RUN (OxyDex-dependent):**
| Pilot | Tool | What moves | What stays identical |
|---|---|---|---|
| robustness-benchmark | `cohort-runner.html` | ODI→truth-AHI bias/slope per severity; `recall_low_severe` flag count; ODI distribution | rMSSD/CGM/CPAP arms, fusion, crash-ledger (still 0) |
| odi4-ahi-bias | `odi-bias-analysis.html`* | the whole thesis: ODI→AHI undercount, the ×1.1 constant (re-fit), synthetic power arm, real 5-night ODI | timestamps/Clock-Contract parsing |
| treatment-response | `treatment-response-analysis.html` | ODI-4 change-point trajectory → fused localization %, detection AUC, ODI arm | **rMSSD leg byte-identical** (PulseDex unchanged) |
| nights-icc | `nights-icc-analysis.html` | ODI-4 ICC₁, its Spearman–Brown min-nights | **rMSSD + CGM-CV legs byte-identical** |

\* confirm the exact tool filename for odi4-ahi-bias (grep the paper's Reproducibility block).

**DO NOT re-run (independent of OxyDex):**
- `hrv-age-confound` — PulseDex rMSSD only.
- `cgm-hrv-coupling` — rMSSD↔glucose partialled on the **planted latent AHI (truth)**, not OxyDex.
  ⚠️ **Verify before skipping:** open `cgm-hrv-coupling-analysis.js` and confirm the partial-correlation
  uses `ahiTruth` / the ground-truth AHI, NOT a measured OxyDex ODI. If it ever reads OxyDex, add it to
  the re-run list.
- `qrs-yield`, `rmssd-equivalence` — QRS/PPG/ECG lanes, no OxyDex.
- `sigma-no-reference` — O2Ring pulse vs H10, no ODI.

## 2. Re-run mechanics (same for each tool)
Each tool already has the durable engine (Web-Worker pool + IndexedDB checkpoint/resume +
single-instance lock + live ETA). Pattern:
1. Open the tool; set N (see §3 per-pilot targets); Start. It auto-resumes if interrupted; a preview
   navigation **pauses** (data safe on disk) — keep the tab on the tool until done.
2. Snapshot the stats JSON when done (the tools expose a stats/summary export; the cohorts are
   independent so a partial snapshot is statistically valid at any point if you need to stop early).
3. **Before/after:** the committed pre-fix numbers live in `papers/RERUN-RESULTS.md` and each paper —
   record the new numbers beside them so the rewrite is a clean diff.
4. **Same seeds** ⇒ patient k is identical; only ODI changed. State that in each paper (strengthens the
   before/after claim).

## 3. Per-pilot targets & what to capture

### 3.1 robustness-benchmark (FIRST — it proves the fix at scale)
- Re-run `cohort-runner.html`, **N = 20,000**, FAST, worker pool (matches the committed v1.6 run so
  it's a true before/after). It's the heavy lane (~45 min on a 6-core machine); durable, so fine.
- **Capture the headline:** ODI-4 vs truth-AHI **mean bias + slope + R² per severity**
  (none/mild/mod/severe). Pre-fix was bias −1.4 / −5.1 / −12.3 / **−30.8** with R² 0.77→0.92
  (`uploads/cohort-robustness-summary-20k-v16.json`). **Success = the severe bias collapses toward the
  mild/moderate range and the gradient flattens**, `recall_low_severe` count drops sharply, and
  none-stratum stays ≈0 (no new false positives). Also confirm still 0 fatal/throw/OOB/kernel-mismatch.
- This run also yields the **new per-severity ODI→AHI slope** → hand it to 3.2.
- Rewrite `papers/robustness-benchmark.html`: §3.3 + Table 2 + abstract + Figure 1 middle panel +
  discussion become "undercount traced to baseline self-suppression and **corrected**; residual bias
  now …". Keep the method point (scale-as-test found it). Save the new summary as
  `uploads/cohort-robustness-summary-20k-v16-oxyfix.json` (don't overwrite the pre-fix file — it's the
  before).

### 3.2 odi4-ahi-bias (the paper the fix is ABOUT)
- Re-run its analysis tool. Two arms: the **synthetic power arm** (ODI→AHI calibration on the cohort)
  and the **real 5-night arm** (`uploads/Polar_H10_*` + `O2Ring *` for the paper's nights).
- Re-fit the **AHI surrogate constant** (was ×1.1) against truth-AHI on the NEW ODI-4 — report the new
  slope/constant and the before/after error (the fix brief predicted ≈halved error becomes ≈corrected).
- Rewrite the paper as "characterized → corrected": present the ceiling-baseline fix as the resolution,
  before/after ODI→AHI calibration, new constant. Real-night arm stays descriptive (no PSG truth).

### 3.3 treatment-response (ODI arm only moves)
- Re-run `treatment-response-analysis.html` at the committed scale (**~3,000 patients/arm**, minNights
  10, interleaved tx/flat). Two-pool (oxy + pulse); the **pulse leg is byte-identical**, so expect the
  rMSSD localization unchanged and the **ODI-4 + fused** localization %/AUC to shift (likely *improve*
  in severe patients, where ODI now tracks therapy change better).
- Update Table 1, abstract, figure, discussion. Note the rMSSD leg is unchanged by construction.

### 3.4 nights-icc (ODI ICC arm only moves)
- Re-run `nights-icc-analysis.html` at the committed scale (**~5,556 subjects** or 100k-capped run;
  match the committed v1.6 N for before/after). Two-pool (oxy + iccpg); **rMSSD + CGM-CV legs
  byte-identical**.
- Recompute ODI-4 ICC₁ + its Spearman–Brown minimum-nights. Pre-fix ODI ICC₁ ≈ 0.885. Report whether
  reduced ODI under-count changes the between-/within-subject variance split (it may *raise* ICC if the
  undercount was adding severity-correlated noise, or barely move it). Update Table 1 + curves figure.

## 4. Cross-paper consistency (don't miss these)
- `papers/papers.html`: update each re-run pilot's abstract/tags numbers; add/extend the changelog
  entry noting the OxyDex fix and which pilots were re-run on it.
- `papers/RERUN-RESULTS.md`: append the four new result blocks (before/after).
- `FINDINGS-AND-FIXES-BRIEF.md`: mark the ODI undercount as resolved across the dependent pilots.
- Keep the **layman + sample-size sections** that every paper now has — update any numbers inside them
  that reference ODI/severity bias.
- Each paper's byline stays **Michal Planicka · corresponding author — Tepna Project**; SPDX +
  disclaimer + `dxl-` stamp intact.

## 5. Gates & honesty
- These are **analysis-tool re-runs**, not detector edits — no new re-bundle/provenance needed (OxyDex
  was already re-bundled by the fix). If you discover a tool bug and edit a `*-dsp.js`, the full
  CLAUDE.md gate re-applies.
- After the re-runs, sanity-check `Dex-Test-Suite.html` is still green (it should be — the fix already
  gated it; you're only running tools).
- Report new numbers honestly with N and the before/after; if a result barely moved (e.g. nights-icc
  ICC), say so — "no material change" is a valid, informative outcome.
- **Do not** re-tune anything to hit a target; the corrected detector's numbers are whatever they are.

## 6. Definition of done
- [ ] robustness-benchmark re-run at 20k on fixed OxyDex; severe ODI bias collapsed/ gradient
      flattened; new per-severity slope captured; paper + summary JSON updated (pre-fix file kept).
- [ ] odi4-ahi-bias re-run (synthetic + real arms); ×1.1 surrogate re-fit; paper reframed
      "characterized → corrected".
- [ ] treatment-response re-run (~3k/arm); ODI + fused localization/AUC updated; rMSSD noted unchanged.
- [ ] nights-icc re-run (committed N); ODI-4 ICC + min-nights updated; rMSSD/CGM noted unchanged.
- [ ] cgm-hrv-coupling verified to use latent truth-AHI (else add to re-run list).
- [ ] index.html + RERUN-RESULTS.md + FINDINGS-AND-FIXES-BRIEF.md updated; Dex-Test-Suite still green.
- [ ] Each rewritten paper keeps house style (layman + sample-size sections, hi-res figures, byline,
      SPDX, disclaimer).

## 7. Pointers
- Fix that triggered this: `OXYDEX-ODI-CEILING-FIX-BRIEF.md` + the OxyDex changelog entry.
- Pre-fix baselines (the "before"): `papers/RERUN-RESULTS.md`,
  `uploads/cohort-robustness-summary-20k-v16.json`, and each paper's current tables.
- Tools: `cohort-runner.html`, `odi-bias-analysis.html`(verify name), `treatment-response-analysis.html`,
  `nights-icc-analysis.html`. Durable-engine template: `hrv-confound-analysis.js`.
- Generator (DO NOT EDIT): `cohort-gen.js` v1.6 — provides the independent truth-AHI you validate against.
- House rules: `CLAUDE.md`; papers index `papers/papers.html`.
