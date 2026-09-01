<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-09-01

# PPG-FOOT-PLACEMENT follow-ups — what the closure surfaced

Spawned on executing the parent's last two boxes (CFD re-score REJECTED #2037; residual spread
CLOSED under §5 rule 3). Four residues, none blocking the parent's DONE.

## 1 · The slow-wander observation wants its own pre-registration

The strongest thing the residual campaign found was not a candidate passing — it was every
per-beat mechanism failing while the inter-LED difference showed strong POSITIVE lag-1
autocorrelation (to +0.78 on the widest night; never once ≤ −0.3 across 31 phone + 45 box nights).
The dispersion is **coherent over many beats**: a slow differential drift between co-located LEDs,
not per-beat noise. Candidate mechanisms worth pre-stating BEFORE anyone measures again: a
respiratory or vasomotor waveform-shape modulation that moves the tangent intersection differently
per LED (different tissue depths), or slow relative baseline drift interacting with `refineFeet`.
Signature sketch: coherence spectrum of the pairwise difference series should concentrate below
~0.1 Hz, and the wander amplitude should predict per-night IQR. **Do not measure first and
threshold after** — that is what §5's rule 3 just spent a campaign earning the right to say.

## 2 · `channelSNR` is un-exported and `pat-per-led.mjs` silently prints n/a

`channelSNR` is local to `ppgdex-dsp.js` (defined ~line 830, used internally, never on the
`PPGDSP` namespace). `pat-per-led.mjs`'s guarded read (`P.channelSNR ? … : NaN`) has printed n/a
for its SNR column since the tool was written — the half-wired-mechanism shape: the guard makes
the absence look like data. Either export it (a DSP text change — moves every carrying bundle's
`manifestHash`, so it rides the next real re-bundle, not its own) or delete the dead column and
note the in-tool ANR (`ppg-foot-residual-sweep.mjs medianAmp/noiseRms`) as the sanctioned
substitute. Deciding which is a coordinator/owner-lane call only because of the re-bundle cost.

✅ **RESOLVED 2026-09-01 — a third option beat both: the triage found `bandpass` and `std` ARE
exported**, so `pat-per-led` now computes the IDENTICAL spectral quantity by delegation (same
≤90 s mid-recording window, 0.7–3.0 Hz pulse over 4.0–8.0 Hz noise) — no DSP edit, no re-bundle,
no divergable filter copy. Selftest pins it against arithmetic (tone plant; doubling the noise
tone halves the ratio — a gain-independent known-answer a constant-returning or wrong-band wrapper
fails). Execution proven on 2026-08-16 box: the column printed **20.59 / 19.99 / 20.44** — its
first real values ever. The `channelSNR` export itself still rides the next real re-bundle, at
which point the wrapper deletes (marked at the wrapper). One residue kept honest: `pat-per-led`
walks only date-directory corpora — the flat canonical `Ecg nightly` prints an empty (headers-only)
run, an empty-result-is-not-a-negative shape left un-fixed here as out of §2's scope.

## 3 · Three candidates at 0.68–0.70 are one latent factor, not three near-misses

C1/C2/C3 all landed just under the pre-stated 0.7 bar and are mutually correlated (noise, its
inverse, and yield). If §1's wander candidate fails too, the next design should test ONE latent
"night quality" factor properly (e.g. first principal component of the predictor set) rather than
re-running three correlated proxies — with its own pre-stated bar.

## 4 · The `data` (sdb1) USB volume: failing, and its mirror is stale — owner territory

The volume threw Buffer I/O errors WITH lost async page writes, stopped, re-attached, and now sits
unmounted (kernel log 2026-09-01 10:21). Its `Ecg-nightly-archive` mirror is also **incomplete**
(June 10–27 only, n=15 of 31 scorable nights) and measurably flattered two candidates before the
canonical re-run caught it. Owner decisions, not session ones: whether the disk is trustworthy,
and whether the stale mirror should be deleted so no future session measures against it. No
session should remount it meanwhile.

## Done when

- [ ] §1: a wander pre-registration exists (bands before measurement) or the item is explicitly
      declined in this header
- [x] §2: export-or-delete decided and executed for `channelSNR` / pat-per-led's SNR column —
      resolved 2026-09-01 by DELEGATION (exported `bandpass`/`std`, identical quantity, selftested,
      execution-proven); the DSP export still rides the next real re-bundle
- [ ] §3: recorded as the design constraint for any future residual reopening (no action beyond §1)
- [ ] §4: owner has ruled on sdb1 and the stale mirror

Related: [`PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md`](PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md)
