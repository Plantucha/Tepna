<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Build Brief — Synthetic Overnight Corpus (5 nights × every Dex, cross-node coherent)

> **For an AI coder.** Read `CLAUDE.md` first (esp. THE CLOCK CONTRACT), then this brief, then the
> per-app parse code you're feeding: `oxydex-dsp.js`, `ecgdex-dsp.js`, `ppgdex-dsp.js`,
> `pulsedex-dsp.js`, `glucodex-dsp.js`, `hrvdex-*`. Goal: generate a **realistic, pathophysiologically
> coherent** synthetic dataset so the whole suite — and the Integrator's cross-node fusion +
> longitudinal engine — can be exercised end-to-end without real patient data. 100% local, no network.

---

## START HERE (bootstrap — the one big idea)

**ONE virtual subject. FIVE consecutive nights. EVERY device records the SAME nights on the SAME
wall-clock.** That is the whole point and the hardest constraint:

- A single **master event timeline** per night (apneas, periodic breathing, arousals, a glucose dip,
  dawn phenomenon, body-position changes) is defined ONCE. Each device generator then renders *its
  signal's view* of those same events. An obstructive apnea at `02:14:30` must simultaneously produce:
  an SpO₂ desaturation (OxyDex), a bradycardia-then-rebound RR oscillation + HRV dip (ECGDex/PulseDex),
  a pulse-amplitude/perfusion dip + the same PPI oscillation (PpgDex), and a small sympathetic glucose
  ripple (GlucoDex). **Because they share the wall-clock and the event, the Integrator can fuse them.**
- This is what makes the corpus valuable: it's not five unrelated signal dumps, it's one body seen
  through five instruments. Cross-signal couplings are *designed in* so you can verify the fusion +
  longitudinal layers actually detect them.

**Clock Contract is non-negotiable (CLAUDE.md §):** every device emits **floating wall-clock** time —
local civil time, no zone. Two devices recording the same minute produce the **same `tMs`** by
construction, which is exactly why fusion works without anyone sharing a timezone. Use each device's
real vendor timestamp *format* (below) but the same underlying civil clock across all of them per night.

**Output:** write the files into `uploads/synthetic/` (or a `present_fs_item_for_download` zip),
in the EXACT formats each app already parses — so NO app code changes are needed to load them.

---

## 1. The virtual subject & the 5-night clinical arc (LOCKED)

One subject — call it **"Subject A"** (45 y, male, BMI 31, untreated moderate OSA, pre-diabetic
HbA1c ~6.0). The five nights tell a deliberate story so the **longitudinal + change-point** engines
have a real signal to find — an **intervention on Night 3**:

| Night | Date | Bedtime | Story | AHI target | Glucose event | HRV/recovery |
|---|---|---|---|---|---|---|
| 1 | 2026-05-11 | 23:10 | Baseline untreated OSA | ~22 (moderate) | flat, mild dawn rise | low rMSSD (~24) |
| 2 | 2026-05-12 | 23:55 | Worse — alcohol, supine, fragmented | ~38 (severe) | **nocturnal hypo dip 03:00** + rebound | lowest rMSSD (~18) |
| 3 | 2026-05-13 | 22:50 | **CPAP started** (intervention) | ~7 (residual) | flatter, controlled | rMSSD recovering (~30) |
| 4 | 2026-05-14 | 23:05 | CPAP adherent | ~4 | clean + **dawn phenomenon** 05:00 | rMSSD good (~38) |
| 5 | 2026-05-15 | 23:20 | CPAP stable, best night | ~3 | stable, TIR improved | rMSSD best (~44) |

The Night-3 step-change is the planted **change point** (ODI/AHI drops, HRV climbs). The
Night-2 hypoglycemia is the planted **glucose↔autonomic interaction** (hypo → tachycardia + HRV
collapse + a few ectopics). Durations: ~7–8 h each (bedtime → ~06:30–07:00).

---

## 2. The master event model (define ONCE, render per device)

Per night, generate a typed event list on the floating wall-clock. Each event has
`{ t0Ms, durSec, type, severity, meta }`. Event types + how each device must render them:

### 2a. Obstructive apnea / hypopnea (the core)
- **Pattern:** airflow cessation `durSec` 10–40 s, clustered in REM-ish bouts. Severity scales AHI.
- **OxyDex:** SpO₂ desaturation beginning ~6–10 s after event onset (circulatory delay), nadir
  proportional to duration (−3 to −12 %), recovery overshoot; PR rises on arousal.
- **ECGDex/PulseDex:** **CVHR signature** — bradycardia during apnea, tachycardia rebound on arousal
  (cyclical RR oscillation ~0.6–1.2 mHz envelope). RR swing ±80–150 ms. HRV (rMSSD) locally suppressed.
- **PpgDex:** pulse-amplitude attenuation + perfusion-index dip during the event; same PPI oscillation
  as ECG; an arousal motion micro-burst (ACC/GYRO) at event end.
- **GlucoDex:** integrate clusters → a slow sympathetic glucose elevation over a heavy-apnea bout
  (+0.3–0.8 mmol/L), not per-event.

### 2b. Periodic breathing / Cheyne–Stokes-like (crescendo–decrescendo)
- **Pattern:** smooth waxing/waning ventilation, ~40–90 s cycle length, runs of 4–10 cycles.
- **OxyDex:** sinusoidal SpO₂ oscillation (±2–4 %) phase-locked to the cycle.
- **ECG/PPI:** matching RR sinusoid (very-low-frequency HRV power spike); label as periodic-breathing,
  distinct from discrete CVHR.
- **PpgDex:** perfusion + amplitude sinusoid in phase.
- Put at least one clear CSR run on Night 2 (severe) for the screen to catch.

### 2c. Arousal / micro-awakening
- Brief HR surge + motion burst (ACC/GYRO spike) + transient SpO₂ recovery overshoot. Drives
  sleep-fragmentation / sleep-efficiency metrics. Scatter through the night; cluster post-apnea.

### 2d. Body-position change (supine ↔ lateral)
- A larger ACC/GYRO transient + a step change in apnea rate after it (supine = worse OSA). MARKER it
  on PpgDex. Night 2 = mostly supine.

### 2e. Glucose events (GlucoDex-primary, but coupled)
- **Nocturnal hypoglycemia (Night 2, ~03:00):** glucose dips to ~3.2 mmol/L over ~40 min, plateau,
  rebound (Somogyi) to ~7.5 by 05:00. **Coupled:** ECG/PPI show compensatory tachycardia + rMSSD
  collapse + 2–3 isolated ectopic beats during the nadir; OxyDex PR rises.
- **Dawn phenomenon (Nights 4–5, ~05:00–07:00):** gradual glucose rise (+1.5–2.5 mmol/L) from
  cortisol/GH; coupled with a gentle HR rise + HRV morning shift. No apnea cause.
- Baseline CGM: realistic 5-min sampling, sensor noise ±0.1–0.3 mmol/L, slow ultradian drift, TIR
  improving across the arc.

### 2f. Sensor realism (apply to ALL devices)
- Dropouts (PpgDex contact loss, OxyDex finger-off → blanks/NaN rows), motion artifact spans,
  baseline wander, quantization. **Never fabricate a clean signal** — the QC/motion-gate code must have
  something to reject. But keep ≥1 clean low-motion span per night for the validation lanes.

---

## 3. Per-device output spec (EXACT formats the apps already parse)

> Verify each against the app's `*-dsp.js` parser before emitting. Match delimiter, header, column
> order, decimals, sampling rate, and timestamp format precisely. Floating wall-clock throughout.

### 3a. OxyDex — O2Ring CSV
- One file per night. Columns the parser expects (confirm in `oxydex-dsp.js`): typically
  `Time,SpO2,PR,Motion` (and/or `Oxygen Level`,`Pulse Rate`). Vendor timestamp **`HH:MM:SS DD/MM/YYYY`**
  (O2Ring is DMY — `preferDMY:true`). Nominal **1 Hz** (or 4 s — match the parser). 7–8 h of rows.
- Render: baseline SpO₂ 95–97 %, desats per §2a, PR tracking arousals, Motion column driven by §2c/§2d.

### 3b. ECGDex — RR-interval (overnight)
- One file per night, **bare RR intervals in milliseconds, one integer per line, NO header**, filename
  carries the clock: **`YYYY-MM-DD HH-MM-SS.txt`** (matches the existing uploads). ~22 k lines for ~6–8 h.
- Render: NN driven by a realistic nocturnal HR curve (dip in deep sleep, REM rises) + CVHR oscillation
  (§2a) + periodic-breathing sinusoid (§2b) + the Night-2 hypo tachycardia/ectopy. Inject a few
  ectopic beats (short–long RR) at the hypo nadir; keep them sparse so the corrector is tested, not swamped.
- (If `ecgdex-dsp.js` also accepts raw ECG samples, RR is the simpler, sufficient lane — confirm.)

### 3c. PpgDex — Polar Sense raw set (5 companion files per night)
- `Polar_Sense_<id>_<YYYYMMDD_HHMMSS>_PPG.txt` — `Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient`, **~176 Hz**, ISO **no-zone** phone clock (`2026-05-11T23:10:00.123`), monotonic ns counter for spacing. PPG = large counts; **systole renders as a DIP** in reflected green (match the real sample's polarity). 3 green channels (slightly decorrelated noise) + ambient.
- `..._ACC.txt` (`;X [mg];Y [mg];Z [mg]`, ~26–52 Hz) and `..._GYRO.txt` (`;X/Y/Z [dps]`) — gravity baseline + motion bursts at arousals/position changes (§2c/§2d) so the **motion gate** has real input.
- `..._PPI.txt` (`Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]`) — device PPI matching the self-PPI on clean spans (validation lane). Optionally emit ONE night with an empty PPI (header only) to test that fallback (the real sample was empty).
- `MARKER_<YYYYMMDD_HHMMSS>.txt` (`Phone timestamp;Marker start/stop`) — START/STOP around analysis spans + position changes.
- Note: full-night 176 Hz PPG is huge (~5 M rows). **Emit a representative 20–40 min window per night**
  (covering ≥1 apnea cluster + ≥1 clean span), NOT the whole night — enough to exercise detection,
  morphology, motion gate, and PPI validation. State the window in a MARKER.

### 3d. PulseDex — RR / PPI intervals
- One file per night. Use the format `pulsedex-dsp.js` parses — `timestamp;RR` (ISO no-zone) OR bare RR
  ms/line. Can reuse the ECGDex NN series (same subject, same night) so the two interval-nodes agree —
  that's a built-in cross-check. Keep a couple of nights for the multi-day switcher you just added.

### 3e. GlucoDex — CGM CSV
- One file spanning **all 5 days continuously** (CGM is worn continuously), OR one per day — match the
  parser. Columns per `glucodex-dsp.js` (typically `timestamp,glucose`), **MDY** vendor format
  (`MM/DD/YYYY HH:MM`, `preferDMY:false` per CLAUDE.md), **5-min** sampling (288/day). Units: confirm
  mg/dL vs mmol/L from the parser and emit accordingly (convert the mmol targets above if mg/dL: ×18).
- Render: nocturnal hypo (Night 2), dawn phenomenon (Nights 4–5), apnea-coupled ripples, realistic noise.

### 3f. HRVDex — HRV summary log
- Welltory/HRV-style CSV the `hrvdex` parser reads: one ROW per night (or per spot reading) with
  rmssd/sdnn/HR/etc. Derive each row's metrics from that night's RR series so HRVDex agrees with
  ECGDex/PulseDex. 5 rows = the 5-night arc (improving post-intervention).

---

## 4. Cross-node coherence rules (what makes fusion testable)

1. **Same civil clock per night** across all devices (same bedtime ±a few min for realistic device-on
   skew). Same `tMs` for the same wall instant → Integrator aligns them.
2. **Shared events** (§2) drive every device — an apnea at `02:14:30` appears in all relevant signals at
   that time. Keep a machine-readable **`ground_truth.json`** per night listing every event
   (`t0Ms,type,durSec,severity`) so verification can score detector recall against truth.
3. **Designed couplings to verify:** (a) OxyDex ODI ↔ ECGDex CVHR index (both track apnea burden →
   strong positive across nights); (b) glucose-nadir ↔ HR-up / rMSSD-down on Night 2; (c) AHI↓ ↔ rMSSD↑
   at the Night-3 change point. These are exactly what the Integrator longitudinal `crossCorrelations`
   and the fusion timeline should surface.
4. **Node exports for the Integrator:** after generating raw files, the intended flow is: load each raw
   set into its app → export the `ganglior.node-export` v2.0 + multi-session `crossNight` envelopes →
   drop those into the Integrator. The synthetic raw data is the seed; the apps do the rest unchanged.

---

## 5. Implementation shape (suggested)

- A single generator: `synth-gen.html` (+ `synth-gen.js`) — a small local tool with a "Generate corpus"
  button. Pure JS, no deps, obeys the Clock Contract (build `tMs` via `Date.UTC(components)`; format
  per-device with the right vendor pattern). Writes via the file tools / a downloadable zip.
- Structure: a `MasterTimeline(nightConfig) → events[]` core, then `renderOxy/renderECG/renderPPG/
  renderPPI/renderACC/renderGYRO/renderGluco/renderHRV(events, nightConfig)` emitters that each sample
  their signal off the shared events. One physiology-knob config object up top (AHI, HR curve, glucose
  targets per night) so the arc is tunable.
- Determinism: seed the RNG so the corpus is reproducible (same files every run) — important for
  regression testing.

---

## 6. Verification

1. **Format parity:** each app loads its synthetic files with NO code change, no parse warnings, and
   first/last shown timestamp == file exactly (Clock round-trip).
2. **Clock coherence:** the same event's `tMs` matches across devices (diff = 0 for the shared instant).
   Re-render under a changed `TZ` → identical clocks (floating, viewer-independent).
3. **Physiology lands:** OxyDex ODI/AHI ≈ the night's target ±15 %; ECGDex CVHR fires on apnea nights;
   GlucoDex shows the Night-2 hypo + Nights 4–5 dawn rise; PpgDex motion gate rejects the injected
   bursts; periodic-breathing screen catches the Night-2 CSR run.
4. **Couplings present:** after exporting envelopes into the Integrator, longitudinal
   `crossCorrelations` shows ODI↔CVHR positive and the Night-3 change point; the fusion timeline
   co-locates the apnea events across signals.
5. **Detector recall vs `ground_truth.json`:** ≥80 % of injected apneas detected on clean spans;
   precision sane (few false events on the clean low-motion span).
6. **Realism guardrails:** signals are NOT clean — dropouts/motion present — yet each night has ≥1
   analyzable span so no metric is all-null.

---

## 7. Build order

1. `MasterTimeline` + `ground_truth.json` + the 5-night config arc (§1–2). Verify the event lists read sane.
2. **OxyDex CSV** emitter (simplest, highest-value) — load in OxyDex, confirm ODI/desats match targets.
3. **ECGDex RR** emitter (CVHR + hypo ectopy) — load, confirm CVHR + HRV arc.
4. **GlucoDex CGM** emitter (hypo + dawn) — load, confirm glucose events + the Night-2 coupling.
5. **PpgDex** raw set (windowed) + ACC/GYRO/PPI/MARKER — load, confirm detection + motion gate + validation.
6. **PulseDex** (reuse ECG RR) + **HRVDex** summary rows.
7. Export all → **Integrator**; confirm fusion + longitudinal couplings + Night-3 change point (§6.4).
8. Seed the RNG; document the corpus in a short `SYNTHETIC-CORPUS-README.md` (subject, arc, event truth).

---

## 8. Done criteria

- `uploads/synthetic/` holds a full 5-night corpus for OxyDex, ECGDex, PpgDex, PulseDex, GlucoDex,
  HRVDex, each in the app's native format, plus per-night `ground_truth.json`.
- Every app loads its files unchanged, with Clock round-trip intact and physiology matching the arc.
- The planted cross-signal couplings (ODI↔CVHR, hypo↔HRV, AHI↔HRV change point) are detectable by the
  Integrator's fusion + longitudinal engines.
- Reproducible (seeded), 100 % local, documented.
