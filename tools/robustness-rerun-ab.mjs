#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * robustness-rerun-ab.mjs — judge the robustness-benchmark A/B against ONE pre-stated
 * prediction: `cohort-gen/2.0` moves the severe stratum and nothing else.
 *
 * Rule 0: `node tools/doc-search.mjs --read "robustness benchmark cohort generator 2.0
 * rerun frozen seeds"` → `papers/robustness-benchmark.html:110-118`,
 * `briefs/COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md:11-33`,
 * `briefs/RERUN-OXYFIX-PILOTS-BRIEF.md:70-86`.
 *
 * ── WHY A JUDGE AND NOT A DIFF ──────────────────────────────────────────────────────
 * The 2.0 rerun brief's §⛔ records two occasions on which a re-cut credited the
 * generator with every tool change since publication. It also records the opposite
 * trap: `nights-icc` was re-cut with a mechanism, a citation and PASSING CONTROLS, and
 * the attribution was still false. So this tool does not ask "what moved". It states
 * the invariants BEFORE the run, and it fails when one of them moves.
 *
 * ── THE INVARIANTS, PRE-STATED ──────────────────────────────────────────────────────
 * Class P, at the generator (`sampleProfile(k)`, the `version` key excluded — a naive
 * compare reports 100 % differing and measures the stamp, which the brief records as a
 * believed wrong number):
 *   P1  0 of the NON-SEVERE seeds differ between the two generators.
 *   P2  the severe-stratum population is the same size under both.
 *   P3  at least one SEVERE seed differs — the positive control. Without it the file
 *       swap did not happen, and every class-C equality below would pass vacuously.
 *
 * Class C, at the cohort aggregate — structural quantities which the severe stratum's
 * SHAPE cannot reach:
 *   C1..C6  patients · fatal · cpapPatients · fusionRuns · withOverlap · kernelMismatch
 *   C7      failureLedger.nodeThrew, every node
 *   C8      all 16 coverage.severityByArc cells (keyed on the PATIENT's stratum)
 *   C9      kernelHash — the same detector code ran in both arms
 *
 * Class S is REPORTED AND NOT JUDGED: the severe calibration row, the cohort-wide
 * slope, bias and r², the distribution tails, the flag counts. These pool the severe
 * stratum, so a move is the measurement rather than a defect. The brief is explicit
 * that the governing split is the KIND OF STATISTIC, not cohort-wide versus stratum.
 *
 * ── ABSENCE IS NULL ─────────────────────────────────────────────────────────────────
 * A key missing from either arm makes that invariant UNDETERMINABLE. The tool never
 * reads an absent key as equal: one undeterminable invariant and no violation gives
 * UNKNOWN, never PASS. `checked` counts the invariants it could judge, and `excluded`
 * counts the ones it could not.
 *
 * Usage:
 *   node tools/robustness-rerun-ab.mjs --old <armB.json> --new <armA.json> \
 *        --old-gen <cohort-gen@1.9.js> --new-gen cohort-gen.js [--n 20000] [--out <f>]
 *   node tools/robustness-rerun-ab.mjs --verdict-sample
 *   node tools/robustness-rerun-ab.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { judgeRootOrDie } from './write-root.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const HERE = dirname(fileURLToPath(import.meta.url));
/* THE TREE THIS GATE JUDGES IS THE CALLER'S, NOT THIS FILE'S. The default below serves a library
   import, which must never refuse; the CLI run replaces it through `judgeRootOrDie`. Without that,
   a run from another checkout would read THAT tree's `cohort-gen.js` as the new generator and stamp
   THIS tree's commit on the verdict — two trees in one answer. */
let ROOT = pathResolve(HERE, '..');
const GATE = 'robustness-rerun-ab';
const NON_SEVERE = ['none', 'mild', 'mod'];
const ARCS = ['worsening', 'flat', 'improving', 'intervention'];
const STRATA = ['none', 'mild', 'mod', 'severe'];

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/* Load a browser-classic cohort-gen.js into its own realm and hand back CohortGen. */
export function loadGenerator(src) {
  const ctx = createContext({});
  runInContext(src, ctx, { filename: 'cohort-gen.js' });
  const gen = ctx.CohortGen;
  if (!gen || typeof gen.sampleProfile !== 'function') {
    throw new Error('the source defined no CohortGen.sampleProfile');
  }
  return gen;
}

/* The brief's own comparison: `sampleProfile(k)` with the version stamp excluded. */
export function profileDiff(oldGen, newGen, n) {
  const strip = (p) => {
    const { version, ...rest } = p;
    return JSON.stringify(rest);
  };
  const bySeverity = {};
  for (const s of STRATA) bySeverity[s] = { seeds: 0, differing: 0 };
  let strataDisagree = 0;
  for (let k = 0; k < n; k++) {
    const a = oldGen.sampleProfile(k);
    const b = newGen.sampleProfile(k);
    if (a.osaSeverity !== b.osaSeverity) strataDisagree++;
    if (!bySeverity[b.osaSeverity]) bySeverity[b.osaSeverity] = { seeds: 0, differing: 0 };
    const row = bySeverity[b.osaSeverity];
    row.seeds++;
    if (strip(a) !== strip(b)) row.differing++;
  }
  const populations = { old: {}, new: {} };
  for (const s of STRATA) {
    populations.old[s] = 0;
    populations.new[s] = 0;
  }
  for (let k = 0; k < n; k++) {
    populations.old[oldGen.sampleProfile(k).osaSeverity]++;
    populations.new[newGen.sampleProfile(k).osaSeverity]++;
  }
  return {
    n,
    oldVersion: oldGen.VERSION,
    newVersion: newGen.VERSION,
    bySeverity,
    populations,
    strataDisagree
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* One invariant row. `ok` null means UNDETERMINABLE — never a pass. */
function inv(id, label, a, b) {
  if (a === undefined || a === null || b === undefined || b === null) {
    return { id, label, old: a ?? null, new: b ?? null, ok: null };
  }
  return { id, label, old: a, new: b, ok: a === b };
}

export function judge(oldArm, newArm, diff) {
  const oa = oldArm.aggregate || {};
  const na = newArm.aggregate || {};
  const oc = oa.counts || {};
  const nc = na.counts || {};
  const invariants = [];

  /* Class P — the generator itself.
     §∅ ON THIS TOOL'S OWN ARITHMETIC: a sum over rows which are not there is 0, and the first
     version of this judge published that 0 as "no non-severe profile differs" over a profile diff
     which had examined nothing. A sum needs its population: with no non-severe row present, P1 is
     UNDETERMINABLE, never a pass. The selftest plants the empty diff. */
  const nonSevereRows = NON_SEVERE.filter((k) => diff.bySeverity[k]);
  const nonSevereDiffering = nonSevereRows.length ? nonSevereRows.reduce((s, k) => s + diff.bySeverity[k].differing, 0) : null;
  invariants.push(inv('P1', 'non-severe seeds differing between the generators', nonSevereDiffering === null ? null : 0, nonSevereDiffering));
  invariants.push(inv('P2', 'severe-stratum population, old vs new generator', diff.populations.old.severe, diff.populations.new.severe));
  const severeDiffering = diff.bySeverity.severe ? diff.bySeverity.severe.differing : null;
  invariants.push({
    id: 'P3',
    label: 'at least one severe seed differs (positive control: the swap happened)',
    old: '>0',
    new: severeDiffering,
    ok: severeDiffering === null ? null : severeDiffering > 0
  });

  /* Class C — the cohort aggregate's structural quantities. */
  invariants.push(inv('C1', 'counts.patients', oc.patients, nc.patients));
  invariants.push(inv('C2', 'counts.fatal', oc.fatal, nc.fatal));
  invariants.push(inv('C3', 'counts.cpapPatients', oc.cpapPatients, nc.cpapPatients));
  invariants.push(inv('C4', 'counts.fusionRuns', oc.fusionRuns, nc.fusionRuns));
  invariants.push(inv('C5', 'counts.withOverlap', oc.withOverlap, nc.withOverlap));
  invariants.push(inv('C6', 'counts.kernelMismatch', oc.kernelMismatch, nc.kernelMismatch));
  const ot = (oa.failureLedger || {}).nodeThrew || {};
  const nt = (na.failureLedger || {}).nodeThrew || {};
  for (const node of ['OxyDex', 'PulseDex', 'GlucoDex', 'ECGDex', 'PpgDex', 'CPAPDex', 'Integrator']) {
    invariants.push(inv(`C7.${node}`, `failureLedger.nodeThrew.${node}`, ot[node], nt[node]));
  }
  const ocov = (oa.coverage || {}).severityByArc || {};
  const ncov = (na.coverage || {}).severityByArc || {};
  for (const s of STRATA) {
    for (const arc of ARCS) {
      invariants.push(inv(`C8.${s}.${arc}`, `coverage.severityByArc.${s}.${arc}`, (ocov[s] || {})[arc], (ncov[s] || {})[arc]));
    }
  }
  invariants.push(inv('C9', 'kernelHash', oa.kernelHash, na.kernelHash));

  /* Class S — reported, never judged. */
  const sev = (a) => (a.calibration || {}).bySeverity || {};
  const fit = (a) => (a.calibration || {}).odiVsTruthAHI || {};
  const reported = {
    cohortWide: {
      slope: { old: num(fit(oa).slope), new: num(fit(na).slope) },
      intercept: { old: num(fit(oa).intercept), new: num(fit(na).intercept) },
      r2: { old: num(fit(oa).r2), new: num(fit(na).r2) },
      bias: { old: num(fit(oa).bias), new: num(fit(na).bias) },
      n: { old: num(fit(oa).n), new: num(fit(na).n) }
    },
    bySeverity: {},
    flagCounts: { old: (oa.failureLedger || {}).flagCounts || null, new: (na.failureLedger || {}).flagCounts || null },
    distributionTails: {},
    desatRecallMedian: {
      old: num(((oa.calibration || {}).desatRecall || {}).median),
      new: num(((na.calibration || {}).desatRecall || {}).median)
    },
    rmssdAbsErrMedian: {
      old: num(((oa.calibration || {}).rmssdAbsErr || {}).median),
      new: num(((na.calibration || {}).rmssdAbsErr || {}).median)
    }
  };
  for (const s of STRATA) {
    const o = sev(oa)[s] || {};
    const n2 = sev(na)[s] || {};
    reported.bySeverity[s] = {
      slope: { old: num(o.slope), new: num(n2.slope) },
      bias: { old: num(o.bias), new: num(n2.bias) },
      r2: { old: num(o.r2), new: num(n2.r2) },
      n: { old: num(o.n), new: num(n2.n) }
    };
  }
  for (const key of ['oxyODI', 'pulseRMSSD', 'minSpO2', 'glucoCV']) {
    const o = (oa.distributions || {})[key] || {};
    const n2 = (na.distributions || {})[key] || {};
    reported.distributionTails[key] = {
      median: { old: num(o.median), new: num(n2.median) },
      p90: { old: num(o.p90), new: num(n2.p90) },
      max: { old: num(o.max), new: num(n2.max) },
      n: { old: num(o.n), new: num(n2.n) }
    };
  }

  const violations = invariants.filter((i) => i.ok === false);
  const undeterminable = invariants.filter((i) => i.ok === null);
  const checked = invariants.length - undeterminable.length;

  let status;
  let reason = null;
  if (checked === 0) {
    status = 'NOT_RUN';
    reason = 'no invariant could be judged — both arms lack the keys';
  } else if (violations.length > 0) {
    status = 'FAIL';
    reason = `${violations.length} invariant(s) moved: ${violations.map((v) => v.id).join(', ')}`;
  } else if (undeterminable.length > 0) {
    status = 'UNKNOWN';
    reason = `${undeterminable.length} invariant(s) undeterminable: ${undeterminable.map((v) => v.id).join(', ')}`;
  } else {
    status = 'PASS';
  }

  return { invariants, violations, undeterminable, checked, reported, status, reason };
}

export function verdictFor(j, diff, evidence) {
  return Verdict.make({
    gate: GATE,
    status: j.status,
    population: {
      checked: j.checked,
      eligible: j.invariants.length,
      excluded: j.undeterminable.length
    },
    criterion: {
      name: 'invariant_violations',
      threshold: 0,
      unit: 'invariants',
      direction: 'lte'
    },
    result: {
      violations: j.violations.length,
      violationIds: j.violations.map((v) => v.id),
      oldGenerator: diff.oldVersion,
      newGenerator: diff.newVersion,
      severeSeedsDiffering: diff.bySeverity.severe ? diff.bySeverity.severe.differing : null,
      nonSevereSeedsDiffering: NON_SEVERE.some((k) => diff.bySeverity[k]) ? NON_SEVERE.reduce((s, k) => s + (diff.bySeverity[k] ? diff.bySeverity[k].differing : 0), 0) : null
    },
    evidence,
    reason: j.reason,
    producedBy: { tool: 'tools/robustness-rerun-ab.mjs', commit: commit() }
  });
}

const DIRECT = isCliEntry(import.meta.url);

if (DIRECT && process.argv.includes('--selftest')) {
  let bad = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      bad++;
      console.error(`  \u2717 ${n}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    }
  };

  const diffOf = (f) => ({
    n: 2,
    oldVersion: 'cohort-gen/1.9',
    newVersion: 'cohort-gen/2.0',
    bySeverity: {
      none: { seeds: 1, differing: 0 },
      mild: { seeds: 0, differing: 0 },
      mod: { seeds: 0, differing: 0 },
      severe: { seeds: 1, differing: 1 }
    },
    populations: { old: { none: 1, mild: 0, mod: 0, severe: 1 }, new: { none: 1, mild: 0, mod: 0, severe: 1 } },
    strataDisagree: 0,
    ...f
  });
  const armOf = (over) => {
    const base = {
      kernelHash: 'k',
      counts: { patients: 2, fatal: 0, cpapPatients: 1, fusionRuns: 2, withOverlap: 2, kernelMismatch: 0 },
      failureLedger: { nodeThrew: { OxyDex: 0, PulseDex: 0, GlucoDex: 0, ECGDex: 0, PpgDex: 0, CPAPDex: 0, Integrator: 0 }, flagCounts: {} },
      coverage: { severityByArc: Object.fromEntries(STRATA.map((s) => [s, Object.fromEntries(ARCS.map((a) => [a, 1]))])) },
      calibration: {},
      distributions: {}
    };
    return { aggregate: { ...base, ...(over || {}) } };
  };

  /* THE PREDICTION HOLDS. */
  const good = judge(armOf(), armOf(), diffOf());
  ck('every invariant equal and the swap happened is PASS', good.status, 'PASS');
  ck('\u2026and the population adds up', good.checked + good.undeterminable.length, good.invariants.length);
  ck('\u2026over no violation', good.violations.length, 0);

  /* CLASS C \u2014 a structural quantity moved. */
  const cMoved = judge(armOf(), armOf({ counts: { patients: 3, fatal: 0, cpapPatients: 1, fusionRuns: 2, withOverlap: 2, kernelMismatch: 0 } }), diffOf());
  ck('a moved patient count is FAIL', cMoved.status, 'FAIL');
  ck('\u2026and the reason names the invariant', cMoved.reason.includes('C1'), true);

  /* CLASS C \u2014 a coverage cell moved, which the severe shape cannot reach. */
  const cov = Object.fromEntries(STRATA.map((s) => [s, Object.fromEntries(ARCS.map((a) => [a, 1]))]));
  cov.severe.flat = 2;
  const c8 = judge(armOf(), armOf({ coverage: { severityByArc: cov } }), diffOf());
  ck('a moved coverage cell is FAIL', c8.status, 'FAIL');
  ck('\u2026named by its stratum and arc', c8.violations[0].id, 'C8.severe.flat');

  /* CLASS P1 \u2014 a non-severe profile differing refutes the prediction. */
  const p1 = judge(
    armOf(),
    armOf(),
    diffOf({
      bySeverity: { none: { seeds: 1, differing: 1 }, mild: { seeds: 0, differing: 0 }, mod: { seeds: 0, differing: 0 }, severe: { seeds: 1, differing: 1 } }
    })
  );
  ck('a differing non-severe profile is FAIL', p1.status, 'FAIL');
  ck('\u2026reported as P1', p1.violations[0].id, 'P1');

  /* CLASS P3 \u2014 THE POSITIVE CONTROL. Without it the class-C equalities pass vacuously. */
  const p3 = judge(
    armOf(),
    armOf(),
    diffOf({
      bySeverity: { none: { seeds: 1, differing: 0 }, mild: { seeds: 0, differing: 0 }, mod: { seeds: 0, differing: 0 }, severe: { seeds: 1, differing: 0 } }
    })
  );
  ck('no severe profile differing is FAIL \u2014 the swap did not happen', p3.status, 'FAIL');
  ck(
    '\u2026reported as P3',
    p3.violations.map((v) => v.id),
    ['P3']
  );

  /* \u2205 ABSENCE IS NULL \u2014 an absent key is never read as equal. */
  const gone = judge(armOf({ kernelHash: null }), armOf({ kernelHash: null }), diffOf());
  ck('an absent key is UNKNOWN, never PASS', gone.status, 'UNKNOWN');
  ck(
    '\u2026counted as excluded, not checked',
    gone.undeterminable.map((u) => u.id),
    ['C9']
  );
  ck('\u2026and the eligible total is unchanged', gone.invariants.length, good.invariants.length);
  ck(
    '\u2026while a violation beside it still FAILs',
    judge(armOf({ kernelHash: null }), armOf({ kernelHash: null, counts: { patients: 3, fatal: 0, cpapPatients: 1, fusionRuns: 2, withOverlap: 2, kernelMismatch: 0 } }), diffOf()).status,
    'FAIL'
  );
  const empty = judge({ aggregate: {} }, { aggregate: {} }, diffOf({ bySeverity: {}, populations: { old: {}, new: {} } }));
  ck('nothing judgeable is NOT_RUN, never PASS over nothing', empty.status, 'NOT_RUN');
  ck('\u2026with checked 0', empty.checked, 0);

  /* THE VERDICT OBJECT. */
  const v = verdictFor(good, diffOf(), ['x']);
  ck('the verdict validates', Verdict.validate(v).ok, true);
  ck('…with no error', Verdict.validate(v).errors, []);
  ck('\u2026carries the pre-stated criterion', [v.criterion.name, v.criterion.threshold, v.criterion.direction], ['invariant_violations', 0, 'lte']);
  ck('\u2026and its population adds up', v.population.checked + v.population.excluded, v.population.eligible);
  const vf = verdictFor(cMoved, diffOf(), ['x']);
  ck('a FAIL verdict carries a reason', typeof vf.reason === 'string' && vf.reason.length > 0, true);

  /* THE GENERATOR READER. The version stamp must NOT make two equal profiles differ. */
  const SRC = (ver, ahi) =>
    `(function (global) { global.CohortGen = { VERSION: '${ver}', sampleProfile: function (k) { return { version: '${ver}', osaSeverity: k === 0 ? 'none' : 'severe', baseAHI: k === 0 ? 5 : ${ahi} }; } }; })(typeof window !== 'undefined' ? window : this);`;
  const g19 = loadGenerator(SRC('cohort-gen/1.9', 55));
  ck('the reader returns the generator it loaded', g19.VERSION, 'cohort-gen/1.9');
  const sameData = profileDiff(g19, loadGenerator(SRC('cohort-gen/2.0', 55)), 2);
  ck('the version key alone does NOT count as a difference', [sameData.bySeverity.none.differing, sameData.bySeverity.severe.differing], [0, 0]);
  const movedSevere = profileDiff(g19, loadGenerator(SRC('cohort-gen/2.0', 50)), 2);
  ck('a moved severe baseAHI does count', [movedSevere.bySeverity.none.differing, movedSevere.bySeverity.severe.differing], [0, 1]);
  ck('\u2026and the strata still agree', movedSevere.strataDisagree, 0);
  let threw = null;
  try {
    loadGenerator('var x = 1;');
  } catch (e) {
    threw = e.message;
  }
  ck('a source with no CohortGen refuses', threw, 'the source defined no CohortGen.sampleProfile');

  console.log(bad ? `  \u2717 ${bad} of ${ran} selftests failed` : `  all ${ran} selftests passed`);
  process.exit(bad ? 1 : 0);
}

if (DIRECT && process.argv.includes('--verdict-sample')) {
  /* The shape the adoption gate reads: one invariant, judged, no corpus. */
  const diff = {
    n: 1,
    oldVersion: 'cohort-gen/1.9',
    newVersion: 'cohort-gen/2.0',
    bySeverity: { none: { seeds: 1, differing: 0 }, mild: { seeds: 0, differing: 0 }, mod: { seeds: 0, differing: 0 }, severe: { seeds: 1, differing: 1 } },
    populations: { old: { none: 1, mild: 0, mod: 0, severe: 1 }, new: { none: 1, mild: 0, mod: 0, severe: 1 } },
    strataDisagree: 0
  };
  const arm = {
    aggregate: {
      kernelHash: 'sample',
      counts: { patients: 1, fatal: 0, cpapPatients: 0, fusionRuns: 1, withOverlap: 1, kernelMismatch: 0 },
      failureLedger: { nodeThrew: { OxyDex: 0, PulseDex: 0, GlucoDex: 0, ECGDex: 0, PpgDex: 0, CPAPDex: 0, Integrator: 0 }, flagCounts: {} },
      coverage: { severityByArc: Object.fromEntries(STRATA.map((s) => [s, Object.fromEntries(ARCS.map((a) => [a, 0]))])) },
      calibration: {},
      distributions: {}
    }
  };
  const j = judge(arm, arm, diff);
  console.log(JSON.stringify(verdictFor(j, diff, ['tools/robustness-rerun-ab.mjs'])));
  process.exit(0);
}

if (DIRECT && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  ROOT = judgeRootOrDie(import.meta.url);
  /* `valued`, NOT `string`: the guard reads `boolean` and `valued` only, so an unread key left every
     valued flag of this tool undeclared, and the tool refused its own documented invocation. */
  refuseUnknownArgvOrExit(argv, { boolean: ['--verdict-sample', '--selftest', '--json'], valued: ['--old', '--new', '--old-gen', '--new-gen', '--n', '--out'] }, { tool: 'robustness-rerun-ab' });
  const val = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const OLD = val('--old');
  const NEW = val('--new');
  const OLD_GEN = val('--old-gen');
  const NEW_GEN = val('--new-gen') || pathResolve(ROOT, 'cohort-gen.js');
  const N = Number(val('--n') || 20000);
  const OUT = val('--out');
  const JSON_ONLY = argv.includes('--json');

  if (!OLD || !NEW || !OLD_GEN) {
    console.error('--old <armB.json> --new <armA.json> --old-gen <cohort-gen@1.9.js> are all required.');
    console.error('Both arms AND both generators are needed: without the generator control a class-C equality passes vacuously.');
    process.exit(2);
  }

  const oldArm = JSON.parse(readFileSync(OLD, 'utf8'));
  const newArm = JSON.parse(readFileSync(NEW, 'utf8'));
  const diff = profileDiff(loadGenerator(readFileSync(OLD_GEN, 'utf8')), loadGenerator(readFileSync(NEW_GEN, 'utf8')), N);
  const j = judge(oldArm, newArm, diff);
  const v = verdictFor(j, diff, [OLD, NEW, OLD_GEN, 'tools/robustness-rerun-ab.mjs']);

  console.log(JSON.stringify(v));
  if (!JSON_ONLY) {
    console.error('');
    console.error(`▸ ${GATE}: ${j.status} — ${j.checked} of ${j.invariants.length} invariant(s) judged, ${j.violations.length} moved`);
    console.error(`  generators: ${diff.oldVersion} → ${diff.newVersion} over ${diff.n} seeds`);
    for (const s of STRATA) {
      const row = diff.bySeverity[s];
      if (row) console.error(`    ${s.padEnd(7)} ${String(row.differing).padStart(6)} / ${String(row.seeds).padStart(6)} profile(s) differ`);
    }
    for (const bad of j.violations) console.error(`  ✗ ${bad.id} ${bad.label}: ${bad.old} → ${bad.new}`);
    for (const u of j.undeterminable) console.error(`  ⊘ ${u.id} ${u.label}: undeterminable`);
  }
  if (OUT) {
    writeFileSync(OUT, `${JSON.stringify({ verdict: v, profileDiff: diff, invariants: j.invariants, reported: j.reported }, null, 2)}\n`);
    console.error(`  wrote ${OUT}`);
  }
  process.exit(j.status === 'PASS' ? 0 : 1);
}
