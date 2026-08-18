<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PPGDex]
brief: FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md
---
Discharges §4's per-node requirement for a second node. The brief says *"measure reachability per node
before fixing it — latent-but-dangerous and active are different priorities, and only ECGDex's is
known."*

**PpgDex: latent, 0 of 44.** Across 44 real `PpgDex_*.node-export.json` files (corpus-trio +
trio-all), not one night hit `cvhrFromNN`'s `N < 60` or `M < 120` guards — every export carries a
numeric `apnea.cvhrIndex`.

The reason is structural, not luck. ECGDex's `lombScargle` is called **per epoch**, so it meets every
short fragment in a night; `cvhrFromNN` is called **once per record** on the whole corrected beat
train, so a complete night cannot be short enough to trip it. What reaches it is a truncated
capture — a fragment, a battery death, a session cut before two minutes.

⚠️ `absent: 0` beside `zero: 0` is exactly the shape of a path that silently resolved to nothing, so
the field was printed before the count was believed: `.apnea.cvhrIndex` resolves and reads 4.2 on the
first file.

Consequence for planning: the PpgDex fix is a **correctness** change rather than an active-harm one,
and the brief now says so. That matters because §1's OxyDex sites were the opposite — eleven of them,
on a metric whose quintile label reads as a judgement already made.

Docs only; no code changes. The fix itself is unstarted and flagged to the session that owns PPGDex.
