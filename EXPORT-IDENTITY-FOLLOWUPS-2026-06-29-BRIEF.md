<!--
  EXPORT-IDENTITY-FOLLOWUPS-2026-06-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 · **Created:** 2026-06-29 · **Follows:** `EXPORT-IDENTITY-2026-06-27-BRIEF.md` · **Sibling-of:** `EXPORT-HYGIENE-FOLLOWUPS-2026-06-29-BRIEF.md` · **Followed-by:** `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md` — §1+§2 EXECUTED 2026-06-29: **§1** PulseDex is the FIRST node to surface `recording.contentId` (signal-frame.js bundled into PulseDex; `pdComputeResult` computes the CORE `SignalFrame.computeContentId`, `pdBuildNodeExport` emits it; the live `calculate()` path also stamps `lastResult.contentId` so app `exportGanglior()` ≡ `compute()` — the render-coverage parity gate; both PulseDex fixtures REGENERATED, only-delta `recording.contentId` = equiv a1610b5737c2 / events e8350499a680) → **flips the parent DONE**. **§2** the discovered `GangliorProvenance.stamp().inputs[].name` PHI leak is CLOSED — `noteInput()` scrubs the name via a byte-faithful MIRROR of `SignalFrame.scrubFilename` (vendor+lane kept, PHI/serial stripped; dedupe key still raw, internal); shared bundled module → fleet-wide re-bundle; GATE-inert (committed fixtures stamp null provenance). All 8 re-bundled; both gates green (+2 Dex-Test-Suite groups: §1 contentId + §2 inputs[].name scrub). §3 (opt-in subject key) + §4 (longitudinal-linking? + HIPAA/GDPR sign-off — product calls for the human) stay open → `EXPORT-IDENTITY-FOLLOWUPS-II-2026-06-29-BRIEF.md`.

# Export identity — follow-ups (what surfaced executing Phases 0–1)

> **Closed in the parent (2026-06-29):** Phase 0 `recording.contentId` — a deterministic, identity-free
> 12-hex content digest (`signalType|t0Ms|kind|payload`, cyrb53 fold, viewer-TZ-independent because it
> folds the numeric floating `t0Ms`, filename-independent because provenance is not folded) is computed
> in `signal-frame.js` `toSignalFrame`, stamped as an OPTIONAL additive field, and accepted-but-not-required
> by `validateFrame`. Phase 1 PHI filename-scrub — `scrubFilename` strips name/serial/date/hex-id from each
> `provenance.files` entry at the ingest boundary, keeping only vendor + lane tag + extension
> (`Jane_Smith_2026-06-12_RR.txt` → `RR.txt`, `Polar_H10_AAAAAAAA_…_RR.txt` → `polar_RR.txt`). New
> `content-id` + `provenance-scrub` Dex-Test-Suite groups (9/9 + 12/12), `signal-frame.js` is loose-loaded
> (Data Unifier / OverDex / test pages), **not bundled → zero app re-bundle, provenance untouched**. Both
> gates green. The parent stays **IN-PROGRESS** (its lifecycle reserves DONE for "≥1 node surfaces
> `contentId`" — Phase 2 below).

---

## §1 — Phase 2: node export adoption of `recording.contentId` (fixture-MOVING, per-node)

The handle exists on the CORE `SignalFrame` but **no node writes `recording.contentId` into its
`ganglior.node-export` yet**. Adopt it opportunistically, one node per pass, when you're touching that
node anyway. Per node: have the export builder (`pdBuildNodeExport` / `oxyBuildNightElement` / …) copy
the frame's `contentId` into `recording.contentId`. This is a **new field IN the export content → it
MOVES fixture bytes** → full per-node ritual (parent §3 Phase 2): re-bundle → `Dex-Test-Suite` green →
read `manifestHash` → update `BUILD-MANIFEST.json` (GATE A) → **regenerate that node's fixtures** by
re-running + re-exporting (never hand-edit) → record the producing `manifestHash` in
`FIXTURE-PROVENANCE.json` (GATE B). Additive: consumers (Integrator) tolerate its absence on legacy
exports. **Done-bar lift:** the moment one node ships `contentId`, the parent's header DONE condition is met.

## §2 — 🔴 DISCOVERED leak (out of the parent's stated scope): `GangliorProvenance.stamp().inputs[].name`

The parent §2.2 scrubbed `SignalFrame.provenance.files`. But a SECOND provenance channel carries the raw
filename into every REAL app export: `ganglior-provenance.js` `noteInput()` captures `file.name` verbatim
into `schema.provenance.inputs[].name` (passively, via the FileReader/Blob read hook). So a PHI-named
capture (`Jane_Smith_…`) or a device serial (`Polar_H10_AAAAAAAA_…`) still rides inside
`schema.provenance.inputs[]` of an app export — the very leak the parent set out to close, via a different
pipe. (The committed PulseDex fixtures are NOT affected — the headless `compute()` path leaves provenance
`null` — so this is invisible to the gates; it only bites real app exports.) **Do:** apply the same
`SignalFrame.scrubFilename` (or an equivalent in `ganglior-provenance.js`) to `inputs[].name` at capture
time. ⚠️ This is in the **bundled** `ganglior-provenance.js` (loaded by every node shell) → it is a
**fleet-wide re-bundle** + it changes export *content* (provenance) → fixture-MOVING on any code-gated
fixture that stamps non-null provenance. Scope it as its own deliberate pass, not folded into a node edit.
Decide first whether to scrub, hash, or drop `inputs[].name` (the `sha256`/`bytes`/`lastModifiedMs` fields
are already identity-free and are the useful part).

## §3 — Phase 3: optional opt-in pseudonymous subject key (product decision first)

Unbuilt by design (parent §2.3 / Phase 3): a random per-subject UUID, generated locally, NEVER derived
from name/DOB, never a device serial, strippable before share/fusion, default OFF. Build only if
longitudinal cross-night linking becomes a product requirement — design the strip-on-share path before any
node writes it.

## §4 — Open product decisions to surface to the human (not for an agent to silently pick)

- **(a)** Is longitudinal cross-night linking wanted at all? (gates §3.)
- **(b)** HIPAA/GDPR applicability — external compliance sign-off. The parent makes the data *more* minimal
  and traceable; it does **not** certify it for a real deployment. This is a compliance call, not a design one.

## Definition of done

`recording.contentId` surfaced by ≥1 node (§1, flips the parent to DONE); the `inputs[].name` leak (§2)
closed or explicitly accepted with a recorded rationale; §3/§4 are product-gated and may stay open.
