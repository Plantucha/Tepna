<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SYNTH-GEN TEXTURE CHANGE — re-fit + DSP audit (handoff)

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Followed-by:** `SYNTH-TEXTURE-PAPERS-RERUN-2026-06-24-BRIEF.md` (paper reruns/rewrites — does NOT block this brief's DONE) · **Follow-up:** `SYNTH-TEXTURE-FOLLOWUPS-2026-06-24-BRIEF.md` (the §SEPARATE DSP audit, spun out as its own trackable brief per its own instruction)

> **Execution note (2026-06-24):** Ported the broadband-1/f texture to root `synth-gen.js`; applied §3 `NIGHTS[].rsaGain` `[0.932,0.321,1.367,1.850,2.215]` + new `SYNTH.VERSION='synth-gen/2.0'`; re-fit `cohort-gen.js rsaGainFor` to the variance-space form (§2) + `CohortGen.VERSION→1.8`. Sweep through the **real** PulseDex chain (`renderRR→parseRRInput→artifactClean→rmssd`) renders **23.9 / 18.0 / 30.0 / 38.0 / 44.0** — night-2 lands exactly **18.0** (the load-bearing assertion), recovery arc 18→30→38→44 monotonic, artifact% flat ~0.09–0.15% (§5 confirmed, gate did not shift). `Dex-Test-Suite.html` all-green (794/53). Re-bundled the 6 synth-gen-bundling apps (OxyDex/PulseDex/PpgDex/GlucoDex/HRVDex/Integrator; ECGDex correctly untouched); `BUILD-MANIFEST.json` manifestHashes hand-updated, `verify-provenance.html` **GATE A PASS (8/8)** + GATE B all fixtures reproducible. RR-only change confirmed: OxyDex (5-night) + GlucoDex (continuous CGM) outputs **byte-identical** old↔new — not regenerated; OxyDex provenance fixture manifestHash re-recorded (real-input analysis is synth-gen-independent). Paper reruns handed to the Followed-by brief.

> A coupled **`synth-gen.js` + `cohort-gen.js` generator v-bump.** The attached/edited
> `synth-gen.js` is **texture-only and NOT ready to bundle as-is** — it has the new RR
> texture but still carries the OLD `NIGHTS[].rsaGain` constants and has no `SYNTH.VERSION`.
> Bundling it in this state = new engine + old calibration → the SubjectA arc renders +3–4 ms
> over target, possibly non-monotonic. **The constants and VERSION in §1–§3 must be edited into
> the file before any bundle.** The file and this brief deliberately disagree until you do that.

---

## Step 0 — port to ROOT first (genuinely step zero)
The edit is in the **`uploads/` copy**. Apps, the test suite, and `cohort-worker` all load
**`synth-gen.js` from the project root by bare name**, and **root still has the OLD texture
(no `bwTau` bank)** as of this writing. Until the texture is ported to root, every constant
below is a no-op. Port the texture change to root `synth-gen.js`, then apply §1–§3 there.

---

## 1 · `synth-gen.js` — the texture change
New within-night RR texture in `buildRR`:
- Octave-spaced **1/f relaxor bank** (`bwTau ≈ [2…256]` beats, amplitude 30) replacing the old
  single slow OU relaxor.
- **RSA frequency wander** widened to 0.35 (phase-integrated; breathing is not metronomic).
- **White innovation** trimmed to 3.

Validated against 13 real H10 nights: **DFA-α1 0.53 → 0.85** (real 1.02–1.30); SampEn and the
SDNN/RMSSD ratio now inside the real IQR; RSA autocorrelation matched. α1 is a **partial fix**
(0.85 vs ~1.16) — capped by the narrowband RSA; closing it needs a multifractal model (documented
in a code comment, **not** a knob).

RNG stream changed (~12 gaussians/beat), so **byte output differs for every seed → pilots re-run.**

**Add a `SYNTH.VERSION` string** (none exists today — without it, old vs new runs are
indistinguishable in provenance; `cohort-runner`'s provenance pin reads it).

## 2 · `cohort-gen.js` — re-fit `rsaGainFor` (the important one)
The new texture raised the gain→rMSSD transfer's **variance floor**, so the old linear
`0.061·rmssd − 0.284` now renders every cohort patient **+3–4 ms over target.** Replace with the
**variance-space form**, anchored to **post-`artifactClean` rMSSD through the real PulseDex chain**
(`renderRR → parseRRInput → artifactClean → rmssd`, all in **`pulsedex-dsp.js`** — **NOT**
`synth-gen`'s `hrvMetrics`):

```js
rsaGainFor(t) = clamp( Math.sqrt(Math.max(0, t*t - 15.5*15.5)) / 18.426, 0.30, 3.2 )
```

Bump `CohortGen.VERSION` **1.7-pilot → 1.8**.

## 3 · `synth-gen.js` `NIGHTS[].rsaGain` (SubjectA arc)
Replace the five constants with:

```
[0.932, 0.321, 1.367, 1.850, 2.215]
```

Re-lands the **24 → 18 → 30 → 38 → 44** arc (renders **23.9 / 18.0 / 29.8 / 37.6 / 43.7**) under the
new engine.

> ⚠️ **Do NOT reconcile `NIGHTS[].rsaGain` to `rsaGainFor()`.** They are two separate fits for two
> different rendering contexts and will not agree if cross-checked — the highs match to ~1% but
> **night-2 diverges ~55%** (formula 0.497 vs constant 0.321). That is **correct, not a bug**:
> SubjectA night-2 carries AHI-38 CVHR + the hypo-suppression window that the generic cohort fit
> doesn't model, so its per-night constant must sit well below the smooth inverse. A tidy-minded
> coder who "unifies" them will break the arc.

**Verification check after re-running the sweep against root:** the pass/fail assertion is
**night-2 rendering 18.0**, not night-5. Night-2's target (18) sits only ~2.5 ms above the 15.5 ms
floor — on the flat part of the curve, most sensitive to engine details — so it is the load-bearing
number that proves the port + re-fit are mutually consistent. **Re-run the sweep yourself rather than
trust these constants blind**; it's a five-line script.

## 4 · Floor caveat — keep, don't fix
Texture floor ≈ **15.5 ms** (min renderable rMSSD). ~1.1% of cohort-nights plant below it (the
severe-OSA/elderly tail) and render compressed to ~16. Footnote for `hrv-age-confound` /
`treatment-response`; **not a blocker.** Lowering it trades against α1 — maintainer call.

## 5 · Artifact gate did NOT shift
Swept `artifactPct` flat at **0.11% across all gains** through the real cleaner — the 1/f bank's
excursions don't trip the 20% Malik gate. **No yield change from the texture** (closes the
second-order risk on `qrs-yield` / `nights-icc`).

## 6 · Bundle + provenance
`synth-gen.js` is bundled in **6 apps** — OxyDex / PulseDex / PpgDex / GlucoDex / HRVDex / Integrator
(`.src.html` each). Re-bundle each from its `.src.html`, **hand-update each `manifestHash` in
`BUILD-MANIFEST.json`**, update `FIXTURE-PROVENANCE.json` for any moved fixture, then
`verify-provenance.html` **GATE A clean**. (ECGDex does **not** bundle it — leave it.) Per CLAUDE.md,
an external bundled-JS edit moves `manifestHash` but **not** `buildHash`, so GATE A is the gate that
has teeth here.

## 7 · Gates + fixtures (reruns are a separate brief)
- Run **`Dex-Test-Suite.html`** → all-green (watch the FULL-lane waveform-fidelity / render-coverage
  group, which drives `SY.buildRR` → the real PPG detector). Mirror with `node tests/run-tests.mjs`.
- **Regenerate only the RR-derived fixtures** (re-run, don't hand-edit). The change is RR-only —
  `buildRR` (seed `+202`) is isolated from `renderOxy` (`+101`) and `renderGlucoAll` (`9090`), and
  `rsaGainFor` consumes no RNG — so **OxyDex and GlucoDex committed outputs are byte-identical** and
  must NOT be regenerated. Confirm with a one-patient byte-diff.
- **Paper reruns/rewrites are tracked in `SYNTH-TEXTURE-PAPERS-RERUN-2026-06-24-BRIEF.md`**, which
  starts when this brief is DONE. They are NOT acceptance items here.

## 8 · Process
Honor CLAUDE.md (provenance / clock / gate rules) and FINDINGS §6/§7 — the texture constants
**30 / 0.35 / 3 are global**, so if any paper plots a *distribution* of a texture-derived metric
(SampEn / DFA-α1 spread), **jitter those three per-patient** (the hard-constant-pileup rule). Stamp
this brief **DONE** only when the gates pass and the arc lands (night-2 = 18.0).

### Done when
- [x] Texture ported to root `synth-gen.js`; §3 `NIGHTS[].rsaGain` + `SYNTH.VERSION` applied to root.
- [x] `cohort-gen.js` `rsaGainFor` re-fit (§2); `CohortGen.VERSION` → 1.8.
- [x] Sweep re-run against root confirms **target ≈ measured** (PulseDex lane: 23.9/18.0/30.0/38.0/44.0) and **night-2 = 18.0**, recovery arc monotonic 18→44.
- [x] `Dex-Test-Suite.html` all-green (794 passed / 53 groups; FULL-lane fidelity group included).
- [x] 6 apps re-bundled; `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` updated; `verify-provenance.html` GATE A clean (8/8 match).
- [x] Oxy + CGM outputs confirmed byte-identical (RR-only change → no RR-corpus fixtures committed under provenance; OxyDex/GlucoDex NOT regenerated, byte-diffed old↔new). Paper reruns handed off to the follow-up rerun brief (does NOT block this DONE).

---

## SEPARATE — DSP audit (does NOT gate this v-bump; track as its own brief)
1. **Lomb–Scargle respRate blind < 0.15 Hz** (`pulsedex-dsp.js` ~305) — `peakF` only tracked in the
   HF branch. **Elevated:** the corpus plants CSR / periodic-breathing at ~0.017 Hz (night-2
   `addPB`), exactly in the blind band — so PulseDex would misreport the synthetic CSR the corpus is
   built to exercise. **Not hypothetical here; track soonest.** Fix = track the global peak across
   the resp band, or flag "peak below HF."
2. **SampEn O(N²), no internal length cap** (`pulsedex-dsp.js:177`) — *verify-not-fix:* add an
   internal N cap/decimate or audit every caller; one full-night call janks the main thread.
3. **`cleanArtifactHR`** (`oxydex-dsp.js:486–508`) — *verify-not-fix:* flattening ≥20 bpm/1-sample
   changes to baseline can erase arousal-rebound tachy; confirm it runs independently of
   CVHR/periodic-breathing detection (pipeline-order check).
