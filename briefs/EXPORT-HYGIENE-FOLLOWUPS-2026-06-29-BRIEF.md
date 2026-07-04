<!--
  EXPORT-HYGIENE-FOLLOWUPS-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `EXPORT-HYGIENE-2026-06-27-BRIEF.md` · **Sibling-of:** `EXPORT-IDENTITY-FOLLOWUPS-2026-06-29-BRIEF.md` · **Followed-by:** `EXPORT-HYGIENE-FOLLOWUPS-II-2026-06-29-BRIEF.md` — §1 EXECUTED 2026-06-29: the remaining 7 exporters (OxyDex/ECGDex/HRVDex/GlucoDex/PpgDex/CPAPDex/Integrator) now name through the shared `exportName()` (local `_exportTs()`/`stampName()`/inline `cpapdex-` stamps DELETED; recording-anchored + span-aware + controlled-vocab; HRVDex window passes `spanDays`; the un-grepped ppgdex/cpapdex/integrator builders audited + folded; interop files — ECGDex Welltory CSV + computed-RR, PpgDex selfPPI, GlucoDex cleaned-CGM CSV, OxyDex parser HTML — left OFF-scheme per §4 but de-clocked) → **every exporting node migrated, flips the parent DONE**. dex-export.js wired into all 7 `.src.html`; all 8 re-bundled; both gates green (verify-provenance GATE A 8/8 + GATE B; Dex-Test-Suite all-green 88 groups). §2 (in-payload `generated`) + §3 (`contentId` filename suffix — now UNBLOCKED, PulseDex ships `recording.contentId`) carried to `EXPORT-HYGIENE-FOLLOWUPS-II-2026-06-29-BRIEF.md`.

# Export-filename hygiene — follow-ups (what surfaced executing Phase 0 + the first node)

> **Closed in the parent (2026-06-29):** Phase 0 — new `dex-export.js` (`exportName({node,t0Ms,kind,ext,spanDays})`
> + frozen `EXPORT_KINDS=['ganglior','summary','series','report']`), DOM-free, recording-anchored to `t0Ms`
> via `getUTC*` (Clock-Contract §5), viewer-TZ-independent, `undated` on null `t0Ms` (never `now()`),
> span-aware; new `export-naming` Dex-Test-Suite group (14/14); wired into both test runners + tsconfig.
> Phase 1 — **PulseDex** migrated: its 4 `_exportTs()` call sites now call `exportName(...)` (single→`summary.json`,
> multi→`series.json`+`spanDays` **without** the old `_multi<N>` count, ganglior→`ganglior.json`, summary
> CSV→`summary.csv`); the local Clock-Contract-violating `_exportTs()` is DELETED; `dex-export.js` wired into
> `PulseDex.src.html`. **FIXTURE-INERT** (a download filename is not hashed content): PulseDex re-bundled
> `manifestHash 3c85d78cd9c2→3ca0eac7a9ea`, `buildHash 17ee0d96c509 UNCHANGED` (verified at runtime), both
> code-gated fixtures byte-identical (manifestHash re-recorded, not regenerated). Both gates green. The
> parent stays **IN-PROGRESS** (its lifecycle reserves DONE for "every exporting node migrated"; "Phase 1
> is forever", like SIGNAL-ADAPTER Phase 9).

---

## §1 — Phase 1 remaining nodes (opportunistic, one per pass — fixture-INERT)

These exporters still build their download filename locally (own `_exportTs()` or inline stamp) and have
NOT adopted `exportName()`: **OxyDex, HRVDex, ECGDex, PpgDex, GlucoDex, CPAPDex, Integrator**. Migrate each
when you're touching it anyway: load `dex-export.js` in its `.src.html`, replace the local stamp call sites
with `exportName(...)`, delete the dead `_exportTs()`. Then the cheap ritual: re-bundle → `Dex-Test-Suite`
green → read `manifestHash` → update `BUILD-MANIFEST.json` (GATE A). **No fixture regen** — the filename is
not hashed content, so GATE B only needs the producing-bundle `manifestHash` re-recorded for that node's
code-gated fixtures (the PulseDex precedent this round). ⚠ Do NOT rename the already-committed
`uploads/*.json` fixtures to the new scheme — they are cross-referenced by name (parent §3 / `BUILD-MANIFEST`
/ `FIXTURE-PROVENANCE`); the new scheme applies to NEW exports only.

**Per-node specifics to confirm while migrating (parent §2.4 / §2):**
- **HRVDex** is the span-aware case — its window export must pass `spanDays` (first night + `Nd`), not a
  single misleading `HHMM`. `exportName` already formats this; wire `spanDays` from the dashboard window.
- **Audit the un-grepped exporters** (`ppgdex-app.js`, `cpapdex-app.js`, `integrator-app.js`) — the parent's
  original grep capped at five; confirm each filename builder and fold it into the helper as that node migrates.

## §2 — Out of scope, still pending (fixture-MOVING — separate gated decision): in-payload `generated`

`pulsedex-app.js` (and mirrors) still write `generated: new Date().toISOString()` **into** the export content
(`schema.generated` + a top-level `generated` on the multi payload). `toISOString()` is at least UTC (not the
filename's old local bug), but it makes the bytes **non-deterministic per export**, so it leans on the
equivalence gate's exclusion list to stay green. Making it deterministic (recording-anchored, or omitted, or
formally on the exclusion list) changes export *content* → **moves fixtures** → must ride a node's next
deliberate fixture regen with GATE B. Tracked here per parent §5; do NOT silently change it under a filename pass.

## §3 — `recording.contentId` filename suffix (blocked on EXPORT-IDENTITY Phase 2)

The parent §2.5 reserved an optional `_<contentId>` disambiguator (`…_ganglior_a1b2c3.json`) using the
content digest from `EXPORT-IDENTITY`. `contentId` now exists on the `SignalFrame` (EXPORT-IDENTITY Phase 0),
but no node surfaces it in its export yet (EXPORT-IDENTITY-FOLLOWUPS §1). Wire the optional suffix into
`exportName` (a new optional `contentId` field) **after** a node ships `recording.contentId`; do not invent
a separate id here.

## §4 — Intentional non-migrations (recorded so a future pass doesn't "fix" them)

PulseDex's Welltory-compat exports — `pulsedex_welltory_<date>.csv` and `welltory_log_updated.csv` — are
**deliberately NOT** on the `<Node>_<date>_<time>_<kind>.<ext>` scheme and were left untouched: they are
external-format interop files (a Welltory-shaped daily line / an appended running log), not Dex node exports,
and never used `_exportTs()`. Leave them.

## Definition of done

Every exporting node emits through `exportName()` with its local stamp deleted (§1) → flips the parent to
DONE. §2 (in-payload `generated`) and §3 (`contentId` suffix) are separately gated and may stay open.
