<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, ECGDex, PulseDex, PpgDex, CPAPDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Fix the cross-night bootstrap LCG overflow (DEEP-AUDIT-II §9.5): `bootstrapDeltaCI` in all five `*-cross.js` clones multiplied `seed * 1103515245`, which reaches ~2.3e18 ≫ 2^53, so float64 rounded away the low bits the `& 0x7fffffff` mask keeps — biasing the resample and narrowing the delta CI (verdicts near "95% CI excludes 0" flipped). Use `Math.imul` (the exact mod-2^32 multiply). Gated by a source scan across every clone. Real crossNight fixtures with n≥7 shift (owner re-verify at release); committed synthetic goldens have <7 nights so they are unaffected.
