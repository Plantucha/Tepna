<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-06-27 · **Authored:** 2026-06-29 (the concept was specced in `OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27-BRIEF.md §7` on 06-27; filename frozen to that cross-reference) · **Prerequisite:** `OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27-BRIEF.md` (DONE — one shape to re-ingest)

# Self-ingest / doctor-summary view — reload a node's OWN export as a clinical summary

> **One-line:** Let a user re-load a node's own `ganglior.node-export` JSON back into that node's app to
> get a clean, print/PDF-able **clinical summary** (findings · KPIs · event timeline · evidence badges)
> to **bring to a doctor without the raw dataset** — faithfully showing what was computed *at export
> time*, **never recomputing, re-grading, or re-stamping**. The v2.0 envelope (just shipped) is the
> prerequisite: there is now exactly **one shape** to re-ingest.

---

## 0. Why this exists + the now-concrete gap

**The use case.** A node-export is **de-raw'd** — it carries the derived/summary layer + the
`ganglior_events[]`, but **not** the per-second waveform (a night's raw O2Ring CSV is ~750 KB / 26 k
rows; the export is a few KB). That is exactly what you want to hand a clinician: the findings, not the
firehose. Today there is **no first-class way** to turn an export back into a readable clinical view —
the export is a fusion/archive artifact, not a patient-facing summary.

**The gap is now concrete (verify, don't trust — confirmed 2026-06-29).** OxyDex's existing self-import
(`oxydex-dsp.js` `parseJSONL`, reached from `handleFiles`) reloads the **legacy bare-night-array**
export and a **single night-object** (`JSON.parse(text); if(single.date)…`), but **NOT** the new v2.0
`ganglior.node-export` **envelope**: the envelope starts with `{`, has **no top-level `date`/`stats`**
(those live in `nights[]`), and `parseJSONL`'s array-flatten branch only fires on a leading `[`. **So
the envelope this fleet now emits is not self-reloadable into its own app.** This brief closes that —
and makes it a *clinical view*, not just a reload.

**Unblocked by the envelope.** Because every export is now ONE validated shape (`schema.name`,
`recording.startEpochMs`, `ganglior_events[]`, `nights[]`/per-node carrier), the loader has one contract
to read instead of forking on array-vs-object.

---

## 1. The contract — `loadOwnExport(json)` per `<node>-app.js`

Extend the **existing** JSON-drop path (do **not** build a parallel importer): when `handleFiles` /
the file-drop sees a parsed JSON object that is a node-export, route it to `loadOwnExport`.

- **Detect:** `json && json.schema && json.schema.name === 'ganglior.node-export'`.
- **Guard `schema.node === <ThisNode>`.** A node only re-ingests its **own** kind. A foreign export
  (`schema.node !== self`) is **rejected with a helpful message**, not mis-loaded:
  *"This is an ECGDex export — open it in ECGDex, or drop it into the Integrator to fuse."* (Mirrors the
  Integrator's `detectNode`; never silently coerce.)
- **Unwrap to the derived layer.** Read the per-node carrier (`json.nights[]` for OxyDex/CPAPDex,
  `json.recordings[]` for ECGDex/PulseDex, `json.sessions[]` for PpgDex; a single-record export is the
  object itself). Each element is the **unchanged per-night/-recording summary** — feed it to the node's
  **existing** per-element reconstruction (OxyDex: the `parseJSONL` night-rebuild, which already
  requires `obj.date && obj.stats` — the envelope's `nights[]` elements carry both). The top-level
  `ganglior_events[]` is the event timeline.
- **Mark the loaded state `reviewMode = true`** (see §2) and **stash the export's provenance** (see §3)
  — do not discard them by re-rendering through the fresh-analysis path.

**Acceptance:** dropping a node's own freshly-exported JSON back into it renders the dashboard populated
from the export, in review mode, with the export's provenance shown.

## 2. Review mode — raw panels GREYED, never faked

The export has the **derived** layer but **not** the raw signal. So on reload:

- **Render fully** everything that needs only the summary: KPIs, findings/flags, per-metric cards (with
  their evidence badges), the desaturation/event **timeline** (from `ganglior_events[]` + the
  per-element summary), HRV/desat-profile/composite tables — these are all in the export.
- **Grey + label** every panel that needs per-second samples (the SpO₂/HR **trend charts**, the
  oscillation waveform, any per-sample scrubber): show a non-faked placeholder —
  *"Raw signal not included in this export — review mode. Re-run the original recording for waveforms."*
  **Never interpolate or fabricate** a chart from summary stats. A greyed panel is honest; a fake one is
  a clinical-integrity bug.
- A persistent **review-mode banner**: *"Loaded from export · review mode · not recomputed · built
  <export buildHash> on <export generated>."*

**Acceptance:** no chart that requires raw samples renders with invented data; each is explicitly greyed
with a reason.

## 3. Provenance + tier preservation — the honesty core (no recompute · no upgrade · no re-stamp)

A reloaded export is a **faithful VIEW of a past computation**, stamped with the build that made it —
**not** a fresh computation. Therefore:

- **No recompute from raw** (there is none) — render the export's **stored values verbatim**. Where the
  existing reconstruction derives a display field from stored scalars (OxyDex `parseJSONL` recomputes
  MOS/AHI from stored components "no raw rows needed"), that is acceptable **only** because it is
  deterministic and reproduces the stored value; **prefer the stored value** and treat any divergence as
  a bug surfaced in review mode, never silently shown.
- **No badge upgrade.** Evidence badges are resolved from `metric-registry.js` (registry = code, stable
  tier), so they don't drift on reload by construction — but **do not** let a reload *raise* a tier (e.g.
  an export that carried `experimental` must not display `validated` because the current registry
  changed). Show the **export's** evidence where the export embeds it (the `crossNight` block carries
  per-metric `evidence`); otherwise the registry tier, which must equal it.
- **No `buildHash` re-stamp.** Show `json.schema.provenance` (`buildHash`, `generated`, `inputs`) +
  `json.kernel` **verbatim** as the provenance of THIS view. The reloaded view must **not** call
  `GangliorProvenance.stamp()` (that would stamp the *current* build over the original). If the user
  re-EXPORTS from review mode, that is a new artifact — but the default is view-only; a re-export must
  carry a `derivedFrom: <original buildHash/contentId>` rather than masquerading as a fresh computation.

**Acceptance:** the provenance shown after reload equals the export's; the current app `buildHash` is
**not** written over it; tiers shown equal the tiers the export carried.

## 4. The clinical "bring-to-doctor" summary (print / PDF)

Reuse the existing render + the suite's print path (`entrance-guard.js` already fixed blank-on-print;
each node has print CSS). Add a **focused clinical layout** that the review-mode view can print:

- **Header:** node + recording date(s) + duration + the **provenance stamp** (build + generated) so a
  clinician knows what produced it.
- **Findings / flags** first (the `flags[]` + the headline impression), then **KPIs** (the basic-tier
  metrics: ODI, mean/min SpO₂, T90, hypoxic burden…), then the **event timeline** (desaturations /
  periodic-breathing / surges from `ganglior_events[]`), each with its **evidence badge** so the
  epistemic weight is visible (a `measured` mean-SpO₂ vs an `experimental` composite reads differently).
- **Intended-use disclaimer** (BRIEF §6.5 health disclaimer + the `dxl-` license stamp) on the printed
  page — this is a wellness tool, not a diagnostic device.
- A **"Save as PDF / Print"** affordance prominent in review mode.

**Acceptance:** review mode prints to a one/two-page clinical summary with findings + KPIs + event
timeline + badges + provenance + disclaimer; no raw-chart whitespace.

## 5. Privacy — scrub-on-export toggle (de-raw'd ≠ de-identified)

The node-export is de-raw'd but **NOT de-identified**: `schema.provenance.inputs[].name` carries the
**device serial** (e.g. `"O2Ring S 2100_20260612230016.csv"`), plus `inputs[].sha256` and (where
adopted) `recording.contentId`. For clinical sharing, add an **optional "scrub for sharing" toggle** on
export (and a scrub-on-reexport in review mode):

- **Strip / replace:** `inputs[].name` → a generic label or the identity-free `recording.contentId`
  (the EXPORT-IDENTITY handle — leverage it, don't reinvent); drop `inputs[].sha256`; drop any device
  serial / model string not needed clinically.
- **Keep:** the clinical summary + events + tiers + a **coarse build stamp** (so provenance integrity
  survives) + `contentId` (identity-free, lets a clinician's copy still be matched to the original
  without exposing the device).
- **Default OFF** (the normal export keeps full provenance for the user's own archive + Integrator
  fusion); the toggle is an explicit "share with my doctor" action.
- Cross-reference `EXPORT-IDENTITY-2026-06-27-BRIEF.md` — `contentId` is the de-identified anchor this
  scrub should pivot on; align rather than duplicate.

**Acceptance:** with scrub ON, the exported JSON contains no device serial / filename / input sha256, but
still carries `contentId` + a coarse build stamp + the full clinical summary.

## 6. Scope — pilot OxyDex, roll-out is a follow-up

- **Pilot: OxyDex** (the envelope brief's node; richest summary; the `parseJSONL` reconstruction to
  extend already exists). Implement §1–§5 for OxyDex, gate it, re-bundle OxyDex.
- **Design `loadOwnExport` generically** (the guard + unwrap + review-mode + provenance-preserve pattern
  is node-agnostic; only the per-element reconstruction is node-specific) so the roll-out to
  ECGDex/PulseDex/HRVDex/GlucoDex/PpgDex/CPAPDex is mechanical — but **do not** batch-change them here.
  Roll-out = a separate `-FOLLOWUPS` brief (one node per pass, each re-bundle-gated).

## 7. Tests (the contract guard — add to `tests/dex-tests.js`, both runners)

1. **Round-trip self-ingest:** OxyDex.compute(input) → envelope → `loadOwnExport(envelope)` reconstructs
   the same `nights[]` values + the same `ganglior_events[]` `tMs` (extends the parent §5 round-trip).
2. **Faithful view (no recompute drift):** the values shown after reload **equal** the export's stored
   values (deep-diff the reconstructed night vs `envelope.nights[0]`, vol/provenance excluded).
3. **Provenance preserved:** after reload, the view's provenance == `envelope.schema.provenance`
   (buildHash/generated/inputs) and the current `GangliorProvenance.stamp()` was **not** written over it.
4. **Tier preserved (no upgrade):** an export carrying an `experimental` metric still displays
   `experimental` after reload even if the registry tier is bumped in-test.
5. **Review-mode not faked:** a reloaded export marks raw-chart panels greyed (`reviewMode` true, no
   fabricated series).
6. **Foreign-node guard:** `loadOwnExport` on an ECGDex export inside OxyDex is rejected with the
   redirect message, not loaded.
7. **Scrub:** scrub-ON export has no `inputs[].name`/`sha256`/serial, but retains `contentId` + summary.

## 8. Done when
- [ ] Dropping a node's OWN v2.0 envelope into it loads a populated dashboard in **review mode** (raw
      panels greyed, never faked); a foreign export is rejected with a redirect message.
- [ ] **No recompute / no badge upgrade / no `buildHash` re-stamp** — the view shows the export's stored
      values, tiers, and provenance verbatim; review-mode re-export stamps `derivedFrom`.
- [ ] A **print/PDF clinical summary** (findings · KPIs · event timeline · badges · provenance ·
      disclaimer) renders with no raw-chart whitespace.
- [ ] **Scrub-for-sharing** toggle strips device serials / filenames / input sha256 while keeping
      `contentId` + a coarse build stamp + the clinical summary.
- [ ] OxyDex pilot only; §7 tests green in both runners; OxyDex re-bundled; both gates clean.

## 9. Gates + re-bundle ritual
This touches `oxydex-app.js` (loadOwnExport, review-mode chrome, scrub toggle) + likely `oxydex-dsp.js`
(envelope-unwrap in/around `parseJSONL`) + `oxydex-render.js` (review-mode greying + clinical print
layout) — all **external JS** → re-bundle OxyDex (buildHash likely unchanged; `manifestHash` moves).
Update `BUILD-MANIFEST.json` (GATE A). The OxyDex fixtures are **export-inert** if the EXPORT shape
doesn't change (this brief is about RE-INGEST, not emit) → re-record `manifestHash` in
`FIXTURE-PROVENANCE.json`, do **not** regenerate. `Dex-Test-Suite.html` all-green (incl. §7);
`verify-provenance.html` GATE A/B clean. **Do not let a reload path call `GangliorProvenance.stamp()`** —
that is the one change that would silently move provenance.

## 10. Follow-ups / linked work
- **Roll-out** `loadOwnExport` to the other six nodes (one per pass, re-bundle-gated) — separate
  `-FOLLOWUPS` brief once OxyDex proves the pattern.
- **`EXPORT-IDENTITY` alignment:** the scrub toggle pivots on `recording.contentId`; coordinate with the
  EXPORT-IDENTITY follow-ups so contentId is present on the nodes that gain scrub.
- **Integrator review-mode:** the Integrator already ingests exports for fusion; a "load my fused export
  as a read-only clinical summary" is the multi-node analog — out of scope here, note as a future idea.
