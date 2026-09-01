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

### §1 FROZEN PRE-REGISTRATION — H_axis (committed 2026-09-01, reviewed by Osprey pre-run; no P1/P2 number existed at commit time)

**Evidence base (two instruments, priors only):** (A) the oracle halves diagnostic (#2044): on the
four box signal nights the out-of-sample lag mode moves between scored halves 405→325 · 315→195 ·
215→315 · 355→505 (Δ = −80/−120/+100/+150 ms). (B) the residual sweep (#2040): inter-LED wander —
clock- and physiology-free by construction — is bounded on those same nights at worst-pair SD
3.48/1.94/6.51/1.08 ms, i.e. ≥12× below A's shifts, so the DIFFERENTIAL detector term is
pre-excluded at A's scale whichever way this lands. B cannot bound COMMON-MODE detector wander —
a stated limit, not an assumption.

**The code fact under test:** the oracle's trains ride different axis disciplines — PPG feet take
the full piecewise `hostAxis` correction (`ppgdex-dsp.js` per-sample `relSec`); ECG R-times take a
single-rate `fs` correction only (linear; steps deliberately reported-not-corrected). The H10↔host
divergence is documented NON-linear, order ~100 ms/night of linear-fit residual.

**H_axis: A's halves shift IS the ECG train's piecewise-minus-linear axis residual.**

- **P1 (anchors only, no oracle):** per signal night, build ECG-file anchors at TOOL level
  ({devMs from the sensor counter column, hostMs}, 1-in-500 rows — `rec.hostAxis` exposes
  diagnostics only, so tool-level is the only path), run `DexClock.hostAxis`, and compute
  Δaxis = mean(piecewise−linear residual over the 2nd scored half) − mean(over the 1st), on the
  oracle's own overlap split. Prediction: **|Δmode − Δaxis| ≤ 30 ms, sign included, on ≥3 of 4
  nights.** Δmode sign convention: mode(2nd scored half) − mode(1st) — matching #2044's published
  A→B order. Δaxis is compared directly, never re-rounded to 10 ms bins.
- **P2 (interventional):** re-run the oracle with the ECG train piecewise-disciplined the way the
  PPG already is — device times read from the sensor counter column and REPLACED (never stacked on
  the fs-corrected reconstruction, which would double-count the linear component), then
  `correctionAt` applied. Consume the correction **only when `hostAxis` returns `ok:true` AND
  `independent:true`**; a refusal or dependent axis annotates the night and removes it from the P2
  denominator — never a silent zero. Report `maxStepMs` per night beside the result (a mid-file
  step smears across one anchor gap under piecewise and could itself move a half-mode — to be
  discovered in the report, not post-hoc). Assert train sortedness after the transform.
  Prediction: **halves shift collapses to ≤30 ms on ≥3 of 4** scoreable signal nights, and — a
  prediction in its own right, not a side condition — the whole-night mode stays within ±20 ms of
  the frozen 405/315/215/355 (a 30 ms whole-night shift is a reportable deviation, not absorbed).
- **Collapse floor (stated before running):** even under perfect H_axis, P2 does not collapse to
  zero — the two piecewise corrections come from two files' anchor sets, both targeting the host,
  and cancel only up to anchor jitter (width-21 median leaves ~57 ms worst under ±100 ms planted
  jitter; box delivery jitter reaches 470 ms). The ≤30 ms criterion therefore carries the
  assumption that the two corrections agree to ~30 ms on box nights; a ~40 ms residual is a
  REPORTED DEVIATION, not a refutation.
- **Refutation:** shifts ≥80 ms persist on ≥2 nights under P2 ⇒ H_axis false; the remaining wander
  is PAT physiology and/or common-mode detector wander — and that branch is **DECLARED PARKED**:
  no instrument in this suite observes either independently (no BP/vascular reference; B is blind
  to common mode). The O2Ring second-site lever is noted for a future pre-registration only.
- **Power:** effect 80–150 ms vs 10 ms mode bins and ±30 ms tolerance; n=4 nights × two signed
  predictions; no correlation-style statistic at n=4.

Review record: Osprey (oracle-side data owner) approved 2026-09-01 with conditions (a)–(e) + sign
pin + direct-comparison pin + the whole-night-stability strengthener — all folded above verbatim;
thresholds unchanged from the pre-review draft.

### §1 RESULTS — measured 2026-09-01, same day, after the freeze; read strictly by the frozen rules

**Instrument note first (a reported deviation):** the P1 tool's first commit computed
mean_A − mean_B — the NEGATION of the frozen text's order — caught by checking the run against the
frozen wording, fixed, re-run; the selftest now pins the compliant sign with the derivation
(R_linear = R_true − c ⇒ measured lag = true + c). One threshold moved: none.

**P1 (anchors-only), against #2044's frozen Δmode = −80 / −120 / +100 / +150:**
Δmode_pred = **−84.2 / −4.6 / +0.1 / −2.6 ms** (tMsCorrected true and independent on all four;
maxStep 23 / 15 / 53 / **8654** ms). 07-24 matches at **4.2 ms with the right sign**; the other
three miss by 100–153 ms. **1 of 4 — P1 fails the ≥3/4 bar.**

**P2 (interventional, `--ecg-axis piecewise`):** denominator = 3 — **2026-08-18 is an ANNOTATED
exclusion**: its piecewise train breaks sortedness at beat 6015, the 8.6 s mid-file step (the
H10-2019-origin sync class) doing exactly what frozen condition (c) said a step would do. (The
first run swallowed that night SILENTLY through the oracle's catch — the tool now prints the
exclusion under `--ecg-axis piecewise`; the silent version existed for one run and is reported
here, not absorbed. **The GENERAL form is filed as a candidate with the oracle's owner** (Osprey,
by request): the catch-and-continue exists so a bad night cannot kill a corpus run, but it also
eats diagnostic-grade refusals silently on every path — surfacing all caught-exception nights as
`⊘ <reason>` is their unit, deliberately not built here.)

| night | halves Δ, linear | halves Δ, piecewise | whole-night mode |
|---|---|---|---|
| 07-24 | 405→325 (−80) | 445→495 (**+50**) | 405→445 (**+40 — deviation, > ±20**) |
| 08-12 | 315→195 (−120) | 315→195 (**−120**) | 315→315 (✓) |
| 08-17 | 215→315 (+100) | 275→335 (**+60**) | 215→275 (**+60 — deviation**) |

Collapse ≤30 ms: **0 of 3 — P2 fails.** Strict refutation (≥80 ms persists on ≥2): only 08-12 —
**also unmet.** And the intervention DEGRADED the oracle where it acted: 07-24 narrowSD
15.3→49.7 (SIGNAL RECOVERED → PARTIAL), 08-17 18.0→24.2 (also loses RECOVERED).

**Verdict, by the frozen rules: H_axis FAILS CONFIRMATION on both predictions, and is not
strictly refuted either.** What the measurements DO establish:

1. **07-24's shift is axis-borne** (P1: 4.2 ms match on the one night with a large residual,
   c spanning −204 ms) — but even there the piecewise intervention did not yield a cleaner night.
   **Attribution ≠ correctability** (Osprey's phrasing, kept for the future reader): the
   host-anchor record's own ≥50 ms structure means the piecewise correction carries anchor noise
   INTO the train even where the axis story is true — knowing the cause does not hand you the fix.
2. **The collapse-floor assumption is FALSE on this corpus**: the two piecewise corrections do not
   agree to ~30 ms — applying the ECG-side one injected ≥50 ms of structure and degraded two
   nights. The host-anchor record itself carries the wander at this scale, so "just
   host-discipline everything" is measured dead as a next step, before anyone builds it.
3. **08-12's −120 and 08-17's +100 are real, non-axis wander** (P1 residuals ≈ 0; P2 barely moves
   them). Per the freeze, their further decomposition — PAT physiology vs common-mode detector vs
   host-anchor structure — is the **PARKED branch, now reached and stamped**: no instrument in
   this suite observes any of the three independently.

The slow-wander seed is therefore MEASURED, not reopened-by-default: one night axis-explained,
two nights real wander parked at the pre-declared boundary, one night unmeasurable under the
intervention (annotated). Any future attempt starts from a new pre-registration with an
instrument that can see one of the three parked terms independently (the O2Ring second-site
lever remains the candidate).

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

- [x] §1: a wander pre-registration exists (bands before measurement) or the item is explicitly
      declined in this header — **EXISTS, Osprey-reviewed, FROZEN, and EXECUTED 2026-09-01**
      (§1 results): H_axis fails confirmation (P1 1/4, P2 0/3) and is not strictly refuted;
      07-24 axis-explained, 08-12/08-17 real non-axis wander parked at the pre-declared boundary,
      08-18 annotated-excluded (8.6 s step breaks the piecewise train); the collapse-floor
      assumption measured false — piecewise host-disciplining degrades the oracle on this corpus
- [x] §2: export-or-delete decided and executed for `channelSNR` / pat-per-led's SNR column —
      resolved 2026-09-01 by DELEGATION (exported `bandpass`/`std`, identical quantity, selftested,
      execution-proven); the DSP export still rides the next real re-bundle
- [ ] §3: recorded as the design constraint for any future residual reopening (no action beyond §1)
- [ ] §4: owner has ruled on sdb1 and the stale mirror

Related: [`PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md`](PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md)
