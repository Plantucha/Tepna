# BRIEF — Verity σ corner: from one overlap window to a distribution with a CI

**Author of brief:** design/analysis agent · June 2026
**For:** AI coder picking this up fresh (self-contained — read top to bottom before editing)
**Paper affected:** `papers/sigma-no-reference.html` ("Measuring a device's σ without a canonical
reference: heart-rate error across O2Ring, Polar H10 and Verity Sense")
**Tool:** `sigma-no-reference-analysis.html` + `sigma-no-reference-analysis.js`
**Honor `CLAUDE.md`** (Clock Contract especially) throughout.

---

## 0. TL;DR
The paper's three-cornered-hat (TCH) gives a **reference-free per-device σ** for O2Ring (1.67), H10
(2.17) and **Verity (6.22) bpm** — but the Verity number rests on a **single 7,057-second overlap
window** (night 06-16/17), so it has **no confidence interval and no test of the TCH's
uncorrelated-error assumption**. O2Ring's σ is well-determined (6 pair-nights, 126k s); H10 and
Verity are not. Two-part fix: **(A) software** — generalize the TCH from one window to *N* windows,
emit per-window σ + an aggregate σ with a CI, and add an error-correlation check; **(B) data** — a
capture protocol that produces more simultaneous **3-device** windows (the binding constraint), since
Verity's only usable HR comes from **raw PPG** (its onboard HR/PPI streams are dead — 0 usable across
the whole corpus).

---

## 1. Why Verity is the weak corner (verified facts)

- **Verity onboard HR/PPI is unusable.** In `sigma-no-reference-analysis.js` the `VERITY[]`
  capture-quality probe reports `hrUsable: 0` (and `ppiUsable: 0`) for **every** night — the band's
  firmware never locks a pulse. The ONLY way to get Verity HR is to derive it from the **raw PPG**
  waveform with the suite's `PPGDSP` (SQI-gated). That derivation exists for exactly one night,
  committed as `uploads/verity-ppg-derived-2026-06-17-HR.txt`.
- **The TCH uses ONE window.** In the analysis JS, `TRIO` is a single object:
  ```js
  const TRIO = {
    label: '2026-06-16/17 · 01:06–03:04',
    h10:   'uploads/h10-ecg-derived-2026-06-17-HR.txt',     // H10 HR from raw ECG (Pan-Tompkins QRS) = gold leg
    h10rr: 'uploads/Polar_H10_AAAAAAAA_20260617_010614_RR.txt', // onboard RR (concordance check)
    o2:    'uploads/O2Ring S 2100_20260616221235.csv',
    verity:'uploads/verity-ppg-derived-2026-06-17-HR.txt',  // Verity HR from raw PPG (PPGDSP, SQI-gated)
  };
  ```
  It yields per-device σ over 7,057 simultaneous seconds (verSQI=1). Single window → point estimate,
  no CI, can't test assumptions.
- **The 6 pair-nights don't help Verity.** They are H10-RR + O2Ring only (two devices) → they pin
  **O2Ring** σ by variance-subtraction, never Verity.
- **TCH math & its assumption:** for three devices A,B,C measuring the same truth with *uncorrelated*
  errors, σ²_A = ½(V_AB + V_AC − V_BC) where V_XY = var(X−Y). With one window you get one triple of
  pairwise variances and no way to know if the "uncorrelated" assumption holds (the current code
  already carries a `neg` flag for when a variance goes negative — the tell-tale of correlated errors
  or an over-concordant pair).

## 2. Part A — software (do this now; works with whatever windows exist)

Goal: make the tool consume **multiple** 3-device overlap windows and report a σ **distribution**.

1. **Generalize `TRIO` → `TRIOS[]`** (array of the same shape). Each entry = one simultaneous
   window with all three series (Verity raw-PPG-derived HR, H10 raw-ECG-derived HR, O2Ring native).
2. **Per-window TCH:** compute σ_A/σ_B/σ_C and the three pairwise {bias, SD, LoA, Arms, r} per window
   (the existing single-window code becomes the per-window kernel). Keep the `neg`-variance flag.
3. **Aggregate across windows:** report, per device, the **median σ and a CI** (bootstrap over
   windows, or mean ± t·SE if ≥~5 windows). Show N_windows and total simultaneous seconds. This is
   the headline upgrade: Verity σ = 6.2 [CI …] over k windows, instead of a bare 6.2.
4. **Test the uncorrelated-error assumption:** across windows, flag instability (σ that swings wildly,
   or any window with a negative variance). Optionally add the H10↔O2Ring leg as a built-in control —
   it should be the tight, stable pair every window (bias ≈ 0, SD ≈ 2.7); if it drifts, that window's
   alignment is suspect.
5. **Window builder:** add a helper that, given the per-night raw files, finds the maximal
   all-three-present time span (intersection of the three series' [t0,t1] on the Clock Contract's
   floating-ms axis) and emits a TRIO entry. Only keep spans ≥ ~1,000 s with Verity SQI above
   threshold. (One night can yield one window; don't fabricate multiple from the same continuous span.)
6. **Tables/figures:** update Table 3 (per-device σ + CI + N_windows) and Figure 2 (σ bars become σ
   bars **with error bars**; optionally a per-window strip plot).

Clock Contract: the tool already mirrors `parseTimestamp` (ISO-no-zone for Polar, `HH:MM:SS
DD/MM/YYYY` DMY for O2Ring). Any new parsing of raw PPG/ECG part files MUST regex the explicit format
into floating-ms (`Date.UTC(...)`), never `new Date(str)`; align windows on `tMs`.

## 3. Part B — the derivation pipeline (per new night, to make a TRIO entry)

Each new 3-device window needs three time-aligned 1-Hz HR series:
- **Verity HR ← raw PPG:** concatenate the night's `Polar_Sense_*_PPG_part*of*.txt` parts (the
  06-16 night has 15 parts), run the suite's **`PPGDSP`** (`ppgdex-dsp.js`, `PPGDSP.analyze`) to get
  SQI-gated beats → resample to 1-Hz mean instantaneous HR. Gate out low-SQI spans (the existing
  derived file used SQI≈0.95–1.0). Commit as `uploads/verity-ppg-derived-YYYY-MM-DD-HR.txt` in the
  same column format as the existing one.
- **H10 HR ← raw ECG (gold leg):** concatenate `Polar_H10_*_ECG_part*of*.txt`, run **`ECGDSP`**
  (Pan-Tompkins QRS, `ecgdex-dsp.js`) → 1-Hz HR. Commit as `uploads/h10-ecg-derived-YYYY-MM-DD-HR.txt`.
  Keep the onboard `*_RR.txt` as a same-device concordance check (it should agree with the ECG-derived
  leg at bias≈0, SD≈2.3 — a guard that the QRS derivation is sound).
- **O2Ring:** native per-second pulse CSV, as today.
- These derivations REUSE the production detectors unchanged — you are running them on more data, not
  modifying them. (If you script the derivation headlessly, mirror how the committed 06-17 files were
  produced.)

## 4. Part B — capture protocol (hand to the user; this is the real unlock)
The binding constraint is **simultaneous 3-device time with Verity raw PPG logged**. Tell the user, per
session:
- Wear **all three at once**: O2Ring (finger), Polar H10 (chest), Verity Sense (arm).
- In **Polar Sensor Logger**, for the Verity, **enable raw PPG logging** (the onboard HR/PPI is
  useless — confirmed). For the H10, **enable raw ECG** (so the gold leg is QRS-derived) in addition
  to RR.
- Aim for **5–10 sessions** on different nights → turns the single-window σ into a distribution with a
  CI and lets the uncorrelated-error assumption be tested (paper's own "recommended" tier).
- Include **at least one non-resting session** (e.g. a walk / light exercise + recovery). All current
  data is resting, where true HR variance is tiny — that's why pairwise r is only ≈0.5 despite small
  bias. A high-slew session bounds error where it matters and de-confounds σ from the low-variance
  regime.
- Intake route: **link a local folder** or **push to GitHub** — raw PPG parts are large and exceed the
  20 MB upload limit (the local-code link in this project did NOT surface the raw captures to the
  agent; GitHub import worked reliably). Small files (H10 RR, O2Ring CSV) upload fine directly.
- Last night (06-18) currently has **O2Ring only** — no H10/Verity — so it can't extend the set as-is.

## 5. Validation & gates
- **Not a bundled-detector change.** Part A edits the analysis tool (`sigma-no-reference-analysis.*`),
  not a Dex node, so it does NOT require re-bundling an app or moving provenance — UNLESS you modify
  `ppgdex-dsp.js`/`ecgdex-dsp.js` themselves (don't; only *run* them). If you do touch a node, the full
  CLAUDE.md gate applies (Dex-Test-Suite, re-bundle, provenance).
- **Sanity checks:** the H10↔O2Ring leg must stay tight (bias≈0, SD≈2.7) in every window — it's the
  built-in control. Verity σ should be the largest of the three (PPG at the wrist is noisiest) but
  finite and stable; a window producing a negative TCH variance must be surfaced, not hidden.
- **Honest reporting:** if only 1–2 windows exist after the software work, say so — report σ with the
  N_windows and a CI that reflects the small N, rather than implying robustness. The paper's
  sample-size table (§6, "Three-cornered-hat per-device σ" row) already states minimum = 1 window
  (current), recommended = 5–10 windows; keep that framing and update the achieved N.

## 6. Paper updates (`papers/sigma-no-reference.html`)
- §3.2 + Table 3 + Figure 2: per-device σ **with CI and N_windows**; add the per-window spread.
- Limitations: downgrade "single … window" once N>1; keep "single subject" until multi-subject.
- §6 sample-size table: update the achieved three-cornered-hat row to the new N_windows.
- Keep all numbers traceable to a fresh tool run; export `sigma-no-reference-stats.json`.

## 7. Definition of done
- [ ] `TRIO` generalized to `TRIOS[]`; per-window TCH kernel; window-intersection builder (Clock-
      Contract aligned).
- [ ] Aggregate per-device σ with CI + N_windows + total simultaneous seconds.
- [ ] Uncorrelated-error / negative-variance instability check; H10↔O2Ring control leg surfaced.
- [ ] Derivation path documented/scripted for new nights (raw PPG→PPGDSP, raw ECG→ECGDSP), committed
      as `*-derived-*-HR.txt`.
- [ ] Capture protocol delivered to the user (3-device + Verity raw PPG + ≥1 non-resting session).
- [ ] Tables 3 + Figure 2 + Limitations + §6 updated; stats.json re-exported.
- [ ] If any node code was touched (shouldn't be): full CLAUDE.md gate.

## 8. Pointers (files)
- Tool: `sigma-no-reference-analysis.html` / `.js` (`TRIO` ~line 54; `VERITY[]` probe ~line 62;
  `fetchText`, interval→1-Hz HR, TCH math, exporters).
- Derivation detectors (run, don't modify): `ppgdex-dsp.js` (`PPGDSP.analyze`, SQI), `ecgdex-dsp.js`
  (Pan-Tompkins QRS).
- Existing derived series (format templates): `uploads/verity-ppg-derived-2026-06-17-HR.txt`,
  `uploads/h10-ecg-derived-2026-06-17-HR.txt`.
- Raw inputs (06-16/17 window): `uploads/Polar_Sense_BBBBBBBB_20260616_221114_PPG_part01of15.txt` …
  `part15of15.txt` (Verity raw PPG); `uploads/Polar_H10_AAAAAAAA_20260617_010615_ECG_part01of05.txt` …
  `part05of05.txt` (H10 raw ECG); `uploads/O2Ring S 2100_20260616221235.csv`.
- Paper: `papers/sigma-no-reference.html`. Prior context: `papers/PAPERS-AUDIT.md`.
- Clock Contract: `CLAUDE.md` §"THE CLOCK CONTRACT" + Polar Sensor Logger provenance note.
