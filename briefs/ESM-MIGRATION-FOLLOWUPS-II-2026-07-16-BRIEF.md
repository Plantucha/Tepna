<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-23 (**all six items EXECUTED.** item 3 — DSP→UI reach-ins inverted to dependency injection (hrvdex PR #370 · oxydex PR #372, each export-inert); item 4 — the 7 node `<node>-globals.d.ts` consolidated to one `node-globals.d.ts` (PR #373, type-only); item 5 — the `LoadOwnExport` attach-marker source-mirror gates were found ALREADY RETIRED in intervening work, and the reach-in allow-list gate was behavioralized to assert the boundary is clean; item 6 — `ESM-MIGRATION` + `ARCHITECTURE-DEBT-REDUCTION §P5` flipped to DONE (PR #374). **items 1–2 EXECUTED (spray deletion):** the 2026-07-16 estimate was stale — intervening work had already namespaced the test runner + the app pages, so the bare-global spray survived only on `hrvdex/pulsedex/oxydex-dsp` serving the workers. cohort-worker (the one real consumer) now sets `__DEX_NAMESPACED__` and pulls parseCSV/processNight from `OxyDex._bare` + rmssd/std from `PulseDex._bare` explicitly (removing the old last-load-wins collision on those names); the qrs workers already read HRV off the `ECGDSP/PPGDSP` namespaces. The three `if(!__DEX_NAMESPACED__){ Object.assign(root,BARE); …proxies }` blocks are gone. Export-inert (the spray was a load-time side-effect, never in `compute()`) — only `computeHash` moved; the corpus fixtures' `verifiedUnder` re-stamp is owed at release. Node suite (which drives cohort-worker) + GATE A/B green; browser lane in CI.) · **Created:** 2026-07-16

# ESM migration — follow-ups II: what the Phase-4 middle path deliberately left open

Spawned from `ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md` after its Phase 4 executed in the
**owner-scoped middle path** (2026-07-16): the app pages are namespaced (`__DEX_NAMESPACED__` set in the
PulseDex/HRVDex/OxyDex shells), every UI module imports its DSP helpers explicitly (`const { … } =
window.<Node>._bare`), the mutable state is namespace-proxied — and the bare-global spray was **retained
for the non-namespaced classic realms** (the test suite + the six workers) as a documented, deliberate
test-access surface. This brief captures the rest of the ORIGINAL Phase-4/P5 ambition, precisely scoped
from measurement, for if/when it becomes funded work.

## What remains, and what each item actually costs (measured 2026-07-16)

1. **Rewrite the test suite's bare-helper calls to namespace form.** `tests/dex-tests.js` calls the
   sprayed helpers bare at scale — `rmssd`×116, `parseTimestamp`×26, `lombScargle`×25, `parseCSV`×21,
   `partKey`×16, `mean`×32, `std`×13, … (hundreds of sites across the pulsedex/hrvdex/oxydex groups).
   These deliberately exercise DSP internals in the non-namespaced vm/browser realm. Converting them to
   `env.<Node>._bare.x` (or destructures per group) is mechanical but enormous churn in the single most
   safety-critical file in the repo. **Only after this** can the spray blocks be deleted.
2. **Qualify the six workers' bare calls** (`parseCSV`/`processNight`/`rmssd`/`beatTimes`/… in cohort ·
   pat-feasibility · sensor-trio · qrs-equiv · qrs-yield · oxy-hang). Small (≈20 sites), but pointless
   before item 1 — the spray must stay for the suite anyway.
3. **Invert the DSP→UI reach-ins.** hrvdex-dsp calls `setStatus`(×13)/`rerender`/`getProfile`/
   `inferFromData`/`calcVo2Cat`; oxydex-dsp calls `renderAll`/`showError`/`setProgress`/`setStatus`/
   `upVO2category` + the oxydex-util quintet — as bare globals, UI-published on the app pages and
   ambient-declared for tsc. The clean fix is dependency injection (a status/render callback object
   handed to the DSP) — a real behavioral refactor per DSP, each moving `computeHash` (re-verify owed,
   cheap) and each needing its own gate pass.
4. **Delete the seven `<node>-globals.d.ts`** — unlocked only by item 3 (the reach-in declarations are
   the load-bearing part; the namespace declarations could be consolidated earlier but that is cosmetic).
5. **Retire the P4-hardened source-mirror gates** in `tests/dex-tests.js` (the `<node>LoadOwnExport`
   attach-marker slices at ≈8464/8581/8877 and kin) in favor of behavioral equivalents that call the
   function and assert the effect (the ARCHITECTURE-DEBT-REDUCTION §P1 pattern). Per-gate care; never a
   bulk regex sweep.
6. **Then** flip `ARCHITECTURE-DEBT-REDUCTION` §P5 and the parent `ESM-MIGRATION` brief to DONE — their
   Done-when clauses name exactly items 4–5.

## Also out of scope, recorded here so nobody re-discovers them

- **Integrator is NOT ESM** (its dsp/app/render/tch are classic; it was never in the fan-out's scope) and
  the two orchestrators' own app layers (`overdex-app.js`, the Unifier glue, `signal-orchestrate.js`)
  are classic ESM-consumers. Converting them is a fresh decision, not a leftover.
- The `<Node>` namespace attaches (`root.<Node> = …`) are **permanent public API**, not debt — the
  orchestrators, workers, and both test runners consume them; the dual-mode export tails re-export them.

**Recommendation:** leave parked. The middle path already made the app-page coupling explicit and
machine-verified; items 1–5 buy type-hygiene and gate simplification, not user-facing correctness.
