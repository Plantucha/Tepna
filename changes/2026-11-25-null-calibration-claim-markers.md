---
bump: patch
type: changed
brief: none
---
`papers/null-calibration.html` now binds its control numbers to a committed artifact, so the suite's
resolver reads them. The paper carried no `CLAIM` marker and no `TABLE-PROVENANCE` stamp, which is one
of the 20 papers that residue row
`2026-11-08-twenty-papers-carry-no-claim-marker-and-the-resolver-skips-papers` counts.

- `tools/acc-acc-control.mjs` re-ran over the capture tree. The record
  `analysis/published-numbers/null-calibration-2026-11-25.json` holds the result of the corpus-wide
  control and of a three-window dose-response, each with its own population.
- A new block in the paper states what the current aligner measures and carries 17 sourced markers.
  The July table stays as published, because git never held the run behind it.
- `tools/acc-acc-control.mjs` takes `--from` and `--to` over its night key. The wide search costs
  samples x candidate lags per anchor, so the +-240 s window priced at about 70 h over the whole tree.
  The flag re-runs the 13 nights the paper published instead.
- The same tool read its captures-root positional as the first token without a leading dash, so
  `--from <day>` would have handed the date to the corpus root and measured an empty tree. It reads
  `positionalArgs` now.
- `tools/paper-claim-marker-baseline.json` drops one paper. The baseline may only shrink.
