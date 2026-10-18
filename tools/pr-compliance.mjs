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
 *   7. Each Markdown file the PR ADDS passes the writing rules (owner, 2026-10-12: the rules bind new
 *      text, and old text stays as it is). An edit to an old file does not bind the old file.
 *   8. A verdict object quoted in the body was produced on this PR's current code: no file the PR
 *      changes moved between the verdict's `producedBy.commit` and the head.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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
/* The number of named checks `checkCompliance` can evaluate. The verdict's population is read against
   it, so a new check raises this or the verdict reads a negative `excluded` and refuses to validate. */
export const ELIGIBLE_CHECKS = 9;

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
 * Every `tepna.verdict/1` object quoted in a body, in order. A candidate is a balanced `{…}` span that
 * parses as JSON and names the schema; a span that does not parse is skipped, because prose braces
 * are not evidence. Nested objects inside a verdict are consumed with it. PURE.
 *
 * @param {string} body
 * @returns {Array<{gate: string|null, commit: string|null}>}
 */
export function extractVerdicts(body = '') {
  const out = [];
  let i = body.indexOf('{');
  while (i !== -1) {
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = i; j < body.length; j += 1) {
      const c = body[j];
      if (inStr) {
        if (c === '\\') j += 1;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    let obj = null;
    try {
      obj = JSON.parse(body.slice(i, end + 1));
    } catch {
      obj = null;
    }
    if (obj && obj.schema === 'tepna.verdict/1') {
      const commit = obj.producedBy && typeof obj.producedBy.commit === 'string' ? obj.producedBy.commit : null;
      out.push({ gate: typeof obj.gate === 'string' ? obj.gate : null, commit });
      i = body.indexOf('{', end + 1);
    } else {
      i = body.indexOf('{', i + 1);
    }
  }
  return out;
}

/**
 * PURE CORE — every check that does not need git. `computeHashMoved` is passed IN, because deciding
 * it requires reading the diff; everything else is a property of the body and the file list, so a
 * selftest can plant each violation and its control without a repository.
 *
 * @param {{body: string, files: string[]|null, computeHashMoved: boolean, ste: Array<{line:number,rule:string,detail:string}>|null, steChecked: number|null, prStates: Record<string,string>|null, self: string|null, newDocs: Array<{path:string, findings:Array<{line:number,rule:string,detail:string}>}>|null, freshness: Array<{gate: string|null, commit: string|null, state: string, moved?: string[]}>|null}} ctx
 * @returns {{failures: string[], checked: string[]}}
 */
export function checkCompliance({ body = '', files = null, computeHashMoved = false, ste = null, steChecked = null, prStates = null, self = null, newDocs = null, freshness = null }) {
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

  /* 7 · EACH NEW MARKDOWN FILE PASSES THE WRITING RULES. The owner ruled on 2026-10-12 that the rules
     bind new text and that old text stays as it is: 15,649 findings sat in the 767 tracked Markdown
     files that day, 74 % of them in records (DONE briefs, audits, CHANGELOG). So the population is the
     files this PR ADDS, read whole. An edit to an old file is not in it. `newDocs` is resolved by the
     caller from the diff; `null` means it was not resolved, reported as not evaluated. */
  if (newDocs) {
    checked.push('new-doc-writing-rules');
    for (const d of newDocs) {
      if (!d.findings.length) continue;
      const named = d.findings
        .slice(0, 3)
        .map((x) => `line ${x.line} ${x.rule}: ${x.detail}`)
        .join('; ');
      failures.push(`new file ${d.path} fails the writing rules — ${d.findings.length} finding(s) from tools/ste-lint.mjs: ${named}${d.findings.length > 3 ? '; …' : ''}`);
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

  /* 8 · A QUOTED VERDICT IS ABOUT THE CODE THAT MERGES. `freshness` holds one entry per verdict object
     in the body, resolved by the caller against git; `null` means git was not consulted, and the
     check reports itself as not evaluated. A body that quotes no verdict passes with nothing to
     judge. The states:
       fresh       — the verdict's commit is in this PR's history and no PR file moved since it.
       stale       — a non-Markdown file this PR changes moved after the run, so the run did not
                     see the code.
       foreign     — the commit is not in this PR's history (a rebase or a squash dropped it).
       unresolved  — the commit is not in the repository at all.
       no-commit   — the object names no commit, so its age cannot be read.
       base        — the commit is on the base branch: evidence about main, not a claim about
                     this PR. It is excluded and passes.
     WHY, measured 2026-10-12: CI re-runs every check on each push, but a local run quoted in the body
     does not. #3506 quoted a local mutation verdict while its author still had commits to push. */
  if (freshness) {
    checked.push('quoted-verdict-is-fresh');
    for (const f of freshness) {
      const who = `${f.gate || 'a verdict'} at ${f.commit || '(no commit)'}`;
      if (f.state === 'stale')
        failures.push(`${who} is stale — ${f.moved.length} file(s) this PR changes moved after it ran: ${f.moved.slice(0, 5).join(', ')}. Re-run it on the head and quote the new object.`);
      else if (f.state === 'foreign') failures.push(`${who} is not in this PR's history — a rebase or a squash dropped that commit. Re-run it on the head.`);
      else if (f.state === 'unresolved') failures.push(`${who} does not resolve to a commit in this repository.`);
      else if (f.state === 'no-commit') failures.push(`${who} names no producedBy.commit, so this gate cannot tell which code it examined.`);
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
  const clean = checkCompliance({ body: good, files: ['tools/x.mjs', 'changes/2026-10-10-x.md'], ste: [], steChecked: 1, prStates: {}, newDocs: [], freshness: [] });
  ok(clean.failures.length === 0, 'CONTROL: a compliant body and changeset pass');
  ok(clean.checked.length === ELIGIBLE_CHECKS, 'CONTROL: every check was evaluated, so the pass is not a skip');
  /* THE POPULATION BOUND. Twice on 2026-10-12 the verdict's `eligible` stayed one below the checks that
     ran (6 of 7, then 7 of 8 after #3510), so `--json` threw on every full PR context: excluded = -1 fails Verdict.validate. */
  ok(verdictOf({ status: 'PASS', failures: [], checked: clean.checked }).population.excluded === 0, 'a full run validates as a verdict — excluded is 0, never negative');

  /* PLANTED VIOLATION 8 — a quoted verdict older than the code. The plant is #3506's shape: a local
     mutation verdict in the body, then a push that moves a file the PR changes. */
  const vObj = (commit) => JSON.stringify({ schema: 'tepna.verdict/1', gate: 'mutate', status: 'FAIL', producedBy: { tool: 't', commit } });
  const quoted = `${good}\n\n\`\`\`json\n${vObj('22e9f71f')}\n\`\`\``;
  const ex = extractVerdicts(quoted);
  ok(ex.length === 1 && ex[0].commit === '22e9f71f' && ex[0].gate === 'mutate', 'the extractor finds a fenced verdict and reads its commit');
  ok(extractVerdicts(`a {not json} b ${vObj('abc1234')} c {"schema":"other/1"}`).length === 1, 'prose braces and other schemas are not verdicts');
  ok(
    extractVerdicts(JSON.stringify({ schema: 'tepna.verdict/1', gate: 'g', result: { note: 'a } in a string' }, producedBy: { commit: 'abc1234' } })).length === 1,
    'a brace inside a string does not end the object'
  );
  ok(extractVerdicts(`${vObj('aaaaaaa')} and ${vObj('bbbbbbb')}`).length === 2, 'two verdicts are both read');
  ok(extractVerdicts('').length === 0 && extractVerdicts('{ unclosed').length === 0, 'CONTROL: an empty or torn body yields nothing');
  const stale = [{ gate: 'mutate', commit: '22e9f71f', state: 'stale', moved: ['oxydex-dsp.js'] }];
  ok(has(checkCompliance({ body: quoted, files: null, freshness: stale }), 'is stale'), 'a verdict older than a PR file is caught');
  ok(has(checkCompliance({ body: quoted, files: null, freshness: stale }), 'oxydex-dsp.js'), '…and the failure names the file that moved');
  ok(has(checkCompliance({ body: quoted, files: null, freshness: [{ gate: 'g', commit: 'abc1234', state: 'foreign' }] }), 'not in this PR'), 'a verdict on a dropped commit is caught');
  ok(has(checkCompliance({ body: quoted, files: null, freshness: [{ gate: 'g', commit: 'abc1234', state: 'unresolved' }] }), 'does not resolve'), 'a verdict on an unknown commit is caught');
  ok(has(checkCompliance({ body: quoted, files: null, freshness: [{ gate: 'g', commit: null, state: 'no-commit' }] }), 'names no producedBy.commit'), 'a verdict with no commit is caught');
  ok(!checkCompliance({ body: quoted, files: null, freshness: [{ gate: 'g', commit: 'abc1234', state: 'fresh', moved: [] }] }).failures.length, 'CONTROL: a fresh verdict passes');
  ok(
    !checkCompliance({ body: quoted, files: null, freshness: [{ gate: 'g', commit: 'abc1234', state: 'base' }] }).failures.length,
    'CONTROL: a verdict about the base branch is evidence about main and passes'
  );
  ok(!checkCompliance({ body: quoted, files: null }).checked.includes('quoted-verdict-is-fresh'), 'git not consulted ⇒ the check is NOT evaluated, not passed');

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

  // PLANTED VIOLATION 7 — a new Markdown file with a finding.
  const newBad = [{ path: 'briefs/X-2026-10-12-BRIEF.md', findings: [{ line: 4, rule: 'passive', detail: '"was written"' }] }];
  ok(has(checkCompliance({ body: good, files: null, newDocs: newBad }), 'new file briefs/X-2026-10-12-BRIEF.md'), 'a new doc with a finding is caught, by path');
  ok(has(checkCompliance({ body: good, files: null, newDocs: newBad }), 'line 4 passive'), '…and the failure names the line and the rule');
  ok(!checkCompliance({ body: good, files: null, newDocs: [{ path: 'a.md', findings: [] }] }).failures.length, 'CONTROL: a clean new doc passes');
  ok(!checkCompliance({ body: good, files: null, newDocs: [] }).failures.length, 'CONTROL: a PR that adds no doc passes');
  ok(checkCompliance({ body: good, files: null, newDocs: [] }).checked.includes('new-doc-writing-rules'), '…and the check still says it ran');
  ok(!checkCompliance({ body: good, files: null }).checked.includes('new-doc-writing-rules'), 'newDocs not resolved ⇒ NOT evaluated, not passed');
  {
    /* THE LOCAL RUN: a changeset with a 30-word sentence must red `npm run check`, not only CI. */
    const long =
      '---\nbump: patch\n---\n\nThis sentence about the board and the timer and the sandbox and the box goes on and on past the limit that the writing rules set for any description here.\n';
    const files = { 'changes/a.md': long, 'changes/b.md': '---\nbump: patch\n---\n\nThe gate reads the file.\n', 'tools/x.mjs': '' };
    const run = (cmd) => (cmd.startsWith('git rev-parse') ? 'abc' : cmd.includes('...') ? 'changes/a.md\ntools/x.mjs' : cmd.startsWith('git ls-files') ? 'changes/b.md\nchanges/gone.md' : '');
    const read = (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    };
    const docs = localNewDocs(run, read);
    ok(docs.length === 2, 'local: committed and untracked Markdown files are both read, a deleted one is skipped');
    const fails = newDocFailures(docs);
    ok(fails.length === 1 && fails[0].includes('changes/a.md') && fails[0].includes('long-sentence'), 'local: the long changeset sentence fails, by path and rule');
    ok(
      localNewDocs(() => {
        throw new Error('no origin/main');
      }, read) === null,
      'local: no origin/main ⇒ null, NOT_RUN, never a pass'
    );
  }

  /* NO FILE LIST ⇒ THE DIFF CHECKS ARE NOT EVALUATED, and that is visible in `checked` rather than
     being indistinguishable from passing them. */
  const bodyOnly = checkCompliance({ body: good, files: null });
  ok(bodyOnly.checked.length === 2 && !bodyOnly.checked.includes('changeset-for-code-change'), 'without a diff the file checks are reported as NOT evaluated, not as passed');

  /* THE RANGE IS THE PR'S OWN. A throwaway repository: the branch adds `changes/b.md`, then main
     deletes `changes/a.md` the way a release consumes its changesets. Only `b.md` is the PR's. */
  const repo = mkdtempSync(join(tmpdir(), 'pr-compliance-range-'));
  try {
    const g = (c) => execSync(`git -c user.name=t -c user.email=t@t -c commit.gpgsign=false ${c}`, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    g('init -q -b main');
    mkdirSync(join(repo, 'changes'));
    writeFileSync(join(repo, 'changes/a.md'), 'a\n');
    g('add changes/a.md');
    g('commit -q -m base');
    g('checkout -q -b pr');
    writeFileSync(join(repo, 'changes/b.md'), 'b\n');
    g('add changes/b.md');
    g('commit -q -m pr');
    g('checkout -q main');
    g('rm -q changes/a.md');
    g('commit -q -m release');
    const added = (range) => g(`diff --diff-filter=A --name-only ${range}`).split('\n').filter(Boolean);
    ok(added(prRange('main', 'pr')).join() === 'changes/b.md', 'a branch cut before a release adds only its own file');
    ok(added('main..pr').includes('changes/a.md'), 'CONTROL: two dots read the deleted changeset as a new file');
  } catch (e) {
    ok(false, `the range fixture ran: ${e.message}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  const line = fail.length ? `pr-compliance selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, failures, checked, reason }) {
  const v = Verdict.make({
    gate: 'pr-compliance',
    status,
    population: { checked: checked.length, eligible: ELIGIBLE_CHECKS, excluded: ELIGIBLE_CHECKS - checked.length },
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

/** The PR's own change set: from the merge base of `base` and `head` to `head` (three dots). */
export const prRange = (base, head) => `${base}...${head}`;

/** The failures check 7 reports for a list of `{path, findings}` — the same words the PR run uses. */
export function newDocFailures(docs) {
  const out = [];
  for (const d of docs) {
    if (!d.findings.length) continue;
    const named = d.findings
      .slice(0, 3)
      .map((x) => `line ${x.line} ${x.rule}`)
      .join(', ');
    out.push(`new file ${d.path} fails the writing rules — ${d.findings.length} finding(s) from tools/ste-lint.mjs: ${named}${d.findings.length > 3 ? '; …' : ''}`);
  }
  return out;
}

/** The Markdown files a LOCAL branch adds against origin/main: committed (three dots), staged or
    unstaged, and untracked. Read from the working tree, which is what the next commit carries.
    `null` when origin/main is not there to diff against. */
export function localNewDocs(run = sh, read = (p) => readFileSync(p, 'utf-8')) {
  let paths;
  try {
    run('git rev-parse --verify --quiet origin/main');
    paths = [
      ...run(`git diff --diff-filter=A --name-only ${prRange('origin/main', 'HEAD')}`).split('\n'),
      ...run('git diff --diff-filter=A --name-only HEAD').split('\n'),
      ...run('git diff --cached --diff-filter=A --name-only').split('\n'),
      ...run('git ls-files --others --exclude-standard').split('\n')
    ];
  } catch {
    return null;
  }
  const glossary = readGlossary();
  const out = [];
  for (const path of [...new Set(paths.filter((f) => f.endsWith('.md')))]) {
    let text;
    try {
      text = read(path);
    } catch {
      continue; // added on the branch, then deleted in the tree: the next commit does not carry it
    }
    out.push({ path, findings: steFindings(text, glossary) });
  }
  return out;
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
    /* NO PR CONTEXT IS A LOCAL RUN (`npm run check`). The body checks have nothing to read, but
       check 7 does: the Markdown files this branch adds, against `origin/main`. Before this, the local
       gate skipped the whole tool, so a changeset with a long sentence passed `npm run check` and
       went red in CI. Measured 2026-10-17: #3607, #3608 and #3611 each failed CI on exactly that. */
    const local = localNewDocs();
    if (local) {
      const failures = newDocFailures(local);
      const status = failures.length ? 'FAIL' : 'PASS';
      if (asJson) process.stdout.write(`${JSON.stringify(verdictOf({ status, failures, checked: ['new-doc-writing-rules'], reason: failures.length ? failures.join('; ') : null }), null, 1)}\n`);
      else {
        console.log(`pr-compliance (local): ${status} — ${local.length} new Markdown file(s) against origin/main; the body checks run on the PR`);
        for (const f of failures) console.log(`  ✕ ${f}`);
      }
      return failures.length ? 1 : 0;
    }
    if (asJson)
      process.stdout.write(
        `${JSON.stringify(verdictOf({ status: 'NOT_RUN', failures: [], checked: [], reason: 'no PR context and no origin/main to diff against — nothing was examined' }), null, 1)}\n`
      );
    else console.log('pr-compliance: no PR context and no origin/main — skip');
    return 0;
  }

  /* THREE DOTS: the diff runs from the merge base, so it holds only what the PR changed. Two dots
     compared base and head as trees, and a branch cut before a release then showed every changeset
     the release deleted as a file the PR added. Measured 2026-10-12 on #3540 after v2.19.0: 90
     deleted changesets read as new, and the check reported 50 findings against text the PR never
     touched. */
  let files = null;
  let diffError = null;
  if (base) {
    try {
      files = sh(`git diff --name-only ${prRange(base, head)}`)
        .split('\n')
        .filter(Boolean);
    } catch {
      diffError = `cannot diff ${prRange(base, head)}`;
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
        const diff = sh(`git diff ${prRange(base, head)} -U0 -- ${f}`);
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

  /* CHECK 7's POPULATION: the Markdown files this PR ADDS (`--diff-filter=A`, so a rename or an edit
     of an old file is not in it), each read whole at the head. */
  let newDocs = null;
  if (base && files) {
    try {
      const glossary = readGlossary();
      newDocs = sh(`git diff --diff-filter=A --name-only ${prRange(base, head)}`)
        .split('\n')
        .filter((f) => f.endsWith('.md'))
        .map((path) => ({ path, findings: steFindings(sh(`git show ${head}:"${path}"`), glossary) }));
    } catch {
      newDocs = null;
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

  /* CHECK 8's POPULATION. Each quoted verdict's commit is placed against the base and the head, then
     the files that moved after it are read and intersected with the PR's own file list. A merge from
     main moves main's files, not the PR's, so Kodiak's base update does not stale a verdict. A
     Markdown file is not code: a changeset or a brief written after the run does not stale it. Without
     a diff there is no file list and the check is not evaluated. */
  let freshness = null;
  if (files && base) {
    freshness = [];
    const mine = new Set(files);
    for (const v of extractVerdicts(body)) {
      if (!v.commit) {
        freshness.push({ ...v, state: 'no-commit' });
        continue;
      }
      if (!/^[0-9a-f]{7,40}$/i.test(v.commit)) {
        freshness.push({ ...v, state: 'unresolved' });
        continue;
      }
      let full = null;
      try {
        full = sh(`git rev-parse --verify -q ${v.commit}^{commit}`);
      } catch {
        full = null;
      }
      if (!full) {
        freshness.push({ ...v, state: 'unresolved' });
        continue;
      }
      const isAnc = (a, b) => {
        try {
          execSync(`git merge-base --is-ancestor ${a} ${b}`, { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      };
      if (isAnc(full, base)) {
        freshness.push({ ...v, state: 'base' });
        continue;
      }
      if (!isAnc(full, head)) {
        freshness.push({ ...v, state: 'foreign' });
        continue;
      }
      const moved = sh(`git diff --name-only ${full}..${head}`)
        .split('\n')
        .filter((f) => f && mine.has(f) && !f.endsWith('.md'));
      freshness.push({ ...v, state: moved.length ? 'stale' : 'fresh', moved });
    }
  }

  const { failures, checked } = checkCompliance({ body, files, computeHashMoved, ste, steChecked, prStates, self: process.env.PR_NUMBER || null, newDocs, freshness });
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
