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
import { makeRerecord, resolveCorpus, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Committed fixtures are TRACKED artifacts of this checkout — never redirected (see resolveCorpus).
const UP = path.join(REPO, 'uploads');
// Raw recordings are gitignored and may live elsewhere; DEX_UPLOADS-aware, shared with verify-fixtures.
const CORPUS = resolveCorpus(REPO);
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
  /* export-schema.js BEFORE dex-export.js (`scrubExport` refuses without the shared allow-list), and
     crossnight-envelope.js before motiondex-cross.js (the envelope SHAPE; the math is node-local).
     Both arrived with the series fixture: the app scrubs every item and folds the aggregate. */
  for (const f of [
    'kernel-constants.js',
    'signal-frame.js',
    'export-schema.js',
    'dex-export.js',
    'metric-registry.js',
    'motiondex-registry.js',
    'clock.js',
    'crossnight-envelope.js',
    'motiondex-cross.js',
    'motiondex-dsp.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { MotionDex, MotionCross } = realm();

/* buildNodeExport(compute({acc,chestAcc:same})) off a committed ACC input, or null when it is absent */
const fromAcc = (file) => {
  const p = path.join(CORPUS, file);
  if (!fs.existsSync(p)) return null;
  const t = fs.readFileSync(p, 'utf8');
  return MotionDex.buildNodeExport(MotionDex.compute({ acc: t, chestAcc: t }));
};

/* ACC texts → the multi-session SERIES envelope, through the SAME builder the app's JSON button
   calls. Each file becomes one scrubbed per-session envelope, exactly as `motiondex-app.js buildEnv`
   builds it, and the list sorts ascending by `recording.startEpochMs` as `sessionsSorted()` does.
   Any absent input → null, so the run reports NOT REACHED rather than a payload over a short list.
   `generated` is pinned to the FIRST session's start and never to now: the core treats the key as
   VOLATILE, and an anchored value keeps the written file readable on its own terms. The live app
   still stamps the click time. */
const seriesFromAcc = (files) => {
  const envs = [];
  for (const file of files) {
    const p = path.join(CORPUS, file);
    const q = fs.existsSync(p) ? p : path.join(UP, file);
    if (!fs.existsSync(q)) return null;
    const t = fs.readFileSync(q, 'utf8');
    const env = MotionDex.buildNodeExport(MotionDex.compute({ acc: t, chestAcc: t }), { kernel: null });
    if (!env) return null;
    envs.push(MotionDex.scrubExport(env));
  }
  const t0 = (e) => (e && e.recording && isFinite(e.recording.startEpochMs) ? e.recording.startEpochMs : null);
  /* A finite stamp orders; an unstamped envelope keeps its insertion order after every dated one.
     NOT `(t0(a) || 0)` — that comparator sorts an unstamped session as the oldest (§∅). */
  envs.sort((a, b) => {
    const fa = t0(a) != null,
      fb = t0(b) != null;
    if (fa && fb) return t0(a) - t0(b);
    return fa ? -1 : fb ? 1 : 0;
  });
  const generated = t0(envs[0]) != null ? new Date(t0(envs[0])).toISOString() : null;
  const crossNight = envs.length > 1 && MotionCross && typeof MotionCross.crossNightBlock === 'function' ? MotionCross.crossNightBlock(envs) : undefined;
  return MotionDex.buildSeriesExport(envs, { kernel: null, provenance: null, generated, crossNight });
};

/* ── the fixture tests/run-tests.mjs wires as equiv.motiondex (pairCommitted) ── */
const FIXTURES = [
  {
    name: 'synthetic_motiondex_golden.node-export.json',
    build: () => fromAcc('synthetic_motiondex_acc.txt')
  },
  /* ── THE SERIES EXPORT ROAD (what the app's JSON button writes for ≥2 sessions) ───────────────
     Row `2026-11-24-four-nodes-summary-export-payload-has-no-known-answer`, the MotionDex slice.
     The wrapper was built INLINE in `motiondex-app.js exportJSON`, and every MotionDex fixture
     drives `buildNodeExport(compute(...))`, which answers with ONE envelope. So nothing committed
     read the wrapper, and a fabricated value in it reded no fixture. `motionBuildSeriesExport` is
     the headless builder behind that button now, and these bytes are its known answer.
     Night 2 is a SECOND synthetic night and never a duplicate, so every crossNight spread, slope
     and z-score has a real pair to describe instead of a duplicate's zero. */
  {
    name: 'synthetic_motiondex_series.export.json',
    build: () => seriesFromAcc(['synthetic_motiondex_acc.txt', 'synthetic_motiondex_series_n2_acc.txt']),
    newRecord: {
      added: '2026-11-25',
      note: 'The two-session series export (motionBuildSeriesExport + MotionCross.crossNightBlock) over the two committed synthetic ACC nights, each item scrubbed exactly as motiondex-app.js buildEnv scrubs it. Night 2 was minted by genSyntheticACC({ seed: 7, brpm: 11 }) with both stamp columns shifted one day forward, so the pair spans two evenings.',
      inputs: ['synthetic_motiondex_acc.txt', 'synthetic_motiondex_series_n2_acc.txt']
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'MotionDex', bundle: 'MotionDex.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({
  fixtures: FIXTURES,
  fixturesDir: UP,
  corpusDir: CORPUS,
  check: CHECK,
  rerecord,
  absentInputHint: 'the committed synthetic ACC is git-tracked; regenerate it via MOTIONDSP.genSyntheticACC if it changes'
});
