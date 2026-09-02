<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
Integrator consensus grouping no longer depends on the order the files were selected in (DEEP-AUDIT-VI F11).

`fuseHRVConsensus`, `fuseStagingConsensus` and `fusePeriodicBreathing` grouped overlapping sources
greedily: each record joined the FIRST existing group whose SEED it overlapped. Overlap is symmetric but
not transitive, so with an evening strap (21–23 h), a morning strap (02–06 h) and a ring spanning both,
the partition was a function of which record was seeded first — `[A,B,C]` fused all three while
`[B,A,C]` fused two and silently dropped the third. Measured on `fusePeriodicBreathing`: the surfaced
corroboration read **3 observers at conf 0.885** in one order and **2 at 0.697 / 0.752** in the other
two — a clinical claim that changed with file order.

Fix: one `_overlapComponents` helper (union-find over the pairwise overlap relation) partitions sources
into connected components in canonical order (window start → node → index), and all three fusers
consume it. Nothing else in the fusers changed; `regen-integrator-goldens`: 0 moved.

Gate: new `Integrator overlap grouping — connected components, order-independent` group, 17
assertions across four HRV orders + two disjoint-component controls (a singleton, and two disjoint pairs that must
stay two blocks in every order) + three PB orders, pair-verified 18
red on `origin/main`'s `integrator-dsp.js`. Integrator 8c1072b85159 → 080ccd5e1318; OverDex +
`resp-acc-analysis` re-bundled.
