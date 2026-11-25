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
import { makeRerecord, resolveCorpus, runRegen } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Committed fixtures are TRACKED artifacts of this checkout — never redirected (see resolveCorpus).
const UP = path.join(REPO, 'uploads');
// Raw recordings are gitignored and may live elsewhere; DEX_UPLOADS-aware, shared with verify-fixtures.
const CORPUS = resolveCorpus(REPO);
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
  /* crossnight-envelope.js + pulsedex-cross.js join the headless subset for the SERIES fixture: its
     payload carries the `ganglior.crossnight` block, and PulseDex.src.html loads these two in this
     order. Both are pure — pulsedex-cross.js reads no DOM and only looks for window.CrossNightEnvelope,
     so loading the envelope first is what keeps the fixture on the app's arm of that branch. */
  for (const f of ['kernel-constants.js', 'clock.js', 'clock-seam.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'pulsedex-dsp.js', 'crossnight-envelope.js', 'pulsedex-cross.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { PulseDex, PulseCross } = realm();

/* RR text → parsed frame → compute(), or null when the input is absent (gitignored recording) */
const fromRR = (file) => {
  const p = path.join(CORPUS, file);
  if (!fs.existsSync(p)) return null;
  const fr = PulseDex.parseRRInput(fs.readFileSync(p, 'utf8'));
  if (!fr) return null;
  return PulseDex.compute({ intervals: fr.vals, tsMs: fr.tsMs, t0Ms: fr.t0Ms, offsetMin: fr.offsetMin });
};

/* RR texts → the summary/series export payload, through the SAME builder the app's JSON button calls.
   Each file becomes a lastResult-shaped recording (PulseDex.computeResult, the sibling compute() wraps),
   sorted ascending by t0Ms exactly as recordingsSortedPx() does. Any absent input → null, so the run
   reports NOT REACHED rather than a payload over a short list. */
const summaryFromRR = (files) => {
  const recs = [];
  for (const file of files) {
    const p = path.join(CORPUS, file);
    const q = fs.existsSync(p) ? p : path.join(UP, file);
    if (!fs.existsSync(q)) return null;
    const fr = PulseDex.parseRRInput(fs.readFileSync(q, 'utf8'));
    if (!fr) return null;
    const r = PulseDex.computeResult({ intervals: fr.vals, tsMs: fr.tsMs, t0Ms: fr.t0Ms, offsetMin: fr.offsetMin });
    if (!r) return null;
    recs.push(r);
  }
  /* Ascending by t0Ms, and NOT `(a.t0Ms || 0)` — that comparator is the one pulsedex-cross.js's own
     §∅ note records as a defect, because an unstamped recording then sorts as the oldest. A finite
     stamp orders; a non-finite one keeps its insertion order after every dated recording. */
  recs.sort((a, b) => {
    const fa = typeof a.t0Ms === 'number' && isFinite(a.t0Ms),
      fb = typeof b.t0Ms === 'number' && isFinite(b.t0Ms);
    if (fa && fb) return a.t0Ms - b.t0Ms;
    return fa ? -1 : fb ? 1 : 0;
  });
  const generated = recs[0] && recs[0].t0Ms != null ? new Date(recs[0].t0Ms).toISOString() : null;
  const crossNight = recs.length > 1 && PulseCross && typeof PulseCross.crossNightBlock === 'function' ? PulseCross.crossNightBlock(recs) : undefined;
  return PulseDex.buildSummaryExport(recs, { kernel: null, provenance: null, generated, crossNight });
};

const FIXTURES = [
  { name: 'PulseDex_2026-06-25_equiv.node-export.json', real: true, build: () => fromRR('Polar_H10_AAAAAAAA_20260613_204448_RR.txt') },
  { name: 'PulseDex_2026-06-25_events.node-export.json', real: true, build: () => fromRR('PulseDex_2026-06-25_events_RR.txt') },
  { name: 'synthetic_pulsedex_golden.node-export.json', build: () => fromRR('synthetic_pulsedex_rr.txt') },
  /* ── THE SUMMARY/SERIES EXPORT ROAD (what the app's JSON button writes) ────────────────────────
     `pdBuildSummaryExport` is the headless builder behind `exportJSON()`. Before these two fixtures
     nothing committed read that payload, so #5680's repair of a fabricated altitude factor on this
     exact road could only be pinned on the SOURCE TEXT. A fixture reads the bytes instead.
       SUMMARY — one recording. The payload IS that recording's object, which is the arm a reader
                 most often exports, and `recordingCount`/`crossNight` do not exist on it.
       SERIES  — two recordings. Night 1 is the committed synthetic twin; night 2 is the NIGHTS[1]
                 story (AHI 38, rMSSD 18) bedded the next evening, so every crossNight spread,
                 slope and z-score has a real pair to describe instead of a duplicate's zero.
     `generated` is pinned to the FIRST recording's start, not to now: the core already treats the
     key as VOLATILE, and an anchored value keeps the written file readable on its own terms. The
     live app still stamps the click time (EXPORT-HYGIENE-FOLLOWUPS-II §2 is untouched). */
  {
    name: 'synthetic_pulsedex_summary.export.json',
    build: () => summaryFromRR(['synthetic_pulsedex_rr.txt']),
    newRecord: {
      added: '2026-11-24',
      note: 'The one-recording summary export (pdBuildSummaryExport) over the committed synthetic RR night — the payload the app JSON button writes for a single recording.',
      inputs: ['synthetic_pulsedex_rr.txt']
    }
  },
  {
    name: 'synthetic_pulsedex_series.export.json',
    build: () => summaryFromRR(['synthetic_pulsedex_rr.txt', 'synthetic_pulsedex_series_n2_rr.txt']),
    newRecord: {
      added: '2026-11-24',
      note: 'The two-recording series export (pdBuildSummaryExport + PulseCross.crossNightBlock) over the two committed synthetic RR nights.',
      inputs: ['synthetic_pulsedex_rr.txt', 'synthetic_pulsedex_series_n2_rr.txt']
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'PulseDex', bundle: 'PulseDex.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({ fixtures: FIXTURES, fixturesDir: UP, corpusDir: CORPUS, check: CHECK, rerecord, absentInputHint: 'copy the *_RR.txt into uploads/ to regenerate' });
