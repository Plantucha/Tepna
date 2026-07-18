#!/usr/bin/env node
/*
 * tools/regen-motiondex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate MotionDex's committed node-export fixture by RE-RUNNING THE REAL MODULES on the
 * committed input and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs; this file supplies
 * only MotionDex's vm realm + fixture builder. Also reachable as
 * `node tools/regen-goldens.mjs --node MotionDex`.
 *
 * It drives the SAME seam the equivalence gate drives —
 *   MotionDex.buildNodeExport(MotionDex.compute({ acc, chestAcc: acc })) — in a vm realm co-loaded like
 * MotionDex.src.html (headless subset, no render/app):
 *   synthetic_motiondex_golden   committed synthetic Polar ACC   [committed — runs in CI, no corpus]
 *
 *   node tools/regen-motiondex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-motiondex-goldens.mjs --check   # report only, write nothing (CI-safe)
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
// motiondex-dsp.js is a dual-mode ES module; classic-load it into the vm realm.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the MotionDex.src.html script order (headless subset — no render/app) ── */
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
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // clock.js BEFORE motiondex-dsp.js (the DSP delegates DexClock at load; Clock Contract).
  for (const f of ['kernel-constants.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'motiondex-registry.js', 'clock.js', 'motiondex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { MotionDex } = realm();

/* buildNodeExport(compute({acc,chestAcc:same})) off a committed ACC input, or null when it is absent */
const fromAcc = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const t = fs.readFileSync(p, 'utf8');
  return MotionDex.buildNodeExport(MotionDex.compute({ acc: t, chestAcc: t }));
};

/* ── the fixture tests/run-tests.mjs wires as equiv.motiondex (pairCommitted) ── */
const FIXTURES = [
  {
    name: 'synthetic_motiondex_golden.node-export.json',
    build: () => fromAcc('synthetic_motiondex_acc.txt')
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'MotionDex', bundle: 'MotionDex.html', uploadsDir: UP, ManifestGate });
await runRegen({
  fixtures: FIXTURES,
  uploadsDir: UP,
  check: CHECK,
  rerecord,
  absentInputHint: 'the committed synthetic ACC is git-tracked; regenerate it via MOTIONDSP.genSyntheticACC if it changes'
});
