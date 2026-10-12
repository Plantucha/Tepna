#!/usr/bin/env node
/*
 * pr-compliance.mjs — PR body and changeset compliance gate.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Enforces the standing PR rules from the fleet workflow:
 *   1. Body starts with a "Rule 0:" line (the git-grep evidence line).
 *   2. Body carries the "Fleet-Session:" trailer.
 *   3. If computeHash moved in the diff, the body carries the verbatim
 *      corpus re-verification sentence.
 *   4. If code files changed, a changes/ changeset was added.
 *   5. The body passes the writing rules (tools/ste-lint.mjs, strict) — owner, 2026-10-12.
 *
 * In CI (pull_request event), the workflow passes:
 *   PR_BODY, PR_BASE_SHA, PR_HEAD_SHA via env.
 * On push/main or workflow_dispatch without a PR, exits 0 (nothing to check).
 *
 * Local use:
 *   PR_BODY="$(cat body.md)" PR_BASE_SHA=main PR_HEAD_SHA=HEAD node tools/pr-compliance.mjs
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings as steFindings, readGlossary } from './ste-lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const RULE0_RE = /^Rule 0:/m;
const TRAILER_RE = /^Fleet-Session:\s*.+/m;
const CORPUS_SENTENCE = 'computeHash moved — re-verification on the corpus owed before merge (tools/verify-fixtures.mjs on the rig)';
// Code files: sources, not bundles, not docs. Bundles are verified by build.mjs --check.
// .src.html files are sources (they generate the bundles); *.html bundles are not.
const CODE_RE = /\.(mjs|js|py|sh|src\.html)$/;
const BUNDLE_RE = /(^|\/)[A-Z][A-Za-z]*\.html$/;

/**
 * PURE CORE — every check that does not need git. `computeHashMoved` is passed IN, because deciding
 * it requires reading the diff; everything else is a property of the body and the file list, so a
 * selftest can plant each violation and its control without a repository.
 *
 * @param {{body: string, files: string[]|null, computeHashMoved: boolean, ste: Array<{line:number,rule:string,detail:string}>|null}} ctx
 * @returns {{failures: string[], checked: string[]}}
 */
export function checkCompliance({ body = '', files = null, computeHashMoved = false, ste = null }) {
  const failures = [];
  const checked = [];

  /* 1 · THE Rule 0 EVIDENCE LINE. ⚠️ The REGEX accepts such a line anywhere in the body (`/m`), while
     the fleet convention — invented alongside #3368 and now habit — is that it is the FIRST line. The
     message below says what is ENFORCED rather than what is conventional: a failure message that
     overstates the rule sends the reader hunting for a position problem they do not have. The
     convention is documented in CLAUDE.md §📌; this gate's floor is "the line is present". */
  checked.push('rule0-line');
  if (!RULE0_RE.test(body)) failures.push('body carries no "Rule 0:" evidence line (convention: make it the FIRST line — CLAUDE.md §📌)');

  checked.push('fleet-session-trailer');
  if (!TRAILER_RE.test(body)) failures.push('body is missing the "Fleet-Session:" trailer');

  /* 5 · THE WRITING RULES (owner ruling 2026-10-12, "make it bite"). `ste` is the finding list from
     tools/ste-lint.mjs over the body, computed by the caller so this core stays file-free; `null`
     means the lint was not run, reported as not evaluated rather than passed. The message names the
     first findings by line, so the author fixes the body instead of hunting. */
  if (ste) {
    checked.push('ste-writing-rules');
    if (ste.length) {
      const named = ste
        .slice(0, 5)
        .map((x) => `line ${x.line} ${x.rule}: ${x.detail}`)
        .join('; ');
      failures.push(`body fails the writing rules — ${ste.length} finding(s) from tools/ste-lint.mjs: ${named}${ste.length > 5 ? '; …' : ''}`);
    }
  }

  /* 3 and 4 need the file list. `files === null` means no diff was available, which is NOT the same
     as an empty diff — the two checks below are then not evaluated and say so, rather than passing. */
  if (files) {
    checked.push('corpus-sentence-on-computehash-move');
    if (computeHashMoved && !body.includes(CORPUS_SENTENCE)) failures.push('computeHash moved but body lacks the verbatim corpus re-verification sentence');

    checked.push('changeset-for-code-change');
    const codeChanged = files.some((f) => CODE_RE.test(f) && !BUNDLE_RE.test(f) && !f.startsWith('changes/'));
    const changesetAdded = files.some((f) => f.startsWith('changes/') && f.endsWith('.md'));
    if (codeChanged && !changesetAdded) failures.push('code files changed but no changes/ changeset was added');
  }
  return { failures, checked };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };
  const good = 'Rule 0: `doc-search "x"` → a.md\n\nbody\n\nFleet-Session: Magpie';
  const has = (r, frag) => r.failures.some((f) => f.includes(frag));

  // CONTROL — a compliant body with a compliant file list must pass, or the gate blocks everything.
  const clean = checkCompliance({ body: good, files: ['tools/x.mjs', 'changes/2026-10-10-x.md'], ste: [] });
  ok(clean.failures.length === 0, 'CONTROL: a compliant body and changeset pass');
  ok(clean.checked.length === 5, 'CONTROL: all five checks were evaluated, so the pass is not a skip');

  // PLANTED VIOLATION 5 — the body fails the writing rules (owner, 2026-10-12: the linter bites).
  const passive = [{ line: 3, rule: 'passive', detail: '"was measured"' }];
  ok(has(checkCompliance({ body: good, files: null, ste: passive }), 'writing rules'), 'a writing-rules finding is caught');
  ok(has(checkCompliance({ body: good, files: null, ste: passive }), 'line 3 passive'), '…and the failure names the line and the rule');
  ok(!has(checkCompliance({ body: good, files: null, ste: [] }), 'writing rules'), 'CONTROL: no finding, no failure');
  ok(!checkCompliance({ body: good, files: null, ste: null }).checked.includes('ste-writing-rules'), 'lint not run ⇒ the check is reported as NOT evaluated, not as passed');
  // …and the import is LIVE: the real linter over a planted passive sentence, with the real glossary.
  const live = steFindings(`${good}\n\nThe value was measured by the tool.`, readGlossary());
  ok(
    live.some((x) => x.rule === 'passive'),
    'the real linter reports the planted passive sentence'
  );
  ok(steFindings(good, readGlossary()).length === 0, 'CONTROL: the compliant body has no finding');

  // PLANTED VIOLATION 1 — no Rule 0 line at all (what #3377 went red on).
  ok(has(checkCompliance({ body: 'no evidence line\n\nFleet-Session: Magpie', files: null }), 'Rule 0'), 'a missing Rule 0 line is caught');
  // …and the message names the convention rather than overstating the enforced rule.
  ok(has(checkCompliance({ body: 'x', files: null }), 'FIRST line'), 'the message points at the convention it cannot enforce');

  // PLANTED VIOLATION 2 — no trailer.
  ok(has(checkCompliance({ body: 'Rule 0: q → a', files: null }), 'Fleet-Session'), 'a missing Fleet-Session trailer is caught');

  // PLANTED VIOLATION 3 — code moved with no changeset.
  ok(has(checkCompliance({ body: good, files: ['oxydex-dsp.js'] }), 'changeset'), 'code changed with no changeset is caught');
  // CONTROLS for it: a bundle alone is generated, and a changes/-only PR is not a code change.
  ok(!has(checkCompliance({ body: good, files: ['OxyDex.html'] }), 'changeset'), 'CONTROL: a BUNDLE alone needs no changeset — it is generated');
  ok(!has(checkCompliance({ body: good, files: ['briefs/X-BRIEF.md'] }), 'changeset'), 'CONTROL: a doc-only PR needs no changeset');

  // PLANTED VIOLATION 4 — a computeHash move without the verbatim corpus sentence.
  ok(has(checkCompliance({ body: good, files: ['clock.js', 'changes/a.md'], computeHashMoved: true }), 'corpus re-verification'), 'a computeHash move without the corpus sentence is caught');
  ok(
    !has(checkCompliance({ body: `${good}\n\n${CORPUS_SENTENCE}`, files: ['clock.js', 'changes/a.md'], computeHashMoved: true }), 'corpus re-verification'),
    'CONTROL: the verbatim sentence satisfies it'
  );

  /* NO FILE LIST ⇒ THE DIFF CHECKS ARE NOT EVALUATED, and that is visible in `checked` rather than
     being indistinguishable from passing them. */
  const bodyOnly = checkCompliance({ body: good, files: null });
  ok(bodyOnly.checked.length === 2 && !bodyOnly.checked.includes('changeset-for-code-change'), 'without a diff the file checks are reported as NOT evaluated, not as passed');

  const line = fail.length ? `pr-compliance selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, failures, checked, reason }) {
  const v = Verdict.make({
    gate: 'pr-compliance',
    status,
    population: { checked: checked.length, eligible: 5, excluded: 5 - checked.length },
    criterion: { name: 'pr-body-and-changeset-satisfy-every-applicable-compliance-check', threshold: 0, unit: 'failed checks', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { checksEvaluated: checked, failures },
    evidence: ['tools/pr-compliance.mjs', 'CLAUDE.md'],
    reason: reason === undefined ? (status === 'PASS' ? null : failures.join('; ')) : reason,
    producedBy: {
      tool: 'tools/pr-compliance.mjs',
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`pr-compliance produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    return r.ok ? 0 : 1;
  }
  const asJson = argv.includes('--json');
  const body = process.env.PR_BODY || '';
  const base = process.env.PR_BASE_SHA;
  const head = process.env.PR_HEAD_SHA || 'HEAD';

  /* THE PR-ONLY SKIP, unchanged: outside a pull_request event there is no body and no base, so this
     gate has nothing to judge. It is NOT_RUN rather than PASS — the distinction the contract exists
     for, since "compliant" and "not applicable here" are different claims. */
  if (!body && !base) {
    if (asJson)
      process.stdout.write(`${JSON.stringify(verdictOf({ status: 'NOT_RUN', failures: [], checked: [], reason: 'no PR context (not a pull_request event) — nothing was examined' }), null, 1)}\n`);
    else console.log('pr-compliance: no PR context (not a pull_request event) — skip');
    return 0;
  }

  let files = null;
  let diffError = null;
  if (base) {
    try {
      files = sh(`git diff --name-only ${base}..${head}`).split('\n').filter(Boolean);
    } catch {
      diffError = `cannot diff ${base}..${head}`;
    }
  }
  let computeHashMoved = false;
  if (files) {
    // computeHash movers need the corpus sentence. Look for actual changes to the computeHash
    // implementation (function definition or body), not mere mentions in strings/comments/changesets.
    for (const f of files) {
      if (!CODE_RE.test(f) || BUNDLE_RE.test(f)) continue;
      // The gate scripts themselves reference computeHash by design; they never move it.
      if (f === 'tools/pr-compliance.mjs') continue;
      try {
        const diff = sh(`git diff ${base}..${head} -U0 -- ${f}`);
        // Parse diff hunks to get changed line numbers in the NEW file
        const hunks = [];
        let newLine = 0;
        for (const line of diff.split('\n')) {
          const hm = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (hm) {
            newLine = parseInt(hm[1], 10);
            continue;
          }
          if (line.startsWith('+') && !line.startsWith('+++')) {
            hunks.push(newLine);
            newLine++;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            // Deletion doesn't advance newLine
          } else if (!line.startsWith('\\')) {
            newLine++;
          }
        }
        if (!hunks.length) continue;

        // Find computeHash function body range in the NEW file
        const content = sh(`git show ${head}:${f}`);
        const lines = content.split('\n');
        let funcStart = -1,
          funcEnd = -1,
          braceDepth = 0,
          inFunc = false;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (!inFunc && /function\s+computeHash[\s(]|computeHash\s*=\s*(async\s*)?\(/.test(l)) {
            inFunc = true;
            funcStart = i + 1; // 1-based
            braceDepth = (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
            if (braceDepth === 0 && l.includes('{')) {
              // Single-line function or brace on next line — keep scanning
            }
            continue;
          }
          if (inFunc) {
            braceDepth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
            if (braceDepth <= 0 && l.includes('}')) {
              funcEnd = i + 1;
              break;
            }
          }
        }
        // If we found the function, check if any changed line is inside it
        if (funcStart > 0 && funcEnd > 0) {
          if (hunks.some((ln) => ln >= funcStart && ln <= funcEnd)) {
            computeHashMoved = true;
            break;
          }
        } else {
          // Fallback: old regex for definition-line changes (function might be deleted)
          const changedLines = diff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
          if (changedLines.some((l) => /function\s+computeHash|computeHash\s*=\s*(async\s*)?\(|computeHash\s*\(.*\)\s*{/.test(l))) {
            computeHashMoved = true;
            break;
          }
        }
      } catch {
        /* ignore per-file errors */
      }
    }
  }

  const ste = body ? steFindings(body, readGlossary()) : null;
  const { failures, checked } = checkCompliance({ body, files, computeHashMoved, ste });
  if (diffError) failures.push(diffError);
  const status = failures.length ? 'FAIL' : 'PASS';

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, failures, checked }), null, 1)}\n`);
  } else if (failures.length) {
    console.error('pr-compliance: FAIL');
    for (const f of failures) console.error(`  ✕ ${f}`);
  } else {
    console.log(`pr-compliance: ✓ PASS — ${checked.length} check(s) evaluated: ${checked.join(', ')}`);
  }
  return status === 'FAIL' ? 1 : 0;
}

process.exit(main());
