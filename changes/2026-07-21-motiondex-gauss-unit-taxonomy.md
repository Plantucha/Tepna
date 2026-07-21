<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [MotionDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
MotionDex no longer reads a Gauss magnetometer stream as gravity. `streamKindFromHeader`'s acc branch
(`/mg|(^g$)|G/`) matched a Gauss `[G]` MAGN header (Polar Sense writes Gauss) and returned
`{kind:'acc', unit:'G'}`, so `toG` read the magnetic field as gravity-g; and `toG` tested
`unit==='mg'` case-sensitively while `UNIT_RE` captures case-insensitively, so a `[mG]` header read as
g → 1000× motion metrics. Fix: case discriminates the unit — capital-`[G]` routes to the mag stream
and is converted to SI µT at the parse boundary (1 G = 100 µT, CLAUDE.md §📏), lowercase `[g]`/`[mg]`
stay acc, and mg is matched case-insensitively. Latent (streams route by filename), but a header-
fallback route would make it live. Export-inert on the committed synthetic golden (GATE B
reproducible); gated with a unit-taxonomy group.
