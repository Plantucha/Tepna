<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-18

# PpgDex: ingest the O2Ring finger-site PPG (a second optical site into the existing morphology engine)

> **What this is.** An executable plan to teach **PpgDex** to parse the Wellue O2Ring-S live
> plethysmograph — the single-channel ~125 Hz finger-site waveform that
> [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md)
> now captures — so it runs through the **same beat/foot/PPI/HRV/morphology pipeline** the Verity
> wrist PPG already uses. **PpgDex already computes the full morphology fiducial set** (foot,
> systolic peak, dicrotic notch, augmentation index, reflection index, SDPPG b/a, Takazawa aging
> index — see `ppgdex-morph.js`); this brief does **not** build morphology. It adds a **finger-site
> parser + a single-channel detection path** so those metrics — and, critically, a **finger foot
> time-series** — exist for a second body site.
>
> **Why it matters.** (1) A finger foot-stream is the missing leg the Integrator PAT/PTT layer needs
> for **dual-site** timing ([`INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md`](INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md)).
> (2) Finger-site morphology is independently useful (vascular-age / stiffness indices are
> site-sensitive). This brief stops at **single-node ingest + metrics**; all cross-sensor timing is
> the Integrator's job.

---

## 1 · Starting state (verified in code, do not re-derive)

- **PpgDex parser** `PPGDSP.parsePPG` (`ppgdex-dsp.js:155`) expects the **Verity `*_PPG.txt`** layout —
  `Phone timestamp; sensor ns; ch0; ch1; ch2; ambient` — and returns `{ ch:[ch0,ch1,ch2], amb, fs,
  t0Ms, offsetMin, … }`. `fs` from the median sensor-ns delta (~176 Hz), phone-clock fallback. *(The ~176 Hz figure is the literal default; a **Vigil** live capture negotiates the Verity at **55 Hz** and `fs` is derived from the stamps, so both are handled.)*
- **Detection assumes 3 LEDs.** `consensusBeats` (`ppgdex-dsp.js:540`) keeps a beat only when **≥2 of 3**
  photodiode channels agree within ±50 ms; a 1/3 beat is dropped (gap), never median-filled. **A
  single-channel file has no majority to form** — this is the one real blocker.
- **Morphology is present and complete** — `PPGMorph.analyze` (`ppgdex-morph.js:308`): `medianPulse` →
  `delineate` (foot / systolic / dicrotic-notch via 2nd derivative / reflected peak) →
  `augmentationIndexPct`, `reflectionIndex`, `sdppgBA`, `sdppgAGI`, `perWindowMorph`. Registered
  **emerging** for the Verity site (`ai`, `reflectionIdx`, `sdppgBA`, `agingIdx`, `dicrotic`).
- **The O2Ring waveform** (`capture-host/oxyii.py parse_ppg`, decoded 2026-07-18): **single-channel,
  unsigned 8-bit, ~125 Hz** (~126 samples per ~1 s poll), with **occasional isolated spike samples**
  (e.g. 0x9c, ~0.66/frame, scattered — left in RAW per HEALTH-BOX-VISION, to be rejected downstream).
  Reflectance optics at the **finger base** (a ring, not a fingertip transmissive clip).

## 2 · The real differences to handle (finger O2Ring vs wrist Verity)

> **⚠️ CORRECTED 2026-07-18 by measurement.** This section previously claimed 8-bit quantization makes
> morphology marginal, and did not name the difference that actually dominates. Both are fixed below;
> the measurements are on the 90 s `o2ppg-probe.jsonl` capture vs a real Verity corpus night.

1. **One channel, not three.** No 3-LED consensus vote is possible. (Unchanged — this is still the
   structural blocker.)

2. **🔴 THE BIG ONE — the O2Ring waveform is ALREADY CONDITIONED; the Verity is raw.** Measured:

   | | O2Ring pleth | Verity ch0 |
   |---|---|---|
   | Mean level | **100.3** (mid-scale of 0–200) | **−471,989** |
   | Pulse (AC) | 22.8 LSB → **~91 of 256 levels** | 1,763 counts = **0.373 % of DC** |
   | Baseline drift / 10 s | 13.1 LSB | 40,298 counts = **8.54 % of DC** |

   On the Verity the pulse is a **0.373 % ripple on a baseline that wanders 8.54 %** — wander ~23× the
   signal, i.e. raw DC-coupled photodiode counts. On the O2Ring the pulse occupies **~36 % of full
   scale**, centred, barely drifting. **The ring AC-couples and gain-normalises on-device.** Consequences:
   - **No perfusion index is possible** — the DC is gone. (The legacy Viatom protocol exposes `pi`; OxyII
     does not. Do not try to recover it from this stream.)
   - **Ambient subtraction is meaningless** here — handled on-device, and the ambient column is written 0.
   - **The Verity's aggressive DC-wander highpass is redundant and possibly distorting** on an already-
     conditioned signal. The finger path needs its own, gentler preprocessing — not the wrist chain.
   - **Morphology is suspect for a different reason than assumed:** an **unknown vendor transfer
     function** sits in the chain. Shape metrics (notch timing, AI, SDPPG) cannot be trusted until it is
     characterised — this, not bit depth, is why they must stay low-tier (§5).

3. **8-bit is NOT the limiting factor — the earlier claim was wrong.** Because the ring AC-couples and
   gain-normalises, the pulse spans **~91 of 256 levels ≈ 6.5 effective bits on the pulse itself**. Foot
   localisation is not quantization-limited. The original concern assumed 8 bits spanning a large DC,
   which is what would happen if the ring streamed raw counts — it does not. **Do not gate morphology on
   bit depth; gate it on the unknown filter (point 2).**

4. **Spike samples** in the raw stream (the capture ships raw on purpose) — a foot/peak detector will
   trip on them unless they are rejected first. Measured: **1.06 % of samples jump >20 LSB**, against a
   mean sample-to-sample step of **1.62 LSB** — i.e. >12× the typical step. A despiker is required; the
   Verity path has none.

5. **Detection by column count will NOT work as §3 assumes.** `capture.py:651` currently writes the single
   value **replicated across ppg0/1/2** with ambient 0, so the file has the full 6 columns. Either the
   capture must change (needs this brief's single-channel path first — a lockstep change) or the DSP must
   detect the degeneracy at runtime. **Prefer the runtime guard** — it is specified in
   [`PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md`](PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md) §4
   and defends against any future replicating device, not just this one.

## 3 · Phase 1 — finger-site parser (node-local, no Clock-Contract change)

- Add a **single-channel branch** to `parsePPG` (or a thin sibling `parseO2PPG` that returns the SAME
  shape with `ch:[ch0]`). Detect it by **column count** (one optical column) — the capture writes the
  O2Ring pleth in the existing PSL PPG layout (`O2RING-LIVE-PPG-WAVEFORM` Phase 2), so **no new
  timestamp parsing**; `fs` still from the sensor/phone stamps, expected ~125 Hz. Carry a
  **`site:'finger'`** tag on the parse result (Verity → `site:'wrist'`).
- **Spike rejection at parse** (before detection): a bounded outlier clamp (median-of-neighbours when a
  sample deviates > k·MAD from its local window). Count rejected samples → surface as a quality field;
  a run of them is a **gap**, never interpolated over blindly.

## 4 · Phase 2 — single-channel detection path

- `consensusBeats` gains a **`nCh===1` fallback**: run `detectChannel` on the one channel, take its beats
  directly, and derive the honest confidence from **`beatSQI` + inter-beat regularity** (the two-detector
  `bSQI` majority isn't available with one LED — do NOT fake a second vote). Feet via the existing
  intersecting-tangent `refineFeet`; PPI stays **foot-to-foot** through `buildPPI` → Malik `correctRR`,
  exactly as today. Expose `ledAgreement = null` (not 100 %) for the single-channel site so the metric is
  honestly "not applicable," never silently perfect.

## 5 · Phase 3 — evidence tiers (do NOT inherit the Verity site's grades)

Same code, **different site + coarser bits ⇒ the grade must be re-earned**, per `CLAUDE.md` §🎫 and
`LITERATURE-USE-POLICY` (no upgrade on "same algorithm"):
- **Raw waveform + HR/PPI + rate-domain HRV**: **measured** / (HRV) **validated** — these are direct and
  the pipeline is the audited one.
- **Morphology at the finger site** (`ai`, `reflectionIdx`, `sdppgBA`, `agingIdx`, `dicrotic`): enter at
  **experimental** for the O2Ring site — *below* the Verity site's `emerging` — until the tri-device corpus
  shows the 8-bit finger pleth reproduces plausible fiducials. Add these as **site-scoped** registry
  entries; do not relabel the Verity ones. Every surfaced number carries a badge (COVERAGE MANDATE).

## 6 · Acceptance & the equivalence gate (GATE-C)

- **Round-trip (the O2RING brief's bar):** the O2Ring-derived **PPI-HR matches the ring's own 1 Hz HR
  field AND the paired H10 ECG HR within a couple bpm**, feet/peaks detect, sample-count continuity holds
  across reassembly seams.
- **Committed synthetic fixture** — add `uploads/synthetic_ppgdex_o2ring_finger.txt` (a single-channel,
  8-bit, ~125 Hz PSL-layout pleth with a couple of injected spike samples and a known HR) + its golden, so
  the equiv leg **runs in CI from committed bytes** (per CPAP-REAL-CORPUS §P2 — a committed adversarial twin
  beats a gitignored real night). Wire `env.equiv` for the finger-site path in both runners.
- This is a **DSP change** → re-bundle PpgDex + run the gates (§7).

## 7 · Gates & release (non-negotiable, per `CLAUDE.md`)

- Work in a **worktree** (touches `ppgdex-dsp.js`, a DSP). `node tools/build.mjs --app PpgDex` +
  `--check`; **GATE A/B** clean in `verify-provenance.html`; **`Dex-Test-Suite.html?full`** all-green
  (incl. the new finger-site equiv leg). Regenerate the PpgDex golden **only** by re-running the app +
  re-export (`tools/regen-pulsedex-goldens.mjs` is the copy-pattern; a PpgDex regen tool may be needed).
- Drop a **changeset** (`changes/*.md`, `bump: minor` — additive parser + site-scoped metrics, no contract
  break; `parsePPG` gains a branch, return shape unchanged).

## 8 · Done when

Finger O2Ring `*_PPG.txt` parses; the single-channel path yields feet + PPI whose HR matches the ring's 1 Hz
HR and the paired ECG within a couple bpm; finger-site morphology surfaces at **experimental** with badges;
the committed synthetic fixture's equiv leg is green in both runners; PpgDex re-bundled, GATE A/B + full
suite green, changeset dropped. Then flip this header `DONE`, and spawn `-FOLLOWUPS` for anything surfaced
(or note none did). **Unblocks** the finger leg of `INTEGRATOR-PAT-VASCULAR`.

---

## Cross-references
- [`PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md`](PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md) — the **Verity/multi-channel half** of this work (ambient subtraction + fusion); its §4 degenerate-channel guard is what makes this brief's single-channel detection robust.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — captures the file this consumes (its Phase 3 round-trip IS this brief's acceptance).
- [`INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md`](INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md) — the consumer of the finger foot-stream this produces.
- [`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md) — the agenda this partially executes (cross-site pair).
- `PPGDEX-BUILD-BRIEF.md` · `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md` — the detector/consensus this extends.
- `CLAUDE.md` §🎙️ (derive HR from raw waveform, node-local parsers) · §🎫 (badges, no grade inheritance) · §🔒 Clock Contract · §🧪/§🔏 gates.
- Code: `ppgdex-dsp.js` (`parsePPG`, `consensusBeats`, `refineFeet`, `buildPPI`), `ppgdex-morph.js`, `ppgdex-registry.js`; `capture-host/oxyii.py` (`parse_ppg`).
