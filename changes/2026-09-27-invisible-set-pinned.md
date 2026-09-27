<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
The source-visibility ratchet now pins the invisible **set** by name, not only its count, and the count
drops 12 → 8 because `readSources()` was walking only one of the two owned bundle families.

The gate's own comment claimed `readSources()` "walks every bundle's `data-inline-src`, so anything inlined
is readable for free". It walked the 11 owned **app** bundles and not the 14 **analysis tool** bundles, so
four files (`cohort-gen.js`, `qrs-yield-analysis.js`, `resp-acc-analysis.js`, `resp-acc-analysis-app.js`)
were inlined into bundles and invisible anyway — not the "un-bundled tail" the paragraph described. The walk
now covers both families, reading the tool list from `build-analysis.mjs TOOLS` and failing closed if that
list is unreadable, because walking nothing is indistinguishable from a clean tree. That scope fix is what
lowers the cap; no file was hand-registered to achieve it.

The cap was already two-sided, so the number could not drift — but the membership could: wire one file in
while another falls out and the count is unchanged while a newly unscannable runtime layer arrives silently.
`INVISIBLE_SET` pins the eight names, and a plant performs exactly that swap to prove the pin discriminates.
Two stale numbers in the comment ("13 of 112", "a 39th unreadable file") are corrected against the code, in
a group whose own lesson is that a finding recorded as a comment does not fail when it goes stale.

Reading the pinned set as questions produced residue
`2026-09-27-load-bearing-sources-no-gate-can-read`: two of the eight are named in CLAUDE.md as load-bearing
(`dex-coload.js`, `provenance-ledger.js`).
