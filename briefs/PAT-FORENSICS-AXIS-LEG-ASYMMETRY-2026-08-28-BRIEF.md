<!--
  PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **TRIAGED 2026-09-01 (Osprey): tool BUILT (`tools/pat-axis-leg-audit.mjs`) and takes `<ppg-file>`, so it shares FIDUCIAL-JITTER's position — runnable locally, but against 2 files rather than the corpus. Not executed this pass.** · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (phase (a) output: §2 trace + §3 classification) · **Interlocks:** `EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md` §1, `WEARABLE-HOST-AXIS` lineage · **DRAIN 2026-09-02 (Osprey):** re-verified — `tools/pat-axis-leg-audit.mjs` is present and takes `<ppg-file>`, so it is runnable locally against `/srv/data/tepna-corpus/`. Unchanged since the 2026-09-01 triage. **Owner: Osprey. Next step:** one corpus run, same shape as the WINDOW-ORACLE execute; it needs no new code.

# The two legs of a PAT measurement ride different time axes — and Tepna introduces the difference

> **In one line:** both fiducials are sub-sample, but only one of the two index→time conversions
> accepts a fractional index. The PPG leg's `relSec` lookup is `undefined` for **every** foot, so it
> silently falls back to `idx / fs` — **discarding the device's own measured per-sample timestamps in
> favour of a synthesized constant-rate axis.** Measured: **0 of 8948 feet** on 8 real fragments took
> the `relSec` branch.

⚠️ **ATTRIBUTION CORRECTED 2026-08-28 (§17 measurement, below).** This brief first said the discarded
quantity was the *host correction*. It is not. On these fragments `hostAxis.independent` is **false**
and `ppm ≈ 0`, so the host correction contributes **< 1 ms**; the 37–62 ms is the **device timestamp
axis vs nominal `i/fs`**. The bug and its magnitude are unchanged — what changed is *what is being
thrown away*, and the corrected answer is the more serious one: not a lost refinement, but a lost
measurement.

**Label: SOFTWARE BUG** (charter §19). It is not a device limitation and not a physiological limit —
the correction is computed, is correct, and is discarded by an array subscript.

## 1 · §2 — the trace, with actual names

Both legs start from a Polar Sensor Logger file and end in `PATGate.verdict`. Only the marked step
differs between them.

```
ECG LEG
  <file> ─ ECGDSP.parseECG ──────────────────────────► { int16, fs, t0Ms, tMsAt, hostAxis, tMsCorrected }
         ─ ECGDSP.bandpass(int16, fs)
         ─ ECGDSP.detectPeaks(int16, bp, fs) ────────► peaks[]  ← FRACTIONAL (refinePeaks, sub-sample)
         ─ pat-feasibility-worker.js:ecgRpeakTimes
              t[i] = rec.tMsAt(peaks[i])                        ← ARITHMETIC: accepts fractional i
                     = t0Ms + i*_ecgMsPerSample + _ecgCorrAt(devMs)
                                                                 ✅ host correction APPLIED

PPG LEG
  <file> ─ PPGDSP.parsePPG ──────────────────────────► { ch[], fs, t0Ms, relSec, hostAxis }
              relSec[i] = (devMs + hostAx.correctionAt(devMs))/1000     (ppgdex-dsp.js:546-556)
         ─ PPGDSP.detectChannel(c, fs)  × nCh
         ─ PPGDSP.consensusBeats(per, refIdx, fs)
              └ refineFeet: cross = ms - (bp[ms]-mv)/msv ──────► feet[] ← FRACTIONAL (ppgdex-dsp.js:1319)
         ─ pat-feasibility-worker.js:ppgFootTimes
              sec = rel[idx] != null && isFinite(rel[idx]) ? rel[idx] : idx/fs
                                                                 ← ARRAY SUBSCRIPT on a fractional idx
                                                                 🔴 ALWAYS undefined ⇒ ALWAYS idx/fs
                                                                 ❌ DEVICE-MEASURED axis DISCARDED

BOTH ─ overlap() ─ coupledPAT(rTimes, fTimes)          PHYS_LO 200 · PHYS_HI 650 · LAG_SEARCH_MS 2000
                                                        BIN_MIN 5 (minutes)
     ─ PATGate.sharedClock(ecg, ppg, ov)                pat-gate.js:205
     ─ PATGate.verdict(ov, cp, sc, ax)                  COUPLING_MIN 0.55 · BEAT_IQR_MAX_MS 60 · DRIFT_MAX_MS 60
```

**`refineFeet` returns a fractional index by construction** — `foot = max(lo, min(p, cross))` where
`cross = ms - (bp[ms]-mv)/msv`, clamped but never rounded. `rel[93.3275]` is `undefined` on a
`Float64Array` and on a plain array alike, so `rel[idx] != null` is **false for every fractional
foot** and the ternary takes its `idx / fs` arm.

**The same repository already contains the correct conversion, twice**, which is what makes this a
wiring defect rather than an oversight:

| site | index→time | fractional-safe |
|---|---|---|
| `ecgdex-dsp.js` `tMsAt(i)` | `t0Ms + i*msPerSample + corrAt(devMs)` | ✅ — its comment: sub-sample R positions "must not be rounded before the correction is applied" |
| `tools/pat-matchrate-strict.mjs` `timeAt(idx)` | interpolates `rel[lo] + fr*(rel[hi]-rel[lo])` | ✅ — its comment: truncating "would quantise the very sub-sample precision the alternative fiducial exists to buy" |
| **`pat-feasibility-worker.js` `ppgFootTimes`** | **`rel[idx]`** | ❌ |
| `ppgdex-dsp.js:2211` (node's own path) | `rel[Math.round(i)]` | ✅ (rounds, so ≤ ½ sample) |

The analysis tool fixed this and the shipped worker never received it — the mirror of the defect
`pat-matchrate-strict.mjs` itself documents four lines earlier ("a fix that ships in the node but
never reaches the tools measuring it"). Here it ran the other way.

## 2 · §3 — timing-field classification, PAT path only

Classes per the charter. **Verified** = read from the calculation, not from a comment.

| field | where built | class | verified |
|---|---|---|---|
| ECG `t0Ms` | file stamp via `parseECG` | HOST-MEASURED | ✅ source |
| ECG `i / fs` | sample index × nominal rate | RECONSTRUCTED | ✅ source |
| ECG `tMsAt(i)` | `t0Ms + i·msPerSample + corrAt` | **DEVICE-DERIVED, HOST-DISCIPLINED** | ✅ source |
| ECG `hostAxis.ppm` | span-gated rate estimate | DEVICE-DERIVED, often **REFUSED** | ⬜ comment claims 160/187 refused — **not yet re-measured** |
| PPG `t0Ms` | file stamp via `parsePPG` | HOST-MEASURED | ✅ source |
| PPG `relSec` (`deltas.length > 20` ∧ `hostAx.ok`) | `(devMs + correctionAt(devMs))/1000` — and on this corpus `correctionAt` contributes **< 1 ms** | **DEVICE-MEASURED** (not host-disciplined here: `independent:false`) | ✅ source + executed |
| PPG `relSec` (else) | `i / fs` | SYNTHETIC | ✅ source |
| **PPG foot time _as actually used by PAT_** | `idx / fs` | **SYNTHETIC** | ✅ **executed, 0/8948** |

The last row is the finding: `relSec` carries the device's **measured** per-sample timing and is then
not used. The substitute, `idx / fs`, is SYNTHETIC by the charter's own vocabulary — so the bug
downgrades a measured field to a synthesized one, which is the single worst transition in that table.

## 3 · Magnitude — and why the honest number is 3× smaller than the raw one

`tools/pat-axis-leg-audit.mjs` (new, `--selftest` 7/7 including a positive control) over 8 real
Polar Verity fragments:

| quantity | value |
|---|---|
| feet taking the `relSec` branch | **0 / 8948** (8/8 files) |
| axis genuinely non-nominal | **8 / 8** (max dev 37.7 – 62.3 ms) |
| fragment-wide error | median 28.6 – 46.7 ms per file |
| **within-5-min-bin residual** | **median-of-medians 10.47 ms** · per-file medians 8.4 – 26.6 · **max 40.4** |
| beat-to-beat \|Δ\| | **0.053 – 0.098 ms** |

🔴 **Do not quote the fragment-wide number.** The discarded correction is a smooth **ramp**, not
jitter — beat-to-beat |Δ| is ~0.05 ms while the fragment spans ~40 ms. `coupledPAT` bins at
`BIN_MIN = 5` minutes and centres within a bin, so a bin absorbs the ramp's **offset** and keeps only
its **slope**. Quoting 34.5 ms would overstate what PAT actually eats by roughly 3×. The defensible
figure is the within-bin residual: **~10 ms median, ~40 ms worst-case**, against `DRIFT_MAX_MS = 60`.

**So: real, systematic, one-line fix — and NOT on its own sufficient to explain PAT's failure.**
At the median it is ~17 % of the 60 ms budget; at its worst bin, ~67 %. It belongs in the §21D error
budget as a correlated (not independent) term, because it is a monotone ramp shared by every beat in
a bin rather than a per-beat draw.

## 3b · §17 — provenance labelling, and it resolves the tension

Per fragment, from `rec.hostAxis` (all 8 files):

| field | value across 8 fragments |
|---|---|
| `ok` | **true** (8/8) |
| **`independent`** | **false (8/8)** |
| `spreadMs` | **0.98 – 1.00 ms** |
| `ppm` | −10.6 (78 s file) · **−0.4 … +0.4** (the seven 1467 s fragments) |
| `drawn` | **false (8/8)** · `quantizedShare` 0.041 – 0.211 |
| `ppm × duration` (predicted correction) | **0.0 – 0.8 ms** |
| observed \|relSec − i/fs\| | **1.9 – 62.3 ms** |

**Three conclusions, and one of them corrects this brief:**

1. ✅ **`raw-corpus-is-all-phone-captured` HOLDS — scope is not narrower.** `spreadMs` 0.98–1.00 ms is
   the phone signature (0.13–1.00 ms) to three digits, and `independent:false` says so directly.
   **`hostAx.ok` does not mean a second clock exists**; it means the axis block ran. A reader who
   treats `ok` as evidence of independence will be wrong on every night in this corpus.
2. ✅ **`correctionAt` is NOT shaping a drawn column into looking disciplined.** That was the feared
   second bug with the bigger blast radius, and it is **refuted**: the correction it applies is
   ~0 ppm, worth < 1 ms over 24 minutes, i.e. it is honestly declining to correct.
3. 🔴 **This brief's original attribution was wrong.** `ppm × duration` (≤ 0.8 ms) cannot account for
   an observed 37–62 ms. The discarded quantity is the **device's own timestamp column**, not the host
   correction. `drawn:false` and `quantizedShare` ≤ 0.21 confirm the Verity axis is genuinely
   MEASURED — unlike the O2Ring's, which is drawn — so PAT is discarding real timing, not a refinement.

**Why the error is 37–62 ms if the correction is ~0:** `relSec ≈ devMs/1000`, the device's measured
per-sample stamps, while `idx / fs` assumes a perfectly constant rate at the *estimated* `fs`. The gap
is the device's true sampling irregularity plus any error in `fs` — which is precisely the quantity
§5 names as the PPG-axis suspect, and it is now measured rather than assumed.

## 4 · What this does NOT yet establish

- **Whether fixing it changes any night's verdict.** Not measured. The estimator's per-bin centring
  may absorb most of it; §11's perfect-clock oracle is the instrument that answers this, not argument.
- **The ECG leg's refusal rate.** `ecgRpeakTimes`' comment claims 160 of 187 fragments have the ppm
  path refused with 48 ms median divergence. The charter forbids accepting that on faith and it is
  **not yet re-measured** — carried into phase (a)-continued.
- ~~**Box vs phone nights.**~~ **RESOLVED — see §3b.** The memory holds, `correctionAt` is innocent,
  and the tension existed only because this brief conflated `hostAx.ok` with `hostAx.independent`.

## 5 · Done when

- [x] §2 trace with actual file:function names.
- [x] §3 classification for the PAT path, verified-vs-claimed marked.
- [x] Magnitude measured, reproducible tool committed, over-claim avoided.
- [ ] ECG ppm refusal rate re-measured (the comment's 160/187 · 48 ms).
- [x] `hostAx.ok` provenance on phone captures resolved against §17's labelling — memory holds.
- [ ] Verdict-level impact via the §11 oracle — does fixing it move any night?
