---
bump: patch
type: fixed
brief: none
---

Refuse an unknown flag in the four abstaining tools the probe harness can safely run.

`tools/argv-survey.mjs` read all four as IGNORES, so a mistyped option left a default standing and
the tool reported a figure over a set the caller never named. Each tool now declares every flag it
reads, and the probe reads REFUSES for all four.

Two of them spelled a flag as `--dir=<path>`, which `tools/argv-guard.mjs` refuses by design. No
caller in the tree wrote that form, so both tools now take the next token like every other tool.

The static scan reads `refuses 53 · undecidable 36` over 259 tools, against 49 and 40 before.
