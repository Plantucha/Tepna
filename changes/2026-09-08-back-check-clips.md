<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
🔴 **The morning report was fabricating a clean verdict.** `back_check` read `b["clip"]` — singular,
and expected a **list** of spans. `nightqc.class_b_runs` returns
`{"stream", "held", "rows", "clips", "file", "columns"}` where **`clips` is a DICT** of
`{channel: number_of_clip_regions}`. Both the key and the type were wrong, so the sum was
unconditionally zero and **every night reported `0 spans, back-check ok`** — the one statement this
module exists to make impossible.

Measured on the box: `/srv/tepna/captures/2026-09-08` carries `clips: {"ppg": 25}` and was rendering as
clean. It now reads `25 spans, back-check fail`.

🔴 **`held` was ignored entirely, and that is the worse half.** `class_b_runs` reports a held stream
**instead of** clip regions — `clips` is then `{}` — because a stream frozen at one value for its whole
length is ONE fact, not thousands. So a night where the ring's optical stream was pinned throughout had
zero clips and read **`ok`**: a total sensor failure reported as a clean night. Held streams are now
counted separately and named in the line (`0 spans (1 held), back-check fail`), because "25 clipped
regions" and "the sensor was pinned all night" call for different actions.

⚠️ **The tests could not see any of this because they invented the same shape the code did.** Both were
written from one misreading, so they agreed with each other and neither agreed with the producer. The
fixtures are now **copied from a real QC-SUMMARY.json**, not composed — the same failure as the
`<root>` vs `<root>/captures` path bug in the same file, and the second time this week that a fixture
encoded an assumption instead of a measurement. Planting the original bug in either of its two forms
now reds four tests.
