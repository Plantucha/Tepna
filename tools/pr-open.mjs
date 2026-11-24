#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * pr-open.mjs — one command that gates the body, pushes, opens the draft PR and posts the note.
 *
 * WHY. A bird closes a unit with four calls: the writing lint, the push, `gh pr create` and the board
 * post. Each call is one turn, and a turn costs the whole window. This is those four in one call, and
 * a body that CI would refuse stops before the push.
 *
 *   node tools/pr-open.mjs --as <bird> --title "<title>" <body.md> [--note note.md] [--thread 7] [--second]
 *   node tools/pr-open.mjs --dry-run --as <bird> --title "<title>" <body.md>     # the checks alone
 *   node tools/pr-open.mjs --selftest
 *
 * In order, and the first failure stops it:
 *   1. The branch is not main, and no tracked file is modified: a PR carries commits only.
 *   2. No other open PR carries this branch's suffix (CLAUDE.md §5, one open PR per coder). `--second`
 *      passes over it, for the RESIDUE-only PR that the rule exempts.
 *   3. `tools/pr-compliance.mjs` on the body against `origin/main`, the required gate of the PR.
 *      Then `tools/secret-scan.mjs`, whose exit code is the verdict: a pushed secret is public.
 *   4. The note passes `tools/ste-lint.mjs`. `{PR}` in the note becomes `#<number>`. With no `--note`
 *      the note is one line: the number and the title.
 *   5. `git push -u origin HEAD`. No force: a rejected push means another session owns the name (§2d).
 *   6. `gh pr create --draft`.  7. The board post.
 *
 * Exit 2: a check refused, and nothing left the machine. Exit 1: the push or the PR failed. Exit 3: the
 * PR is open and the post failed, so post by hand.
 * ════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCliEntry } from './argv-guard.mjs';
import { lintNote, parseArgs as parseNoteArgs, postNote } from './board-note.mjs';
import { branchSuffix } from './unit-start.mjs';

const USAGE = 'usage: node tools/pr-open.mjs --as <bird> --title "<title>" <body.md> [--note note.md] [--thread 7] [--second] [--dry-run]';

export function parseArgs(argv) {
  const o = { as: null, title: null, body: null, note: null, thread: '7', second: false, dry: false, err: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = { '--as': 'as', '--title': 'title', '--note': 'note', '--thread': 'thread' }[a];
    if (key) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { ...o, err: `${a} needs a value` };
      o[key] = v;
    } else if (a === '--second') o.second = true;
    else if (a === '--dry-run') o.dry = true;
    else if (a.startsWith('--')) return { ...o, err: `unknown flag ${a}` };
    else if (o.body) return { ...o, err: `one body file only, got a second: ${a}` };
    else o.body = a;
  }
  if (!o.title) return { ...o, err: '--title "<title>" is required' };
  if (!o.body) return { ...o, err: 'name the body file' };
  /* The bird and the thread are board-note's rules, so board-note judges them. */
  const n = parseNoteArgs(['--as', o.as ?? '', '--thread', o.thread, 'note.md']);
  return n.err ? { ...o, err: n.err } : o;
}

/** Open PRs whose branch carries `branch`'s suffix and is not `branch`. A branch with no suffix matches none. */
export function otherPrs(prs, branch) {
  const s = branchSuffix(branch);
  return s ? (prs || []).filter((p) => p.headRefName !== branch && branchSuffix(p.headRefName) === s) : [];
}

export const noteText = (o, pr, noteBody) => (noteBody ?? `Opened {PR}: ${o.title.replace(/\.$/, '')}.\n`).replaceAll('{PR}', `#${pr}`);

/**
 * The whole sequence over injected effects, so the selftest reads the order and what never ran.
 * `run(cmd, args, env)` → `{status, stdout, stderr}`; `lint(text)` → `{ok, report}`; `post(text)` → `{ok, out}`.
 */
export function openPr(o, { run, lint, post, body, noteBody = null, log = () => {} }) {
  const stop = (code, why) => ({ code, why });
  const out = (r) => `${r.stdout || ''}${r.stderr || ''}`.trim();
  const git = (...a) => run('git', a);
  const br = git('rev-parse', '--abbrev-ref', 'HEAD');
  const branch = String(br.stdout || '').trim();
  if (br.status !== 0 || !branch) return stop(2, `cannot read the branch: ${out(br)}`);
  if (branch === 'main' || branch === 'HEAD') return stop(2, `the checkout is on ${branch}; open the PR from a branch`);
  const st = git('status', '--porcelain', '--untracked-files=no');
  if (st.status !== 0) return stop(2, `cannot read the tree: ${out(st)}`);
  if (String(st.stdout).trim()) return stop(2, `tracked files are modified and not committed:\n${String(st.stdout).trimEnd()}`);
  if (!o.second) {
    const ls = run('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,headRefName']);
    let prs = null;
    try {
      prs = ls.status === 0 ? JSON.parse(ls.stdout) : null;
    } catch {
      /* an unreadable list is not an empty list: it refuses below */
    }
    if (!Array.isArray(prs)) return stop(2, `cannot list the open PRs: ${out(ls)}`);
    const mine = otherPrs(prs, branch);
    if (mine.length) return stop(2, `one open PR per coder: ${mine.map((p) => `#${p.number} ${p.headRefName}`).join(', ')} (\`--second\` for the RESIDUE-only PR)`);
  }
  const f = git('fetch', '-q', 'origin', 'main');
  if (f.status !== 0) return stop(2, `cannot fetch origin/main: ${out(f)}`);
  const c = run(process.execPath, ['tools/pr-compliance.mjs'], { PR_BODY: body, PR_BASE_SHA: 'origin/main', PR_HEAD_SHA: 'HEAD', PR_HEAD_REF: branch });
  if (c.status !== 0) return stop(2, out(c) || `pr-compliance exit ${c.status}`);
  log(out(c));
  const s = run(process.execPath, ['tools/secret-scan.mjs']);
  if (s.status !== 0) return stop(2, out(s) || `secret-scan exit ${s.status}`);
  const l = lint(noteText(o, 1, noteBody));
  if (!l.ok) return stop(2, `the note has writing-rule findings:\n${l.report}`);
  if (o.dry) return { code: 0, why: 'dry run: every check passed, and nothing was pushed' };
  const p = git('push', '-u', 'origin', 'HEAD');
  if (p.status !== 0) return stop(1, `the push failed (a rejection means another session owns the name, §2d):\n${out(p)}`);
  const g = run('gh', ['pr', 'create', '--draft', '--title', o.title, '--body-file', o.body]);
  const n = /\/pull\/(\d+)/.exec(String(g.stdout || ''))?.[1];
  if (g.status !== 0 || !n) return stop(1, `the branch is pushed and gh opened no PR:\n${out(g)}`);
  const url = String(g.stdout).trim().split('\n').pop();
  const b = post(noteText(o, n, noteBody));
  if (!b.ok) return { code: 3, url, why: `${url} is open and the board refused the post; post by hand:\n${b.out}` };
  return { code: 0, url, why: `${url}\n${b.out}` };
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.err) {
    console.error(`pr-open: ${o.err}\n${USAGE}`);
    return 2;
  }
  for (const f of [o.body, o.note].filter(Boolean))
    if (!fs.existsSync(f)) {
      console.error(`pr-open: no such file: ${f}`);
      return 2;
    }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-open-'));
  const file = path.join(dir, 'note.md');
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout?.trim() || process.cwd();
  const body = path.resolve(o.body);
  try {
    const r = openPr(
      { ...o, body },
      {
        run: (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 }),
        lint: (t) => (fs.writeFileSync(file, t), lintNote(file)),
        post: (t) => (fs.writeFileSync(file, t), postNote({ as: o.as, thread: o.thread, kind: 'note', file })),
        body: fs.readFileSync(body, 'utf8'),
        noteBody: o.note ? fs.readFileSync(o.note, 'utf8') : null,
        log: (t) => console.log(t)
      }
    );
    (r.code ? console.error : console.log)(`pr-open: ${r.why}`);
    return r.code;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };
  const A = ['--as', 'kestrel', '--title', 'T', 'b.md'];
  ok(!parseArgs(A).err && parseArgs(A).thread === '7' && parseArgs(A).body === 'b.md', 'a bird, a title and a body parse');
  for (const [argv, re] of [
    [['--as', 'kestrel', 'b.md'], /--title/],
    [['--title', 'T', 'b.md'], /--as|needs a value|fleet name/],
    [['--as', 'nobody', '--title', 'T', 'b.md'], /fleet name/],
    [['--as', 'kestrel', '--title', 'T'], /body file/],
    [[...A, 'c.md'], /one body file/],
    [[...A, '--force'], /unknown flag/],
    [[...A, '--thread', 'x'], /thread number/],
    [['--as', 'kestrel', 'b.md', '--title'], /needs a value/]
  ])
    ok(re.test(parseArgs(argv).err || ''), `refuses: ${argv.join(' ')}`);

  ok(otherPrs([{ number: 1, headRefName: 'claude/a-k9' }], 'claude/b-k9').length === 1, 'another branch with the same suffix is mine');
  ok(otherPrs([{ number: 1, headRefName: 'claude/b-k9' }], 'claude/b-k9').length === 0, 'the same branch is not another PR');
  ok(otherPrs([{ number: 1, headRefName: 'claude/a-osp' }], 'claude/b-k9').length === 0, 'CONTROL: the PR of another coder does not count');
  ok(noteText({ title: 'Fix it.' }, 5, null) === 'Opened #5: Fix it.\n', 'the default note has one period');
  ok(noteText({ title: 'T' }, 5, 'See {PR} and {PR}.') === 'See #5 and #5.', 'every {PR} becomes the number');

  /* A world whose every step passes; one leg breaks one step and reads what ran after it. */
  const drive = (over = {}, opts = {}) => {
    const ran2 = [];
    const replies = {
      'git rev-parse': { status: 0, stdout: 'claude/x-k9\n' },
      'git status': { status: 0, stdout: '' },
      'gh pr list': { status: 0, stdout: '[]' },
      'git fetch': { status: 0, stdout: '' },
      compliance: { status: 0, stdout: 'clean' },
      secrets: { status: 0, stdout: '' },
      'git push': { status: 0, stdout: '' },
      'gh pr create': { status: 0, stdout: 'https://github.com/o/r/pull/77\n' },
      ...over
    };
    let env = null;
    let posted = null;
    const r = openPr(
      { as: 'kestrel', title: 'T', body: '/b.md', thread: '7', second: false, dry: false, ...opts },
      {
        run: (cmd, args, e) => {
          const k = args[0] === 'tools/pr-compliance.mjs' ? 'compliance' : args[0] === 'tools/secret-scan.mjs' ? 'secrets' : `${cmd} ${cmd === 'gh' ? args.slice(0, 2).join(' ') : args[0]}`;
          if (e) env = e;
          ran2.push(k === 'git push' || k === 'gh pr create' ? `${k} ${args.join(' ')}` : k);
          return replies[k];
        },
        lint: (t) => over.lint?.(t) ?? { ok: true },
        post: (t) => {
          posted = t;
          return over.post ?? { ok: true, out: 'Posted entry #9' };
        },
        body: 'BODY'
      }
    );
    return { r, ran: ran2, env, posted, sent: ran2.some((k) => /^(git push|gh pr create)/.test(k)) || posted !== null };
  };
  const good = drive();
  ok(good.r.code === 0 && good.r.url.endsWith('/77') && good.posted === 'Opened #77: T.\n', 'CONTROL: every step passes, the PR opens and the note names its number');
  ok(good.env.PR_BODY === 'BODY' && good.env.PR_BASE_SHA === 'origin/main' && good.env.PR_HEAD_REF === 'claude/x-k9', 'the gate reads this body against origin/main');
  ok(good.ran.indexOf('compliance') < good.ran.findIndex((k) => k.startsWith('git push')), 'the gate runs before the push');
  ok(!good.ran.some((k) => /--force/.test(k)) && good.ran.some((k) => /gh pr create.*--draft/.test(k)), 'the push is never forced and the PR is a draft');
  for (const [name, over, opts] of [
    ['main', { 'git rev-parse': { status: 0, stdout: 'main\n' } }],
    ['a detached head', { 'git rev-parse': { status: 0, stdout: 'HEAD\n' } }],
    ['a modified tracked file', { 'git status': { status: 0, stdout: ' M a.js\n' } }],
    ['an unreadable tree', { 'git status': { status: 128, stdout: '' } }],
    ['another open PR of this coder', { 'gh pr list': { status: 0, stdout: '[{"number":3,"headRefName":"claude/y-k9"}]' } }],
    ['an unreadable PR list', { 'gh pr list': { status: 1, stdout: '' } }],
    ['a PR list that is not JSON', { 'gh pr list': { status: 0, stdout: 'oops' } }],
    ['a failed fetch', { 'git fetch': { status: 1, stdout: '' } }],
    ['a body the gate refuses', { compliance: { status: 1, stdout: '', stderr: 'red: no Rule 0' } }],
    ['a secret in the diff', { secrets: { status: 1, stdout: 'red' } }],
    ['a note with findings', { lint: () => ({ ok: false, report: 'R' }) }]
  ]) {
    const d = drive(over, opts);
    ok(d.r.code === 2 && !d.sent, `${name} refuses, and nothing left the machine`);
  }
  ok(drive({ 'gh pr list': { status: 0, stdout: '[{"number":3,"headRefName":"claude/y-k9"}]' } }, { second: true }).r.code === 0, '--second passes over the one-PR rule');
  const dry = drive({}, { dry: true });
  ok(dry.r.code === 0 && !dry.sent && dry.ran.includes('compliance'), '--dry-run runs every check and sends nothing');
  const rej = drive({ 'git push': { status: 1, stdout: '', stderr: 'non-fast-forward' } });
  ok(rej.r.code === 1 && rej.posted === null && !rej.ran.some((k) => k.startsWith('gh pr create')), 'a rejected push opens no PR and posts nothing');
  ok(drive({ 'gh pr create': { status: 0, stdout: 'no url' } }).r.code === 1, 'an answer with no PR number is a failure');
  const np = drive({ post: { ok: false, out: 'down' } });
  ok(np.r.code === 3 && /\/77/.test(np.r.why), 'a refused post exits 3 and names the open PR');
  return { ok: fail.length === 0, fail, line: fail.length ? `${fail.length} of ${ran} selftests failed` : `all ${ran} selftests passed` };
}

if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) {
    const r = selftest();
    console.log(r.line);
    for (const f of r.fail) console.log(`  ✕ ${f}`);
    process.exit(r.ok ? 0 : 1);
  }
  process.exit(main(process.argv.slice(2)));
}
