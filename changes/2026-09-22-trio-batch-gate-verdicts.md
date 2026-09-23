<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [tools]
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---
`trio-batch` emits a `tepna.verdict/1` for every night its plan decides on (PASS entered the fold · FAIL rejected with the hours · NOT_APPLICABLE not a trio night) plus one run-level object, written to `<out>/trio-batch-verdicts.json`; `--verdict-sample` for the adoption gate.
