<!--
  CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-28 · **Surfaced-by:** `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md` (the `CPAPCross` runtime-co-load discovery) · **Subsumes:** `CPAPDEX-PHASE9-FOLLOWUPS-IV-2026-06-28-BRIEF.md` §1 · **Followed-by:** `CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-2026-06-29-BRIEF.md` · **Relates:** `dex-coload.js` + the `dex-coload manifest` gate (`tests/dex-tests.js`), the P12 cross-Dex drift gate (`tests/dex-tests.js` ~L1402), the ECGCross runtime crossNight group (`tests/dex-tests.js` ~L94), `CPAPDEX-PHASE9-FOLLOWUPS-IV-2026-06-28-BRIEF.md` §1 (the CPAPDex-specific instance) · **Scope:** FLEET-WIDE (not CPAPDex-specific)

> **EXECUTED 2026-06-29 (test-infra only, NO app re-bundle):**
> - **§1 DONE** — all five `*-cross.js` (`ecgdex`, `oxydex`, `pulsedex`, `ppgdex`, `cpapdex`) are now runtime-co-loaded in
>   BOTH runners (`<script>` tags in `Dex-Test-Suite.html`; `loadInto` entries in `run-tests.mjs`) and mapped into `env`
>   (`OXYCross`/`PulseCross`/`PPGCross` added; `ECGCross`/`CPAPCross` already present). New group **`Cross §1 — per-node
>   crossNightBlock + helpers (VARYING series)`** drives each node's `crossNightBlock` over a STRICTLY-MONOTONIC 8-point
>   series (so Mann–Kendall is significant — τ=1 > SIGNIF_TAU 0.15, p≈8e-4 < SIGNIF_P 0.10 → trend labels DETERMINISTIC)
>   and asserts: `CrossNightEnvelope.validate(block).ok` (the real ganglior.crossnight v1.0 contract) for the 4 envelope
>   nodes; the node's full `_DEFS`/`METRICS` id set; `n` flow-through; good:up-rising→`improving` / good:down-rising→
>   `declining`; and per-node accessors/helpers — OXY `nightTms`/`nightWeight`, ECG qtc valid-delin guard + cvhr
>   `longRec&&!ambulatory` guard (n→0 when ambulatory), CPAP `nightOdi` (mean of oximeter sessions) + `compliancePct`.
>   PpgDex emits the LEGACY raw shape (`metrics[id]` IS the crossNight result — `.mean`/`.trendLabel`), asserted directly.
>   **27/27 green.** Subsumes `CPAPDEX-PHASE9-FOLLOWUPS-IV §1` (CPAPDex assertions are in this fleet group).
> - **§2 DONE via the brief's sanctioned INTERIM** — `dex-coload.js` gained a `nodeModules:[{file,global}]` leg (the 5
>   `*-cross.js` + `cpapdex-coimport.js`) + a `nodeModuleGlobals` mirror; new group **`Co-load §2/§3 — app-bundled aux
>   modules runtime-present + runner-symmetric`** asserts each listed global is live in `env` HERE. **13/13 green.** The
>   FULLER root-cause fix (parse each bundle's inlined `*-*.js` set from `BUILD-MANIFEST` per-bundle manifests / `.src.html`
>   `<script src>` + a `RUNTIME_EXEMPT` allow-list, so a NEW bundled aux module is auto-caught) is deliberately deferred →
>   `CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-2026-06-29-BRIEF.md` §1 (the `nodeModules:` leg is hand-maintained, so it
>   narrows the blind spot to cross/coimport, doesn't structurally close it).
> - **§3 DONE** — the §2/§3 gate runs in BOTH runners against each runner's OWN `env`, so a module co-loaded in only one
>   reds in the other → symmetry enforced BY CONSTRUCTION. The specific `cpapdex-coimport.js` asymmetry the brief names is
>   also closed directly: it is now `loadInto`-ed in `run-tests.mjs` (Node previously saw `CpapCoimport` absent) and
>   `CpapCoimport` added to Node `env`. Verified all 6 aux globals resolve in both runners.
> - **Gates:** `Dex-Test-Suite.html` all-green (the 2 new groups + the `dex-coload manifest` gate 6/6 with real host
>   realms; verified headlessly via the real `runDexTests(env)` runner). NO app re-bundle (no bundled-module runtime
>   behavior changed; `Dex-Test-Suite.html` is a host harness, not a `BUILD-MANIFEST` bundle) → `verify-provenance.html`
>   GATE A/B untouched, no `manifestHash`/fixture changes. **FINDING (→ followups):** PpgDex is the LONE cross node still
>   on the legacy raw shape — its `crossNightBlock` never calls `CrossNightEnvelope.build` even when present, unlike the
>   other four. Captured in the follow-up brief.

# Suite runtime-coverage gap — `*-cross.js` node surface (and other app-bundled aux modules) are loaded into the suite but never RUN

> **Read `CLAUDE.md` first** (the two gates, the re-bundle ritual). **No code defect, no failing gate** — this is a
> *coverage blind-spot* a real module fell into, surfaced WHILE executing `CPAPDEX-PHASE9-FOLLOWUPS-III`. Everything
> here is **LOW–MEDIUM / test-only hardening**; nothing ships wrong today. Verify, don't trust — every claim below was
> checked against the live runners, not assumed.

## 0 · How this surfaced (verify, don't trust)
Executing -III, I found that **`cpapdex-cross.js` / `CPAPCross` was loaded into NEITHER test runner at runtime** —
`Dex-Test-Suite.html` had no `<script src="cpapdex-cross.js">` and `run-tests.mjs` never `loadInto`-ed it; only its
SOURCE TEXT was fetched (for the P12 byte-identity gate). The CPAPDex bundle (`CPAPDex.html`) *does* ship it, and the
app's `exportNight` multi-night branch calls `CPAPCross.crossNightBlock` — so a module that ships to users had **zero
runtime assertion** in the suite. -III fixed the CPAPDex instance (co-loaded it in both runners + added it to `env`, and
the new multi-night golden now exercises `crossNightBlock` once). **This brief is the GENERAL version of that finding.**

## 1 · LOW–MEDIUM (fleet-wide) — only `ECGCross` is runtime-loaded among the `*-cross.js`; the others' NODE-SPECIFIC surface is untested
Verified live: `oxydex-cross.js`, `pulsedex-cross.js`, `ppgdex-cross.js` (and, pre-III, `cpapdex-cross.js`) are **not**
runtime `<script>`-loaded in `Dex-Test-Suite.html` and **not** `loadInto`-ed in `run-tests.mjs` — their source is fetched
ONLY for two SOURCE-TEXT gates: the **P12 cross-Dex drift** gate (asserts the shared *significance rule* is byte-identical
across nodes, ~L1407) and the `DexKernel.K.SIGNIF_*` reference check (~L1535). The only `*-cross.js` exercised at RUNTIME
is **`ECGCross`** (the "Cross-night baseline mean/sd" group, ~L94), which the suite trusts to cover the SHARED `crossNight`
ENGINE for all nodes by byte-identity.

- **The gap:** byte-identity covers ONLY the shared engine + significance rule. Each `*-cross.js` ALSO carries
  **node-specific, NON-identical** code that no gate runs: the `<NODE>_DEFS` outcome table (each metric's
  `get`/`goodDirection`/`unit`/`evidence`), the `crossNightBlock(nightsChrono)` wiring into `CrossNightEnvelope.build`,
  and per-node helpers — e.g. CPAPCross's `nightOdi` (mean of oximeter-available sessions, null when none),
  `compliancePct`, `nightWeight`; OxyCross/PulseCross/PpgCross have their own. A bug in any of these (wrong field in a
  `get`, an inverted `goodDirection`, a broken `nightOdi`) is caught by **neither** P12 (source-identity of the shared
  rule only) **nor** the ECGCross engine test. CPAPCross is now partially covered transitively by the -III multi-night
  golden — but that golden uses **3 IDENTICAL nights** (sd 0, trend 'stable', headline []), so it never exercises a
  varying trend, a significant Mann-Kendall, a non-trivial z-score, or most of the `_DEFS` value space.
- **Do (cheap, test-only, NO re-bundle):** runtime-co-load EVERY `*-cross.js` in BOTH runners (add the `<script>` tags +
  the `loadInto` entries + `OxyCross`/`PulseCross`/`PpgCross`/`CPAPCross` to `env`), then add a per-node `crossNightBlock`
  group that drives a short **VARYING** multi-night series and asserts the node-specific `_DEFS` mapping + helper outputs
  (mirror the ECGCross group; CPAPCross's is the `-IV §1` item — fold -IV §1 into this fleet pass rather than doing it
  twice). Localizes a per-node cross failure to the node instead of inferring correctness from ECGCross + P12.

## 2 · MEDIUM (the ROOT cause) — `dex-coload.js` covers only adapters + routable DSPs, so no gate guarantees an app-BUNDLED module is even loaded in the suite
`dex-coload.js` (the "single ordered source of truth" the `dex-coload manifest` gate enforces) lists **only**
`adapters` + the 6 routable `dsps`. The per-node AUXILIARY modules every app bundle includes — `*-cross.js`,
`*-coimport.js`, `*-fusion.js`, `*-render.js`, `*-edf.js`, `*-registry.js` — are **outside the manifest**, so the
conformance gate ("every host realm co-loads every module") simply **does not range over them**. That is precisely why
`cpapdex-cross.js` could ship in `CPAPDex.html` yet be absent from both runners with no gate complaining. The blind spot
is structural, not a typo: **there is no invariant that "a module bundled into App X is also runtime-present in the
suite."**

- **Do (the real fix — test-infra, NO app re-bundle):** add a gate that, for each app bundle, reads the set of
  `*-*.js` modules it inlines (from `BUILD-MANIFEST.json`'s per-bundle manifest, or by parsing the `.src.html`
  `<script src>` list) and asserts each is EITHER runtime-co-loaded in the suite (present on `window`/`env`) OR explicitly
  on a small, documented `RUNTIME_EXEMPT` allow-list (e.g. DOM-only `*-render.js`/`*-app.js` that need a booted app —
  already covered by the render-coverage rigs; `*-edf.js` covered by `CpapEdf.selfTest`). A module that is neither
  co-loaded nor exempted is a RED. This turns "shipped but untested" from a silent state into a checked one, fleet-wide.
  (Lighter interim: just EXTEND `dex-coload.js` with a `nodeModules:` section listing the `*-cross.js`/`*-coimport.js`
  and point the existing conformance gate at it too — closes the cross/coimport leg without the full bundle-introspection
  gate.)

## 3 · LOW (consistency, found alongside) — Node vs browser co-load ASYMMETRY
The two runners do not co-load the same set: e.g. `cpapdex-coimport.js` is `<script>`-loaded in `Dex-Test-Suite.html`
(so `CpapCoimport` is live → `cpapBuildExport`'s `crossNode` block can run) but is NOT `loadInto`-ed in `run-tests.mjs`
(so Node sees `crossNode:null`). Harmless for the current goldens (both resolve `crossNode` to null — browser because
`CpapCoimport` is empty at gate time, Node because it's absent), but it means the two runners are NOT exercising the same
code paths, and a `crossNode`-bearing fixture would diverge Node↔browser. Same class for any aux module loaded in one
runner but not the other.
- **Do:** once §2's manifest/gate exists, make it assert BOTH runners co-load the SAME set (or both exempt it
  identically), so Node-CI and the browser gate stay path-equivalent. Until then, document the known asymmetry.

---

## Done when (whole brief)
- §1 every `*-cross.js` is runtime-co-loaded + in `env` in BOTH runners, and each node has a `crossNightBlock`/`_DEFS`
  runtime group over a VARYING series (subsumes `CPAPDEX-PHASE9-FOLLOWUPS-IV §1`), green.
- §2 a gate asserts every app-BUNDLED `*-*.js` module is runtime-present in the suite OR on a documented exempt list
  (or, interim, `dex-coload.js` gains a `nodeModules:` leg the conformance gate ranges over) — a future bundled-but-
  unloaded module is a RED, not a silent drop.
- §3 the Node↔browser co-load sets are asserted equal (or identically exempted); the asymmetry is gated or documented.
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean. All items are TEST-INFRA
  ONLY → **NO app re-bundle** (no `*-app.js`/`-dsp.js`/bundled-module runtime behavior changes).

### Priority summary
- **MEDIUM (root cause):** §2 (no invariant that an app-bundled module is loaded in the suite — `dex-coload.js` covers
  only adapters + routable DSPs).
- **LOW–MEDIUM (the symptom's reach):** §1 (`*-cross.js` node-specific surface runtime-untested fleet-wide; only
  ECGCross runs — subsumes the CPAPDex-specific -IV §1).
- **LOW (consistency):** §3 (Node↔browser co-load asymmetry — e.g. `cpapdex-coimport.js`).
