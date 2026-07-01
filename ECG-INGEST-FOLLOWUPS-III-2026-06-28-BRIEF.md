<!--
  ECG-INGEST-FOLLOWUPS-III-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `ECG-INGEST-FOLLOWUPS-II-2026-06-28-BRIEF.md` (DONE 2026-06-28) · **Up-references:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` (shared vendor/ingest registry)

# ECGDex ingest follow-ups III — gate PpgDex's loadFiles planning too

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the edit-`*.js`/re-bundle rule).
> Nothing here is shipped-broken — FOLLOWUPS-II landed §1/§3/§4 with both gates green. This is the
> ONE residue executing §4 surfaced: the new shared planner gates the **ECGDex** drop path only.

## What FOLLOWUPS-II executed (context)

§4 lifted the ECGDex `loadFiles` orchestration (bucket → device-anchor companion filter →
`_RR`-over-`_PPI` → de-dupe → part-group) into a pure, headless, NAME-only **`DexIngest.planIngest`**
(`groupFileParts`+`dedupeCompanionGroups` moved out of `ecgdex-app.js` into `dex-ingest.js` as
byte-faithful mirrors). `ecgdex-app.js loadFiles` now CONSUMES it (the async header content-sniff
stays app-side, feeding verdicts via `opts.sniffedForeign`), and a new `Ingest planning —
DexIngest.planIngest` Dex-Test-Suite group (both runners) gates the mixed Sense+H10 split, the
`_RR`/`_PPI` pick, the dup-night set-aside, sniff-foreign, and the active-device anchor. `planIngest`
returns the ECG-shaped `{ ecgGroups, companionLanes, skipped }`. ECGDex + PpgDex were re-bundled
(`65e5eaaa152c→7b9e7d25c3d7` / `71e712b0b87c→bc53eeaf74ff`, buildHash unchanged both; PpgDex's bundle
just re-picked-up the shared `dex-ingest.js` — `ppgdex-app.js` itself was UNTOUCHED).

---

## §1 (⚠ — the residue) — PpgDex's `loadFiles` planning is still only LIVE-tested

`ppgdex-app.js loadFiles` already delegates **classification** to `DexIngest.ppgKind` and the
device/foreign rules to `DexIngest.deviceKey`/`foreignVendor`/`sniffFirstLine` (FOLLOWUPS §2). But its
**orchestration** — the same-session **de-dupe** (device id + structured stamp), the **device-id
companion ELIGIBILITY** filter, the no-PPG report — lives inline in `loadFiles` and is exercised only
by the live render-coverage rig (which drives a single `genSynthetic` session), never a multi-file
drop. So the exact bug classes §4 gated for ECGDex (a mixed Sense+H10 drop, a duplicated `_PPG`) are
NOT gate-backed for PpgDex.

**Why `planIngest(fileNames)` as-shaped did NOT just drop in (the discovered asymmetry).** PpgDex is
**content-first**: `loadFiles` reads EVERY file's text up front, runs `DSP.mergeMultipart` on the
parsed `{name,text,kind,stampMs}` objects (text-merging, not the name-only `groupFileParts`), and its
companion **pick** is per-`_PPG` and uses the **parsed `rec.t0Ms`** (`const ref = rec.t0Ms || pf.stampMs`)
for the nearest-stamp tie-break — not the filename stamp. A pure NAME-only planner can own PPG's
**classify · skip/foreign · dup-session set-aside · device-ELIGIBILITY** (all name-based), but the
final nearest pick MUST stay app-side (it needs the parsed `t0Ms`). And PPG's association model is
**per-primary** (each `_PPG` picks its own nearest eligible sidecar of each kind), whereas ECG's is
**global lanes** (load every deduped `rr/hr/acc`) — so the `ecgGroups`/`companionLanes` return shape
is genuinely ECG-shaped, not a fit for PPG.

**Do (medium).** Extend the shared planner to gate PPG's name-based planning WITHOUT moving its
parsed-`t0Ms` pick:
- Option (a) — a PPG-shaped sibling `DexIngest.planIngestPpg(items, opts)` returning
  `{ ppgPrimaries (deduped), eligibleByPrimary: { name → { acc:[names], gyro:[…], magn, ppi, marker } },
  skipped }` — device-ELIGIBILITY + dup-session only; `ppgdex-app.js` keeps the `rec.t0Ms` nearest
  pick over the returned eligible candidates. Gate the dedup + eligibility directly.
- Option (b) — factor just the two shared name-based primitives (`_dedupeGroups`-style
  dedupe-by-device-session, and an `eligibleCompanions(primaryName, candidates)` device filter) onto
  `DexIngest` and have BOTH apps call them (ECG's `planIngest` internally + PpgDex's `loadFiles`),
  then gate those primitives. Smaller surface, less behaviour-risk, but doesn't gate PPG's whole plan
  in one call.

**Done when.** A `tests/dex-tests.js` group (both runners) asserts, on NAME lists, PpgDex's
mixed-Sense+H10 companion split + the duplicate-`_PPG` set-aside DIRECTLY (mirroring §4's ECG group),
and a source-mirror proves `ppgdex-app.js loadFiles` CONSUMES the shared surface (no drifting inline
copy). **NODE change → re-bundle PpgDex + GATE A/B** — ingest-inert (the pick + parse are unchanged →
`ppgBuildNodeExport`/`compute` untouched → re-record the `manifestHash`, do NOT regenerate the
`PpgDex_*_equiv` fixture; confirm `env.equiv.ppgdex` byte-identical).

## §2 (low — known-by-design, DOCUMENT) — `signal-orchestrate` keeps its own `streamKind`/`fnameStampMs`

FOLLOWUPS-II §1 folded `pairCompanions`'s `deviceKey`+`foreignSignal` onto `DexIngest`, but
`signal-orchestrate` deliberately KEEPS its local `streamKind` (a generic name→kind for ANY drop
file) and `fnameStampMs` (a loose any-name `YYYYMMDD_HHMMSS` parse) — neither has a `DexIngest`
equivalent (`DexIngest`'s classifiers are node-specific `ecgKind`/`ppgKind`, and `stampMs` requires
the Polar prefix). These are NOT drift candidates; they serve the host's cross-vendor companion
pairing. **No fix — recorded so it isn't re-investigated.**

---

## Gate ritual (every re-bundle — from CLAUDE.md)

Edit the `*.js`/`*.src.html`, **never** the bundled `*.html`; re-bundle via the inliner. Run
`Dex-Test-Suite.html` → `#summary` all-green; read the new `manifestHash` off `verify-provenance.html`,
hand-update `BUILD-MANIFEST.json` (GATE A) + the PpgDex fixture in `FIXTURE-PROVENANCE.json` (GATE B) —
regenerate a fixture only if `compute()` output moved (an ingest-planning change does not).
`buildHash` moves only on an inline-`<script>`/`<style>` edit in the `.src.html` shell.

## After executing this brief — DONE 2026-06-28

Executed §1 via **option (a)** — a PPG-shaped sibling `DexIngest.planIngestPpg(items, opts)` in
`dex-ingest.js` returning `{ ppgPrimaries (deduped), eligibleByPrimary, hr, skipped }`. It owns the
NAME-based plan (classify → foreign/skip set-aside → duplicate-session de-dupe → per-primary
device-ELIGIBILITY); `ppgdex-app.js loadFiles` CONSUMES it and keeps the parsed-`rec.t0Ms` nearest
companion pick app-side (a name-only planner can't see `t0Ms`). The byte-reading first-line sniff
stays app-side and feeds verdicts via `opts.sniffedForeign` (mirrors the ECG planner). New
Dex-Test-Suite group **'Ingest planning — DexIngest.planIngestPpg (PPG drop path)'** (both runners,
mirrors §4): (a) mixed Sense+H10 split, (b) duplicate-`_PPG` set-aside vs distinct sessions, (c)
device-`_HR` ignored-lane, (d) sniff-foreign, (e) per-primary device split, (f) source-mirror (app
consults `ING.planIngestPpg`; inline dedupe + `cd===pfDev` eligibility GONE). PpgDex re-bundled
`bc53eeaf74ff→cae7574289af` (buildHash `fff8fe8b1b68` UNCHANGED — external-JS-only). Ingest-INERT:
`compute`/`ppgBuildNodeExport` untouched → `PpgDex_*_equiv` NOT regenerated, `env.equiv.ppgdex`
byte-identical; manifestHash re-recorded in `BUILD-MANIFEST.json` (GATE A) + `FIXTURE-PROVENANCE.json`
(GATE B). **Both gates green (LIVE, same-origin):** Dex-Test-Suite ✓ all-green (incl. the new group,
the equivalence gate, + render-coverage on the NEW bundle); verify-provenance GATE A 8/8 (PpgDex
`cae7574289af` match, buildHash unchanged) + GATE B PpgDex `reproducible ✓ (code-gated)` + §6 parse-OK.

**Deviations from the option-(a) sketch (intentional, documented in code):** `eligibleByPrimary` holds
item REFS, not bare names (cleaner app consumption — no name→object remap; the test maps
`.map(c=>c.name)`); an extra `hr` field carries the device-`_HR` ignored-with-note set (PPG-specific,
no ECG analogue).

**Residue → spawned `ECG-INGEST-FOLLOWUPS-IV-2026-06-28-BRIEF.md`.** A post-execution re-audit
surfaced two actionable items this pass under-weighted: **(IV §1, ⚠)** the per-primary nearest-`t0Ms`
companion PICK — deliberately kept app-side — is now the SOLE un-gated link in PPG companion
association, and it is PPG-UNIQUE (ECG loads all deduped companions per lane, so -III's ECG group never
exercised this logic class); two same-device sessions dropped together are separated ONLY by that
untested pick. **(IV §2)** option (a) left the name-based dedupe + device-eligibility primitives
DUPLICATED across `planIngest`/`planIngestPpg` (the two-copy drift trap, one layer up). Plus the
carried LOW, safe-degrading note (now IV §4): `eligibleByPrimary` is keyed by primary NAME, so two
DISTINCT same-named `_PPG` primaries in one drop would collide — but it degrades to `|| {}` (no
companions attached), never a mis-attach, and Polar Sensor Logger names are unique by construction
(device id + structured stamp). §2 (`signal-orchestrate` keeps its own `streamKind`/`fnameStampMs`)
remains known-by-design. Standing Node-CI `env.equiv` literal `node` run stays tracked at
`SIGNAL-ADAPTER-FOLLOWUPS-XII §3` (no Node host this pass; discharged-by-equivalence — the browser
suite runs the identical `tests/dex-tests.js` superset).
