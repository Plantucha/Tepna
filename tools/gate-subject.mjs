#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * gate-subject.mjs — print WHAT the gate is about to examine, before it examines it.
 *
 * WHY. `npm run check` reads the WORKING TREE. A PR carries HEAD. **No gate in this
 * repo names which one it looked at**, and the two diverge silently. Measured
 * 2026-09-02: a full 14-stage `npm run check`, a 15-minute `verify-fixtures` lap and
 * a mutation plant all ran green — and HEAD was still a `main` commit with 15 files
 * uncommitted. Every result was true. None of them was about the commit.
 *
 * This is the same shape as the guard that measured `$CLAUDE_PROJECT_DIR` instead of
 * the worktree being edited (STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18):
 * a mechanism reporting confidently about a subject nobody stated.
 *
 * ⚠ IT IS A REPORTER, NOT A GATE, AND THAT IS DELIBERATE — IT ALWAYS EXITS 0.
 * A dirty tree mid-work is the NORMAL state; you are supposed to gate, then commit.
 * Denying on it would fire on almost every legitimate run, and a guard that cries
 * wolf gets switched off within a day (the reasoning `guard-format.sh` records for
 * its own fail-open). The injury here is also self-revealing — git says
 * "Everything up-to-date" when you push nothing — so the value is naming the subject
 * at the moment it is true, not blocking.
 *
 * A fourth `PreToolUse` guard on `git push` was designed and DROPPED for those two
 * reasons plus a third: it would need a `.claude/settings.json` change, which alters
 * what every session in the fleet gets denied. A restriction cannot grant anyone new
 * powers, so it was not an escalation concern — the payoff simply did not justify
 * touching shared config.
 *
 * Usage:
 *   node tools/gate-subject.mjs        # print the subject line (always exit 0)
 *   node tools/gate-subject.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';

/** Pure core: everything decidable from git's own output, so it is testable without a repo state. */
export function describeSubject({ head, branch, porcelain }) {
  const lines = String(porcelain || '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const untracked = lines.filter((l) => l.trimStart().startsWith('??'));
  /* Tracked = anything git is already following: modified, added, deleted, renamed.
     These are the dangerous ones — they exist in HEAD in a DIFFERENT form, so a green
     gate describes content the commit does not carry. */
  const tracked = lines.filter((l) => !l.trimStart().startsWith('??'));
  const clean = lines.length === 0;
  /* ⚠ PARSE THE PATH DEFENSIVELY. Porcelain is COLUMNAR — `XY path`, so the path begins
     at index 3 — and the first draft of this tool fed it through a `.trim()`ing git
     helper, which ate the leading space of ` M package.json` and rendered every
     filename one character short (`ackage.json`). The pure core below was correct and
     its selftest passed; the defect was in the GLUE that called it, which is the half a
     unit test of a pure function structurally cannot see. Both shapes are accepted now,
     and a case below pins the stripped one. */
  const pathOf = (l) => {
    if (l[2] === ' ') return l.slice(3); // ' M path' | 'M  path' | '?? path' — the real shape
    if (l[1] === ' ') return l.slice(2); // 'M path'  — a leading space was stripped upstream
    return l.slice(3);
  };
  return {
    head,
    branch,
    clean,
    trackedCount: tracked.length,
    untrackedCount: untracked.length,
    tracked: tracked.map(pathOf),
    /* The claim a reader is entitled to make from a green run. */
    verdictScope: clean ? 'commit' : 'working tree'
  };
}

export function formatSubject(s) {
  const at = `HEAD ${s.head}${s.branch ? ` (${s.branch})` : ''}`;
  if (s.clean) {
    return [`  gate subject: ${at} — working tree clean, so a green result describes THE COMMIT.`];
  }
  const out = [
    `  gate subject: ${at} + ${s.trackedCount} uncommitted tracked change(s)` + (s.untrackedCount ? `, ${s.untrackedCount} untracked` : ''),
    `  ⚠ this gate reads the WORKING TREE. A green result describes the tree, NOT the commit.`
  ];
  if (s.trackedCount > 0) {
    out.push(`    tracked and uncommitted (these differ from what a PR would carry):`);
    for (const f of s.tracked.slice(0, 12)) out.push(`      ${f}`);
    if (s.tracked.length > 12) out.push(`      … and ${s.tracked.length - 12} more`);
  }
  return out;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Like `git`, but NEVER trims — porcelain is columnar and a leading space is DATA, not whitespace. */
function gitRaw(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).replace(/\n$/, '');
  } catch {
    return '';
  }
}

function selfTest() {
  const cases = [
    {
      name: 'clean tree — the verdict is about the commit',
      in: { head: 'abc1234', branch: 'main', porcelain: '' },
      want: { clean: true, trackedCount: 0, untrackedCount: 0, verdictScope: 'commit' }
    },
    {
      name: 'the measured 2026-09-02 failure — tracked edits, nothing committed',
      in: { head: 'abc1234', branch: 'main', porcelain: ' M a.js\n M b.js\nA  c.js' },
      want: { clean: false, trackedCount: 3, untrackedCount: 0, verdictScope: 'working tree' }
    },
    {
      name: 'untracked files count too — the gate reads them, the commit does not carry them',
      in: { head: 'abc1234', branch: 'x', porcelain: '?? new-test.js' },
      want: { clean: false, trackedCount: 0, untrackedCount: 1, verdictScope: 'working tree' }
    },
    {
      name: 'a DELETION is tracked, not untracked (it changes what the tree holds)',
      in: { head: 'abc1234', branch: 'x', porcelain: ' D gone.js' },
      want: { clean: false, trackedCount: 1, untrackedCount: 0, verdictScope: 'working tree' }
    },
    {
      /* THE GLUE BUG, PINNED. The first draft trimmed git's output, so ' M package.json'
         arrived as 'M package.json' and every path lost its first character. The core was
         green throughout — only a case carrying the malformed shape can catch it. */
      name: 'a path survives even if a leading space was stripped upstream',
      in: { head: 'a', branch: 'b', porcelain: 'M package.json' },
      want: { clean: false, trackedCount: 1, verdictScope: 'working tree' },
      wantPath: 'package.json'
    },
    {
      name: 'and the normal columnar shape still parses',
      in: { head: 'a', branch: 'b', porcelain: ' M package.json' },
      want: { clean: false, trackedCount: 1 },
      wantPath: 'package.json'
    }
  ];
  let fail = 0;
  for (const c of cases) {
    const got = describeSubject(c.in);
    const bad = Object.keys(c.want).filter((k) => got[k] !== c.want[k]);
    if (c.wantPath && got.tracked[0] !== c.wantPath) {
      bad.push(`tracked[0] (got ${JSON.stringify(got.tracked[0])}, want ${JSON.stringify(c.wantPath)})`);
    }
    if (bad.length) {
      fail++;
      console.log(`  ✗ ${c.name}`);
      for (const k of bad) console.log(`      ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(c.want[k])}`);
    } else {
      console.log(`  ✓ ${c.name}`);
    }
  }
  /* ANTI-VACUITY: the formatter must actually SAY the warning, or the tool reports a
     subject nobody can read — which would be this tool committing its own defect. */
  const dirty = formatSubject(describeSubject({ head: 'a', branch: 'b', porcelain: ' M x.js' })).join('\n');
  if (!/WORKING TREE/.test(dirty) || !/NOT the commit/.test(dirty)) {
    fail++;
    console.log('  ✗ the dirty-tree output states the scope caveat');
  } else {
    console.log('  ✓ the dirty-tree output states the scope caveat');
  }
  const cleanOut = formatSubject(describeSubject({ head: 'a', branch: 'b', porcelain: '' })).join('\n');
  if (!/THE COMMIT/.test(cleanOut)) {
    fail++;
    console.log('  ✗ the clean-tree output claims commit scope');
  } else {
    console.log('  ✓ the clean-tree output claims commit scope');
  }
  console.log(fail ? `\ngate-subject selftest: ${fail} FAILED` : '\ngate-subject selftest: all passed');
  return fail ? 1 : 0;
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest') || argv.includes('--self-test')) {
  process.exit(selfTest());
}

const subject = describeSubject({
  head: git(['rev-parse', '--short', 'HEAD']) || '(unknown)',
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  porcelain: gitRaw(['status', '--porcelain'])
});
for (const l of formatSubject(subject)) console.log(l);
/* Always 0 — see the header. This names the subject; it does not judge it. */
process.exit(0);
