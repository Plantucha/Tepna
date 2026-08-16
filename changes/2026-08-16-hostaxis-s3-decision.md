---
bump: patch
type: changed
brief: HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md
---

`HOSTAXIS-STABILITY-FOLLOWUPS` §3 asked whether to replace the noise classifier's 1.96·SE refusal band
with Riley & Greenhall's slope-free lag-1 identification, and demanded the answer come "with the
measurement, not the preference."

Both measurements already existed, in briefs this one did not cross-reference, and neither was
reachable by grep. `CROSS-DOMAIN-METHODS-FOLLOWUPS` §6 had already evaluated and rejected the
weighting/EDF route: weighted OLS over the correlated overlapping points moves the answer by less than
the distance to the nearest boundary, and the one case where it would matter is a curve near a
boundary, which is exactly where the classifier already returns `noise: null`. The two mechanisms cover
the same case and the refusal is the cheaper, more honest one.

Decision: the band stays. What remains genuinely open is narrow — whether an analytic identifier agrees
with the current classifier on this corpus, and what it returns on the non-canonical mixtures the
refusal exists for. An identifier that cannot refuse is not obviously an upgrade on one that can. The
adoption burden is written down so it is not re-litigated: identify the noise type rather than the
presence of correlation, show behaviour on those mixtures, and move all three lanes together, since the
known-answer gate now pins them to one external reference and a single-lane swap reds it.

Records a conflation hazard that would otherwise justify adoption on the wrong evidence:
`METROLOGY-METHOD-ADOPTION` §5 celebrates a "two-line lag-1 autocorrelation", but that is a correlation
test asking whether a series is correlated at all — not Riley & Greenhall's noise-type identifier. Same
two words, different statistic, different question, and the two briefs rank adjacently in semantic
search.

§4 resolved: the `ppmUncertainty` span question is answered (the recording's own span, which already
ships — a fixed reference span extrapolates σ_y to a τ the recording never reached, which is fabricating
a measurement on exactly the short files that would want it). The other two are parked with the specific
measurement that would settle each, and question 3's framing is corrected: `independent` is a provenance
test, not a sufficiency test, so a span floor belongs on the quoted quantity rather than inside it.

The same question was tracked a second time in `INTERDISCIPLINARY-LITERATURE-2026-08-16`. That box is
now closed **by its own brief's author**, pointing here — this PR originally carried a cross-reference
into that file and it was dropped during rebase as redundant, because they had made the same edit
first. Two briefs held one question in different files, which `stale-file` structurally cannot detect:
it looks for the same path touched twice. Notably, git DID conflict here — the duplication was in one
file, so it was visible; the dangerous version is when the two edits never touch.

Found via `tools/doc-search.mjs` (#1349) on its first real query. Docs only.
