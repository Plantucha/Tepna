// dex-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// Ambient declarations for the CO-LOADED shared globals — the modules each app realm loads via
// dex-coload.js (clock.js → DexClock, dex-export.js → DexExport/dexScrubExport, signal-frame.js →
// SignalFrame, …). Each is attached to `root.X` inside its own IIFE, so tsc cannot see it as a bare
// name across files; without these declarations a module that references a sibling's global reds the
// checkJs gate with TS2304 ("Cannot find name").
//
// Typed `any` on purpose: this is the CI-only checkJs type gate (OWN-THE-BUILD-FOLLOWUPS §5 D.2 /
// DEV-TOOLCHAIN Part C) — its value is checking each module's OWN logic, not re-typing the external
// co-loaded surface (which each provider module gates itself once it joins the include). Declaring the
// name here lets a consumer module (e.g. pulsedex-dsp.js) enter the gate with NO source edit, hence NO
// bundle re-hash. Extend this list as further modules are added to `tsconfig.include`.
//
// NO runtime, NO emit, NO shipped artifact — a .d.ts is a dev-time type artifact only, exactly like
// tsconfig.json (the 100%-local/offline invariant is untouched).

declare var DexClock: any; // clock.js — the Clock-Contract parser (parseTimestamp, fmt*, …)
declare var DexExport: any; // dex-export.js — the shared node-export builder
declare var dexScrubExport: any; // dex-export.js — the export identity-scrub helper
declare var SignalFrame: any; // signal-frame.js — the canonical signal container
declare var DexKernel: any; // kernel-constants.js — the shared kernel constants + fnv1a
declare var DexUnits: any; // quantity.js — the shared units/quantity engine (toMetric, toDisplay, …)
