<!--
  SIGMA-WINDOW-DERIVATION.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Adding a three-device σ window — derivation path + capture protocol

Companion to `VERITY-SIGMA-CORNER-BRIEF.md`. Part A (the multi-window software) is **done**:
`sigma-no-reference-analysis.js` reads a `TRIOS[]` array of three-device windows, solves each with
the same three-cornered-hat (TCH) kernel, and reports a per-device σ **distribution** (median + CI +
N_windows + total simultaneous seconds) with a negative-variance check and the H10↔O2Ring control
leg. The binding constraint now is **data**: only one window (06-16/17) currently has all three
raw-derived HR series committed, so the CI is a *within-window* block bootstrap. Every window you add
moves it toward the across-window distribution the paper's §6 calls "recommended" (5–10 windows).

This file is the per-night recipe to mint a new `TRIOS` entry, plus the capture protocol to hand the
wearer.

---

## A. What a window needs (three time-aligned 1-Hz HR series)

| Leg | Source file (raw) | Detector (run, do **not** modify) | Commit as |
|---|---|---|---|
| **Verity** HR | `Polar_Sense_*_PPG_part*of*.txt` (raw PPG) | `PPGDSP.analyze` (`ppgdex-dsp.js`) — SQI-gated | `uploads/verity-ppg-derived-YYYY-MM-DD-HR.txt` |
| **H10** HR (gold) | `Polar_H10_*_ECG_part*of*.txt` (raw ECG) | `ECGDSP` Pan-Tompkins QRS (`ecgdex-dsp.js`) | `uploads/h10-ecg-derived-YYYY-MM-DD-HR.txt` |
| **O2Ring** pulse | `O2Ring S 2100_*.csv` (native per-second) | none — used as-is | already committed |

The two derived files are compact 1-Hz text in the format the tool ingests:

```
tMs;hr;sqiMean        # Verity   (col0 = floating-ms second, col1 = bpm, col2 = mean SQI of the second)
tMs;hr;src            # H10      (src = "ecg")
```

`tMs` is **Clock-Contract floating ms** (`Date.UTC(...)` of the local civil time), one row per whole
second. The onboard `*_RR.txt` is kept only as a same-device concordance check on the ECG leg
(should agree at bias≈0, SD≈2.3).

---

## B. Derivation procedure (mirror how the committed 06-17 files were produced)

The raw waveforms are **large** (a full overnight PPG part-set is millions of rows, ~135 Hz × hours;
ECG ~130 Hz). Derive headlessly, in a context that can load the production detectors and stream the
parts — **not** inside the analysis tool, which only ingests the finished 1-Hz files.

1. **Concatenate the night's parts in order** (`part01of15` → `part15of15`, etc.). Keep the header
   from part 1; drop repeated headers.
2. **Parse timestamps with the Clock Contract** — the Polar export's `Phone timestamp` column is
   ISO-8601 no-zone (`2026-06-15T21:53:27.809`). Regex it into floating ms (`Date.UTC(...)`); **never**
   `new Date(str)`. Use the *phone* timestamp column for the wall clock (the `sensor timestamp [ns]`
   is a monotonic device counter, not civil time).
3. **Run the detector unchanged on the concatenated record:**
   - **Verity:** `PPGDSP.analyze(rec)` → per-beat times + `sqi[]`. Keep beats with SQI above the gate
     the committed file used (SQI ≈ 0.95–1.0). Resample surviving beats to **1-Hz mean instantaneous
     HR**; write `sqiMean` per second.
   - **H10:** `ECGDSP` band-pass + Pan-Tompkins `detectPeaks` → R-peaks → instantaneous HR →
     1-Hz mean.
4. **Gate and write.** Drop seconds with no clean beat. Emit one `tMs;hr;…` row per second, `tMs`
   ascending. Filename uses the **morning date** of the overnight window, matching the existing pair
   (`…-2026-06-17-HR.txt` for the 06-16→17 night).
5. **Commit both derived files to `uploads/`**, then append a `TRIOS` entry in
   `sigma-no-reference-analysis.js`:

   ```js
   {
     label: '2026-06-DD/DD · HH:MM–HH:MM',
     h10:   'uploads/h10-ecg-derived-YYYY-MM-DD-HR.txt',
     h10rr: 'uploads/Polar_H10_..._RR.txt',   // optional concordance leg
     o2:    'uploads/O2Ring S 2100_....csv',
     verity:'uploads/verity-ppg-derived-YYYY-MM-DD-HR.txt',
   }
   ```

   The builder intersects the three on the floating-ms grid and keeps the span only if ≥1,000
   simultaneous seconds survive — no further wiring needed.

6. **Re-run the tool** (`Run corpus`). Confirm: the new window appears in the per-window table; its
   **H10↔O2Ring control leg is green** (bias≈0, SD≈2.7 — a red here means the window is mis-aligned,
   fix before trusting it); no **⚠** negative-variance flag; Verity σ is the largest of the three but
   finite. At N≥3 the CI label flips from `within-window` to `across-window`. Re-export
   `sigma-no-reference-stats.json` and regenerate `figures/sigma-tch.png` for the paper.

> **Gate note (CLAUDE.md §5):** this touches only the analysis tool and `uploads/` data — it does
> **not** re-bundle a Dex node or move provenance, so the Dex-Test-Suite / provenance gates do not
> apply *unless* you modify `ppgdex-dsp.js` / `ecgdex-dsp.js` themselves. Only *run* them.

---

## C. Capture protocol — hand this to the wearer (the real unlock)

The single binding constraint is **simultaneous three-device time with Verity raw PPG logged**. Per
session:

1. **Wear all three at once:** O2Ring (finger), Polar H10 (chest strap), Verity Sense (upper arm).
2. **In Polar Sensor Logger** (`com.j_ware.polarsensorlogger`):
   - For the **Verity Sense, enable raw PPG logging.** Its onboard HR/PPI is useless (all-zero across
     the whole corpus, confirmed) — the raw photodiode waveform is the only way to recover its HR.
   - For the **H10, enable raw ECG** (in addition to RR), so the gold leg is QRS-derived.
3. **Aim for 5–10 sessions on different nights.** That is what turns the single-window σ into a
   distribution with an across-window CI and lets the uncorrelated-error assumption be tested
   (the paper's "recommended" tier).
4. **Include at least one non-resting session** — e.g. a walk or light exercise plus recovery. All
   current data is resting, where true HR variance is tiny (pairwise r ≈ 0.5 despite small bias); a
   high-slew session bounds error where it matters and de-confounds σ from the low-variance regime.
5. **Intake route:** raw PPG/ECG parts are large and exceed the 20 MB direct-upload limit — **push to
   GitHub** (most reliable) or **link a local folder**. Small files (H10 RR, O2Ring CSV) upload fine
   directly. Note: a prior local-code link did **not** surface the raw captures to the agent, whereas
   GitHub import worked.
6. **One window per continuous span** — don't split a single uninterrupted overlap into several
   "windows"; different nights/sessions are what add independent information.

When new sessions arrive, follow §B per night to mint each `TRIOS` entry.

---

## D. Ready-to-run commands — the four derivable nights in this corpus

Each night below has a **full three-device raw set** in the `Ecg nightly/` folder (Verity raw PPG +
H10 raw ECG + O2Ring CSV). Their small files (O2Ring CSV + H10 RR) are **already copied into
`uploads/`**, and the matching `TRIOS[]` blocks are **already staged (commented)** in
`sigma-no-reference-analysis.js`. So per night the flow is just: run the command → drop the two
derived files in `uploads/` → uncomment that night's `TRIOS` block → re-run the tool.

Run each from the **project root** (Node ≥ 18; the script loads `./ppgdex-dsp.js` + `./ecgdex-dsp.js`):

```bash
# 06-10/11 → derived date 2026-06-11
node tools/derive-sigma-window.mjs \
  --ppg "Ecg nightly/Polar_Sense_BBBBBBBB_20260610_211539_PPG.txt" \
  --ecg "Ecg nightly/Polar_H10_AAAAAAAA_20260610_211535_ECG.txt" \
  --date 2026-06-11 --out uploads

# 06-11/12 → derived date 2026-06-12
node tools/derive-sigma-window.mjs \
  --ppg "Ecg nightly/Polar_Sense_BBBBBBBB_20260611_210416_PPG.txt" \
  --ecg "Ecg nightly/Polar_H10_AAAAAAAA_20260611_210411_ECG.txt" \
  --date 2026-06-12 --out uploads

# 06-13/14 → derived date 2026-06-14
node tools/derive-sigma-window.mjs \
  --ppg "Ecg nightly/Polar_Sense_BBBBBBBB_20260613_204525_PPG.txt" \
  --ecg "Ecg nightly/Polar_H10_AAAAAAAA_20260613_204450_ECG.txt" \
  --date 2026-06-14 --out uploads

# 06-15/16 → derived date 2026-06-16
node tools/derive-sigma-window.mjs \
  --ppg "Ecg nightly/Polar_Sense_BBBBBBBB_20260615_215327_PPG.txt" \
  --ecg "Ecg nightly/Polar_H10_AAAAAAAA_20260615_215322_ECG.txt" \
  --date 2026-06-16 --out uploads
```

(If a night's PPG/ECG was exported in multiple parts, repeat `--ppg` / `--ecg` once per part in
order — the script concatenates them.) The script prints `meanSQI` and the derived second-count for
each leg; expect Verity `meanSQI` ≈ 0.9–1.0 on a clean resting night. Doing **all four** takes N from
1 → 5 windows, which flips the reported CI from within-window to **across-window** and lets the
uncorrelated-error assumption be tested directly — the paper's "recommended" tier.

After each re-run, sanity-check (per §B step 6): the new window's **H10↔O2Ring control leg is green**
(bias≈0, SD≈2.7), no **⚠** negative-variance flag, Verity σ largest but finite. Then re-export
`sigma-no-reference-stats.json` and regenerate `papers/figures/sigma-tch.png`, and update Table 3 /
§6 in `papers/sigma-no-reference.html` to the new N.

> The two derived files per night are a few hundred KB each (well under the 30 MiB ingest limit) — it
> is only the **raw** PPG/ECG (~150–350 MB) that must stay local, which is why this one DSP step runs
> on your machine rather than in the design tool.
