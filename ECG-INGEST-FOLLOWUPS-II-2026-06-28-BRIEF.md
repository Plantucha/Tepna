<!--
  ECG-INGEST-FOLLOWUPS-II-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Executed:** **§1** — folded `signal-orchestrate.pairCompanions` onto the shared `dex-ingest.js` registry (its OWN `deviceKey`+`foreignSignal` DELETED → now consults `DexIngest.deviceKey`/`foreignVendor`; `dex-ingest.js` co-loaded BEFORE `signal-orchestrate.js` in all four hosts — Data Unifier · OverDex · Dex-Test-Suite · `run-tests.mjs`; a source-mirror group in both runners proves the local copies are gone + the fold is wired — the deferred AND-FRONTIER (b), loose-JS, NO re-bundle). **§3** — `dex-ingest.js` added to the `tsconfig` include. **§4** — the ECGDex `loadFiles` ORCHESTRATION (bucket → device-anchor companion filter → `_RR`-over-`_PPI` → de-dupe → part-group) lifted into a pure, headless, NAME-only `DexIngest.planIngest` (`groupFileParts`+`dedupeCompanionGroups` moved out of `ecgdex-app.js` into `dex-ingest.js` as byte-faithful mirrors); `loadFiles` now CONSUMES it (the async header content-sniff stays app-side, feeding verdicts via `opts.sniffedForeign`); new `Ingest planning — DexIngest.planIngest` Dex-Test-Suite group (both runners: mixed Sense+H10 split · `_RR`/`_PPI` pick · dup-night set-aside · sniff-foreign · active-device anchor · source-mirror). ECGDex re-bundled `65e5eaaa152c→7b9e7d25c3d7`, PpgDex `71e712b0b87c→bc53eeaf74ff` (buildHash UNCHANGED both — external-JS-only; both `*_equiv` fixtures EXPORT-INERT → re-recorded, not regenerated). **§2** is DOCUMENT-only (known-by-design, no code). Both gates green: **Dex-Test-Suite all-green 1264/78**, **verify-provenance GATE A 8/8 + GATE B reproducible**. **Residue → `ECG-INGEST-FOLLOWUPS-III-2026-06-28-BRIEF.md`** (extend `planIngest` to gate PpgDex's content-first `loadFiles` planning — PPG's per-primary nearest-`t0Ms` companion association doesn't fit the `ecgGroups`-shaped plan). · **Follows:** `ECG-INGEST-FOLLOWUPS-2026-06-28-BRIEF.md` (DONE 2026-06-28) · **Up-references:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` (the shared vendor-registry ask — §1 landed its remaining (b) half)

# ECGDex ingest follow-ups II — residue discovered executing FOLLOWUPS

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the edit-`*.js`/re-bundle rule).
> Nothing here is shipped-broken — FOLLOWUPS landed §1–§6 with both gates green. These are the
> deliberately-deferred or newly-exposed residues. House pattern: this is the `-II` follow-on; spawn
> `-III` only if executing this surfaces more.

## What FOLLOWUPS executed (context)

A NEW shared `dex-ingest.js` (`DexIngest.{deviceKey,stampMs,ecgKind,ppgKind,foreignVendor,foreignKind,sniffFirstLine}`)
now holds the pure file-ingest classifiers, consumed by **both** `ecgdex-app.js` and `ppgdex-app.js`
and gate-backed by the `Ingest routing table` group (both runners). `signal-orchestrate.pairCompanions`
gained a device-id filter + foreign-signal reject (§1). ECGDex got cross-drop device awareness (§4) and
`_RR`-over-`_PPI` determinism + companion-group de-dupe (§5). `verify-provenance.html` hard-fails
visibly on a manifest parse failure (§6). `compute()`/`analyze()`/the node-export builders were
UNTOUCHED → both `*_equiv` fixtures export-inert (re-recorded, not regenerated).

---

## §1 (⚠ high — the deferred (b)) — fold `signal-orchestrate` onto the shared `dex-ingest.js` registry

FOLLOWUPS §3 promoted the app classifiers into `dex-ingest.js`, but **`signal-orchestrate.js` kept its
OWN `deviceKey` + `foreignSignal` + `streamKind` + `fnameStampMs`** (intentional — the host module is
loose `<script src>` in the Data Unifier / OverDex / both test runners, and giving it a hard load-order
dependency on `dex-ingest.js` across 4 hosts was out of scope). So `deviceKey` now lives in **two**
places (the app's `DexIngest.deviceKey` and `signal-orchestrate`'s local copy) — the classic drift trap.

**Do.** The original AND-FRONTIER (b): make `dex-ingest.js` the ONE shared registry that BOTH the apps'
`loadFiles` AND `signal-orchestrate.streamKind`/`pairCompanions` consult. Wire `dex-ingest.js` into the
Data Unifier / OverDex / `Dex-Test-Suite.html` / `tests/run-tests.mjs` load lists (it is pure + headless,
like `signal-orchestrate.js`), then have `pairCompanions` call `DexIngest.deviceKey`/`foreignVendor` and
delete the local copies. **Done when** the `Companion-bundle ingest` device-mismatch cases still pass
with `signal-orchestrate` consuming `DexIngest` (no local `deviceKey`), and a source-mirror assertion in
`tests/dex-tests.js` proves `signal-orchestrate.js` no longer declares its own `deviceKey`/`foreignSignal`.
Loose-JS only (no app re-bundle) — but it adds a load-order edge to 4 hosts, so sequence it deliberately.

## §2 (low — known-by-design, DOCUMENT) — de-dupe + device-filter only engage for Polar-structured names

`DexIngest.deviceKey`/`stampMs` return `null` for non-Polar / bare names, so §4's cross-drop filter and
§5's companion-group de-dupe **only** engage when device+session is identifiable from the Polar Sensor
Logger name. A duplicate `_HR` (or `_RR`/`_ACC`) under a **non-Polar** name still last-wins by drop order,
and a bare companion still loads globally. Intentional (we only disambiguate when we can identify
device+session — same rule as the ECG group de-dupe). A future non-Polar ECG/PPG vendor needs its own
name structure (or §1's registry). **No fix — this is the §7 known-by-design contract; recorded here so
it isn't re-investigated.**

## §3 (low — tooling) — `dex-ingest.js` not in `tsconfig` include

The new `dex-ingest.js` was wired into both `.src.html` shells + both test runners, but not (verified)
added to any `tsconfig.json` `include`. `tsconfig` is **not** a gate (per CLAUDE.md the gates are
`Dex-Test-Suite.html` + `verify-provenance.html`), so this is cosmetic — but the house habit is to add a
new shared module to the type-check include. **Do (trivial):** add `dex-ingest.js` to the `tsconfig`
`include` if one exists, for editor/type-check coverage. No gate impact.

## §4 (low — test depth) — the app `loadFiles` drop path is still only INDIRECTLY gated

§3's routing-table test covers the pure `DexIngest` classifiers (which both apps now consume, so a regex
regression IS caught). But the **orchestration** in `loadFiles` — the de-dupe loop, the `anchorDevices`
companions-only filter (§4), the `_RR`-over-`_PPI` lane preference (§5), `reportSkipped` messaging — is
still only exercised live (render-coverage drives `genSynthetic`, the equiv gate drives `compute({text})`;
neither drives a multi-file drop). A headless harness that calls a thin extracted `planIngest(fileNames)`
(pure: name list → `{ecgGroups, companionLanes, skipped}`) would let `tests/dex-tests.js` assert the
mixed Sense+H10 split, the `_RR`/`_PPI` pick, and the dup-night set-aside directly. **Do (medium):**
extract the pure *planning* of `loadFiles` (no FileReader/DOM) into a testable function and gate it.
App-only refactor → re-bundle ECGDex/PpgDex + GATE A/B (ingest-inert, re-record hashes).

---

## Gate ritual (every re-bundle — from CLAUDE.md)

Edit the `*.js`/`*.src.html`, **never** the bundled `*.html`; re-bundle via the inliner. Run
`Dex-Test-Suite.html` → `#summary` all-green; read the new `manifestHash` off `verify-provenance.html`,
hand-update `BUILD-MANIFEST.json` (GATE A) + any of that node's fixtures in `FIXTURE-PROVENANCE.json`
(GATE B) — regenerate a fixture only if `compute()` output moved (ingest/registry/wiring changes don't).
`buildHash` moves only on an inline-`<script>`/`<style>` edit in the `.src.html` shell.

## After executing this brief

Flip this header to `Status: DONE — <date>` **in place** (never rename), sync the `DOCS-INDEX.md` row,
and spawn `-III` only if execution surfaces new residue (or note "no residue" here if not).

> **Executed 2026-06-28.** §1 + §3 landed loose-JS/config (NO re-bundle); §4 extracted
> `DexIngest.planIngest` for the **ECGDex** drop path (`groupFileParts`+`dedupeCompanionGroups` moved
> out of `ecgdex-app.js` into `dex-ingest.js`; `loadFiles` consumes it; gated both runners) and
> re-bundled ECGDex `65e5eaaa152c→7b9e7d25c3d7` + PpgDex `71e712b0b87c→bc53eeaf74ff` (buildHash
> unchanged both; GATE A/B re-recorded; `*_equiv` export-inert). §2 needs no code (known-by-design).
> Both gates green (Dex-Test-Suite 1264/78 · verify-provenance GATE A 8/8 + GATE B reproducible).
> **NEW residue → `ECG-INGEST-FOLLOWUPS-III-2026-06-28-BRIEF.md`:** PpgDex's `loadFiles` is
> CONTENT-first (reads every file's text up front, `mergeMultipart` on parsed objects) and its
> companion pick uses the **parsed `rec.t0Ms`** (not the filename stamp) for the nearest-stamp
> tie-break, so the `ecgGroups`-shaped `planIngest(fileNames)` can't own PPG's per-primary
> association without changing behaviour. PPG's name-based parts (classify · skip/foreign ·
> dup-session · device-ELIGIBILITY) ARE shareable; the t0Ms pick must stay app-side. So PpgDex's
> drop-path orchestration is still only live-tested → -III extends the shared planner (or a PPG
> sibling) to gate it.
