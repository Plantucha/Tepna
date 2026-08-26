<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
The crawl recorded each killable mutant's orig/mutant outputs sliced to 300 chars and its replay
input to 400 — display caps on fields that are DATA: `--draft` JSON-parses the outputs to project
a discriminating field, and the probe replays the input. A genSynthetic day-series arrived as a
valid-JSON PREFIX cut mid-token, every projection failed with an unexplained "not both JSON", and
109 of 116 killable mutants across six freshly-crawled files produced zero drafts — the pipeline's
whole yield lost to truncation, silently. The bound is now 50k per field with an explicit
`recordTruncated`/`inputTruncated` flag, and `usableKillables` refuses a flagged record with the
real reason (counted on the result as `skippedTruncated`) instead of letting JSON.parse
manufacture a mystery. Same family as the sweep JSONs' 100-char display fields — recorded here
because this instance cost a full drafting pass before it was caught.
