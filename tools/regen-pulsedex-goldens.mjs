#!/usr/bin/env node
/*
 * tools/regen-pulsedex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate PulseDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop) lives ONCE in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3);
 * this file supplies only PulseDex's realm + fixture builders. Also reachable as
 * `node tools/regen-goldens.mjs --node PulseDex`.
 *
 * It drives the SAME seam the equivalence gate drives — RR text → PulseDex.parseRRInput(frame) →
 * PulseDex.compute({intervals,tsMs,t0Ms,offsetMin}) — in a vm realm co-loaded like PulseDex.src.html.
 *
 *   PulseDex_2026-06-25_equiv   real Polar H10 *_RR.txt          [real recording, gitignored]
 *   PulseDex_2026-06-25_events  real Polar H10 events *_RR.txt    [real recording, gitignored]
 *   synthetic_pulsedex_golden   committed synthetic RR twin       [committed — runs in CI]
 *
 *   node tools/regen-pulsedex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-pulsedex-goldens.mjs --check   # report only, write nothing (CI-safe)
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
// ESM-MIGRATION: pulsedex-dsp.js is a dual-mode ES module — shed its top-level export/import via the
// single classicify source before vm-loading it (else "Unexpected token 'export'"). No-op on classic files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the PulseDex.src.html script order (headless subset — no render/app/profile) ── */
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
  // clock.js BEFORE pulsedex-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at load.
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'pulsedex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { PulseDex } = realm();

/* RR text → parsed frame → compute(), or null when the input is absent (gitignored recording) */
const fromRR = (file) => {
  const p = path.join(UP, file);
  if (!fs.existsSync(p)) return null;
  const fr = PulseDex.parseRRInput(fs.readFileSync(p, 'utf8'));
  if (!fr) return null;
  return PulseDex.compute({ intervals: fr.vals, tsMs: fr.tsMs, t0Ms: fr.t0Ms, offsetMin: fr.offsetMin });
};

const FIXTURES = [
  { name: 'PulseDex_2026-06-25_equiv.node-export.json', real: true, build: () => fromRR('Polar_H10_AAAAAAAA_20260613_204448_RR.txt') },
  { name: 'PulseDex_2026-06-25_events.node-export.json', real: true, build: () => fromRR('PulseDex_2026-06-25_events_RR.txt') },
  { name: 'synthetic_pulsedex_golden.node-export.json', build: () => fromRR('synthetic_pulsedex_rr.txt') }
];

const rerecord = makeRerecord({ repo: REPO, node: 'PulseDex', bundle: 'PulseDex.html', uploadsDir: UP, ManifestGate });
await runRegen({ fixtures: FIXTURES, uploadsDir: UP, check: CHECK, rerecord, absentInputHint: 'copy the *_RR.txt into uploads/ to regenerate' });
