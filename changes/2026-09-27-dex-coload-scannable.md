<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
`dex-coload.js` is listed in both lanes' source inventories, so the source-visibility ratchet drops **8 → 7**
and the name leaves `INVISIBLE_SET`. It is named in CLAUDE.md §✅ as the co-loader that must load `clock.js`
before any delegating `*-dsp.js`, and it was in neither lane's inventory — a file no source-level gate could
reach (residue `2026-09-27-load-bearing-sources-no-gate-can-read`).

**Sized honestly: this closed no hole.** The one invariant anyone has wanted from that file — clock ahead of
every delegating DSP — is already asserted on the **executed** manifest object (`env.DexCoload`), in the
manifest's own order and in all eleven authored shells, which is strictly stronger evidence than a text
scan. What the listing buys is that the file is reachable by any *future* source-level assertion, and that
the published debt shrinks by a measured file. No gate was added for visibility's own sake, and the
value-level assertion was deliberately **not** rewritten as a source scan.

Measured before building, in both lanes: two assertions red in the Node lane (both this ratchet's own — the
cap and the set), zero in the browser lane.
