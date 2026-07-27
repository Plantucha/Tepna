<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
---
`ppgdex-dsp.js` now emits `ganglior_events` in chronological order. `buildEvents` builds per KIND — the epoch loop emits `hrv_drop`/`autonomic_surge`, then a second loop emits the `motion_artifact_segment` run starting again at t0 — and appended them with no final sort, so every real PpgDex export ended with events stamped back at the recording start. Found by folding the 2026-07-16..26 capture-host corpus through the Integrator: **11 of 11 nights out of order**.

Why it matters even though our exports carry `tMs`: Clock Contract §6 lets a consumer rebuild absolute time from the `t` wall-clock string alone, "rolling past midnight, monotonic". One backwards step reads as a midnight wrap, so that event **and every event after it** gain +24 h — measured 393 of 404 events on the real 2026-07-17 night. Secondary: `integrator-dsp.js recWindow` uses `events[events.length-1].tMs` as its window-end fallback, which is order-dependent and was only masked by the recently-added `durSec`.

Sorted at BOTH sites: `buildEvents` (the single event source) and `ppgBuildNodeExport` (the export boundary, where the contract actually applies and an app-supplied `r.events` also arrives). Stable, nulls last.

Gated: new `ppgdex-dsp` group **PpgDex event order — chronological ganglior_events + t-only §6 reconstruction** drives the exact pre-fix shape through the shared builder and asserts the order, the §6 t-only reconstruction (max drift 0 h; 24 h pre-fix), and a source-mirror of both sort sites — verified to FAIL 5/6 with the fix removed. `run-tests.mjs` green 3942/0-skipped against the real corpus (`DEX_UPLOADS`), `build.mjs --check` clean across all 11 owned bundles, `verify-manifest.mjs` GATE A+B pass.

PpgDex + the two orchestrators that inline `ppgdex-dsp.js` (Data Unifier, OverDex) re-bundled. **Not export-inert** — `computeHash` moved `711c88b1bd1c → ee082f6910ef`, so the corpus-backed fixture was re-verified via `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` (`PpgDex_2026-06-27_equiv` re-stamped `verifiedUnder → ee082f6910ef`). Its `outputHash` is **unchanged** — proven by re-running the app, not asserted: that fixture emits 0 events, so the sort is a no-op on it.
