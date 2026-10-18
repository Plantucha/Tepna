#!/usr/bin/env node
/*
 * tools/name-lease.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHO ALREADY HOLDS THIS FILENAME — run it BEFORE naming a new file.
 *
 * Residue `2026-09-22-two-sessions-name-one-new-file`: two sessions created `tools/corpus-census.mjs`
 * on the same day, for two different tools, because a new artifact gets named after the defect it
 * fixes, and one defect yields one slug. A branch push to a diverged name is REJECTED; a FILE has no
 * lease, so the second writer silently overwrites the first. The row asks for the cheap, one-directional
 * check that §👥.2d prescribes for branch names.
 *
 * WHAT IT READS, and why it sees more than the row expected: every fleet worktree on this machine is a
 * `git worktree` of ONE checkout, so they share one object store and one ref namespace. Three rails:
 *   1 origin/main          — the merged half, the row's `git ls-tree origin/main tools/`.
 *   2 every local and remote-tracking ref — a peer's COMMITTED but unpushed branch is visible here.
 *   3 every worktree's working tree on disk — a peer's UNCOMMITTED new file is visible here.
 * Rails 2 and 3 are what the row and §👥.2d call structurally invisible. That holds for a GATE, which
 * runs on a CI clone, and it holds for a peer with its own clone (the capture box). It does not hold
 * for a sibling worktree of this checkout, which is where this fleet's sessions work.
 *
 * WHAT IT STILL CANNOT SEE: a clone on another machine, a name that exists only in a peer's head, and
 * a name taken after this run. It is a measurement at one instant, not a lock — so it answers
 * "is this name free NOW", and the answer decays.
 *
 *   node tools/name-lease.mjs tools/foo.mjs docs/FOO.md      # one line per path, exit 1 if any is held
 *   node tools/name-lease.mjs --json tools/foo.mjs           # ONE tepna.verdict/1 on stdout
 *   node tools/name-lease.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const MAIN = 'refs/remotes/origin/main';
/* PRE-STATED, before any path was read: a name is free when nothing holds it. */
export const CRITERION = Object.freeze({
  name: 'paths_already_claimed',
  threshold: 0,
  unit: 'paths',
  direction: 'lte',
  preStated:
    'a proposed path is FREE when no rail holds it: not in origin/main, not in any local or remote-tracking ref, and not on disk in any worktree of this checkout. One held path fails the run.'
});

/* ── PURE ─────────────────────────────────────────────────────────────────────────────────── */

/* `git worktree list --porcelain`: blank-line-separated stanzas, `worktree <abs path>` first. */
export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of String(porcelain).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: null };
      out.push(cur);
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7);
  }
  return out;
}

/* `git cat-file --batch-check` emits ONE line per input line, in order, so the index is the key:
   `<oid> blob <size>` when the ref holds the path, `<input> missing` when it does not. */
export function holdersFromLines(stdout, refs) {
  const lines = String(stdout)
    .split('\n')
    .filter((l) => l !== '');
  if (lines.length !== refs.length) throw new Error(`cat-file answered ${lines.length} line(s) for ${refs.length} ref(s) — the index is no longer the key`);
  return refs.filter((_, i) => / blob \d+$/.test(lines[i]));
}

/* The decision. A claim is { path, inMain, refs: [], worktrees: [], ownTree }. `ownTree` separates
   "you already wrote this" from "a peer holds it", which is the whole question a namer is asking. */
export function judge(claims) {
  const taken = [];
  const free = [];
  for (const c of claims) {
    const rails = [];
    if (c.inMain) rails.push('origin/main');
    if (c.refs.length) rails.push(`${c.refs.length} other ref(s): ${c.refs.slice(0, 5).map(short).join(', ')}${c.refs.length > 5 ? ', …' : ''}`);
    if (c.ownTree) rails.push('your own tree (the checkout this ran in)');
    if (c.worktrees.length) rails.push(`on disk in ${c.worktrees.length} worktree(s): ${c.worktrees.slice(0, 5).join(', ')}${c.worktrees.length > 5 ? ', …' : ''}`);
    if (rails.length) taken.push(`${c.path} — held by ${rails.join(' · ')}`);
    else free.push(c.path);
  }
  return { taken, free };
}

export function short(ref) {
  return ref.replace(/^refs\/(heads|remotes)\//, '');
}

/* ── MEASUREMENT ──────────────────────────────────────────────────────────────────────────── */

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
}

function holdersOf(p, refs) {
  const input = refs.map((r) => `${r}:${p}\n`).join('');
  const out = execFileSync('git', ['cat-file', '--batch-check'], { cwd: REPO, encoding: 'utf8', input, maxBuffer: 1 << 28 });
  return holdersFromLines(out, refs);
}

function measure(paths) {
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
    .split('\n')
    .filter((x) => x !== '');
  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain']));
  const claims = paths.map((p) => {
    const held = holdersOf(p, refs);
    return {
      path: p,
      inMain: held.includes(MAIN),
      refs: held.filter((r) => r !== MAIN),
      ownTree: fs.existsSync(path.join(REPO, p)),
      worktrees: worktrees.filter((w) => w.path !== REPO && fs.existsSync(path.join(w.path, p))).map((w) => w.path)
    };
  });
  return { claims, refsScanned: refs.length, worktreesScanned: worktrees.length };
}

function main() {
  if (has('--selftest')) return selftest();
  const paths = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--write').map((p) => p.replace(/^\.\//, ''));
  const Verdict = req('../verdict.js');
  let commit = null;
  try {
    commit = git(['rev-parse', 'HEAD']).trim();
  } catch (_) {
    /* not a checkout ⇒ null with a reason */
  }
  const producedBy = { tool: 'tools/name-lease.mjs', commit };
  if (commit == null) producedBy.commitReason = 'not a git checkout';
  const base = {
    gate: 'name-lease',
    scope: 'internal',
    criterion: CRITERION,
    evidence: ['git for-each-ref refs/heads refs/remotes', 'git cat-file --batch-check <ref>:<path>', 'git worktree list --porcelain'],
    producedBy
  };
  let v;
  if (!paths.length) {
    v = Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: 'no path proposed: name the file(s) you are about to create, as `node tools/name-lease.mjs tools/foo.mjs`'
    });
  } else {
    try {
      const { claims, refsScanned, worktreesScanned } = measure(paths);
      const { taken, free } = judge(claims);
      v = Verdict.make({
        ...base,
        status: taken.length ? 'FAIL' : 'PASS',
        population: { checked: paths.length, eligible: paths.length, excluded: 0 },
        result: {
          takenCount: taken.length,
          freeCount: free.length,
          refsScanned,
          worktreesScanned,
          rails: ['origin/main', 'every local and remote-tracking ref of this checkout', "every worktree's working tree on disk"],
          blindTo: "a clone on another machine, a name held only in a peer's head, and anything claimed after this instant — the answer decays",
          claims
        },
        reason: taken.length ? taken.join(' | ') : null
      });
    } catch (e) {
      v = Verdict.make({
        ...base,
        status: 'NOT_RUN',
        population: { checked: 0, eligible: paths.length, excluded: paths.length },
        result: null,
        reason: 'the scan did not run: ' + (e && e.message ? e.message : e)
      });
    }
  }
  const val = Verdict.validate(v);
  if (!val.ok) {
    console.error('verdict does not validate: ' + val.errors.join(' | '));
    process.exit(2);
  }
  const out = JSON.stringify(v, null, 1) + '\n';
  if (arg('--write')) fs.writeFileSync(path.resolve(REPO, arg('--write')), out);
  if (has('--json')) process.stdout.write(out);
  else if (v.result) {
    for (const p of v.result.claims.map((c) => c.path)) {
      const t = v.result.claims.find((c) => c.path === p);
      const { taken } = judge([t]);
      console.log(taken.length ? '✗ ' + taken[0] : `✓ ${p} — free across ${v.result.refsScanned} ref(s) and ${v.result.worktreesScanned} worktree(s)`);
    }
  } else console.log(`${v.status} · ${v.reason}`);
  process.exit(v.status === 'FAIL' ? 1 : v.status === 'NOT_RUN' ? 2 : 0);
}

function selftest() {
  let n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) {
      console.error('✗ ' + m);
      process.exit(1);
    }
  };
  /* planted paths, deliberately NOT shaped like a checkout root: a literal ending in the repo
     directory name, or naming a worktree, is what the suite bans in a tool (PR #686 class). */
  const wt = 'worktree /planted/one\nHEAD abc\nbranch refs/heads/main\n\nworktree /planted/two\nHEAD def\ndetached\n';
  ok(parseWorktrees(wt).length === 2, 'parseWorktrees reads both stanzas');
  ok(parseWorktrees(wt)[0].branch === 'refs/heads/main' && parseWorktrees(wt)[1].branch === null, 'parseWorktrees keeps a detached worktree with a null branch');
  ok(parseWorktrees('').length === 0, 'parseWorktrees on empty input yields no worktree');
  const refs = ['refs/heads/a', 'refs/heads/b', 'refs/heads/c'];
  ok(holdersFromLines('aa blob 12\nrefs/heads/b:tools/x.mjs missing\ncc blob 3\n', refs).join() === 'refs/heads/a,refs/heads/c', 'holdersFromLines keys by line index, not by echoed name');
  let threw = false;
  try {
    holdersFromLines('aa blob 12\n', refs);
  } catch (_) {
    threw = true;
  }
  ok(threw, 'holdersFromLines refuses when the line count stops matching the ref count');
  ok(holdersFromLines('aa tree 12\n', ['refs/heads/a']).length === 0, 'a tree at that path is not a file holder');
  const free = { path: 'tools/new.mjs', inMain: false, refs: [], worktrees: [], ownTree: false };
  ok(judge([free]).free.length === 1 && judge([free]).taken.length === 0, 'nothing holding it ⇒ free');
  ok(judge([{ ...free, inMain: true }]).taken[0].includes('origin/main'), 'origin/main holding it is named');
  ok(judge([{ ...free, refs: ['refs/heads/claude/x-osp'] }]).taken[0].includes('claude/x-osp'), "a peer's unpushed committed branch is named, short");
  ok(judge([{ ...free, worktrees: ['/planted/two'] }]).taken[0].includes('on disk in 1 worktree'), 'an uncommitted file in a sibling worktree is named');
  ok(judge([{ ...free, refs: refs.concat(['refs/heads/d', 'refs/heads/e', 'refs/heads/f']) }]).taken[0].includes('…'), 'a long holder list is elided, and the count stays exact');
  ok(
    judge([free, { ...free, path: 'docs/A.md', inMain: true }]).taken.length === 1 && judge([free, { ...free, path: 'docs/A.md', inMain: true }]).free.length === 1,
    'one held path among two does not hide the free one'
  );
  ok(judge([{ ...free, ownTree: true }]).taken[0].includes('your own tree'), "a file this checkout already holds is named as mine, not as a peer's");
  ok(!judge([{ ...free, ownTree: true }]).taken[0].includes('worktree(s)'), 'my own tree is never counted among the sibling worktrees');
  ok(short('refs/remotes/origin/main') === 'origin/main' && short('refs/heads/claude/a-mg') === 'claude/a-mg', 'short() strips both namespaces');
  ok(Object.isFrozen(CRITERION) && CRITERION.threshold === 0, 'the criterion is pre-stated and frozen');
  console.log(`all ${n} selftests passed`);
}

main();
