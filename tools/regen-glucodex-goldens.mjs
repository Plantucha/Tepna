#!/usr/bin/env node
/*
 * tools/regen-glucodex-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate GlucoDex's committed node-export fixtures by RE-RUNNING THE REAL MODULES on their
 * committed inputs and re-exporting — never by hand-editing a value (CLAUDE.md §🔏). The shared
 * scaffolding (diff/merge/rerecord/loop, incl. the MINT path for a first-generation fixture) lives ONCE
 * in tools/regen-goldens-core.mjs (FOLLOWUPS-III §3); this file supplies only GlucoDex's realm + fixture
 * builders. Also reachable as `node tools/regen-goldens.mjs --node GlucoDex`.
 *
 * It drives the SAME seam the equivalence gate drives — GlucoDex.compute({text: CSV}) — in a vm realm
 * co-loaded like GlucoDex.src.html:
 *   GlucoDex_2026-06-27_equiv     real Abbott Lingo CSV              [real recording, gitignored]
 *   synthetic_glucodex_golden     committed synthetic Lingo          [committed — runs in CI]
 *   synthetic_glucodex_gap_golden committed 14 h-gap adversarial twin [committed — pins GAP_LONG in CI]
 *
 *   node tools/regen-glucodex-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-glucodex-goldens.mjs --check   # report only, write nothing (CI-safe)
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
// ESM-MIGRATION Phase 2 — glucodex-dsp.js is a dual-mode ES module; classic-load it into the vm realm.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the GlucoDex.src.html script order (headless subset — no render/app/profile) ── */
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
  for (const f of ['kernel-constants.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'glucodex-registry.js', 'glucodex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const { GlucoDex } = realm();

/* compute({text}) off a committed input, or null when the input is absent (gitignored recording) */
const fromCsv = (file) => {
  const p = path.join(CORPUS, file);
  if (!fs.existsSync(p)) return null;
  return GlucoDex.compute({ text: fs.readFileSync(p, 'utf8') });
};

/* ── the two fixtures (the pair `tests/run-tests.mjs` wires as equiv.glucodex / .glucodex_synth) ── */
const FIXTURES = [
  {
    name: 'GlucoDex_2026-06-27_equiv.node-export.json',
    real: true,
    build: () => fromCsv('lingo-glucose-data-2026-MAY-23.csv')
  },
  {
    name: 'synthetic_glucodex_golden.node-export.json',
    build: () => fromCsv('synthetic_glucodex_lingo.csv')
  },
  // The ADVERSARIAL twin — a committed 14 h sensor-change gap (FIXTURE-VERIFICATION-GATE §4). The clean
  // golden above trips NO FLAG.GAP_LONG, which is exactly how DEEP-AUDIT-2026-07-14 §1 could call itself
  // export-inert on its evidence and ship a moved real export. This golden pins the GAP_LONG path in CI,
  // with no corpus: it separates current code (daypart n = 697) from pre-§1 code (864).
  {
    name: 'synthetic_glucodex_gap_golden.node-export.json',
    build: () => fromCsv('synthetic_glucodex_lingo_gap.csv'),
    // `newRecord` = this fixture may be MINTED if absent (a first generation), rather than skipped.
    // Without it, standing up a new fixture would mean hand-writing an export + a ledger record — the
    // two things §🔏 forbids outright. With it, the bytes come from the app and the hashes from the gates.
    newRecord: {
      added: '2026-07-14',
      inputs: ['synthetic_glucodex_lingo_gap.csv'],
      note: "ADDED 2026-07-14 (FIXTURE-VERIFICATION-GATE-2026-07-14 §4 — the GlucoDex adversarial twin that DEEP-AUDIT-FOLLOWUPS-2026-07-12 §A never shipped). The CLEAN synthetic Lingo trips NO FLAG.GAP_LONG, so the whole long-gap path was unexercised by any COMMITTED input — which is precisely how DEEP-AUDIT-2026-07-14 §1 could declare itself EXPORT-INERT on the clean golden's evidence, move the REAL Lingo night's export, and ship: the real-recording equiv leg SKIPS wherever uploads/ is absent (CI, and the executing session's machine). This input is a synthetic 3-day Lingo CSV with a 14 h sensor-change gap (readings stop on the post-lunch decay at 143 mg/dL, resume 14 h later at 100), so clean() draws 168 GAP_LONG cells that are NEVER measured glucose. It is COMMITTED, so it runs in CI with no corpus. It SEPARATES THE TWO CODES: current code excludes the drawn cells (daypart n = 168+216+169+144 = 697); pre-§1 code counted them as measured (n = 216+216+216+216 = 864). Generated by re-running the real modules via tools/regen-glucodex-goldens.mjs (GlucoDex.compute({text}) — the seam the equiv gate drives), never hand-edited."
    }
  },
  // The COLUMN-PICK adversarial twin (DEEP-AUDIT-VI F6) — Dexcom Clarity layout: a serial Index
  // counter whose values live inside locateColumns' band, plus the "Low" cells Clarity writes for
  // below-range readings. One Low cell used to flip the glucose pick to the Index column, computing
  // every headline metric on ROW NUMBERS. Neither Lingo twin can express this (no counter column,
  // no Low sentinel); this one pins the fixed pick in CI with no corpus.
  {
    name: 'synthetic_glucodex_clarity_low_golden.node-export.json',
    build: () => fromCsv('synthetic_glucodex_clarity_low.csv'),
    newRecord: {
      added: '2026-09-02',
      inputs: ['synthetic_glucodex_clarity_low.csv'],
      note: "ADDED 2026-09-02 (DEEP-AUDIT-VI F6 — glucodex-dsp.js locateColumns picked Dexcom Clarity's serial Index column as glucose the moment ONE 'Low' cell appeared in the 60-row sample, so every headline metric was computed on row numbers; the audit's executed repro measured mean 501 mg/dL / GMI 15.3 / TIR 11.1 on a 1000-row file with 3 Low cells). This input is a committed synthetic 2-day Clarity-layout CSV: Index 1..576 ascending, six 'Low' cells in a planted 03:00 hypo, plus the decoys that must not win (a Transmitter Time long-integer column, step 300; a 'Glucose Rate of Change' header that also matches /gluco/i). It SEPARATES THE TWO CODES: fixed code picks the declared 'Glucose Value (mg/dL)' column (n=570 measured readings, mean in the planted 70–200 band); pre-F6 code picks Index and reports mean ≈ 288.5 = avg(1..576). Generated by re-running the real modules via tools/regen-glucodex-goldens.mjs (GlucoDex.compute({text}) — the seam the equiv gate drives), never hand-edited."
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'GlucoDex', bundle: 'GlucoDex.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({ fixtures: FIXTURES, fixturesDir: UP, corpusDir: CORPUS, check: CHECK, rerecord, absentInputHint: 'copy the CSV into uploads/ to regenerate' });
