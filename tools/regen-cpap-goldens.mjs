#!/usr/bin/env node
/*
 * tools/regen-cpap-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate CPAPDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3);
 * this file supplies only CPAPDex's realm + fixture builders. Also reachable as
 * `node tools/regen-goldens.mjs --node CPAPDex`.
 *
 * It drives the SAME chains the equivalence/golden gates drive, in a vm realm co-loaded like
 * CPAPDex.src.html:
 *   cpapdex_synthetic_golden            _synthEdfSet → buildSessionFromEdf → buildNight → cpapBuildExport
 *   cpapdex_synthetic_edf_golden        readEDF(5 committed .edf) → CPAPDex.compute({edfSets})
 *   cpapdex_synthetic_multinight_golden 3 day-shifted nights → cpapBuildMultiNightExport
 *   cpapdex-2026-06-12 / -06-16         real AirSense EDF sets       [gitignored recordings]
 *
 *   node tools/regen-cpap-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-cpap-goldens.mjs --check   # report only, write nothing (CI-safe)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeRerecord, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ESM-MIGRATION: cpapdex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading. No-op on the classic co-load files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
const UP = path.join(REPO, 'uploads');
const CHECK = process.argv.includes('--check');

/* ── the CPAPDex.src.html script order (headless subset — no render/app) ── */
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
  for (const f of [
    'kernel-constants.js',
    'clock.js',
    'signal-frame.js',
    'dex-export.js',
    'metric-registry.js',
    'crossnight-envelope.js',
    'cpapdex-registry.js',
    'cpapdex-edf.js',
    'cpapdex-dsp.js',
    'cpapdex-cross.js',
    'cpapdex-fusion.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const ctx = realm();
const { CpapEdf, CpapDsp, CpapFusion } = ctx;

const ab = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const KINDS = ['BRP', 'PLD', 'SA2', 'EVE', 'CSL'];

/* Read one session set from a `<stamp>_<TYPE>.edf` group. */
function readSet(stamps) {
  const set = {};
  for (const [type, file] of Object.entries(stamps)) {
    const p = path.join(UP, file);
    if (!fs.existsSync(p)) return null;
    set[type] = CpapEdf.readEDF(ab(p));
  }
  return set;
}

/* ── the five fixtures ─────────────────────────────────────────────────────────────────── */
const DAY = 86400000;
const nightOf = (sets) => CpapDsp.buildNight(sets.map((s) => CpapDsp.buildSessionFromEdf(s, {})));

const FIXTURES = [
  {
    name: 'cpapdex_synthetic_golden.node-export.json',
    build: () => CpapFusion.cpapBuildExport(nightOf([CpapDsp._synthEdfSet({ oxi: true, cs: true })]))
  },
  {
    name: 'cpapdex_synthetic_edf_golden.node-export.json',
    build: () => {
      const stamps = {};
      for (const k of KINDS) stamps[k] = `20260613_231433_${k}.edf`;
      const set = readSet(stamps);
      if (!set) return null;
      return ctx.CPAPDex.compute({ edfSets: [set] });
    }
  },
  {
    name: 'cpapdex_synthetic_multinight_golden.node-export.json',
    build: () => {
      const mk = (delta) => {
        const set = CpapDsp._synthEdfSet({ oxi: true, cs: true });
        for (const k of KINDS) {
          if (set[k] && set[k].clock && set[k].clock.t0Ms != null) set[k].clock.t0Ms += delta;
          if (set[k] && set[k].annotations) {
            for (const a of set[k].annotations) if (a.tMs != null) a.tMs += delta;
          }
        }
        return nightOf([set]);
      };
      const chrono = [mk(0), mk(DAY), mk(2 * DAY)].sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
      return CpapFusion.cpapBuildMultiNightExport(chrono);
    }
  },
  {
    // REAL night — two sessions (22:28 + 04:55). Inputs are gitignored personal recordings.
    name: 'cpapdex-2026-06-12.node-export.json',
    real: true,
    build: () => {
      const a = readSet({ BRP: '20260612_222830_BRP.edf', PLD: '20260612_222830_PLD.edf', SA2: '20260612_222830_SA2.edf', EVE: '20260612_222819_EVE.edf', CSL: '20260612_222819_CSL.edf' });
      const b = readSet({ BRP: '20260613_045505_BRP.edf', PLD: '20260613_045505_PLD.edf', SA2: '20260613_045505_SA2.edf', EVE: '20260613_045457_EVE.edf', CSL: '20260613_045457_CSL.edf' });
      if (!a || !b) return null;
      return CpapFusion.cpapBuildExport(nightOf([a, b]));
    }
  },
  {
    // REAL night — single session.
    name: 'cpapdex-2026-06-16.json',
    real: true,
    build: () => {
      const s = readSet({ BRP: '20260616_213618_BRP.edf', PLD: '20260616_213618_PLD.edf', SA2: '20260616_213618_SA2.edf', EVE: '20260616_213611_EVE.edf', CSL: '20260616_213611_CSL.edf' });
      if (!s) return null;
      return CpapFusion.cpapBuildExport(nightOf([s]));
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'CPAPDex', bundle: 'CPAPDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the EDFs into uploads/ to regenerate' });
