<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-24 · **Created:** 2026-07-24 · **Related:** `CAPTURE-HOST-2026-06-29-BRIEF.md` (the capture daemon) · `INTEGRATOR-BUILD-BRIEF.md` (the fusion layer) · `TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md` (the trio ingester)

# Capture-host → Integrator: folding real overnight recordings, and two defects it exposed

> **What this is.** A record of driving the **real `capture-host` overnight recordings** all the way through
> the **Integrator** headlessly — raw BLE files → per-node `ganglior.node-export` → `runFusion` — across the
> whole roster (ECGDex · PpgDex · OxyDex · MotionDex · CPAPDex · PulseDex), plus the **two real defects** the
> exercise surfaced and their fixes. The fold work itself is a diagnostic (no committed pipeline); the two
> code fixes are the shippable half and are gated below.

---

## 0 · TL;DR

- The capture-host writes **Polar-Sensor-Logger-compatible CONTENT under a different FILENAME layout**, in
  **per-night subdirectories**. Neither the names nor the nesting were understood by the headless trio
  ingester (`tools/trio-batch.mjs`), so a real capture night ingested as **zero trios** without a manual
  rename+flatten shim. **FIX 1** teaches the scanner both layouts and makes it recurse.
- **ECGDex's node-export omitted any recording DURATION.** An event-sparse ECG segment therefore collapsed
  to a **zero-length window** in the Integrator and was **excluded from the fold's overlap**, silently
  dropping the strongest concurrent leg. **FIX 2** stamps `recording.durSec` (the key the adapter already
  honors for MotionDex).
- With both fixes, **7 of the last 9 capture nights ingest natively** and fold cleanly. A **6-corner** fold
  (07-17…07-20) cross-checks the **CPAP device-scored AHI** (1.3–5.5/hr, mild/controlled) against the
  Integrator's independent confirmed-apnea index (~0, below chance) — they agree.

---

## 1 · The headless fold pipeline (how to reproduce)

**Inputs on disk (this box).**
- BLE capture-host nights: `/home/michal/tepna-smoketest/captures/<YYYY-MM-DD>/` — one dir per calendar day
  (`Polar_H10_…_ECG.txt`, `Polar_VeritySense_…_PPG.txt`, `Wellue_O2Ring-S_…_SPO2.csv`, ACC/GYRO/MAG, and a
  `stored/` dir of onboard `…_STORED.dat` backups).
- CPAP: `/run/media/michal/647A504F7A50205A/Ecg nightly/CPAP/<YYYYMMDD>/` — ResMed AirSense EDF sets
  (`BRP/PLD/SA2/EVE/CSL`), one dir per **evening/night** date, Jan–Jul 2026. `EVE` carries the device-scored
  apnea/hypopnea events (→ AHI). *(The June Polar-Sensor-Logger corpus incl. real H10 `_RR.txt` also lives
  under `Ecg nightly/`.)*

**Steps.**
1. **Raw → trio node-exports:** `node tools/trio-batch.mjs --src <captures> --out <dir>` → per-night
   `ECGDex/PpgDex/OxyDex_*.node-export.json`. (After FIX 1 this reads the capture-host tree directly.)
2. **CPAPDex:** namespaced vm realm loading `kernel-constants·clock·signal-frame·dex-export·metric-registry·
   crossnight-envelope·cpapdex-{registry,edf,dsp,cross,fusion}.js`; `CpapEdf.readEDF(arrayBuffer)` per EDF →
   `CPAPDex.compute({edfSets:[set]})` → node-export (device-AHI + apnea/leak events).
3. **MotionDex:** `MOTIONDSP.compute({acc,gyro,mag,chestAcc})` on the raw ACC text — **H10 chest ACC = posture
   source, Verity wrist ACC = actigraphy.** Use ONE segment per stream (concatenating fragments overflows the
   JS string limit and inflates `durSec`).
4. **PulseDex (from ECG):** `ECGDSP.parseECG → bandpass → detectPeaks`; RR = Δpeaks/fs·1000; feed
   `PulseDex.parseRRInput(text) → compute → buildNodeExport`. NB `ECGDex.compute()`'s **return does not expose
   the RR series** — it must be re-derived from the peaks.
5. **Fold:** load `clock·kernel-constants·crossnight-envelope·integrator-dsp.js` in a vm realm (mirror
   `tests/run-tests.mjs`), then `IntegratorDSP.normalizeFile(json) → dedupeRecs → runFusion(RECS,
   {toleranceSec:120}) → buildFusionExport`.

**Night key = date(start − 12 h)** — an overnight sleep lands under the EVENING it began. Fold eligibility gate
= ≥ 1 h three-way concurrent overlap.

---

## 2 · Findings

**Corpus eligibility (nights 07-16 … 07-24, native scan after FIX 1).** 7 fold: 07-16 (1.0 h), 07-17 (1.5 h),
07-18 (1.6 h), 07-19 (3.4 h), 07-20 (1.1 h), 07-21 (2.4 h), 07-22 (1.1 h). Rejected: 07-23 (0.4 h — PPG/O2Ring
fragmented). The onboard `STORED.dat` is a materially better O2Ring anchor than the fragmented live SpO₂ CSVs.

**CPAP device-AHI cross-check (07-17…07-20, 6-corner fold).** The Integrator carries the ResMed `EVE`-scored
AHI as **top-tier authority**, and on every night it agrees with the Integrator's independent SpO₂+HR
confirmed-apnea index:

| Night | all-node overlap | CPAP device AHI | Integrator confirmed idx |
|-------|------------------|-----------------|--------------------------|
| 07-17 | 111 min | 5.44/hr | 0.00 · below chance |
| 07-18 | 89 min  | 2.93/hr | 0.00 · below chance |
| 07-19 | (see note) | 1.27/hr (incl. a device-scored central apnea) | 0.00 · below chance |
| 07-20 | 38 min  | 5.50/hr | 0.00 · below chance |

**HRV consensus (ECG ↔ Verity armband PPG).** Tight on 07-19/20/21/22 (RMSSD divergence Δ0–6%); **diverges
70–76% on 07-17 & 07-18** — the armband PPG HRV is unreliable those nights (motion; the armband is far more
motion-prone than a finger clip). The fusion layer flags it; a single-signal pipeline would have trusted it.

**Node input reality (do not overstate coverage).** ECG/PPG/O2Ring/Motion/CPAP have honest inputs.
**PulseDex** derived from the H10 ECG is *source-correlated* with ECGDex — it ingests and contributes RR-domain
metrics but adds **no independent HRV leg** (the consensus block stays `[ECG+PPG]`); an independent PulseDex
needs the June `_RR.txt` device files. **HRVDex has NO input in this corpus** (needs a Welltory summary CSV;
none exists) and **GlucoDex** has none (no CGM). Manufacturing either from ECG-derived numbers would re-badge
ECGDex's output, not measure anything new.

---

## 3 · Defect 1 — trio-batch does not ingest the capture-host layout

**Symptom.** `node tools/trio-batch.mjs --src <capture night> --dry-run` → `trio nights: 0`, despite a full
ECG+PPG+SpO₂ night on disk.

**Root cause.** Two independent mismatches vs the Polar-Sensor-Logger layout the scanner was built for:
1. **Filenames.** capture-host writes `Polar_VeritySense_<serial>_<YYYYMMDDHHMMSS>_<STREAM>.txt` (one 14-digit
   stamp, device token `VeritySense`, stream `MAG`) and `Wellue_O2Ring-S_<serial>_<14>_SPO2.csv` /
   `…_STORED.dat` — none matched `RE_POLAR`/`RE_O2`/`RE_O2_DAT`. **File CONTENT is byte-identical** to what the
   DSPs parse (the ECG header matches the committed ECGDex fixture exactly), so only the *names* diverged.
2. **Nesting.** capture-host writes **one subdirectory per night** (+ a `stored/` dir); the scanner did a
   **flat** `readdirSync(SRC)` and never recursed.

**FIX (`tools/trio-batch.mjs`, tool-only — no bundle / no `manifestHash`).**
- Added `RE_POLAR_CH` / `RE_O2_CH` / `RE_O2_DAT_CH` and normalized both layouts to the same `{dev, stream, t0}`
  (`VeritySense→Sense`, `MAG→MAGN`, 14-digit stamp via `parse14`) before the shared routing.
- Switched the scan to `readdirSync(SRC, {recursive:true})` matching on `basename` — back-compat for the flat
  Polar corpus, and it now walks the capture-host per-night subdirs + `stored/`.

**Verified.** `node tools/trio-batch.mjs --src /home/michal/tepna-smoketest/captures --dry-run` → **7 trio
nights** detected with no shim (was 0).

---

## 4 · Defect 2 — ECGDex export declares no duration → excluded from the fold

**Symptom.** An event-sparse ECG leg folds with `window {startMs==endMs}` and `nodesExcluded:[ECGDex]`, so the
all-node overlap collapses to 0 even though the raw ECG genuinely overlapped the other nodes.

**Root cause.** `integrator-dsp.js adaptEnvelopeNode` derives a rec's `endMs` from `recording.endEpochMs` /
`durationMin` / `durationSec` / **`durSec`** (added generically for MotionDex, DEEP-AUDIT-II §7.6), else from
the **last event**. `ecgdex-dsp.js ecgBuildNodeExport` emitted `recording:{source, contentId, startEpochMs,
offsetMin, events}` — **no duration key at all** — so an ECG segment that trips no arrhythmia/CVHR event
(`events:0`) had `endMs = t0Ms` → a zero-length window → excluded from the overlap intersection. ECGDex *knows*
its length (`analyze()` returns `durSec`); it simply never declared it.

**FIX (`ecgdex-dsp.js`, behavioral — moves the ECGDex export + `manifestHash`).** Stamp
`durSec: r.durSec != null ? r.durSec : null` into the export's `recording` block. Additive, back-compat, and it
uses the key the adapter already honors.

**Gate chain run (node lane).**
- `regen-goldens --node ECGDex` → both goldens gained `recording.durSec` (synthetic 59.4 s; `2026-06-27_equiv`
  360.9 s = the 6-min clip), outputHashes re-recorded.
- `build.mjs --app ECGDex` + rebundle of the two orchestrators that inline `ecgdex-dsp.js`
  (`Data Unifier.html`, `OverDex.html`); `build.mjs --check` → **clean (11 owned bundles)**.
- `tests/run-tests.mjs` (no corpus, = CI) → **3871 passed, 12 skipped (green)**; with the corpus the
  `equiv.ecgdex` leg (synthetic + real clip) **passes**.
- `tests/verify-manifest.mjs` → **GATE A all 9 bundles match · GATE B 12 reproducible**.

---

## 5 · Acceptance

- [x] trio-batch ingests the capture-host tree natively (7 nights, no shim).
- [x] ECGDex export carries `recording.durSec`; both goldens regenerated; an event-sparse ECG leg now folds
      with a real window (no `nodesExcluded:[ECGDex]` on a genuinely-overlapping segment).
- [x] `build.mjs --check` clean; `run-tests.mjs` green (CI lane); `verify-manifest.mjs` GATE A+B pass.
- [x] Changeset dropped (`changes/2026-07-24-fold-pipeline-fixes.md`).

## 6 · Follow-ups (owed / out of scope here)

1. **`verifiedUnder` re-stamp is owed FLEET-WIDE, not just for ECGDex.** `verify-fixtures.mjs --check` reports
   **all 14 corpus-backed fixtures UNVERIFIED** under the current compute closures (PulseDex/GlucoDex/PpgDex/
   HRVDex/CPAPDex/Integrator/OxyDex + ECGDex) — a pre-existing condition (compute paths moved across the fleet
   without a corpus-green `verify-fixtures` run). It is **blocked** by a pre-existing **OxyDex real-summary
   equiv drift** (the O2Ring corpus input has drifted ~0.2–4 % from `OxyDex_2026-06-13_1056` /
   `_2026-06-25_0439` — visible only with a corpus, invisible to CI). Resolution (maintainer, with corpus):
   `regen-goldens --node OxyDex`, then `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. **Not my
   regression** — my diff touches no OxyDex file — and it does not block CI or this brief.
2. **Independent PulseDex** — fold a June night from `Ecg nightly/` (real H10 `_RR.txt`) to add a genuine 3rd
   HRV corner instead of the ECG-rederived one.
3. **HRVDex / GlucoDex** — no input exists in this corpus (Welltory summary CSV / CGM). Nothing to fold until
   such an export is captured.
4. **Multi-segment MotionDex** — this exercise used the single largest ACC segment per night; stitching the
   night's fragments (sorted, gap-aware) would give full-night posture instead of the main sleep block.
