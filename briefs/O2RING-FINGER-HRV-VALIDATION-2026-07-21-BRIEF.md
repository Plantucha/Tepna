<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-21 · **Executes:** `OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md` §1 · **Method-parent:** `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` · **Data:** `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`

# O2Ring finger-PPI HRV — ECG validation, and the emerging→validated tier call

> **What this brief is.** The executable validation that `OXYDEX-PULSE-RESOURCING-FOLLOWUPS §1` asks for:
> does the **O2Ring finger** PPI HRV (`site:'finger'` PpgDex — whole-record RMSSD, sdnnRobust, and
> `cvhrFromNN`) reproduce paired **Polar H10 chest-ECG** HRV closely enough to lift
> `Integrator.fuseHrvResource` / `fuseCvhrCorroboration` from `emerging` to `validated`? It records a
> **preliminary n=2 measurement** already taken (§2), then specifies the **rigorous method** — borrowed
> from the Verity deep-dive — to settle it on the overnight tri-device corpus (§4), the **decision
> criteria** (§5), and the **acceptance gates** (§6). Every number below is `[CORPUS]` (measured here),
> `[CODE]` (read from source), `[LIT]` (literature), or `[OPEN]`.
>
> ⚠️ **Scope guard — this is the O2Ring FINGER, not the Verity WRIST.** `PPGDEX-ALGORITHM-DEEP-DIVE` and its
> ranked `ppgdex-dsp.js` change list (#1–12) are the **Verity Sense (upper-arm, 3 green-LED pairs)** and are
> owned by that work-unit. This brief consumes that brief's **methodology** (§2.1 jitter theory, §2.2
> per-epoch alignment, §5 endpoint) but touches **no** `ppgdex-dsp.js` compute path and proposes **no**
> Verity change. A tier is never inherited across sites (`CLAUDE.md` §🎫); the finger must earn it on its
> own numbers.

---

## 0 · Why this is its own brief

`OXYDEX-PULSE-RESOURCING-FOLLOWUPS §1` is corpus-gated and decision-laden (a tier flip), and the archived
nightly corpus could not run it at all — the O2Ring appears there only as a **1 Hz** SpO₂/Pulse `.dat`/CSV,
never a pleth waveform (recorded in that brief's §1 note, 2026-07-21). It only became runnable when the
**live-BLE capture** (`vigil` / `capture.py`, `O2RING-LIVE-PPG-WAVEFORM`) began streaming the O2Ring's raw
finger pleth as a real waveform. So the validation is not a one-line tier edit — it is a measurement
programme with an alignment method, a primary endpoint, a minimum-nights bar, and an explicit
promote/hold rule. Hence a brief.

## 1 · The device (settled) — a single-channel finger reflectance pleth

- **Wire format** `[CORPUS][CODE]`. The live O2Ring PPG file is `Wellue_O2Ring-S_<serial>_<ts>_PPG.txt`,
  header `Phone timestamp;sensor timestamp [ns];channel 0` — **one** optical channel (no ambient, no
  second/third LED). Sensor-ns Δ ≈ **7.95 ms → ~125.7 Hz**, monotonic. `parsePPG` (`ppgdex-dsp.js:232`)
  parses it; `nCh === 1 ⇒ site:'finger'` (`:347`); foot-to-foot PPI → whole-record RMSSD/sdnnRobust +
  `cvhrFromNN` (`:1172`).
- **Consequence — expect it to be NOISIER than the Verity wrist.** The deep-dive's validated *wrist*
  baseline (rMSSD bias **+4.24 %**, SDNN **+2.46 %**, PPI jitter sd **5.92 ms**) is earned partly by a
  **3-LED event-level consensus** (≥2 of 3 within ±50 ms; 1-of-3 dropped, never filled). The finger has
  **no consensus vote** — a single reflectance path — so its foot jitter, and therefore its RMSSD error,
  should be strictly worse. This is a prediction to test, not an excuse.
- **Autogain + coverage.** The O2Ring, like the Verity, applies LED autogain; expect abrupt DC steps and
  missing-beat gaps. The shipped path already surfaces this: `hrvLowConfidence`, per-epoch coverage, Malik
  `correctRR`. Do **not** hand-filter around it — the flags ARE the honest quality signal (`CLAUDE.md`
  §🎙️/§🎫).

## 2 · Preliminary measurement (n=2, waking evening) — recorded, NOT sufficient to decide

Measured 2026-07-21 on the first two **completed** live-capture segments (read-only; the active capture was
untouched), shipped DSPs only (`PPGDSP.parsePPG→analyze` finger leg, cross-checked byte-identical against
`PpgDex.compute({text},{rich})`; `ECGDSP.parseECG→analyze` + `detectCVHR` ECG leg), overlap-window trimmed:

| metric | Pair 1 (~19:51, 34.5 min) | Pair 2 (~20:27, 25.6 min) | read |
|---|---|---|---|
| **RMSSD** finger / ECG / Δ | 77.3 / 26.9 / **+187 %** | 62.9 / 32.9 / **+91 %** | ❌ fails |
| **sdnnRobust** / ECG SDNN / Δ | 61.5 / 58.9 / **+4.4 %** | 71.9 / 72.4 / **−0.7 %** | ✅ within offset |
| whole-record **sdnn** / ECG SDNN | 88.0 / 58.9 (+49 %) | 74.0 / 72.4 (+2 %) | (inflates as documented) |
| **CVHR /h** finger / ECG | 15.7 / 0.0 (FP) | 9.4 / 9.4 (exact) | ⚠️ inconsistent |
| mean HR finger / ECG | 65 / 64.9 | 59 / 59.3 | ✅ ≤ 0.4 bpm |
| coverage / Malik-corrected | 93 % / 23.8 % | 95 % / 24.5 % | high correction |

Both segments raised the shipped **`hrvLowConfidence`** flag. `[CORPUS]`

**Interpretation.** The finger recovers **rate** near-perfectly (Δ ≤ 0.4 bpm) but **over-reads beat-to-beat
variability** — the classic single-channel foot-jitter signature. This is exactly the deep-dive's closed
form (§2.1): `rMSSD²_ppg ≈ rMSSD²_ecg + k·σ²`, so RMSSD is the metric most sensitive to jitter and the first
to break. `sdnnRobust` survives because it is jitter-resistant by construction and lands within the
**~+3.5 %** PPG-vs-ECG offset the code already documents (`ppgdex-dsp.js:2780-2782` `sdnnNote`).

**Why n=2 cannot decide.** (a) Both are **short, waking, evening** segments from **one session** — CVHR is
a *sleep*-domain metric and is meaningless awake; (b) the alignment was a **wall-clock overlap trim**, which
the deep-dive §2.2 shows "fails deceptively" for any beat-matched quantity; (c) whole-record short-term HRV
is precisely what `hrvLowConfidence` says to distrust — the per-5-min `epochs[]` series is the honest unit.

## 3 · The rigorous method (execute on the overnight corpus)

Adopt the deep-dive's validated apparatus verbatim; only the *device* differs.

1. **Corpus.** Paired nights, each with a raw O2Ring **finger** `*_PPG.txt` (~125 Hz) **and** a simultaneous
   H10 `*_ECG.txt` (~130 Hz), from the live-BLE captures (`/home/michal/tepna-smoketest/captures/<date>/`,
   or wherever `VIGIL-O2RING-AUTOPULL` finalises them). **Minimum ≥ 10 nights** for a median+IQR claim
   (matching the deep-dive's ≥10-night bar). Prefer full sleep-context nights, not evening slices.
   **Never read a file being actively written** (mtime guard; only finalised segments).
2. **Reference.** H10 raw-ECG Pan–Tompkins with sub-sample refinement (the deep-dive validated it at 0.244 ms
   residual jitter / 0.47 ms interval agreement). Derive HR from `_ECG.txt`, **never** `_HR.txt`.
3. **Alignment — per epoch, not global** (deep-dive §2.2, non-negotiable): coarse lag by instantaneous-HR
   cross-correlation (no periodicity at the beat interval ⇒ cannot alias by a whole beat), local refinement,
   ±75 ms one-to-one matching. A single global affine map yields a deceptive ~F1 0.26 and a −1 ms PTT — do
   not use it. Expect ~5–6 ppm clock drift and ~150–170 ms PTT.
4. **Endpoints.**
   - **Primary: PPI-jitter sd** (finger foot-to-foot vs matched ECG RR), **median across ≥10 nights + IQR** —
     reported as the deep-dive's table row so it is directly comparable to the Verity wrist's 5.92 ms.
   - **Secondary:** RMSSD bias %, `sdnnRobust` vs ECG SDNN %, and CVHR events/h agreement — computed on the
     shipped `site:'finger'` export, and on the **per-5-min `epochs[]`** series (the `hrvLowConfidence`
     honest unit), not only whole-record.
5. **Shipped code only.** No reimplemented HRV math. Co-load `PPGDSP`/`ECGDSP` in a `vm` realm mirroring
   `tests/run-tests.mjs`. Leave the shipped artifact/quality gating intact.
6. **Fit the jitter budget** (optional but decisive): fit `rMSSD²_ppg = rMSSD²_ecg + k·σ²` per night; if the
   finger's `k` and `σ` sit where §2.1 predicts, the RMSSD error is *understood* (jitter), which itself
   informs whether whole-record RMSSD can ever be `validated` on this hardware, or only `sdnnRobust`/epochs.

## 4 · The tier decision (criteria — a person still ratifies the flip)

Promote **per metric**, only on the ≥10-night corpus, and only via a documented validation write-up routed
to the node's validation doc (`LITERATURE-USE-POLICY`); the tier string is the ONLY code change and it lives
in `integrator-dsp.js` (`fuseHrvResource` / `fuseCvhrCorroboration` `tier`).

- **`sdnnRobust` → `validated`** IF its median bias vs ECG SDNN sits within the documented PPG-vs-ECG offset
  (~±3.5 %) across ≥10 nights with a bounded IQR. (Preliminary n=2 is +1.85 %/MAE 2.55 % — promising.)
- **Whole-record short-term RMSSD → stays `emerging`** UNLESS the finger PPI-jitter sd drops into the
  deep-dive's design budget (§2.1: ≤ 4.98 ms ⇒ 2 % RMSSD bias). Preliminary evidence says it will not on a
  single channel — so expect RMSSD to stay flagged/down-weighted, and consider surfacing only the
  jitter-robust family for the finger.
- **CVHR → `validated`** IF finger `cvhrFromNN` events/h agree with ECGDex `detectCVHR` within the
  corroboration band on **sleep** nights (n=2 waking is not evidence — one exact match, one false positive).
- **Any metric that fails its bar STAYS `emerging`.** A partial promotion (e.g. `sdnnRobust` only) is a
  legitimate, honest outcome. Do NOT promote on "same algorithm as PulseDex" — measure it.

## 5 · Non-goals / constraints

- **Do not touch the running capture** (`/home/michal/tepna-smoketest/` is `capture.py`'s live tree —
  read-only, finalised segments only, never lock/move/delete).
- **Do not touch `ppgdex-dsp.js`'s compute path or the Verity change-list (#1–12)** — that is
  `PPGDEX-ALGORITHM-DEEP-DIVE`'s work-unit. This brief is measurement + a tier string, nothing else.
- **No fabricated authority** (`LITERATURE-USE-POLICY`): a `validated` tier needs the real corpus write-up,
  not a synthetic and not the wrist's grade.

## 6 · Done-when

- [ ] ≥ 10 paired finger+ECG **sleep** nights processed with the §3 per-epoch alignment; the active capture
      never touched.
- [ ] **PPI-jitter sd** reported as median + IQR across those nights (the primary endpoint), in the deep-dive
      table format, alongside RMSSD bias, `sdnnRobust` vs SDNN, and CVHR agreement — whole-record AND per-5-min
      `epochs[]`.
- [ ] A per-metric tier verdict recorded in a validation write-up (routed per `LITERATURE-USE-POLICY`); any
      flip landed as the tier string in `integrator-dsp.js` with the gates below.
- [ ] If a tier string moves: `Dex-Test-Suite.html?full` green, `verify-provenance` clean, changeset dropped.
      (A tier-only edit in `integrator-dsp.js` re-bundles Integrator + the orchestrators; `computeHash` is
      unaffected by a string that is not on the compute path — confirm, don't assert.)
- [ ] Follow-up brief spawned per `CLAUDE.md` §📌, or a note here that nothing surfaced.

## 7 · References

- `OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md` §1 (the ask) · `OXYDEX-PULSE-RESOURCING-2026-07-18`
  (parent, Phases 3–4 DONE).
- `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §2.1 (rMSSD=jitter closed form), §2.2 (per-epoch
  alignment), §2.3 (what to keep), §5 (endpoint/gates). Method-parent; Verity-owned.
- `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md` (how the finger pleth is captured) ·
  `VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md` (auto-pull/finalise) · `PPGDEX-O2RING-FINGER-SITE-2026-07-18`
  (site detection).
- `docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md` (prior on-hardware finger **HR** validation ≤ ~1 bpm — HRV was
  never established, which is exactly this brief's gap).
- `CLAUDE.md` §🎙️ (derive HR from raw ECG, not `_HR.txt`), §🎫 (tier is a node fact, never inherited),
  `LITERATURE-USE-POLICY`, memory `tepna-three-stage-build`.
