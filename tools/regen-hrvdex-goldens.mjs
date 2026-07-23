#!/usr/bin/env node
/*
 * tools/regen-hrvdex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate HRVDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3);
 * this file supplies only HRVDex's realm + fixture builders. Also reachable as
 * `node tools/regen-goldens.mjs --node HRVDex`.
 *
 * HRVDex carried a COMMITTED, code-gated synthetic golden (synthetic_hrvdex_golden.node-export.json,
 * CPAP-REAL-CORPUS §P9) with a live CI equiv/GATE-C leg (env.equiv.hrvdex_synth) but NO regen tool —
 * so a DSP change that legitimately MOVED the export had no sanctioned way to move an output byte. This
 * closes that gap, mirroring what the OxyDex/PpgDex recipes did for their nodes.
 *
 * It drives the SAME seam the equivalence gate drives (tests/dex-tests.js Phase-9 `hrvdex` case) —
 * HRVDex.compute({ text }) — in a vm realm co-loaded in HRVDex.src.html order (headless subset — no
 * render/app/DOM shell). The gate's pick is the identity, so the golden IS the compute() result.
 *
 * FIXTURES
 *   HRVDex_2026-06-25_equiv    real Welltory HRV summary CSV        [real recording, gitignored]
 *   HRVDex_2026-06-25_events   crafted Welltory event CSV           [committed — runs in CI]
 *   synthetic_hrvdex_golden    committed synthetic Welltory twin    [committed — runs in CI]
 *
 * USAGE
 *   node tools/regen-hrvdex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-hrvdex-goldens.mjs --check   # report only, write nothing (CI-safe)
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
// ESM-MIGRATION: hrvdex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading it (else "Unexpected token 'export'"). No-op on classic files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the HRVDex.src.html script order (headless subset — no render/app/DOM shell) ── */
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
  // clock.js BEFORE hrvdex-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at load.
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'hrvdex-registry.js', 'hrvdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { HRVDex } = realm();

/* Welltory summary CSV → compute({ text }) → the node-export (the equiv gate's pick is identity),
   or null when the input is absent (gitignored recording). */
const fromCSV = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  return HRVDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

const FIXTURES = [
  { name: 'HRVDex_2026-06-25_equiv.node-export.json', real: true, build: () => fromCSV('WELLTORY_HRV_DATA_EXPORT_20_May_2026_12_00_AM-17_Jun_2026_11_59_PM.csv') },
  { name: 'HRVDex_2026-06-25_events.node-export.json', real: true, build: () => fromCSV('HRVDex_2026-06-25_events.csv') },
  { name: 'synthetic_hrvdex_golden.node-export.json', build: () => fromCSV('synthetic_hrvdex_welltory.csv') }
];

const rerecord = makeRerecord({ repo: REPO, node: 'HRVDex', bundle: 'HRVDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the Welltory HRV *.csv into uploads/ to regenerate' });
