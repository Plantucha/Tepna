<!--
  MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-18 · **Follows:** `MOTIONDEX-BUILD-2026-07-17-BRIEF.md` (DONE)

# MotionDex — build follow-ups (what shipping the node surfaced)

Spawned per `CLAUDE.md` §📌 after `MOTIONDEX-BUILD-2026-07-17` executed (MotionDex ships, both gate lanes
green). These are the open items its execution surfaced — none block the shipped node; each is its own
scoped work.

## 1 · Render-coverage rig for `MotionDex.html`
The browser lane boots each app bundle in an iframe (render-coverage group) — MotionDex was wired for the
**equiv/DSP** coverage but has **no render-coverage rig** yet, so `motiondex-render.js`'s DOM path
(`renderSummary` → badged KPI grid + position bar) is covered only by the Node-side render smoke, not by a
real booted `MotionDex.html`. Add a MotionDex rig to the Dex-Test-Suite render-coverage set (drive the demo,
assert the KPI grid + `.ev` badges paint, `__rcState` reaches done). Low risk, mirrors the existing rigs.

## 2 · Body-position frame calibration (experimental → measured)
`bodyPosition` classifies supine/prone/lateral/upright from the gravity vector in the **raw device frame**,
so the posture LABEL is a convention, not device-validated — it is correctly tiered **experimental** in
`motiondex-registry.js`. Rocha et al. 2026 [Ro26] reaches per-class F1 0.92–0.95 only *after* a calibration
step (a known-orientation reference epoch or a sensor-mount convention). Add that step + a calibrated
known-answer fixture → lift the position tier to **measured**. Until then the honest tier stands.

## 3 · GYRO / MAGN are parsed but barely consumed
`parseSensorXYZ` + `streamKind*` handle all three IMU channels, but `compute()` uses only the accelerometer
(position/actigraphy/effort); GYRO/MAGN are exposed as stream counts only. A future metric (e.g. rotation-
rate arousal bursts, §Tier-3 of `MULTI-SENSOR-DERIVATIONS`) would consume them — not needed until a
derivation calls for it (do not add a metric with no consumer).

## 4 · The equiv fixture reuses ONE input for both ACC slots
`env.equiv.motiondex` drives `compute({acc, chestAcc: same})` from a single committed synthetic ACC, so the
wrist-vs-chest split (position/actigraphy prefer the chest sensor; effort is chest-only) is exercised but
not *differentiated*. A second committed synthetic with a DISTINCT chest stream (e.g. a lateral-position
wrist + supine chest) would pin the source-selection logic. Adversarial-twin style, input-only.

## 5 · The five Integrator-fusion derivation briefs are now UNBLOCKED
MotionDex's export is the prerequisite `MULTI-SENSOR-DERIVATIONS-2026-07-16` §0 named. Its five IMU-dependent
Tier-1/2 items (apnea typing · body-position OSA · sleep staging · RR fusion · motion-gated HRV) can now be
spawned as Integrator-fusion executable briefs that consume `node:"MotionDex"` events + the motion series.
Each is its own gated brief (literature-use policy); this is the agenda, not a commitment.

## Done-when
Each item above is either executed (its own gated change) or carries an explicit park reason. No item blocks
the shipped MotionDex node; this brief only records the agenda.
