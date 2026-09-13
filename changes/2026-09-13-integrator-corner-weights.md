<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

Three Integrator defects from the end-to-end signal audit. The inverse-variance reconciled RMSSD
resolves each corner's weight by SOURCE identity, not by node name — two corners of one node (a
finger and a wrist PpgDex) were both skipped and the published figure was the remaining corner
verbatim. `fitClockDrift` no longer certifies a decelerating walk as a constant drift rate, and its
published reach is measured over the fitted block span rather than the whole recording. The beat-level
skew cross-check now rides in `clockSkew` instead of being computed and discarded.
