<!--
  MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-17 (agenda routed: the IMU-consumer fork of §0 was decided by the owner — **build a new motion node, `MotionDex`** — spawning the executable prerequisite `MOTIONDEX-BUILD-2026-07-17-BRIEF.md`; the five IMU-dependent Tier-1/2 items are routed to future Integrator-fusion briefs that depend on it, item 2.3 (PAT) is routed to the existing DONE `PAT-FEASIBILITY-2026-07-08-BRIEF.md`. No code/bundle/gate touched, per this brief's own §6.) · **Created:** 2026-07-16

# Multi-sensor derivations — new values the Vigil capture unlocks

A **scoping / agenda** brief. The Vigil multi-sensor capture (see
[`CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md) §D4) now
records — **time-synchronized on one Clock-Contract timebase** — raw ECG (H10), 4-channel PPG + ACC + GYRO
+ MAG (Verity), chest ACC (H10), RR intervals, and SpO₂/pulse/motion (O2Ring). This brief catalogues the
**derived values that combination makes possible but the suite does not compute today**, names each one's
**method source** (published), its **home node**, and its **evidence tier**. It commits no code: each
derivation, when built, becomes its **own executable brief** (gated like any behavioral change — literature-
use policy). It extends [`PAPERS-ROADMAP-2026-06-24-BRIEF.md`](PAPERS-ROADMAP-2026-06-24-BRIEF.md) §3 (the
real-validation front) on the analysis side.

## 0 · Two invariants that make this possible — and one hard constraint
- **Cross-sensor fusion is unlocked by the Clock Contract.** Every stream carries floating wall-clock `tMs`,
  so three independent BLE devices land on ONE timebase without sharing a clock — that is what lets an H10
  R-peak, a Verity PPG foot, and an O2Ring desaturation be reasoned about together.
- **Compute lives in the APPS, never on the box.** The Pi captures raw and forwards; every derivation below
  runs in a Dex node / the Integrator in the browser (CAPTURE-HOST-FOLLOWUPS-II owner constraint).
- **⚠️ Architectural dependency — there is NO consumer node for the IMU today.** ACC / GYRO / MAG (and the
  chest ACC) are captured to disk but **no Dex node ingests them**; the roster is single-signal
  (OxyDex/HRVDex/PulseDex/GlucoDex/ECGDex/EEGDex). Most Tier-1/2 items below therefore need **a new
  motion/IMU node** OR direct Integrator ingestion of the accelerometer files.
  That node is the gating prerequisite; call it out in each item's executable brief.
  > **✅ RESOLVED 2026-07-17 (owner decision).** Route chosen: **build a new motion node — `MotionDex`**
  > (not direct Integrator ingestion; the accelerometer is the workhorse for every item below, so the node
  > is named for the motion class, not the least-used gyro channel). Its executable creation brief is
  > **`MOTIONDEX-BUILD-2026-07-17-BRIEF.md`** — the single gating prerequisite for §1.1 · §1.2 · §2.1 ·
  > §2.2 · §2.4. MotionDex computes the **single-signal** motion metrics (position, activity/actigraphy,
  > effort waveform, SQI) and exports them; each derivation below is a separate **Integrator-fusion**
  > brief that consumes that export (motion × desat, motion × HRV, …), to be spawned once MotionDex ships.

## 1 · Tier 1 — genuinely new, clinically differentiated
### 1.1 ✦✦ Respiratory effort → central-vs-obstructive apnea typing
- **Inputs:** chest ACC (H10, thoraco-abdominal movement = effort) + O2Ring desaturation + Verity PPG.
- **Method source:** an accelerometer "discriminates obstructive from central type thanks to its excellent
  sensitivity to thoraco-abdominal movements," fused with PPG apnea detection — Manoni et al. 2020, *Sensors*
  [M20]. Chest-ACC respiratory-cessation detection: Ryser et al. 2022, *Biomed. Signal Process. Control* [R22].
- **Value:** the one thing oximetry alone CANNOT give — effort-present-through-a-desat ⇒ **obstructive**,
  effort-absent ⇒ **central**. Turns OxyDex's SpO₂-only AHI *estimate* into effort-confirmed, *typed* events.
- **Home:** motion node (effort waveform) → Integrator fuses with OxyDex desat events (Ganglior).
- **Evidence tier:** experimental → emerging on real-corpus validation. **Caveat:** three separate devices;
  effort-vs-desat temporal alignment leans on the Clock Contract; not diagnostic.

### 1.2 ✦✦ Body position → positional OSA
- **Inputs:** chest ACC gravity vector (supine/lateral/prone/upright) + O2Ring desats.
- **Method source:** sternal accelerometer position classification at per-class F1 0.92–0.95 — Rocha et al.
  2026, *AJRCCM* [Ro26].
- **Value:** supine-dependent desaturation → **positional-therapy candidate** (a real, actionable phenotype
  the suite is currently blind to).
- **Home:** motion node (position track) → Integrator correlates position × OxyDex desat rate → supine-AHI.
- **Evidence tier:** emerging (position itself is measured-tier; the OSA linkage is emerging).

## 2 · Tier 2 — strong, or better versions of existing numbers
### 2.1 ✦ Cardiorespiratory / actigraphic sleep staging (replaces the SpO₂/HR "sleep-stability proxy")
- **Inputs:** HRV (ECG-RR + PPG-PPI) + chest ACC + wrist ACC (+ SpO₂).
- **Method source:** HRV+movement staging reaches κ ≈ 0.60–0.68 vs PSG — Fonseca et al. 2020, *Sleep* [F20];
  chest-worn accelerometry cardiorespiratory staging κ 0.68 — Schipper et al. 2024, *Sensors* [S24]; chest-vs-
  wrist actigraphy+HRV — Aktaruzzaman et al. 2017, *Comput. Biol. Med.* [A17]; PPG+accel staging — Fonseca et
  al. 2017 / Wulterkens et al. 2021 [F17][W21].
- **Vigil-unique:** the papers use chest OR wrist, ECG OR PPG — Vigil has **all four at once**, so it can ask
  "does a second (chest) accelerometer + real ECG improve home staging over wrist-PPG alone?"
- **Home:** motion node + HRVDex/PulseDex → Integrator staging track. **Evidence:** emerging.

### 2.2 ✦ Respiration rate — three independent estimates fused
- **Inputs:** chest-ACC respiration [R22] + ECG-derived respiration (EDR/RSA, ECGDex) + PPG-RIIV (PpgDex).
- **Value:** a vital the suite doesn't surface at all; a rare within-subject 3-way method comparison
  (chest-ACC RR validates ~1.8 bpm vs RIP [R22]).
- **Home:** each node emits its RR; Integrator fuses (inverse-variance, like the existing TCH HR-hat).
  **Evidence:** emerging.

### 2.3 ✦ Pulse Arrival Time (PAT — NOT PTT)
- **Inputs:** H10 R-peak → Verity PPG foot, beats matched by RR/PP interval pattern.
- **Note:** it is **PAT** by construction (includes the pre-ejection period); PTT would require isolating PEP,
  which one PPG site can't. Already scoped in `PAT Feasibility.html`.
- **Feasible:** windowed/trend PAT (autonomic/arousal, BP drift). **NOT** reliable beat-to-beat — cross-device
  arrival jitter (±tens of ms) + Verity PPG 55 Hz foot resolution (~18 ms) bury the ~10–50 ms variation.
  Lever: check whether the Verity offers a higher PPG rate (PMD `get_settings`). **Evidence:** experimental.

### 2.4 ✦ Motion-gated, cross-validated HRV
- **Inputs:** ACC (reject movement epochs) + ECG-RR vs PPG-PPI agreement.
- **Value:** cleaner, **confidence-scored** HRV; makes existing HRVDex/PulseDex numbers more trustworthy —
  the same reference-free / three-cornered-hat spirit already in the suite's tests. **Evidence:** emerging.

## 3 · Tier 3 — incremental
- **Arousal index / periodic limb movements** from ACC bursts. **Multi-wavelength PPG methods note** — the
  raw 4-channel capture (3 LEDs + ambient) enables ambient-subtracted clean PPG, perfusion index, and LED-
  consensus robustness (a PpgDex signal-quality note; cf. multi-λ HSAT devices Belun [G20], TipTraQ [C25]).

## 4 · What NOT to chase
- **Reflectance SpO₂ from the Verity's green-dominant LEDs** — different LED geometry than a finger oximeter;
  unreliable despite finger-PPG SpO₂ precedents. **Seismocardiography** from the 200 Hz chest ACC — real but
  research-grade; out of scope.

## 5 · Routing, evidence & validation (house rules)
- **Each derivation = its own executable brief** (literature-use policy: a method/formula that changes code
  gets a gated brief). This brief only scopes + sources them.
- **No `validated` badge on "the literature says."** A paper-sourced constant reaches runtime only as an
  **inlined, cited constant** (author·year·journal·**DOI** in the doc + a source comment in code) and stays at
  the suite's own tier until independently validated. **No networked data in a bundle, ever** — a `Foo.html`
  never fetches a paper/DOI/dataset.
- **Validation path:** the real tri-device corpus + the roadmap's §3.2 EEG-anchored approach are the closest
  ground truth; a single PSG night would anchor the apnea-typing / staging items.
- **DOIs:** the citations below are author·year·journal (via Consensus); **fill exact DOIs before any runtime
  use** (they are method sources for future briefs, not runtime constants yet).

## 6 · Done-when (this brief) — ✅ MET 2026-07-17
Every Tier-1/2 item has EITHER a routed executable brief (with the motion-node prerequisite noted) OR an
explicit park reason inline. The catalogue + method sources are recorded so the agenda isn't lost. No code,
no bundle, no gate touched by THIS brief.

**Routing (owner decision 2026-07-17 — build `MotionDex`, see §0 RESOLVED):**

| Item | Route | Prerequisite |
| --- | --- | --- |
| **1.1** apnea typing (effort × desat) | → Integrator-fusion brief (to spawn) — MotionDex effort waveform × OxyDex desats | `MOTIONDEX-BUILD-2026-07-17` |
| **1.2** body position → positional OSA | ✅ **EXECUTED 2026-07-18** — MotionDex `posture_change` steps expand hold-last-value into the shared posture series; `labelPositionalApnea` gained `motion-acc` as a source (below the chest strap, above limb ACC). Gated 11/11. | done |
| **2.1** cardiorespiratory/actigraphic staging | → Integrator staging brief (to spawn) — MotionDex activity × HRVDex/PulseDex HRV | `MOTIONDEX-BUILD-2026-07-17` |
| **2.2** respiration rate (3-way fuse) | → Integrator RR-fusion brief (to spawn) — MotionDex chest-ACC RR + ECGDex EDR + PpgDex RIIV | `MOTIONDEX-BUILD-2026-07-17` (chest-ACC leg) |
| **2.4** motion-gated cross-validated HRV | → HRVDex/PulseDex + Integrator brief (to spawn) — MotionDex movement epochs gate RR/PPI | `MOTIONDEX-BUILD-2026-07-17` |
| **2.3** PAT (windowed/trend) | → **routed to existing DONE** `PAT-FEASIBILITY-2026-07-08-BRIEF.md` (beat-to-beat parked — physics: cross-device jitter + 55 Hz foot resolution) | none (no IMU) |

The prerequisite (`MOTIONDEX-BUILD`) is spawned and PROPOSED; the five fusion briefs are spawned once
MotionDex ships (its Done-when unblocks them). Agenda preserved. Brief **DONE**.

## References (method sources — DOIs to confirm before runtime use)
- **[M20]** Manoni et al., 2020, *Sensors* — A New Wearable System for Home Sleep Apnea Testing, Screening,
  and Classification. https://consensus.app/papers/details/f9bf43baa62159639847359c9cb58608/
- **[R22]** Ryser et al., 2022, *Biomed. Signal Process. Control* — Respiratory analysis during sleep using a
  chest-worn accelerometer. https://consensus.app/papers/details/c713dea8916956dc920c105849f3d7a5/
- **[Ro26]** Rocha et al., 2026, *Am. J. Respir. Crit. Care Med.* — Validation of a HSAT Wireless Sensor for
  Body Position and Respiration. https://consensus.app/papers/details/8171f06913bf58c587052791f710521f/
- **[F20]** Fonseca et al., 2020, *Sleep* — Automatic sleep staging using HRV, body movements, and RNNs.
  https://consensus.app/papers/details/79c41ec6d0f550ff844e8acbbaebdda0/
- **[S24]** Schipper et al., 2024, *Sensors* — Overnight Sleep Staging Using Chest-Worn Accelerometry.
  https://consensus.app/papers/details/dcd2de1ac5fc56d081b3a981b70bbc0e/
- **[A17]** Aktaruzzaman et al., 2017, *Comput. Biol. Med.* — Wrist vs chest actigraphy + HRV for sleep
  classification. https://consensus.app/papers/details/43e15c47474158808eef618fdfe2d8b9/
- **[F17]** Fonseca et al., 2017, *Sleep* — PPG-based sleep staging vs PSG.
- **[W21]** Wulterkens et al., 2021, *Nat. Sci. Sleep* — Wearable PPG+accel sleep staging in a clinical population.
- **[G20]** Gu et al., 2020, *J. Clin. Sleep Med.* — Belun Ring HSAT (PPG+SpO₂+accel).
  https://consensus.app/papers/details/bbd1c6a234875dee9d91dfa2560e75d6/
- **[C25]** Chen et al., 2025, *Sleep* — TipTraQ fingertip HSAT (red/IR/green PPG + accel).
  https://consensus.app/papers/details/76698e386561542dbdc830fa40959431/

## Related
- [`CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md) — the capture side (§D4 seeded this).
- [`PAPERS-ROADMAP-2026-06-24-BRIEF.md`](PAPERS-ROADMAP-2026-06-24-BRIEF.md) — §3 real-validation front (paper side of these).
- [`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`](LITERATURE-USE-POLICY-2026-07-11-BRIEF.md) — how a cited method enters the suite.
- `PAT Feasibility.html` — existing PAT scoping (§2.3).
