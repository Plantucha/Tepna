<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex, suite]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
Regenerate the real-recording GlucoDex export fixture, which the §1 long-gap fix moved but left stale — its `daypart` block still reported interpolated sensor-gap samples as measured glucose, reddening the `compute() ≡ committed export` equivalence gate. Adds `tools/regen-glucodex-goldens.mjs` (sibling of the CPAP regen tool: re-runs the real modules on the committed input, preserves volatile keys, re-records `outputHash` from the bytes it wrote — closing the gap where `build.mjs` re-stamps a fixture only when the *bundle* hash moves), and writes the underlying lesson into CLAUDE.md §🔏: a byte-identical synthetic golden is not evidence of export-inertness, because the real-recording equiv legs skip wherever `uploads/` is absent.
