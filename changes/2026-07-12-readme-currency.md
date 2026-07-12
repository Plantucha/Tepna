<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: none
---
README told people to buy the wrong device for PulseDex.

A currency pass over `README.md`, checked against the repo rather than eyeballed. Every relative link and
backticked path resolves; the structure and voice are sound and untouched. Four things were wrong:

- **PulseDex was attributed to the Polar Verity Sense.** The gate-backed roster (`ORIENTATION.md`) says
  PulseDex reads **Polar H10 `*_RR.txt`** (Coospo/Wahoo too) — the Verity Sense is **PpgDex's** device.
  This is the most user-visible error in the file: it points a reader at the wrong hardware. It is also the
  *same drift* `EFFICIENCY-AUDIT-FINDINGS-2026-07-12` §X4 found in `CONTRIBUTING.md`, which is the tell —
  the roster is gate-backed in `ORIENTATION.md` and **ungated everywhere else**, so the copies rot.
- **The `tests` CI row was doubly stale:** "~1,900 assertions … + render coverage". It is now ~2,250, and
  the workflow is **headless-only** — render-coverage lives in `Dex-Test-Suite.html?full` / the manual
  `browser-gates`, not on the per-push path. The row now also states what the sharding buys: 4 shards that
  *provably partition* the suite, so their union is the whole gate and no group can quietly go unrun.
- **The `lint` gate is named `biome`** (ESLint was retired in BIOME-FORMATTER Phase 3).
- **A dead ref:** `` `LEXICON.md` `` → `docs/LEXICON.md` (the 2026-07-03 relocation), and the brief count
  ~160 → ~180.

Verified unchanged-and-correct: all 8 provenance bundles + 2 orchestrators, the 7-live/1-planned roster,
the evidence ladder, the validated-metric anchors, the CSP claims, and every path the file names.

Docs only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded.
