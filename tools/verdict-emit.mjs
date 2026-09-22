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
 * Not a gate itself — no verdict word is decided here.
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

export { Verdict };
