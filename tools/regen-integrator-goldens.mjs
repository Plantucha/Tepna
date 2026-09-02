#!/usr/bin/env node
/*
 * tools/regen-integrator-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regenerate the Integrator's committed golden by RE-RUNNING THE REAL MODULES on inputs rebuilt
 * in-code — never by hand-editing a value (CLAUDE.md §🔏). Shared scaffolding lives in
 * tools/regen-goldens-core.mjs; this file supplies only the Integrator's realm + fixture builder.
 *
 * WHY IT EXISTS (DEEP-AUDIT-III §6.6 → FOLLOWUPS §1.5). `tools/regen-goldens.mjs`'s NODES map covered
 * all 8 nodes but NOT the Integrator — yet provenance/Integrator.json carries a code-gated fixture with
 * a real `verifiedUnder` stamp and a live equiv leg. So a TCH-fusion change that legitimately MOVED that
 * output had NO sanctioned way to be re-recorded, and hand-editing is forbidden: the only legal move was
 * blocked. This closes the last empty cell in the class-13 coverage matrix.
 *
 * SINGLE-SOURCED INPUTS. The three-node co-recorded night is built by tests/tch-golden-inputs.js, the
 * SAME builder the equivalence gate uses. A private copy here would drift from the gate — the
 * sibling-divergence class the parent audit exists to fix — so there is exactly one builder and the
 * gate's own `≡ committed golden` assertion proves this tool and that gate agree.
 *
 * FIXTURE
 *   integrator_tch_golden.node-export.json   inputs rebuilt IN-CODE (inputHashes:{}) — a pure function
 *                                            of Integrator code; no node compute is ever run, so an
 *                                            OxyDex/ECGDex/PpgDex DSP change cannot move it.
 *
 * USAGE
 *   node tools/regen-integrator-goldens.mjs           # regenerate + re-record + report what moved
 *   node tools/regen-integrator-goldens.mjs --check   # report only, write nothing (CI-safe)
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
const require = createRequire(import.meta.url);
const ManifestGate = require(path.join(REPO, 'manifest-gate.js'));
const DexBuild = require(path.join(REPO, 'tools', 'build-core.js'));
const { tchGoldenInputs } = require(path.join(REPO, 'tests', 'tch-golden-inputs.js'));
const { apneaNullTwins } = require(path.join(REPO, 'tests', 'apnea-null-twins.js'));

/* Integrator.src.html script order (headless subset — no render/app/DOM shell). */
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
  // clock.js BEFORE integrator-dsp.js — the delegating DSP aliases DexClock.parseTimestamp at load.
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'event-coupling.js', 'integrator-tch.js', 'integrator-dsp.js'])
    if (fs.existsSync(path.join(REPO, f))) vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const ctx = realm();
/* integrator-dsp.js declares its fusion functions at module top level (the equivalence gate reaches
   them as `ctx.adaptEnvelopeNode` / `ctx.fuseHRVConsensus`, not through window.IntegratorDSP), so read
   them the same way the gate's runner does — one seam, no second convention. */
const adaptEnvelopeNode = ctx.adaptEnvelopeNode;
const fuseHRVConsensus = ctx.fuseHRVConsensus;
const fuseApneaEvents = ctx.fuseApneaEvents;

/* adapt → fuseHRVConsensus, exactly the seam the equivalence gate drives. */
const buildTch = () => {
  if (typeof adaptEnvelopeNode !== 'function' || typeof fuseHRVConsensus !== 'function') return null;
  const recs = tchGoldenInputs().map((x) => adaptEnvelopeNode(x.json, x.node, x.node)[0]);
  return {
    schema: {
      name: 'ganglior.integrator-tch-golden',
      version: '1.0',
      doc: 'Deterministic HR-hat (ECG+PPG+Oxy) golden — first code-gated Integrator fixture (INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II §2). Inputs rebuilt in-code by the equivalence gate.'
    },
    consensus: fuseHRVConsensus(recs, 1000)
  };
};

/* The APNEA-NULL twins (DEEP-AUDIT-VI-FOLLOWUPS §4.3). Before these, the Integrator's only
   code-gated fixture was the TCH consensus above, which carries no `apneaNullModel` at all — so
   §4.2b changed the reportability gate and `regen` reported "0 moved" because NOTHING COMMITTED
   COULD EXPRESS THE CHANGE. That is silence by construction, the failure class this repo keeps
   finding, and it is what these close.
   FOUR twins, and each earns its place by catching a mutant the others miss:
     coupled/uncoupled — the two DIRECTIONS of the gate (published / withheld). A corpus with one
       direction can only half-fail: a null that published everything would go green on `coupled`.
     gapped            — the ONLY twin that sees `_coveredShift`; on a single-segment night a
       covered-time wrap and a wall-clock wrap are identical, measured.
     contended         — the ONLY twin that sees the null scoring the PUBLISHED matching. Its desats
       cluster 12 s apart so they compete for one surge; elsewhere an exclusive and a non-exclusive
       scorer agree, so the central claim of §4.2b was unwitnessed.
   ONE fixture, four twins: any byte of any twin moving reds the ledger. */
const buildApneaTwins = () => {
  if (typeof adaptEnvelopeNode !== 'function' || typeof fuseApneaEvents !== 'function') return null;
  const T = apneaNullTwins();
  const out = {
    schema: {
      name: 'ganglior.integrator-apnea-null-twins',
      version: '1.0',
      doc: 'Committed synthetic twins for the apnea chance-null (DEEP-AUDIT-VI-FOLLOWUPS §4.3). Inputs rebuilt in-code by tests/apnea-null-twins.js, the same builder the equivalence gate uses.'
    },
    twins: {}
  };
  for (const k of ['coupled', 'uncoupled', 'gapped', 'contended']) {
    const recs = T[k].map((x) => adaptEnvelopeNode(x.json, x.node, x.node)[0]);
    const fused = fuseApneaEvents(recs, 120000, {});
    out.twins[k] = fused
      ? { nullModel: fused.nullModel, nConf: fused.findings.length, confirmedAHI: fused.confirmedAHI, confirmedAHIReportable: fused.confirmedAHIReportable, overlapHours: fused.overlapHours }
      : null;
  }
  return out;
};

const FIXTURES = [
  { name: 'integrator_tch_golden.node-export.json', real: false, build: buildTch },
  {
    name: 'integrator_apnea_null_twins.node-export.json',
    real: false,
    build: buildApneaTwins,
    // `newRecord` = MINT this fixture's ledger entry if absent, rather than skip. Without it,
    // standing up a new fixture means hand-writing an export AND a ledger record — the two things
    // §🔏 forbids outright. With it the bytes come from the real modules and the hashes from the gates.
    newRecord: {
      added: '2026-09-02',
      inputs: [],
      note: "ADDED 2026-09-02 (DEEP-AUDIT-VI-FOLLOWUPS §4.3). The Integrator's only code-gated fixture was integrator_tch_golden, a TCH consensus export carrying NO apneaNullModel — so when §4.2b replaced the apnea reportability gate's chance-null, `regen` reported \"0 fixtures moved\" because no committed artifact could express the change. Silence by construction, not evidence. FOUR twins, inputs rebuilt in-code by tests/apnea-null-twins.js (the same builder the equiv gate uses, so the two cannot drift): `coupled` and `uncoupled` are the two DIRECTIONS of the gate (published at the surrogate floor / withheld mid-range) because a corpus expressing one direction can only half-fail; `gapped` declares recording.coverage.segments with a 100-min hole and is the ONLY twin that can see _coveredShift, since on a single-segment night a covered-time wrap and a wall-clock wrap are byte-identical; `contended` clusters desats 12 s apart so several compete for one surge, and is the ONLY twin that can see the null scoring the PUBLISHED exclusive matching — elsewhere an exclusive and a non-exclusive scorer agree, leaving §4.2b's central claim unwitnessed. Each of the five mutants tried against this fixture moves its bytes; the last two are each caught by exactly one twin. Generated by re-running the real modules via tools/regen-integrator-goldens.mjs, never hand-edited."
    }
  }
];

const rerecord = makeRerecord({ repo: REPO, node: 'Integrator', bundle: 'Integrator.html', fixturesDir: UP, corpusDir: CORPUS, ManifestGate });
await runRegen({
  fixtures: FIXTURES,
  fixturesDir: UP,
  corpusDir: CORPUS,
  check: CHECK,
  rerecord,
  absentInputHint: 'inputs are rebuilt in-code — an absent build means the Integrator realm failed to load'
});
