/*
 * wt-done.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLOSE THE WORKTREE LOOP. `git worktree add` is cheap and correct, and the REMOVAL is the half that
 * gets skipped — the PR merging feels like the end of the work-unit, and it is not. Measured
 * 2026-08-18: 329 worktrees registered, 0 prunable (every registration had a live directory), ~288
 * siblings at the volume root ≈ 55–60 GB on a drive at 90 %. Every one of them is that gap, accumulated.
 *
 * The tool verifies the two facts a removal must rest on, FROM THE AUTHORITATIVE SOURCES, then removes:
 *   1. the branch's PR is MERGED — read from GitHub via `gh`, never from memory or `git branch --merged`
 *      (squash-merge strands the branch: after `gh pr merge` the branch never appears merged to git —
 *      see the 12-commits-stranded incident). No PR, or PR still open ⇒ REFUSE.
 *   2. the tree is CLEAN — `git status --porcelain` empty. Dirty ⇒ REFUSE and say what is dirty;
 *      per CLAUDE.md §👥.2 those files may be someone's only copy.
 * Removal is `git worktree remove` WITHOUT --force, so git's own guard stays the last line: if git
 * refuses after both checks passed, something raced us — stop, do not escalate to --force.
 *
 * Usage:
 *   node tools/wt-done.mjs --list            # read-only: every worktree, branch, PR state, dirty count
 *   node tools/wt-done.mjs <path> [...]      # verify + remove each named worktree
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

export function parseWorktrees(porcelain) {
  /* `git worktree list --porcelain` → [{path, branch}] — branch null for detached/bare. */
  const out = [];
  let cur = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice(9), branch: null };
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function verdict({ prState, dirtyCount, isMain }) {
  /* Pure decision core, so the refusals are testable without a repo. */
  if (isMain) return { ok: false, why: 'holds main/master — never remove the primary checkout' };
  if (dirtyCount > 0) return { ok: false, why: `${dirtyCount} dirty/untracked path(s) — may be someone's only copy` };
  if (prState === null) return { ok: false, why: 'no PR found for branch — cannot prove the work landed' };
  if (prState !== 'MERGED') return { ok: false, why: `PR is ${prState}, not MERGED` };
  return { ok: true, why: 'PR merged + tree clean' };
}

function prStateFor(branch) {
  if (!branch) return null;
  try {
    const js = JSON.parse(run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state', '--limit', '1']));
    return js.length ? js[0].state : null;
  } catch {
    return null; // gh unavailable / offline reads as "cannot prove" → refuse, never as "merged"
  }
}

function dirtyCountFor(wtPath) {
  return run('git', ['-C', wtPath, 'status', '--porcelain']).split('\n').filter(Boolean).length;
}

function main(argv) {
  const wts = parseWorktrees(run('git', ['worktree', 'list', '--porcelain']));
  if (argv.includes('--list')) {
    console.log(`DENOMINATOR: ${wts.length} worktree(s) registered`);
    for (const w of wts) {
      const dirty = existsSync(w.path) ? dirtyCountFor(w.path) : -1;
      const pr = prStateFor(w.branch);
      const v = verdict({ prState: pr, dirtyCount: Math.max(0, dirty), isMain: w.branch === 'main' || w.branch === 'master' });
      console.log(`${v.ok ? 'REMOVABLE ' : 'keep      '} ${w.path}  [${w.branch ?? 'detached'}]  pr=${pr ?? '-'} dirty=${dirty} — ${v.why}`);
    }
    return 0;
  }
  const targets = argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node tools/wt-done.mjs --list | <worktree-path> [...]');
    return 2;
  }
  let fail = 0;
  for (const t of targets) {
    const abs = path.resolve(t);
    const w = wts.find((x) => path.resolve(x.path) === abs);
    if (!w) {
      console.error(`✕ ${t}: not a registered worktree`);
      fail++;
      continue;
    }
    const v = verdict({ prState: prStateFor(w.branch), dirtyCount: dirtyCountFor(w.path), isMain: w.branch === 'main' || w.branch === 'master' });
    if (!v.ok) {
      console.error(`✕ REFUSE ${t}: ${v.why}`);
      fail++;
      continue;
    }
    run('git', ['worktree', 'remove', abs]); // no --force, deliberately
    console.log(`✓ removed ${t} (${v.why})`);
  }
  return fail ? 1 : 0;
}

/* self-test: node tools/wt-done.mjs --selftest (pure core only — no repo, no gh) */
if (process.argv.includes('--selftest')) {
  const assert = (c, m) => {
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      process.exit(1);
    }
  };
  assert(!verdict({ prState: 'MERGED', dirtyCount: 1, isMain: false }).ok, 'dirty must refuse even when merged');
  assert(!verdict({ prState: 'OPEN', dirtyCount: 0, isMain: false }).ok, 'open PR must refuse');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false }).ok, 'no PR must refuse');
  assert(!verdict({ prState: 'MERGED', dirtyCount: 0, isMain: true }).ok, 'main checkout must refuse');
  assert(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false }).ok, 'merged+clean must pass');
  const wts = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/x\n\nworktree /b\nHEAD def\ndetached\n');
  assert(wts.length === 2 && wts[0].branch === 'x' && wts[1].branch === null, 'porcelain parse');
  console.log('selftest: 6/6 ok');
  process.exit(0);
}
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirect && !process.argv.includes('--selftest')) process.exit(main(process.argv.slice(2)));
