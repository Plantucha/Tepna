#!/usr/bin/env node
/*
 * tools/regen-oxydex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate OxyDex's committed golden fixtures by RE-RUNNING THE REAL MODULES on their committed
 * inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared scaffolding
 * (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs; this file supplies only
 * OxyDex's realm + fixture builders. Also reachable as `node tools/regen-goldens.mjs --node OxyDex`.
 *
 * OxyDex was the one code-gated node WITHOUT a regenerator (CPAPDex/GlucoDex/PulseDex/MotionDex all
 * had one), so DEEP-AUDIT-II §2.1/§2.2 — which moves every OxyDex export — had no sanctioned way to
 * move an output byte. Written as the one-off CLAUDE.md anticipates ("copy the CPAP/GlucoDex pair").
 *
 * It drives the SAME seam the equivalence gate drives — OxyDex.compute({ text }) → nights[0] — in a
 * vm realm co-loaded in OxyDex.src.html order.
 *
 * NOTE the two container shapes: the two real summaries are stored as a ONE-ELEMENT ARRAY, the
 * synthetic golden as the bare night object. The equiv gate already tolerates both (`fixPick`), so
 * each fixture is rewritten in the shape it already has rather than normalised to one.
 *
 *   OxyDex_2026-06-13_1056_summary   real O2Ring CSV              [real recording, gitignored]
 *   OxyDex_2026-06-25_0439_summary   real O2Ring CSV              [real recording, gitignored]
 *   synthetic_oxydex_golden          committed synthetic O2Ring   [committed — runs in CI]
 *
 *   node tools/regen-oxydex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-oxydex-goldens.mjs --check   # report only, write nothing (CI-safe)
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
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the OxyDex.src.html script order (headless subset — no render/app) ── */
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
  // clock.js BEFORE oxydex-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at load.
  for (const f of [
    'kernel-constants.js',
    'signal-frame.js',
    'dex-export.js',
    'oxydex-util.js',
    'crossnight-envelope.js',
    'metric-registry.js',
    'dex-profile.js',
    'oxydex-registry.js',
    'oxydex-cross.js',
    'clock.js',
    'oxydex-profile.js',
    'oxydex-dsp.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { OxyDex } = realm();

/* O2Ring CSV → compute() → nights[0], or null when the input is absent (gitignored recording).
   `wrap` reproduces the fixture's existing container: [night] for the summaries, night for the twin. */
const fromCSV = (file, wrap) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const res = OxyDex.compute({ text: fs.readFileSync(p, 'utf8') });
  const night = res && res.nights && res.nights[0];
  if (!night) return null;
  return wrap ? [night] : night;
};

const FIXTURES = [
  { name: 'OxyDex_2026-06-13_1056_summary.json', real: true, build: () => fromCSV('O2Ring S 2100_20260612230016.csv', true) },
  { name: 'OxyDex_2026-06-25_0439_summary.json', real: true, build: () => fromCSV('O2Ring S 2100_20260624222730.csv', true) },
  { name: 'synthetic_oxydex_golden.node-export.json', build: () => fromCSV('synthetic_oxydex_o2ring.csv', false) }
];

const rerecord = makeRerecord({ repo: REPO, node: 'OxyDex', bundle: 'OxyDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the O2Ring *.csv into uploads/ to regenerate' });
