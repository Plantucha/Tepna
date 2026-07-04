<!--
  CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-II-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **No follow-up:** the full invariant is now a CHECKED gate fleet-wide; the maintained surface is the `RESOLVE`/`RUNTIME_EXEMPT` tables (adding a bundled module forces a deliberate classification — the point), and loose-loaded modules (adapters/`signal-*`/orchestrate, not bundled into any node) stay covered by the existing `dex-coload manifest` + co-load-host gates by design. Nothing further surfaced. · **Follows:** `CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-2026-06-29-BRIEF.md` (executed 2026-06-29) · **Relates:** `dex-coload.js` (`nodeModules:` leg + the `Co-load §1`/`§2/§3` gates), `tests/dex-tests.js` (the `Co-load §1` exhaustiveness group + `env.srcHtml`), `Foo.src.html` `<script src>` lists, each bundle's `__bundler/manifest` · **Scope:** test-infra ONLY (NO app re-bundle)

# Cross-module runtime-coverage — follow-ups II (the per-bundle gate the lighter §1 step deferred)

> **Read `CLAUDE.md` first** (the two gates, the re-bundle ritual). The parent's §1 took the **lighter middle
> step** it explicitly sanctioned: a `Co-load §1` gate that scans every `*.src.html` `<script src>` list and asserts
> `dex-coload.js`'s `nodeModules:` leg EQUALS the **cross/coimport** modules the fleet bundles (both directions). The
> parent's §2 (PpgDex envelope migration) is DONE. This brief captures the ONE thing the lighter step did NOT close.
> Verify, don't trust — every claim was checked against the live `Co-load §1` group + the real `runDexTests(env)` runner.

## 1 · MEDIUM — the invariant is enforced only for the cross/coimport CLASS, not for EVERY bundled aux module
The parent's §1 named the structural invariant as *"a module BUNDLED into App X is also runtime-present in the suite (or
explicitly exempt)."* The shipped `Co-load §1` gate enforces that invariant ONLY for files matching
`/-(cross|coimport)\.js$/` — because that is the class `nodeModules:` was created to track and the class the parent
narrowed the blind spot to. So the hole is now **narrowed to the cross/coimport class, but still not the full
invariant**: a NEW aux module of a DIFFERENT shape wired into some `Foo.src.html` tomorrow — a `*-fusion.js` (today
deliberately exempt, but nothing ASSERTS it stays covered), a brand-new suffix (`*-detect.js`, `*-fuse.js`,
`*-coexport.js`), or a second non-suffixed helper — is caught by NEITHER `Co-load §1` (wrong suffix) NOR `Co-load §2/§3`
(only ranges over the hand-listed leg). The same "shipped but never loaded/exercised in the suite" class that let
`cpapdex-cross.js` slip can still recur for any bundled `*-*.js` outside the cross/coimport suffix.

- **The real fix (parent §2's primary path, deferred twice now):** add a gate that, for EACH app bundle, derives the
  set of LOCAL `*-*.js` modules it actually inlines — parse the bundle's `__bundler/manifest` (the gzip+base64 file map;
  `env.manifests` already feeds both runners the raw `BUILD-MANIFEST.json`/`FIXTURE-PROVENANCE.json`, and the
  `Co-load §1` gate already proves `env.srcHtml` carries every `.src.html`, so the `<script src>` list is the cheaper
  cross-runner-identical source) — and asserts each derived module is EITHER:
  - **runtime-co-loaded** in the suite (present on `window`/`env` via a `file → global` resolver — the `adapters`/`dsps`
    manifest gives basename→id for those, `nodeModules:` gives file→global for cross/coimport, and the registries +
    `crossnight-envelope.js` + the shared spine (`kernel-constants.js`, `metric-registry.js`, `signal-*.js`, `dex-*.js`,
    `quantity.js`, …) need a small explicit map), OR
  - on a **documented `RUNTIME_EXEMPT` allow-list** with a REASON per entry: DOM-only `*-render.js`/`*-app.js` (covered
    by the render-coverage rigs), `*-edf.js` (by `CpapEdf.selfTest`), `*-fusion.js` (by the fusion/equivalence goldens),
    `*-registry.js` (by the registry groups), `*-profile.js`/`*-overview.js`/`*-morph.js`/`*-util.js` (curate the rest
    once, each with its covering gate named).
  A module that is **neither co-loaded nor exempted is a RED.** That makes "bundled ⇒ loaded-or-exempt" a CHECKED
  invariant fleet-wide; the hand-maintained `nodeModules:` leg + the `Co-load §1` suffix gate can then be DERIVED from /
  validated against it rather than trusted. **Test-infra only, NO app re-bundle.** Cost = the `file→global` resolver map
  + curating the `RUNTIME_EXEMPT` list once (each entry justified by the gate that DOES cover it).
- **Lighter still (if the full resolver is too much in one pass):** keep `Co-load §1` as-is but BROADEN its suffix set
  to every aux class the fleet actually bundles beyond cross/coimport (add `fusion` etc.), each with an explicit
  exempt-or-listed disposition — closes the "new suffix nobody anticipated" sub-hole without building the full
  per-module resolver. (Strictly weaker than the per-bundle gate; only do this if the resolver is deferred.)

### Note on the `Co-load §1` data source (intentional, not a gap)
`Co-load §1` derives the bundled set from the `.src.html` `<script src>` lists, NOT a raw repo glob — so a `*-cross.js`
that EXISTS in the repo but is wired into NO `.src.html` is not flagged. That is **by design**: a module no bundle ships
is not a runtime-coverage gap (it executes nowhere), and it becomes one — and IS caught — the instant it is added to a
src.html. The per-bundle gate above inherits the same correct framing (it ranges over what each bundle inlines).

---

## Done when (whole brief)
- §1 EITHER the per-bundle "bundled ⇒ runtime-present-or-`RUNTIME_EXEMPT`" gate exists (with a documented, reason-stamped
  `RUNTIME_EXEMPT` list and a `file→global` resolver), so a future bundled aux module of ANY shape that is neither
  co-loaded nor exempt REDs — and the `nodeModules:` leg + `Co-load §1` are validated against it; OR the broadened-suffix
  lighter step is in place with every bundled aux class given an explicit exempt-or-listed disposition. Test-infra, NO
  re-bundle.
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean (test-infra only ⇒ no
  bundle moves, so both should be untouched).

### Priority summary
- **MEDIUM:** §1 (the full per-bundle introspection gate — the parent's §2 primary path, now deferred through two
  follow-ups; the `Co-load §1` exhaustiveness check covers only the cross/coimport class).
