<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md
---
The Integrator was the only code-gated fixture in the ledger with no regen tool, so a TCH-fusion change that legitimately moved its output had no sanctioned way to be re-recorded — and hand-editing an export is forbidden, meaning the only legal move was blocked. `tools/regen-integrator-goldens.mjs` closes the last empty cell in the class-13 coverage matrix. Writing it required getting the golden's inputs out of a closure inside a test group: a private copy in the tool would have drifted from the gate, which is the sibling-divergence class the parent audit exists to fix, so the builder is extracted to `tests/tch-golden-inputs.js` and both consume it. That file is dual-mode on purpose — an ESM module would have served the tool and broken the browser lane, so it attaches to the global and sets module.exports exactly as clock.js does. Because the builder is deterministic, the extraction is proved faithful by the equivalence gate itself: the golden diff still reads byte-identical, and the new tool independently reproduces the committed fixture with content unchanged. The ledger note claiming byte-identity with `_diag/tch-golden-gen.html` is corrected — that file has never existed in the repo.
