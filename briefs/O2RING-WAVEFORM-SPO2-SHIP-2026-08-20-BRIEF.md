<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-26 (**its own gate was met five days ago and nobody flipped it**: the single blocking item was *"#1609 lands"*, and #1609 merged 2026-08-21T04:39:49Z. The four remaining items sit under *Still owed (the follow-up surface)* — future work, not Done-when blockers, which is the form CLAUDE.md §📌 permits inside a DONE brief. ⚠️ **One of those four is no longer deferred, it is LOST** — see the sweep-apparatus item.) · **Created:** 2026-08-20

# O2Ring waveform SpO₂ — the ship brief (one night's arc, owner-driven)

**One line:** the 0x05 two-channel raw stream now produces a shipped, badged, refusal-first SpO₂
trend in **OxyDex** (owner routing call), with a 1 Hz signal and an ECGDex-pattern firmware
comparator — estimator chosen by brute force over the whole corpus, LOO-validated, and demoed live
in Chrome on the real desat night. Ships in **PR #1609**.

This brief is the work-unit summary; the *evidence* blocks live as dated amendments in
[`O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md`](O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md)
(§5.2-AMENDED · literature comparison · full-corpus re-fit · reverse-engineerability reframe ·
brute-force sweep · routing · comparator). Read that brief for the numbers' full context; read this
one to know what shipped and what is still owed.

## What shipped (all in #1609, one work-unit)

1. **DSP** (`oxydex-dsp.js`): `parsePPG2W` (Clock-Contract strict) + `spo2WaveformTrend` —
   per-buffer ratio-of-ratios R = (AC/DC)₀/(AC/DC)₁, per-session OLS self-calibration against the
   co-recorded device SpO₂, refusal-first (no pair / <40 bins / r<0.3 / zero variance ⇒ named
   refusal, never a number). The device-CSV half reuses OxyDex's **own** `parseCSV` — no second
   SpO₂ parser exists.
2. **The estimator is the sweep winner, not the first draft:** RMS AC · 60 s mean bins · +10 s
   firmware lag (1344 configs × 49 sessions, 389k buffers; LOO held-out per-session median
   r = 0.723, 28/28 positive, RMSE 0.56 %, 98.9 % within ±2 %). Bin width was the dominant lever;
   the +10 s lag matches the firmware's averaging delay.
3. **1 Hz signal + comparator** — ECGDex `alignFirmwareRR` transposed: sliding 60 s mean at 1 Hz
   cadence, device side smoothed to the SAME bandwidth (corrected-vs-corrected), per-decile |error|
   fan, best-window baseline, tolerance = max(3× best, the 1 % display quantum), `nonUniform` flag +
   longest clean run. Bias is ~0 **by construction** and labeled as such. First real night
   (20260813202100): MAE 0.80 %, within ±2 % 92.1 %, decay correctly localized to the desat at the
   START — the best-window baseline catching exactly what a first-window baseline would have hidden.
4. **Surfaces:** six `OXY_REGISTRY` metrics, all **experimental** (spo2wMedian/Min/TrackR/Bias/Mae/
   Within2), badged inline; paired `_PPG2W.txt` + `_SPO2.csv` intake (the CSV still loads as a
   normal night — the trend is an extra card, never a replacement); app card with the fan and a
   plain-language decay verdict.
5. **Gates:** a 27-assertion suite group (parsers, synthetic tracking session with the lag encoded,
   refusals, planted-decay localization, registry tiers, and a source-scan guard on the pairing
   fix); full chain + `verify-fixtures` re-verification.

## What the work found along the way (each recorded where it belongs)

- **Routing** — owner: "probably in OxyDex since its spo2." Implemented as a full relocation
  (PpgDex restored to main's state, verified pure-insertion diff first); the 0x05 stream itself
  remains PpgDex's for future raw-PPG/HRV use.
- **The browser demo caught a real intake bug** (2026-08-20): the lone-pair exclusivity matcher
  paired a fresh waveform with a STALE device series from an earlier drop (zero overlap), consumed
  the stash, and the real partner found nothing. Fix: the fallback only commits when the trend is
  usable; exact-stem pairs always render, including refusals. Gate-backed by source scan.
- **The corpus question** — owner: "did you use maximum nights?" No: the first fit was local-tree
  only (15 sessions); the box held the rest. At maximum (49 sessions / 26,118 bins) pooled r = 0.455
  — composition, not contradiction (34 added short fragments; overnight-session median r = 0.58).
  Quote the 49-session numbers.
- **The framing correction** — owner: the 1 Hz output is COMPUTED from this same stream, so r = 1 is
  the ceiling and every missing point is ours. Four separable residual terms (damaged input copy ·
  hidden AFE4403 AGC state · rail clipping · quantized hold-averaged output — measured: three
  integer values carry 91.1 % of 695k overnight samples). Attack order recorded in the evidence
  brief.

## Still owed (the follow-up surface)

- [x] **#1609 LANDED 2026-08-21T04:39:49Z** → this brief is DONE. Flipped 2026-08-26; it sat
      IN-PROGRESS for five days after its own gate was satisfied.
- [ ] **Post-#1596 re-fit**: contiguous double-drain nights should steepen the converted slope
      toward the literature's −25 %/R family and lift r toward 0.7–0.9. If they do not, re-examine
      the functional claim, not the calibration constants.
      ⚠️ **This unit now also carries the sweep** (ruling 2026-08-27, below): build it as your OWN
      apparatus and select AFRESH — that is a **supersession, not a re-check**, so it is not owed a
      comparison against the lost original. **Commit it when its output reaches the decision.**
- [ ] **Sunlight spectral test** (field-gated): the channel-identity confirmation the functional
      sign cannot give.
- [ ] **LUT recovery**: per-beat R (not buffer-wise), then fit the firmware's fixed R→SpO₂ curve
      globally; a residual surviving that is the fingerprint of hidden AGC state → protocol
      archaeology for gain telemetry.
- [~] 🔴 **Sweep apparatus — LOST. RULED 2026-08-27: the re-CHECK is RETRACTED; the rebuild folds into the re-fit above.**
      This item read *"`ppg2w-sweep.mjs` lives in session scratch; promote to `tools/` if
      needed"* — that premise is false as of the 2026-08-19 ext4 migration. Session scratch
      was on the retired ntfs3 volume and did not survive. Verified 2026-08-26: not tracked
      (`git ls-files` → only `tools/ppg2w-rate.mjs`, `tools/ppg2w-spo2-fit.mjs`, neither of
      which is the sweep and neither of which mentions one), and absent from every surviving
      archive path.

      ⚠️ **This is `PPGDEX-ALGORITHM-DEEP-DIVE` §5 happening again, and it has now cost
      something.** That precedent records a jitter bound that became unverifiable because
      *"the method was named and no tool committed"*. Here the sweep CHOSE the estimator that
      shipped in #1609 — so the winning result is live in production and the apparatus that
      selected it is gone. A post-#1596 re-sweep can no longer be compared against the sweep
      that made the original call.

      **Rule this brief now carries: an apparatus whose output reaches a shipped decision is
      committed at the moment of that decision, not when someone next needs it.** "Promote if
      needed" is a bet that scratch outlives the need; it lost that bet in six days.

      **RULING, 2026-08-27 — neither rebuild-as-baseline nor a bare retraction.** A rebuilt sweep
      that picks a different winner **cannot distinguish "the original was wrong" from "my rebuild
      differs"**, which is the exact ambiguity the comparison exists to resolve — so the re-check is
      **unbuyable at any effort price**, and no amount of care purchases it. It is therefore
      **retracted**, not deferred. The rebuild instead folds into the post-#1596 re-fit, which
      selects afresh on more data: a supersession sidesteps the ambiguity rather than contesting it.

      🔴 **#1609's estimator selection is permanently UN-RE-CHECKABLE, and that is stamped here
      at its own evidence trail** — the closure-stamp convention in its uncomfortable direction:
      stamping a **limitation**, not a fix. The estimator keeps shipping on its original evidence,
      unchanged and unweakened; what is gone is the ability to re-open the choice on the terms that
      made it. (Routed and decided via `LOST-APPARATUS-INVENTORY-2026-08-26`.)
