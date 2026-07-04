<!--
  CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follow-up:** `CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-II-2026-06-29-BRIEF.md` (the full per-bundle "bundled ⇒ runtime-present-or-exempt" gate still open — §1 here shipped the lighter cross/coimport-class exhaustiveness check) · **Follows:** `CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28-BRIEF.md` (executed 2026-06-29) · **Relates:** `dex-coload.js` (the new `nodeModules:` leg + the `Co-load §2/§3` gate it backs), `crossnight-envelope.js` (`CrossNightEnvelope.build`/`validate`), `ppgdex-cross.js`, the P12 cross-Dex drift gate (`tests/dex-tests.js` ~L1402) · **Scope:** FLEET-WIDE (test-infra + one node-shape consistency item)

# Cross-module runtime-coverage — follow-ups (residue from executing the parent)

> **Read `CLAUDE.md` first** (the two gates, the re-bundle ritual). The parent brief is DONE — all 3 sections shipped
> (every `*-cross.js` runtime-co-loaded in both runners; the `Cross §1` per-node group; the `Co-load §2/§3`
> runtime-presence gate over `dex-coload.js`'s new `nodeModules:` leg). This brief captures the two things surfaced WHILE
> executing it. Both are **LOW / hardening**; nothing ships wrong today, both gates were green after the parent. Verify,
> don't trust — every claim below was checked against the live modules + the real `runDexTests(env)` runner, not assumed.

## 1 · MEDIUM (the parent's §2 root cause is NARROWED, not CLOSED) — the `nodeModules:` leg is hand-maintained
The parent took §2's **explicitly-sanctioned interim**: extend `dex-coload.js` with a `nodeModules:[{file,global}]` leg
(the 5 `*-cross.js` + `cpapdex-coimport.js`) and point a new gate (`Co-load §2/§3 — app-bundled aux modules
runtime-present + runner-symmetric`) at it. That gate is real teeth — a module ON the list that is NOT co-loaded into a
runner reds — but the list is **authored by hand**. The structural invariant the parent's §2 actually named ("a module
BUNDLED into App X is also runtime-present in the suite") is still **not** enforced: a NEW aux module added to some
`Foo.src.html` tomorrow (a `foo-cross.js`, a second `*-coimport.js`, a `*-fusion.js`) is caught ONLY if a human also adds
it to `nodeModules:`. So the blind spot is **narrowed to the cross/coimport leg**, not closed — the same class of
"shipped but never loaded in the suite" that let `cpapdex-cross.js` slip can recur for any aux module nobody hand-lists.

- **The real fix (parent §2's primary path, deferred there):** add a gate that, for EACH app bundle, derives the set of
  `*-*.js` modules it actually inlines — either by parsing the bundle's `__bundler/manifest` (the gzip+base64 file map;
  see the parent task's manifest-decode approach) or the `.src.html` `<script src>` list — and asserts each is EITHER
  runtime-co-loaded in the suite (present on `window`/`env`) OR on a small, DOCUMENTED `RUNTIME_EXEMPT` allow-list
  (DOM-only `*-render.js`/`*-app.js` covered by the render-coverage rigs; `*-edf.js` by `CpapEdf.selfTest`;
  `*-registry.js` by the registry groups). A module that is neither co-loaded nor exempted is a RED. That makes
  "bundled ⇒ loaded-or-exempt" a CHECKED invariant fleet-wide, and the hand-maintained `nodeModules:` leg can then be
  derived/validated against it rather than trusted. **Test-infra only, NO app re-bundle.** Cost is the bundle-manifest
  parsing + curating the exempt list once.
- **Lighter middle step if the full gate is too much in one pass:** assert `dex-coload.js`'s `nodeModules:` set is
  EXHAUSTIVE for the cross/coimport class by globbing the repo for `*-cross.js`/`*-coimport.js` and reding if any file
  exists that the leg omits — closes the "added a new cross file, forgot to list it" hole without the per-bundle
  introspection.

## 2 · LOW (node-shape consistency, found alongside) — PpgDex is the LONE cross node still on the legacy raw shape
Verified live while writing the `Cross §1` group: of the five `*-cross.js`, **four** (`oxydex`, `pulsedex`, `ecgdex`,
`cpapdex`) build their `crossNightBlock` through `CrossNightEnvelope.build(...)` → the standardized
**ganglior.crossnight v1.0** envelope (`metrics[id].central.mean`, `.trend.label`, `.baseline.zLatest`, a `series[]`
provenance block, ranked `headline[]`, and `CrossNightEnvelope.validate()` passes). **`ppgdex-cross.js` does NOT** — its
`crossNightBlock` ALWAYS emits the legacy flat shape (`out.metrics[id]` IS the raw `crossNight()` result →
`.mean`/`.trendLabel`, plus an `out.nights[]`), and it never references `CrossNightEnvelope` even when the builder is
bundled (the other four fall back to legacy only when it's ABSENT). So PpgDex is the one node whose cross-export the
Integrator must read via the legacy path; the `Cross §1` group already asserts PpgDex's raw shape explicitly (and the
envelope shape for the other four) so this is COVERED, not broken — but it's an inconsistency worth resolving.

- **Do (one of two — both deliberate, re-bundle-gated because they touch `ppgdex-cross.js` which `PpgDex.html` bundles):**
  - **(a) Migrate** PpgDex onto `CrossNightEnvelope.build` like its siblings (lift its `defs` into the `metrics:[{id,
    label,unit,goodDirection,get}]` array + `t0Of:s=>s.t0Ms`, `weightOf` from `analyzablePct`), so all five nodes emit
    one shape and the Integrator drops the PpgDex legacy special-case. Numbers are unchanged (the envelope injects the
    SAME local `crossNight` math — the OxyDex/ECGDex/CPAPDex migrations were behavior-preserving by construction), so the
    PpgDex equiv fixture stays byte-identical at the metric layer EXCEPT the cross block's shape — regenerate the PpgDex
    `*-cross`-touching fixture(s) by re-running + re-export, re-bundle `PpgDex.html`, update `BUILD-MANIFEST.json` + the
    PpgDex `manifestHash` in `FIXTURE-PROVENANCE.json` per the ritual. Switch the `Cross §1` PpgDex assertions from the
    raw-shape branch to `validate(block).ok` like the others.
  - **(b) Document it as intentional** (PpgDex's cross-export is consumed only by a legacy reader, or the raw `nights[]`
    is load-bearing somewhere the envelope's `series[]` doesn't cover) — add a one-line note in `ppgdex-cross.js` + the
    CROSSNIGHT-ENVELOPE-SPEC so the asymmetry is a recorded decision, not an oversight, and keep the `Cross §1`
    raw-shape assertion as the guard. No re-bundle.
  - Pick (a) for uniformity (preferred — it's the direction the other four already went) or (b) if there's a real
    consumer reason; don't leave it unspoken.

---

## Done when (whole brief)
- §1 either the per-bundle "bundled ⇒ runtime-present-or-exempt" gate exists (with a documented `RUNTIME_EXEMPT` list) OR
  the lighter exhaustiveness check (`nodeModules:` ⊇ every repo `*-cross.js`/`*-coimport.js`) is in place — a future
  bundled-but-unlisted aux module is a RED, not a silent omission. Test-infra, NO re-bundle.
- §2 PpgDex is EITHER migrated onto `CrossNightEnvelope.build` (re-bundle + `BUILD-MANIFEST` + fixture `manifestHash`
  re-record per the ritual; `Cross §1` switched to `validate()`) OR the legacy-shape choice is documented in
  `ppgdex-cross.js` + the spec with the `Cross §1` raw-shape guard kept.
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean (§1 = no re-bundle;
  §2-with-migration = re-bundle PpgDex per the ritual).

### Priority summary
- **MEDIUM:** §1 (the `nodeModules:` leg is hand-maintained — narrows but does not close the parent's §2 structural
  blind spot; the real per-bundle introspection gate is still open).
- **LOW:** §2 (PpgDex is the lone cross node on the legacy raw shape — migrate for uniformity or document as intentional).
