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
 *   5. The body passes the writing rules (tools/ste-lint.mjs, strict) — owner, 2026-10-12 — AND the
 *      rules examined at least one line of it.
 *   6. No GitHub closing keyword in the body sits next to a PR number that is still OPEN.
 *
 * WHY 6 EXISTS, measured. `.kodiak.toml` sets `[merge.message] body = "pull_request_body"`, so the
 * PR body BECOMES the squash commit message on main — and GitHub acts on closing keywords in a
 * commit message pushed to the default branch. On 2026-10-12 #3480's body said `fixed #3476` inside
 * backticks; #3480 merged at 16:18:16Z, and the timeline of #3476 records `closed by kodiakhq[bot]`
 * at 16:18:22Z against the squash commit 0fca5c6e, six seconds later. The owner reopened it by hand
 * at 17:11:49Z. Backticks do not protect: the squash message is plain text. The remedy is a wording
 * one — "the #3476 closure" rather than "fixed #3476" — so this check quotes the line it refuses.
 *
 * In CI (pull_request event), the workflow passes:
 *   PR_BODY, PR_BASE_SHA, PR_HEAD_SHA, PR_NUMBER via env, and GH_TOKEN for check 6's lookups.
 * On push/main or workflow_dispatch without a PR, exits 0 (nothing to check).
 *
 * Local use:
 *   PR_BODY="$(cat body.md)" PR_BASE_SHA=main PR_HEAD_SHA=HEAD node tools/pr-compliance.mjs
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings as steFindings, readGlossary, scan as steScan } from './ste-lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const RULE0_RE = /^Rule 0:/m;
const TRAILER_RE = /^Fleet-Session:\s*.+/m;
const CORPUS_SENTENCE = 'computeHash moved — re-verification on the corpus owed before merge (tools/verify-fixtures.mjs on the rig)';
// Code files: sources, not bundles, not docs. Bundles are verified by build.mjs --check.
// .src.html files are sources (they generate the bundles); *.html bundles are not.
const CODE_RE = /\.(mjs|js|py|sh|src\.html)$/;
const BUNDLE_RE = /(^|\/)[A-Z][A-Za-z]*\.html$/;

/* GitHub's nine closing keywords, then optional colon, whitespace, and a reference: a bare `#N`, a
   cross-repo `owner/repo#N`, or a full pull/issues URL. All three forms close on merge. The keyword
   must be followed by WHITESPACE — `fixed` with a backtick or any other character between it and the
   `#` does not trigger GitHub, and does not trigger this check either. */
const CLOSING_CITATION_RE = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)|(?:[\w.-]+\/[\w.-]+)?#(\d+))/gi;

/**
 * Every closing-keyword citation in a body, with the line that carries it. PURE: it decides where a
 * phrase sits, never whether the target is open — that needs the network and is resolved by the
 * caller, like `computeHashMoved`.
 *
 * @param {string} body
 * @returns {Array<{line: number, number: string, keyword: string, text: string}>}
 */
export function citedClosures(body = '') {
  const out = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    CLOSING_CITATION_RE.lastIndex = 0;
    let m = CLOSING_CITATION_RE.exec(line);
    while (m) {
      out.push({ line: i + 1, number: m[2] || m[3], keyword: m[1], text: line.trim().slice(0, 160) });
      m = CLOSING_CITATION_RE.exec(line);
    }
  }
  return out;
}

/**
 * PURE CORE — every check that does not need git. `computeHashMoved` is passed IN, because deciding
 * it requires reading the diff; everything else is a property of the body and the file list, so a
 * selftest can plant each violation and its control without a repository.
 *
 * @param {{body: string, files: string[]|null, computeHashMoved: boolean, ste: Array<{line:number,rule:string,detail:string}>|null, steChecked: number|null, prStates: Record<string,string>|null, self: string|null}} ctx
 * @returns {{failures: string[], checked: string[]}}
 */
export function checkCompliance({ body = '', files = null, computeHashMoved = false, ste = null, steChecked = null, prStates = null, self = null }) {
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
    /* …AND THE POPULATION, because an empty finding list has two causes and this check could not
       tell them apart. The linter reads no table cell, no quote, no heading and no form line
       (tools/ste-lint.mjs §scan), so a body that puts its prose in a table scores 0 findings over 0
       lines and passed here as clean. The case is not hypothetical: #3480's body is 28 non-blank
       lines, 24 of them excluded, and check 6 exists because the `fixed #3476` that closed an open
       PR sat in one of those cells. `steChecked` is the examined count from the same scan, resolved
       by the caller like `ste` itself; `null` means it was not measured, reported as not evaluated.
       The refusal fires ONLY on a body that HAS lines and had none of them read — an empty body is
       check 1's business, and a body of four prose lines is examined, however much else it holds. */
    if (steChecked !== null) {
      checked.push('ste-population');
      if (steChecked === 0 && body.split('\n').some((l) => l.trim())) {
        failures.push(
          'the writing rules examined 0 lines of this body — prose in a table cell, a quote or a code fence is not read (tools/ste-lint.mjs §scan), so 0 findings here means nothing was checked. Move the prose out of the table.'
        );
      }
    }
  }

  /* 6 · A CLOSING KEYWORD NEXT TO AN OPEN PR NUMBER. `prStates` maps each cited number to its state
     and is resolved by the caller, so `null` means the lookup did not run and the check reports
     itself as not evaluated rather than as passed. A number this PR cannot resolve is a FAILURE and
     not a pass: the cheap remedy is to reword the phrase, and a citation of a number that resolves
     to nothing is wrong on its own terms. A resolver that is wholly unavailable degrades to `null`,
     because redding every PR in the repo over one network fault is the worse failure. */
  if (prStates) {
    checked.push('no-closing-keyword-on-an-open-pr');
    for (const c of citedClosures(body)) {
      /* A body closing ITSELF is exempt. Merging closes the PR anyway, and the residue-row rule
         prescribes exactly that phrasing for a row whose whole life is this PR. */
      if (self && c.number === String(self)) continue;
      const st = prStates[c.number];
      if (st === 'OPEN') {
        failures.push(`line ${c.line} would close the still-open #${c.number} on merge — Kodiak squashes the body into the commit message. Reword as "the #${c.number} closure": "${c.text}"`);
      } else if (!st || st === 'UNKNOWN') {
        failures.push(`line ${c.line} cites #${c.number} after the closing keyword "${c.keyword}", and that number does not resolve — reword so no keyword sits next to it: "${c.text}"`);
      }
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
  const clean = checkCompliance({ body: good, files: ['tools/x.mjs', 'changes/2026-10-10-x.md'], ste: [], steChecked: 1, prStates: {} });
  ok(clean.failures.length === 0, 'CONTROL: a compliant body and changeset pass');
  ok(clean.checked.length === 7, 'CONTROL: all seven checks were evaluated, so the pass is not a skip');

  // PLANTED VIOLATION 5 — the body fails the writing rules (owner, 2026-10-12: the linter bites).
  const passive = [{ line: 3, rule: 'passive', detail: '"was measured"' }];
  ok(has(checkCompliance({ body: good, files: null, ste: passive }), 'writing rules'), 'a writing-rules finding is caught');
  ok(has(checkCompliance({ body: good, files: null, ste: passive }), 'line 3 passive'), '…and the failure names the line and the rule');
  ok(!has(checkCompliance({ body: good, files: null, ste: [] }), 'writing rules'), 'CONTROL: no finding, no failure');
  ok(!checkCompliance({ body: good, files: null, ste: null }).checked.includes('ste-writing-rules'), 'lint not run ⇒ the check is reported as NOT evaluated, not as passed');

  /* PLANTED VIOLATION 5b — THE BODY THE RULES NEVER READ. An empty finding list had two causes and
     this check read both as clean. The planted body is #3480's shape: a Rule 0 line, a heading, a
     table carrying the prose, and the trailer. Every one of those lines is skipped by form
     (tools/ste-lint.mjs §scan), so the linter returns no finding from no line. The real #3480 body
     measured `checked: 4, excluded: 24` — four prose lines out of twenty-eight — and this planted
     one takes the limit case, where nothing at all is examined. */
  const tabled = [
    'Rule 0: `doc-search "x"` → a.md',
    '',
    '## 1 · What moved',
    '',
    '| key | why it closes |',
    '|---|---|',
    '| `2026-10-12-a-row` | The tag list is now single-sourced, and the sidecar is box-wide. |',
    '',
    'Fleet-Session: Magpie'
  ].join('\n');
  const tabledChecked = steScan(tabled).checked;
  ok(tabledChecked === 0, 'the planted body really is unread — the linter examines 0 of its lines');
  ok(steFindings(tabled, readGlossary()).length === 0, '…and it therefore reports 0 findings, which is the trap');
  ok(has(checkCompliance({ body: tabled, files: null, ste: [], steChecked: tabledChecked }), 'examined 0 lines'), 'a body the rules never read is caught');
  ok(has(checkCompliance({ body: tabled, files: null, ste: [], steChecked: 0 }), 'table cell'), '…and the failure names where the prose is hiding');
  ok(!has(checkCompliance({ body: good, files: null, ste: [], steChecked: 1 }), 'examined 0 lines'), 'CONTROL: one examined line is enough — the check is about zero, not about coverage');
  ok(!checkCompliance({ body: good, files: null, ste: [], steChecked: null }).checked.includes('ste-population'), 'population not measured ⇒ NOT evaluated, not passed');
  ok(!has(checkCompliance({ body: '', files: null, ste: [], steChecked: 0 }), 'examined 0 lines'), "CONTROL: an EMPTY body is check 1's business, not this one");
  ok(!has(checkCompliance({ body: '\n  \n', files: null, ste: [], steChecked: 0 }), 'examined 0 lines'), 'CONTROL: a whitespace-only body is not a hidden-prose body either');
  /* The real #3480 body is 42 lines and is not pasted here. The shape above reproduces its defect;
     the measured numbers for the merged body live in the changeset and in the residue row
     `2026-10-12-ste-lint-skips-table-cells`. */
  // …and the import is LIVE: the real linter over a planted passive sentence, with the real glossary.
  const live = steFindings(`${good}\n\nThe value was measured by the tool.`, readGlossary());
  ok(
    live.some((x) => x.rule === 'passive'),
    'the real linter reports the planted passive sentence'
  );
  ok(steFindings(good, readGlossary()).length === 0, 'CONTROL: the compliant body has no finding');

  /* PLANTED VIOLATION 6 — a closing keyword next to an OPEN number. The planted body is the real
     one: #3480 said `fixed #3476` in a table cell and the squash closed #3476 six seconds after it
     merged. The backticks are kept in the fixture on purpose, because they did not help. */
  const closer = `${good}\n\n| row | state |\n|---|---|\n| a-row | \`fixed #3476\` |`;
  const openTarget = { 3476: 'OPEN' };
  ok(has(checkCompliance({ body: closer, files: null, prStates: openTarget }), 'still-open #3476'), 'a closing keyword next to an open PR number is caught');
  ok(has(checkCompliance({ body: closer, files: null, prStates: openTarget }), 'line 9'), '…and the failure names the line');
  ok(has(checkCompliance({ body: closer, files: null, prStates: openTarget }), 'the #3476 closure'), '…and it gives the wording that fixes it');
  // CONTROLS. A merged or closed target is harmless; so is the wording this gate asks for.
  ok(!checkCompliance({ body: closer, files: null, prStates: { 3476: 'MERGED' } }).failures.length, 'CONTROL: a MERGED target passes');
  ok(!checkCompliance({ body: closer, files: null, prStates: { 3476: 'CLOSED' } }).failures.length, 'CONTROL: an already-closed target passes');
  ok(!checkCompliance({ body: `${good}\n\nthe #3476 closure landed`, files: null, prStates: openTarget }).failures.length, 'CONTROL: "the #N closure" is the accepted wording');
  ok(!checkCompliance({ body: `${good}\n\nthis fixed the defect`, files: null, prStates: openTarget }).failures.length, 'CONTROL: a keyword with no number is not a citation');
  ok(!checkCompliance({ body: `${good}\n\nsee #3476 for the rest`, files: null, prStates: openTarget }).failures.length, 'CONTROL: a number with no keyword is not a citation');
  ok(!checkCompliance({ body: `${good}\n\nthe fixed-point of #3476`, files: null, prStates: openTarget }).failures.length, 'CONTROL: a hyphenated word is not the keyword');
  // SELF-CITATION is exempt — merging closes the PR anyway, and the residue-row rule prescribes it.
  ok(!checkCompliance({ body: closer, files: null, prStates: openTarget, self: '3476' }).failures.length, 'CONTROL: a body closing ITSELF is exempt');
  ok(has(checkCompliance({ body: closer, files: null, prStates: openTarget, self: '3999' }), 'still-open'), '…and the exemption is for its own number only');
  // AN UNRESOLVED number fails, because the remedy is a reword and the citation is wrong anyway.
  ok(has(checkCompliance({ body: closer, files: null, prStates: { 9999: 'MERGED' } }), 'does not resolve'), 'a cited number that does not resolve is caught');
  ok(has(checkCompliance({ body: closer, files: null, prStates: { 3476: 'UNKNOWN' } }), 'does not resolve'), 'an UNKNOWN state is caught, not read as a pass');
  // NO RESOLVER ⇒ the check is reported as not evaluated. Fail-open on absence is deliberate: see
  // the comment on the check. The verdict's population makes the skip visible.
  ok(!checkCompliance({ body: closer, files: null }).checked.includes('no-closing-keyword-on-an-open-pr'), 'no resolver ⇒ the check is NOT evaluated, not passed');
  ok(!checkCompliance({ body: closer, files: null }).failures.length, '…and it does not fail either');
  // THE THREE REFERENCE FORMS GitHub acts on, all caught by the extractor.
  ok(citedClosures('closes owner/repo#12').length === 1, 'the cross-repo form owner/repo#N is a citation');
  ok(citedClosures('resolved https://github.com/Plantucha/Tepna/pull/12')[0].number === '12', 'the full URL form is a citation');
  ok(citedClosures('Fixes: #12')[0].number === '12', 'a colon after the keyword is still a citation');
  ok(citedClosures('fixed #1 and closes #2').length === 2, 'two citations on one line are both reported');
  ok(citedClosures('').length === 0, 'CONTROL: an empty body cites nothing');

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
    population: { checked: checked.length, eligible: 6, excluded: 6 - checked.length },
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
  const steChecked = body ? steScan(body).checked : null;

  /* CHECK 6's POPULATION, resolved here because it needs the network. One `gh api` call per distinct
     cited number, and the numbers come from the body, so the usual count is nought to three. The
     issues endpoint answers for a PR as well as an issue, which is what this needs: `open` is the
     only state that matters, and a merged PR reads `closed` there.
       A 404 is the number's own problem and becomes UNKNOWN, which the core refuses. Anything else —
     no `gh`, no token, a rate limit — means the RESOLVER is unavailable, so the whole map goes to
     `null` and the core reports the check as not evaluated. One network fault must not red every PR
     in the repo; the verdict's population shows the skip. */
  const cited = citedClosures(body);
  let prStates = {};
  let resolverNote = null;
  for (const n of [...new Set(cited.map((c) => c.number))]) {
    try {
      prStates[n] = sh(`gh api repos/{owner}/{repo}/issues/${n} --jq .state`).toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED';
    } catch (e) {
      const msg = String(e?.stderr || e?.message || '').split('\n')[0];
      if (/404|Not Found/i.test(msg)) {
        prStates[n] = 'UNKNOWN';
      } else {
        prStates = null;
        resolverNote = `check 6 not evaluated — cannot resolve cited PR numbers: ${msg.slice(0, 140)}`;
        break;
      }
    }
  }

  const { failures, checked } = checkCompliance({ body, files, computeHashMoved, ste, steChecked, prStates, self: process.env.PR_NUMBER || null });
  if (diffError) failures.push(diffError);
  const status = failures.length ? 'FAIL' : 'PASS';

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, failures, checked }), null, 1)}\n`);
  } else if (failures.length) {
    if (resolverNote) console.error(`pr-compliance: ${resolverNote}`);
    console.error('pr-compliance: FAIL');
    for (const f of failures) console.error(`  ✕ ${f}`);
  } else {
    if (resolverNote) console.error(`pr-compliance: ${resolverNote}`);
    console.log(`pr-compliance: ✓ PASS — ${checked.length} check(s) evaluated: ${checked.join(', ')}`);
  }
  return status === 'FAIL' ? 1 : 0;
}

process.exit(main());
