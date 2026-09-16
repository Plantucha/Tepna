---
bump: minor
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`analysis-rerun` captures figures, records run scale, and returns the first paper-scale result.

**Figure capture** closes half the §2.11 gap the tool declared. `--figures` writes canvas → PNG for
tools whose published figures are 1:1, **staged to `.cache/rerun-figures/`** rather than over the
published artifacts — a run whose numbers nobody has reviewed must not overwrite a paper's figure.
`cgm-hrv-coupling` publishes three canvases as **one composite**; panel assembly is declared
`figures: null` rather than approximated, because writing a single panel over a composite is silent
corruption. **Every entry declares the key, so *absence* cannot pass for *declared null*** — an
assertion caught exactly that after a `.replace()` silently no-op'd against a line Biome had already
reflowed.

**Scale is recorded in the checkpoint.** The §2.2 verification run left 40-subject results behind and
the checkpoint stored no scale, so `--paper-scale --resume` would have skipped those tools as "done"
and served demo-cohort numbers as the re-cut — the exact substitution `--paper-scale` exists to
prevent, arriving through the resume path instead of the input path. `pending()` now treats a scale
mismatch as not-done; both directions asserted.

**The timeout is sized from measurement.** The first paper-scale run hardcoded 24 min and `nights-icc`
timed out at 1441 s while the page's own ETA read ~36 min — §2.6's failure applied to a wait budget.
Now `--timeout-min`, defaulting to 120 at paper scale, and a timeout is reported as an error rather
than as an empty result.

**First paper-scale result, and it refuted the brief's prediction.** `nights-icc` at 6,000 subjects:
ODI-4 ICC₁ **0.75 → 0.9238**, reversing "needs two nights" to one, while rMSSD (0.93) and CGM-CV (≈0)
did not move. The inventory's `expect` for that paper is corrected from *"no change — cohort-wide"* to
*MOVES*: a cohort-wide **statistic** can be dominated by the stratum 2.0 changed, because ICC is a
variance ratio and ODI's between-subject variance is largely the apnea spread. The paper itself is
re-cut in #2557.

28 assertions. Rebuilt on current `main` rather than merged — #2544's squash landed the same file, so
the original branch went `DIRTY` and never ran CI; re-applying the delta on a fresh branch sends it
through no merge driver at all.
