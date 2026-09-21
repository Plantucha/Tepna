---
bump: patch
type: added
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

**The respiratory-rate paper has figures, seven weeks after the tool that draws them.**
`tools/resp-acc-headless.mjs --figures` was run on the same staged corpus as the 2026-09-07 correction
(50 `Polar_H10_*_ACC.txt` hardlinked against the 192-night CPAP tree; 49 paired nights, 14 scored,
8,057 epochs) and reproduced its headline **bit-for-bit** — MAE 1.10, CI 0.96–1.27, bias −0.53,
RMSE 3.07, LoA ±5.93, 90.8%, r 0.351 — while writing the page's three live canvases as PNGs:
Bland–Altman, MAE-vs-coverage, per-night MAE. They are wired as Figures 1–3 into
`papers/acc-respiratory-rate.html`, with `papers/figures/cohort-manifest.json` recording the file set.
The brief's one remaining item is landed and the brief is DONE.

Two sentences the figures directly contradicted were restated from the run: the per-night MAE line
(0.76–3.31, median 1.04, 14 nights — not the retracted 0.76–1.67 over 26) and the §6 callout that
still said the corpus "has not yet been re-run". Nothing else in the paper was touched; the retracted
cohort description that survives elsewhere in it is filed as residue, because rewriting a preprint's
framing is the owner's call.

⚠️ `build-docs.mjs` walks `docs/`, not the root, so a **new** asset never enters its set until its
served twin exists — the four twins were created by hand once and are owned from now on (27 → 31).

Fleet-Session: Magpie
