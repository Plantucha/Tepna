<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: RESIDUE.md
---

OxyDex's self-ingest path coerced two absent scalars to 0, so a night whose duration was never
recorded became indistinguishable from a zero-duration night, and a night with no SpO2 reported a
mean of 0 — a value that is not merely wrong but physiologically impossible, which means no
downstream plausibility guard could catch it either. Both now follow the `!= null` form the same
block already uses for perfusion index and motion, so a genuine 0 still survives while absence stays
absent. The suite previously asserted the `|| 0` behaviour as a deliberate contrast; that assertion
documented the fabrication as the contract and has been changed knowingly.
