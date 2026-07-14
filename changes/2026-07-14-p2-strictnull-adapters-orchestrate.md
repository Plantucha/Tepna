<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md
---
P2 (strictNullChecks) chunk 1: harden the five adapter/orchestrate modules against the null-class errors strictNullChecks surfaces — annotate `never[]` warning arrays, guard `.pop()`-returns-`string|undefined`, cast the `.filter(Boolean)` EDF-stamp array (which tsc does not narrow), and give the `_await` Promise a resolve arg. Comment/guard-level only; export-inert re-bundle of the two orchestrators that inline them. The flag stays OFF until every gated module is clean (final P2 PR).
