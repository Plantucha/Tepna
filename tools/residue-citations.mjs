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
import os from 'node:os';
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

/* THE LIVING-OWNER RULE COVERED ONE BASELINE OF FOUR (residue
   `2026-11-11-the-living-owner-rule-covers-one-baseline-of-four`). `ownerDebt` read the baseline above
   and nothing else, and no other tool imported it, so a debt line in another baseline could name a row
   the ledger had closed and no gate redded. The set is DECLARED, never globbed: a new baseline joins it
   on purpose, and a member this process cannot read fails closed in `loadOwnerBaselines`.
   `shape: 'entries'` is an array of `{ key, reason }`; `shape: 'map'` is an object of id to reason. The
   foreign members stay OUT of the citation `exempt` set below, because their keys resolve to real rows
   and the citation population answers a different question. */
export const FOREIGN_OWNER_BASELINES = [
  { file: 'tools/paper-reference-baseline.json', container: 'uninvoked', shape: 'map' },
  { file: 'tools/paper-claim-marker-baseline.json', container: 'unmarked', shape: 'map' }
];
export const OWNER_BASELINES = [{ file: BASELINE, container: 'entries', shape: 'entries' }, ...FOREIGN_OWNER_BASELINES];

/* A FILE-LEVEL FIELD IS PROVENANCE, NOT A DEBT OWNER, so it is excluded by declaration and counted.
   `tools/brief-header-claim-baseline.json` carries one `residue` field naming the row that CREATED the
   file, and the ledger closed that row when the ratchet shipped. A closed origin row is the normal end
   of a fix. A PER-ENTRY reason is the other thing: it names the owner of a remedy still owed, and that
   owner must be alive. The row logging this defect read the field as a debt line, and it is not one. */
export const OWNER_PROVENANCE_FIELDS = [{ file: 'tools/brief-header-claim-baseline.json', field: 'residue', why: 'names the row that created the baseline, never the owner of an unpaid remedy' }];
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

/* A tracked path the working tree has deleted is not in the population: the tree being scanned
   removed it on purpose, so it holds no citation and no read is owed. `release.mjs` stamps a release
   by deleting every consumed changeset before `npm run check` runs, and after #4571 the scan read
   each of those deletions as an unreadable file and answered UNKNOWN, which held the v2.29.0 release
   at its gate on 2026-11-08 with 80 ENOENT paths. A file that is present and cannot be opened
   (EACCES) still counts as excluded. */
export function trackedFiles(repo) {
  const ls = (...a) => String(execFileSync('git', ['-C', repo, 'ls-files', '-z', ...a], { maxBuffer: 1 << 28 })).split('\0');
  const deleted = new Set(ls('--deleted'));
  return ls().filter((p) => p && !deleted.has(p) && TEXT_EXT.has(path.extname(p)));
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
  /* An ARRAY is the normalised pair list `loadOwnerBaselines` returns, and each pair carries the file
     it came from. An OBJECT is one baseline's own `entries`, which is the call every earlier reader
     makes, so both shapes stay legal. */
  const entries = Array.isArray(baseline) ? baseline : (baseline || {}).entries || [];
  const out = [];
  for (const e of entries) {
    for (const owner of String(e.reason || '').match(/\d{4}-\d{2}-\d{2}-[a-z0-9-]+/g) || []) {
      if (owner === e.key) continue;
      out.push({ key: e.key, owner, file: e.file || null });
    }
  }
  return out;
}

export function ownerDebt(baseline, states) {
  const out = [];
  for (const { key, owner, file } of ownerReasons(baseline)) {
    if (!states.has(owner)) out.push({ key, owner, file: file || null, why: 'names no row in the ledger' });
    else if (!/^OPEN\b/.test(states.get(owner))) out.push({ key, owner, file: file || null, why: `names a row already closed: ${states.get(owner)}` });
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

/* ∅ FAIL CLOSED. A declared baseline this process cannot open, or one whose container field is absent
   or the wrong type, is NOT a baseline holding no debt. Each such file rides a `{ file, code }` entry,
   and `verdictFor` turns an unread member into UNKNOWN rather than a pass over what it never read. */
export function loadOwnerBaselines(repo, specs) {
  const pairs = [];
  const unreadable = [];
  for (const spec of specs || FOREIGN_OWNER_BASELINES) {
    let json = null;
    try {
      json = JSON.parse(fs.readFileSync(path.join(repo, spec.file), 'utf8'));
    } catch (err) {
      unreadable.push({ file: spec.file, code: err.code || 'EPARSE' });
      continue;
    }
    const got = json[spec.container];
    if (spec.shape === 'entries') {
      if (!Array.isArray(got)) {
        unreadable.push({ file: spec.file, code: `NO-CONTAINER:${spec.container}` });
        continue;
      }
      for (const e of got) pairs.push({ key: e.key, reason: e.reason, file: spec.file });
      continue;
    }
    if (!got || typeof got !== 'object' || Array.isArray(got)) {
      unreadable.push({ file: spec.file, code: `NO-CONTAINER:${spec.container}` });
      continue;
    }
    for (const [k, v] of Object.entries(got)) pairs.push({ key: k, reason: typeof v === 'string' ? v : (v || {}).reason || '', file: spec.file });
  }
  return { pairs, unreadable };
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
  /* ∅ A FILE NOBODY COULD READ IS NOT A FILE HOLDING NO CITATION. The read sat in a `catch` that
     ran `continue`, and the verdict's population was keyed on CITATIONS with a literal `excluded: 0`,
     so a file this process could not open left no trace anywhere. A citation inside it is not a
     citation the scan declined to score; it is a citation the scan never saw, and `checked === eligible`
     published that as a clean sweep. Each unreadable path is now held with its errno, and the
     population counts the unit this loop SELECTS over — files — so an unopened file lands in
     `excluded` exactly as the `continue` excluded it.
     Row 2026-11-07-residue-citations-skips-an-unreadable-file-and-claims-0-excluded.

     THE DECLARED EXEMPTIONS ARE NOT ELIGIBLE. `exempt` names the ledger, the baseline and this tool by
     rule, the way the ledger floor names a date: they sit outside the set the gate binds, never inside
     it as members the scan failed to reach. They are counted and reported, and they stay out of
     `eligible`. The cite-word fast path is the opposite case: that file WAS read and the regex IS the
     examination, so it counts as checked and is reported beside the carriers. */
  const unreadable = [];
  let filesExempt = 0;
  let filesOffered = 0;
  let filesRead = 0;
  let filesNoCiteWord = 0;
  for (const rel of o.files || trackedFiles(repo)) {
    if (exempt.has(rel)) {
      filesExempt += 1;
      continue;
    }
    filesOffered += 1;
    let text;
    try {
      text = fs.readFileSync(path.join(repo, rel), 'utf8');
    } catch (e) {
      /* The errno, never the message: a node message carries the absolute path of whoever ran the gate. */
      unreadable.push({ file: rel, code: (e && e.code) || 'UNKNOWN' });
      continue;
    }
    filesRead += 1;
    if (!CITE_WORDS.test(text)) {
      filesNoCiteWord += 1;
      continue;
    }
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

  /* A DECLARED SITE IS A PATH, AND THE SCAN IS WHAT SAYS WHERE THE KEY SITS. Each baseline entry
     carried a `path:line` pointer that no reader held against anything, so every line drifted while
     the verdict still reported `staleBaseline 0`: a declaration nothing consumes ages in silence
     (row 2026-11-08-the-residue-citations-baseline-sites-read-stale). A line number ages on every
     edit above it, so the declaration keeps the PATH alone and the report prints the live
     `path:line` the scan found. The hold runs BOTH ways. A declared path the scan does not cite is
     a pointer at nothing, and a path it does cite that the baseline omits is a carrier nobody
     declared. A key that resolves now is not examined here, because `stale` above is its one
     finding. §∅ · an entry with no `sites` array declared nothing, which is not the same as
     declaring the empty set, so it reports that absence by name. */
  const siteOf = (k) => unresolved.filter((c) => c.cited === k);
  const siteDrift = [];
  const liveSites = [];
  for (const [key, e] of declared) {
    if (!citedKeys.has(key)) continue;
    const at = siteOf(key)
      .map((c) => c.at)
      .sort();
    const found = [...new Set(siteOf(key).map((c) => c.file))].sort();
    liveSites.push({ key, at, found });
    const dec = Array.isArray(e.sites) ? [...new Set(e.sites)].sort() : null;
    if (dec === null) {
      siteDrift.push({ key, declared: null, found, at, declaredOnly: [], foundOnly: found, why: 'declares no sites array' });
      continue;
    }
    const declaredOnly = dec.filter((q) => !found.includes(q));
    const foundOnly = found.filter((q) => !dec.includes(q));
    if (declaredOnly.length || foundOnly.length) siteDrift.push({ key, declared: dec, found, at, declaredOnly, foundOnly, why: null });
  }
  const siteKeysExamined = liveSites.length;

  /* The owner half reads EVERY declared baseline, not this tool's own alone. `o.baseline` stays
     authoritative for its own file, so a leg that injects entries still judges what it injected. */
  const ownerSpecs = o.ownerBaselines || FOREIGN_OWNER_BASELINES;
  const foreignOwners = loadOwnerBaselines(repo, ownerSpecs);
  const ownerPairs = [...(base.entries || []).map((e) => ({ key: e.key, reason: e.reason, file: BASELINE })), ...foreignOwners.pairs];
  const orphanOwners = ownerDebt(ownerPairs, rowStates(ledger));
  const ownerNamed = ownerReasons(ownerPairs);
  const ownerReasonsExamined = ownerNamed.length;
  const ownerReasonsByFile = {};
  for (const o of ownerNamed) ownerReasonsByFile[o.file || BASELINE] = (ownerReasonsByFile[o.file || BASELINE] || 0) + 1;
  const ownerBaselinesUnread = foreignOwners.unreadable;
  const ownerSpecsDeclared = [BASELINE, ...ownerSpecs.map((x) => x.file)];

  return {
    rows: keys.length,
    floor,
    files: new Set(cites.map((c) => c.file)).size,
    filesOffered,
    filesRead,
    filesExempt,
    filesNoCiteWord,
    unreadable,
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
    siteDrift,
    liveSites,
    siteKeysExamined,
    orphanOwners,
    ownerReasonsExamined,
    ownerReasonsByFile,
    ownerBaselinesUnread,
    ownerSpecsDeclared,
    declared: declared.size
  };
}

export function verdictFor(r, commit) {
  const orphans = (r.orphanOwners || []).length;
  const unreadable = r.unreadable || [];
  const drift = r.siteDrift || [];
  const bad = r.undeclared.length + r.near.length + r.stale.length + orphans + drift.length;
  const reasons = [];
  if (r.undeclared.length) reasons.push(`${r.undeclared.length} unresolved citation(s) outside the baseline`);
  if (r.near.length) reasons.push(`${r.near.length} citation(s) name a row and miss its key`);
  if (r.stale.length) reasons.push(`${r.stale.length} baseline key(s) resolve now and owe a removal`);
  if (orphans) reasons.push(`${orphans} baseline reason(s) name a row that is closed or absent`);
  if (drift.length) reasons.push(`${drift.length} baseline site(s) do not name the path the scan found the key at`);
  const ownerUnread = r.ownerBaselinesUnread || [];
  if (ownerUnread.length)
    reasons.push(
      `${ownerUnread.length} declared owner baseline(s) could not be read (${ownerUnread.map((u) => `${u.file} ${u.code}`).join(', ')}), so the owner check did not examine its whole population`
    );
  if (unreadable.length)
    reasons.push(`${unreadable.length} eligible file(s) could not be read (${unreadable.map((u) => `${u.file} ${u.code}`).join(', ')}), so the scan did not examine its whole population`);
  /* THREE STATUSES, AND THE MIDDLE ONE IS THE ROW. A finding is FAIL whatever else happened, and the
     unread file rides that reason beside it. With no finding and a file the scan could not open, the
     gate cannot say that no citation is unresolved — the file it never read may hold one — so it
     answers UNKNOWN and names the path and the errno. PASS is left for a sweep that read every
     eligible file. */
  const status = bad > 0 ? 'FAIL' : unreadable.length + ownerUnread.length > 0 ? 'UNKNOWN' : 'PASS';
  return Verdict.make({
    gate: 'residue-citations',
    status,
    scope: 'internal',
    population: { checked: r.filesRead, eligible: r.filesOffered, excluded: unreadable.length },
    criterion: { name: 'unresolved_citations', threshold: 0, unit: 'citations', direction: 'lte' },
    result: {
      ...r.byKind,
      citations: r.citations,
      filesWithACitation: r.files,
      filesWithoutCiteWord: r.filesNoCiteWord,
      filesExemptByRule: r.filesExempt,
      unreadableFiles: unreadable,
      unresolvedKeys: r.unresolvedKeys,
      undeclared: r.undeclared.length,
      staleBaseline: r.stale.length,
      siteDrift: drift.length,
      siteKeysExamined: r.siteKeysExamined ?? null,
      orphanedOwners: orphans,
      ownerReasonsExamined: r.ownerReasonsExamined ?? null,
      ownerReasonsByFile: r.ownerReasonsByFile || {},
      ownerBaselinesDeclared: (r.ownerSpecsDeclared || [BASELINE]).length,
      ownerBaselinesUnread: ownerUnread,
      ownerProvenanceFieldsExcluded: OWNER_PROVENANCE_FIELDS.length,
      declared: r.declared,
      rows: r.rows
    },
    evidence: [LEDGER, 'tools/residue-citations.mjs', ...(r.ownerSpecsDeclared || [BASELINE])],
    reason: status === 'PASS' ? null : reasons.join('; '),
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
  const blank = {
    byKind: {},
    unresolvedKeys: 0,
    undeclared: [],
    near: [],
    stale: [],
    declared: 1,
    rows: 1,
    citations: 1,
    files: 1,
    filesOffered: 1,
    filesRead: 1,
    filesExempt: 0,
    filesNoCiteWord: 0,
    unreadable: []
  };
  const vOrphan = verdictFor({ ...blank, orphanOwners: [{ key: 'k', owner: 'o', why: 'names no row in the ledger' }] }, 'abc');
  ok('one orphaned owner fails the verdict', vOrphan.status, 'FAIL');
  ok('the orphan count reaches the verdict result', vOrphan.result.orphanedOwners, 1);
  ok('the orphan names itself in the reason', /baseline reason/.test(vOrphan.reason), true);
  ok('no orphan leaves the verdict passing', verdictFor({ ...blank, orphanOwners: [] }, 'abc').status, 'PASS');

  /* ∅ AN UNREADABLE ELIGIBLE FILE IS AN EXCLUSION, NOT A CLEAN SCAN. The path below is handed to the
     scan as its whole offer and the tree does not hold it, so the read throws where a real EACCES or a
     vanished tracked file throws. Row
     2026-11-07-residue-citations-skips-an-unreadable-file-and-claims-0-excluded. */
  const gone = run(REPO, { files: ['tools/no-such-file-the-citation-scan-cannot-open.mjs'], baseline: { entries: [], exemptPaths: [] } });
  ok(
    'an unreadable eligible file is held with its errno',
    gone.unreadable.map((u) => u.code),
    ['ENOENT']
  );
  ok('…and it is offered, never read', [gone.filesOffered, gone.filesRead], [1, 0]);
  /* A 7-hex sha, because this leg runs `validate`, which reads `producedBy.commit` as the contract
     spells it: the other legs above read a status alone and never reach that invariant. */
  const vGone = verdictFor(gone, 'ab1c2d3');
  ok('…the verdict cannot pass over a file it never opened', vGone.status, 'UNKNOWN');
  ok('…and the population excludes it', vGone.population, { checked: 0, eligible: 1, excluded: 1 });
  ok('…the reason names the path and the errno', /no-such-file-the-citation-scan-cannot-open\.mjs ENOENT/.test(vGone.reason), true);
  ok('…and the object is valid under the contract', Verdict.validate(vGone).ok, true);
  /* CONTROL · a finding outranks the unread file, because FAIL is the stronger answer and the reason
     carries both. An UNKNOWN here would hide a citation the gate did resolve against no row. */
  const vBoth = verdictFor({ ...gone, undeclared: [{ cited: 'k', at: 'f:1' }], unresolvedKeys: 1, declared: 1, rows: 1 }, 'abc');
  ok('CONTROL · a finding beside an unread file is still FAIL', vBoth.status, 'FAIL');

  /* A TRACKED FILE THE TREE DELETED IS OUTSIDE THE OFFER. A scratch repo tracks two files and the
     working tree deletes one, the shape `release.mjs` leaves after it consumes the changesets. */
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rcite-'));
  try {
    const g = (...a) => execFileSync('git', ['-C', scratch, ...a], { stdio: 'pipe' });
    g('init', '-q');
    fs.writeFileSync(path.join(scratch, 'kept.md'), 'x\n');
    fs.writeFileSync(path.join(scratch, 'consumed.md'), 'x\n');
    g('add', 'kept.md', 'consumed.md');
    fs.unlinkSync(path.join(scratch, 'consumed.md'));
    ok('a tracked file deleted in the working tree is not offered', trackedFiles(scratch), ['kept.md']);
    /* CONTROL · with the file restored, both are offered, so the leg above is the deletion's doing. */
    fs.writeFileSync(path.join(scratch, 'consumed.md'), 'x\n');
    ok('CONTROL · the restored file is offered again', trackedFiles(scratch).sort(), ['consumed.md', 'kept.md']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  ok('…and that reason names the unread file too', /ENOENT/.test(vBoth.reason), true);
  /* CONTROL · the readable case is untouched: the sweep that read its whole offer excludes nothing. */
  ok('CONTROL · a sweep that read every eligible file excludes nothing', verdictFor({ ...blank, orphanOwners: [] }, 'abc').population, {
    checked: 1,
    eligible: 1,
    excluded: 0
  });
  /* CONTROL · the exemptions are a rule boundary, so they are reported and stay out of `eligible`. */
  const selfOnly = run(REPO, { files: ['tools/residue-citations.mjs', BASELINE], baseline: { entries: [], exemptPaths: [] } });
  ok('a file exempt by rule is counted outside the eligible set', [selfOnly.filesExempt, selfOnly.filesOffered, selfOnly.unreadable.length], [2, 0, 0]);

  /* A DECLARED SITE IS A PATH — the hold runs in both directions, over the real carrier file. */
  const siteRun = (sites) => {
    const entries = [{ key: '2026-09-02-alpha', class: 'fixture', reason: 'a fixture' }];
    if (sites !== undefined) entries[0].sites = sites;
    return run(REPO, { files: ['tools/residue-ids.mjs'], baseline: { entries, exemptPaths: [] } });
  };
  const driftOf = (sites) => siteRun(sites).siteDrift.map((d) => `${d.key}|${d.declaredOnly.join(',')}|${d.foundOnly.join(',')}`);
  ok('a declared path the scan cites there agrees', driftOf(['tools/residue-ids.mjs']), []);
  ok('a declared path carrying a line number drifts, because a site is a path', driftOf(['tools/residue-ids.mjs:926']), ['2026-09-02-alpha|tools/residue-ids.mjs:926|tools/residue-ids.mjs']);
  ok('a declared path the scan never cites is a pointer at nothing', driftOf(['tools/no-such-carrier.mjs']), ['2026-09-02-alpha|tools/no-such-carrier.mjs|tools/residue-ids.mjs']);
  ok(
    'an entry with no sites array declares nothing, and the finding says which',
    siteRun(undefined).siteDrift.map((d) => `${d.key}|${d.why}`),
    ['2026-09-02-alpha|declares no sites array']
  );
  ok(
    'the live site the report prints is a path and a line',
    siteRun(['tools/residue-ids.mjs']).liveSites[0].at.every((a) => /^tools\/residue-ids\.mjs:\d+$/.test(a)),
    true
  );
  ok('a site drift is a verdict finding, never a quiet pass', verdictFor(siteRun(['tools/residue-ids.mjs:926']), 'abc').status, 'FAIL');
  /* §∅ · a key the scan does not cite is judged by `stale` alone, so this check examines nothing and
     reports the count rather than a pass over an empty population. */
  const unexamined = run(REPO, {
    files: ['tools/residue-ids.mjs'],
    baseline: { entries: [{ key: '2026-12-31-nobody-cites-this', class: 'fixture', sites: ['tools/residue-ids.mjs'] }], exemptPaths: [] }
  });
  ok('an uncited baseline key leaves the site check with nothing to examine', [unexamined.siteKeysExamined, unexamined.siteDrift.length], [0, 0]);

  /* ANTI-VACUITY, over every declared baseline. A renamed container field would empty the owner
     check in silence, so each declared member must contribute a reason, and the floor is one reason
     per file. Today's total is never the floor, because paying a debt lowers it. */
  const realStates = rowStates(fs.readFileSync(path.join(REPO, LEDGER), 'utf8'));
  const realBase = JSON.parse(fs.readFileSync(path.join(REPO, BASELINE), 'utf8'));
  const liveOwners = loadOwnerBaselines(REPO, FOREIGN_OWNER_BASELINES);
  const livePairs = [...realBase.entries.map((e) => ({ key: e.key, reason: e.reason, file: BASELINE })), ...liveOwners.pairs];
  const named = ownerReasons(livePairs).map((o) => o.owner);
  ok(
    'every row the live baselines name is in the ledger',
    named.filter((o) => !realStates.has(o)),
    []
  );
  ok('no live baseline line names a closed row', ownerDebt(livePairs, realStates), []);
  ok('every declared owner baseline could be read', liveOwners.unreadable, []);
  ok(
    'every declared owner baseline contributes a reason',
    FOREIGN_OWNER_BASELINES.filter((x) => !liveOwners.pairs.some((o) => o.file === x.file)).map((x) => x.file),
    []
  );
  ok('the live owner population names at least one row', named.length >= 1, true);
  /* CONTROL · a declared member this process cannot open leaves the owner check unable to look, and
     UNKNOWN is what the verdict owes then — never a PASS over a file it never read. */
  const unreadOwner = loadOwnerBaselines(REPO, [{ file: 'tools/no-such-baseline.json', container: 'uninvoked', shape: 'map' }]);
  ok(
    'an absent declared owner baseline fails closed',
    unreadOwner.unreadable.map((u) => u.code),
    ['ENOENT']
  );
  ok(
    'a container the file does not carry fails closed',
    loadOwnerBaselines(REPO, [{ file: BASELINE, container: 'nope', shape: 'map' }]).unreadable.map((u) => u.code),
    ['NO-CONTAINER:nope']
  );
  ok('an unread owner baseline carries the verdict to UNKNOWN', verdictFor({ ...blank, orphanOwners: [], ownerBaselinesUnread: [{ file: 'x.json', code: 'ENOENT' }] }, 'abc').status, 'UNKNOWN');
  /* The exclusion must stay live too. A declared provenance field the file no longer carries is a dead
     declaration, and a declaration nobody reads is how the defect above hid for two weeks. */
  ok(
    'every declared provenance field is still in its file and names a row',
    OWNER_PROVENANCE_FIELDS.filter((f) => {
      const v = JSON.parse(fs.readFileSync(path.join(REPO, f.file), 'utf8'))[f.field];
      return typeof v !== 'string' || !realStates.has(v);
    }).map((f) => `${f.file}#${f.field}`),
    []
  );
  /* ANTI-VACUITY for the site hold: the live baseline must declare a site for every entry, and no
     site may carry a line number, or the legs above judge a shape the real file never uses. */
  ok(
    'every live baseline entry declares at least one site',
    realBase.entries.filter((e) => !Array.isArray(e.sites) || e.sites.length === 0).map((e) => e.key),
    []
  );
  ok(
    'no live baseline site carries a line number',
    realBase.entries.flatMap((e) => e.sites || []).filter((q) => /:\d+$/.test(q)),
    []
  );

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
      console.log(
        `  population: ${r.filesRead} of ${r.filesOffered} eligible file(s) read, ${r.unreadable.length} unreadable, ${r.filesNoCiteWord} with no citation word, ${r.filesExempt} exempt by rule`
      );
      const k = r.byKind;
      console.log(`  exact ${k.exact} · joined ${k.joined} · prefix ${k.prefix} · near ${k.near} · ambiguous ${k.ambiguous} · dangling ${k.dangling} (${r.declared} declared)`);
      for (const c of r.undeclared) {
        const why = c.kind === 'ambiguous' ? `a prefix of ${c.candidates} rows` : 'no row';
        console.log(`  ✗ ${c.at} cites ${c.cited} — ${why}, and no baseline line`);
      }
      for (const c of r.near) console.log(`  ✗ ${c.at} cites ${c.cited} — a near miss of ${c.row}`);
      for (const key of r.stale) console.log(`  ✗ baseline names ${key}, which resolves now — remove the line`);
      for (const s of r.siteDrift) {
        const left = s.why || `declares ${s.declared.join(', ')}`;
        console.log(`  ✗ the baseline line for ${s.key} ${left}, and the scan cites it at ${s.at.join(', ') || 'no site'} — a site is a path, so drop any :line`);
      }
      if (!r.siteKeysExamined) console.log('  · no live baseline key is cited anywhere, so the site check examined nothing');
      for (const o of r.orphanOwners) console.log(`  ✗ ${o.file || BASELINE}: the baseline line for ${o.key} ${o.why} (${o.owner}) — the debt has no living owner`);
      for (const u of r.ownerBaselinesUnread || []) console.log(`  ✗ the declared owner baseline ${u.file} could not be read (${u.code}) — the owner check could not look`);
      if (!r.ownerReasonsExamined) console.log(`  · no line names an owning row across ${(r.ownerSpecsDeclared || []).length} declared baseline(s), so the owner check examined nothing`);
      for (const u of r.unreadable) console.log(`  ✗ ${u.file} could not be read (${u.code}) — not scanned, and counted as excluded`);
      if (has('--all')) for (const l of r.liveSites) console.log(`  site      ${l.key} → ${l.at.join(', ')}`);
      if (has('--all')) for (const c of r.cites) console.log(`  ${c.kind.padEnd(9)} ${c.at} ${c.cited}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
    }
    /* §4c's two exits: 1 means the gate looked and a citation missed, 2 means it could not look —
       an eligible file it never opened leaves the sweep unfinished, and a reader who sees exit 1 would
       go hunting for the citation instead of the file. */
    process.exit(v.status === 'PASS' ? 0 : v.status === 'UNKNOWN' ? 2 : 1);
  }
}
