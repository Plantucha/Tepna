<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SYNTH-TEXTURE FOLLOW-UPS — the DSP audit (spun out)

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Supersedes-section-of:** `SYNTH-TEXTURE-2026-06-24-BRIEF.md` (its "SEPARATE — DSP audit" block, which explicitly said "track as its own brief") · **Follow-up:** `SYNTH-TEXTURE-FOLLOWUPS-II-2026-06-24-BRIEF.md` (residue discovered during execution)

> **Execution note (2026-06-24):** Item 1 FIXED, Items 2–3 verified (2 = light defensive hardening, 3 = no fix). `pulsedex-dsp.js lombScargle` now tracks the GLOBAL spectral peak (`gPeakF/gPeakP`) and returns `peakHz`/`peakBand`/`peakBelowHF`/`respBelowHF`; `respRate` stays HF-derived (back-compat). Verified: a CSR series → `peakBelowHF:true, peakHz≈0.0154`; normal RSA → false. `pulsedex-render.js` Resp Rate row caveats when the robust whole-night `periodicBreathingIndex` flags PB (night-2 frac 0.79 strong; nights 1/3/4/5 not strong). `sampEn` gained an inert `MAXN=20000` decimation cap (sole caller passes a bounded `repSeg`/short series → never triggers today; bounds a future full-night caller). `cleanArtifactHR` confirmed correct-by-design: runs first (`processNight` ~line 1499) to strip the instantaneous O2Ring-S firmware step before detection; synthetic night-2 (most-aroused) has **0** samples with ≥20 bpm 1-sample jumps (max step 4 bpm), so physiological arousal-rebound tachy survives into CVHR/PB detection — no fix. `Dex-Test-Suite.html` all-green (857/60; +3 static guards). PulseDex re-bundled (`manifestHash 0bef00a755bc→cc20b9abc9bd`, buildHash unchanged); `verify-provenance.html` GATE A PASS (8/8). No fixtures affected.

> The texture v-bump (`SYNTH-TEXTURE-2026-06-24-BRIEF.md`) is **DONE** — generator re-fit, arc
> lands (night-2 = 18.0), all gates green. That brief carried a trailing **DSP audit** flagged
> *"does NOT gate this v-bump; track as its own brief."* This is that brief. These are **detector**
> (`*-dsp.js`) issues, independent of the generator change. None block the texture v-bump; item 1 is
> elevated by the new corpus and should be taken **soonest**.

---

## 1 · Lomb–Scargle respRate blind below 0.15 Hz — `pulsedex-dsp.js` (~line 305) — **ELEVATED, soonest**
`peakF` is tracked only inside the **HF branch**, so a respiratory/oscillation peak below ~0.15 Hz
is invisible. **Why it's now load-bearing:** the synthetic corpus plants CSR / periodic-breathing at
**~0.017 Hz** (`synth-gen.js masterTimeline addPB`, heaviest on night-2), landing squarely in the
blind band — so PulseDex would **misreport the synthetic CSR the corpus is purpose-built to
exercise.** Not hypothetical.
- **Fix:** track the **global peak across the whole resp band** (extend the search below the HF
  floor), or explicitly flag *"peak below HF band"* when the dominant component sits there.
- **Verify:** run PulseDex on the night-2 RR (`renderRR` of the n=2 timeline, or the committed
  overnight corpus) → the ~0.017 Hz PB run must surface in the resp/PB readout, not vanish.
- **Gate:** `*-dsp.js` change → `Dex-Test-Suite.html` all-green (add/extend a Lomb–Scargle
  low-frequency-peak assertion in `tests/dex-tests.js`). No re-bundle needed for the *test*; PulseDex
  re-bundle + `BUILD-MANIFEST` manifestHash update + `verify-provenance` GATE A once the DSP ships.

## 2 · SampEn O(N²) with no internal length cap — `pulsedex-dsp.js:177` — *verify-not-fix*
One full-night call (~25 k beats) is ~6×10⁸ ops on the main thread → a visible jank. **Audit first:**
confirm whether every caller already windows/decimates before calling SampEn (the windowed-analysis
path may never hand it a full night). If a caller can pass the whole series, add an **internal N cap /
decimation** inside SampEn (documented, deterministic) rather than trusting callers. Do **not** change
the return shape — keep back-compat per CLAUDE.md (new param LAST + optional).

## 3 · `cleanArtifactHR` may erase arousal-rebound tachycardia — `oxydex-dsp.js:486–508` — *verify-not-fix*
It flattens **≥20 bpm / 1-sample** changes to baseline. A real **arousal-rebound tachy** surge (the
post-apnea sympathetic kick the corpus plants) can be a legitimate ≥20 bpm 1-sample step. **Confirm
the pipeline order:** `cleanArtifactHR` must run **independently of / after** the CVHR &
periodic-breathing detectors read the pulse-rate channel — i.e. the cleaner must not pre-empt the
arousal signal those detectors rely on. If they share the cleaned series, the arousal events are
already gone before detection. This is the O2Ring-S firmware-quirk cleaner (per `BUILD-MANIFEST`
`_note_event_unify_C2`); be careful not to regress that genuine +21–25 bpm clock-hour step handling.

### Done when
- [x] Item 1 fixed (global resp-band peak `gPeakF` + `peakBelowHF`/`peakHz` flags + render caveat); night-2 ~0.017 Hz CSR surfaces (periodicBreathingIndex strong + Resp Rate row warn); 3 static guards added in `tests/dex-tests.js` group 9; PulseDex re-bundled + GATE A clean.
- [x] Item 2 audited: sole caller passes a bounded series (already-bounded); added an inert defensive `MAXN=20000` SampEn cap anyway (deterministic decimation, return shape unchanged) to bound any future full-night caller.
- [x] Item 3 pipeline-order confirmed (clean-first, by design); arousal-rebound tachy preserved (0 synthetic ≥20 bpm 1-sample jumps, max 4 bpm/sample); firmware clock-hour step handling intact. No fix needed.
- [x] `Dex-Test-Suite.html` all-green (857/60); `verify-provenance.html` GATE A clean (PulseDex `cc20b9abc9bd`).
