<!--
  ECG-INGEST-FOLLOWUPS-GATE-RATIFY-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Ratifies:** `ECG-INGEST-FOLLOWUPS-2026-06-28-BRIEF.md` (marked DONE on HEADLESS evidence — this brief closes the live-gate gap) · **Progress 2026-06-28:** **Check 2's equivalence claim is now RATIFIED headless** — ran `ECGDex.compute({text})` + `PpgDex.compute({text})` (real DSPs, patched source) on the committed equiv inputs via `run_script`; both reproduce their `*_equiv` fixtures **byte-identical** (0 differing fields after the standard volatile strip of generated/provenance/kernel/vo2est/karv). So the export-inert manifestHash **re-record (not regenerate) is PROVEN**, not just reasoned. **Remaining = the two HOST-dependent checks only:** Check 1 (`node tests/run-tests.mjs`) + Check 3 (live `Dex-Test-Suite.html` render-coverage + `verify-provenance.html` GATE A/B iframe legs) still need a same-origin static host. · **Sibling:** `ECG-INGEST-FOLLOWUPS-II-2026-06-28-BRIEF.md` (architectural residue) · **Ratified 2026-06-28 (LIVE):** the preview served **same-origin** this session, so the iframe-reach-in legs this brief feared were **not** blocked (`bodyHasBlocked` false). **Check 2:** `Dex-Test-Suite.html` **✓ all-green 1247/79** incl. the **equivalence gate** with **ECGDex + PpgDex `compute() ≡ committed export` byte-identical** (RUN, not just reasoned) and all 9 render-coverage groups green. **Check 3:** `verify-provenance.html` **GATE A 8/8** (ECGDex `65e5eaaa152c`, PpgDex `71e712b0b87c`), **GATE B** all code-gated fixtures reproducible ✓, the §6 `FIXTURE-PROVENANCE.json parsed` pill renders, **zero reds**; the §6 hard-fail teeth re-confirmed live (corrupting the sidecar flips GATE B red, then reverted byte-exact). **Check 1** (`node tests/run-tests.mjs`) NOT invoked — no shell/node in this environment — but its contract is discharged by the browser running the **identical** `tests/dex-tests.js` all-green (a superset) + the prior headless replication; a literal Node CLI run remains standing debt. **Spawned:** `GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md` (the preview-is-same-origin discovery + §2–§5 minor residue). Clean ratification — no code change, no re-bundle.

# Gate ratification — confirm the ECG-INGEST-FOLLOWUPS re-bundle on a same-origin host

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the edit-`*.js`/re-bundle rule).
> **Why this brief exists:** the FOLLOWUPS pass was executed and stamped DONE in an environment whose
> preview is a **cross-origin / opaque-origin sandbox**, so the two *canonical* gates could NOT be
> fully run there: `Dex-Test-Suite.html`'s **render-coverage** legs and `verify-provenance.html` both
> boot each app bundle in a hidden `<iframe>` and reach into `contentWindow` — blocked cross-origin
> (the persistent-reds limitation documented in `Dex-Test-Suite.html`'s ENV NOTE). What WAS verified
> headlessly is strong but is **not** the gate of record. This is a **verify-only** brief: **no source
> edits are expected** — if everything is green, just flip this header to DONE. It is a deliberate,
> CLAUDE.md-compliant "never stamp DONE on unverified work" backstop, NOT a sign anything is broken.

## What the executing run DID verify (headless, origin-independent)

1. **Pure-module logic** — re-implemented `dex-ingest.js` + `signal-orchestrate.js` in a `run_script`
   sandbox and asserted the full §3 routing table, the §1 `pairCompanions` device-mismatch cases, and
   a **byte-equivalence** check that the new `DexIngest.ecgKind` === the ORIGINAL inline `classifyECG`
   over a sample set. **49/49 pass.**
2. **Shared assertion suite** — replicated `tests/run-tests.mjs` in-sandbox (all real modules + the
   patched `tests/dex-tests.js`, `env.DexIngest` + `env.manifests` wired): **977 passing, the new
   `Ingest routing table` + `Manifest JSON well-formed` groups and the extended `Companion-bundle
   ingest` group all green.** The only fails were **env-absence skips I deliberately didn't wire**
   (`docs`/`equiv`/`hosts` empty → cohesion-badges, equivalence gate, co-load-manifest, HRVDex-equiv
   groups self-skip) plus ONE harness artifact (`MetricRegistry.setTier/getTier` round-trips through
   `localStorage` key `dex_depth_tier`, inert in the sandbox → "got core want research"). **None are
   caused by the FOLLOWUPS edits.**
3. **Both re-bundles boot clean** — loaded `ECGDex.html` + `PpgDex.html` live: no console errors,
   `window.DexIngest` present and classifying correctly, and the **runtime `buildHash` is UNCHANGED**
   (ECGDex `146ac9c8b1bd`, PpgDex `fff8fe8b1b68` — read off `GangliorProvenance.buildHash()`), exactly
   as the entrance-guard.js precedent predicts for adding a new external `<script src>`.
4. **manifestHash recomputed statically** (same regex+SHA-256[0:12] `verify-provenance` uses):
   ECGDex `65e5eaaa152c`, PpgDex `71e712b0b87c`. **`BUILD-MANIFEST.json` (GATE A) + both `*_equiv`
   entries in `FIXTURE-PROVENANCE.json` (GATE B) updated to match; both files re-confirmed `JSON.parse`.**

## What was NOT run this session (the gap to close) — three checks

> Run on a **same-origin static host** (`python3 -m http.server` at the project root, or any local
> static server — NOT the opaque-origin preview). Each should be quick.

### 1. `node tests/run-tests.mjs` — the Node CI floor (origin-independent, the surest single check)
This runs the SAME `tests/dex-tests.js` the browser suite uses, now with `env.DexIngest` + the new
`readManifests()` wired into both runners. **Expect: all assertions pass, exit 0.** This alone ratifies
§1/§3/§6 (routing-table, companion device-mismatch, manifest-parse) and every source-mirror group with
zero browser/iframe involvement. If this is green, the shared-assertion contract is confirmed for real.

### 2. `Dex-Test-Suite.html` — `#summary` must read **all green**
Open it on the same-origin host, let it settle ~3 s (the render-coverage iframes boot sequentially).
Confirm the new/extended groups are green **and** the render-coverage + equivalence legs (which the
sandbox couldn't run) are green:
- **`Ingest routing table — DexIngest`** (new, §3) — ~40 assertions.
- **`Manifest JSON well-formed`** (new, §6).
- **`Companion-bundle ingest …`** (extended, §1 device-mismatch cases).
- **🔴 `Phase-9 compute() ≡ committed export — equivalence gate`** — THIS is the one I could not run
  (I skipped the heavy `compute()` to stay in the sandbox time budget). It must show **`env.equiv.ecgdex`
  and `env.equiv.ppgdex` byte-identical**, PROVING the two `*_equiv` fixtures still reproduce under the
  re-bundled source. My re-record of their manifestHash rests on the REASONED claim that
  `compute()`/`analyze()`/`ecgBuildNodeExport`/`ppgBuildNodeExport` are untouched (true — every edit is
  file-ingest *routing*). This gate is the actual proof of that claim; confirm it.

### 3. `verify-provenance.html` — GATE A 8/8, GATE B reproducible, no reds
- **GATE A:** every bundle's current manifestHash == `BUILD-MANIFEST.json`. Expect `8/8 match`, with
  the ECGDex row = **`65e5eaaa152c`** and PpgDex = **`71e712b0b87c`** (the 6 others unchanged).
- **GATE B / fixture audit:** `ECGDex_2026-06-27_equiv` reproducible against `65e5eaaa152c`,
  `PpgDex_2026-06-27_equiv` against `71e712b0b87c` (code-gated ✓). Legacy buildHash-only fixtures
  (`ppgdex_20260610.json`, the PulseDex summaries) still green — buildHash didn't move, so they must.
- **§6 NEW:** confirm the new **`FIXTURE-PROVENANCE.json parsed`** green pill renders (and that
  corrupting the JSON momentarily flips it to a RED `GATE B FAIL — failed to load/parse` banner — the
  hard-fail this pass added; revert the corruption after testing).

## If anything is RED (diagnosis, not expected)

- **Routing-table / companion / manifest group red** → a logic bug in `dex-ingest.js` /
  `signal-orchestrate.pairCompanions` / the new test expectations. Fix the source (loose JS for §1/§3
  tests; `dex-ingest.js` is bundled into both apps, so a fix there is a **re-bundle**).
- **Equivalence gate red (`env.equiv.ecgdex`/`ppgdex` byte-DIFF)** → the export was NOT inert after all
  (something in the ingest refactor leaked into a code path `compute({text})` exercises). Re-examine the
  `ecgdex-app.js` / `ppgdex-app.js` diffs; if a genuine export change, **regenerate** the fixture
  (re-run the app on its committed input + re-export) rather than just re-recording the hash, and note it.
- **GATE A drift** → a manifestHash typo in `BUILD-MANIFEST.json`; re-read the value off the page and fix.
- **A legacy buildHash fixture red** → the runtime buildHash unexpectedly moved (it shouldn't have —
  confirmed `146ac9c8b1bd`/`fff8fe8b1b68` live). Would mean the inliner template itself changed; if so,
  re-record those legacy stamps deliberately.

## Expected hashes (the source of truth for this pass)

| Bundle | buildHash (UNCHANGED) | manifestHash (NEW) | prior manifestHash |
|---|---|---|---|
| `ECGDex.html` | `146ac9c8b1bd` | `65e5eaaa152c` | `70fc04de6387` |
| `PpgDex.html` | `fff8fe8b1b68` | `71e712b0b87c` | `b6155e9b3cdb` |

The other 6 bundles are UNTOUCHED. `*_equiv` fixtures re-recorded (NOT regenerated) — export-inert,
pending the §2-equivalence-gate confirmation above.

## Done when

`node tests/run-tests.mjs` exits 0 · `Dex-Test-Suite.html` `#summary` all-green (incl. the equivalence
gate proving `env.equiv.ecgdex`/`ppgdex` byte-identical) · `verify-provenance.html` GATE A 8/8 + GATE B
reproducible, no reds. Then flip THIS header to `Status: DONE — <date>` in place, note the observed
suite counts (snapshot, not a baseline — per `GENERIC-EMIT-GATE-FOLLOWUPS §3`), and sync `DOCS-INDEX.md`.
If a real defect surfaces, fix + re-bundle per the gate ritual and record it; otherwise this is a clean
ratification with no code change.
