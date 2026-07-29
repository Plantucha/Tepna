<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
---
`tools/trio-batch.mjs` gains **`--force`**, a visible **redo reason**, and a core-aware **node split**.

**`--force`** recomputes every night, stamp or no stamp, and beats `--skip-existing` when both are given. The engine is still being tuned, so "redo it all under today's code" has to be one flag away.

**The redo reason is now printed** — `↻ 2026-07-16 — recomputing: code changed`. That line is the version-awareness: the stamp already hashes the DSP source bytes plus `trio-batch.mjs` itself, so tomorrow's engine invalidates every night automatically, but until now it did so silently. Hashing bytes is strictly stronger than a hand-maintained version number, which can be forgotten on the one commit that mattered; what was missing was only saying so out loud. Verified on the real corpus: editing the tool made all 11 nights report `code changed`.

**Node split — only ever with slots to spare.** The pool parallelises across NIGHTS, so a one-night run used ONE core however many the host has (measured 39.4 s at 104 % CPU on a 24-core box). A night's three nodes are independent, so with idle slots they now run as separate children and the night costs `max(node)` instead of `sum(node)`.

The guard is the point, and it is deliberately conservative:

- `plan.jobs` is already the probed floor of (cores−1, free RAM ÷ ~1.2 GB, HARD_CAP). **On a 1-core or memory-tight host it is 1, so the split is off and the run behaves exactly as before.**
- **Never split when the nights alone already fill the pool** — the slots are busy either way and splitting would only add process startup and re-planning.

So the split can only ever consume capacity that would otherwise idle; it cannot make a modest machine slower. Measured on one night, same code: **29.2 s sequential → 17.4 s split (1.7×)**. Not the theoretical 3×, and honestly so — PpgDex dominates the critical path, so `max(node)` ≈ PpgDex.

A split child computes ONE node and does **not** write the night's stamp; it cannot know whether its siblings succeeded. The **parent** writes it once, after every node of that night returns 0 AND all three exports are on disk — the same all-or-nothing rule the in-child path uses, so a night with one failed node stays unstamped and is redone.

Gated by 7 new `--selftest` cases over a pure `shouldSplitNodes(jobs, nights)`, weighted toward the small-machine arms (1 slot / 1 night, 1 slot / 20 nights, nights == slots, nights > slots). Verified live: single night splits 3 ways and the parent-written stamp is accepted by the next warm run; the 11-night corpus does NOT split and still completes in 52 s.

Orchestration only — no bundle, no `manifestHash`, no fixture.
