<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-29 · **Created:** 2026-06-27 · **Follow-ups:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-2026-06-29-BRIEF.md

# OxyDex `ganglior.node-export` v2.0 Envelope + `ganglior_events[]` Emission

> **One-line:** Make **every** OxyDex export (1 night or 10) a single, schema-validated
> `ganglior.node-export` v2.0 envelope that carries a real `ganglior_events[]` — closing the
> `<3-night` bare-array drift gap and giving the Integrator, the planned self-ingest/doctor view, and
> the provenance gates **one** contract instead of two shapes.

---

## 0. Why this exists (the bug being fixed)

A real OxyDex export (`uploads/OxyDex_2026-06-27_0745_summary.json`, 2 nights) was inspected and is a
**bare per-night JSON array** — top level is `[{night},{night}]` with:
- **no** `schema.name`, **no** `recording.startEpochMs`, **no** `ganglior_events[]`;
- each night carries `t0Ms` (floating ms, e.g. `1782510341000`), `provenance.buildHash`
  (`04d85b8b647d`), `kernel.hash`, and full `stats`/`summary`/`research` blocks.

`oxydex-app.js` (~line 98–111) only wraps the export in the `ganglior.crossnight` envelope at
**≥3 nights**; below that it emits the bare array "byte-identical to before, so no existing consumer
breaks." The Integrator (`integrator-app.js` line 41) runs `CrossNightEnvelope.validateNodeExport`
**only** when `json.schema.name === 'ganglior.node-export'`. A bare array has no `schema`, so it
**skips validation entirely** and falls through to structural ingest. That fork is the drift risk:
the most common real export (1–2 nights) is the *unvalidated* path, and validator errors elsewhere
are pushed to `WARN[]` rather than rejected — so a soft drift can sit invisible.

**Decision (confirmed with user):** wrap **unconditionally**. Collapse the two shapes into one
validated v2.0 envelope. This also unblocks the doctor-summary / self-ingest work (separate brief —
see §7) because there is then exactly one shape to re-ingest.

---

## 1. Target shape — `ganglior.node-export` v2.0 (OxyDex)

```jsonc
{
  "schema": {
    "name": "ganglior.node-export",
    "version": "2.0",
    "node": "OxyDex",
    "nodeVersion": "1.0",
    "multiNight": true,            // true ≥2 nights, still present (false) for 1 night
    "generated": "2026-06-27T11:45:28.936Z",
    "provenance": { "buildHash": "…", … }   // unchanged provenance block
  },
  "recording": {
    "startEpochMs": 1782510341000, // = t0Ms of the FIRST (chronologically earliest) night
    "offsetMin": null              // null unless input carried a real zone (Clock Contract §1)
  },
  "ganglior_events": [ … ],        // NEW — see §2. May be [] but the KEY MUST EXIST
  "crossNight": { … },             // existing ganglior.crossnight block, ONLY when ≥3 nights; omit/than null otherwise
  "nights": [ {night}, {night} ]   // ← the EXISTING per-night array, BYTE-IDENTICAL, untouched
}
```

### Hard back-compat rules (do not violate)
- **`nights[]` per-night objects are frozen.** Do not rename, reorder, or recompute a single field
  inside them. The whole value proposition is "wrapper is additive." Copy the current array in as-is.
- **`recording.startEpochMs` is the FLOATING `t0Ms`** of the earliest night (Clock Contract §1/§6) —
  never a real UTC instant, never `Date.now()`.
- **`ganglior_events` key always present** (emit `[]` rather than omit) so consumers never branch on
  existence.
- **`crossNight`** stays gated at ≥3 nights exactly as today (its aggregate stats need ≥3 to be
  meaningful). The *envelope* is unconditional; the *crossNight block* is not. Don't conflate them.

### ⚠️ The migration hazard — array→object at top level
Any existing consumer that reads `json[0]` / `json.length` / `json.map(...)` **breaks** the moment the
top level becomes an object. **Before changing the emitter, audit + fix every reader:**
1. `integrator-app.js` + its OxyDex adapter (does it index the array, or already destructure?).
2. `oxydex-app.js` self-read paths, if any.
3. Cross-node readers (GlucoDex reads ECGDex JSON today — check none assume OxyDex array shape).
4. **Every committed `uploads/*.json` OxyDex fixture** consumed by `tests/dex-tests.js`,
   `Dex-Test-Suite.html`, `verify-provenance.html`.
   - Provide a **tolerant reader**: accept BOTH `Array.isArray(json)` (legacy) and
     `json.schema?.name==='ganglior.node-export'` (v2.0), normalizing to `nights[]` internally.
     This lets old fixtures keep passing while new exports use the envelope. Put this in the adapter,
     not scattered at call sites.

---

## 2. `ganglior_events[]` — the modeling decision (this is the real work, not a reshape)

OxyDex infers respiratory events from an **SpO₂ proxy** — it does **not** measure airflow. The event
model must stay honest about that. Two distinct impulse types, because the data already separates them:

### 2a. `desat_event` — one per scored desaturation
Source: `desatProfile.events` (already gated `artifact:false`, `pulseValid:1` — use that gate, do not
re-derive). Each becomes one event.

### 2b. `periodic_breathing` — one per PB / Cheyne-Stokes episode
Source: the `oscillations` block (19 episodes in the sample). This is a **pattern across many breaths**,
epistemically weaker than a single scored desat — hence a separate impulse and a lower tier, so the
Integrator can weight it down without throwing it away (19 eps/night IS signal).

### Evidence tier (pull from `OXY_REGISTRY`, never hardcode)
| Event | Tier | Rationale |
|---|---|---|
| `desat_event`, ≥4% depth (ODI4-grade) | **validated** | AASM clinical scoring standard |
| `desat_event`, 3% depth (ODI3-grade)  | **emerging**  | real but softer threshold |
| `periodic_breathing`                   | **experimental** | derived oscillation signature, not a scored event |
| anything                               | **never `measured`** | OxyDex infers from SpO₂ proxy; `measured` would be a unit-severity bug |

- **Tier is a NODE fact** → read it from `OXY_REGISTRY` via `OxyRegistry.idForLabel(...)`. Do **not**
  invent an inline grade — the `cohesion-badges` group in `tests/dex-tests.js` asserts registry≡doc and
  will fail. If a needed metric id has no registry entry yet, ADD it to `oxydex-registry.js` (with its
  `evidence` field) — that's the sanctioned place.

### `conf` ≠ tier (keep the two axes separate)
- **tier** = trust in the *method/category* (from registry, discrete ladder).
- **`conf`** = certainty of *this individual event*, **continuous** `f(depth, duration, recovery)`.
  A 9%-depth desat and a 4%-depth desat are both `validated` but carry different `conf`.
- Suggested `conf`: monotone in depth and recovery-quality, clamped `[0,1]`. Pin the exact formula in
  code with a comment; don't let it silently equal the tier.

### Per-event shape (Clock Contract §6 — write BOTH `t` and `tMs`)
```jsonc
{
  "t": "HH:MM:SS",        // wall-clock, no date — from recording.startEpochMs date + onset offset
  "tMs": 1782511350000,   // absolute FLOATING ms (startEpochMs + offset), rolling past midnight monotonic
  "impulse": "desat_event",   // or "periodic_breathing"
  "node": "OxyDex",
  "conf": 0.72,
  "meta": { "depth": 9, "duration": 29, "recovery": 0, "nadir": 88 }  // PB: meta.cycleLen instead
}
```
- Reconstruct `tMs` from `t0Ms + onset` per Clock Contract §5 (roll the date forward each midnight
  wrap, monotonic via prev-t). New emitters SHOULD write both `t` and `tMs`; the §6 contract requires
  `t`, recommends `tMs`.
- Multi-night export: events from all nights in one chronological `ganglior_events[]`; each event's
  `tMs` already disambiguates which night.

---

## 3. Clock Contract compliance (non-negotiable — verify all)
- `startEpochMs` = floating `t0Ms` of earliest night, never real-UTC, never `now()`.
- Event `tMs` = floating, monotonic across midnight, derived via `Date.UTC`-based math (no
  `new Date(str)` / locale parsing).
- Round-trip: export → re-ingest → identical `tMs` (this becomes a self-ingest test, §7).
- Viewer-timezone independence: re-render under a changed `TZ` → identical clock strings.

---

## 4. Re-bundle + gate sequence (this is a runtime export-shape change — NOT free)
Changing the emitter changes runtime behavior, so the full chain is mandatory. Do it as **its own
deliberate pass**, not folded into anything else:
1. Edit `oxydex-app.js` (emitter) + `oxydex-registry.js` (any new event-metric grades) + the
   Integrator OxyDex adapter (tolerant reader, §1) + `tests/dex-tests.js` (new assertions, §5).
   **Edit the `.js` + `.src.html`, never the bundled `.html`.**
2. **Re-bundle** `OxyDex` via the inliner.
3. **Update `BUILD-MANIFEST.json`** — read OxyDex's new `manifestHash` off `verify-provenance.html`'s
   manifest column and commit it (GATE A hard-fails on stale/missing).
4. **Regenerate OxyDex fixtures** by re-running the app on its inputs and re-exporting (never
   hand-edit), then record the producing bundle's `manifestHash` in `FIXTURE-PROVENANCE.json` (GATE B).
5. **`Dex-Test-Suite.html`** → wait ~3s → `#summary` must be all-green.
6. **`verify-provenance.html`** → no red verdicts; confirm `manifestHash` moved (it will — a JS change
   moves `manifestHash` even though `buildHash` may not).
7. Only then flip this brief's header to `Status: DONE — <date>` and update `DOCS-INDEX.md`.

> Note: `buildHash` likely will NOT move (the emitter is external `*-app.js`, not an inline shell
> `<script>`). That's expected per CLAUDE.md — trust `manifestHash`/GATE A as the real code signal.

---

## 5. Tests to add (the contract guard)
In `tests/dex-tests.js` (shared — runs in both `run-tests.mjs` and `Dex-Test-Suite.html`):
1. **Envelope schema:** a v2.0 OxyDex export has `schema.name==='ganglior.node-export'`,
   `version:'2.0'`, `recording.startEpochMs` numeric, `ganglior_events` is an array (key present).
2. **`validateNodeExport` passes** on a freshly produced OxyDex export with zero errors.
3. **Tolerant reader:** adapter normalizes BOTH a legacy bare array AND a v2.0 envelope to the same
   internal `nights[]`.
4. **Event tiers:** every emitted `desat_event`/`periodic_breathing` resolves a registry grade via
   `OxyRegistry.idForLabel`, and none is `measured`.
5. **Round-trip `tMs`:** export → re-ingest → identical `tMs` (Clock Contract).
6. **`conf` ≠ tier:** two events of the same tier with different depth have different `conf`.

---

## 6. Done when
- [ ] All OxyDex exports (1..N nights) are a single `ganglior.node-export` v2.0 envelope; `nights[]`
      byte-identical to legacy per-night objects.
- [ ] `ganglior_events[]` populated with `desat_event` + `periodic_breathing`, tiers from registry,
      `conf` continuous, both `t` and `tMs` present and Clock-Contract-correct.
- [ ] Integrator (+ all readers + fixtures) tolerant of array-legacy AND envelope; no array-index
      breakage.
- [ ] `Dex-Test-Suite.html` all-green (incl. §5 new tests); `verify-provenance.html` clean;
      `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated; `manifestHash` moved.
- [ ] This header flipped to DONE; `DOCS-INDEX.md` synced.

---

## 7. Follow-ups / linked work (do NOT do here)
- **Self-ingest / doctor-summary view** — separate brief `SELF-INGEST-2026-06-27-BRIEF.md` (PROPOSED):
  each `<node>-app.js` gains `loadOwnExport()` (guarded `schema.node===self`) that restores the
  **derived/event layer only** (review mode — raw waveform panels greyed, not faked), renders a clean
  **clinical summary** (findings/KPIs/event timeline + evidence badges, print/PDF-able) for "bring to
  doctor without the raw dataset," and **preserves** original provenance + tiers on reload (no
  recompute, no badge upgrade, no `buildHash` re-stamp). This envelope brief is its prerequisite (one
  shape to re-ingest). **Privacy:** node-export is de-raw'd but NOT de-identified — carries device
  serials (`O2Ring S 2100…`) + provenance; add an optional **scrub-on-export** toggle for clinical
  sharing.
- **Roll the same v2.0-envelope-unconditional treatment to the other nodes** (ECGDex, HRVDex,
  PulseDex, GlucoDex, CPAPDex) once OxyDex proves the pattern — separate follow-up brief; do not
  batch-change all nodes blind.
- **Decide `desat_event` impulse semantics vs the existing `autonomic_surge`** the Integrator's
  synthetic generator emits (`integrator-app.js` ~line 290) — align the vocabulary so fusion treats
  OxyDex-real and synthetic events consistently. Capture in the per-node rollout brief.

---

## Execution note (2026-06-29)

Executed as its own deliberate pass. **Result:** all acceptance items met; both gates green.

**What shipped:**
- `oxydex-app.js` `exportJSON` — wraps **unconditionally** in the `ganglior.node-export` v2.0 envelope
  (`schema` / `recording.startEpochMs` = floating `t0Ms` of earliest night / `ganglior_events[]` /
  `crossNight` (null below 3 nights) / `nights[]` byte-identical). The old `<3`-night bare-array branch
  is gone.
- `oxydex-dsp.js` — NEW shared `oxyBuildGangliorEvents(nightsChrono)` (used by **both** `exportJSON`
  and `OxyDex.compute`, so the two paths can't drift) emitting `desat_event` (per non-artifact
  `desatProfile.events`) + `periodic_breathing` (per oscillation episode), each with `t`+`tMs`
  (Clock Contract §6) and a **continuous** `conf` (`oxyDesatConf`/`oxyPBConf`, pinned, ≠ tier).
  `detectOscillations` now retains per-episode onsets; they ride `night_obj.oscEpisodes` (stripped off
  `n.osc`) so the per-night export element is **byte-identical** (`oxyBuildNightElement` untouched).
  `OxyDex.compute` now carries `ganglior_events`.
- `oxydex-registry.js` — NEW `periodicBreathing` grade = **experimental** (+ resolver aliases). Tier is a
  node fact; consumers resolve `desat_event`→`odi4`/`odi3` (validated/emerging), `periodic_breathing`→
  `periodicBreathing` (experimental); **never `measured`**.
- `integrator-dsp.js` — `adaptOxyDex` consumes the **authoritative top-level** `ganglior_events[]`
  (partitioned to nights by window, used verbatim → round-trip `tMs` identity), with the legacy
  bare-array→synthesis fallback intact (tolerant reader). `fuseApneaEvents` gathers `desat_event`
  alongside `spo2_desaturation` so OxyDex desats still confirm apnea. `desatCount` counts both.
- `tests/dex-tests.js` — NEW group **"OxyDex node-export v2.0 envelope + ganglior_events"** (20 asserts,
  runs in BOTH runners) covering §5 1–6 on a deterministic hand-built O2Ring CSV.

**Gates:** Dex-Test-Suite all-green **1477/93** (incl. the new group 20/20); `verify-provenance`
**GATE A 8/8** + **GATE B clean**. External-JS-only edit → OxyDex re-bundled
`c696fe73a6a9 → 41df56c485db`; **buildHash `04d85b8b647d` UNCHANGED** (as CLAUDE.md predicts).
EXPORT-INERT for the per-night element (events are top-level only; `nights[0]` ≡ the equiv fixture),
so the 2 OxyDex fixtures were **re-recorded, not regenerated** (`BUILD-MANIFEST.json` +
`FIXTURE-PROVENANCE.json` updated).

**Deferred → `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-2026-06-29-BRIEF.md`:** the §7 impulse-vocabulary
reconciliation (now with concrete findings), the dropped synthesized `autonomic_arousal`, OxyDex
`periodic_breathing` fusion semantics, an other-node unconditional-envelope conformance audit, and the
historical bare-array loose samples.
