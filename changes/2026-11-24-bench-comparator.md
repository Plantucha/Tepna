<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MEMORY-PROGRAM-2026-11-22-BRIEF.md
---

`tools/xerj-bench.mjs` asks for the semantic lane by name, so its `bge` row scores that engine again. An engine that
does not answer a query makes the result `UNKNOWN`. A new `answer` row scores the answer that doc-search prints.
