---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`hrv-confound-analysis` built a complete result object and never published it, so the sixth paper
could not be re-cut.

Five of the six cohort-gen-pinned analysis tools assign their results to a window global
(`NIGHTS_ICC`, `CGM_HRV_COUPLING`, `QRS_EQUIV`, `QRS_YIELD`, `TREATMENT_RESPONSE`). This one built
`RESULT` at the end of `analyze()` — model coefficients, age/AHI correlation, both ROC AUCs, the
misattribution fraction — and then simply never assigned it. Nothing outside the page could read a
single number, which is why `tools/analysis-rerun.mjs` listed it as uncapturable and why the
cohort-gen 2.0 re-cut could not include `hrv-age-confound.html`.

One line, same idiom and same `try/catch` as `nights-icc`. Verified by driving the tool headlessly:
**13 top-level keys captured** where it previously returned nothing. All six tools are now
machine-readable, and the driver's inventory assertion is inverted from *"exactly one tool is
declared uncapturable"* to **"every tool publishes a result global"**, so a future tool arriving
without one reds instead of being skipped silently.

⚠️ **The edit belongs in `hrv-confound-analysis.js`, not the bundled `.html`.** A first attempt
edited the HTML directly; `build-analysis.mjs` re-inlines the source over it and **silently reverted
the change** — `git status` came back clean and the global was gone. That is CLAUDE.md's "edit the
`.js`, never the bundled `.html`" rule surfacing in the analysis-tool lane, where the `.js` is
reached through `data-inline-src` rather than a `.src.html`. It also corrects something I wrote
earlier this session: these tools are **not** self-hosting.

The paper's `expect` is changed from `no change — cohort-wide` to an explicit **hypothesis to test**,
because the same prediction was made for `nights-icc` and refuted — its ODI-4 ICC moved 0.75 → 0.92
under 2.0 (#2557).
