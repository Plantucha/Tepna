<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
`dex-coload.js` and `provenance-ledger.js` are listed in both lanes' source inventories, so the
source-visibility ratchet drops **8 → 6** and both names leave `INVISIBLE_SET`. Both were named on residue
`2026-09-27-load-bearing-sources-no-gate-can-read`: CLAUDE.md §✅ calls the first the co-loader that must load
`clock.js` before any delegating `*-dsp.js`, and §🔏 has the second reassembling the per-app fragments GATE A
and GATE B read — and neither was in either lane's inventory, so no source-level gate could reach them.

**One honest sizing for both: neither closed a hole.** Both files are *executed*, so the invariants anyone
has actually wanted from them are already gated on values, which is stronger evidence than a text scan. The
clock-before-DSP order is asserted on the executed manifest object (`env.DexCoload`) plus the authored order
of all eleven shells; the ledger is required at `run-tests.mjs:74` and used by five other tools, so GATE A/B
read it by running it. What the listing buys is reachability for a *future* source-level assertion, and two
measured files off the published debt. No text-level invariant has been named for either, so nothing is gated
for visibility's own sake — and no value-level assertion was rewritten as a source scan to make the listing
look load-bearing.

Measured in both lanes before building, once per file, with the same result each time: two assertions red in
the Node lane — this ratchet's own cap and set — and zero in the browser lane.
