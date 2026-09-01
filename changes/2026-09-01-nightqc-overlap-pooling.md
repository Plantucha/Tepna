<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
nightqc's cross-midnight pooling no longer rejects an OVERLAPPING neighbour — the guard now does
what its own comment said.

The pooling condition read `0 <= earliest − prev_last_write < _SESSION_GAP_SEC`, which assumes the
previous folder **finished** before this folder's first session opened. At a multi-device wake that
ordering routinely inverts: one device opens its morning fragment (filed under today's folder) while
another device's night file (yesterday's folder) is still being written. Overlap is *stronger*
contiguity evidence than a gap, and the comment two lines above the guard already stated the intended
contract — "pool when its last write actually **runs into** this folder's earliest session". "Runs
into" includes overlap; the `0 <=` lower bound contradicted it.

Measured on the real night 2026-08-31→09-01: the O2Ring's 04:20:53 morning fragment opened while the
Verity's night file wrote until 04:23 (−138 s), the bound read that as "not contiguous", pooling
switched off, and QC judged 13 minutes of morning crumbs as the night — reporting the H10's
ecg/acc/hr and the O2Ring's SpO₂ as MISSING while a complete 17-file tri-device night sat in the
neighbouring folder. `scope_suspect` stayed false throughout, because it only fires on an *empty*
folder — a wrong-scope folder holding crumbs is its blind spot.

This is the guard's third failed assumption in the same family, one per encoded proxy: the
near-midnight start (replaced by QC-SCOPE-RESOLUTION-2026-07-28), the long reconnect (the H10's
501-seconds-over-the-gap case, fixed the same day), and now the simultaneous wake. The fix drops the
lower bound: any `diff < _SESSION_GAP_SEC` pools, negatives included.

Regression test pins the overlap shape (fragment opens **before** the neighbour's last write, with a
fixture-level assertion that the overlap actually holds) and was pair-verified: RED under the old
guard, GREEN under the new one.
