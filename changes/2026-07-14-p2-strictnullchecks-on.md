<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite, tooling]
brief: ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md
---
P2 complete: turn `strictNullChecks` ON in the checkJs gate. The remaining 80 null-class errors across the 8 DSPs + dex-ingest + signal-frame are fixed at the source (annotate `never[]`/inferred-null object literals, cast `.filter(Boolean)` arrays tsc won't narrow, cast possibly-null result vars at declaration) and the flag is flipped in tsconfig.json. All comment/guard-level → export-inert re-bundle of the 7 GATE-A apps + both orchestrators; every manifestHash moved but GATE B confirms no fixture output changed. oxydex-dsp/signal-frame/dex-ingest joined biome's formatter-override list (§B2) so their inline JSDoc casts are not mangled by the formatter.
