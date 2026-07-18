<!--
  MOTIONDEX-BUILD-2026-07-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-18 (MotionDex ships as the fleet's 9th owned plain-inline bundle `MotionDex.html`; DSP + registry + render + app + `.src.html`, ESM-from-birth; parses Polar Sensor Logger ACC/GYRO/MAGN on the Clock Contract → position · actigraphy · effort · SQI → `ganglior.node-export`. Full gate sequence green in BOTH lanes — GATE A 9/9, GATE B reproduces its committed-synthetic equiv fixture, Node suite + browser `?full` (2770) + no-network all green, `regen-goldens.mjs --node MotionDex` reproduces the golden. Roster named in ORIENTATION.md + CLAUDE.md. Follow-ups → `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md`.) · **Created:** 2026-07-17 · **Unblocks:** `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` §1.1·§1.2·§2.1·§2.2·§2.4 · **Related:** `CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md` (§D4 capture side) · `INTEGRATOR-BUILD-BRIEF.md` (fusion consumer)

# MotionDex — Build Brief (the fleet's motion / IMU node)

> **Why this brief exists.** `MULTI-SENSOR-DERIVATIONS-2026-07-16` catalogued the derived values the Vigil
> multi-sensor capture unlocks and found a hard architectural gate: **the IMU (ACC / GYRO / MAG, plus the
> H10 chest ACC) is captured to disk but no Dex node ingests it** — the roster is single-signal
> (OxyDex/HRVDex/PulseDex/GlucoDex/ECGDex, EEGDex planned). The owner's decision (2026-07-17) was to add a
> new motion node rather than teach the Integrator to ingest raw accelerometer files. **`MotionDex` is that
> node.** It is the *gating prerequisite* for five of that brief's six Tier-1/2 derivations; each of those
> is its own downstream executable brief that **consumes MotionDex's node-export in the Integrator** — this
> brief builds only the single-signal motion node.

## 0 · Project identity & invariants (inherit, do not re-derive)
- **Signal:** inertial motion — 3-axis accelerometer (gravity + linear), 3-axis gyroscope (angular rate),
  3-axis magnetometer (heading), from the **Verity Sense** (wrist/arm) and the **Polar H10** (chest ACC).
- **Single-signal, like the fleet.** MotionDex computes **motion-domain** metrics only (body position,
  activity/actigraphy, movement epochs, a thoraco-abdominal *effort* waveform). Every **cross-sensor**
  derivation (apnea typing = motion × desat, sleep staging = motion × HRV, motion-gated HRV) lives in the
  **Integrator**, consuming this node's export — NOT here. Keep the node honest to its one signal.
- **Compute lives in the app, never on the capture box** (CAPTURE-HOST-FOLLOWUPS-II owner constraint). The
  Pi forwards raw files; MotionDex parses + computes in the browser.
- **Build shape identical to the fleet:** external `motiondex-dsp.js` / `motiondex-render.js` /
  `motiondex-app.js` / `motiondex-registry.js` / `motiondex-profile.js`, referenced by `MotionDex.src.html`,
  bundled to a standalone `MotionDex.html` via the **owned** builder (`node tools/build.mjs --app MotionDex`).
  100% local, no network, system fonts only. **Author the `.js` + `.src.html`, never the bundle.**
- **ESM from birth.** The fan-out is complete (`ESM-MIGRATION-FOLLOWUPS-2026-07-16`, DONE) — write MotionDex
  as ES modules against the `esmBundle`/`classicify` bridge from day one; do not add new `global.<Node>`
  spray or a `-globals.d.ts` reach-in pattern the fleet is trying to retire.
- **Clock Contract (non-negotiable).** Every sample carries floating wall-clock `tMs`; delegate to
  `DexClock.parseTimestamp` (`clock.js`, inlined by the builder) — regex the Polar Sensor Logger stamp
  format, **never** `new Date(str)`. Read back with `getUTC*`. This is exactly what lets an H10 R-peak, a
  Verity PPG foot, and a MotionDex position sample land on one timebase without a shared clock.

## 1 · Data formats (Polar Sensor Logger export — add exact columns as real files are seen)
The **Polar Sensor Logger** app (`com.j_ware.polarsensorlogger`) writes per-stream CSV/TXT with its own
timestamp columns (see CLAUDE.md §🎙️ Capture provenance). MotionDex must treat these as first-class inputs:
- **Verity `_ACC.txt`** — 3-axis accelerometer (mg or m/s²; confirm units + sample rate from a real file,
  typ. ~52 Hz). Gravity vector → orientation; linear residual → activity.
- **Verity `_GYRO.txt`** / **`_MAG.txt`** — angular rate / magnetic heading (captured; low-load for the
  current derivations — parse + expose, but do not over-invest until a consumer needs them).
- **H10 `_ACC.txt`** — chest accelerometer (typ. ~200 Hz), the thoraco-abdominal *effort* channel.
- Honor the DMY/MDY + time-only rules from the Clock Contract §2–§4 exactly as the other DSPs do.
> **⚠️ Record real column/rate/unit layouts here as you encounter actual files** (per the capture-provenance
> rule) — do not hardcode an assumed schema.

## 2 · DSP core — the single-signal motion metrics (what MotionDex computes)
1. **Body position** (gravity-vector decomposition of the chest/torso ACC → supine / lateral-L / lateral-R /
   prone / upright). Method: sternal-accelerometer position classification (Rocha et al. 2026, *AJRCCM*
   [Ro26], per-class F1 0.92–0.95). Emit a per-epoch position track + dwell fractions.
2. **Actigraphy / activity counts** (band-limited linear-acceleration magnitude → activity counts,
   movement epochs, immobility runs). The actigraphic substrate for downstream sleep/wake + arousal work.
3. **Thoraco-abdominal effort waveform** (chest ACC → respiratory-effort surrogate; Ryser et al. 2022 [R22]
   chest-worn accelerometer respiration). This is the channel the apnea-typing fusion (obstructive =
   effort-present-through-desat, central = effort-absent) depends on.
4. **Signal quality / motion-artifact flags** feeding the Ganglior `conf` field (over-range, sensor-off,
   flatline, clipping) — the same SQI-gates-conf discipline as ECGDex/PpgDex.

## 3 · Evidence tiers (register every surfaced metric — COVERAGE MANDATE)
Per CLAUDE.md 🎫: every KPI/card/series carries a badge from `motiondex-registry.js` (`MOTION_REGISTRY`).
Honest starting tiers — position **measured** (device-validated), activity counts **measured**, effort
waveform **experimental** (surrogate), any sleep/wake read **emerging** at best and only after validation.
No `validated` badge without a real citation (Literature-Use Policy). The crossnight `*_DEFS` projection in
`motiondex-cross.js` (if added) mirrors the registry — registry wins (`registry-defs-parity` gate).

## 4 · Export contract (the cross-node currency the derivations consume)
`schema.name:"ganglior.node-export"`, `node:"MotionDex"`, `recording.startEpochMs` = floating `t0Ms`,
`ganglior_events:[{ t, tMs, impulse, node:"MotionDex", conf, meta }]`. Surface the position track, effort
waveform summary, and movement/immobility epochs as retrievable series so the Integrator fusions can read
them. Scrub any device serial / filename (the `EXPORT-IDENTITY` PHI-free rule).

## 5 · Gates (the same green bar as every node)
- `node tools/build.mjs --app MotionDex` + `--check`; register MotionDex in the owned-build app list.
- `Dex-Test-Suite.html?full` all-green incl. a render-coverage rig + an **`env.equiv` dynamic leg**
  (`compute({committed input}) ≡ committed export`, volatile-stripped) — every code-gated node owes one
  (GATE-C). Commit a **synthetic** IMU input so the equiv leg runs in CI (real captures are gitignored).
- `verify-provenance.html` GATE A/B; `no-network.html`; `tests/dex-tests.js` Clock-Contract + badge-cohesion
  groups extended to cover MotionDex.
- A `tools/regen-goldens.mjs --node MotionDex` path for its fixtures (the unified regen, per CPAP-FOLLOWUPS-III).

## 6 · Suggested build order
1. `motiondex-dsp.js` parser (Polar Sensor Logger `_ACC` first) + Clock-Contract delegation + a committed
   synthetic fixture. 2. Position + activity + effort compute. 3. Registry + badges. 4. Render + app + src.html.
5. Export + scrub. 6. Bundle + all gates + fixtures. 7. Roster update: add MotionDex to CLAUDE.md/ORIENTATION
roster **only once it ships** (EEGDex-style "planned" line until then). 8. Changeset (`type: added`, new node).

## 7 · Done-when
MotionDex ships as an owned plain-inline `MotionDex.html`: parses real Polar Sensor Logger IMU files on the
Clock Contract, computes position + activity + effort + SQI, badges every metric, exports
`ganglior.node-export` (`node:"MotionDex"`), passes the full gate sequence (incl. its equiv leg + provenance),
and the roster docs name it. Then the five `MULTI-SENSOR-DERIVATIONS` Tier-1/2 fusion briefs are unblocked;
spawn a `MOTIONDEX-BUILD-FOLLOWUPS` if the build surfaces open items (per §📌).

## References
Method sources are inherited from `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` §References
([Ro26] position, [R22] chest-ACC respiration, [F20]/[S24]/[A17] staging substrate). **Fill exact DOIs
before any value reaches runtime as an inlined cited constant** (Literature-Use Policy).
