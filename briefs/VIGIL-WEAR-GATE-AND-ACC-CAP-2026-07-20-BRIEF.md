<!--
  VIGIL-WEAR-GATE-AND-ACC-CAP-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_Executes E4 of `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` (nothing gates capture on wear state)._

# Cap the Verity's ACC (kept) — and why motion wear-gating was disproven and removed

**Out-of-suite (`capture-host/`, Python).** VIGIL-OBSERVED-ERRORS E4 measured the Verity Sense streaming
**453 MB in 4.16 h while unworn** (RSSI −32) — 71 % of it ACC at 416 Hz. The Verity reports `worn: null`
(no contact bit), so nothing gated its capture on wear. This brief did two things; **one shipped and is
kept, one was disproven by real data and reverted.**

> ## ⛔ CORRECTION (2026-07-20) — the motion wear-gate was DISPROVEN and REMOVED
> The motion wear-gate (§2 below, originally shipped in PR #297 *off by default, pending validation*) was
> validated against **real worn-Verity night data** and **failed**. It is **reverted**. The ACC cap (§1)
> is unaffected and remains. **Do not re-introduce ACC-motion wear detection for this device.** Detail in §2.

## 1 · ACC rate cap — shipped and kept (config)

`rates: {acc: 52}` on the Verity, was the negotiated 416 Hz. **Confirmed free**, not assumed: MotionDex
reads its sample rate *from the data* (`motiondex-dsp.js sampleHz(rows)`, never a nominal constant) and its
widest analysis band is respiratory **0.1–0.6 Hz**, so 52 Hz is ~85× the bandwidth it uses. An **8× cut on
the dominant stream** at no cost to any downstream metric — the same argument `capture.py` already makes for
H10 ACC (capped at 50). Deploy config, applied to the running box and **verified live** on real hardware
(`acc options: rate_hz=[52] → START acc → ok`). No code change; nothing to revert here.

## 2 · Motion wear-gate — DISPROVEN by real data, REVERTED

The idea: a device with no contact bit shows *motion* when worn, so pause writing after a long window of
`|acc|` stillness. It was shipped **off by default** precisely because the threshold was unvalidated (the
brief's own words: "the margin is thin and the worn model is a guess … do not enable before validation").

**The validation killed it.** Replicating the exact gate logic (`|acc|` std over a 20 s window, 12 mg
threshold, 300 s grace) against real sessions:

| Session | `|acc|` std (median) | Would the gate pause? |
|---|---|---|
| **WORN sleep** (the 2026-07-19 22:15 session — the same night ECGDex analysed) | **0.9–1.0 mg** | **YES, 96 % of it** |
| Off-body (desk) | 2.2–2.9 mg | yes, 100 % |

**A worn Verity during still sleep sits at ~1 mg — *below* the desk's ~2.3 mg.** The device is worn on the
**left ankle**; an ankle on a still leg in deep sleep is one of the most motionless placements possible (no
arm micro-motion, minimal leg movement), so it is *stiller* than a desk. No `motion_still_mg` threshold can
separate worn-still-sleep from off-body — worn is on the wrong side of every candidate line. **The gate as
built would have paused writing through most of real sleep and lost exactly the data we record.**

The core assumption (worn ⇒ respiration/cardioballistic motion ≫ threshold) is false for a limb-worn IMU at
rest. The only assumption that saved us was the deliberately-conservative *design* — off by default, and a
benign write-pause rather than a link-drop. So: **the motion wear-gate code, config, and tests are removed.**

**The real wear signal for the Verity is its PPG pulse** (a cardiac waveform when worn; flat/ambient when
off), not its accelerometer. That is a genuinely different, larger feature — a candidate follow-up, not a
threshold tweak — and is the ONLY sound path to Verity wear-gating.

## Done when — final
- [x] Verity ACC capped to 52 Hz; verified free vs MotionDex's data-derived `fs`, and live on hardware.
- [x] Motion wear-gate **validated against real worn-night data → disproven** (worn 0.9 mg < desk 2.3 mg).
- [x] Wear-gate code / config / tests **removed**; ACC cap retained.
- [x] capture-host pytest **100 %** on `capture.py`; ruff clean.

## Not in scope / follow-up
- **PPG-pulse-based wear detection** for the Verity — the correct signal, a separate feature. Until it
  exists, the Verity has **no** wear-gate and the ACC cap (§1) is the whole of E4's byte reduction.
- The remaining E-items (E3 reconnect storm · E5 LINK under-sampling · E6 retention/offload) are in their
  own briefs.
