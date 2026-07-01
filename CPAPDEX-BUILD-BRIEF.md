<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-06-28 · **Created:** (undated — predates the dated-brief convention) · CPAPDex is built, bundled (`CPAPDex.html`), and Phase-9-migrated (adapter→emit→export: `CPAPDex.compute` + the `cpap` SignalSpec + `signal-orchestrate` emit). Both gates green: `Dex-Test-Suite.html` all-green (incl. the node's EDF/DSP self-tests + render-coverage + co-import groups) · `verify-provenance.html` GATE A 8/8. The Phase-9 emit leg (node 4/4) + its residue are tracked in `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` + `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md`.

# Build Brief — CPAPDex (ResMed AirSense 11 PAP analyzer)

> **For a fresh AI coder (Claude Code preferred for the build).** Read `CLAUDE.md` first — especially
> **THE CLOCK CONTRACT** — then this brief, then **ONE existing node to clone**: OxyDex is the closest
> analog (`oxydex-dsp.js` + `oxydex-render.js` + `oxydex-fusion.js` + `OxyDex.src.html`) — it already
> does respiratory/apnea + oximetry + fusion + cohesion tiering. Everything is decided below; do not
> re-litigate. This brief exists so you spend tokens building, not re-deriving.
>
> CPAPDex is a **new afferent node** (see `LEXICON.md`): it senses ONE class of signal — **positive-
> airway-pressure therapy** — and emits `ganglior_events` + a `ganglior.node-export`, like every -Dex.

---

## START HERE (bootstrap)

**What it is.** The analyzer for a ResMed AirSense 11 nightly download. It turns the device's EDF
signal set into therapy metrics (AHI, leak, pressure, ventilation, flow limitation, snore, periodic
breathing) plus an oximetry QC lane, and publishes machine-scored respiratory events as the
**highest-authority apnea source** in the suite.

**The data (probed — what AirSense 11 writes per session):**

| EDF file | rec × dur | signals (sample/rec) | meaning |
|---|---|---|---|
| `*_BRP.edf` | N × 60 s | **Flow.40ms** (1500), **Press.40ms** (1500) | **25 Hz** flow + pressure waveforms |
| `*_PLD.edf` | N × 60 s | MaskPress, Press, EprPress, **Leak**, **RespRate**, **TidVol**, **MinVent**, **Snore**, **FlowLim** (30 ea) | **0.5 Hz** detail |
| `*_SA2.edf` | N × 60 s | **Pulse.1s** (60), **SpO2.1s** (60) | **1 Hz** oximetry (bpm, %) |
| `*_EVE.edf` | annotations | EDF Annotations (TALs) | device-**scored** apnea / hypopnea / RERA |
| `*_CSL.edf` | annotations | EDF Annotations (TALs) | Cheyne-Stokes / periodic-breathing spans |

**The ONE new capability: an EDF/EDF+ binary reader** (`cpapdex-edf.js`). Nothing else in the suite
reads EDF — all other parsers are CSV/TXT/JSON. Dependency-free, 100% local. Spec in §1. Everything
downstream clones existing nodes.

**Two sessions per night.** A night writes >1 file set (mask off, mask back on). Treat as **one night,
N sessions, one off-mask gap** — not two nights. Spec in §2.

> ### 🔒 INHERITED CONTRACTS (non-negotiable — CLAUDE.md + HANDOFF.md win on any conflict)
> - **Clock Contract:** floating wall-clock `tMs` via `Date.UTC(...)`, read back with `getUTC*`. A
>   missing stamp is `null`, NEVER `new Date()`/now(). Mirror `parseTimestamp` locally (do not extract
>   a shared util). §2 maps EDF time onto this.
> - **Build rule:** edit `cpapdex-*.js` + `CPAPDex.src.html`; **never** the bundled `CPAPDex.html`;
>   re-bundle via the inliner after every change. 100% local, system-font stacks only, no CDN.
> - **Provenance (R1):** load `ganglior-provenance.js` FIRST; it stamps `schema.provenance` and
>   fingerprints inputs via the passive FileReader hook. Don't remove it; don't add a CDN.
> - **Fusion gate (R4):** the apnea match window `LEAD=15 / TRAIL=60` (seconds) is duplicated in
>   `oxydex-fusion.js` and `integrator-dsp.js` and MUST stay identical. CPAPDex adds a *source class*
>   to this gate (§6); it does NOT change the numbers.
> - **Confidence ≠ quality (R7):** `conf` = severity/likelihood; `sqi` rides alongside as a separate
>   axis; the Integrator attenuates via `effConf = conf × (sqi ?? 1)`. CPAPDex's `sqi` comes from
>   leak/signal quality, NOT event severity.
> - **Cohesion (System-Cohesion brief):** born cohesion-native — metric registry, disclosure tiers,
>   evidence badges (bottom-right card corner), epistemic hierarchy, shared lexicon. §5.

---

## Locked decisions (approved — do not reopen)

1. **Independence.** CPAPDex runs **fully standalone** — a user with only a CPAP and nothing else gets
   a complete analysis. No cross-node import is required for it to work. It never *depends* on OxyDex,
   ECGDex, etc.; it only *publishes* events the Integrator may later fuse.
2. **Per-signal authority, quality-gated (no global "best device").** Authority is per-signal and a
   gold source **yields to a clean backup when its own quality gate trips**. Matrix in §6.
3. **CPAP owns therapy + respiratory; co-owns oximetry.** CPAPDex is authoritative for AHI, leak,
   pressure, ventilation, flow-limitation, snore, periodic breathing. Its SA2 oximetry is a
   **self-contained QC lane** — a peer of the O2Ring, tie-broken per-epoch by signal quality. OxyDex
   remains the authority for standalone oximetry when it is present and clean.
4. **Device-scored events are top apnea tier.** EVE/CSL annotations are direct airflow measurement —
   they **validate-or-replace** the Integrator's *inferred* apnea (OxyDex desat + ECG surge). §6.
5. **Oximeter self-gate (the squeeze-artifact lesson).** Any desat coincident with the oximeter's own
   perfusion/SQI collapse is flagged artifact **from one device alone** — see `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md` and §4.4. The CPAP's integrated SA2 is just as displacement-prone as a
   finger ring, so CPAPDex needs this on day one.

---

## §1 — The EDF reader (`cpapdex-edf.js`)

EDF/EDF+ is a fixed-layout binary format. Write a pure-JS decoder over an `ArrayBuffer` — no library,
no network. Decode in a Web Worker if the BRP waveform (25 Hz × full night) janks the UI; otherwise
main-thread chunked is fine.

**Header (ASCII, fixed offsets):**
- `[0:8]` version · `[8:88]` patient · `[88:168]` recording · `[168:176]` startdate `dd.mm.yy` ·
  `[176:184]` starttime `hh.mm.ss` · `[184:192]` header bytes · `[236:244]` **num data records**
  (may be `-1` ⇒ compute from file size) · `[244:252]` **record duration (s)** · `[252:256]` **ns**.
- Per-signal arrays, each `ns` × field, in this order: label(16) · transducer(80) · physDim(8) ·
  **physMin(8)** · **physMax(8)** · **digMin(8)** · **digMax(8)** · prefilter(80) · **samples/rec(8)** ·
  reserved(32).

**Sample decode:** little-endian **int16** per sample. Scale to physical units:
`phys = (dig − digMin) × (physMax − physMin) / (digMax − digMin) + physMin`. Concatenate records per
signal → one Float32Array per channel + its sample rate `= samplesPerRec / recDur`.

**EDF+ annotations (EVE/CSL):** the `EDF Annotations` channel is **not** int16 — it is UTF-8 **TALs**
(Time-stamped Annotation Lists): `+<onset>\x15<duration>\x14<text>\x14\x00`, onset/duration in
seconds (float, ASCII), `\x14` = `0x14`, `\x15` = `0x15`. Parse every TAL in every record. Map each to
`{ onsetSec, durSec, text }`; classify `text` → `Obstructive Apnea | Central Apnea | Hypopnea | RERA |
Cheyne-Stokes | PeriodicBreathing | Unclassified`.

**Output of the reader:** `{ startDate, startTime, signals: { Flow:{data,fs,dim}, Press:…, Leak:…,
RespRate:…, TidVol:…, MinVent:…, Snore:…, FlowLim:…, Pulse:…, SpO2:… }, annotations:[…] }` per file;
the app merges the file set of one session by matched timestamp prefix.

**Robustness:** tolerate `numRecords = -1`; tolerate a truncated final record (last write cut off by
power loss — the H10-battery-death class of event); CRC channels may be ignored. Never throw on a
short file — surface "partial session, M of N records" in the UI.

## §2 — Clock mapping (Clock Contract compliance)

EDF startdate/starttime is **local civil time, no zone** → exactly the contract's case §3 of
`parseTimestamp`. Compute the floating anchor directly:

```js
// startdate "dd.mm.yy", starttime "hh.mm.ss"  (EDF clipping: yy 85..99 ⇒ 19xx else 20xx)
const t0Ms = Date.UTC(2000+yy, mm-1, dd, hh, mi, ss);   // floating — NOT a real UTC instant
const tMs  = t0Ms + recordIndex*recDurMs + sampleIndex*(1000/fs);
```

- `offsetMin = null` (EDF carries no zone). `dateAnchorMs = Date.UTC(2000+yy, mm-1, dd)`.
- Display via `fmtClock/fmtDate/fmtDateTime` using `getUTC*` only — same helpers as OxyDex.
- **Sessions:** each file-set prefix `YYYYMMDD_HHMMSS_` is one session with its own `t0Ms`. The night
  object holds `sessions:[{t0Ms, durMin, …}]`, a night `t0Ms` = first session's, and an **off-mask gap**
  = next session `t0Ms` − prev session end. Overnight 22:00→06:00 stays monotonic (no 24 h jump) by
  construction. Verify per the Clock Contract round-trip checklist.
- **Filename 14-digit** `YYYYMMDDHHMMSS` is the secondary `dateAnchorMs` source if a header is corrupt.

## §3 — Metrics to compute (the full surface)

All per-night AND per-session. Every metric is a registry entry (§5) with `tier`, `evidence`, `cite`.

**Therapy / respiratory (CPAP-authoritative):**
- **AHI** = (apneas + hypopneas) / hours of therapy. Also **oAHI** (obstructive), **cAHI** (central),
  **AHI by hour** (sparkline). Source: EVE annotations (device-scored) — top tier.
- **RERA index**, **Periodic-breathing / Cheyne-Stokes %** (CSL spans / total time).
- **Leak:** median, 95th pct, **% time above large-leak threshold** (24 L/min ResMed default), max.
  Leak quality drives `sqi` (§4.3).
- **Pressure:** median, 95th pct, max; **EPR** delta (Press − EprPress); CPAP vs APAP detection
  (pressure variance). 
- **Ventilation:** RespRate (median/range), TidVol (median), MinVent (median), **minute-ventilation
  stability**.
- **Flow limitation:** mean FlowLim, % time flow-limited (FlowLim > 0.3).
- **Snore:** % time snoring, snore-vs-pressure correlation.
- **Breath detection from 25 Hz Flow** (zero-cross + envelope): breath count, I:E ratio, cross-check
  device RespRate. This is the high-res lane that lets CPAPDex *derive* events to compare against EVE.

**Oximetry QC lane (SA2 — peer of O2Ring, self-gated):**
- **ODI** (≥3% desats/hr), **T90** (% time SpO₂<90), nadir, mean SpO₂, **pulse** (median/range).
- Every desat carries `perfusionOk` + `sqi` from §4.4 self-gate. A desat coincident with pulse-signal
  dropout is flagged `artifact:true` and excluded from ODI.

**Cross-metric:** AHI-vs-ODI concordance (do scored apneas line up with desats?), leak-vs-AHI
(does residual AHI rise when leak is high → "treat the leak"), pressure-vs-events.

## §4 — Quality, gating, and the self-gate

- **§4.1 Coverage:** therapy hours, off-mask gaps, % artifact. A <2 h night is flagged low-confidence.
- **§4.2 Mode awareness:** CPAP is inherently overnight — but still honor the activity-veto lesson if
  any gait/motion co-signal ever arrives via fusion (not in standalone). Standalone CPAP = overnight.
- **§4.3 Leak → sqi:** `sqi = clamp(1 − (largeLeakFraction), 0..1)`. High leak corrupts AHI/flow
  metrics (can't score what leaked away) → lowers `sqi` → Integrator down-weights via `effConf`.
- **§4.4 Oximeter self-gate (REQUIRED — the squeeze lesson):** for each candidate desat, inspect the
  SA2 **pulse** channel and signal continuity in the same window. If pulse drops out / PI collapses /
  SpO₂ falls faster than physiologic (>~1.5 %/s sustained cliff) **at the same instant**, mark the
  desat `artifact:true, reason:"perfusion-collapse"` and exclude from ODI. A real desat falls over tens
  of seconds and the pulse stays valid. **This is decided from one device alone** — no second sensor
  needed. Mirror the same routine the brief `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md` defines
  so OxyDex and CPAPDex-SA2 behave identically.

## §5 — Cohesion-native (born with it — do NOT retrofit later)

Clone OxyDex's cohesion wiring (it is the reference implementation):
- **Metric registry:** every metric defined once with `{ key, label, unit, tier, evidence, cite,
  fmt }`. `tier ∈ {essential, clinical, deep}` drives the disclosure depth selector. `evidence ∈
  {measured, derived, inferred, modeled}` drives the badge.
- **Evidence badge placement (NEW — matches the suite-wide change):** bottom-right corner of each
  metric **card/tile**; in dense tables, in the metric-name cell. Use the shared `ans-design.css`
  badge classes — do not invent local styles.
- **Depth selector** (Essential / Clinical / Deep) mounts top-right of each view, same component as
  OxyDex's `mountDepthSelector`.
- **Lexicon:** use the shared term set (`LEXICON.md`) — node naming, "events", "burden", "evidence".
- **Epistemic hierarchy:** measured (device-scored EVE) > derived (flow-detected breaths) > inferred
  (cross-metric) > modeled. The badge tells the user which, every time.

## §6 — Fusion: events, export, and per-signal authority

**Event emission** (`cpapdex-fusion.js`, clone `oxydex-fusion.js`). Emit `ganglior_events`:
- `apnea` / `hypopnea` (one per EVE event) — `conf` = device severity, `sqi` = leak-quality, `node:
  "CPAPDex"`, `meta:{ class:"obstructive|central", durSec, source:"device-scored" }`.
- `periodic_breathing` (CSL spans). `desat` (SA2, only if NOT self-gated artifact). `large_leak`
  (leak excursions — context for other nodes).
- Event `t` = `"HH:MM:SS"` wall-clock string (no date), per Export Contract §6; ALSO write absolute
  floating `tMs`. Reconstruct date from `startEpochMs` rolling past midnight, monotonic.

**Export:** `schema.name:"ganglior.node-export"`, `recording.startEpochMs = t0Ms` (floating),
`ganglior_events:[…]`. Sessions array + off-mask gaps in `recording`. Provenance stamped by R1 helper.

**Per-signal authority matrix (the Integrator consumes this — already approved):**

| Signal | Gold (authority) | Backup (if gold's sqi-gate trips) | Rationale |
|---|---|---|---|
| Apnea / Hypopnea (AHI) | **CPAP** (EVE, flow-scored) | OxyDex ODI + ECG-surge inference | airflow *is* the event definition |
| Resp rate · tidal vol · minute vent | **CPAP** (pneumotach) | ECG-derived resp / OxyDex RSA proxy | direct airflow |
| Leak · pressure · flow-limit · snore | **CPAP** (sole source) | — | therapy-internal |
| SpO₂ · ODI · T90 | **O2Ring ≈ CPAP-SA2** (peers) | each other, per-epoch sqi | dedicated vs integrated oximeter |
| HRV (RMSSD/SDNN/DFA) | **Chest ECG** | wrist PPG | R-peak timing is gold; PPG dies on motion |
| Heart rate (bpm) | **Chest ECG** | pulse-ox (CPAP/O2Ring) → PPG | ECG most accurate; pleth fine at rest |
| Glucose (TIR/MAGE) | **CGM** (sole source) | — | only source |

**Device-scored AHI in the Integrator (decision #4):** when a CPAP export is present, its EVE-scored
apneas are the **authoritative** apnea evidence. The existing inferred matcher (`LEAD=15/TRAIL=60`)
still runs but its role flips to **validation**: a device-scored apnea with a matching OxyDex desat is
`confirmed`; one without is still `confirmed` (device wins) tagged `oximetry:absent`; an *inferred*
apnea with NO device event when a CPAP was worn is **downgraded** (the gold sensor saw nothing). Keep
the window numbers identical to OxyDex (R4) — only the source-precedence is new.

**Consequence-corroboration (the squeeze lesson, Integrator side):** a `desat` finding must look for
the obligate HR response (surge on any live HR node). Absent ⇒ downgrade to `unconfirmed`, never
publish the raw nadir as truth. Present-but-no-SpO₂-sensor ⇒ `event:"unconfirmed-desat"`. This is how
"3 silent sensors + 1 desat" resolves correctly **without** counting devices — capability filter +
plausibility + consequence, per `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md`.

## §7 — Build order & gates

1. `cpapdex-edf.js` reader + unit harness on the real `uploads/2026061*_*.edf` set (round-trip a known
   record; assert sample counts & physical scaling).
2. `cpapdex-dsp.js` metrics (mirror `parseTimestamp` locally; §3).
3. `cpapdex-render.js` cohesion-native views (clone OxyDex; corner badges).
4. `cpapdex-fusion.js` events + export (§6).
5. `CPAPDex.src.html` → bundle to `CPAPDex.html` via inliner.
6. Add shared assertions to `tests/dex-tests.js` (EDF decode, clock round-trip, self-gate, AHI math) so
   **both** `node tests/run-tests.mjs` and `Dex-Test-Suite.html` cover it; add a render-coverage entry
   driving the CPAPDex bundle in an iframe.
7. **Gates before done:** `Dex-Test-Suite.html` all-green · `verify-provenance.html` no red · live
   spot-check on the real night (two sessions stitched, AHI vs device, self-gate catches a squeeze).

## §8 — Synthetic fixture to add (corpus brief)

Add to `SYNTHETIC-CORPUS-BRIEF.md` / `synth-gen.js`: a **CPAP night** coherent with the other nodes,
PLUS two failure-injection scenarios from the live test so the gate catches regressions:
- **"oximeter occlusion artifact during ECG dropout"** — H10 battery dies mid-night; O2Ring shows a
  near-instant 67% cliff with coincident pulse-signal collapse; wrist PPG keeps clean steady HR.
  Expected: self-gate flags the desat `artifact`; Integrator does NOT publish a desat; graceful
  fallback to PPG for HR. The canonical "1 device dissents, but it's the artifact" case.
- **"high-leak night"** — residual AHI rises with leak; `sqi` drops; Integrator down-weights.
