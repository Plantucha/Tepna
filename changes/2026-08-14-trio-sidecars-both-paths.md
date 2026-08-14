---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

`trio-batch` wrote the HR-agreement and packet-arrival sidecars on only ONE of its two completion
paths, and the path production uses was the unwired one. A 40-night corpus fold produced ZERO
`agreement_*.json`.

There are two ways a night finishes. The parent's `if (node)` branch handles a night whose nodes were
split across children; the in-child path handles a child owning a whole night. `writeAgreement` and
`writeArrival` were added to the parent branch alone — but node-split is enabled only when
`work.length < plan.jobs`, i.e. FEWER nights than job slots. Every ordinary corpus fold therefore takes
the child path and silently wrote neither sidecar. It looked correct because the case it was developed
against — single nights and small batches — is the rare one that DOES split.

A SECOND, INDEPENDENT DEFECT in the same area: the parent's display filter is
`/^\s{4,}[✓✗⊘·⏱]/`, and `⚖` is not in the character class, so an agreement line printed by a child was
stripped from the parent's output. Its own comment records the identical bug for `⏱` — "an exact-4
filter silently ate them". Same line, same defect, second occurrence. Both fixed.

Guarded by `!ONLY_NODE` for the same reason as the clock and drift fits beside it: a child that owns a
single node cannot see its siblings' exports, so it would adjudicate a "disagreement" against files that
have not been written yet.

Also exposes `blocks_` on `fitClockDrift` — the per-block `{tMs, off}` series the fit was made from,
which was being discarded. It is a PHASE series and the only input from which a leg's own rate
uncertainty can be measured. Without it `fitClockClosure` has no way to derive a tolerance and falls
back to guessing one from magnitude (`max(5, 0.25 * maxleg)`). Measured over the corpus, that model has
no support: closure error is UNCORRELATED with leg magnitude (r = -0.238), the median |closure| is
8.4 ppm against a 5 ppm floor, and the distribution is bimodal — 12 nights at or under 17.8 ppm, a 17 ppm
gap, then 2 outliers at 34.8 and 46.3. So roughly two nights have a genuinely wrong fit and about eight
currently-voided nights are threshold artifacts. The tolerance is NOT changed here: neither candidate
estimator survived scrutiny (naive OLS underestimates the observed closure noise 10x because block
offsets are correlated; sigma_y at the longest tau overestimates ~25x because ADEV answers a different
question than "how precisely is a slope over T determined"). Replacing one unjustified constant with
another is not a fix, so this ships only the prerequisite.

Corpus: all 40 trio nights refolded against current main, now WITH agreement sidecars. 3481 epochs
compared, 3200 adjudicable, 1 flagged >15 bpm (0.029 %) — one OxyDex ring outlier on 2026-07-25, with
PpgDex and ECGDex at zero faults. The pre-fix corpus flagged 1.29 % with PpgDex the outlier in 98 % of
disagreements, so this is the polarity and correctRR fixes measured end to end.
