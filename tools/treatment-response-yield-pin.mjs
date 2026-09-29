#!/usr/bin/env node
/*
 * tools/treatment-response-yield-pin.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE PINNED YIELD — how many synthetic patients qualify for `papers/treatment-response.html`, and
 * which of the two inputs is answerable for the number.
 *
 * WHY THIS EXISTS (residue `2026-09-22-cohort-gen-yield-moved-again`). At the paper's stated
 * configuration — `nSubj 900, minN 10` — the qualifying cohort read 269 intervention / 317
 * flat-control on 2026-09-16/17 and 233 / 239 on 2026-09-22. Same configuration, same generator
 * version, different answer, and the ONLY thing that noticed was a re-cut run six days later. Five
 * OxyDex commits landed in between and were named as candidates, not verified as the cause. A number
 * that moves without anything reporting it is not a measurement; it is a coincidence that has not been
 * caught yet.
 *
 * ⚠️ THE DECOMPOSITION IS THE POINT, and it is what makes this more than a golden. The page reaches its
 * counts in two independent stages:
 *
 *   1 · SELECTION — `treatment-response-analysis.js` scans `CohortGen.sampleProfile(seed)` from 0 and
 *       keeps the seeds whose profile is an intervention arc with >= `minN` nights (and >= 2 pre- and
 *       >= 2 post-treatment), or a flat arc with >= `minN` nights, until it has `nSubj` of each. NO
 *       DETECTOR RUNS IN THIS STAGE. It is pure generator, it is deterministic, and it takes ~100 ms.
 *   2 · SURVIVAL — every selected seed is scored by the REAL detectors in a worker realm, and
 *       `measureFromResults` returns null — dropping the patient — whenever the ODI or rMSSD series
 *       has a gap or a non-finite value. NO GENERATOR RUNS IN THIS STAGE.
 *
 * So `nIntervention = txCandidates − txSkipped`, and the two terms have DIFFERENT owners. Pinning the
 * pair therefore answers a question a single committed count cannot: when the yield moves, the
 * selection count says whether the generator moved, and its stability says the detectors did.
 *
 * Measured 2026-09-28: selection yields 900 / 900 — it FILLS the target from 18,291 seeds against a
 * 2,000,000 cap. The generator has slack and is not the constraint, which means every one of the three
 * historical yields was set entirely by detector-side skips. That is a decided fact where the residue
 * row had a named-but-unverified candidate.
 *
 * ⚠️ WHAT THE KEY IS, AND WHY IT IS NOT A BUNDLE HASH. The page does not inline the detectors; it boots
 * `cohort-worker.js` realms that `importScripts` them. The pin therefore keys on the SHA of every file
 * in the `oxy` and `pulse` entries of that worker's own `SCRIPTS` table — the exact code that produced
 * the counts — and the list is READ FROM THE TABLE, never hand-copied here. A hand-maintained closure
 * that silently stopped covering a new realm file would reproduce this row's defect one layer up.
 * The consequence is deliberate and conservative: a comment-only edit to `oxydex-dsp.js` reds the pin.
 * That direction is the correct one to fail in — re-stamping a pin is four seconds and a re-cut that
 * nobody ran is what this row is about — and the suite's failure text says which file moved, so an
 * inert edit is cheap to dispose of.
 *
 * This tool WRITES the pin. It decides nothing and emits no verdict: the gate is
 * `treatment-response · pinned yield` in `tests/dex-tests.js`, which is where the decision belongs.
 *
 *   node tools/analysis-rerun.mjs --only treatment-response-analysis.html --paper-scale --out <rerun.json>
 *   node tools/treatment-response-yield-pin.mjs --rerun <rerun.json> [--out analysis/treatment-response-yield-pin.json]
 *   node tools/treatment-response-yield-pin.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PIN = join(ROOT, 'analysis', 'treatment-response-yield-pin.json');

/* The page's stated configuration, and the seed cap it scans under. Read from
   `tools/analysis-rerun.mjs`'s inventory would be better still, but that file is an ESM module with a
   large side-effecting main; these three numbers are asserted against the page and the inventory by
   the suite instead, which is the same guarantee without importing a CLI. */
export const CONFIG = { page: 'treatment-response-analysis.html', nSubj: 900, minN: 10, seedCap: 2000000 };

export const sha12 = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);

/* ── STAGE 1 · SELECTION, replayed exactly as `treatment-response-analysis.js:323` runs it ──────────
   The predicate is transcribed from that loop and the suite asserts the transcription still matches
   the page's source, so a page edit cannot leave this replay quietly measuring a different cohort. */
export function selectionCounts(CohortGen, { nSubj, minN, seedCap }) {
  let tx = 0,
    flat = 0,
    seed = 0;
  while ((tx < nSubj || flat < nSubj) && seed < seedCap) {
    let pf;
    try {
      pf = CohortGen.sampleProfile(seed);
    } catch {
      seed++;
      continue;
    }
    if (pf) {
      if (pf.arc === 'intervention' && pf.nNights >= minN && pf.interventionNight >= 2 && pf.interventionNight <= pf.nNights - 2 && tx < nSubj) tx++;
      else if (pf.arc === 'flat' && pf.nNights >= minN && flat < nSubj) flat++;
    }
    seed++;
  }
  return { txCandidates: tx, flatCandidates: flat, seedsScanned: seed, filledTarget: tx >= nSubj && flat >= nSubj };
}

/* `cohort-gen.js` is a browser global module; load it the way the suite does rather than importing. */
export function loadCohortGen(root = ROOT) {
  const ctx = vm.createContext({ console, Math, Date, JSON });
  ctx.window = ctx;
  for (const f of ['kernel-constants.js', 'cohort-gen.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx);
  return ctx.CohortGen || null;
}

/* ── THE DETECTOR CLOSURE, derived from `cohort-worker.js`'s own table ──────────────────────────────
   A realm the table does not name returns `null`, never `{}`: "the table moved" and "this realm loads
   nothing" must not reach a comparison wearing the same shape. */
export function realmDigests(workerSrc, realms, readFile) {
  const out = {};
  for (const realm of realms) {
    const m = workerSrc.match(new RegExp('\\b' + realm + ':\\s*\\[([^\\]]*)\\]'));
    const files = m ? (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)) : [];
    if (!files.length) {
      out[realm] = null;
      continue;
    }
    const d = {};
    for (const f of files) d[f] = readFile(f);
    out[realm] = d;
  }
  return out;
}

/* Which named digests differ between two closures — the answer the failure text needs, not a boolean. */
export function movedFiles(pinned, current) {
  const moved = [];
  for (const realm of Object.keys(pinned || {})) {
    const a = pinned[realm],
      b = (current || {})[realm];
    if (!a || !b) {
      moved.push(realm + ': realm absent on one side');
      continue;
    }
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[f] !== b[f]) moved.push(realm + '/' + f + ' ' + (a[f] || 'absent') + ' → ' + (b[f] || 'absent'));
    }
  }
  return moved;
}

/* The three yields this pin exists because of. Appended to, never rewritten: the point of the row is
   that a single number replaced another with nothing recording that it had. */
export const HISTORY = [
  { measured: '2026-09-16', nIntervention: 269, nFlatControl: 317, source: 'residue 2026-09-17-treatment-response-gap-is-not-the-generator (identical under cohort-gen 1.9 and 2.0)' },
  { measured: '2026-09-22', nIntervention: 233, nFlatControl: 239, source: '#2825 analysis/published-numbers/treatment-response-2026-09-22.json' }
];

export function buildPin({ nIntervention, nFlatControl, minNights, selection, detector, commit, at }) {
  return {
    schema: 'tepna.yield-pin/1',
    config: { ...CONFIG, minNightsObserved: minNights },
    generator: { version: selection.version, ...selection.counts },
    detector,
    yield: {
      nIntervention,
      nFlatControl,
      txSkipped: selection.counts.txCandidates - nIntervention,
      flatSkipped: selection.counts.flatCandidates - nFlatControl
    },
    history: HISTORY,
    measuredAt: at,
    producedBy: { tool: 'tools/treatment-response-yield-pin.mjs', commit }
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function selftest() {
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (!cond) fail++;
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  };

  /* SELECTION replays without a detector, and it is the generator alone that answers. A stub whose
     profiles are all flat must therefore yield zero intervention candidates and stop at the cap — the
     shape that proves the predicate is doing the selecting rather than the loop running out. */
  const allFlat = { sampleProfile: (s) => ({ arc: 'flat', nNights: 12, interventionNight: 0 }) };
  const sFlat = selectionCounts(allFlat, { nSubj: 5, minN: 10, seedCap: 1000 });
  ok('selection: a generator that emits only flat arcs yields no intervention candidates', sFlat.txCandidates === 0 && sFlat.flatCandidates === 5, JSON.stringify(sFlat));
  ok('selection: …and says it did NOT fill the target rather than reporting 0 as an answer', sFlat.filledTarget === false, JSON.stringify(sFlat));

  /* The `minN` filter must BITE — a profile one night short of the floor is not a candidate. */
  const short = { sampleProfile: () => ({ arc: 'flat', nNights: 9, interventionNight: 0 }) };
  const sShort = selectionCounts(short, { nSubj: 5, minN: 10, seedCap: 500 });
  ok('selection: minN excludes a profile one night short, and the cap ends the scan', sShort.flatCandidates === 0 && sShort.seedsScanned === 500, JSON.stringify(sShort));

  /* The intervention arm needs >= 2 pre and >= 2 post; a change-point at night 1 is excluded. */
  const edge = { sampleProfile: () => ({ arc: 'intervention', nNights: 12, interventionNight: 1 }) };
  ok('selection: an intervention night at index 1 fails the >= 2-pre rule', selectionCounts(edge, { nSubj: 3, minN: 10, seedCap: 200 }).txCandidates === 0);
  const good = { sampleProfile: () => ({ arc: 'intervention', nNights: 12, interventionNight: 5 }) };
  ok('selection: …and one at index 5 of 12 passes', selectionCounts(good, { nSubj: 3, minN: 10, seedCap: 200 }).txCandidates === 3);

  /* A throwing generator must not end the scan — the page catches and steps past. */
  let n = 0;
  const throwy = {
    sampleProfile: () => {
      if (n++ % 2) throw new Error('bad seed');
      return { arc: 'flat', nNights: 12, interventionNight: 0 };
    }
  };
  ok('selection: a throwing seed is stepped past, not fatal', selectionCounts(throwy, { nSubj: 4, minN: 10, seedCap: 100 }).flatCandidates === 4);

  /* The closure is read from the table. A realm the table does not name is null, not empty. */
  const W = "var SCRIPTS = {\n  oxy: ['a.js', 'b.js'],\n  pulse: ['a.js']\n};";
  const D = realmDigests(W, ['oxy', 'pulse', 'nope'], (f) => 'sha:' + f);
  ok('closure: the file list is READ from the SCRIPTS table', JSON.stringify(D.oxy) === JSON.stringify({ 'a.js': 'sha:a.js', 'b.js': 'sha:b.js' }), JSON.stringify(D.oxy));
  ok('closure: a realm the table does not name is null, never an empty object', D.nope === null, JSON.stringify(D.nope));

  /* The failure has to NAME the file. A boolean "something moved" sends the reader to re-cut before
     they know whether the edit could have moved a number at all. */
  const a = { oxy: { 'x.js': '111', 'y.js': '222' } };
  const b = { oxy: { 'x.js': '111', 'y.js': '999' } };
  ok('moved: only the file that changed is named, with both digests', JSON.stringify(movedFiles(a, b)) === JSON.stringify(['oxy/y.js 222 → 999']), JSON.stringify(movedFiles(a, b)));
  ok('moved: an unchanged closure names nothing', movedFiles(a, a).length === 0);
  ok('moved: a file ADDED to the realm is named too, not silently tolerated', movedFiles(a, { oxy: { 'x.js': '111', 'y.js': '222', 'z.js': '333' } }).length === 1);

  /* The pin carries the decomposition, not just the two counts. */
  const P = buildPin({
    nIntervention: 233,
    nFlatControl: 239,
    minNights: 10,
    selection: { version: 'cohort-gen/2.0', counts: { txCandidates: 900, flatCandidates: 900, seedsScanned: 18291, filledTarget: true } },
    detector: a,
    commit: 'deadbeef',
    at: '2026-09-28T00:00:00Z'
  });
  ok('pin: the skipped counts are derived, so the two stages stay separable', P.yield.txSkipped === 667 && P.yield.flatSkipped === 661, JSON.stringify(P.yield));
  /* The pin carries the two EARLIER yields; the third is the pin's own `yield`, which is why HISTORY
     has two rows and not three. Saying "three historical yields" here would be the kind of off-by-one
     prose that makes a reader trust a count nobody checked. */
  ok(
    "pin: both earlier yields travel with it, and today's is the pin itself",
    P.history.length === 2 && P.history[0].nIntervention === 269 && P.yield.nIntervention === 233,
    JSON.stringify(P.history.map((h) => h.nIntervention).concat(P.yield.nIntervention))
  );
  ok('pin: schema + producedBy present, and it claims no verdict of its own', P.schema === 'tepna.yield-pin/1' && P.producedBy.tool.endsWith('treatment-response-yield-pin.mjs') && !('status' in P));

  /* The real generator, at the real configuration — the number the pin is built on. */
  const CG = loadCohortGen();
  ok('the real CohortGen loads outside a browser', !!(CG && typeof CG.sampleProfile === 'function'), CG ? CG.VERSION : 'null');
  if (CG) {
    const real = selectionCounts(CG, CONFIG);
    ok('selection FILLS the target at the stated configuration — the generator is not the constraint', real.filledTarget === true && real.txCandidates === CONFIG.nSubj, JSON.stringify(real));
  } else fail++;

  console.log(fail ? fail + ' failed of 16' : 'all 16 selftests passed');
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const rerunPath = arg('--rerun', null);
  if (!rerunPath) {
    console.error('usage: node tools/treatment-response-yield-pin.mjs --rerun <analysis-rerun-results.json> [--out <pin.json>] | --selftest');
    return 2;
  }
  if (!existsSync(rerunPath)) {
    console.error('no such rerun result: ' + rerunPath);
    return 2;
  }
  const raw = JSON.parse(readFileSync(rerunPath, 'utf8'));
  /* `analysis-rerun` writes `{ tools: { <page>: { ms, err, result } } }` — keyed by the PAGE, which is
     why `CONFIG.page` is the lookup rather than a literal. The fallbacks are for a bare result global
     handed in directly; the shape is asserted, never assumed. */
  const entry = (raw.tools && raw.tools[CONFIG.page]) || raw[CONFIG.page] || null;
  /* ⚠️ THE ERROR IS READ BEFORE THE COUNTS, and it is the case this refusal exists for. On 2026-09-28 a
     paper-scale run sat for 7203 s and wrote `{ result: null, err: "window.TREATMENT_RESPONSE never
     appeared within 120 min" }` because the page could not boot (#3209). A refusal that says only "no
     counts" sends the reader to look for a missing field; naming the run's own error sends them to the
     page. Same rule as the §∅ work everywhere else in this repo: report the absence you measured. */
  if (entry && entry.err) {
    console.error('the re-cut did not complete — refusing to write a pin over a run that examined nothing:');
    console.error('  ' + entry.err + (entry.ms ? '  (after ' + Math.round(entry.ms / 1000) + ' s)' : ''));
    return 2;
  }
  const R = (entry && entry.result) || raw.TREATMENT_RESPONSE || (raw.results && raw.results.TREATMENT_RESPONSE) || null;
  if (R == null || R.nIntervention == null || R.nFlatControl == null) {
    console.error('the rerun result carries no nIntervention/nFlatControl — refusing to write a pin over a run that examined nothing');
    console.error('  looked for tools["' + CONFIG.page + '"].result in ' + rerunPath);
    return 2;
  }
  const CG = loadCohortGen();
  if (!CG) {
    console.error('cohort-gen.js did not load — refusing to write a pin with no selection term');
    return 2;
  }
  const counts = selectionCounts(CG, CONFIG);
  const workerSrc = readFileSync(join(ROOT, 'cohort-worker.js'), 'utf8');
  const detector = realmDigests(workerSrc, ['oxy', 'pulse'], (f) => (existsSync(join(ROOT, f)) ? sha12(readFileSync(join(ROOT, f), 'utf8')) : null));
  const pin = buildPin({
    nIntervention: R.nIntervention,
    nFlatControl: R.nFlatControl,
    minNights: R.minNights,
    selection: { version: CG.VERSION, counts },
    detector,
    commit: gitCommit(),
    at: new Date().toISOString()
  });
  const out = arg('--out', PIN);
  writeFileSync(out, JSON.stringify(pin, null, 2) + '\n');
  console.log('wrote ' + out);
  console.log(
    '  selection  ' + counts.txCandidates + ' tx / ' + counts.flatCandidates + ' flat candidates (' + counts.seedsScanned + ' seeds, target ' + (counts.filledTarget ? 'FILLED' : 'NOT filled') + ')'
  );
  console.log('  yield      ' + pin.yield.nIntervention + ' tx / ' + pin.yield.nFlatControl + ' flat  (skipped ' + pin.yield.txSkipped + ' / ' + pin.yield.flatSkipped + ' by the detectors)');
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('treatment-response-yield-pin.mjs')) process.exit(main(process.argv.slice(2)));
