/*
 * table-provenance-core.mjs — the TABLE-PROVENANCE stamp reader, as one testable function.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHY THIS FILE EXISTS. The reader lived inside `tests/run-tests.mjs` as a closure over the tree, so
 * the only way to exercise it was to put a stamp in a committed document. Row
 * `2026-11-08-twenty-papers-carry-no-claim-marker-and-the-resolver-skips-papers` measured the cost of
 * that: the scan listed `briefs/ audits/ docs/` plus `CLAUDE.md`, so a stamp inside `papers/` went
 * unread, and no leg could say so because no leg could plant one. This module holds the parse, the
 * root list and the table-above walk, and the runner keeps the parts that need the tree and git.
 *
 * TWO TABLE SHAPES, ONE STAMP. A stamp binds the TEXT of the table immediately above it to the run
 * that produced it. In `briefs/`, `audits/`, `docs/` and `CLAUDE.md` a table is a contiguous block of
 * Markdown pipe rows. The papers are HTML, so there the table is a `<table>` element, and the hash is
 * over its raw lines. An HTML file is tried as HTML FIRST and as Markdown second, so a pipe table
 * inside an HTML page still resolves rather than reading as malformed.
 *
 * ABSENCE IS A NAMED REASON, NEVER A SILENT DROP (CLAUDE.md §∅, §4b). A marker with no table above it
 * lands in `malformed` with the file and line, because a stamp the reader cannot bind is the exact
 * state this mechanism exists to refuse.
 */

import { createHash } from 'node:crypto';
import { isCliEntry } from './argv-guard.mjs';

/** The stamp marker. Kept as one source so the runner and a test cannot drift apart. */
export const STAMP_RE = /<!--\s*TABLE-PROVENANCE\s+([^>]*?)-->/g;

/*
 * THE SCAN REACH, declared as data so a test can assert it names `papers`.
 *
 * `papers/` carries `.html` because the papers are HTML; the other roots stay `.md` only. `docs/`
 * deliberately does NOT take `.html`: it holds the served copies of the owned bundles, which are
 * megabyte-scale generated files with no stamp in them, and scanning them would cost the gate seconds
 * per run for a reach nothing uses. A stamp belongs beside the table a person reads, and in `docs/`
 * that page is the Markdown one.
 *
 * Each root is listed non-recursively, which is how the reader has always worked. `papers/figures/`
 * holds images, and a stamp inside a nested directory would go unread — that is a known bound of this
 * list, not an accident of a glob.
 */
export const STAMP_ROOTS = [
  { dir: 'briefs', exts: ['.md'] },
  { dir: 'audits', exts: ['.md'] },
  { dir: 'docs', exts: ['.md'] },
  { dir: 'papers', exts: ['.md', '.html'] }
];

/** The single-file roots, read whole rather than listed. */
export const STAMP_FILES = ['CLAUDE.md'];

export const sha12 = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);

/** @param {string} rel a repo-relative path */
export function stampExtOf(rel) {
  const m = String(rel || '').match(/\.[A-Za-z0-9]+$/);
  return m ? m[0].toLowerCase() : '';
}

/** Does this root accept this file? Keyed on the declared list, never on a guess. */
export function rootAccepts(root, rel) {
  return !!root && root.exts.includes(stampExtOf(rel));
}

/* A table inside a blockquote (`> | … |`, the house style for a dated correction block) is the same
   table: the quote prefix is stripped for detection AND for the hash, so quoting it does not move
   `output`. */
const unquote = (l) => String(l).replace(/^\s*(?:>\s?)+/, '');
const isPipeRow = (l) => unquote(l).trim().startsWith('|');

/**
 * The contiguous Markdown pipe block immediately above `fromIdx`.
 * Walking UP from the marker rather than down from a heading is what lets one file carry several.
 * @param {string[]} lines
 * @param {number} fromIdx 0-based index of the line holding the marker
 * @returns {string|null}
 */
export function pipeTableAbove(lines, fromIdx) {
  let i = fromIdx - 1;
  while (i >= 0 && !isPipeRow(lines[i])) i--;
  const end = i;
  while (i >= 0 && isPipeRow(lines[i])) i--;
  if (end < 0) return null;
  return lines
    .slice(i + 1, end + 1)
    .map(unquote)
    .join('\n');
}

/**
 * The `<table>` element immediately above `fromIdx`, hashed over its raw lines.
 * The close tag is found first and the open tag matched back from it, so the block is the element and
 * not everything since the last `<table`.
 * @param {string[]} lines
 * @param {number} fromIdx
 * @returns {string|null}
 */
export function htmlTableAbove(lines, fromIdx) {
  let end = -1;
  for (let i = fromIdx - 1; i >= 0; i--) {
    if (/<\/table\s*>/i.test(lines[i])) {
      end = i;
      break;
    }
    /* A non-blank line that is not part of a table ends the search: a stamp binds the table
       IMMEDIATELY above it, and reaching further would bind a table the reader never associates
       with this marker. */
    if (String(lines[i]).trim() !== '') break;
  }
  if (end < 0) return null;
  let start = -1;
  for (let i = end; i >= 0; i--) {
    if (/<table[\s>]/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Every stamp in one document.
 * @param {string} text the file's contents
 * @param {string} rel its repo-relative path, carried into each stamp and each reason
 * @returns {{stamps: object[], malformed: string[]}}
 */
export function parseStamps(text, rel) {
  const src = String(text || '');
  const lines = src.split('\n');
  const html = stampExtOf(rel) === '.html';
  const out = { stamps: [], malformed: [] };
  const re = new RegExp(STAMP_RE.source, 'g');
  /* `matchAll` and not a hand-advanced `exec` loop: the index is the iterator's, so no leg can
     read a stale `lastIndex`, and the repo's `noAssignInExpressions` warning does not apply. */
  for (const m of src.matchAll(re)) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w[\w-]*)=("([^"]*)"|\S+)/g)) attrs[a[1]] = a[3] !== undefined ? a[3] : a[2];
    const lineNo = src.slice(0, m.index).split('\n').length;
    const idx = lineNo - 1;
    const table = html ? (htmlTableAbove(lines, idx) ?? pipeTableAbove(lines, idx)) : pipeTableAbove(lines, idx);
    if (!attrs.producer || !attrs.output || !table) {
      out.malformed.push(`${rel}:${lineNo} — ${!table ? 'no table immediately above the marker' : 'missing producer= or output='}`);
      continue;
    }
    out.stamps.push({ file: rel, line: lineNo, ...attrs, table, actualOutput: sha12(table) });
  }
  return out;
}

/* ── SELFTEST ─────────────────────────────────────────────────────────────────────────────────────
   Planted documents, because the point of this module is that the reader can be exercised without a
   stamp in a committed file. Every case states what a failure would mean. */
function selftest() {
  let n = 0;
  const fail = [];
  const ok = (what, cond, detail) => {
    n++;
    if (!cond) fail.push(`${what}${detail ? ' — ' + detail : ''}`);
  };

  const mdTable = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const md = `# t\n\n${mdTable}\n\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="${sha12(mdTable)}" inputs=abcdefabcdef -->\n`;
  const r1 = parseStamps(md, 'briefs/X-BRIEF.md');
  ok('a Markdown stamp parses', r1.stamps.length === 1 && !r1.malformed.length, JSON.stringify(r1.malformed));
  ok('the Markdown hash is over the table alone', r1.stamps[0] && r1.stamps[0].actualOutput === r1.stamps[0].output);

  const htmlTable = '<table>\n<tr><th>a</th></tr>\n<tr><td>1</td></tr>\n</table>';
  const hp = `<h1>t</h1>\n${htmlTable}\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="${sha12(htmlTable)}" inputs=abcdefabcdef -->\n`;
  const r2 = parseStamps(hp, 'papers/p.html');
  ok('an HTML paper stamp parses', r2.stamps.length === 1 && !r2.malformed.length, JSON.stringify(r2.malformed));
  ok('the HTML hash is over the table element alone', r2.stamps[0] && r2.stamps[0].actualOutput === r2.stamps[0].output);
  ok('an edited HTML cell moves the hash', sha12(htmlTable.replace('>1<', '>2<')) !== sha12(htmlTable));

  const r3 = parseStamps(`${htmlTable}\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="deadbeefdead" -->\n`, 'papers/p.html');
  ok('a wrong HTML output hash parses and DISAGREES rather than being dropped', r3.stamps.length === 1 && r3.stamps[0].actualOutput !== r3.stamps[0].output);

  const r4 = parseStamps(`<h1>t</h1>\n\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="deadbeefdead" -->\n`, 'papers/p.html');
  ok('a marker with no table above is MALFORMED, never silent', !r4.stamps.length && r4.malformed.length === 1 && /no table immediately above/.test(r4.malformed[0]));

  const r5 = parseStamps(`${mdTable}\n<!-- TABLE-PROVENANCE output="deadbeefdead" -->\n`, 'briefs/X-BRIEF.md');
  ok('a stamp with no producer= is MALFORMED', !r5.stamps.length && /missing producer=/.test(r5.malformed[0] || ''));

  const pipeInHtml = `${mdTable}\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="${sha12(mdTable)}" -->\n`;
  const r6 = parseStamps(pipeInHtml, 'papers/p.html');
  ok('an HTML file falls back to a pipe table', r6.stamps.length === 1 && r6.stamps[0].actualOutput === r6.stamps[0].output, JSON.stringify(r6.malformed));

  const two = `${mdTable}\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="${sha12(mdTable)}" -->\n\n${mdTable}\n<!-- TABLE-PROVENANCE producer="tools/y.mjs" output="${sha12(mdTable)}" -->\n`;
  ok('one file carries several stamps', parseStamps(two, 'briefs/X-BRIEF.md').stamps.length === 2);

  const quoted = `> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n<!-- TABLE-PROVENANCE producer="tools/x.mjs" output="${sha12(mdTable)}" -->\n`;
  ok('a blockquoted table hashes the same as the bare one', parseStamps(quoted, 'briefs/X-BRIEF.md').stamps[0]?.actualOutput === sha12(mdTable));

  ok(
    'the scan reach names papers/',
    STAMP_ROOTS.some((r) => r.dir === 'papers')
  );
  ok(
    'papers/ accepts .html',
    rootAccepts(
      STAMP_ROOTS.find((r) => r.dir === 'papers'),
      'papers/p.html'
    )
  );
  ok(
    'docs/ does NOT accept .html',
    !rootAccepts(
      STAMP_ROOTS.find((r) => r.dir === 'docs'),
      'docs/x.html'
    )
  );
  ok(
    'briefs/ accepts .md',
    rootAccepts(
      STAMP_ROOTS.find((r) => r.dir === 'briefs'),
      'briefs/X-BRIEF.md'
    )
  );
  ok('an unrelated extension is accepted nowhere', !STAMP_ROOTS.some((r) => rootAccepts(r, 'x.txt')));

  if (fail.length) {
    for (const f of fail) process.stdout.write(`✗ ${f}\n`);
    process.stdout.write(`${fail.length} of ${n} assertions failed\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`table-provenance-core: ${n} assertions passed\n`);
}

if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest();
  else process.stdout.write('usage: node tools/table-provenance-core.mjs --selftest\n');
}
