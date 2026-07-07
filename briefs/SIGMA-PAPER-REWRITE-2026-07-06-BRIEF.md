<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-07-06 · **Follows:** `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` · **Touches:** `papers/sigma-no-reference.html`, `papers/sensor-trio-nights.html`, `papers/papers.html` (docs/tool only — no bundle, no provenance)

# Sigma-no-reference paper + index rewrite (raw-ECG H10, 10-night folder corpus)

> **One-line:** the `sigma-no-reference-analysis.html` tool now folder-ingests real captures and derives the
> H10 corner from **raw ECG via ECGDSP Pan–Tompkins** (the gold leg), producing a **10-night** three-cornered
> hat. The paper still reports the older committed **6-window** hat. Rewrite the paper + index on the new
> corpus — but reconcile a real reordering honestly (do NOT just swap numbers).

## What changed (context — do not redo)
- Tool: folder drop → auto-detect O2Ring+H10+Verity nights → per-night TCH in parallel (Web Workers), Verity
  HR from raw PPG (PPGDSP), **H10 HR from raw ECG (ECGDSP Pan–Tompkins)**, O2Ring native pulse; a decorrelation
  quality gate excludes failed-extraction nights. Both σ-tools share `sensor-trio-worker.js`.
- New real result (10 nights, 122,903 s, across-window CI): **O2Ring 2.72 / H10 1.86 / Verity 1.94 bpm**.
- Old paper result (committed 6 windows, raw-ECG H10): **O2Ring 1.83 / H10 2.04 / Verity 3.50**.

## The reconciliation (the reason this is a brief, not a find-replace)
H10 matches (~1.9–2.0 ✓, confirming the gold leg), but the **noisy corner reorders**: the 6-window set put
**Verity** noisiest (3.50); the 10-night set puts **O2Ring** noisiest (2.72) with Verity down at 1.94. TCH
couples the corners, so a larger/different night set + a cleaner SQI-gated Verity redistributes the variance.
Before it headlines the paper, decide + document WHY: (a) more nights incl. O2Ring motion nights; (b) the
production PPGDSP Verity corner is cleaner than the earlier derivation; (c) TCH common-mode subtraction. Likely
present BOTH — the 6-window deep raw-ECG hat AND the 10-night broad hat — rather than replacing one with the other.

## Do
1. **`papers/sigma-no-reference.html`** — update §3.2 Table 3 (add/replace with the 10-night hat, keep the
   6-window as the deep reference or a second column), §6 Table 4 sample-size ("achieved: 10 windows"), the
   abstract's headline σ, and §4 discussion (the reordering + why). State the tool now folder-ingests.
2. **`papers/sensor-trio-nights.html`** — reconcile: its planted Verity σ was re-fit 6.2→3.0 from the
   device-HR run (Verity 2.8); the raw-ECG run gives Verity 1.94. Decide the planted value once and make both
   papers agree (the planted σ drives that paper's whole sim — re-run `sensor-trio-power-analysis.html` after).
3. **`papers/papers.html`** — update both entries' abstracts/tags to the raw-ECG 10-night numbers.
4. Regenerate the tool's figures (they're sim/real outputs; re-run the tools, export the PNGs).

## Execution note (2026-07-06)
Do 1–3 EXECUTED: all three surfaces (`sigma-no-reference.html`, `sensor-trio-nights.html`, `papers.html`)
now tell one reconciled story on the raw-ECG H10 gold leg — the **deep 6-window hat** (1.83 / 2.04 / 3.50)
and the **broad 10-night folder hat** (O2Ring 2.72 / H10 1.86 / Verity 1.94, 122,903 s) are presented side
by side; H10 stability (≈1.9–2.0) confirms the gold leg; the noisy-corner reorder (Verity→O2Ring) is
documented with all three causes (more O2Ring motion nights · cleaner production PPGDSP Verity · TCH
common-mode coupling). The sim planted σ is re-fit once to **2.7 / 1.9 / 1.9** (supersedes the interim
device-HR 6.2→3.0) in both papers, with the pacing corner flipped from Verity to the (now-quietest) H10/Verity
in the min-window tables. Broad-hat CIs/ranges corrected to the real tool output (`sigma-no-reference-stats (3).json`).

**Reproducibility fix (2026-07-06, post-review).** The tool's default "Run corpus" only regenerated the deep
6-window hat; the broad 10-night hat needed the user's private raw folder (not committable — the 4 later nights'
raw waveforms are large). Fixed so the headline broad hat is reproducible from committed data:
- `sigma-no-reference-analysis.html/.js` — new **"Load committed 10-night broad hat"** button reads the archived
  folder-ingest result (`uploads/sigma-no-reference-broadhat.json`, a committed copy of the user's stats export)
  and renders all 10 nights + the σ / per-night figures + every table; `render()` guards the two per-second
  figures (overlay, Bland–Altman) that need raw samples the summary doesn't carry. `exportFig` now includes the
  headline three-cornered-hat canvas (was omitted). Verified in-preview: 10 nights, 10 window rows, σ 2.72 /
  1.86 / 1.94, no console errors.
- `papers/figures/sigma-tch-broad.png` — real broad-hat σ figure rendered from the committed JSON, added as
  **Figure 2b** in `sigma-no-reference.html`; §5 now states both reproduction paths (Run corpus → deep;
  Load broad hat → broad).

Do 4 residual: the **sim** figures in `sensor-trio-nights.html` (fig1–4) still render the old planted σ and
need re-running `sensor-trio-power-analysis.html` at 2.7 / 1.9 / 1.9; captions flag this. Flip to DONE once
those sim figures are regenerated.

## Gate / lifecycle
Docs + analysis-tool only — no app re-bundle, no provenance. Verify: browser render clean, `Dex-Test-Suite.html`
docs-ledger green. Flip to DONE when all three surfaces agree on one reconciled story. Then update
`DOCS-INDEX.md` + spawn a follow-up only if the reconciliation surfaces new questions.
