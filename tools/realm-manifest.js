/*
 * tools/realm-manifest.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE MODULE LISTS THE TOOLS' vm REALMS LOAD — one copy, read by every tool that builds a realm from
 * repo modules (residue 2026-10-11-one-module-list-in-six-tool-literals).
 *
 * WHY THIS FILE EXISTS. Six tools built their own vm realm from an inline array: gap-s-sweep,
 * measurement-walk, regen-oxydex-goldens, regen-ppgdex-goldens, oxydex-export-staleness and
 * pb-operating-point. #3426 added `dex-escape.js` to the app bundles and none of the six arrays
 * carried it, so `measurement-walk --verdict-sample` threw `ReferenceError: escapeHTML is not defined`
 * in `oxydex-profile.js`, and #3437 had to add the same entry six times. A module a realm needs is now
 * added HERE, once. Load order is significant (`clock.js` before a delegating DSP) and each list keeps
 * the order its tools already used. `escapeHTML` is called at run time, so a realm that loads a caller
 * needs `dex-escape.js` PRESENT; the gate asserts presence, not position.
 * Gate: `tools · realm-manifest · single-source` in tests/dex-tests.js.
 *
 * CommonJS (not .mjs) on purpose: the tools already read `build-core.js` through `createRequire`, and
 * the test suite evaluates this file in a plain vm realm.
 */
'use strict';

/* The OxyDex realm — the full co-load of the OxyDex bundle's compute modules. */
var OXY_REALM = Object.freeze([
  'kernel-constants.js',
  'signal-frame.js',
  'dex-export.js',
  'oxydex-util.js',
  'crossnight-envelope.js',
  'metric-registry.js',
  'dex-escape.js',
  'dex-profile.js',
  'oxydex-registry.js',
  'oxydex-cross.js',
  'clock.js',
  'clock-seam.js',
  'oxydex-profile.js',
  'oxydex-dsp.js'
]);

/* The lean OxyDex DSP realm — only what `OxyDex._bare.processNight` needs (export-staleness and the
   PB operating-point study recompute per-night metrics and load nothing else). */
var OXY_DSP_REALM = Object.freeze(['dex-escape.js', 'kernel-constants.js', 'clock.js', 'clock-seam.js', 'oxydex-util.js', 'oxydex-profile.js', 'oxydex-dsp.js']);

/* The ECGDex leg — registry before the DSP, morph after (the order regen-ecgdex-goldens co-loads). */
var ECG_LEG = Object.freeze(['ecgdex-registry.js', 'ecgdex-dsp.js', 'ecgdex-morph.js']);

/* The ECGDex realm on its own: the shared spine, then the ECGDex leg. */
var ECG_REALM = Object.freeze(['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js'].concat(ECG_LEG));

/* The OxyDex realm with the ECGDex leg loaded on top (measurement-walk walks both nodes). */
var OXY_ECG_REALM = Object.freeze(OXY_REALM.concat(ECG_LEG));

/* The OxyDex realm with the FUSION module on top. The regenerator needs it: `oxyEcgFusionBlock`
   maps the node-export's ecgFusion block, and the app is not loadable headless (residue
   2026-10-06-no-committed-fixture-pairs-an-ecg). The ECGDex leg is deliberately absent — the ECG side
   of a fixture pair is a committed node-export, which fusion reads as plain data. */
var OXY_FUSION_REALM = Object.freeze(OXY_REALM.concat(['oxydex-fusion.js']));

/* The PpgDex realm — the co-load of the PpgDex bundle's compute modules. Since 2026-10-29 `clock.js` is
   one of them: PpgDex.src.html inlines it so the app's `typeof DexClock` guards take the host-axis
   branch the fold and the suite already took (DEVICE-TIME-HANDLING-2026-10-29 O1, owner "fix ppgdex
   issue too"). The node still keeps its deliberate node-local parser; nothing in `ppgdex-dsp.js`
   aliases `DexClock.parseTimestamp`. History: before 2026-10-29 the bundle omitted the module, and the
   entry sat here until 2026-10-24 under a comment claiming `ppgdex-dsp.js` aliases
   `DexClock.parseTimestamp` at load; it does not — every `DexClock` read in that DSP is guarded by
   `typeof`, and with the module present those guards take the branch the bundle never takes. Measured
   cost of the entry: the five reachable committed goldens were regenerated under it and carried a
   host-axis-corrected beat train, so `recording.contentId`, `recording.hostAxis`,
   `measurement.*.window.spreadMs` and up to fifteen `timeseries.ppi.tSec` values were values the
   shipped bundle cannot reproduce (residue 2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible).
   Gate: `tools · realm-manifest · single-source` reads each node's own `.src.html` and reds a realm
   that loads a module its node omits. */
var PPG_REALM = Object.freeze([
  'kernel-constants.js',
  'clock.js',
  'signal-frame.js',
  'dex-export.js',
  'metric-registry.js',
  'dex-escape.js',
  'dex-profile.js',
  'crossnight-envelope.js',
  'ppgdex-registry.js',
  'ppgdex-dsp.js',
  'ppgdex-morph.js',
  'ppgdex-cross.js',
  'ppgdex-profile.js'
]);

module.exports = {
  OXY_REALM: OXY_REALM,
  OXY_DSP_REALM: OXY_DSP_REALM,
  OXY_ECG_REALM: OXY_ECG_REALM,
  OXY_FUSION_REALM: OXY_FUSION_REALM,
  ECG_LEG: ECG_LEG,
  ECG_REALM: ECG_REALM,
  PPG_REALM: PPG_REALM
};
