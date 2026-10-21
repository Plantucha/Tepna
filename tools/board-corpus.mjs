#!/usr/bin/env node
/*
 * tools/board-corpus.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE AGENT BOARD AS A RULE 0 CORPUS (owner, 2026-10-17: "wire agent board to rule 0").
 *
 * The fleet's rulings, handoffs and answers now arrive on the agent board, a SQLite file outside
 * the repo. `tools/doc-search.mjs` indexes files, so a ruling that exists only on the board was
 * invisible to Rule 0. This tool reads the board's read-only snapshot (`agent-board snapshot`) and
 * writes ONE Markdown file per entry, `<out>/<thread id>/<entry id>.md`. The doc-search external
 * root `agent-board` points at `<out>`, so a hit names the post: `ext:agent-board/1/69.md`.
 *
 * One file per entry, not per thread: doc-search skips a file over 256 KB, and the main thread
 * held 72 entries after two days. A file per thread would leave the index the day it grows.
 *
 * ONLY THE KINDS THAT CARRY A DECISION ARE INDEXED (owner, 2026-10-17): `decision`, `handoff`,
 * `finding` and `answer`. A `note`, `question` or `warning` is a doorbell; the repo and memory hold
 * the durable record. Short, repetitive status posts would otherwise crowd briefs and code out of
 * Rule 0's top five hits as the board grows. A ruling must therefore go out as `--kind decision`.
 * A file for an entry outside these kinds is removed like a file for a deleted entry.
 *
 * The tool writes a file only when its text changed and removes a file only when its entry left
 * the snapshot. It touches only `<digits>.md` files inside `<digits>/` folders of `<out>`.
 *
 * PRIMARY DEV MACHINE ONLY, the same scope as doc-search: no board, no output, exit 0.
 * `tools/bge-reindex-driver.sh` runs it before each hourly index tick.
 *
 *   node tools/board-corpus.mjs [--out <dir>] [--from <snapshot.json>]
 *   node tools/board-corpus.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

export const DEFAULT_OUT = process.env.TEPNA_BOARD_CORPUS || join(homedir(), '.local/share/tepna/board-corpus');
const BOARD_CLI = process.env.AGENT_BOARD || join(homedir(), '.local/bin/agent-board');
const ID = /^\d+$/;
export const INDEXED_KINDS = new Set(['decision', 'handoff', 'finding', 'answer']);
const ENTRY_FILE = /^(\d+)\.md$/;

/* One entry as a document. The header lines carry what a reader searches by: the thread, the
   author, who it was addressed to and when. The body is the post as written. */
export function entryMarkdown(thread, entry) {
  const to = Array.isArray(entry.addresses) && entry.addresses.length ? entry.addresses.join(', ') : 'all';
  return [
    `# Board #${entry.id} · ${thread.title}`,
    '',
    `- thread: ${thread.id}${thread.archived ? ' (archived)' : ''}`,
    `- author: ${entry.author}`,
    `- kind: ${entry.kind}`,
    `- to: ${to}`,
    `- at: ${entry.createdAt}`,
    '',
    String(entry.body ?? '').trimEnd(),
    ''
  ].join('\n');
}

/* The files the snapshot owes, keyed by relative path. A non-numeric id is skipped, because the
   path is built from it and a path must never leave `<out>`. */
export function plan(snapshot) {
  const want = new Map();
  for (const t of snapshot?.threads ?? []) {
    if (!ID.test(String(t.id))) continue;
    for (const e of t.entries ?? []) {
      if (!ID.test(String(e.id)) || !INDEXED_KINDS.has(e.kind)) continue;
      want.set(`${t.id}/${e.id}.md`, entryMarkdown(t, e));
    }
  }
  return want;
}

/* Write the plan into `out`. Returns the counts. `fs` is injectable for the selftest. */
export function sync(out, want, fs = { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync }) {
  const n = { written: 0, kept: 0, removed: 0 };
  fs.mkdirSync(out, { recursive: true });
  for (const [rel, text] of want) {
    const path = join(out, rel);
    fs.mkdirSync(join(out, rel.split('/')[0]), { recursive: true });
    let old = null;
    try {
      old = fs.readFileSync(path, 'utf-8');
    } catch {
      old = null;
    }
    if (old === text) {
      n.kept++;
      continue;
    }
    fs.writeFileSync(`${path}.tmp`, text);
    fs.renameSync(`${path}.tmp`, path);
    n.written++;
  }
  for (const dir of fs.readdirSync(out)) {
    if (!ID.test(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(join(out, dir));
    } catch {
      continue;
    }
    let left = 0;
    for (const name of names) {
      const m = ENTRY_FILE.exec(name);
      if (!m) {
        left++;
        continue;
      }
      if (want.has(`${dir}/${name}`)) {
        left++;
        continue;
      }
      fs.unlinkSync(join(out, dir, name));
      n.removed++;
    }
    if (left === 0) {
      try {
        fs.rmdirSync(join(out, dir));
      } catch {
        /* not empty, keep it */
      }
    }
  }
  return n;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--selftest')) {
  let ran = 0;
  const assert = (c, m) => {
    ran++;
    if (!c) {
      console.error(`selftest assertion broke: ${m}`);
      process.exit(1);
    }
  };
  const snap = {
    threads: [
      {
        id: '1',
        title: 'Fleet',
        archived: false,
        entries: [
          { id: '7', author: 'kestrel:x', kind: 'decision', body: 'Ruling one.\n', createdAt: '2026-10-17T01:00:00Z', addresses: ['osprey'] },
          { id: '8', author: 'heron:y', kind: 'answer', body: 'Reply.', createdAt: '2026-10-17T02:00:00Z', addresses: [] },
          { id: '10', author: 'kestrel:x', kind: 'note', body: 'Status ping.', createdAt: '2026-10-17T03:00:00Z', addresses: [] },
          { id: '../9', author: 'z', kind: 'note', body: 'escape', createdAt: '' }
        ]
      },
      { id: 'x', title: 'bad', entries: [{ id: '1', body: 'b' }] }
    ]
  };
  const want = plan(snap);
  assert(want.size === 2, 'two entries are planned: a bad id and a note are skipped');
  assert(!want.has('1/10.md'), 'a note is a doorbell and is not indexed');
  assert(!JSON.stringify([...want.keys()]).includes('..'), 'no planned path leaves the output folder');
  const doc = want.get('1/7.md');
  assert(doc.startsWith('# Board #7 · Fleet'), 'the title names the entry and the thread');
  assert(doc.includes('- to: osprey') && doc.includes('Ruling one.'), 'the address and the body are in the file');
  assert(want.get('1/8.md').includes('- to: all'), 'an entry with no address reads as to all');

  /* An in-memory file system: the sync must write, keep, and prune only its own files. */
  const files = new Map();
  const dirs = new Set();
  const mem = {
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => {
      dirs.add(p);
    },
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    readdirSync: (p) => {
      const pre = `${p}/`;
      const out = new Set();
      for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]);
      return [...out];
    },
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
    rmdirSync: (p) => {
      dirs.delete(p);
    },
    unlinkSync: (p) => {
      files.delete(p);
    },
    writeFileSync: (p, t) => {
      files.set(p, t);
    }
  };
  const out = '/o';
  files.set('/o/1/99.md', 'gone entry');
  files.set('/o/1/notes.txt', 'not ours');
  files.set('/o/keep/1.md', 'not a thread folder');
  let n = sync(out, want, mem);
  assert(n.written === 2 && n.kept === 0, 'the first sync writes both entries');
  assert(n.removed === 1 && !files.has('/o/1/99.md'), 'an entry that left the board is removed');
  assert(files.has('/o/1/notes.txt') && files.has('/o/keep/1.md'), 'files the tool did not write stay');
  assert(![...files.keys()].some((k) => k.endsWith('.tmp')), 'no temporary file is left');
  n = sync(out, want, mem);
  assert(n.written === 0 && n.kept === 2 && n.removed === 0, 'a second sync with no change writes nothing');
  console.log(`selftest: all ${ran} selftests passed`);
  process.exit(0);
}

const isMain = isCliEntry(import.meta.url);
if (isMain) {
  const out = arg('--out') || DEFAULT_OUT;
  const from = arg('--from');
  let raw;
  if (from) raw = readFileSync(from, 'utf-8');
  else if (!existsSync(BOARD_CLI)) {
    console.log(`board-corpus: no agent board at ${BOARD_CLI} on this machine; nothing written`);
    process.exit(0);
  } else raw = execFileSync(BOARD_CLI, ['snapshot'], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
  const n = sync(out, plan(JSON.parse(raw)));
  console.log(`board-corpus: ${n.written} written, ${n.kept} unchanged, ${n.removed} removed → ${out}`);
}
