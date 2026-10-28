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

/* ══ WHICH POST THE FLEET HAS ALREADY REPLACED ═════════════════════════════════════════════
   Residue 2026-10-28-a-superseded-board-post-ranks-like-a-current-one. A board post is never
   edited, so a ruling is replaced by a LATER post and the earlier one stays in the corpus reading
   like current advice. Two signals carry that, and both come from the board itself:

   1 · THE CLAIM PROTOCOL. `agent-board claim` and `release` write `CLAIM <row key>` and
       `RELEASE <row key>` as the first line of a post. Every post for one key but the LAST is
       replaced by its successor, which is mechanical and needs no reading of prose.
   2 · AN EXPLICIT BACK-REFERENCE, in the ACTIVE voice only: `correcting my #1289`,
       `Osprey WITHDRAWS the claim in #956`, `This replaces the 2-PR cap in #560`.

   ⚠ THE PASSIVE VOICE POINTS THE OTHER WAY AND THIS READER ABSTAINS ON IT. `#36 was … superseded
   by #37` names #37 as the REPLACEMENT, and marking it would bury the current ruling — the one
   direction of error that costs a reader the answer. `the ones at #1200 as corrected by #1201` is
   the same shape. So is a bare locator: `Retraction and reasoning at #1771` says where a thing
   lives, not what it replaces. Measured over the 2026-10-28 board: 30 references carry a
   supersession verb near a resolvable earlier id, 24 of them accepted and 6 abstained. Five of the
   six are the two shapes above. The sixth is a post whose correction is partial — it reports that
   an earlier finding re-derives a third one, and leaves that finding standing — so the refusal is
   the conservative reading and not a gap.

   ⚠ A `#NNNN` IS NOT A BOARD ID BY ITSELF — most of them are PR numbers. A reference counts only
   when it resolves to an id the snapshot holds AND is EARLIER than the post citing it. PR numbers
   run above the board's high-water mark today, so they resolve to nothing; that is an accident of
   the counters, not a rule, which is why the resolution is kept and not replaced by a range. */
const CLAIM_LINE = /^[ \t]*(CLAIM|RELEASE)[ \t]+(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)/m;
/* Active: the verb governs the reference. Only connector words may stand between them, and `by`
   is not one of them — it is the passive marker this reader refuses to read. */
/* The ACTIVE rule is a window with two vetoes and one requirement, each of them measured against
   the board's own prose rather than invented:

     window      — the verb and the reference sit in one sentence, within 40 characters.
     veto ` by ` — the passive points the other way: `superseded by #37` names the REPLACEMENT.
     veto ` and `— a conjunction attaches the reference to the second conjunct, not to the verb:
                   `Retraction and reasoning at #1771` says where the retraction lives.
     tail        — the span must END on a word that introduces a target: a preposition, a
                   possessive, or the noun for a post. `corrects my own report at #1636` qualifies;
                   a verb sitting near an unrelated number does not. */
const ACTIVE_REF = /\b(supersed|replac|overrid|retract|withdraw|correct)\w*\b([^.\n]{0,40}?)#(\d{1,5})\b/gi;
const TARGET_TAIL =
  /(?:\b(?:to|of|in|at|from|on|my|own|the|this|that|its|their)\b|\b(?:post|note|claim|claims|finding|findings|report|reports|entry|record|ruling|order|cap|half|clauses)\b)[ \t,:—-]*$/i;
const PASSIVE_OR_CONJUNCTION = /\b(?:by|and)\b/i;
/* ⚠ THE ABSTENTION COLUMN IS MEASURED, NOT ASSUMED. A reader that counted only what the active
   rule rejected INSIDE its own match would print `abstained: 0` for ever, because a passive
   phrase does not match the active rule at all — the examined-nothing shape with a reassuring
   name. So the near-miss population is read by its own loose rule: a supersession verb within 40
   characters of a resolvable earlier id. Whatever the active rule does not accept is an
   abstention, and the counts are printed side by side. */
const NEAR_REF = /\b(?:supersed|replac|overrid|retract|withdraw|correct)\w*\b[^.\n]{0,40}?#(\d{1,5})\b/gi;
const PAST = { supersed: 'superseded', replac: 'replaced', overrid: 'overridden', retract: 'retracted', withdraw: 'withdrawn', correct: 'corrected' };

/* Who replaced whom, as `superseded id → { by, how, author, at }`. The LAST word wins when two
   posts both claim a replacement, because the board is append-only and later is newer. */
export function supersessions(snapshot) {
  const held = new Map();
  const indexed = [];
  for (const t of snapshot?.threads ?? []) {
    if (!ID.test(String(t.id))) continue;
    for (const e of t.entries ?? []) {
      if (!ID.test(String(e.id))) continue;
      held.set(Number(e.id), e);
      if (INDEXED_KINDS.has(e.kind)) indexed.push({ ...e, nid: Number(e.id) });
    }
  }
  indexed.sort((a, b) => a.nid - b.nid);
  const out = new Map();
  const mark = (target, by) => {
    const prev = out.get(target);
    if (!prev || prev.by < by.by) out.set(target, by);
  };

  const byKey = new Map();
  for (const e of indexed) {
    const m = CLAIM_LINE.exec(String(e.body ?? ''));
    if (!m) continue;
    const key = m[2];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id: e.nid, verb: m[1], author: e.author, at: e.createdAt });
  }
  for (const [key, seq] of byKey) {
    seq.sort((a, b) => a.id - b.id);
    for (let i = 0; i < seq.length - 1; i++) {
      const next = seq[i + 1];
      mark(seq[i].id, { by: next.id, how: `the claim protocol: ${next.verb} of ${key}`, author: next.author, at: next.at });
    }
  }

  const accepted = new Set();
  const near = new Set();
  for (const e of indexed) {
    const body = String(e.body ?? '');
    for (const m of body.matchAll(NEAR_REF)) {
      const target = Number(m[1]);
      if (held.has(target) && target < e.nid) near.add(`${e.nid}>${target}`);
    }
    for (const m of body.matchAll(ACTIVE_REF)) {
      const target = Number(m[3]);
      if (!held.has(target) || target >= e.nid) continue;
      const span = m[2] ?? '';
      if (PASSIVE_OR_CONJUNCTION.test(span) || !TARGET_TAIL.test(span)) continue;
      accepted.add(`${e.nid}>${target}`);
      mark(target, { by: e.nid, how: `${PAST[m[1].toLowerCase()]} in a later post`, author: e.author, at: e.createdAt });
    }
  }
  let abstained = 0;
  for (const pair of near) if (!accepted.has(pair)) abstained++;
  return { map: out, accepted: accepted.size, abstained };
}

/* One entry as a document. The header lines carry what a reader searches by: the thread, the
   author, who it was addressed to and when. The body is the post as written. */
export function entryMarkdown(thread, entry, superseded = null) {
  const to = Array.isArray(entry.addresses) && entry.addresses.length ? entry.addresses.join(', ') : 'all';
  /* The warning is written TWICE, above the body and below it. doc-search splits a file into
     chunks and shows the chunk it matched, so a mark that sat in the header alone would be absent
     from every hit on a long post — the one place a reader needs it. */
  const warn = superseded ? `⚠ SUPERSEDED by board #${superseded.by} (${superseded.how}, ${superseded.author}, ${superseded.at}). Read that post before acting on this one.` : null;
  return [
    `# Board #${entry.id} · ${thread.title}`,
    '',
    `- thread: ${thread.id}${thread.archived ? ' (archived)' : ''}`,
    `- author: ${entry.author}`,
    `- kind: ${entry.kind}`,
    `- to: ${to}`,
    `- at: ${entry.createdAt}`,
    ...(superseded ? [`- superseded-by: #${superseded.by}`, '', warn] : []),
    '',
    String(entry.body ?? '').trimEnd(),
    ...(superseded ? ['', warn] : []),
    ''
  ].join('\n');
}

/* The files the snapshot owes, keyed by relative path. A non-numeric id is skipped, because the
   path is built from it and a path must never leave `<out>`. */
export function plan(snapshot) {
  const want = new Map();
  const { map: replaced } = supersessions(snapshot);
  for (const t of snapshot?.threads ?? []) {
    if (!ID.test(String(t.id))) continue;
    for (const e of t.entries ?? []) {
      if (!ID.test(String(e.id)) || !INDEXED_KINDS.has(e.kind)) continue;
      want.set(`${t.id}/${e.id}.md`, entryMarkdown(t, e, replaced.get(Number(e.id)) ?? null));
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

if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
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

  /* THE SUPERSESSION READER. Each leg below is unreachable by every other rule in the chain: a
     body that an earlier rule would accept scores on that rule and says nothing about the one it
     was written for. Ids are spaced so no accident makes a reference resolve. */
  const sup = {
    threads: [
      {
        id: '2',
        title: 'Rows',
        entries: [
          { id: '20', author: 'a', kind: 'decision', body: 'CLAIM 2026-10-28-a-row\nStarting.', createdAt: 'T1' },
          { id: '21', author: 'b', kind: 'decision', body: 'RELEASE 2026-10-28-a-row\nDone.', createdAt: 'T2' },
          { id: '22', author: 'c', kind: 'decision', body: 'CLAIM 2026-10-28-a-row\nPicked up again.', createdAt: 'T3' },
          { id: '30', author: 'd', kind: 'finding', body: 'First reading.', createdAt: 'T4' },
          { id: '31', author: 'e', kind: 'finding', body: 'This supersedes my own #30. The numbers moved.', createdAt: 'T5' },
          { id: '32', author: 'f', kind: 'finding', body: 'This supersedes my own #30. Again, and for the last time.', createdAt: 'T6' },
          { id: '40', author: 'g', kind: 'finding', body: 'Eight cells.', createdAt: 'T7' },
          { id: '41', author: 'h', kind: 'finding', body: 'The cells are the ones corrected by #40.', createdAt: 'T8' },
          { id: '50', author: 'i', kind: 'finding', body: 'Groundwork.', createdAt: 'T9' },
          { id: '51', author: 'j', kind: 'finding', body: 'Retraction and reasoning at #50.', createdAt: 'TA' },
          { id: '60', author: 'k', kind: 'finding', body: 'Base.', createdAt: 'TB' },
          { id: '61', author: 'l', kind: 'finding', body: 'I corrected the arithmetic, then re-ran #60.', createdAt: 'TC' },
          { id: '70', author: 'm', kind: 'finding', body: 'This supersedes the ruling in #4061.', createdAt: 'TD' },
          { id: '80', author: 'n', kind: 'finding', body: 'This supersedes the finding in #99.', createdAt: 'TE' },
          { id: '99', author: 'o', kind: 'finding', body: 'Written later.', createdAt: 'TF' },
          { id: '90', author: 'p', kind: 'note', body: 'A doorbell.', createdAt: 'TG' },
          { id: '91', author: 'q', kind: 'finding', body: 'This supersedes the note at #90.', createdAt: 'TH' }
        ]
      }
    ]
  };
  const sr = supersessions(sup);
  assert(sr.map.get(20)?.by === 21 && sr.map.get(21)?.by === 22, 'a claim chain supersedes every holder but the last');
  assert(!sr.map.has(22), 'the last holder of a key is current');
  assert(sr.map.get(20).how.includes('RELEASE'), 'the protocol mark names the verb that displaced the post');
  assert(sr.map.get(30)?.by === 32, 'an active reference marks its target, and the later of two claimants wins');
  assert(sr.map.get(30).author === 'f' && sr.map.get(30).how === 'superseded in a later post', 'the mark carries who and how');
  assert(!sr.map.has(40), 'a passive reference points at the replacement and marks nothing');
  assert(!sr.map.has(50), 'a conjunction attaches the reference to the second conjunct, not to the verb');
  assert(!sr.map.has(60), 'a verb near a number is not a reference to a post without a target word');
  assert(!sr.map.has(70) && sr.map.size === 4, 'a number the board does not hold resolves to nothing');
  assert(!sr.map.has(99) && !sr.map.has(80), 'a post supersedes neither itself nor a later one');
  assert(sr.accepted === 3 && sr.abstained === 3, 'both columns are measured: three accepted, three near misses refused');
  assert(sr.map.has(90) && !plan(sup).has('2/90.md'), 'a mark may land on an entry the corpus does not carry, so the two counts differ');

  const marked = plan(sup).get('2/30.md');
  assert(marked.includes('- superseded-by: #32'), 'the header names the post that replaced this one');
  assert(marked.split('⚠ SUPERSEDED').length === 3, 'the warning is written above the body and below it');
  assert(marked.includes('Read that post before acting on this one.'), 'the warning tells the reader what to do');
  assert(!plan(sup).get('2/22.md').includes('SUPERSEDED'), 'a current post carries no warning');

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
  const snapshot = JSON.parse(raw);
  const marks = supersessions(snapshot);
  const want = plan(snapshot);
  const n = sync(out, want);
  console.log(`board-corpus: ${n.written} written, ${n.kept} unchanged, ${n.removed} removed → ${out}`);
  /* The abstention column is printed beside the mark count so a tick is auditable: a reader can
     see at once whether a rule change stopped marking, or stopped examining. */
  const inCorpus = [...want.values()].filter((t) => t.includes('- superseded-by: #')).length;
  console.log(`board-corpus: ${marks.map.size} entry(s) marked superseded, ${inCorpus} of them indexed; ${marks.accepted} explicit reference(s) accepted, ${marks.abstained} abstained`);
}
