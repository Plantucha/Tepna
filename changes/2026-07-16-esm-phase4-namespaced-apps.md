<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PulseDex, HRVDex, OxyDex, suite]
brief: ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md
---
ESM-MIGRATION Phase 4 (owner-scoped middle path, 2026-07-16): **the app pages no longer depend on the bare-global spray** — the import boundary is now real and *verifiable* in the product. Per deep-3 node (PulseDex · HRVDex · OxyDex):

- The DSP's spray map is hoisted to a shared `BARE` object and exposed ON the namespace (`<Node>._bare`); the mutable closure state (`lastResult` · `allRows`/`windowDays`/`charts` · `allNights`) gains namespace `defineProperty` proxies. The `!__DEX_NAMESPACED__` guard now assigns `BARE` — the spray survives, but ONLY for the non-namespaced classic realms (the test suite + the six workers), documented as a deliberate test-access surface, not debt.
- Each UI module opens with an explicit `const { … } = window.<Node>._bare;` destructure naming exactly the DSP helpers it uses (import-style, scope-checked); each app module bridges the mutable names (`window.lastResult ↔ PulseDex.lastResult`, etc.) for its own page. `oxydex-profile` (worker-loaded BEFORE the dsp) call-site-qualifies its one helper instead.
- **The three app shells set `window.__DEX_NAMESPACED__ = true`** — the self-verification: a missed helper now throws instead of silently resolving through the spray. That property caught four real misses during development (`mean` via a nested-shadow false exclusion, `lineChartSVG`/`smooth` hiding inside template-literal interpolations, and hrvdex's three proxied mutables) — each found by the gates/smokes, then fixed.

Deliberately NOT done (scoped out by owner decision, captured in `ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md`): rewriting the test suite's hundreds of bare-helper calls, inverting the DSP→UI reach-ins (`setStatus`/`rerender`/`getProfile`…), deleting the seven `<node>-globals.d.ts`, retiring the source-mirror gates — the parent brief's full Done-when stays open on exactly those items.

`computeHash` moved on all three DSPs but is EXPORT-INERT BY VERIFICATION — `verify-fixtures.mjs` re-stamped all six corpus-backed fixtures byte-identically. Gates: biome + tsc clean · `build --check` ×10 · Node suite 2512 · GATE A/B · browser lane all-green (render-coverage drives all three flagged bundles) · no-network · file:// functional smokes (compute ✓, `_bare` ✓, **spray verifiably absent** on all three pages). Analysis tools + docs deploy copies regenerated in the same unit.
