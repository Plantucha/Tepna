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
 *
 * In CI (pull_request event), the workflow passes:
 *   PR_BODY, PR_BASE_SHA, PR_HEAD_SHA via env.
 * On push/main or workflow_dispatch without a PR, exits 0 (nothing to check).
 *
 * Local use:
 *   PR_BODY="$(cat body.md)" PR_BASE_SHA=main PR_HEAD_SHA=HEAD node tools/pr-compliance.mjs
 */

import { execSync } from 'node:child_process';

const RULE0_RE = /^Rule 0:/m;
const TRAILER_RE = /^Fleet-Session:\s*.+/m;
const CORPUS_SENTENCE = 'computeHash moved — re-verification on the corpus owed before merge (tools/verify-fixtures.mjs on the rig)';
// Code files: sources, not bundles, not docs. Bundles are verified by build.mjs --check.
const CODE_RE = /\.(mjs|js|py|sh)$/;
const BUNDLE_RE = /(^|\/)[A-Z][A-Za-z]*\.html$/;

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  const body = process.env.PR_BODY || '';
  const base = process.env.PR_BASE_SHA;
  const head = process.env.PR_HEAD_SHA || 'HEAD';

  if (!body && !base) {
    console.log('pr-compliance: no PR context (not a pull_request event) — skip');
    return 0;
  }

  const failures = [];

  // 1. Rule 0 line first
  if (!RULE0_RE.test(body)) {
    failures.push('body does not start with a "Rule 0:" evidence line');
  }

  // 2. Fleet-Session trailer
  if (!TRAILER_RE.test(body)) {
    failures.push('body is missing the "Fleet-Session:" trailer');
  }

  // 3 & 4 need the diff
  if (base) {
    let files = [];
    try {
      files = sh(`git diff --name-only ${base}..${head}`).split('\n').filter(Boolean);
    } catch {
      failures.push(`cannot diff ${base}..${head}`);
    }

    // 3. computeHash movers need the corpus sentence
    let computeHashMoved = false;
    for (const f of files) {
      if (!CODE_RE.test(f) || BUNDLE_RE.test(f)) continue;
      try {
        const diff = sh(`git diff ${base}..${head} -- ${f}`);
        if (/computeHash/.test(diff)) {
          computeHashMoved = true;
          break;
        }
      } catch {
        /* ignore per-file errors */
      }
    }
    if (computeHashMoved && !body.includes(CORPUS_SENTENCE)) {
      failures.push('computeHash moved but body lacks the verbatim corpus re-verification sentence');
    }

    // 4. code changes need a changeset
    const codeChanged = files.some((f) => CODE_RE.test(f) && !BUNDLE_RE.test(f) && !f.startsWith('changes/'));
    const changesetAdded = files.some((f) => f.startsWith('changes/') && f.endsWith('.md'));
    if (codeChanged && !changesetAdded) {
      failures.push('code files changed but no changes/ changeset was added');
    }
  }

  if (failures.length) {
    console.error('pr-compliance: FAIL');
    for (const f of failures) console.error('  ✕ ' + f);
    return 1;
  }
  console.log('pr-compliance: ✓ body and changeset compliant');
  return 0;
}

process.exit(main());
