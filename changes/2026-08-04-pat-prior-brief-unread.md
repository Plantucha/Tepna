<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3h — §3c–§3g were written without reading `PAT-NO-VALID-ANCHOR-2026-08-02`, which is IN-PROGRESS in the same brief family and already contains parts of them at larger n.

That brief names this one in its own header and was never opened. What it already had: **§8/§11** — the phone tree's host column is not an independent clock (76/76 files at a 1 ms range; 0/104 declared independent) where §3f.1 re-derived it from 29 refusals; a `k ∈ [−4,4]` search over a **measured 384 ms quantum** where §3g noted mod-RR aliasing; **§1** — *"a per-block offset absorbs exactly the quantity PAT is"*, identified there as the move behind a **retracted** verdict, where §3g.2 arrived at the same caveat independently; and **§7** — an aperiodic anchor already **derived** (`offset_ACC + Δ_Verity − Δ_H10 = −199 ms`) where §3g.3 proposed deriving one as future work.

**Reconciling §3g's 47/57 with its 0/13:** not in conflict, and §3g is the weaker claim. That brief reports a derived anchor recovering a locked, plausible PAT *magnitude* on 0 of 13 box nights; §3g reports *coupling* under a free per-window offset, which is not a PAT measurement. Where they speak to the same question the published one wins: **PAT magnitude is not established on box nights.**

**What survives as new:** §3c's harness reconciliation (legacy `matchRate` spanning 0–77 % across pairs of one night, with §3a's rule selecting near the bottom every time); §3e's measurement of the ACC anchors' *internal* disagreement (1171–3094 ms within a single pair); and `tools/pat-host-offset.mjs` with its gates. One possibly-useful overlap: that brief's §10.1 concludes *"per-fragment Δ is the more likely requirement"*, and this tool computes `hostAxis` per file with every window inside one fragment pair — untested against their pipeline, a hypothesis rather than a result.

**The habit, now measured.** That brief's header reads *"Fourth retraction in this brief family from the same habit: concluding from the best available case."* §3c–§3g repeated it four more times, each corrected only by widening the sample. Reading the family's own prior brief would have supplied the warning before the first of them.
