<!--
  DEX-DSP-AUDIT-BEATS-ARTIFACT.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Beat Detection & Artifact / Ectopy Rejection — DSP Audit (WP-D)

**Date:** 2026-06-21 · **Scope:** how each RR/PPI node turns a raw signal into the **clean NN series**
that every HRV number depends on — beat/peak detection, physiological gating, ectopy correction, and
the quality rates surfaced to the user · **Triggered by:** external review §B ("HRV is dominated by
beat-detection and artifact correction; without seeing these I cannot certify any HRV number") and
item #4 ("report rejected-beat rates in the UI"). Read-and-document pass + a known-answer regression
test. **No detector/cleaner behavior was changed.**

---

## TL;DR

- **The cleaning stage is sound and literature-anchored.** Every node gates beats on a **physiological
  range** and a **local-median relative-deviation rule** — the **Malik / Task-Force 1996** ectopy
  criterion (the exact remedy for the "a clean-QRS PAC/PVC passes range+SQI but injects two huge
  beat-to-beat jumps that inflate rMSSD/pNN50" failure mode the review worried about).
- **ECGDex is the most rigorous:** SQI gate (0.30) + range (300–2000 ms) + **Malik 20%** local-median
  rule, and it **counts ectopy separately** from range/SQI rejects (`nEctopyCorrected`), plus
  **gap-aware coverage** (strap-off dead time doesn't masquerade as clean signal) and an honest
  `analyzablePct = cleanBeat% × coverage%`.
- **All three already compute and expose rejection rates** — so item #4 is largely **already done**;
  the remaining work is consistency, not absence (see findings).
- **One real inconsistency: the ectopy threshold differs** — ECGDex & PulseDex use **20%** (Malik),
  PpgDex uses **30%** (looser, to tolerate pulse-arrival-time jitter). Defensible per-signal, but it
  should be a *documented, deliberate* per-signal constant, not an accidental divergence.
- **New regression test:** `tests/dex-tests.js` group **"Beat artifact / ectopy rejection —
  known-answer"** (tag `WP-D`, 10 assertions) injects a known ectopic + out-of-range + low-SQI beat
  into a clean series and asserts each is corrected, ectopy is counted separately, and the rates are
  reported. **All green** (suite 567 passed / 36 groups).

---

## Per-node pipeline

| Stage | ECGDex (`buildNN`) | PulseDex (`artifactClean`) | PpgDex (`detectBeats` → `buildPPI`) |
|---|---|---|---|
| Beat source | Pan-Tompkins-style R-peak detection on 130 Hz ECG (`detectPeaks`) | device RR intervals (parsed; no detection) | **optical** systolic-peak detection on PPG (autocorr-primed adaptive threshold + refractory + intersecting-tangent feet) |
| Range gate | 300–2000 ms | 300–2200 ms | 300–2000 ms |
| SQI gate | per-beat SQI ≥ 0.30 | — (interval input) | beat-template SQI + motion index |
| Ectopy rule | **Malik 20%** vs local 11-beat median | **20%** vs local 11-beat median | **30%** vs local median |
| Correction | replace with local median (timing preserved) | replace with local median | replace with local median (guarded vs cascading) |
| Motion handling | ACC-gated where present | n/a | **motion-rejected beats** tracked (`motionRejectedPct`) |
| Rates reported | `correctionRate`, `nEctopyCorrected`, `coveragePct`, `analyzablePct`, `nGaps` | `artifactPct`, `nArtifact` (shown in the OK banner) | `correctionRate`, `nCorrected`, `motionRejectedPct`, `meanSQI`, `analyzablePct` |
| Cross-check | `validateRR` vs device RR (agreement) | — | `validatePPI` vs device PPI (agreement %) |

### What's genuinely good
- **Malik ectopy rule everywhere.** This is the single most important artifact step for HRV and it's
  present in all three (the review's specific concern). ECGDex's own comment names the failure it
  prevents: a clean-QRS PAC/PVC inflating rMSSD/pNN50 and making ECGDex disagree with PulseDex/Kubios.
- **ECGDex counts ectopy separately** (`nEctopyCorrected` vs total `nCorrected`) — you can tell a
  noisy strap (range/SQI rejects) from a genuinely ectopic heart (ectopic rejects). Most tools collapse
  these.
- **Gap-aware coverage (ECGDex).** Inter-beat gaps > 10 s are counted as dead time, not missed beats,
  so `analyzablePct` is honest about strap-off periods instead of hiding them.
- **PpgDex is not naive about optical artifact:** autocorrelation primes the expected pulse interval,
  a refractory window blocks double-detection, beats are template-SQI scored, and **motion-rejected
  beats are counted** — appropriate for the noisiest of the three signals.
- **Cross-validation against the device's own PPI/RR** (`validatePPI`/`validateRR`) gives an
  independent agreement number — a second opinion on the self-detected series.

### Findings (consistency, not correctness)
1. **Ectopy threshold divergence (20% vs 30%).** ECGDex/PulseDex use the Malik 20%; PpgDex uses 30%.
   Looser for PPG is *defensible* (pulse-arrival-time jitter is larger than R-peak jitter). **✅ DONE
   2026-06-21:** PpgDex's `buildPPI` now names it `PPI_ECTOPY_THR = 0.30` with a rationale comment
   citing this audit, so it reads as a deliberate per-signal constant (mirroring ECGDex's overridable
   `buildNN(…, ectopyThr=0.20)`), not accidental drift. Behavior-identical; re-bundled, suite 610/0.
2. **Range-gate upper bound differs** (PulseDex 2200 ms vs 2000 ms elsewhere). **Decision: keep as-is**
   — 2200 ms (≈27 bpm) lets PulseDex retain genuine deep-sleep bradycardia beats that a 2000 ms
   (30 bpm) bound would clip; the wider bound is defensible for an RR-interval input, so this is a
   documented intentional divergence, not unified.
3. **Surface the rejection rate consistently in the UI.** PulseDex shows "*N artifacts corrected
   (X%)*" in its banner; ECGDex and PpgDex compute the same numbers (`correctionRate`,
   `motionRejectedPct`, `analyzablePct`) — confirm each renders a prominent **data-quality stamp**
   (not buried in a research drawer), so a high-artifact night is visibly caveated. This is the only
   genuinely *new* UI work item #4 implies, and it's small (the data already exists).

### Caveats (documentation, not bugs)
- **Correction replaces, not deletes.** All three replace a bad beat with the local median to keep the
  timeline aligned for windowing/spectral analysis. That's the right call for HRV, but a recording
  that is *mostly* corrected is mostly synthetic — `correctionRate`/`analyzablePct` are the guard, and
  should gate trust (a night at 25% correction is not a 5% night).
- **PpgDex `buildPPI` guards against cascade** (a false detection becoming the reference for the next
  beat) — good, but heavy consecutive artifact still degrades the local reference; lean on
  `motionRejectedPct` + `meanSQI` as the trust signal there.

---

## The known-answer test (what it proves)

Clean 1000 ms RR series (60 beats) with three injected defects, run through `ECGDSP.buildNN`:

| Injected defect | Expected handling | Result |
|---|---|---|
| beat[20] = 1400 ms (+40%, clean QRS, in range) | corrected as **ectopic**, counted in `nEctopyCorrected` | ✓ |
| beat[30] = 250 ms (< 300) | corrected as **range-bad**, NOT ectopy | ✓ |
| beat[40] SQI = 0.1 (< 0.30) | corrected as **SQI-bad**, NOT ectopy | ✓ |
| clean beat[10] | left untouched | ✓ (`corrected=0`) |
| ectopic replacement value | local median ≈ 1000 ms | ✓ (1000) |
| `nEctopyCorrected` vs `nCorrected` | ectopy < total (1 < 3) | ✓ |
| quality rates | `correctionRate`, `coveragePct`, `analyzablePct` present | ✓ |

Runs in **both** `node tests/run-tests.mjs` and `Dex-Test-Suite.html` via the already-exported
`ECGDSP.buildNN`. It guards the Malik logic (the thing that keeps ECGDex agreeing with Kubios) against
silent regression.

---

## What this does NOT cover (hand-off)

- **Optical detection accuracy on real PPG** (`PPGDSP.detectBeats` peak placement vs ground truth) —
  partially exercised by the existing `qrs-*` analysis tools; a synthetic-PPG known-answer for peak
  timing would strengthen it (future).
- **Agreement vs Kubios/NeuroKit2 on real recordings** — that's **WP-E** (item #2). The known-answer
  test proves the cleaner does what it claims; it does not prove parity with a reference tool on real
  data.
- The two small consistency fixes (threshold annotation, range-bound unification) and the UI
  data-quality-stamp confirmation above — gated follow-ups.

---

### Bottom line
The artifact/ectopy stage — the part the review said it could not certify HRV without seeing — is
**well-built and literature-anchored** (Malik 20% everywhere, ectopy counted separately and coverage
tracked in ECGDex), and the rejection rates are **already computed and partly surfaced**. Combined
with WP-C, both halves of "can I trust this HRV number" now have a documented audit and a
regression-guarded known-answer test. The open items are **consistency and UI prominence**, not
correctness.
