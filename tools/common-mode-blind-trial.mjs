#!/usr/bin/env node
/*
 * tools/common-mode-blind-trial.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * RUN §7's COMMON-MODE PROTOCOL ON A REAL DETECTOR CHANGE.
 *
 * `briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md` §7 adopts BLIND ANALYSIS against
 * common-mode blindness, and residue row
 * `2026-10-26-the-common-mode-protocol-has-run-on-no-detector-change` records that the protocol
 * never ran on one. `tools/detector-change-advisory.mjs` routes §7 to such a diff; it witnesses no
 * run, by design. THIS TOOL IS THE RUN. It imports the four steps from the advisory, so the
 * protocol has one source.
 *
 * THE OCCASION. The SpO2 spectrum's red-noise background now reads persistence as lag 2 over lag 1
 * (`oxydex-dsp.js` `_bgRho`). That changes what `detectSpO2Periodicity` DECIDES on a quantised
 * record, so the advisory census names it.
 *
 * THE TWO ARMS, AND WHY THEY ARE NOT ONE INSTRUMENT.
 *   · arm SPO2 — the SHIPPED `computeSpO2FFT` over the ring SpO2 of a trio night, re-run here.
 *   · arm CVHR — `apnea.cvhrIndex` from the SAME night's ECGDex export, which is cyclic variation
 *     of heart rate over the H10 chest ECG.
 * Optical finger against electrical chest, two devices, two modalities. A second column of the ring
 * would have been one instrument, and two arms through one instrument are ONE measurement.
 *
 * ⚠ THE REFERENCE MEASURES A NEIGHBOURING THING, NEVER THE SAME THING. Cyclic heart-rate variation
 * accompanies the apnea that drives periodic breathing; it is not an SpO2 cycle. So a disagreement
 * has two causes — the detector, or the physiology — and this run cannot separate them. It is
 * reported as an agreement number with that caveat beside it, and never as the detector's accuracy.
 *
 * THE PLANT IS LOAD-BEARING. A blind instrument flags nothing, which reads exactly like a clean
 * corpus, so an agreement band cannot test its own detection power. This run plants a cycle of
 * stated period and amplitude into arm SPO2's input on the nights the run seed picks, and the
 * agreement number is UNREADABLE until the plants come back.
 *
 * WHAT THE BLIND CONSTRAINS, AND WHAT THE FREEZE CONSTRAINS. The blind constrains the PERSON: the
 * per-night arm labels are permuted behind an opaque key, and the frozen criterion reads the two
 * arms SYMMETRICALLY, so learning which arm is which cannot move the verdict. The freeze constrains
 * the THRESHOLDS: every one of them sits in `STATED` below, and the run prints that object's hash
 * before it reads a night. The arithmetic is frozen in this file; a person tunes nothing at run time.
 *
 * USAGE
 *   node tools/common-mode-blind-trial.mjs                 # state, blind, freeze, unblind, report
 *   node tools/common-mode-blind-trial.mjs --seed 12345     # a reproducible plant assignment
 *   node tools/common-mode-blind-trial.mjs --state          # the frozen comparison and its hash only
 *   node tools/common-mode-blind-trial.mjs --json           # the whole result as one object
 *   node tools/common-mode-blind-trial.mjs --selftest       # the plants: kappa, symmetry, exclusion
 *   node tools/common-mode-blind-trial.mjs --verdict-sample # the tepna.verdict/1 object alone
 *
 * EXIT · 2 the corpus or the detector could not be read (NOT_RUN — it could not look, §4c)
 *       · 1 the plants did not come back, so no agreement number is readable (SHORTFALL)
 *       · 0 otherwise, the report included.
 *
 * THE READING (write-root brief §6.4, judge arm). This tool is EXEMPT on the judge arm. Its only
 * child asks `git rev-parse` for the commit stamp, and it judges the trio corpus, never a tree.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry } from './argv-guard.mjs';
import { PROTOCOL } from './detector-change-advisory.mjs';
import { corpusSearch, formatCorpusSearch } from './regen-goldens-core.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── STEP 1 · THE COMPARISON, STATED BEFORE THE RUN ───────────────────────────────────────────────
   Every threshold this run uses is here, and nothing else holds one. The hash of this object is
   printed before the first night is read, which is what makes the freeze checkable later. */
export const STATED = {
  detector: 'oxydex-dsp.js computeSpO2FFT — the spectrum behind detectSpO2Periodicity',
  change: 'the red-noise background reads persistence as lag 2 over lag 1, and no longer as lag 1',
  reference: 'ECGDex apnea.cvhrIndex — cyclic heart-rate variation over the H10 chest ECG, same night',
  nights: 'the trio-eligible nights named in analysis/tri_device_nights.json',
  metric: 'one binary call per night per arm, compared by Cohen kappa',
  referenceCutPerHour: 5,
  referenceCutNote: 'pre-stated here as the conventional index boundary, and fitted to no night in this run',
  agreementBand: 0.2,
  plantPeriodSec: 80,
  plantAmplitudePct: 0.5,
  plantShare: 0.5,
  plantRecoveryBand: 0.9,
  plantToleranceSec: 10,
  readableRule: 'the agreement number is unreadable until the planted cycles come back at the band'
};

export function statedHash(o = STATED) {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 12);
}

/* ── ARITHMETIC ───────────────────────────────────────────────────────────────────────────────────
   Cohen kappa over two binary arms. It is SYMMETRIC in its two arguments, which is the property
   that makes the blind robust: a reader who breaks the blind cannot move the number. */
export function kappa(a, b) {
  const n = a.length;
  if (!n || n !== b.length) return null;
  let both = 0;
  let neither = 0;
  let aOnly = 0;
  let bOnly = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) both++;
    else if (!a[i] && !b[i]) neither++;
    else if (a[i]) aOnly++;
    else bOnly++;
  }
  const po = (both + neither) / n;
  const pa = ((both + aOnly) / n) * ((both + bOnly) / n) + ((neither + bOnly) / n) * ((neither + aOnly) / n);
  if (pa === 1) return null; // both arms constant and equal — kappa is undefined, never 1
  return (po - pa) / (1 - pa);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* The plant: a sinusoid of stated period and amplitude, added to the covered samples only. An
   absent sample stays absent — a plant that fills a gap would measure the filler, not the detector. */
export function plantCycle(rows, amplitudePct, periodSec) {
  return rows.map((r, i) => {
    if (r.spo2 === null || r.spo2 === undefined) return r;
    return { spo2: r.spo2 + amplitudePct * Math.sin((2 * Math.PI * i) / periodSec) };
  });
}

/* ── THE DETECTOR, LOADED AS IT SHIPS ─────────────────────────────────────────────────────────────
   The same realm the test suite builds (`tests/run-tests.mjs` `loadInto`): the app's own modules,
   shorn of `import`/`export` by `DexBuild.classicify`, evaluated in one vm context. Nothing about
   the spectrum is reimplemented here, so a later change to it changes this run too. */
const REALM_FILES = [
  'kernel-constants.js',
  'clock.js',
  'sq-table.js',
  'clock-seam.js',
  'radio-clock.js',
  'metric-registry.js',
  'dex-escape.js',
  'dex-profile.js',
  'oxydex-registry.js',
  'oxydex-util.js',
  'pulsedex-dsp.js',
  'oxydex-dsp.js'
];

function stubEl() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: '',
    dataset: {},
    children: [],
    getContext: () => null,
    remove() {},
    insertAdjacentHTML() {},
    cloneNode: () => stubEl()
  };
  return el;
}

export function loadDetector(root = REPO) {
  const doc = {
    createElement: stubEl,
    createElementNS: stubEl,
    createTextNode: stubEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    head: stubEl(),
    body: stubEl(),
    documentElement: stubEl(),
    readyState: 'complete',
    cookie: ''
  };
  const store = new Map();
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    parseFloat,
    parseInt,
    isFinite,
    isNaN,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear()
    },
    navigator: { userAgent: 'node', language: 'en-US' },
    performance: { now: () => Date.now() },
    location: { href: 'http://localhost/', search: '' },
    Worker: function () {
      throw new Error('no worker in this realm');
    },
    Blob: function () {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
    cancelAnimationFrame: () => {},
    TextEncoder,
    TextDecoder,
    Float64Array,
    Float32Array,
    Uint8Array,
    Int32Array,
    Uint32Array,
    crypto: { getRandomValues: (a) => a }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  ctx.__DEX_NAMESPACED__ = true;
  const DexBuild = createRequire(import.meta.url)(path.join(root, 'tools', 'build-core.js'));
  for (const f of REALM_FILES) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) throw new Error(`the realm is incomplete: ${f} is absent from ${root}`);
    vm.runInContext(DexBuild.classicify(fs.readFileSync(p, 'utf8')), ctx, { filename: p });
  }
  for (const c of [ctx.OxyDex?._bare, ctx.OxyDex, ctx.OxyDSP]) {
    if (c && typeof c.computeSpO2FFT === 'function') return c;
  }
  throw new Error('computeSpO2FFT is absent from the loaded realm');
}

/* ── THE CORPUS ───────────────────────────────────────────────────────────────────────────────────
   $DEX_UPLOADS → the primary checkout's uploads/ → this checkout's, exactly as the fixture gate
   searches (docs/CORPUS-LOCATIONS.md). A worktree holds no corpus, so the search is printed on a
   refusal rather than guessed at. */
export function findCorpus(repo = REPO) {
  const search = corpusSearch(repo);
  const hit = search.candidates.find((c) => c.exists && fs.existsSync(path.join(c.dir, 'trio')));
  return { dir: hit ? hit.dir : null, search };
}

export function nightList(repo = REPO) {
  const p = path.join(repo, 'analysis', 'tri_device_nights.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const w = (j.result || j).window || {};
  return Array.isArray(w.nights) ? w.nights.slice() : [];
}

/* One night, both arms, or the reason it is out of the population. */
export function readNight(uploads, date) {
  const dir = path.join(uploads, 'trio', date);
  const fo = path.join(dir, `OxyDex_${date}.node-export.json`);
  const fe = path.join(dir, `ECGDex_${date}.node-export.json`);
  if (!fs.existsSync(fo)) return { date, excluded: 'the OxyDex export of this night is absent' };
  if (!fs.existsSync(fe)) return { date, excluded: 'the ECGDex export of this night is absent' };
  const o = JSON.parse(fs.readFileSync(fo, 'utf8'));
  const e = JSON.parse(fs.readFileSync(fe, 'utf8'));
  const vals = o.timeseries?.spo2?.values;
  if (!Array.isArray(vals) || vals.length < 600) {
    return { date, excluded: 'the exported SpO2 series is absent or shorter than 10 minutes' };
  }
  const idx = e.apnea?.cvhrIndex;
  if (typeof idx !== 'number' || !Number.isFinite(idx)) {
    return { date, excluded: 'the reference arm published no cvhrIndex for this night' };
  }
  return {
    date,
    rows: vals.map((v) => ({ spo2: typeof v === 'number' ? v : null })),
    cvhrIndex: idx,
    cvhrEvents: e.apnea?.cvhrEvents ?? null,
    cvhrHours: e.apnea?.cvhrHours ?? null
  };
}

/* ── STEPS 2 AND 3 · THE BLIND, AND THE RUN UNDER IT ──────────────────────────────────────────────
   One pass over the nights. The arm labels are permuted by the run seed, every per-night row carries
   an opaque key instead of its date, and the plant assignment comes from the same seed. */
export function trial({ uploads, nights, seed, detector }) {
  const read = nights.map((d) => readNight(uploads, d));
  const excluded = read.filter((r) => r.excluded).map((r) => ({ date: r.date, reason: r.excluded }));
  const usable = read.filter((r) => !r.excluded);
  const r = rng(seed);
  const spo2IsX = r() < 0.5;
  const rows = [];
  for (const n of usable) {
    const planted = r() < STATED.plantShare;
    const real = detector.computeSpO2FFT(n.rows);
    const withPlant = planted ? detector.computeSpO2FFT(plantCycle(n.rows, STATED.plantAmplitudePct, STATED.plantPeriodSec)) : null;
    const cyc = withPlant && typeof withPlant.peakCycSec === 'number' ? withPlant.peakCycSec : null;
    rows.push({
      key: createHash('sha256').update(`${n.date}:${seed}`).digest('hex').slice(0, 8),
      date: n.date,
      spo2Call: !!real.detected,
      spo2CycleSec: typeof real.peakCycSec === 'number' ? real.peakCycSec : null,
      spo2Snr: typeof real.snr === 'number' ? real.snr : null,
      rhoLag1: typeof real.rhoLag1 === 'number' ? real.rhoLag1 : null,
      rhoBg: typeof real.rhoBg === 'number' ? real.rhoBg : null,
      cvhrCall: n.cvhrIndex >= STATED.referenceCutPerHour,
      cvhrIndex: n.cvhrIndex,
      cvhrEvents: n.cvhrEvents,
      cvhrHours: n.cvhrHours,
      planted,
      plantCycleSec: cyc,
      plantRecovered: planted ? !!withPlant.detected && cyc !== null && Math.abs(cyc - STATED.plantPeriodSec) <= STATED.plantToleranceSec : null
    });
  }
  const assigned = rows.filter((x) => x.planted);
  const recovered = assigned.filter((x) => x.plantRecovered);
  return {
    seed,
    statedHash: statedHash(),
    armLabel: { spo2: spo2IsX ? 'X' : 'Y', cvhr: spo2IsX ? 'Y' : 'X' },
    eligible: nights.length,
    rows,
    excluded,
    kappa: kappa(
      rows.map((x) => (x.spo2Call ? 1 : 0)),
      rows.map((x) => (x.cvhrCall ? 1 : 0))
    ),
    spo2Positives: rows.filter((x) => x.spo2Call).length,
    cvhrPositives: rows.filter((x) => x.cvhrCall).length,
    plantAssigned: assigned.length,
    plantRecovered: recovered.length,
    plantFraction: assigned.length ? recovered.length / assigned.length : null
  };
}

/* ── STEP 4 · THE VERDICT, ONCE ───────────────────────────────────────────────────────────────────
   The band is pre-stated, so it is not reinterpreted after the fact. A FAIL here names TWO causes —
   the detector, or the physiology the reference measures instead — and is never an accuracy claim.
   An arm that flags nothing is UNDERPOWERED and never a PASS: a blind instrument agrees with a quiet
   corpus perfectly, which is the whole reason the plant exists. */
export function verdictFor(res, commit, opts = {}) {
  const checked = res.rows ? res.rows.length : 0;
  const excluded = res.excluded ? res.excluded.length : 0;
  const base = {
    gate: 'common-mode-blind-trial',
    scope: 'internal',
    population: { checked, eligible: res.eligible ?? checked + excluded, excluded },
    criterion: {
      name: 'cross_arm_kappa',
      threshold: STATED.agreementBand,
      unit: 'kappa',
      direction: 'gte'
    },
    evidence: ['tools/common-mode-blind-trial.mjs', 'briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md'],
    producedBy: { tool: 'tools/common-mode-blind-trial.mjs', commit: commit || null },
    at: opts.at || new Date().toISOString()
  };
  if (!commit) base.producedBy.commitReason = 'the checkout answered no commit';
  /* A count this run did not take is `null`, and never 0: a zero here would read as "the arm flagged
     nothing", which is the one statement this object exists to distinguish from "nobody looked". */
  const result = {
    kappa: res.kappa === null || res.kappa === undefined ? null : Number(res.kappa.toFixed(4)),
    spo2Positives: res.spo2Positives ?? null,
    cvhrPositives: res.cvhrPositives ?? null,
    plantAssigned: res.plantAssigned ?? null,
    plantRecovered: res.plantRecovered ?? null,
    plantFraction: res.plantFraction === null || res.plantFraction === undefined ? null : Number(res.plantFraction.toFixed(4)),
    statedHash: res.statedHash || statedHash(),
    seed: res.seed ?? null
  };
  if (!checked) {
    /* NOTHING WAS EXAMINED, so the object says so twice: `result: null`, and an eligible count that
       is exactly what this run managed to classify. A night it never reached is not eligible here —
       the contract reads the population as an equality, and a floor would publish a cohort this run
       never had. */
    return Verdict.make({
      ...base,
      population: { checked: 0, eligible: excluded, excluded },
      status: 'NOT_RUN',
      result: null,
      reason: 'no trio night answered both arms, so this run examined nothing'
    });
  }
  if (!result.plantAssigned) {
    return Verdict.make({
      ...base,
      status: 'UNDERPOWERED',
      result,
      reason: 'the run planted no cycle, so the agreement band stays unreadable'
    });
  }
  if (result.plantFraction < STATED.plantRecoveryBand) {
    return Verdict.make({
      ...base,
      status: 'SHORTFALL',
      result,
      reason: `the planted cycles came back ${result.plantRecovered} of ${result.plantAssigned}, under the ${STATED.plantRecoveryBand} band, so no agreement number is readable`
    });
  }
  if (result.kappa === null || !result.spo2Positives) {
    return Verdict.make({
      ...base,
      status: 'UNDERPOWERED',
      result,
      reason: `the detector arm flags ${result.spo2Positives} of ${checked} real night(s), so the overlap carries no information about what both arms miss — the planted cycles came back ${result.plantRecovered} of ${result.plantAssigned}, so the detector is not blind on these same nights`
    });
  }
  if (result.kappa < STATED.agreementBand) {
    return Verdict.make({
      ...base,
      status: 'FAIL',
      result,
      reason: `the arms agree at kappa ${result.kappa}, under the pre-stated ${STATED.agreementBand} — two causes stay open, the detector and the cyclic heart-rate variation the reference measures instead`
    });
  }
  return Verdict.make({ ...base, status: 'PASS', result, reason: null });
}

/* ── SELFTEST ─────────────────────────────────────────────────────────────────────────────────────
   The count is incremented by the assertion helper, never typed, so deleting a check shrinks the
   number the suite reads. */
function selftest() {
  let ran = 0;
  const fails = [];
  const check = (name, ok) => {
    ran++;
    if (!ok) fails.push(name);
  };

  check('kappa is 0 on an independent 2 by 2 table', kappa([1, 1, 0, 0], [1, 0, 1, 0]) === 0);
  check('kappa is 1 on perfect agreement with both calls present', kappa([1, 1, 0, 0], [1, 1, 0, 0]) === 1);
  check('kappa is SYMMETRIC, which is what keeps the verdict blind-robust', kappa([1, 0, 0, 1, 1], [1, 1, 0, 0, 1]) === kappa([1, 1, 0, 0, 1], [1, 0, 0, 1, 1]));
  check('kappa refuses when both arms are constant and equal, rather than reading 1', kappa([0, 0, 0], [0, 0, 0]) === null);
  check('kappa refuses a length mismatch', kappa([1, 0], [1, 0, 1]) === null);

  const src = [{ spo2: 95 }, { spo2: null }, { spo2: 96 }, { spo2: 97 }];
  const pl = plantCycle(src, 0.5, 80);
  check('the plant leaves an absent sample absent', pl[1].spo2 === null);
  check('the plant moves a covered sample', pl[2].spo2 !== src[2].spo2);
  check(
    'the plant never exceeds its stated amplitude',
    pl.every((p, i) => p.spo2 === null || Math.abs(p.spo2 - src[i].spo2) <= 0.5 + 1e-9)
  );

  check(
    'STATED carries a cut, a band, a plant and a tolerance',
    ['referenceCutPerHour', 'agreementBand', 'plantPeriodSec', 'plantAmplitudePct', 'plantRecoveryBand', 'plantToleranceSec'].every((k) => typeof STATED[k] === 'number')
  );
  check('the frozen comparison hashes to 12 hex', /^[0-9a-f]{12}$/.test(statedHash()));
  check('the hash moves when a threshold moves', statedHash({ ...STATED, agreementBand: 0.9 }) !== statedHash());
  check('the protocol comes from the advisory and is four steps', PROTOCOL.length === 4 && /BLIND the arms/.test(PROTOCOL[1]));

  const row = (over) => ({ spo2Call: false, cvhrCall: true, planted: true, plantRecovered: true, ...over });
  const vNone = verdictFor({ rows: [], excluded: [], eligible: 3, seed: 1 }, 'abc1234', { at: '2026-11-26T00:00:00Z' });
  check('an empty population answers NOT_RUN with a reason', vNone.status === 'NOT_RUN' && !!vNone.reason);
  const vShort = verdictFor(
    { rows: [row(), row()], excluded: [], eligible: 2, kappa: 0.4, spo2Positives: 1, cvhrPositives: 2, plantAssigned: 2, plantRecovered: 1, plantFraction: 0.5, seed: 1 },
    'abc1234',
    { at: '2026-11-26T00:00:00Z' }
  );
  check('plants under the band answer SHORTFALL, so no agreement number is readable', vShort.status === 'SHORTFALL');
  const vBlind = verdictFor(
    { rows: [row(), row()], excluded: [], eligible: 2, kappa: null, spo2Positives: 0, cvhrPositives: 2, plantAssigned: 2, plantRecovered: 2, plantFraction: 1, seed: 1 },
    'abc1234',
    { at: '2026-11-26T00:00:00Z' }
  );
  check('a detector arm that flags nothing answers UNDERPOWERED, never PASS', vBlind.status === 'UNDERPOWERED');
  check('that reason reports the plant recovery beside the blind arm', /not blind on these same nights/.test(vBlind.reason || ''));
  const vFail = verdictFor(
    { rows: [row({ spo2Call: true }), row()], excluded: [], eligible: 2, kappa: 0.05, spo2Positives: 1, cvhrPositives: 2, plantAssigned: 2, plantRecovered: 2, plantFraction: 1, seed: 1 },
    'abc1234',
    { at: '2026-11-26T00:00:00Z' }
  );
  check('a computable kappa under the band answers FAIL and names two causes', vFail.status === 'FAIL' && /two causes/.test(vFail.reason));
  const vPass = verdictFor(
    { rows: [row({ spo2Call: true }), row()], excluded: [], eligible: 2, kappa: 0.6, spo2Positives: 1, cvhrPositives: 2, plantAssigned: 2, plantRecovered: 2, plantFraction: 1, seed: 1 },
    'abc1234',
    { at: '2026-11-26T00:00:00Z' }
  );
  check('a kappa over the band answers PASS with no reason', vPass.status === 'PASS' && vPass.reason === null);
  check(
    'every verdict above validates against the contract',
    [vNone, vShort, vBlind, vFail, vPass].every((v) => Verdict.validate(v).ok)
  );
  check(
    'the population arithmetic holds on a run with exclusions',
    (() => {
      const v = verdictFor(
        { rows: [row()], excluded: [{ date: 'd', reason: 'r' }], eligible: 2, kappa: 0.6, spo2Positives: 1, cvhrPositives: 1, plantAssigned: 1, plantRecovered: 1, plantFraction: 1, seed: 1 },
        'abc1234',
        { at: '2026-11-26T00:00:00Z' }
      );
      return v.population.checked + v.population.excluded === v.population.eligible;
    })()
  );

  /* ANTI-VACUITY · the SHIPPED detector recovers a planted cycle in this realm, so a run that
     reports no recovery is reporting the detector and never a broken harness. */
  let antiVacuity = false;
  try {
    const OD = loadDetector();
    const r = rng(20261126);
    const g = () => {
      let u = 0;
      let v = 0;
      while (!u) u = r();
      while (!v) v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    let x = 0;
    const rows = [];
    for (let i = 0; i < 12000; i++) {
      x = 0.98 * x + 1.2 * Math.sqrt(1 - 0.98 * 0.98) * g();
      rows.push({ spo2: 96 + x });
    }
    const got = OD.computeSpO2FFT(plantCycle(rows, 0.5, STATED.plantPeriodSec));
    antiVacuity = !!got.detected && Math.abs(got.peakCycSec - STATED.plantPeriodSec) <= STATED.plantToleranceSec;
  } catch (e) {
    fails.push(`the realm would not load: ${e.message}`);
  }
  check('ANTI-VACUITY · the shipped spectrum recovers a planted 80 s cycle in this realm', antiVacuity);

  if (fails.length) {
    console.log(fails.map((x) => `  ✗ ${x}`).join('\n'));
    console.log(`${fails.length} failed of ${ran}`);
    process.exit(1);
  }
  console.log(`all ${ran} selftests passed`);
}

/* ══ CLI ════════════════════════════════════════════════════════════════════════════════════════ */
function headCommit() {
  try {
    const { execFileSync } = createRequire(import.meta.url)('node:child_process');
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function printStated(say) {
  say(`\n  STEP 1 · STATED, and frozen as ${statedHash()}`);
  for (const k of Object.keys(STATED)) say(`    ${k.padEnd(22)} ${STATED[k]}`);
  say('\n  §7 of briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md, in its own order:');
  PROTOCOL.forEach((x, i) => say(`    ${i + 1}. ${x}`));
}

function main() {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes('--json');
  const seedArg = argv.indexOf('--seed');
  const seed = seedArg >= 0 ? Number(argv[seedArg + 1]) : (Date.now() ^ (process.pid << 8)) >>> 0;

  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    const v = verdictFor(
      { rows: [{}], excluded: [], eligible: 1, kappa: 0.6, spo2Positives: 1, cvhrPositives: 1, plantAssigned: 1, plantRecovered: 1, plantFraction: 1, seed: 1, statedHash: statedHash() },
      headCommit(),
      {}
    );
    console.log(JSON.stringify(v));
    return;
  }

  /* `--json` writes a RECORD a brief can cite, so the prose goes to a sink that --json closes. A
     report plus an object in one stream is a file no reader can parse. */
  const say = JSON_OUT ? () => {} : (...a) => console.log(...a);
  say('\n▸ common-mode blind trial — the §7 protocol on the lag-2 background change');
  printStated(say);
  if (argv.includes('--state')) return;

  const { dir, search } = findCorpus();
  if (!dir) {
    say(`\n⏱ NOT RUN — no corpus answered, so this run read no night.\n${formatCorpusSearch(search)}`);
    const v = verdictFor({ rows: [], excluded: [], eligible: 0, seed }, headCommit(), {});
    if (JSON_OUT) console.log(JSON.stringify({ stated: STATED, run: null, verdict: v }, null, 2));
    say(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
    process.exit(2);
  }

  const nights = nightList();
  const detector = loadDetector();
  const res = trial({ uploads: dir, nights, seed, detector });

  say(`\n  STEP 2 and 3 · BLIND and FROZEN — seed ${res.seed}, arms behind an opaque key`);
  say('    key       arm X  arm Y');
  for (const x of res.rows) {
    const X = res.armLabel.spo2 === 'X' ? x.spo2Call : x.cvhrCall;
    const Y = res.armLabel.spo2 === 'X' ? x.cvhrCall : x.spo2Call;
    say(`    ${x.key}  ${X ? 'yes' : 'no '}    ${Y ? 'yes' : 'no '}`);
  }

  say(`\n  STEP 4 · UNBLIND, once — arm X is ${res.armLabel.spo2 === 'X' ? 'the DETECTOR' : 'the REFERENCE'}`);
  say('    night       det  cycle  rhoLag1  rhoBg   cvhr/h  ref  plant  back');
  for (const x of res.rows) {
    say(
      `    ${x.date}  ${x.spo2Call ? 'yes' : 'no '}  ${String(x.spo2CycleSec ?? '-').padStart(5)}  ${String(x.rhoLag1 ?? '-').padStart(7)}  ${String(x.rhoBg ?? '-').padStart(6)}  ${String(x.cvhrIndex).padStart(6)}  ${x.cvhrCall ? 'yes' : 'no '}  ${x.planted ? 'yes  ' : 'no   '}  ${x.planted ? (x.plantRecovered ? `${x.plantCycleSec} s` : 'LOST') : '-'}`
    );
  }
  for (const e of res.excluded) say(`    ${e.date}  EXCLUDED — ${e.reason}`);
  say(
    `\n  detector positives ${res.spo2Positives} of ${res.rows.length} · reference positives ${res.cvhrPositives} of ${res.rows.length} · plants back ${res.plantRecovered} of ${res.plantAssigned} · kappa ${res.kappa === null ? 'undefined' : res.kappa.toFixed(4)}`
  );

  const v = verdictFor(res, headCommit(), {});
  if (JSON_OUT) console.log(JSON.stringify({ stated: STATED, run: res, verdict: v }, null, 2));
  say(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  if (v.status === 'NOT_RUN') process.exit(2);
  if (v.status === 'SHORTFALL') process.exit(1);
}

if (isCliEntry(import.meta.url)) main();
