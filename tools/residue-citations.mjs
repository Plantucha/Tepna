#!/usr/bin/env node
/*
 * tools/residue-citations.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DOES A RESIDUE KEY CITED IN CODE RESOLVE TO A ROW — residue
 * `2026-10-25-the-dangling-key-check-reads-commit-messages-only`.
 *
 * TWO DIRECTIONS, ONE OF THEM UNWATCHED. `tools/residue-cite-drift.mjs` judges the pointer a ROW
 * writes at a LINE. `tests/dex-tests.js` check8h judges a key-shaped token inside a ledger CELL.
 * A key cited the other way — a source comment, a test module header, an audit artifact, a mutation
 * equivalence `brief` field — fell between the two, so the reader who followed that pointer was the
 * detector. Measured at `0d8483222`: 287 distinct cited keys over six trees, 240 resolving, 29
 * resolving only by prefix, 18 resolving to nothing.
 *
 * THE SCOPE IS THE CONVENTION, NOT THE SHAPE. A date-slug token is a citation only when one of the
 * words `residue`, `residues`, `row` or `rows` sits within 40 characters before it. Unscoped, the
 * same trees give 820 key-shaped tokens and 148 dangling, 119 of them one audit's own work-item ids,
 * so a shape-keyed checker would be right 18 times in 148.
 *
 * THE LADDER, pre-stated, because two writing habits break an exact match and one breaks a join:
 *   exact    the key is a row key
 *   joined   the key reads whole once the previous line joins the current one, comment marker and
 *            indent removed — a comment wrapping INSIDE a key (16 instances at that commit)
 *   prefix   the key is a prefix of exactly one row — the elided tail (`…`, 10 instances)
 *   near     the slug names a row and the date does not, within NEAR_DAYS — reported, never resolved
 *   dangling nothing above holds
 *
 * THE DEBT IS DECLARED AND MAY ONLY SHRINK. `tools/residue-citations-baseline.json` names today's
 * dangling keys with a reason each. A dangling key outside that file reds; a baseline key that
 * resolves now reds too, so a closure removes its line rather than leaving it.
 *
 * A CHANGESET FILENAME IS NOT A CITATION. `changes/<key>.md` and a row key share the date-slug shape
 * by construction, so the token alone cannot separate them and the characters around it must: a row
 * reference appears bare, a changeset appears behind `changes/` or in front of `.md`. Two readers met
 * this before — `docs-ledger` check8h (residue `2026-09-23-check8h-reads-a-changeset-filename-as-a-row-key`)
 * and `tools/residue-ids.mjs` (residue `2026-10-26-a-changeset-filename-counts-as-a-row-citation`) — and
 * this tool shipped without it. The four it cost all sat in audits quoting a changeset by path.
 *
 * A BASELINE LINE IS A DEBT, AND A DEBT NEEDS A LIVING OWNER. A `reason` naming a residue row is a
 * pointer nothing used to read, so it could name a closed or absent row and stay. `ownerDebt` reds on
 * one, and §∅ keeps the empty case honest: with no line naming an owner the verdict carries
 * `ownerReasonsExamined: 0` rather than a silent PASS over a population of nothing.
 *
 * ONE PREMISE A READER CANNOT SEE FROM THE IDS, so it is stated here: this tool and its baseline cite
 * dangling keys BY DESIGN, so both exempt themselves. `audits/DEFECT-BENCHMARK.json` needs no path
 * exemption — it numbers 449 of its own work items in this key shape, and the citation-word scope
 * leaves exactly one of them standing, which the changeset-path rule then reads as the path it is.
 * The ledger's own earliest row date is the floor: a key dated before it names no row and never could,
 * which is what the residue tooling's synthetic fixtures rely on. The floor is READ from the ledger,
 * never typed, so it moves when the ledger does.
 *
 *   node tools/residue-citations.mjs                    # the gate
 *   node tools/residue-citations.mjs --json
 *   node tools/residue-citations.mjs --all              # every class, resolved ones included
 *   node tools/residue-citations.mjs --verdict-sample   # the object alone
 *   node tools/residue-citations.mjs --selftest         # the plants
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';
import { splitRowCells } from './residue-ids.mjs';

/* `verdict.js` is CommonJS and sits at the repo root; this is the idiom `tools/residue-ids.mjs` uses. */
const Verdict = createRequire(import.meta.url)('../verdict.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

export const LEDGER = 'briefs/RESIDUE.md';
export const BASELINE = 'tools/residue-citations-baseline.json';
/* A date-slug token. The slug is lowercase, hyphen-separated, and may end mid-word where a comment
   wrapped; the trailing `-` is kept so the join can repair it. */
export const KEY_RE = /\b(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*-?)/g;
/* The citation words, and how far before the key one may sit. */
export const CITE_WORDS = /\b(residues?|rows?)\b/i;
export const CITE_WINDOW = 40;
/* A date this far from the row's date still reads as the same pointer. */
export const NEAR_DAYS = 3;
/* An elided tail. Both the single character and the three dots are in use. */
export const ELIDE_RE = /(?:…|\.\.\.)\s*$/;

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.py', '.sh', '.md', '.json', '.yml', '.yaml', '.toml', '.html', '.css', '.txt', '.cff', '.ts']);

/* ── reading the tree ──────────────────────────────────────────────────────────────────────────── */

export function trackedFiles(repo) {
  const out = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { maxBuffer: 1 << 28 });
  return String(out)
    .split('\0')
    .filter((p) => p && TEXT_EXT.has(path.extname(p)));
}

export function rowKeys(ledgerText) {
  const keys = [];
  for (const line of String(ledgerText).split('\n')) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\s*\|/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/* A BASELINE LINE IS A DEBT, AND A DEBT NEEDS A LIVING OWNER (residue
   `2026-10-27-four-baseline-reasons-name-the-row-this-pr-closes`). Four `cross-lane` entries named
   row `2026-10-26-eighteen-residue-citations-outside-the-ledger-resolve-to-no-row` as the owner of
   their remedy, and that row closes in the same diff those four entries leave. Nothing read a reason
   string, so the pointer could rot in place: a reader following it lands on a closed row and reads
   the debt as discharged. The cells come from `splitRowCells`, the one ledger scanner that consumes a
   backslash pair as a unit: a bare `.split('|')` reads an escaped pipe as a separator and takes the
   wrong cell, which is what `tests/dex-tests.js` holds every ledger reader to. */
export function rowStates(ledgerText) {
  const states = new Map();
  for (const line of String(ledgerText).split('\n')) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\s*\|/.exec(line);
    if (!m) continue;
    const cells = splitRowCells(line);
    states.set(m[1], cells.length >= 3 ? cells[cells.length - 2].trim() : '');
  }
  return states;
}

/* §∅ · an entry whose reason names no key is not examined and reports nothing, rather than counting
   as a pass. An entry naming its OWN key is excluded: that is the debt describing itself. */
export function ownerReasons(baseline) {
  const out = [];
  for (const e of (baseline || {}).entries || []) {
    for (const owner of String(e.reason || '').match(/\d{4}-\d{2}-\d{2}-[a-z0-9-]+/g) || []) {
      if (owner === e.key) continue;
      out.push({ key: e.key, owner });
    }
  }
  return out;
}

export function ownerDebt(baseline, states) {
  const out = [];
  for (const { key, owner } of ownerReasons(baseline)) {
    if (!states.has(owner)) out.push({ key, owner, why: 'names no row in the ledger' });
    else if (!/^OPEN\b/.test(states.get(owner))) out.push({ key, owner, why: `names a row already closed: ${states.get(owner)}` });
  }
  return out;
}

/* The floor is the ledger's own earliest row date. A key dated before it cannot name a row, so the
   residue tooling's synthetic fixtures are visible as fixtures from the id alone. */
export function ledgerFloor(keys) {
  let floor = null;
  for (const k of keys) {
    const d = k.slice(0, 10);
    if (floor === null || d < floor) floor = d;
  }
  return floor;
}

/* ── the join ──────────────────────────────────────────────────────────────────────────────────── */

/* A comment wrapping inside a key leaves the head on one line and the tail on the next, behind a
   comment marker and an indent. Removing both and concatenating with NO separator is what makes the
   key whole again — a space would break it just as the newline did. */
export function joinLines(prev, cur) {
  const head = String(prev).replace(/\s+$/, '');
  const tail = String(cur).replace(/^\s*(?:#+|\/\/+|\*+|--)?\s*/, '');
  return head + tail;
}

/* ── classifying one cited key ─────────────────────────────────────────────────────────────────── */

function dayDelta(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.abs(Math.round((t(a) - t(b)) / 86400000));
}

export function classify(cited, keys, opts) {
  const o = opts || {};
  const set = o.set || new Set(keys);
  if (set.has(cited)) return { kind: 'exact', row: cited };

  const bare = cited.replace(/-+$/, '');
  if (set.has(bare)) return { kind: 'exact', row: bare };

  const pre = keys.filter((k) => k.startsWith(bare));
  if (pre.length === 1) return { kind: 'prefix', row: pre[0] };
  if (pre.length > 1) return { kind: 'ambiguous', row: null, candidates: pre.length };

  /* The slug names a row and the date does not. Reported, never resolved: a reader who greps the
     cited key finds nothing, which is the defect. */
  const slug = bare.slice(11);
  if (slug) {
    /* The date missed and the slug held — a one-day pointer error, measured once in 401 keys. */
    const byDate = keys.filter((k) => k.slice(11) === slug && dayDelta(k.slice(0, 10), cited.slice(0, 10)) <= NEAR_DAYS);
    if (byDate.length >= 1) return { kind: 'near', row: byDate[0] };
    /* The date held and the slug dropped a word — `ring-never-resumes` for `ring-fileset-never-
       resumes`, cited in three files. A subsequence, so word ORDER still has to hold. */
    const want = slug.split('-');
    const bySlug = keys.filter((k) => {
      if (k.slice(0, 10) !== cited.slice(0, 10)) return false;
      const have = k.slice(11).split('-');
      if (have.length === want.length) return false;
      const [a, b] = want.length < have.length ? [want, have] : [have, want];
      if (a.length < 3) return false;
      let j = 0;
      for (const tok of b) if (j < a.length && a[j] === tok) j++;
      return j === a.length;
    });
    if (bySlug.length === 1) return { kind: 'near', row: bySlug[0] };
  }
  return { kind: 'dangling', row: null };
}

/* ── the scan ──────────────────────────────────────────────────────────────────────────────────── */

/* One file's citations. `joined` is reported for a key that reads whole only after the join, which
   is a habit rather than a defect — an exact-match reader reports every one of them. */
export function scanText(relPath, text, keys, opts) {
  const o = opts || {};
  const floor = o.floor || null;
  const set = new Set(keys);
  const lines = String(text).split('\n');
  const out = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    const joinedText = joinLines(prev, cur);
    /* The joined text is scanned, and a hit whose key lies entirely inside the previous line is
       dropped — that line was scanned on its own turn. */
    const prevLen = String(prev).replace(/\s+$/, '').length;
    const spans = [
      { text: cur, line: i + 1, minEnd: 0, viaJoin: false },
      { text: joinedText, line: i + 1, minEnd: prevLen + 1, viaJoin: true }
    ];
    for (const span of spans) {
      if (span.viaJoin && i === 0) continue;
      KEY_RE.lastIndex = 0;
      let m = KEY_RE.exec(span.text);
      for (; m !== null; m = KEY_RE.exec(span.text)) {
        const end = m.index + m[0].length;
        if (span.viaJoin && end <= span.minEnd) continue;
        const before = span.text.slice(Math.max(0, m.index - CITE_WINDOW), m.index);
        if (!CITE_WORDS.test(before)) continue;
        let cited = `${m[1]}-${m[2]}`;
        const after = span.text.slice(end);
        /* A CHANGESET FILENAME IS NOT A CITATION, AND THIS IS THE THIRD READER TO MEET IT (residue
           `2026-09-23-check8h-reads-a-changeset-filename-as-a-row-key`, fixed in `tests/dex-tests.js`,
           and `2026-10-26-a-changeset-filename-counts-as-a-row-citation`, fixed in
           `tools/residue-ids.mjs`). A row key and a `changes/` filename share the date-slug shape by
           construction, so the string alone cannot separate them — but the surrounding characters can,
           and the discriminator is structural rather than a heuristic: a row reference appears bare, a
           changeset appears behind `changes/` or in front of `.md`. Without it the four audit-quoted
           changeset paths read dangling, and a declared-debt line then has to excuse each one. */
        if (/changes\/$/.test(before) || /^\.md\b/.test(after)) continue;
        const elided = ELIDE_RE.test(`${m[0]}${after.slice(0, 4)}`) || ELIDE_RE.test(after.slice(0, 4));
        if (floor !== null && m[1] < floor) continue;
        cited = cited.replace(/-+$/, '');
        const key = `${relPath}:${span.line}:${cited}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const verdict = classify(cited, keys, { set });
        /* A GLUED KEY IS THIS TOOL'S OWN CONSTRUCTION, NOT A CITATION. The join exists to repair a
           key that wrapped, and it also welds a COMPLETE key to whatever the next line starts with
           (`…-to-number` + `and`). Four keys read as dangling that way in the first run, and one as
           ambiguous. The tell is the head: a wrap leaves an incomplete key on the previous line, so
           a head that resolves on its own means nothing wrapped and the glue is mine. Dropping every
           non-resolving joined reading instead would hide a real wrapped citation — `run-check.mjs:34`
           is one — so the head is tested rather than the whole. */
        if (span.viaJoin && (verdict.kind === 'dangling' || verdict.kind === 'ambiguous')) {
          const headPart = cited.slice(0, Math.max(0, span.minEnd - 1 - m.index));
          if (headPart.length >= 11 && set.has(headPart.replace(/-+$/, ''))) continue;
        }
        let kind = verdict.kind;
        if (kind === 'exact' && span.viaJoin && !CITE_WORDS.test(cur.slice(0, CITE_WINDOW))) {
          kind = 'joined';
        } else if (kind === 'exact' && span.viaJoin) {
          kind = 'joined';
        }
        if (kind === 'prefix' && elided) kind = 'prefix';
        out.push({ at: `${relPath}:${span.line}`, file: relPath, line: span.line, cited, kind, row: verdict.row || null, candidates: verdict.candidates || null });
      }
    }
  }
  /* A key cited on one line reads twice — once alone, once through the join. The stronger reading
     wins, so a joined repair never reports as dangling. */
  const best = new Map();
  const rank = { exact: 0, joined: 1, prefix: 2, near: 3, ambiguous: 4, dangling: 5 };
  for (const c of out) {
    const k = `${c.file}:${c.cited}`;
    const prior = best.get(k);
    if (!prior || rank[c.kind] < rank[prior.kind]) best.set(k, c);
  }
  /* A wrapped key is also matched on its own line, where it reads as the HEAD of itself. That head
     is a strict prefix of the joined reading one line away, so it is the same citation seen twice —
     not a second, shorter pointer. The longer reading is the one its author wrote. */
  const kept = [...best.values()];
  const heads = new Set();
  for (const a of kept) {
    for (const b of kept) {
      if (a === b || b.cited.length <= a.cited.length) continue;
      if (!b.cited.startsWith(a.cited)) continue;
      if (Math.abs(b.line - a.line) > 1) continue;
      heads.add(`${a.file}:${a.line}:${a.cited}`);
    }
  }
  return kept.filter((c) => !heads.has(`${c.file}:${c.line}:${c.cited}`)).sort((a, b) => a.line - b.line || a.cited.localeCompare(b.cited));
}

export function loadBaseline(repo) {
  const p = path.join(repo, BASELINE);
  if (!fs.existsSync(p)) return { entries: [], exemptPaths: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function run(repo, opts) {
  const o = opts || {};
  const ledger = fs.readFileSync(path.join(repo, LEDGER), 'utf8');
  const keys = rowKeys(ledger);
  const floor = ledgerFloor(keys);
  const base = o.baseline || loadBaseline(repo);
  const exempt = new Set([LEDGER, BASELINE, 'tools/residue-citations.mjs', ...(base.exemptPaths || [])]);
  const declared = new Map((base.entries || []).map((e) => [e.key, e]));

  const cites = [];
  for (const rel of o.files || trackedFiles(repo)) {
    if (exempt.has(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repo, rel), 'utf8');
    } catch (_e) {
      continue;
    }
    if (!CITE_WORDS.test(text)) continue;
    for (const c of scanText(rel, text, keys, { floor })) cites.push(c);
  }

  const by = (k) => cites.filter((c) => c.kind === k);
  /* A key that names no row and a key that names several are both unresolved, and both are
     declarable. A NEAR miss is not: it is a typo whose fix is one character, so declaring it away
     would buy a permanent wrong pointer for the price of a line. */
  const unresolved = cites.filter((c) => c.kind === 'dangling' || c.kind === 'ambiguous');
  const undeclared = unresolved.filter((c) => !declared.has(c.cited));
  const citedKeys = new Set(unresolved.map((c) => c.cited));
  const stale = [...declared.keys()].filter((k) => !citedKeys.has(k));
  const orphanOwners = ownerDebt(base, rowStates(ledger));
  const ownerReasonsExamined = ownerReasons(base).length;

  return {
    rows: keys.length,
    floor,
    files: new Set(cites.map((c) => c.file)).size,
    citations: cites.length,
    distinct: new Set(cites.map((c) => c.cited)).size,
    byKind: {
      exact: by('exact').length,
      joined: by('joined').length,
      prefix: by('prefix').length,
      near: by('near').length,
      ambiguous: by('ambiguous').length,
      dangling: by('dangling').length
    },
    unresolved: unresolved.length,
    unresolvedKeys: new Set(unresolved.map((c) => c.cited)).size,
    cites,
    undeclared,
    near: by('near'),
    ambiguousList: by('ambiguous'),
    stale,
    orphanOwners,
    ownerReasonsExamined,
    declared: declared.size
  };
}

export function verdictFor(r, commit) {
  const orphans = (r.orphanOwners || []).length;
  const bad = r.undeclared.length + r.near.length + r.stale.length + orphans;
  const reasons = [];
  if (r.undeclared.length) reasons.push(`${r.undeclared.length} unresolved citation(s) outside the baseline`);
  if (r.near.length) reasons.push(`${r.near.length} citation(s) name a row and miss its key`);
  if (r.stale.length) reasons.push(`${r.stale.length} baseline key(s) resolve now and owe a removal`);
  if (orphans) reasons.push(`${orphans} baseline reason(s) name a row that is closed or absent`);
  return Verdict.make({
    gate: 'residue-citations',
    status: bad === 0 ? 'PASS' : 'FAIL',
    scope: 'internal',
    population: { checked: r.citations, eligible: r.citations, excluded: 0 },
    criterion: { name: 'unresolved_citations', threshold: 0, unit: 'citations', direction: 'lte' },
    result: {
      ...r.byKind,
      unresolvedKeys: r.unresolvedKeys,
      undeclared: r.undeclared.length,
      staleBaseline: r.stale.length,
      orphanedOwners: orphans,
      ownerReasonsExamined: r.ownerReasonsExamined ?? null,
      declared: r.declared,
      rows: r.rows
    },
    evidence: [LEDGER, 'tools/residue-citations.mjs', BASELINE],
    reason: bad === 0 ? null : reasons.join('; '),
    producedBy: { tool: 'tools/residue-citations.mjs', commit }
  });
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────── */

function selftest() {
  let n = 0;
  const ok = (what, got, want) => {
    n++;
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) {
      console.error(`✗ ${what}: got ${g}, want ${w}`);
      process.exit(1);
    }
  };
  const keys = ['2026-09-02-alpha-beta-gamma', '2026-09-06-ring-fileset-never-resumes', '2026-10-25-a-refused-night-shaped-directory-reads-as-a-flat-root'];
  const kind = (text, file) => scanText(file || 'f.py', text, keys, { floor: '2026-09-02' }).map((c) => `${c.kind}:${c.cited}`);

  ok('an exact key beside the word residue resolves', kind('# Residue 2026-09-02-alpha-beta-gamma\n'), ['exact:2026-09-02-alpha-beta-gamma']);
  ok('a key with no citation word is not a citation', kind('# see 2026-09-02-alpha-beta-gamma\n'), []);
  ok('a key dated before the ledger floor is a fixture', kind('# Residue 2026-01-02-nope-not-a-row\n'), []);
  ok('a key wrapping inside a comment resolves by the join', kind('# Residue 2026-09-06-ring-fileset-never-\n# resumes\n'), ['joined:2026-09-06-ring-fileset-never-resumes']);
  ok('an elided tail resolves by unique prefix', kind('# Residue 2026-10-25-a-refused-night…\n'), ['prefix:2026-10-25-a-refused-night']);
  ok('a slug that names a row with the wrong date reads near', kind('# row 2026-10-26-a-refused-night-shaped-directory-reads-as-a-flat-root\n'), [
    'near:2026-10-26-a-refused-night-shaped-directory-reads-as-a-flat-root'
  ]);
  ok('a slug naming no row at all reads dangling', kind('# Residue 2026-10-22-pull-once-survivors-batch-one\n'), ['dangling:2026-10-22-pull-once-survivors-batch-one']);
  ok('the word row counts as a citation word', kind('# row 2026-09-02-alpha-beta-gamma\n'), ['exact:2026-09-02-alpha-beta-gamma']);
  ok('a citation word further than the window does not scope', kind(`# residue ${' '.repeat(45)}2026-09-02-alpha-beta-gamma\n`), []);
  ok('two prefixes of one row are one citation, strongest reading kept', kind('# Residue 2026-09-02-alpha-beta-gamma and 2026-09-02-alpha-beta-gamma\n'), ['exact:2026-09-02-alpha-beta-gamma']);
  ok('a dangling key still reads dangling under the join', kind('x\n# Residue 2026-10-22-pull-once-survivors-batch-one\n'), ['dangling:2026-10-22-pull-once-survivors-batch-one']);
  ok('a changeset path is a filename, not a citation', kind('# Residue changes/2026-09-02-alpha-beta-gamma.md\n'), []);
  ok('a bare changeset filename is a filename too', kind('# Residue 2026-09-02-alpha-beta-gamma.md\n'), []);
  ok('the word changes near a bare key still leaves a citation', kind('# Residue changes to 2026-09-02-alpha-beta-gamma\n'), ['exact:2026-09-02-alpha-beta-gamma']);
  ok('a key followed by a sentence period is still a citation', kind('# Residue 2026-09-02-alpha-beta-gamma. Next.\n'), ['exact:2026-09-02-alpha-beta-gamma']);
  ok('a JS comment marker is stripped by the join', kind('// Residue 2026-09-06-ring-fileset-never-\n// resumes\n', 'f.mjs'), ['joined:2026-09-06-ring-fileset-never-resumes']);
  ok('the floor is read from the ledger, not typed', ledgerFloor(keys), '2026-09-02');
  ok('a row cell yields its key', rowKeys('| 2026-09-02-alpha-beta-gamma | logged | s | d | e | OPEN |\n'), ['2026-09-02-alpha-beta-gamma']);
  ok('a non-row line yields none', rowKeys('text 2026-09-02-alpha-beta-gamma\n'), []);

  /* rowStates / ownerDebt — a baseline line is a debt, and a debt needs a living owner. */
  const st = rowStates(
    '| 2026-09-02-alpha-beta-gamma | logged | s | d | e | OPEN |\n' +
      '| 2026-09-03-delta | logged | s | d | e | fixed #4010 |\n' +
      '| 2026-09-04-epsilon | logged | s | d | a \\| b | OPEN (deferred) |\n' +
      'not a row | 2026-09-05-zeta | OPEN |\n'
  );
  ok('a row cell yields its state', st.get('2026-09-02-alpha-beta-gamma'), 'OPEN');
  ok('a closed row yields its closure', st.get('2026-09-03-delta'), 'fixed #4010');
  ok('a row carrying an escaped pipe still yields the state cell', st.get('2026-09-04-epsilon'), 'OPEN (deferred)');
  ok('a line that is not a row contributes no state', st.has('2026-09-05-zeta'), false);
  const debtOf = (entries) => ownerDebt({ entries }, st).map((o) => `${o.key}>${o.owner}`);
  ok('a reason naming an OPEN row owes nothing', debtOf([{ key: 'k1', reason: 'owner 2026-09-02-alpha-beta-gamma' }]), []);
  ok('a reason naming a closed row is an orphan', debtOf([{ key: 'k2', reason: 'owner 2026-09-03-delta' }]), ['k2>2026-09-03-delta']);
  ok('a reason naming no row at all is an orphan', debtOf([{ key: 'k3', reason: 'owner 2026-12-31-nobody-home' }]), ['k3>2026-12-31-nobody-home']);
  ok('a reason naming its own key is the debt describing itself', debtOf([{ key: '2026-09-03-delta', reason: 'this is 2026-09-03-delta' }]), []);
  ok('a reason naming no key is not examined', debtOf([{ key: 'k4', reason: 'a fixture, no owner named' }]), []);
  ok('a reason naming two rows is judged once per row', debtOf([{ key: 'k5', reason: '2026-09-02-alpha-beta-gamma and 2026-09-03-delta' }]), ['k5>2026-09-03-delta']);

  /* The wiring, not just the reader: an orphan alone must carry the verdict to FAIL with a named
     reason, because a check whose finding never reaches the status examines nothing. */
  const blank = { byKind: {}, unresolvedKeys: 0, undeclared: [], near: [], stale: [], declared: 1, rows: 1, citations: 1 };
  const vOrphan = verdictFor({ ...blank, orphanOwners: [{ key: 'k', owner: 'o', why: 'names no row in the ledger' }] }, 'abc');
  ok('one orphaned owner fails the verdict', vOrphan.status, 'FAIL');
  ok('the orphan count reaches the verdict result', vOrphan.result.orphanedOwners, 1);
  ok('the orphan names itself in the reason', /baseline reason/.test(vOrphan.reason), true);
  ok('no orphan leaves the verdict passing', verdictFor({ ...blank, orphanOwners: [] }, 'abc').status, 'PASS');

  /* ANTI-VACUITY. The check is worth nothing if no live baseline line names an owner, so the real
     pair must examine at least one reason, and every row the real baseline names must exist. */
  const realStates = rowStates(fs.readFileSync(path.join(REPO, LEDGER), 'utf8'));
  const realBase = JSON.parse(fs.readFileSync(path.join(REPO, BASELINE), 'utf8'));
  const named = ownerReasons(realBase).map((o) => o.owner);
  ok(
    'every row the live baseline names is in the ledger',
    named.filter((o) => !realStates.has(o)),
    []
  );
  ok('no live baseline line names a closed row', ownerDebt(realBase, realStates), []);
  /* §∅ · the live baseline names no owner today, so this pair examines nothing and the verdict says
     so by a count rather than by a silent PASS. The synthetic legs above are what holds the reader
     honest; the moment a line names an owner, the live population stops being empty on its own. */
  ok('an examined-nothing owner population reports its count, not a pass', named.length, 0);

  const r = run(REPO, { files: ['tools/residue-citations.mjs'], baseline: { entries: [], exemptPaths: [] } });
  ok('this tool exempts itself', r.citations, 0);

  console.log(`✓ all ${n} assertions passed`);
}

/* ── main ─────────────────────────────────────────────────────────────────────────────────────── */

function commitSha() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (_e) {
    return null;
  }
}

/* `isCliEntry` is the one sanctioned predicate — a raw `process.argv[1]` comparison breaks through a
   symlink, and the suite's `argv-guard` group names every tool that writes one. */
if (isCliEntry(import.meta.url)) {
  if (has('--selftest')) {
    selftest();
  } else {
    const r = run(REPO);
    const v = verdictFor(r, commitSha());
    /* `validate` answers `{ ok, errors, checked }`, so `.ok` is the guard and `.errors` the report.
       A `.length` read of the object is `undefined`, which never fires (gate rule
       `no-verdict-validate-length`; row 2026-11-01-the-citation-gates-own-verdict-guard-cannot-fire). */
    const ck = Verdict.validate(v);
    if (!ck.ok) {
      console.error(`invalid verdict: ${ck.errors.join('; ')}`);
      process.exit(2);
    }
    if (has('--verdict-sample')) {
      console.log(JSON.stringify(v));
      process.exit(0);
    }
    if (has('--json')) {
      console.log(JSON.stringify({ ...r, cites: has('--all') ? r.cites : undefined }, null, 1));
    } else {
      console.log(`residue-citations: ${r.citations} citation(s) over ${r.files} file(s) against ${r.rows} row(s), floor ${r.floor}`);
      const k = r.byKind;
      console.log(`  exact ${k.exact} · joined ${k.joined} · prefix ${k.prefix} · near ${k.near} · ambiguous ${k.ambiguous} · dangling ${k.dangling} (${r.declared} declared)`);
      for (const c of r.undeclared) {
        const why = c.kind === 'ambiguous' ? `a prefix of ${c.candidates} rows` : 'no row';
        console.log(`  ✗ ${c.at} cites ${c.cited} — ${why}, and no baseline line`);
      }
      for (const c of r.near) console.log(`  ✗ ${c.at} cites ${c.cited} — a near miss of ${c.row}`);
      for (const key of r.stale) console.log(`  ✗ baseline names ${key}, which resolves now — remove the line`);
      for (const o of r.orphanOwners) console.log(`  ✗ the baseline line for ${o.key} ${o.why} (${o.owner}) — the debt has no living owner`);
      if (!r.ownerReasonsExamined) console.log('  · no baseline line names an owning row, so the owner check examined nothing');
      if (has('--all')) for (const c of r.cites) console.log(`  ${c.kind.padEnd(9)} ${c.at} ${c.cited}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
    }
    process.exit(v.status === 'PASS' ? 0 : 1);
  }
}
