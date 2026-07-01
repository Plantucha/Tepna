<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# PpgDex — Build Brief & Project Handoff

> Durable context for a fresh chat. Read this first, then `CLAUDE.md`, `ans-design.css`,
> `ECGDex-BUILD-BRIEF.md`, and `ECGDex.html` (PpgDex is ECGDex's optical twin — clone its
> spine). Everything here was decided in a prior planning conversation; this file is the
> source of truth.

---

## START HERE (fresh-thread bootstrap — read this, skip re-exploration)

**The task:** build **PpgDex** (raw wrist-PPG analyzer), retrofit **ECGDex** + **OxyDex**
for multi-night, and add a shared cross-night analytics engine. All decisions are locked
below; do not re-litigate. To save tokens, a new thread needs to read only:
`CLAUDE.md` → this brief → `ECGDex-BUILD-BRIEF.md` → `ecgdex-app.js` (clone `exportJSON` +
ingest/render wiring) → `ecgdex-dsp.js` (clone HRV/epoch/CVHR + `parseTimestamp`) →
`ecgdex-morph.js` (morphology template) → `oxydex-app.js` (clone `allNights` multi-night
flow) → `ans-design.css`. Don't re-grep the suite; the facts below are already verified.

**Facts already established (June 2026 — do NOT re-discover):**
- **Clock Contract is unified & stable** across all 5 apps: floating wall-clock `tMs` via
  `Date.UTC(components)`, display via `getUTC*`, `parseTimestamp` duplicated locally per
  app. PpgDex inherits verbatim. (CLAUDE.md + `CLOCK-UNIFY-BRIEF.md`.)
- **Real data is in `uploads/`** — Polar Sense session `BBBBBBBB_20260609_194332`:
  `*_PPG.txt` (≈176 Hz, 3 green channels + ambient, ~13.8k rows), `*_PPI.txt` (device PP
  intervals — validation lane), `*_ACC.txt`/`*_GYRO.txt`/`*_MAGN.txt` (motion gate),
  `MARKER_*.txt` (segments). Formats + columns are in §3.
- **Polar timestamps** = ISO-8601 **no zone** (`2026-06-09T19:44:40.621`) → parse step 3 →
  `Date.UTC(...)`, `offsetMin=null`. The `sensor timestamp [ns]` column is a monotonic
  counter → use for `fs`/spacing, NOT as a clock. No vendor regex needed.
- **ECGDex export** = `ganglior.node-export` **v2.0** (`ecgdex-app.js` `exportJSON`, ~line
  808). Clone its envelope verbatim; swap the ECG `morphology` block for the PPG one (§6).
- **ECGDex is single-recording** (`let RESULT`, `files[0]` overwrites) → needs the §1b
  multi-recording retrofit. **OxyDex** is the multi-night reference (`allNights={}` keyed
  map, append flow, array export) and **already has solid cross-night stats** (Multi-Night
  Summary card: OLS trend slope + R², best/worst night, NSI mean/SD, SpO₂ night-CV, PB/SOL
  trends, ≥3-night gating) — but it's bespoke OxyDex code lacking the robustness layer
  (Mann–Kendall, bootstrap CI, z-scores, coverage-weighting). §1c factors that into a
  shared engine and adds the missing robustness, not "stats from scratch."
- **Fonts:** system stacks only — no `@font-face`/CDN/woff2 (resolved; see CLAUDE.md
  non-issues). Edit `.js`+`.src.html`, never the bundled `.html`; re-bundle after.

**Locked decisions:** (1) PpgDex is a pure single-signal emitter — all 2-site PTT/BP fusion
goes to the **Integrator**, not here. (2) Per-session export = ECGDex v2.0 verbatim;
multi-night = array of v2.0 objects + `crossNight` header (§6a). (3) v1 = everything from
the signal (self-PPI, HRV, motion gate, morphology, CVHR, epochs, events). (4) Multi-night
required for PpgDex **and** retrofit ECGDex **and** OxyDex, all sharing one `crossNight()`
engine (§1c). PPI stays an in-app validation lane (never handed to PulseDex).

> ### 🔒 PRESERVATION RULE (applies to EVERY existing file we touch — non-negotiable)
> **Existing apps are ENHANCED ONLY — never visually changed, never reduced.** OxyDex,
> ECGDex, PulseDex, HRVDex, GlucoDex, the Integrator, Ganglior:
> - **No feature is removed, renamed, hidden, or moved.** Every current card, metric,
>   export field, control, and behavior stays exactly where it is.
> - **No visual change.** Same layout, same chrome, same colors, same copy, same card
>   order. A user must not be able to tell the UI changed except that NEW things appeared.
> - **Additive only.** Multi-night, the shared `crossNight()` engine, robustness stats,
>   `crossNight` export blocks are ADDED alongside what exists. When refactoring existing
>   logic into the shared helper, the rendered output must be identical (or strictly
>   richer) — re-verify the old numbers/cards are unchanged.
> - **Single-recording behavior is byte-identical.** With one file loaded, ECGDex/OxyDex
>   exports and screens match today exactly; multi-night UI only appears once ≥2 are loaded.
> - **PpgDex is the only net-new app.** Everything else is a careful under-the-hood upgrade.

---

## 0. Project identity & the one-line thesis

- **PpgDex** is the next single-signal node in the Dex Suite: **raw wrist PPG in → pulse
  intervals + pulse-wave morphology out**, emitted onto the **Ganglior** bus.
- **Thesis: PpgDex is the raw-PPG twin of ECGDex.** Same machine, different front-end:
  - ECGDex: raw ECG → R-peaks → RR intervals → HRV + events
  - PpgDex: raw PPG → systolic feet/peaks → **PP intervals (PPI)** → HRV + events
  - **Once the waveform becomes a beat-to-beat interval series, the entire downstream is
    identical.** So ECGDex donates ~70% of the engine; we build only a new optical
    front-end + a real motion gate + pulse-wave morphology.
- **Why a new node and not a tab in OxyDex** (decided): the suite is "one signal, one
  codex." OxyDex *owns SpO₂* (processed 1 Hz, no waveform). The Polar Sense PPG is a
  continuous optical *waveform* at ~176 Hz, single-wavelength (green-family) → **cannot
  yield SpO₂** (needs red+IR). Folding it into OxyDex buys no oximetry and pollutes its
  DSP. PpgDex is its own clean single-signal node.

---

## 1. Scope decisions (LOCKED — from the planning conversation)

1. **No in-app cross-signal fusion. PpgDex is a pure single-signal emitter.** Two PPG
   sites now exist — wrist (Polar, this node) and fingertip (O2Ring via OxyDex) — which
   opens **Pulse Transit/Arrival Time → cuffless BP surrogate, site redundancy, central-
   vs-peripheral perfusion gradient**. ALL of that lives in the **Integrator**, not here.
   PpgDex just emits a clean export the Integrator consumes. (Matches the suite
   architecture; do not add a fusion card like OxyDex's in-app one.)
2. **Per-session export = ECGDex's `ganglior.node-export` v2.0 envelope, verbatim.** It is
   the canonical shape the Integrator/OxyDex already read. For a multi-night load (§1a) the
   file is an **array of those v2.0 objects** (OxyDex's array-of-recordings packaging) +
   one optional cross-night aggregate header — so each element stays Integrator-readable
   unchanged.
3. **v1 scope = everything technically possible from the signal:** detect → self-PPI →
   full HRV suite + self-vs-device PPI validation + ACC/GYRO motion gate + pulse-wave
   **morphology** (rise time, dicrotic notch, augmentation index, perfusion index) + CVHR
   **apnea screen** + 5-min epoch timeseries + Ganglior events. Nothing held for v2.
4. **Multi-night / multi-session is REQUIRED, modeled on OxyDex (§1a).** Load many sessions,
   keep each independent, switch between them, aggregate across them, export all at once.
   **ECGDex gets the same retrofit (§1b)** — it is single-recording today and must match.

### 1a. Multi-session model (clone OxyDex's `allNights` pattern)
OxyDex is the reference: an `allNights = {}` keyed map, a true **append** flow
(`addMoreFiles()` shows the drop-zone and appends without clearing), `Object.values()`
sorted by date for render/export, and `clearAll()` to reset. PpgDex mirrors it:
- **`allSessions = {}`** keyed map; each loaded PPG file is parsed + analyzed **independently**
  into its own full result object (HRV, morphology, motion, CVHR, epochs, events) and stored.
- **Key by session start, NOT by calendar date.** Wrist PPG can have several sessions per
  day (the sample is a 19:44 spot-check, not a whole night), so key by `t0Ms` (or
  `fmtDateTime(t0Ms)`), unlike OxyDex which keys by `date`. Dedupe on identical `t0Ms`+fname.
- **Append flow:** an "Add session(s)" control re-opens the drop-zone and appends; loading
  a folder/multi-select ingests them all. Never wipe existing sessions on a new load.
- **Session switcher** in the sidebar (date-time + duration + quality chip per session);
  selecting one re-renders the whole dashboard for that session. Keep the active session id
  in `localStorage` so a refresh restores the view (suite convention for timed content).
- **Cross-night view:** a trends strip/table over `Object.values(allSessions)` sorted by
  `t0Ms`, powered by the **shared cross-night analytics engine (§1c)** — not just raw
  per-night values. This is the multi-night payoff: night-to-night autonomic + perfusion +
  morphology trend, with real statistics.
- **`clearAll()`** resets `allSessions={}` and caches, exactly like OxyDex.
- The companion ACC/GYRO/PPI/MARKER files belong **to a session** — match them to the PPG
  file by the shared `BBBBBBBB_<session>` stem so each session carries its own motion +
  device-PPI lanes.

### 1c. Cross-night analytics engine (RICH — shared by PpgDex, ECGDex, AND OxyDex)
The multi-night view is **not** a list of values — it computes real night-over-night
statistics. Build it once as a small pure helper (`crossNight(series, opts)` → stats
object) and use the SAME logic in all three apps (duplicated locally, suite convention).
For each tracked metric (PpgDex: RMSSD/SDNN/lnRMSSD/HR/PI/AI/motionRejected/CVHR-index ·
ECGDex: RMSSD/SDNN/lnRMSSD/DFAα1/QTc/CVHR/DC · OxyDex: ODI4/mean-SpO₂/T90/hypoxic-burden/
NSI/sleep-efficiency/mean-HR) compute, across the loaded nights:

1. **Central tendency + spread:** n, mean, SD, median, IQR, min/max, and **CV%** — the
   night-to-night *consistency* number (a high-variance sleeper is itself a finding).
2. **Trend:** ordinary-least-squares **slope vs night index** (and vs real `t0Ms` date so
   uneven gaps are honored), slope units/day, R², and a **Mann–Kendall** non-parametric
   trend test (tau + p) for robustness on short noisy series. Label
   improving/stable/declining per metric's known good direction.
3. **Significance / change:** when n≥7, paired first-half-vs-second-half **delta + 95% CI**
   (bootstrap, since n is small); flag metrics whose CI excludes zero as a real shift.
4. **Personal baseline + z-scores:** rolling mean±SD over prior nights → **per-night z-score**
   so the newest night reads as "−1.8σ below your 14-night RMSSD baseline" (the actionable,
   user-facing framing). Flag |z|≥2 nights.
5. **Coverage-weighting:** weight every aggregate by each night's `analyzablePct`/coverage
   so a 30-min fragment never sways the trend like a full night. Exclude nights below a
   quality floor from trend fits (still shown, marked "low quality").
6. **Consistency / streaks:** longest run within healthy range, # nights flagged, and a
   simple **regularity score** (timing + duration + metric stability) — PpgDex/ECGDex add
   bedtime-timing regularity from `t0Ms`.

**Rendering:** for the **net-new node PpgDex** (and ECGDex's new multi-recording trends),
a cross-night card — sparkline-per-metric with baseline band + z-score callouts, a
slope/CV/Mann-Kendall summary table, and the newest-night-vs-baseline headline. Reuse the
inline-SVG-via-template-string pattern; no new deps. **OxyDex keeps its EXISTING Multi-Night
Summary card unchanged** — it gains the new robustness stats inline (added rows/figures),
not a redesigned card (see Preservation Rule).

**Export:** the multi-session wrapper's `crossNight` block (§6a) carries this full stats
object (per-metric: mean/SD/CV/slope/R²/tau/p/CI/baseline/zLatest), not just raw values —
so the Integrator and any model consume the trend, not just the points.

**OxyDex upgrade (REQUIRED, same engine — UI PRESERVED):** OxyDex **already computes
cross-night stats** — a Multi-Night Summary card with OLS trend slope + R², best/worst
night, NSI mean/SD, SpO₂ night-CV, PB/SOL trend slopes, gated to ≥3 nights
(`oxydex-render.js` ~line 720). The ask is NOT to add stats from scratch, and NOT to
redesign the card — it's to (a) **factor that logic into the shared `crossNight()` helper**
so the math is shared across nodes (OxyDex's card renders the same numbers, just sourced
from the helper), and (b) **add the robustness layer OxyDex lacks** — Mann–Kendall trend
test, bootstrap 95% CIs, personal-baseline z-scores, coverage-weighting — surfaced as
additive rows/figures **inside the existing card**. Every current OxyDex card, metric,
layout, color, and number stays exactly as today; this is strictly additive + an under-the-
hood refactor, plus a new `crossNight` export block. Re-verify the old card is pixel-
identical apart from the appended robustness rows.

### 1b. ECGDex retrofit (REQUIRED — same change, do it alongside)
ECGDex today holds a single `let RESULT` and `loadECGFile(e.target.files[0])` **overwrites**
it. Retrofit it to the OxyDex/PpgDex model so the two interval-nodes behave identically:
- Replace the single `RESULT` with **`allRecordings = {}`** keyed by `t0Ms`, an append
  loader (accept multi-select / repeated loads), a recording switcher, and a cross-night
  trends view (RMSSD/SDNN/CVHR/QTc-trend across nights — ECG already computes these).
- `RESULT` becomes "the currently-selected recording" (a pointer into the map) so all the
  existing render functions keep working unchanged.
- The device cross-check lanes (RR/HR/ACC) attach **per recording**, not globally.
- `exportJSON` emits an **array** of the existing v2.0 objects (one per recording) when >1
  loaded, a single object when one — backward-compatible with current consumers.
- **Preservation (per the 🔒 rule):** every existing ECGDex card, metric, control, and the
  whole single-recording screen stay visually identical. The recording switcher + cross-
  night card appear ONLY once ≥2 recordings are loaded; with one file, ECGDex looks and
  exports byte-identical to today. No existing feature is removed or moved.
- Keep it a separate, clearly-scoped task in its own brief section.

### PPI ownership (settled): PPI stays *inside* PpgDex as a signal control
Exactly like ECGDex treats device-RR. PpgDex **detects its own pulses from the waveform**
(self-PPI), then keeps the Polar **PPI file as a ground-truth validation lane** — agreement
%, deviation, correction rate. PPI is NOT handed to PulseDex. Division of labor:
- **PulseDex** = "someone hands me RR/PPI, I do HRV."
- **PpgDex** = "I *extract* intervals from a raw optical waveform and *prove* they're
  trustworthy (vs device PPI + motion gate), then do HRV."

---

## 2. 🔒 Clock Contract — inherited VERBATIM (verified June 2026, suite is unified)

PpgDex MUST obey the Clock Contract (CLAUDE.md + `CLOCK-UNIFY-BRIEF.md`) like every other
node. Verified current state: all five apps store **floating wall-clock `tMs`** via
`Date.UTC(components)`, display via **`getUTC*`**, and duplicate `parseTimestamp` locally.
PpgDex duplicates it too (mirror ECGDex's copy — do **not** add a shared util in this pass).

**Polar Sense timestamp specifics (from the real `uploads/` samples):**
- Phone/RX timestamps are **ISO-8601, no zone**: `2026-06-09T19:44:40.621` →
  **resolution step 3** → `tMs = Date.UTC(y,mo-1,d,h,mi,s,ms)`, `offsetMin = null`. No
  special case, no vendor regex needed.
- The **`sensor timestamp [ns]`** column is a **monotonic relative counter**, NOT a clock.
  Use it for precise inter-sample spacing (the ECGDex "sample index / fs" role), never as
  `tMs`. Derive `fs` from it (expect ~176 Hz; see §3).
- `t0Ms` = `tMs` of the first valid PPG sample (the per-session anchor). `relSec =
  (tMs − t0Ms)/1000`. `dateAnchorMs` from the full date in the phone timestamp.
- `MARKER_*.txt` lines carry ISO no-zone stamps → same step-3 parse; map to `relSec` for
  on-scope event flags / segment gating.
- **Never** `new Date(str)`/`Date.parse` on these; **never** fall back to `now()`; a
  missing stamp → `null`, visible, never fabricated.

---

## 3. Data formats (REAL samples seen in `uploads/`)

Device: **Polar Sense** (`BBBBBBBB`), session `20260609_194332`. Semicolon-delimited,
header row first, ISO no-zone phone clock + relative sensor-ns.

### 3a. PPG — THE one signal (`*_PPG.txt`, ~13.8k rows)
```
Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient
```
- **~176 Hz** (≈5.68 ms inter-sample, from the ns column). Compute `fs` from the median
  ns delta; do not hardcode.
- **3 optical channels (green-family) + 1 ambient.** Channels are same-wavelength → **no
  SpO₂**. Use multi-channel for robustness: pick best-SNR channel per window, or fuse;
  use **ambient** for light-leak/artifact rejection.
- This is the ONLY analyzed signal. Everything (PPI, HRV, morphology) is computed FROM it.

### 3b. PPI — device ground-truth validation lane (`*_PPI.txt`)
```
Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]
```
- Polar's on-device peak-to-peak intervals + error estimate + blocker/contact flags + HR.
- **Role = validation only** (the ECGDex device-RR analog). Cross-check self-PPI against
  it: agreement %, mean abs deviation, % corrected. Honor `blocker`/`contact` flags as a
  device-side quality gate in the comparison.

### 3c. ACC / GYRO / MAGN — the motion gate (PpgDex's signature; ECG has nothing like it)
```
ACC:  Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]          (~ a few hundred Hz)
GYRO: Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]
MAGN: Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]
```
- **ACC + GYRO drive real motion-artifact rejection** — resample to the PPG time base,
  compute a per-window motion index (accel vector magnitude variance + gyro magnitude),
  and **suppress / down-weight pulses during motion bursts.** This is where wrist PPG
  earns its trust and is PpgDex's unique value vs OxyDex/ECGDex.
- MAGN is optional and **additive** — wired in `analyzeMotion` (Jun 2026). Earth-field-scale
  only (~0.15 µT LSB, |B|≈1.34 G on this session): a tilt-compensated heading splits the merged
  ACC `lateral` posture into `lateral_L`/`lateral_R` (L/R labels are **relative** — may be mirrored
  without a calibration gesture; `headingRef:"relative"`), plus a calibration-free `magInterference`
  artifact flag (field wobble / |B| off baseline). Per-epoch fields: `position`, `positionConf`,
  `headingDeg`, `magInterference`; quality block carries `magInterferencePct`. **Informational only —
  it does NOT modify beat SQI/conf** (left to the Integrator to weight). It is **not** required for v1
  gating and is fully null-safe (no-ops when no `*_MAGN.txt` is present).
  **NOT biomagnetic HR** — the cardiac field (~50 pT) is ~3000× below one LSB; any pulse-rate peak
  in MAGN is limb micro-motion aliased through Earth's field, which ACC/GYRO already gate better.

### 3d. MARKER (`MARKER_*.txt`) — segment annotations
```
Phone timestamp;Marker start/stop
2026-06-09T19:44:44.111;MARKER_START
```
- START/STOP pairs delimit analysis segments. Map to `relSec`; allow restricting analysis
  to in-marker spans and surface markers on the scope.

---

## 4. Design system & graphics (REUSE — don't reinvent)

- **Link `ans-design.css`** and inherit the whole look (dark teal/blue, `--teal #3DE0D0`,
  `--blue #58A6FF`, bg `#0B0F14`). Fonts: system stacks only — **no `@font-face`, no CDN,
  no woff2** (resolved at the root June 2026; do not reintroduce — see CLAUDE.md non-issues).
- **Clone `ECGDex.html` structure**: `.app-shell` grid, sidebar logo + `.sec-label` nav,
  topbar, hero, KPI strip, `.chart-card`s, full metrics table, sticky `#exportBar`,
  profile panel, alerts/progress. Swap the analysis, keep the chrome.
- **Graphics reuse rule (same as ECGDex):**
  - **Raw PPG waveform scope → MUST be `<canvas>`** (13.8k+ pts now, far more on long
    sessions). Use ECGDex's min/max envelope-pyramid scope; add zoom/span controls.
  - **Derived series** (PPI tachogram, HRV trend, motion-index ribbon, CVHR envelope,
    Poincaré, morphology overlay on a median beat) → reuse the hand-rolled inline-SVG-via-
    template-string pattern. Looks native, costs nothing.
- **Empty state:** ship a drop-zone hero (AUDIT.md §2c) — don't open as a black void.

### File layout (matches the suite convention)
Edit the `.js` + `.src.html`, **never** the bundled `.html`; re-bundle after changes.
- `ppgdex-dsp.js` — parse, fs detection, **optical beat detection**, motion gate, PPI,
  HRV suite, morphology, CVHR, epochs, event emission. (Duplicates `parseTimestamp` +
  `mean/std/quantile/...` locally, ECGDex-style.)
- `ppgdex-morph.js` — pulse-wave morphology (mirrors `ecgdex-morph.js`'s role).
- `ppgdex-render.js` — canvas scope + SVG cards.
- `ppgdex-profile.js` — the shared profile panel (clone `ecgdex-profile.js`).
- `ppgdex-app.js` — wiring, loaders (PPG + optional PPI/ACC/GYRO/MAGN/MARKER), `exportJSON`
  (v2.0 schema, §6), `exportGanglior`, `exportPPI`, `exportCSV`, reset.
- `PpgDex.src.html` → bundle → `PpgDex.html` (standalone, 100% local).

---

## 5. DSP pipeline — what's donated vs what's new

### 5a. Donated by ECGDex almost free (identical once intervals exist)
- **detect → refine → SQI-gate → interpolate → HRV → emit** architecture.
- **Full HRV suite:** time-domain (SDNN/RMSSD/pNN50/SDANN/SDNN-index/triangular/…),
  **Poincaré** (SD1/SD2/area + representative-epoch), **frequency** (Lomb–Scargle
  VLF/LF/HF/LF:HF + EDR resp-rate), **nonlinear** (DFA α1, SampEn, DC/AC, fragmentation
  PIP/IALS/PSS). Same code, fed by PPI instead of RR.
- **5-min epoch engine** → `timeseries.epochs` (the real cross-node currency).
- **Per-beat SQI → Ganglior `conf`.**
- **CVHR / apnea screen** — PPI carries the bradycardia-rebound signature; the SDB screen
  transfers (label it PPI-derived, screen-not-diagnosis).
- **Self-vs-device validation card** — clone ECGDex's RR-validation card, feed self-PPI vs
  device-PPI (§3b).
- **`ganglior.node-export` v2.0** schema, profile/personalization panel, ANS-readiness/
  ANS-age projection (PPI-driven HRV maps the same way), alerts, export bar.

### 5b. Genuinely NEW (ECGDex has nothing — this is the real engineering weight)
1. **Optical beat detection** — systolic-foot/peak detection on PPG: bandpass (~0.5–8 Hz),
   first-derivative + adaptive threshold (Pan-Tompkins does NOT apply — PPG is softer,
   slower upstroke, no sharp QRS). Detect **foot** (intersecting-tangent) for PPI timing;
   detect systolic peak for morphology. Multi-channel: choose best-SNR channel per window.
2. **Motion gate from ACC+GYRO** (§3c) — resample to PPG base, per-window motion index,
   suppress/down-weight pulses in motion bursts; this index also feeds `conf` and a
   coverage figure. **PpgDex's signature feature.**
3. **Pulse-wave morphology** (`ppgdex-morph.js`) — on a clean median beat and per-window:
   **rise/crest time, dicrotic-notch detection, augmentation index, reflection index,
   pulse width, perfusion index (PI = AC/DC).** The optical analog of ECGDex's QRS/QT
   morphology block — and something **neither OxyDex nor ECGDex can produce.** This is
   PpgDex's unique value; surface it in its own card + the export `morphology` block.

### 5c. Fallback ladder (mirror ECGDex's)
- **Plan A** (expected): clean self-PPI → full HRV + morphology + CVHR.
- **Plan B** (self-PPI quality poor, heavy motion): PpgDex does **pulse-rate + morphology +
  motion-quality reporting only**, and **exports computed PPI for PulseDex** to do precise
  HRV. Clean division, no fabricated metrics — low-quality windows are gated to `null`.

---

## 6. Export contract — `ganglior.node-export` v2.0 (clone ECGDex's `exportJSON`)

Emit the EXACT v2.0 envelope ECGDex emits (`ecgdex-app.js exportJSON`), with PpgDex
identity and PPG-appropriate blocks. Keep every cross-node convention:
- `schema:{ name:'ganglior.node-export', version:'2.0', node:'PpgDex', nodeVersion:'1.0',
  generated, doc, units }` — add PPG units (`pi:'%'`, `riseTime:'ms'`, `ai:'%'`,
  `motionIndex:'0..1'`) to the ECGDex unit map.
- `recording:{ source, sampleRateHz:fs, durationSec, durationMin, startEpochMs:t0Ms,
  beats:nPulses, epochs5min, ... }` — **`startEpochMs` = the floating `t0Ms`** (Clock
  Contract §6).
- `quality:{ analyzablePct, cleanBeatPct, coveragePct, ... , meanSQI, motionRejectedPct,
  deviceAgreementPct, correctionRatePct, ... }` — fold in the motion-gate + device-PPI
  agreement numbers.
- `hrv:{ time, poincare, frequency, nonlinear }` — identical structure to ECGDex.
- `personalization:{ profile, ansReadinessScore, ansAge, restingHR, ... }` — clone.
- `apnea:` — CVHR/PPI SDB screen (longRecording only), method noted PPI-derived.
- **`morphology:`** — REPLACE ECGDex's ECG `intervals/ectopy/QTc/TWA` with the PPG block:
  `{ riseTimeMs, crestTimeMs, dicroticNotchPresent, augmentationIndexPct, reflectionIndex,
  pulseWidthMs, perfusionIndexPct, medianBeat:{...}, perWindow:[...] }`.
- **`validation:`** — self-PPI vs device-PPI: `{ deviceAgreementPct, meanAbsDevMs,
  beatsCompared, correctedPct, note }`.
- **`motion:`** — `{ meanMotionIndex, motionRejectedPct, perEpochMotion:[...], source:
  'ACC+GYRO', note }`.
- `timeseries:{ doc, epochs:[{ tMin, beats, hr, meanRR, rmssd, sdnn, pnn50, lf, hf, lfhf,
  respRate, pi, motionIndex }], markers:[...] }` — the primary cross-node feed.
- `ganglior_events: r.events` — see §7.
- `reserved:{ doc, ... ptt:null, pttSource:'Integrator', deltaSBP:null,
  deltaSBPSource:'Integrator (wrist⟷fingertip PTT)', spo2Correlation:null,
  spo2Source:'OxyDex' }` — leave hooks for the Integrator's 2-site fusion.

Also provide `exportGanglior` (`{ bus:'ganglior', node:'PpgDex', events }` — events
concatenated across all loaded sessions), `exportPPI` (self-PPI as a PPI file PulseDex can
read — Plan B), and `exportCSV`.

### 6a. Multi-session packaging (the §1a payoff)
Each session produces ONE v2.0 object as above. `exportJSON` packages **all loaded
sessions** like OxyDex packages nights:
- **>1 session** → a top-level object `{ schema:{...,multiSession:true}, generated,
  sessionCount, crossNight:{...}, sessions:[ <v2.0 object>, <v2.0 object>, ... ] }` where
  each `sessions[]` element is the unmodified per-recording v2.0 envelope (Integrator reads
  any element directly). `crossNight` carries the night-to-night aggregates (per-session
  RMSSD/SDNN/HR/PI/motionRejected/CVHR + simple trend slopes).
- **1 session** → emit the bare v2.0 object (no wrapper) for backward-compat — same rule
  ECGDex's retrofit (§1b) follows, so single-file output is unchanged from today.
- Sessions sorted by `t0Ms` ascending. Per-session `recording.startEpochMs` = that
  session's floating `t0Ms`.

---

## 7. Ganglior event stream (the bus currency)

Per CLAUDE.md §6: events are `{ t:"HH:MM:SS", impulse, node:'PpgDex', conf, meta? }` with
`t` a **wall-clock string, no date** (consumers reconstruct absolute `tMs` from
`startEpochMs`'s date + `t`, rolling past midnight). **New emitter → ALSO write absolute
floating `tMs` on each event** (CLAUDE.md says new emitters SHOULD). `conf` comes from
per-pulse SQI × motion gate. Candidate impulses:
- `autonomic_surge` / `hrv_drop` (epoch RMSSD collapse) — shared vocabulary with ECGDex.
- `cvhr_cluster` (apnea screen).
- `perfusion_drop` (PI falls — peripheral vasoconstriction / cold / poor contact).
- `motion_artifact_segment` (gated span; low conf, informational).
- `pulse_morphology_shift` (augmentation-index / notch change — stiffness/vascular tone).
- `contact_loss` (device contact flag + signal dropout).

---

## 8. Verification (non-negotiable — clone ECGDex's + add optical/motion tests)

Clock (CLAUDE.md): round-trip first/last shown == raw file exactly · viewer-timezone
independence (re-render under changed `TZ` → identical clock) · overnight 22:00→06:00 = ~8 h
monotonic · stamp-less row → null (never today). PpgDex-specific:
1. **fs detection:** median ns delta → ~176 Hz; scope time axis matches phone clock at
   first/last sample.
2. **Self-PPI vs device-PPI parity:** on a clean (low-motion) span, self-PPI agrees with
   the Polar `*_PPI.txt` within tight bounds (report agreement %); HRV from self-PPI ≈ HRV
   the device PPI would give.
3. **Motion gate works:** inject/sit a known motion burst (MARKER-delimited) → those pulses
   are rejected/down-weighted, `motionRejectedPct` rises, conf drops there.
4. **Morphology sanity:** dicrotic notch detected on clean beats; PI in physiologic range;
   AI monotone with synthetic stiffening.
5. **Plan-B path:** force poor self-PPI → node degrades to pulse-rate + morphology and
   exports PPI that PulseDex ingests cleanly.
6. **Schema parity:** the v2.0 export validates against the same consumer code that reads
   ECGDex's (Integrator loads it without special-casing).
7. **Re-bundle** `PpgDex.src.html` → `PpgDex.html`; standalone matches; 100% local (no
   network).
8. **Preservation regression (🔒 rule) for every existing app touched:** with ONE file
   loaded, ECGDex and OxyDex screens + exports are **byte-identical to before** (diff the
   export JSON; screenshot-compare the dashboards). No card, metric, control, color, or
   copy removed or moved. OxyDex's Multi-Night Summary shows the same numbers (now sourced
   from `crossNight()`) plus the appended robustness rows — nothing else changed. The
   shared `crossNight()` refactor reproduces each app's prior cross-night figures exactly
   before any new stat is trusted.

---

## 9. Suggested build order
1. **Parse + fs + scope** (canvas, ECGDex envelope-pyramid) — prove the waveform + clock.
2. **Optical beat detection → self-PPI** — the core new DSP.
3. **Motion gate (ACC+GYRO)** — wire the quality channel early; it feeds conf + coverage.
4. **HRV suite + epochs** — donated from ECGDex, fed by PPI.
5. **Device-PPI validation card** — clone ECGDex RR-validation.
6. **Morphology** (`ppgdex-morph.js`) — notch/rise/AI/PI card + export block.
7. **CVHR apnea screen** — donated, PPI-fed.
8. **Multi-session model (§1a)** — `allSessions` map + append loader + session switcher +
   cross-night trends + per-session companion-file matching. Do this once the single-
   session pipeline is solid (steps 1–7 operate on one session; this wraps them).
9. **Profile / ANS-age / KPI / table** — clone.
10. **Exports** — v2.0 JSON (single + multi-session wrapper §6a) + Ganglior + PPI + CSV.
11. **Bundle + verify** (§8).
12. **ECGDex multi-recording retrofit (§1b)** — separate task: `allRecordings` map +
    append loader + recording switcher + cross-night trends + arrayed export. Verify
    single-file output unchanged.
13. **Cross-night analytics engine (§1c)** — build the shared `crossNight()` helper, wire
    it into all three nodes' cross-night cards + export `crossNight` blocks.
14. **OxyDex cross-night retrofit (§1c)** — call the same `crossNight()` over `allNights`,
    add the rich cross-night card + export block; verify per-night numbers unchanged.
    Then the Integrator picks up 2-site PTT/BP fusion separately.
