---
bump: minor
type: added
brief: VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md
---

`tools/tch-pooled-hat.mjs` publishes a `contributions` block over its nights by
leave-one-out, so the pooled three-cornered hat names the night that moved it.
The `--json` document carries one block per corner and `--verdict-sample` emits
a `tepna.verdict/1` object carrying the attributed corner's block.

The §2 adoption row for that figure named `tools/trio-batch.mjs`, which
computes no hat. It now names the real producer, and the row is `adopted` with
an `emits` command the gate runs.
