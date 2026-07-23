#!/usr/bin/env node
/*
 * tools/regen-ecgdex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate ECGDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3);
 * this file supplies only ECGDex's realm + fixture builders. Also reachable as
 * `node tools/regen-goldens.mjs --node ECGDex`.
 *
 * ECGDex carried a COMMITTED, code-gated synthetic golden (synthetic_ecgdex_golden.node-export.json,
 * CPAP-REAL-CORPUS §P9) with a live CI equiv/GATE-C leg (env.equiv.ecgdex_synth) but NO regen tool —
 * so a DSP change that legitimately MOVED the export had no sanctioned way to move an output byte. This
 * closes that gap, mirroring what the OxyDex/PpgDex recipes did for their nodes.
 *
 * It drives the SAME seam the equivalence gate drives (tests/dex-tests.js Phase-9 `ecgdex` case) —
 * ECGDex.compute({ text }) — in a vm realm co-loaded in ECGDex.src.html order (headless subset — no
 * render/app/DOM shell). ecgdex-morph.js is co-loaded so ECGDSP.analyze runs morph-active exactly as
 * the gate does (ecgdex-dsp.js calls global.ECGMorph inside try/catch). The gate's pick is the
 * identity, so the golden IS the compute() result.
 *
 * FIXTURES
 *   ECGDex_2026-06-27_equiv    real Polar H10 *_ECG.txt clip        [real recording, gitignored]
 *   synthetic_ecgdex_golden    committed synthetic H10 ECG stream   [committed — runs in CI]
 *
 * USAGE
 *   node tools/regen-ecgdex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-ecgdex-goldens.mjs --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeRerecord, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = path.join(REPO, 'uploads');
const CHECK = process.argv.includes('--check');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
// ESM-MIGRATION: ecgdex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading it (else "Unexpected token 'export'"). No-op on classic files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the ECGDex.src.html script order (headless subset — no render/app/DOM shell) ── */
function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
      clear() {
        this._m.clear();
      }
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // clock.js BEFORE ecgdex-dsp.js — the DSP aliases DexClock.parseTimestamp at load. ecgdex-morph.js
  // AFTER the DSP so ECGDSP.analyze finds global.ECGMorph (morph-active, matching the equiv gate).
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-dsp.js', 'ecgdex-morph.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { ECGDex } = realm();

/* Polar H10 *_ECG.txt → compute({ text }) → the node-export (the equiv gate's pick is identity),
   or null when the input is absent (gitignored recording). */
const fromECG = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  return ECGDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

const FIXTURES = [
  { name: 'ECGDex_2026-06-27_equiv.node-export.json', real: true, build: () => fromECG('Polar_H10_AAAAAAAA_20260617_010615_ECG_clip.txt') },
  { name: 'synthetic_ecgdex_golden.node-export.json', build: () => fromECG('synthetic_ecgdex_h10.txt') }
];

const rerecord = makeRerecord({ repo: REPO, node: 'ECGDex', bundle: 'ECGDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the Polar H10 *_ECG.txt into uploads/ to regenerate' });
