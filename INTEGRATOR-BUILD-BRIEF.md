<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Integrator (Ganglior Fusion Layer)

> **Goal for the AI coder:** build **Integrator** — a new single-file, 100%-local app that ingests
> the JSON exports of the `-Dex` nodes, **co-registers them on the one shared floating wall-clock**,
> and surfaces *cross-signal findings no single node can claim alone* (e.g. an apnea event confirmed
> by BOTH an ECGDex autonomic surge AND an OxyDex O₂ desaturation at the same wall-clock minute).
> It is the realization of the "Ganglior" bus: nodes emit events, the Integrator correlates them.
>
> **This is now unblocked** because all five apps agree on `tMs` (UTC-normalized floating wall-clock
> ms) to the millisecond. **Read `CLAUDE.md` §"THE CLOCK CONTRACT" first and obey it verbatim** — the
> Integrator lives or dies on the shared timeline being correct.
>
> **Naming note:** the bus is currently **"Ganglior"** but a rename to **"Fascia"** is pending. Put the
> bus name in ONE constant (`const BUS = 'ganglior';`) and read every label/schema/key from it, so the
> rename is a one-line change. Accept the old name on input regardless (see §2.4).

---

## 0. What it is (and is NOT) in v1

- **IS:** a *fusion/orchestration* layer. Drag in 2+ node JSON exports (the apps already did the heavy
  DSP); Integrator normalizes them to a common event/series model, builds a unified timeline, runs a
  small set of well-defined correlation rules, and reports fused findings + an honest overlap report.
- **IS (added — cross-node LONGITUDINAL):** a second, orthogonal axis. Beyond same-night event fusion,
  the Integrator now reads the standardized `ganglior.crossnight` v1.0 envelopes every node emits
  (CROSSNIGHT-ENVELOPE-SPEC.md), persists each node's per-day metric summaries to **IndexedDB**
  (`ganglior_integrator` DB → `summaries`/`metricDefs` stores), and **date-joins them across nodes** on
  the shared floating wall-clock to surface night-to-night trends + cross-signal couplings (e.g. ECGDex
  rMSSD ⟷ OxyDex ODI-4 across weeks). The store is durable — history accumulates across sessions and
  survives reload. See `integrator-longitudinal.js` + the **Longitudinal** view. Strictly additive; the
  fusion layer is untouched. Cross-correlations are exploratory (ranked by |r|, ≥4 shared dates), not
  multiple-comparison corrected, and surfaced as such.
- **IS NOT (defer to v2):** a raw-stream re-analyzer. Do **not** re-ingest raw ECG/CSV/RR and recompute
  metrics — that's each node's job. (v2 "deep Integrator" may ingest raw streams for sub-second
  alignment; out of scope here.) Keep "one signal, one codex; fusion is a separate layer."
- **100% local.** No network, no CDNs. Same privacy posture as every node.

---

## 1. Inherit the platform (REUSE — do not reinvent)

- **Clock contract:** duplicate `parseTimestamp` / `tzOffset` / `fmtClock` / `fmtDate` / `fmtDateTime`
  locally (copy from `ecgdex-app.js` or `pulsedex-dsp.js`). All time is floating `tMs`; display via
  `getUTC*`. This is the single most important rule in the app.
- **Design system:** link **`ans-design.css`** (dark teal/blue: `--teal #3DE0D0`, `--blue #58A6FF`,
  bg `#0B0F14`, surfaces `#121821/#18212C`). Match **PulseDex.html / GlucoDex.html** structure:
  `.app-shell` grid · `.sidebar` (`.logo`, `.sec-label` nav) · `.main-content` (`.topbar`, hero, KPI
  strip, `.chart-card`s, tables) · sticky `#exportBar`. Fonts Inter + IBM Plex Mono (self-host, system
  fallback). The Integrator should look like a sibling node, not a stranger.
- **File architecture:** ship `integrator-dsp.js` (parse/normalize/fuse — no DOM), `integrator-render.js`
  (DOM/charts), `integrator-app.js` (glue/ingest/export), referenced by `Integrator.src.html`. Plain
  global scripts sharing page scope (match the other apps' convention; no ES modules). Then add
  `<template id="__bundler_thumbnail">` and bundle to standalone **`Integrator.html`**.
- **Graphics:** hand-rolled inline-SVG-via-template-string for the timeline & charts (copy PulseDex's
  `lineChartSVG` pattern, ~line 829 of pulsedex-dsp.js). No chart libs needed for v1.

---

## 2. Inputs — node JSON exports (the cross-node currency)

### 2.1 Bus-native today (ingest directly)
- **ECGDex** `ganglior.node-export` v2.0 — `recording.startEpochMs` (= floating `t0Ms`),
  `ganglior_events:[{t,impulse,node,conf,meta?}]`, plus `timeseries`, `apnea`, `cardiorespiratory`,
  `acc`/body-position, `sleepStages`, `reserved`.
- **GlucoDex** `ganglior.node-export` v2.0 — same envelope; events `dawn_surge`, `nocturnal_hypo`,
  `glucose_excursion`, `glucose_autonomic_correlation`; `recording.startEpochMs`, `timeseries`, `fusion`.

### 2.2 Need a thin emit shim FIRST (Phase 0 — small, do before fusion)
These export structured JSON but **lack** the `ganglior_events` array + standardized envelope. Add a
minimal emitter to each (they already compute the underlying events internally):
- **OxyDex** — emit desaturation/ODI nadir events (`spo2_desaturation`, with `meta:{depth,nadir,durSec}`)
  and HR-spike/arousal events (`autonomic_arousal`). It already has `night.t0Ms`, `desat` nadir events,
  and `spikes` with `mfm`. Wrap them as `ganglior_events` with `recording.startEpochMs = night.t0Ms`.
- **PulseDex** — emit `hrv_drop` / `stress_peak` / window-level autonomic events from its windowed
  analysis; it already has `t0Ms`/`offsetMin`/`tsMs[]`. Envelope with `startEpochMs = t0Ms`.
- **HRVDex** — emit per-measurement `hrv_low` / `stress_high` events keyed off `_tMs`;
  `startEpochMs = first row _tMs`.
Keep each emitter ≤ ~30 lines, mirroring `exportGanglior()` in ecgdex-app.js / glucodex-app.js. Use the
shared `BUS` constant and the canonical event shape. **Each event SHOULD also carry absolute `tMs`**
(floating) in addition to the legacy `t:"HH:MM:SS"` string (see §3).

### 2.3 Canonical event shape
```json
{ "tMs": 1780750130389, "t": "08:53:37", "impulse": "autonomic_surge", "node": "ECGDex",
  "conf": 0.82, "meta": { "...": "node-specific" } }
```
`conf` ∈ [0,1] = signal-quality / detection confidence from the emitting node.

### 2.4 Robust ingest (defensive — files are messy)
- Accept a drag-drop / multi-file picker; parse each as JSON; identify the node from `schema.node`
  (fall back to filename, e.g. `ecgdex_*`, `oxydex_*`). Accept `bus:"ganglior"` AND any future
  `bus:"fascia"` value — match case-insensitively on a known set, never reject on bus name.
- Accept BOTH the full node-export and the slim `{bus,node,events}` event-stream export.
- Tolerate missing fields → `null`, never throw. One bad file must not break the others.
- De-dupe: same node + same `startEpochMs` (±30 s) loaded twice ⇒ keep one, warn (mirror OxyDex's
  dup-by-`startTs` logic).

---

## 3. The shared timeline (THE core — get this exactly right)

Every event and series sample must be placed on ONE absolute floating-wall-clock axis (`tMs`).

1. **Per node, establish `t0Ms`** = `recording.startEpochMs` (already floating per the clock contract).
   If absent, fall back to the node's `t0Ms` field, else the earliest event you can reconstruct, else
   mark the node **"date unknown"** and exclude it from absolute alignment (do NOT fabricate).
2. **Reconstruct each event's absolute `tMs`:**
   - If the event already has `tMs` → use it.
   - Else combine the node's `t0Ms` **date** with the event's `t:"HH:MM:SS"`:
     `evMs = Date.UTC(y,mo,d, hh,mm,ss)` where `y/mo/d` come from `new Date(t0Ms).getUTC*`. Then apply
     the **monotonic midnight roll**: while `evMs < t0Ms` (or `< previous event's evMs`), add 86 400 000.
     This is the SAME overnight rule as the parser — reuse it. An overnight ECG starting 22:50 whose
     event reads `02:14` lands on the *next* calendar day.
3. **Series alignment:** node `timeseries` are per-hour/per-day aggregates keyed by minute-from-start
   or by stamp → convert each to absolute `tMs` the same way.
4. **Never sort or align by the `t` string.** Always by absolute `tMs`.

> Sanity gate (assert in dev): re-deriving an event's `tMs` from `t0Ms` + `t` must round-trip to the
> same clock the node displayed. Verify with the bundled ECGDex/GlucoDex sample exports in `uploads/`.

---

## 4. Overlap detection & honesty (do this before claiming any fusion)

The sample captures are often **different nights** (e.g. O2Ring 03/05 vs ECG 06/01) — fusion across
non-overlapping recordings is meaningless and must be refused, loudly but gracefully.

- For each pair of loaded nodes compute the overlap interval `[max(start), min(end)]` on `tMs`.
- **No overlap** → show an amber honesty banner: *"ECGDex (Jun 1, 22:50–05:30) and OxyDex (May 3,
  23:10–06:40) do not overlap — cross-validation unavailable. Showing each node's own events on a
  shared axis; load overlapping nights to enable fusion."* Still render the timeline (each node in its
  own lane) — just don't assert correlations.
- **Overlap present** → run §5. Always print the overlap window + overlap minutes in the findings header.
- **Same-day, different timezone** is the one case where `offsetMin`/`utcMs` matters: if two nodes both
  carry `offsetMin`, you MAY align on real instants (`utcMs = tMs − offsetMin*60000`). Default remains
  wall-clock `tMs`; only switch to `utcMs` when both offsets are present AND they differ.

---

## 5. Fusion rules (v1 — small, explicit, evidence-based; each is a named function)

Each rule scans the overlap window, matches events from different nodes within a time tolerance, and
emits a **fused finding** with a combined confidence and the contributing source events. Default match
tolerance **Δt = ±120 s** (configurable). Combined confidence = a transparent blend, e.g.
`conf_fused = 1 − Π(1 − conf_i)` over contributing events, capped at 0.97; never invent precision.

1. **`fuseApneaEvents` — desat ⟷ autonomic surge (the headline proof case).**
   OxyDex `spo2_desaturation` co-occurring (±Δt) with ECGDex `autonomic_surge`/CVHR surge ⇒
   `confirmed_apnea_event` (neither app alone can claim it). Count → an Integrator-level
   **confirmed AHI/event index** over the overlap hours. Report matched/unmatched on each side
   (desats with no surge = possible central or low-arousal; surges with no desat = non-respiratory arousal).
2. **`labelPositionalApnea` — + ECGDex ACC body-position.**
   For each confirmed apnea event, look up body position (supine/lateral/prone) from ECGDex's
   `acc`/posture series at that `tMs`. Tally supine-vs-non-supine event rate → flag **positional apnea**
   when supine rate ≫ non-supine. (Honest: provisional, ACC-derived.)
3. **`fuseAutonomicGlycemic` — ECGDex autonomic instability ⟷ GlucoDex glycemic variability.**
   Correlate ECGDex `autonomicInstabilitySlope` / nocturnal surge load against GlucoDex overnight
   glucose variability / dawn surge on overlapping nights. Emit `glucose_autonomic_correlation` (this
   *closes the reserved handshake* both nodes already stub — GlucoDex `reserved.autonomicInstabilitySlope`,
   ECGDex `reserved.glucoseCorrelation`). Reuse GlucoDex's `computeFusion` math as the reference.
4. **`fuseHRVConsensus` — PulseDex/HRVDex/ECGDex agreement.**
   Where two HRV sources cover the same window, report agreement/disagreement on RMSSD/SDNN/LF-HF
   (a cross-device QC + a single reconciled autonomic state). Flag large divergence as a data-quality issue.

Make each rule independently skippable when its required nodes aren't loaded. Output a flat list of
fused findings, each: `{ tMs, durSec?, type, conf, nodes:[...], sources:[evRefs], meta, note }`.

---

## 6. Output & exports

- **Fused event stream:** `{ bus: BUS, kind:'fusion', generated, window:{startMs,endMs,overlapMin},
  nodes:[...loaded], findings:[...], unmatched:{...} }` → `integrator_fusion_<date>.json`.
- **Write back the closed handshakes** so nodes can ingest: e.g. a GlucoDex-ready
  `glucose_autonomic_correlation` value and an ECGDex-ready `glucoseCorrelation`. Same `ganglior.*`
  schema family.
- Times in any exported string field via `fmtDateTime` (UTC getters). Absolute `tMs` on every finding.

---

## 7. UI (reuse the node look)

- **Sidebar:** logo ("Integrator · Fusion Layer"), nav: Load · Timeline · Findings · Per-pair · Export.
- **Load zone:** multi-file drop ("drop 2+ -Dex JSON exports"); a chip per loaded node showing
  node · date · window · #events; clear-all.
- **Hero / honesty header:** overlap window + minutes, or the amber "no overlap" banner (§4).
- **Unified timeline (centerpiece):** a horizontal `tMs` axis with one **swimlane per node**; event
  ticks colored by node, sized by `conf`; **fused findings drawn as vertical bands** spanning the lanes
  they connect (e.g. a confirmed-apnea band touching the OxyDex and ECGDex lanes). Hover → tooltip with
  clock + impulse + conf + contributing nodes. Canvas only if an axis exceeds a few thousand ticks;
  otherwise inline SVG.
- **Findings cards:** one per fused finding type (confirmed apnea index, positional flag,
  autonomic⟷glycemic r, HRV consensus), each with the honest caveat and the source events.
- **Full findings table** + sticky `#exportBar` (JSON export, copy).
- Light theme + mobile inherited from `ans-design.css`.

---

## 8. Verification (non-negotiable)

1. **Timeline correctness:** load the bundled ECGDex + GlucoDex sample exports from `uploads/`;
   confirm each event's reconstructed `tMs` matches the clock it shows in the source app exactly, and
   overnight events roll past midnight monotonically (no 24 h jump, no negative deltas).
2. **Viewer-timezone independence:** re-render under a changed `TZ` (or override `getTimezoneOffset`) →
   identical clocks and identical fusion results.
3. **No-overlap honesty:** two non-overlapping nights ⇒ banner shown, NO fused findings asserted,
   timeline still renders each lane.
4. **Overlap fusion:** construct/obtain two overlapping nights (or synthesize aligned events) ⇒
   desat⟷surge pairs become `confirmed_apnea_event`s; unmatched events reported on both sides.
5. **Robustness:** a malformed/empty/foreign JSON is skipped with a warning; other files still load.
6. **Round-trip:** export the fusion JSON, reload it — values stable.
7. **Bundle:** add the thumbnail, bundle `Integrator.src.html → Integrator.html`, confirm the
   standalone matches and has no console errors.

---

## 9. Suggested build order

1. **Phase 0:** add the `ganglior_events` + `startEpochMs` emit shim to OxyDex, PulseDex, HRVDex
   (§2.2) so all five are first-class on the bus. Re-bundle those three.
2. Ingest + per-node adapter → normalized `{node, t0Ms, events[], series}` model (§2–3). Prove
   timeline reconstruction on the sample exports (§8.1).
3. Overlap detection + honesty banners (§4).
4. `fuseApneaEvents` + `labelPositionalApnea` (the headline) → findings model + timeline bands.
5. `fuseAutonomicGlycemic` (close the existing reserved handshake) + `fuseHRVConsensus`.
6. Export + write-back; full UI polish; bundle + verify.

---

## 10. Done criteria

- Loads ≥2 node JSON exports, places all events/series on one floating-`tMs` axis, viewer-timezone-independent.
- Refuses to assert fusion across non-overlapping recordings (honest banner) but still visualizes them.
- On overlapping nights: emits confirmed cross-signal findings (apnea desat⟷surge at minimum) with
  transparent combined confidence and source attribution; labels positional apnea via ACC.
- Closes the autonomic⟷glycemic reserved handshake both ECGDex and GlucoDex already stub.
- Single-file, 100% local, `ans-design.css` look, bus name in one constant, standalone bundled as `Integrator.html`.
