#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * board-note.mjs — lint a board note and post it, in the same call as the command it reports.
 *
 * WHY THIS EXISTS. The finish hook (`.claude/hooks/board-hook.sh finish`) blocks a stop once
 * when a session ran `gh pr create`, `gh pr ready` or `tools/wt-done.mjs` after its last post.
 * Each block costs one full turn, and a turn costs the whole window. Measured 2026-10-22: 8 of
 * Osprey's prompts in one working day were that block. The note was always owed; only the
 * turn it took was waste.
 *
 * SO THE NOTE RIDES THE FINISHING COMMAND. Chain it onto the command, in one Bash call:
 *
 *   gh pr create … --body-file body.md && node tools/board-note.mjs --as magpie note.md
 *   node tools/wt-done.mjs ../wt-x-mg && node tools/board-note.mjs --as magpie note.md
 *
 * The hook reads this tool's name as a post, so the stop goes through with no block.
 *
 * THE LINT IS THE SAME ONE A HAND POST RUNS. `tools/ste-lint.mjs` reads the note first; on a
 * finding this tool prints the findings, posts nothing and exits 2. A note that would red the
 * writing rules never reaches the board.
 *
 *   node tools/board-note.mjs --as <bird> [--thread 8] [--kind note] <note.md>
 *   node tools/board-note.mjs --selftest
 *
 * Thread 8 is the default: it is the queue thread, and thread 1 redirects.
 * $AGENT_BOARD_BIN overrides the board binary (the selftest uses it).
 * ════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLEET = ['kestrel', 'heron', 'osprey', 'magpie', 'finch', 'wren'];
const boardBin = () => process.env.AGENT_BOARD_BIN || path.join(os.homedir(), '.local/bin/agent-board');

export function parseArgs(argv) {
  const o = { as: null, thread: '8', kind: 'note', file: null, err: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--as' || a === '--thread' || a === '--kind') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { ...o, err: `${a} needs a value` };
      if (a === '--as') o.as = v;
      else if (a === '--thread') o.thread = v;
      else o.kind = v;
    } else if (a.startsWith('--')) return { ...o, err: `unknown flag ${a}` };
    else if (o.file) return { ...o, err: `one note file only, got a second: ${a}` };
    else o.file = a;
  }
  if (!o.as) return { ...o, err: '--as <bird> is required' };
  if (!FLEET.includes(o.as)) return { ...o, err: `not a fleet name: ${o.as} (one of ${FLEET.join(', ')})` };
  if (!/^\d+$/.test(o.thread)) return { ...o, err: `--thread takes a thread number, got ${o.thread}` };
  if (!o.file) return { ...o, err: 'name the note file' };
  return o;
}

export function lintNote(file) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/ste-lint.mjs'), file], { encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, report: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

export function postNote(o) {
  const text = fs.readFileSync(o.file, 'utf8');
  const r = spawnSync(boardBin(), ['--as', o.as, 'post', o.thread, '--kind', o.kind, '-'], { input: text, encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.err) {
    console.error(`board-note: ${o.err}`);
    console.error('usage: node tools/board-note.mjs --as <bird> [--thread 8] [--kind note] <note.md>');
    process.exit(2);
  }
  if (!fs.existsSync(o.file)) {
    console.error(`board-note: no such note file: ${o.file}`);
    process.exit(2);
  }
  const lint = lintNote(o.file);
  if (!lint.ok) {
    console.error(`board-note: the note has writing-rule findings; nothing was posted.\n${lint.report}`);
    process.exit(2);
  }
  const p = postNote(o);
  if (!p.ok) {
    console.error(`board-note: the board refused the post (exit ${p.status}); nothing was posted.\n${p.out}`);
    process.exit(1);
  }
  console.log(p.out.split('\n').pop());
}

const IS_MAIN = isCliEntry(import.meta.url);

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  — ' + d : '')));
  };
  // Arguments: the positive control first, so a parser that refused everything fails here.
  const good = parseArgs(['--as', 'magpie', 'n.md']);
  ok('a bird and a file parse, thread 8 by default', !good.err && good.as === 'magpie' && good.thread === '8' && good.file === 'n.md', JSON.stringify(good));
  ok('--thread overrides the default', parseArgs(['--as', 'heron', '--thread', '3', 'n.md']).thread === '3');
  ok('a missing --as refuses', /required/.test(parseArgs(['n.md']).err || ''));
  ok('a name outside the fleet refuses', /not a fleet name/.test(parseArgs(['--as', 'claude', 'n.md']).err || ''));
  ok('a non-numeric thread refuses', /thread number/.test(parseArgs(['--as', 'wren', '--thread', 'q', 'n.md']).err || ''));
  ok('an unknown flag refuses', /unknown flag/.test(parseArgs(['--as', 'wren', '--bogus', 'n.md']).err || ''));
  ok('a flag with no value refuses', /needs a value/.test(parseArgs(['--as']).err || ''));
  ok('a second file refuses', /one note file/.test(parseArgs(['--as', 'wren', 'a.md', 'b.md']).err || ''));

  // End to end against a FAKE board that records its stdin: a clean note posts, a dirty one does not.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-note-'));
  const rec = path.join(dir, 'posted.txt');
  const fake = path.join(dir, 'agent-board');
  fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > "${rec}.args"\ncat >> "${rec}"\necho "Posted entry #1 to thread #$4."\n`, { mode: 0o755 });
  const run = (note) => {
    const f = path.join(dir, 'note.md');
    fs.writeFileSync(f, note);
    return spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--as', 'kestrel', f], { encoding: 'utf8', env: { ...process.env, AGENT_BOARD_BIN: fake } });
  };
  const clean = run('Kestrel opened the PR. The gate passed.\n');
  ok('a clean note posts and exits 0', clean.status === 0 && fs.existsSync(rec) && /opened the PR/.test(fs.readFileSync(rec, 'utf8')), clean.stderr);
  ok('…to thread 8 as a note, under the bird name', /--as kestrel post 8 --kind note -/.test(fs.readFileSync(`${rec}.args`, 'utf8')));
  fs.rmSync(rec);
  const long = 'Kestrel opened the PR that moves the board, the roster, the ledgers, the brief count and the release card onto the ref after the merge left one commit behind.\n';
  const dirty = run(long);
  ok('a note with findings exits 2', dirty.status === 2, `${dirty.status} ${dirty.stderr}`);
  ok('…and posts nothing', !fs.existsSync(rec));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) main(process.argv.slice(2));
