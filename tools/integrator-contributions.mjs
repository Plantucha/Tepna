#!/usr/bin/env node
/*
 * tools/integrator-contributions.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE GATE HARNESS for the Integrator's attribution block — VERDICT-CONTRIBUTIONS-2026-10-04 §2's
 * Integrator row (`integrator-dsp.js`, `leave-one-out over nodes`).
 *
 * WHY A TOOL AND NOT JUST THE SUITE. `verify:verdict-adoption` reads an `adopted` row's `emits`,
 * runs it, and requires ONE parseable `tepna.verdict/1` whose validator reports `contributions`
 * among the fields it EXAMINED. "An adoption the gate cannot read is a claim." The suite proves the
 * block against the committed fixture; this tool is what the adoption gate can execute, and it adds
 * the two floors the committed corpus cannot express — a one-input bus and a figure that is null.
 *
 * WHAT IT CHECKS (pre-stated, five checks, all must hold)
 *   1 ∅ on every two-node twin — `delta: null` + a reason for BOTH inputs, every share and
 *     `dominant` null. The apnea index needs a desaturation observer AND a cardiac node, so a
 *     reduced two-node bus cannot produce the figure: unknown, never 0 (CLAUDE.md §∅).
 *   2 numbers on the four-node twin — four inputs, shares summing to 1 ± 1e-9, and the PLANTED
 *     dominant `node.ECGDex` (the only node corroborating the whole night).
 *   3 a measured 0 stays distinguishable from a ∅ null — exactly two inputs with `delta: 0`,
 *     `share: 0` and NO reason.
 *   4 one input, no block (§1: a figure with one input has nothing to attribute).
 *   5 no figure, no block — the attribution belongs to a published number.
 *   6 the block VALIDATES under verdict.js, which is also what the adoption gate reads.
 *
 * A BLOCK THAT DOES NOT VALIDATE IS A FINDING, NOT AN INABILITY TO LOOK. Measured while building
 * this tool: a mutant that named the wrong `dominant` made the emitted verdict itself invalid, and
 * an earlier version exited 2 — "I could not look" — over a defect it had already found. So the
 * validator runs as check 6, and on a bad block the object carries `contributions: null`, the bad
 * block under `result.invalidContributions`, and exit 1.
 *
 * STATUS. PASS when all five hold, FAIL naming the ones that did not. Exit 0 / 1, and 2 when it
 * could NOT LOOK (the realm or the twins builder unavailable) — never a green over an unexamined
 * corpus (§4b).
 *
 * USAGE
 *   node tools/integrator-contributions.mjs                        # prose + the verdict object
 *   node tools/integrator-contributions.mjs --contributions-sample # ONLY the object (the gate's cmd)
 *   node tools/integrator-contributions.mjs --selftest              # plant bad blocks; the checks must red
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SAMPLE = process.argv.includes('--contributions-sample');
const SELFTEST = process.argv.includes('--selftest');
const say = (...a) => {
  if (!SAMPLE) console.log(...a);
};

/* Integrator.src.html's headless subset, in load order — clock.js BEFORE integrator-dsp.js. */
const FILES = ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'event-coupling.js', 'integrator-tch.js', 'integrator-dsp.js'];

function realm() {
  const DexBuild = require(path.join(REPO, 'tools', 'build-core.js'));
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sb.__DEX_NAMESPACED__ = true;
  const ctx = vm.createContext(sb);
  for (const f of FILES) vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return sb;
}

function commit() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
/* `producedBy.commit` is a 7–40 hex sha or null WITH a reason — a word like 'unknown' makes the
   whole verdict invalid, which would turn a run outside a checkout into exit 2 over a corpus it
   examined perfectly well. Measured while writing the selftest, whose first probe said 'selftest'. */
function prov() {
  const c = commit();
  return /^[0-9a-f]{7,40}$/.test(c || '')
    ? { tool: 'tools/integrator-contributions.mjs', commit: c }
    : { tool: 'tools/integrator-contributions.mjs', commit: null, commitReason: 'not a git checkout — `git rev-parse HEAD` is unavailable here' };
}

/* ── could we look at all? ─────────────────────────────────────────────────────────────────── */
let R, twins;
try {
  R = realm();
  twins = require(path.join(REPO, 'tests', 'apnea-null-twins.js')).apneaNullTwins;
} catch (e) {
  console.error('⏱ UNEXAMINED tools/integrator-contributions.mjs — realm unavailable: ' + e.message);
  process.exit(2);
}
if (typeof R.fuseApneaEvents !== 'function' || typeof R.apneaIndexContributions !== 'function' || typeof twins !== 'function') {
  console.error('⏱ UNEXAMINED tools/integrator-contributions.mjs — fuseApneaEvents / apneaIndexContributions / apneaNullTwins not in the realm');
  process.exit(2);
}

const Verdict = require(path.join(REPO, 'verdict.js'));

/* ── SELFTEST — a gate that cannot go red is not a gate ────────────────────────────────────────
   Check 6 below delegates to `verdict.js`, so what has to be proven is that the delegation
   DISCRIMINATES: four blocks broken one rule at a time must each be rejected, and the shape the
   kernel actually emits must be accepted. Plants, not the corpus — the corpus can only show the
   accepted shape, and a check that only ever sees valid input has examined nothing (§4b). */
function validates(block) {
  const r = Verdict.validate({
    schema: 'tepna.verdict/1',
    gate: 'integrator-contributions',
    status: 'PASS',
    scope: 'internal',
    population: { checked: 1, eligible: 1, excluded: 0 },
    criterion: { name: 'probe', threshold: 1, unit: '', direction: 'eq' },
    result: { probe: true },
    contributions: block,
    evidence: ['tools/integrator-contributions.mjs'],
    reason: null,
    producedBy: prov(),
    at: '2026-11-04T00:00:00Z'
  });
  return !!r.ok && (r.checked || []).includes('contributions');
}
function selftest() {
  const base = () => ({
    of: 'confirmedApneaIndex',
    unit: 'events/h',
    method: 'leave-one-out',
    inputs: [
      { key: 'node.ECGDex', share: 0.75, delta: 3 },
      { key: 'node.OxyDex', share: 0.25, delta: -1 }
    ],
    dominant: 'node.ECGDex'
  });
  const allNull = () => ({
    of: 'confirmedApneaIndex',
    unit: 'events/h',
    method: 'leave-one-out',
    inputs: [
      { key: 'node.ECGDex', share: null, delta: null, reason: 'reduced-bus-unfusable' },
      { key: 'node.OxyDex', share: null, delta: null, reason: 'reduced-bus-unfusable' }
    ],
    dominant: null
  });
  const plants = [
    ['the shape the kernel emits is ACCEPTED', base(), true],
    ['…and so is the all-∅ shape a two-node bus produces', allNull(), true],
    [
      'a wrong dominant is rejected',
      (() => {
        const b = base();
        b.dominant = 'node.OxyDex';
        return b;
      })(),
      false
    ],
    [
      'shares that do not sum to 1 are rejected',
      (() => {
        const b = base();
        b.inputs[0].share = 0.5;
        return b;
      })(),
      false
    ],
    [
      'a delta: null with no reason is rejected (∅)',
      (() => {
        const b = allNull();
        delete b.inputs[0].reason;
        return b;
      })(),
      false
    ],
    [
      'a share beside a null delta is rejected (∅ — no manufactured denominator)',
      (() => {
        const b = allNull();
        b.inputs[0].share = 1;
        return b;
      })(),
      false
    ],
    [
      'one input is rejected — a figure with one input carries no block',
      (() => {
        const b = base();
        b.inputs = [b.inputs[0]];
        b.inputs[0].share = 1;
        return b;
      })(),
      false
    ]
  ];
  let bad = 0;
  for (const [name, block, want] of plants) {
    const got = validates(block);
    const ok = got === want;
    if (!ok) bad++;
    console.log((ok ? '✓ ' : '✗ ') + name + ' — validates=' + got + ' expected=' + want);
  }
  /* `test:tools` reads the assertion COUNT off this line (`selftest-all.mjs typedSummary`), and a new
     tool may not join UNPARSEABLE_RATCHET — a plant set shrinking from seven to one is visible only
     there. One plant is one assertion, so the count is `plants.length` and never a typed number. */
  console.log(bad ? '✗ selftest: ' + bad + ' failed of ' + plants.length + ' plants' : '✓ selftest: the block check discriminates — all ' + plants.length + ' selftests passed');
  return bad;
}
/* The selftest fires only as a CLI entry, so an import of this file runs no process.exit
   (`tests/dex-tests.js` group `a module-scope selftest read is paired with the entry guard`). */
if (SELFTEST && isCliEntry(import.meta.url)) process.exit(selftest() ? 1 : 0);

const T = twins();
const DT = 120000;
const recsOf = (twin) => twin.map((x) => R.adaptEnvelopeNode(x.json, x.node, x.node)[0]);
const fused = {};
for (const k of Object.keys(T)) fused[k] = R.fuseApneaEvents(recsOf(T[k]), DT, {});

const NULL_TWINS = ['coupled', 'uncoupled', 'gapped', 'contended'];
const failed = [];
const pass = (name, ok, detail) => {
  say((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed.push(name + (detail ? ': ' + detail : ''));
};

/* 1 · ∅ on every two-node twin */
const nullTwinBad = NULL_TWINS.filter((k) => {
  const c = fused[k] && fused[k].contributions;
  return !(c && c.inputs.length === 2 && c.dominant === null && c.inputs.every((i) => i.delta === null && i.share === null && typeof i.reason === 'string' && i.reason.length > 0));
});
pass(
  'two-node twins attribute ∅ — both inputs necessary, neither quantifiable',
  nullTwinBad.length === 0,
  nullTwinBad.length ? 'not ∅ on ' + nullTwinBad.join(',') : NULL_TWINS.length + ' twins, every delta null with a reason'
);

/* 2 · numbers on the four-node twin */
const cA = fused.attributed && fused.attributed.contributions;
const shareSum = cA ? cA.inputs.reduce((a, i) => a + i.share, 0) : NaN;
pass(
  'four-node twin carries shares summing to 1 and names the planted dominant',
  !!cA && cA.inputs.length === 4 && Math.abs(shareSum - 1) < 1e-9 && cA.dominant === 'node.ECGDex',
  cA ? 'inputs=' + cA.inputs.length + ' Σshare=' + shareSum + ' dominant=' + cA.dominant : 'no block'
);

/* 3 · a measured 0 is not a ∅ null */
const zeros = cA ? cA.inputs.filter((i) => i.delta === 0 && i.share === 0 && i.reason === undefined) : [];
pass('a measured 0 stays distinguishable from a ∅ null', zeros.length === 2, zeros.map((i) => i.key).join(',') || 'none');

/* 4 · one input, no block */
const oneNode = recsOf(T.attributed).filter((r) => r.node === 'ECGDex');
const oneBlock = R.apneaIndexContributions(oneNode, DT, {}, 5);
pass('one input, no block', oneBlock === null, oneBlock === null ? 'null' : JSON.stringify(oneBlock));

/* 5 · no figure, no block */
const noFigure = R.apneaIndexContributions(recsOf(T.attributed), DT, {}, null);
pass('no figure, no block', noFigure === null, noFigure === null ? 'null' : JSON.stringify(noFigure));

/* 6 · the block validates where the adoption gate will read it */
const probe = (block) => ({
  schema: 'tepna.verdict/1',
  gate: 'integrator-contributions',
  status: 'PASS',
  scope: 'internal',
  population: { checked: 1, eligible: 1, excluded: 0 },
  criterion: { name: 'probe', threshold: 1, unit: '', direction: 'eq' },
  result: { probe: true },
  contributions: block,
  evidence: ['tools/integrator-contributions.mjs'],
  reason: null,
  producedBy: prov(),
  at: new Date().toISOString()
});
const blockCheck = cA ? Verdict.validate(probe(cA)) : { ok: false, errors: ['no block to validate'], checked: [] };
const blockOk = !!blockCheck.ok && (blockCheck.checked || []).includes('contributions');
pass('the block validates under verdict.js, contributions among the fields examined', blockOk, blockOk ? 'valid' : (blockCheck.errors || []).join(' · ') || 'contributions never examined');

/* ── the verdict ───────────────────────────────────────────────────────────────────────────── */
const verdict = {
  schema: 'tepna.verdict/1',
  gate: 'integrator-contributions',
  status: failed.length ? 'FAIL' : 'PASS',
  scope: 'internal',
  population: { checked: 6, eligible: 6, excluded: 0 },
  criterion: { name: 'attribution_contract_checks', threshold: 6, unit: 'checks', direction: 'gte' },
  result: {
    passed: 6 - failed.length,
    twins: Object.keys(T).length,
    nullTwins: NULL_TWINS.length,
    attributedShareSum: Number.isFinite(shareSum) ? shareSum : null,
    dominant: cA ? cA.dominant : null,
    failures: failed,
    invalidContributions: blockOk ? null : cA || null
  },
  /* The block rides in the verdict only when it is VALID; a bad one would make this object
     unparseable to the gate and turn a finding into an "I could not look" (see the header). */
  contributions: blockOk ? cA : null,
  evidence: ['tools/integrator-contributions.mjs', 'integrator-dsp.js', 'tests/apnea-null-twins.js'],
  reason: failed.length ? failed.join(' · ') : null,
  producedBy: prov(),
  at: new Date().toISOString()
};
const v = Verdict.validate(verdict);
if (!v.ok) {
  console.error('⏱ UNEXAMINED tools/integrator-contributions.mjs — the verdict it built is invalid: ' + (v.errors || []).join(' · '));
  process.exit(2);
}
if (blockOk && !(v.checked || []).includes('contributions')) {
  console.error('⏱ UNEXAMINED tools/integrator-contributions.mjs — the validator never examined the contributions block');
  process.exit(2);
}
console.log(JSON.stringify(verdict));
process.exit(failed.length ? 1 : 0);
