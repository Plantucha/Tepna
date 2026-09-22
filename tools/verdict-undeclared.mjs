#!/usr/bin/env node
/*
 * tools/verdict-undeclared.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT OBJECT FOR A STATISTIC THAT HAS NO PRE-STATED BAND — tepna.verdict/1, status UNKNOWN.
 *
 * VERDICT-CONTRACT §1: a threshold derived from the data it judges is UNKNOWN, not PASS. Eight
 * analysis tools (`acc-acc-control` · `cpap-oxy-couple` · `pat-ppg-ppg-control` · `pulse-agreement` ·
 * `tch-estimator-bakeoff` · `tch-multinight` · `tch-per-epoch-rho` · `tch-third-corner`) print a
 * statistic under a VERDICT banner, never pre-stated a band, and their numbers are already on record
 * (RESIDUE `2026-09-22-bandless-analysis-tools-emit-unknown`). A band written now would be a number,
 * not a test — so each of them emits THIS object: status UNKNOWN, the statistic in `result` (the
 * number survives the status), the reason naming the missing rule and the only route to one (a band
 * pre-stated in a brief BEFORE the next run, on records the tool has not seen). Never PASS.
 *
 * ONE builder, so the eight say the same thing the same way and the adoption gate reads one shape.
 * Pure. `verdict.js` is the authority; this file restates nothing of the schema — it fills it.
 *
 *   node tools/verdict-undeclared.mjs --selftest
 *   node tools/verdict-undeclared.mjs --verdict-sample     # the object every adopter's sample is built from
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const REASON =
  'no pre-stated criterion — the statistic is reported bare and no rule can be applied to it; a band written after the number is a number, not a test (VERDICT-CONTRACT §1: a threshold derived from the data it judges is UNKNOWN, not PASS). The only route to a decided status is a band pre-stated in a brief BEFORE the next run, on records this tool has not seen';

/**
 * undeclaredVerdict({ tool, gate?, stat, population, evidence?, base?, commit?, commitReason?, at? })
 *   tool        repo-relative path of the emitter (producedBy.tool)
 *   stat        { label, value, ...anything the tool measured } — carried verbatim in `result`
 *   population  { checked, eligible } — what the statistic was computed over (records/nights/pairs)
 *   evidence    paths/globs a reader opens; the tool itself is always first
 *   note        optional, appended to the reason — e.g. a rule that lives in the code but was never
 *               pre-stated in a brief (it decides nothing here; the object still says UNKNOWN)
 */
export function undeclaredVerdict(f) {
  f = f || {};
  if (!f.tool) throw new Error('undeclaredVerdict: tool is required');
  const pop = f.population || {};
  const checked = Number.isFinite(pop.checked) ? pop.checked : 0;
  const eligible = Number.isFinite(pop.eligible) ? pop.eligible : checked;
  if (checked > eligible) throw new Error('undeclaredVerdict: checked ' + checked + ' > eligible ' + eligible);
  const producedBy = { tool: f.tool, commit: f.commit === undefined ? headCommit() : f.commit };
  if (producedBy.commit == null) producedBy.commitReason = f.commitReason || 'not run inside a git checkout';
  const stat = f.stat && typeof f.stat === 'object' ? f.stat : null;
  const hasStat = !!stat && checked > 0;
  return {
    schema: 'tepna.verdict/1',
    gate: f.gate || f.tool.replace(/^tools\//, '').replace(/\.mjs$/, ''),
    scope: 'internal',
    status: hasStat ? 'UNKNOWN' : 'NOT_RUN',
    population: { checked, eligible, excluded: eligible - checked },
    criterion: { name: 'undeclared', threshold: 0, unit: '', direction: 'lte' },
    result: hasStat ? stat : null,
    evidence: [f.tool, ...(f.evidence || [])],
    reason: hasStat ? REASON + (f.note ? ' — ' + f.note : '') : 'no record contributed to the statistic (' + checked + ' of ' + eligible + ') — nothing to report, bare or otherwise',
    producedBy,
    at: (f.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z'),
    ...(f.base != null ? { base: f.base } : {})
  };
}

export function printVerdict(v) {
  console.log('VERDICT (tepna.verdict/1): ' + JSON.stringify(v));
}

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function verdictSample(tool) {
  return undeclaredVerdict({
    tool: tool || 'tools/verdict-undeclared.mjs',
    stat: { label: 'median delta (synthetic)', value: 0.42, halfWidth: 0.1, n: 12 },
    population: { checked: 12, eligible: 14 },
    evidence: ['<synthetic>'],
    commit: null,
    commitReason: '--verdict-sample: synthetic statistic, no code identity claimed',
    at: '2026-09-22T00:00:00Z'
  });
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const val = (v) => (V.validate(v).ok ? true : V.validate(v).errors.join(' | '));
  const s = verdictSample();
  ok('a statistic with no band → UNKNOWN, never PASS', s.status === 'UNKNOWN');
  ok('…the reason carries the §1 sentence and the route to a band', /UNKNOWN, not PASS/.test(s.reason) && /pre-stated in a brief BEFORE the next run/.test(s.reason), s.reason);
  ok('…the statistic rides in result verbatim', s.result && s.result.value === 0.42 && s.result.n === 12, JSON.stringify(s.result));
  ok('…population is an equality', s.population.checked === 12 && s.population.eligible === 14 && s.population.excluded === 2);
  ok('…scope internal, criterion named undeclared', s.scope === 'internal' && s.criterion.name === 'undeclared');
  ok('…valid under verdict.js', val(s) === true, String(val(s)));
  ok('…commit null WITH a reason (∅)', s.producedBy.commit === null && /synthetic/.test(s.producedBy.commitReason));
  const nr = undeclaredVerdict({ tool: 'tools/x.mjs', stat: { value: 1 }, population: { checked: 0, eligible: 5 }, commit: 'abc1234', at: '2026-09-22T00:00:00Z' });
  ok('nothing contributed → NOT_RUN with result null, even when a stat object is passed', nr.status === 'NOT_RUN' && nr.result === null && val(nr) === true, String(val(nr)));
  ok('the gate defaults to the tool basename', nr.gate === 'x');
  let threw = null;
  try {
    undeclaredVerdict({ tool: 'tools/x.mjs', stat: { value: 1 }, population: { checked: 6, eligible: 5 } });
  } catch (e) {
    threw = e.message;
  }
  ok('checked > eligible is refused by the builder', /checked 6 > eligible 5/.test(threw), threw);
  ok(
    'a real checkout → a 7–40 hex commit (or null with reason)',
    (() => {
      const r = undeclaredVerdict({ tool: 'tools/x.mjs', stat: { value: 1 }, population: { checked: 1 } });
      return (r.producedBy.commit === null && !!r.producedBy.commitReason) || /^[0-9a-f]{7,40}$/.test(r.producedBy.commit);
    })()
  );
  console.log(fail ? fail + ' failed of 11' : 'all 11 selftests passed');
  return fail ? 1 : 0;
}

const IS_CLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_CLI) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  if (process.argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 1));
    process.exit(0);
  }
  console.error('usage: node tools/verdict-undeclared.mjs --selftest | --verdict-sample  (a library for the band-less tools; see the header)');
  process.exit(2);
}
