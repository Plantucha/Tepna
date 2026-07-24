<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md
---
Two defects surfaced by folding the real capture-host overnight recordings through the Integrator (see brief). (1) `tools/trio-batch.mjs` now ingests the capture-host BLE-daemon layout — `Polar_VeritySense_…`/`Wellue_O2Ring-S_…_SPO2.csv`/`…_STORED.dat` names (same vendor CONTENT, one 14-digit stamp, `MAG`→`MAGN`) AND per-night SUBDIRECTORIES (recursive scan, `basename`-matched) — so a real capture night ingests with no rename+flatten shim (7 nights native, was 0); tool-only, no bundle/`manifestHash` move. (2) `ecgdex-dsp.js ecgBuildNodeExport` now stamps `recording.durSec` (the key `integrator-dsp.js adaptEnvelopeNode` already honors, DEEP-AUDIT-II §7.6): without a declared duration an EVENT-SPARSE ECG segment collapsed to a zero-length window in the Integrator and was EXCLUDED from the fold's overlap, silently dropping a genuinely-concurrent leg. Behavioral for ECGDex — both ECGDex goldens regenerated (added `recording.durSec`), ECGDex + the two orchestrators that inline it (Data Unifier, OverDex) re-bundled; `build.mjs --check` clean, `run-tests.mjs` green (CI lane), `verify-manifest.mjs` GATE A+B pass, `equiv.ecgdex` green (synthetic + real clip).
