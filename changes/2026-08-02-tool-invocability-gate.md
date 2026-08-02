<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
Two more tools could not find their own checkout, and the class is now gated.

PR #686 repaired two dead tools by accident. This asks the follow-on question — *how many others?* — and answers it by running things.

**All 14 committed `--selftest`s pass.** The damage is in the tools without one:

| tool | defect | symptom |
|---|---|---|
| `tch-reference-validation.mjs` | `REPO = '/media/…/GENOME/Michal/Tepna'`, a mount that does not exist | ran, ENOENT'd on **every** module, produced nothing |
| `acc-acc-control.mjs` | `REPO = argv[2] \|\| '/run/media/…/Tepna'` | **ran fine, on the wrong tree** |

`tch-reference-validation.mjs`'s own comment already called that constant *"the stale REPO below"* and routed `build-core.js` around it — then left every DSP load pointing at the dead path. A comment recording a defect is not a fix. Repaired, it prints real per-night comparisons (`2026-06-10: 6 epochs — CPAP 16.3 · ECG 16.9 · PPG 15.7 br/min`).

`acc-acc-control.mjs` is the dangerous one because it never failed: run inside a **worktree** it loaded `build-core.js` and every DSP from the **main checkout**, measuring a different tree's code and reporting it as this one's. `CLAUDE.md` §👥 exists because a session once *"spent an hour debugging a broken build that was actually another session's in-flight `clock.js`"* — this makes that confusion silent. Demonstrated before fixing.

**Gate** (`tools · source-scan · portability`, scope read from `tools/` on disk, never curated): a tool that loads repo code must **derive** its root on the line that defines it, and no tool may hardcode a checkout root. 22 of 43 tools load repo code; after the repairs all 22 pass — zero exemptions.

**Three drafts of the gate were wrong and mutation found each.** Draft 1 tested for `import.meta.url` *anywhere*, which the original `acc-acc-control` would have passed (it had `createRequire(import.meta.url)` beside its hardcoded root). Draft 2 demanded the URL on the defining line and flagged four correct tools. Draft 3 followed one hop; `trio-batch` chains three, so derivation is now a transitive closure. The absolute-path rule was also too broad, flagging a corpus **data** default — narrowed to checkout roots, which is what its comment had claimed all along.

Mutation-verified both ways, each assertion catching what the other misses: hardcoding a root reds both; hardcoding while keeping `createRequire(…url)` reds both (draft 1 was blind); `root = process.cwd()` reds only the derivation rule, since it is not a literal.

Tools + tests + brief — no shipped source, no `manifestHash` movement, no fixture re-recorded.
