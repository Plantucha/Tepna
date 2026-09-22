/**
 * tools/verdict-emit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ONE tepna.verdict/1 OBJECT, BUILT AND VALIDATED — the four lines every adopting tool would otherwise
 * copy (VERDICT-CONTRACT §1/§2). `verdict.js` stays the ONLY definition of the shape; this only resolves
 * `producedBy.commit` from git (or says why it could not), hands the fields to `Verdict.make`, runs
 * `Verdict.validate`, and THROWS on an invalid object — a producer that would print a malformed
 * verdict has a bug, and printing it would be the fabricated-pass shape one layer up.
 *
 *   import { makeVerdict } from './verdict-emit.mjs';
 *   const v = makeVerdict({ gate, status, population, criterion, result, evidence, reason, tool, commit?, at? });
 *
 * `commit: null` (a --verdict-sample, a tarball) needs `commitReason`; omit `commit` to read git HEAD.
 * Not a gate itself — no verdict word is decided here. `aggregateChildren` (below) is the §3d RUNNER
 * rule — a runner's status over its children — used by run-check first, then selftest-all + the test runner.
 *
 * THIS IS THE ONE SHARED HELPER FOR JS ADOPTERS (wave 2 group B onward, Kestrel 2026-09-22): a tool
 * that decides builds its object here, never by hand — a hand-written `{ schema: 'tepna.verdict/1', … }`
 * is exactly the copy that drifts the day the contract moves. Its sibling, not its competitor, is
 * `tools/verdict-undeclared.mjs` (Osprey): the report for a tool that turns out to decide NOTHING —
 * a measurement with no pre-stated criterion — which must not be wrapped into a verdict at all.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

export function gitShort() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function makeVerdict(f) {
  const commit = f.commit === undefined ? gitShort() : f.commit;
  const producedBy = { tool: f.tool, commit };
  if (commit == null) producedBy.commitReason = f.commitReason || 'git rev-parse unavailable in this checkout';
  const v = Verdict.make({
    gate: f.gate,
    status: f.status,
    scope: f.scope === undefined ? 'internal' : f.scope,
    population: f.population,
    criterion: f.criterion,
    result: f.result,
    evidence: f.evidence,
    reason: f.reason,
    producedBy,
    at: f.at
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(f.tool + ' produced an invalid tepna.verdict/1: ' + check.errors.join('; '));
  return v;
}

/* ── RUNNER AGGREGATION — VERDICT-CONTRACT §3d, one function for every runner ──────────────────────
   A runner decides nothing of its own; its status is an aggregation of its CHILDREN, and the rule is
   written once here so run-check, selftest-all and the test runner cannot drift apart on it.

   children: [{ name, status?, provenance: 'object' | 'exit-code' | 'not-run', code?, evidence? }]
     'object'    — the child emitted its own tepna.verdict/1; `status` is its status. Any other label
                   ('summary' — selftest-all's parsed count line) is a structured read the caller vouches
                   for and likewise carries `status`; the label is kept in the result so a reader can
                   tell an object from a parsed line.
     'exit-code' — the child is still a word-and-exit-code: code 0 ⇒ UNKNOWN BY PROVENANCE (a green
                   exit is not an object — the runner can never read greener than its least-adopted
                   child), code ≠ 0 ⇒ FAIL (a red exit is never made greener).
     'not-run'   — never asked (an abort upstream). Counted EXCLUDED, never green; unplanned ⇒ UNKNOWN.
   opts: { eligible, declaredExcluded: [names], excludedBy: '--steps=…' | null }
   Precedence, NOT a vote: FAIL > SHORTFALL > UNKNOWN > PASS; checked = 0 ⇒ NOT_RUN.
   Returns { status, reason, population, result } — the caller adds gate/criterion/evidence/producedBy. */
export function aggregateChildren(children, opts = {}) {
  /* declaredExcluded: the NAMES of the children a filter left out, or just their COUNT when the runner
     knows how many it did not ask but not which (the test runner's --group= knows only totalGroups). */
  const declared = Array.isArray(opts.declaredExcluded) ? opts.declaredExcluded : Array.from({ length: opts.declaredExcluded | 0 }, (_, i) => `(undisclosed ${i + 1})`);
  const eligible = Number.isInteger(opts.eligible) ? opts.eligible : children.length + declared.length;
  const rows = children.map((c) => {
    if (c.provenance === 'not-run') return { ...c, status: 'NOT_RUN' };
    if (c.provenance === 'exit-code') return { ...c, status: c.code === 0 ? 'UNKNOWN' : 'FAIL' };
    /* any other provenance ('object', or a runner's own structured read such as selftest-all's parsed
       summary line) carries the child's own status — the caller vouches for how it was read. */
    return { ...c, provenance: c.provenance || 'object' };
  });
  const by = (st) => rows.filter((r) => r.status === st);
  const tally = {
    children: rows.length,
    pass: by('PASS').length,
    fail: by('FAIL').length,
    shortfall: by('SHORTFALL').length,
    underpowered: by('UNDERPOWERED').length,
    unknown: by('UNKNOWN').length,
    notApplicable: by('NOT_APPLICABLE').length,
    notRun: by('NOT_RUN').length,
    exitCodeOnly: rows.filter((r) => r.provenance === 'exit-code').length,
    declaredExcluded: declared.length
  };
  const checked = rows.length - tally.notRun;
  const excluded = tally.notRun + declared.length;
  const population = { checked, eligible, excluded };
  const names = (st) => by(st).map((r) => r.name);
  const first = by('FAIL')[0] || null;
  const result = {
    ...tally,
    firstFailure: first ? first.name : null,
    filtered: declared.length > 0,
    excludedBy: declared.length ? opts.excludedBy || 'declared' : null,
    children: rows.map((r) => ({ name: r.name, status: r.status, provenance: r.provenance, ...(r.code == null ? {} : { code: r.code }) }))
  };
  let status;
  let reason = null;
  if (checked === 0) {
    status = 'NOT_RUN';
    reason = `no child ran to a verdict (${eligible} eligible, ${excluded} excluded)`;
  } else if (tally.fail) {
    status = 'FAIL';
    reason =
      `${tally.fail} of ${checked} children FAIL — first: ${first.name}${first.code != null ? ` (exit ${first.code})` : first.why ? ` (${first.why})` : ''}` +
      (tally.notRun ? `; ${tally.notRun} never ran after it: ${names('NOT_RUN').join(' · ')}` : '');
  } else if (tally.shortfall) {
    status = 'SHORTFALL';
    reason = `${tally.shortfall} of ${checked} children SHORTFALL: ${names('SHORTFALL').join(' · ')} — the headline held and a named sub-population missed`;
  } else if (tally.unknown || tally.underpowered || tally.notRun) {
    status = 'UNKNOWN';
    const parts = [];
    const exitGreen = rows.filter((r) => r.provenance === 'exit-code' && r.status === 'UNKNOWN');
    if (exitGreen.length)
      parts.push(`${exitGreen.length} of ${checked} children are exit-code only, no tepna.verdict/1 object — UNKNOWN by provenance (§3d): ${exitGreen.map((r) => r.name).join(' · ')}`);
    const objUnknown = rows.filter((r) => r.provenance !== 'exit-code' && r.status === 'UNKNOWN');
    if (objUnknown.length) parts.push(`${objUnknown.length} UNKNOWN: ${objUnknown.map((r) => r.name + (r.why ? ' (' + r.why + ')' : '')).join(' · ')}`);
    if (tally.underpowered) parts.push(`${tally.underpowered} UNDERPOWERED: ${names('UNDERPOWERED').join(' · ')}`);
    if (tally.notRun) parts.push(`${tally.notRun} NOT_RUN without a declared exclusion (never asked): ${names('NOT_RUN').join(' · ')}`);
    reason = parts.join('; ');
  } else {
    status = 'PASS';
  }
  if (status === 'PASS' && result.filtered) result.consumerRule = 'a filtered PASS is NOT the gate — the CI summary and any merge decision must not read it as the full run (§3d)';
  /* NOT_RUN carries result: null by contract (§1) — nothing was examined, so the tally is not a result. */
  return { status, reason, population, result: status === 'NOT_RUN' ? null : result };
}

export { Verdict };
