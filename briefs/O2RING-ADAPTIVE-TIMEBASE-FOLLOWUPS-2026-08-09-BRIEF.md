<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-09

# O2Ring adaptive timebase — follow-ups

The timebase feature is shipped and DONE (`O2RING-ADAPTIVE-TIMEBASE`, PRs #1037/#1048/#1057/#1072 + the
bad-host acceptance #1089). This captures what execution surfaced that is NOT code-complete — one
operational step, one nice-to-have field confirmation, and the process gotchas that cost time.

## 1 · Deploy to vigil (operational — the feature is merged but not LIVE)

The capture-host half (Stage 1 label, 3a `timebase_decision` + CLOCK-sidecar column, 3b `# timebase=`
embed in the `ppg1` file) is on `main` but **the box runs the old code**, so no captured O2Ring file
carries the `timebase` stamp yet. A deploy is `git pull` on the box **plus** `sync-apps.sh` (git pull is
only half — see the deploy note). Do it between nights (no capture in progress) so the daemon restart
drops no data. After deploy, verify a fresh `ppg1` file's first line is `# timebase=device-crystal`
(or `host-disciplined` if the box is a genuine stratum-1) and that the CLOCK sidecar has a `timebase`
column.

## 2 · A REAL bad-host ECG night (nice-to-have, NOT a blocker)

The bad-host acceptance (#1089) is synthetic (+2000 ppm injected) and corroborated on the real 2026-08-01
night — sufficient, because the crystal's invariance is magnitude-independent. A real travel/stratum-3
night with a paired H10 ECG would *positively* confirm it in the field, but the local corpus is all
home/stratum-1, so it waits for such a capture. Route any such night through `/tmp/badhost.mjs` (or a
committed variant) to compare host vs crystal vs ECG.

## 3 · Give vigil a real stratum-1 so host-discipline is actually exercised (hardware)

Today the box's host clock rarely EARNS host-discipline (the decision bar is source-stratum ≤ 1 + skew
≤ 1 ppm), so the crystal default carries almost every night — which is safe, but the host-disciplined
branch is under-exercised on real captures. vigil is a **Lenovo M900 (x86)**, so a Pi GPS HAT does not
apply; the x86 path is a **USB GPS that feeds PPS over the serial DCD line** — the **Navisys GR-701W**
(~$45, gpsd-supported) is the community-standard unit. With `gpsd` + `chrony` (SHM/NMEA for coarse time,
PPS for the edge) the box becomes a genuine stratum-1, the decision picks host-disciplined on good nights,
and — separately valuable — the box finally gets a real absolute-time reference (today's device absolute
time is junk). A LAN GPS-NTP appliance (LeoNTP, ~$300) is the fleet alternative.

## 4 · Process gotchas this pass (so the next timebase-adjacent change is cheaper)

- **A DSP change re-bundles THREE build trees, and the analysis tree is the one that bites.** #1018 red on
  CI four times purely because `resp-acc-analysis.html` (inlines `integrator-dsp.js`) was never rebuilt —
  `build.mjs --check` (owned bundles) and `verify:docs` were green while `verify:analysis` stayed STALE.
  Run `npm run check` (all three) or explicitly `tools/build-analysis.mjs`; do not infer green from a
  hand-picked subset.
- **`biome ci` fails on FORMAT, not just lint.** Run `biome format --write` on an edited `.js` BEFORE
  re-bundling — formatting changes the inlined text, so the manifestHash moves and you must re-bundle
  again. (Cost this pass: a full re-bundle + re-verify redo.)
- **`verify-fixtures` re-stamps `verifiedUnder` for EVERY stale node**, not just the one you changed.
  Revert the non-target `provenance/*.json` fragments so the work-unit stays clean (§👥.2).
- **Bundle PRs churn each other DIRTY on every merge.** An open bundle PR goes DIRTY the moment another
  bundle PR lands; land them fast, and expect to rebase + regenerate (bundles usually come out
  byte-identical, so the redo is cheap once the analysis tree is remembered).

## 5 · Done-when

1–2 are field/operational and close when performed on the box. 3 is a hardware purchase decision. 4 is
already captured here (and the durable ones belong in the shared runbook if they recur). Nothing here is
code owed against the shipped feature.
