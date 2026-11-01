#!/usr/bin/env node
/*
 * tools/memory-supersession.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH MEMORY LESSON LEADS WITH A RULING THE FLEET HAS ALREADY REPLACED
 * (residue `2026-10-28-a-replaced-owner-ruling-ranks-first-from-the-memory-corpus`).
 *
 * The board lane now marks a replaced post (`board-corpus.mjs`, #4064) and de-ranks it
 * (`xerj-query.mjs`, #4068). The memory corpus carries the same hazard and neither board signal
 * transfers: a session EDITS a memory file in place instead of posting a successor, so there is no
 * later file to date against and no claim protocol to read. Measured on the 2026-10-28 board,
 * doc-search ranked `ext:memory/two-open-prs-per-bird.md` (the replaced 2-PR cap) ABOVE
 * `ext:agent-board/1/605.md` (the one-PR ruling that replaced it), 0.033 against 0.032.
 *
 * THE ONE SIGNAL THAT DOES TRANSFER IS A CITATION. A memory lesson names the board post it came
 * from, and the board already knows which of its posts it replaced. So this tool reports every
 * memory file whose LEAD cites a post the board marked replaced — and reports it, nothing more.
 *
 * ⚠ IT WRITES NOTHING, AND NO TOOL MAY. The memory directory is shared between sessions,
 * un-versioned and has no conflict surface: a write races a peer with no symptom. A selftest leg
 * below pins that this file imports no write API. The remedy is a session editing its own lesson
 * so the current ruling LEADS, or declaring `superseded-by:` in the frontmatter, which
 * `xerj-query.mjs` then de-ranks.
 *
 * ⚠ A `#NNNN` IS MOSTLY A PR NUMBER, so a bare id decides nothing. A citation counts only when a
 * board word (`board`, `thread`, `entry`, `post`) sits within 24 characters before it AND the id
 * resolves to a post the board corpus marked. Measured 2026-11-01 over 760 memory files and 171
 * marked posts: 9 files cite a replaced post with that cue, 1 of them in the lead — exactly the
 * file the row measured — and 10 further files carry a bare lead id that resolves. Those 10 are
 * ABSTENTIONS, counted and printed beside the finding, never folded into it: the earlier hand
 * count of 18 lead citations was mostly PR numbers.
 *
 * THE LEAD IS WHAT RANKS. doc-search returns a CHUNK, and a file that corrects itself four
 * paragraphs down still leads with the replaced ruling. A lead that cites the successor TOO has
 * already done the work, so it is excluded and counted.
 *
 *   node tools/memory-supersession.mjs                  # the table, the counts and the remedy
 *   node tools/memory-supersession.mjs --json           # the tepna.verdict/1 object + every row
 *   node tools/memory-supersession.mjs --memory-root <p> --board-root <p>
 *   node tools/memory-supersession.mjs --verdict-sample # a sample object, reads nothing
 *   node tools/memory-supersession.mjs --selftest       # planted corpora, no filesystem
 *
 * PRIMARY DEV MACHINE ONLY, the same scope as doc-search: a root that does not resolve here is
 * NOT_RUN and exit 2 — it could not look, which is not the same as finding nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';
/* ONE reader for the marks and ONE resolver for the roots, imported rather than mirrored: a second
   copy of `- superseded-by:` drifts the day either corpus changes its header. */
import { BOARD_CORPUS, boardMark, externalRootPath, memoryMark } from './xerj-query.mjs';

export const TOOL = 'tools/memory-supersession.mjs';
const THREAD_DIR = /^\d+$/;
const ENTRY_FILE = /^(\d+)\.md$/;
/* The cue window is measured against the fleet's own prose: `board #560`, `board post #560`,
   `thread 7, entry #2678`. `[^.\n#]` keeps the span inside one sentence and stops it from
   swallowing an earlier id. */
export const CUE = /\b(?:board|thread|entry|entries|post|posts)\b[^.\n#]{0,24}#(\d{1,6})\b/gi;
export const BARE = /#(\d{1,6})\b/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const HOME = homedir();
export const tilde = (p) => (p == null ? null : String(p).startsWith(HOME) ? `~${String(p).slice(HOME.length)}` : String(p));

const readText = (p) => {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
};
const listDir = (p) => {
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
};

/** The frontmatter plus the first paragraph — what doc-search's first chunk of a file carries. */
export function leadOf(text) {
  const s = String(text ?? '');
  const fm = FRONTMATTER.exec(s);
  const body = fm ? s.slice(fm[0].length) : s;
  const first = body.replace(/^\s+/, '').split(/\r?\n[ \t]*\r?\n/)[0] ?? '';
  return (fm ? `${fm[1]}\n` : '') + first;
}

/** Every id the text cites under `re`, as numbers. */
export function citedIds(text, re) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) out.add(Number(m[1]));
  return out;
}

/**
 * `superseded board id → successor id`, read from the board corpus's OWN marks — the same header
 * `xerj-query.mjs` reads, so the two lanes can never disagree about which post is replaced.
 * `{ map: null }` means the root could not be listed: it could not look.
 */
export function boardReplacements(root, { readFn = readText, dirFn = listDir } = {}) {
  if (!root) return { map: null, reason: 'no board corpus root resolved on this machine', files: 0, unreadable: 0 };
  const threads = dirFn(root);
  if (threads === null) return { map: null, reason: `the board corpus is not readable at \`${tilde(root)}\``, files: 0, unreadable: 0 };
  const map = new Map();
  let files = 0;
  let unreadable = 0;
  for (const t of threads) {
    if (!THREAD_DIR.test(String(t))) continue;
    const entries = dirFn(join(root, t));
    if (entries === null) {
      unreadable++;
      continue;
    }
    for (const f of entries) {
      const m = ENTRY_FILE.exec(String(f));
      if (!m) continue;
      files++;
      const text = readFn(join(root, t, f));
      if (text === null || text === undefined) {
        unreadable++;
        continue;
      }
      const mark = boardMark(text);
      if (mark) map.set(Number(m[1]), mark);
    }
  }
  return { map, reason: null, files, unreadable };
}

/**
 * Every memory file against those marks. Rows are `{ file, cited, successor, where }`; a file is
 * excluded when it cannot be read, counted as `declared` when its frontmatter already carries a
 * mark, and counted as `selfCorrecting` when its lead cites the successor too.
 */
export function scanMemory({ memoryRoot, replacements, readFn = readText, dirFn = listDir } = {}) {
  if (!memoryRoot) return { ok: false, reason: 'no memory root resolved on this machine', rows: [], eligible: 0, checked: 0, excluded: 0 };
  const names = dirFn(memoryRoot);
  if (names === null) return { ok: false, reason: `the memory directory is not readable at \`${tilde(memoryRoot)}\``, rows: [], eligible: 0, checked: 0, excluded: 0 };
  const files = names.filter((f) => String(f).endsWith('.md')).sort();
  const rows = [];
  let checked = 0;
  let excluded = 0;
  let declared = 0;
  let selfCorrecting = 0;
  let abstained = 0;
  for (const f of files) {
    /* One file at a time, and only counts are kept: the memory directory is read by every session
       and a whole-corpus buffer is the greedy-script shape the owner ruled out. */
    const text = readFn(join(memoryRoot, f));
    if (text === null || text === undefined) {
      excluded++;
      continue;
    }
    checked++;
    if (memoryMark(text)) {
      declared++;
      continue;
    }
    const lead = leadOf(text);
    const leadCued = citedIds(lead, CUE);
    const leadBare = citedIds(lead, BARE);
    const allCued = citedIds(text, CUE);
    for (const id of leadBare) if (!leadCued.has(id) && replacements.has(id)) abstained++;
    for (const id of [...leadCued].sort((a, b) => a - b)) {
      if (!replacements.has(id)) continue;
      const successor = replacements.get(id);
      /* A lead naming both the replaced post and the one that replaced it already tells a reader
         which is current — the remedy, not the defect. */
      if (leadBare.has(Number(String(successor).replace(/^#/, '')))) {
        selfCorrecting++;
        continue;
      }
      rows.push({ file: f, cited: `#${id}`, successor: String(successor), where: 'lead' });
    }
    for (const id of [...allCued].sort((a, b) => a - b)) {
      if (!replacements.has(id) || leadCued.has(id)) continue;
      rows.push({ file: f, cited: `#${id}`, successor: String(replacements.get(id)), where: 'body' });
    }
  }
  return { ok: true, reason: null, rows, eligible: files.length, checked, excluded, declared, selfCorrecting, abstained };
}

export function buildVerdict({ scan, board, memoryRoot, boardRoot, commit }) {
  const base = {
    gate: 'memory-supersession',
    criterion: { name: 'lead_citations_of_replaced_board_post', threshold: 0, unit: 'files', direction: 'lte' },
    evidence: [TOOL, 'tools/xerj-query.mjs', 'briefs/RESIDUE.md'],
    tool: TOOL,
    commit,
    commitReason: 'the sample reads no checkout'
  };
  if (board.map === null || !scan.ok) {
    /* NOT_RUN reserves `result: null`: nothing was compared, so there is nothing to report. */
    return makeVerdict({ ...base, status: 'NOT_RUN', population: { checked: 0, eligible: 0, excluded: 0 }, result: null, reason: board.map === null ? board.reason : scan.reason });
  }
  const lead = scan.rows.filter((r) => r.where === 'lead');
  const body = scan.rows.filter((r) => r.where === 'body');
  const result = {
    memoryRoot: tilde(memoryRoot),
    boardRoot: tilde(boardRoot),
    memoryFiles: scan.eligible,
    boardEntries: board.files,
    markedReplaced: board.map.size,
    leadCitations: lead.length,
    leadFiles: [...new Set(lead.map((r) => r.file))].length,
    /* DIAGNOSTICS beside the pre-stated criterion, and none of them moves `status`: a body-only
       citation does not lead a chunk, an abstention was never decided, and a declared mark is
       already de-ranked by the reader. */
    bodyCitations: body.length,
    selfCorrectingLeads: scan.selfCorrecting,
    declaredMarks: scan.declared,
    abstainedBareLeadIds: scan.abstained,
    boardFilesUnreadable: board.unreadable
  };
  if (scan.checked === 0) {
    return makeVerdict({
      ...base,
      status: 'UNKNOWN',
      population: { checked: 0, eligible: scan.eligible, excluded: scan.excluded },
      result,
      reason: `all ${scan.excluded} memory file(s) were unreadable, so no lead was examined`
    });
  }
  return makeVerdict({
    ...base,
    status: lead.length === 0 ? 'PASS' : 'FAIL',
    population: { checked: scan.checked, eligible: scan.eligible, excluded: scan.excluded },
    result,
    reason: lead.length === 0 ? null : `${lead.length} memory lead(s) cite a replaced board post: ${lead.map((r) => `${r.file} ${r.cited}→${r.successor}`).join(', ')}`
  });
}

/* ── the sample ────────────────────────────────────────────────────────────────────────────────── */
export function sample() {
  const board = { map: new Map([[560, '#605']]), reason: null, files: 2700, unreadable: 0 };
  const scan = {
    ok: true,
    reason: null,
    rows: [{ file: 'two-open-prs-per-bird.md', cited: '#560', successor: '#605', where: 'lead' }],
    eligible: 760,
    checked: 760,
    excluded: 0,
    declared: 0,
    selfCorrecting: 0,
    abstained: 10
  };
  return buildVerdict({ scan, board, memoryRoot: join(HOME, 'memory'), boardRoot: join(HOME, 'board-corpus'), commit: null });
}

/* ── selftest ──────────────────────────────────────────────────────────────────────────────────── */
export function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (cond, what) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.log(`  ✕ ${what}`);
    }
  };

  const fm = (extra, body) => `---\nname: x\ndescription: ${body}\nmetadata:\n  type: feedback\n---\n\n${extra}\n`;
  const BOARD = { '1/560.md': '# Board #560\n\n- superseded-by: #605\n\nthe two-PR cap\n', '1/605.md': '# Board #605\n\none open PR per bird\n', '7/2678.md': '# Board #2678\n\nCLAIM a-row\n' };
  const dirFn = (p) => {
    const s = String(p);
    if (s === '/b') return ['1', '7', 'README.md'];
    if (s === '/b/1') return ['560.md', '605.md', 'notes.txt'];
    if (s === '/b/7') return ['2678.md'];
    if (s === '/m') return Object.keys(MEM);
    return null;
  };
  const boardRead = (p) => BOARD[String(p).replace('/b/', '')] ?? null;
  const MEM = {};
  const memRead = (p) => MEM[String(p).replace('/m/', '')] ?? null;
  const run = () => {
    const board = boardReplacements('/b', { readFn: boardRead, dirFn });
    const scan = scanMemory({ memoryRoot: '/m', replacements: board.map, readFn: memRead, dirFn });
    return { board, scan, verdict: buildVerdict({ scan, board, memoryRoot: '/m', boardRoot: '/b', commit: null }) };
  };

  const marks = boardReplacements('/b', { readFn: boardRead, dirFn });
  ok(marks.map.get(560) === '#605' && marks.map.size === 1, 'the replaced posts come from the board corpus’s own marks, not from a second reader');
  ok(marks.files === 3 && marks.unreadable === 0, 'only `<digits>.md` under `<digits>/` is an entry, so a README and a stray .txt are not board posts');

  MEM['two-open-prs-per-bird.md'] = fm('Posted as board #560: two open PRs per bird.', 'the cap is two open PRs per bird');
  let r = run();
  ok(r.scan.rows.length === 1 && r.scan.rows[0].where === 'lead' && r.scan.rows[0].successor === '#605', 'a lead that cites a replaced post with a board cue is the finding');
  ok(r.verdict.status === 'FAIL' && /two-open-prs-per-bird\.md #560→#605/.test(r.verdict.reason), '…and the verdict names the file, the post and its successor');
  ok(r.verdict.population.checked + r.verdict.population.excluded === r.verdict.population.eligible, 'checked + excluded = eligible');

  /* CONTROL: the remedy clears the finding. This is the measured instance, and the edit that fixes
     it is a session putting the current ruling in the lead. */
  MEM['two-open-prs-per-bird.md'] = fm('The cap is ONE open PR per bird, per #605. It replaced the 2-PR cap of board #560.', 'one open PR per bird');
  r = run();
  ok(r.scan.rows.length === 0 && r.scan.selfCorrecting === 1, 'a lead that cites the successor too has already told the reader which ruling is current');
  ok(r.verdict.status === 'PASS' && r.verdict.reason === null && r.verdict.evidence.length > 0, '…and the verdict reads PASS over a real population');

  MEM['two-open-prs-per-bird.md'] = `---\nname: x\ndescription: d\nsuperseded-by: one-pr-per-bird\nmetadata:\n  type: feedback\n---\n\nPosted as board #560.\n`;
  r = run();
  ok(r.scan.rows.length === 0 && r.scan.declared === 1, 'a file that declares its successor is already de-ranked by the reader, so it is counted and left alone');

  MEM['two-open-prs-per-bird.md'] = fm('Context.\n\nThe cap came from board #560.', 'd');
  r = run();
  ok(r.scan.rows.length === 1 && r.scan.rows[0].where === 'body', 'a citation below the lead is reported separately, because it is not what the chunk ranks');
  ok(r.verdict.status === 'PASS' && r.verdict.result.bodyCitations === 1, '…and it does not move the verdict, which judges leads');

  MEM['two-open-prs-per-bird.md'] = fm('The cap is two open PRs per bird, per #560.', 'd');
  r = run();
  ok(r.scan.rows.length === 0 && r.scan.abstained === 1, 'a BARE lead id abstains and is counted: most `#NNNN` in the corpus are PR numbers');

  MEM['two-open-prs-per-bird.md'] = fm('See board thread 1 for the cap, and the ruling in the archive, at #560.', 'd');
  r = run();
  ok(r.scan.rows.length === 0 && r.scan.abstained === 1, 'the cue window is 24 characters inside one sentence, so a distant board word decides nothing');

  MEM['two-open-prs-per-bird.md'] = fm('Posted as board #605.', 'd');
  r = run();
  ok(r.scan.rows.length === 0, 'CONTROL: a lead citing a post the board never marked is no finding');

  MEM['unreadable.md'] = null;
  MEM['two-open-prs-per-bird.md'] = fm('Posted as board #560.', 'd');
  r = run();
  ok(r.scan.excluded === 1 && r.scan.checked === 1 && r.verdict.population.eligible === 2, 'a memory file it cannot read is excluded and named in the population, never read as clean');
  delete MEM['unreadable.md'];

  const noBoard = boardReplacements('/nope', { readFn: boardRead, dirFn });
  const vNoBoard = buildVerdict({ scan: run().scan, board: noBoard, memoryRoot: '/m', boardRoot: '/nope', commit: null });
  ok(vNoBoard.status === 'NOT_RUN' && vNoBoard.result === null && /not readable/.test(vNoBoard.reason), 'a board corpus it cannot list is NOT_RUN with no result: it could not look');
  const vNoRoot = buildVerdict({
    scan: { ok: false, reason: 'no memory root resolved on this machine', rows: [], eligible: 0, checked: 0, excluded: 0 },
    board: marks,
    memoryRoot: null,
    boardRoot: '/b',
    commit: null
  });
  ok(vNoRoot.status === 'NOT_RUN' && /no memory root/.test(vNoRoot.reason), 'a memory root that does not resolve here is NOT_RUN too, and the operator run exits 2');
  const vNone = buildVerdict({
    scan: { ok: true, reason: null, rows: [], eligible: 3, checked: 0, excluded: 3, declared: 0, selfCorrecting: 0, abstained: 0 },
    board: marks,
    memoryRoot: '/m',
    boardRoot: '/b',
    commit: null
  });
  ok(vNone.status === 'UNKNOWN' && /unreadable/.test(vNone.reason), 'a population where every member was unreadable is UNKNOWN, never a pass over nothing');

  ok(sample().status === 'FAIL' && sample().producedBy.commit === null && sample().producedBy.commitReason, 'the sample is a valid object with no commit to resolve');

  /* ⚠ THE DIRECTORY IS SHARED, UN-VERSIONED AND HAS NO CONFLICT SURFACE. A write from here races a
     peer with no symptom, so this reader must carry no write API at all — pinned on the source
     rather than on a comment, with the names assembled so this leg cannot read its own prose. */
  const own = readFileSync(new URL(import.meta.url), 'utf-8');
  const writers = ['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'copyFile'].map((n) => `${n}Sync`);
  ok(
    writers.every((n) => !own.includes(n)),
    'this tool imports and names no filesystem write API: it reports, and a session edits its own lesson'
  );
  ok(leadOf('no frontmatter\n\nsecond para') === 'no frontmatter', 'a file with no frontmatter still has a lead');

  console.log(fail === 0 ? `\nall ${pass} selftests passed` : `\n${fail} selftest(s) FAILED (${pass} passed)`);
  return fail === 0 ? 0 : 1;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────── */
function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: ['--memory-root', '--board-root'], boolean: ['--json', '--selftest', '--verdict-sample'] }, { tool: TOOL });
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(sample()));
    return 0;
  }
  const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const boardRoot = opt('--board-root', BOARD_CORPUS);
  const memoryRoot = opt('--memory-root', externalRootPath('memory'));
  const board = boardReplacements(boardRoot);
  const scan = board.map === null ? { ok: false, reason: board.reason, rows: [], eligible: 0, checked: 0, excluded: 0 } : scanMemory({ memoryRoot, replacements: board.map });
  const v = buildVerdict({ scan, board, memoryRoot, boardRoot, commit: undefined });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ verdict: v, rows: scan.rows }, null, 2));
  } else {
    console.log(JSON.stringify(v));
    console.log('');
    console.log(`▸ memory corpus: ${tilde(memoryRoot)}  ·  board corpus: ${tilde(boardRoot)}`);
    if (v.status === 'NOT_RUN') {
      console.log(`  ${v.reason}`);
      return 2;
    }
    /* Leads first: that is the population the criterion judges, and a body row is a diagnostic. */
    const ordered = [...scan.rows].sort((a, b) => (a.where === b.where ? 0 : a.where === 'lead' ? -1 : 1));
    for (const r of ordered) console.log(`  ${r.where === 'lead' ? '✗ lead' : '· body'}  ${r.file}  ${r.cited} → ${r.successor}`);
    const x = v.result;
    console.log('');
    console.log(
      `  ${x.memoryFiles} memory file(s) against ${x.markedReplaced} replaced post(s): lead ${x.leadCitations} · body ${x.bodyCitations} · self-correcting ${x.selfCorrectingLeads} · declared ${x.declaredMarks} · abstained ${x.abstainedBareLeadIds}`
    );
    if (x.leadCitations > 0) {
      console.log('  Remedy, by a session editing its OWN lesson: put the current ruling in the lead and keep the replaced one below as history,');
      console.log('  or declare `superseded-by: <successor>` in the frontmatter, which `tools/xerj-query.mjs` de-ranks. No tool writes there.');
    }
  }
  return v.status === 'NOT_RUN' ? 2 : v.status === 'FAIL' ? 1 : 0;
}

if (isCliEntry(import.meta.url)) process.exit(main());
