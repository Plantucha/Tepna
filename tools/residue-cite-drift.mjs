#!/usr/bin/env node
/*
 * tools/residue-cite-drift.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH RESIDUE ROWS CITE A LINE THAT HAS MOVED — residue `2026-09-20-ledger-line-citations-rot`.
 *
 * Every row in `briefs/RESIDUE.md` cites source LINES (`capture.py:5306`), and ordinary code motion
 * rots them into false refutations of TRUE rows: a verifier opens the cited line, finds unrelated code,
 * and closes a correct row by drift rather than by evidence. Measured on the sweep brief itself:
 * `capture.py:5306` for `import pull_session` on 2026-09-18 was `:5520` two days later. The remedy
 * stated there — cite by IDENTIFIER, with the line as a dated hint — is a rule; this tool is the check.
 *
 * For every `path:line` a row cites it asks ONE question against the ref (default `origin/main`):
 * does any identifier the ROW ITSELF names (a backticked token or a quoted string in that row) appear
 * on that line? Verdicts, per citation:
 *   anchored     an identifier from the row is on the cited line — the pointer still points
 *   moved        none is on that line, but ≥ 1 is elsewhere in the file — reported with where it is now
 *   unanchored   the row names no identifier that occurs anywhere in the file — the pointer cannot be
 *                judged (the row cites by line ALONE, which is the class the residue names); not drift
 *   beyond-eof   the file is shorter than the cited line — the pointer cannot resolve at all
 *   missing-file the path resolves nowhere, AND this repo can be shown to relate to it — its
 *                history carries one of the tried spellings, or a tracked file has that basename
 *   off-tree     the path resolves nowhere, no spelling of it appears anywhere in this repo's
 *                history, and no tracked file carries its basename — so this repo never held it
 * The identifiers are the ROW'S, never a guess of this tool's: a citation is judged against what its
 * author wrote beside it, so "anchored" means the author's own words still hold at that line.
 *
 * Every verdict but `anchored` is printed WITH ITS ROW KEY, because a count names nothing a reader
 * can chase. `unanchored` was a bare integer and `beyond-eof` had no field at all until row
 * 2026-10-26-the-unanchored-class-is-counted-and-never-named.
 *
 * `off-tree` splits a bin that used to hold two unlike things (row
 * 2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried). A row may cite the Python
 * standard library, an installed package or a vendor daemon config, and such a path resolves nowhere
 * for the same reason a deleted repo file does. The first is not this repo's defect and the second
 * is. The split is decided by EVIDENCE, never by a list of external names: `git log --all` over the
 * same spellings the reader tried answers "did this repo ever carry it", and the tracked basenames
 * answer "is this a repo file cited under the wrong directory". A list of external prefixes would
 * age, and a basename rule alone misbins both ways — measured on the 17 citations of 2026-10-26, a
 * suffix rule catching `Data Unifier.html` for `Unifier.html` also claims `ecg_parity_harness.py`
 * for bleak's `harness.py`.
 *
 * ∅ THE PROBE IS A MEASUREMENT AND ITS ABSENCE IS NOT A CLEAN ANSWER. A caller that passes no
 * provenance probe, and a shallow clone whose history cannot answer, both leave every unresolved
 * path in `missing-file`, which is the class that still decides `--strict`. Nothing becomes
 * `off-tree` unless the history was read and came back empty.
 *
 * ── `--base <ref>`: THE GATE, AND IT JUDGES ONLY THE ROWS A BRANCH ADDS ─────────────────────────
 *
 * This file was a census nothing invoked. Four rows refined its classification — #3956 named the
 * unanchored class, #3968 inverted the strict ordering, #3987 split `off-tree` out of
 * `missing-file` — while `grep` over `package.json`, `.github/workflows/` and every `*.sh` named no
 * caller, so the exit those rows argued about could not fire anywhere. Row
 * `2026-10-26-three-of-six-cited-printer-lines-name-no-printer` states the harm the tool exists to
 * catch, and three of that row's own six citations named no printer at its own commit, which is the
 * class a gate at APPEND time catches and a census never does.
 *
 * THE WHOLE LEDGER CAN NEVER GO GREEN, SO THE GATE DOES NOT ASK IT TO. §📌 forbids editing a row
 * cell, so the 79 defect-class citations standing on `origin/main` may not be repaired where they
 * sit, and a gate over every row would be red forever on work nobody is allowed to do. `--base`
 * reads the ledger at that ref, keeps the rows whose KEY it does not carry, and judges only those.
 * Rows are append-only, so a key absent from the base is a row this branch wrote. That is the idiom
 * of `verify:residue-ids`, `verify:xss-sink` and `verify:absence-regression`: the debt stands and
 * the growth stops.
 *
 * THE EXIT IS NOT A SECOND FLAG HERE. `--strict` was latent because nothing passed it; a gate whose
 * exit needs one more flag than its caller passes is that same defect wearing a mode name. So
 * `--base` decides on the defect classes with no `--strict`, and the files are read at `HEAD` by
 * default, because a row this branch adds must point into the tree this branch has.
 *
 * ∅ A BASE THAT CANNOT BE READ IS NOT AN EMPTY SET OF ADDED ROWS. An unfetched ref or a clone
 * without the base would otherwise report `0 rows added` and pass, which is CLAUDE.md §4b's
 * examined-nothing. The mode emits `NOT_RUN` with its reason and exits 2 — it could not look —
 * where exit 1 means it looked and a citation failed.
 *
 * ADVISORY: exits 0 and prints the list. `--strict` exits 1 on the three classes this file ranks as
 * defects — `missing-file`, `unanchored`, `beyond-eof` — and never on `moved`. A row's line hint
 * moving is not a defect in the row; it is the reason the identifier rule exists. The flag read
 * `moved` alone until row 2026-10-26-the-strict-exit-reads-the-one-class-the-tool-calls-benign, which
 * inverted that ordering and made the flag's green unreachable: rows are append-only, so nobody may
 * repair a line hint where it sits. Rows are never edited by this tool.
 *
 *   node tools/residue-cite-drift.mjs                 # every row, against origin/main
 *   node tools/residue-cite-drift.mjs --ref HEAD      # against the checkout's HEAD
 *   node tools/residue-cite-drift.mjs --json
 *   node tools/residue-cite-drift.mjs --selftest      # the plants: moved · anchored · unanchored · eof · missing · off-tree
 *   node tools/residue-cite-drift.mjs --base origin/main   # THE GATE: only the rows this branch ADDS
 *   node tools/residue-cite-drift.mjs --verdict-sample     # the tepna.verdict/1 object alone
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* `verdict.js` is CommonJS and sits at the repo root; this is the idiom `tools/residue-citations.mjs` uses. */
const Verdict = createRequire(import.meta.url)('../verdict.js');
const LEDGER = 'briefs/RESIDUE.md';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};

/* A citation: an optional backtick, a path with an extension, `:line`, an optional `-line2` range. */
const CITE_RE = /`?((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:py|js|mjs|sh|md|html|json|yml|yaml|toml|css|txt)):(\d+)(?:-(\d+))?`?/g;
/* What the author anchored the line to: every identifier-shaped token inside a backticked span (so
   `import pull_session` yields `pull_session`, `foo(bar)` yields `foo`), plus quoted strings. */
const SPAN_RE = /`([^`\n]{1,160})`|"([^"`\n]{3,80})"|'([^'`\n]{3,80})'/g;
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
const STOP = new Set([
  'null',
  'true',
  'false',
  'None',
  'True',
  'False',
  'self',
  'this',
  'return',
  'import',
  'from',
  'def',
  'const',
  'var',
  'let',
  'function',
  'and',
  'or',
  'not',
  'the',
  'for',
  'if',
  'else',
  'in',
  'is',
  'at',
  'to',
  'of',
  'with',
  'as',
  'was',
  'now',
  'line',
  'lines'
]);
const PATHLIKE = /\.(py|js|mjs|md|html|json|sh|yml|yaml|toml|css|txt)$/;

export function parseRows(ledgerText) {
  const out = [];
  for (const line of ledgerText.split('\n')) {
    if (!line.startsWith('| 20')) continue;
    const cells = line.split(' | ');
    if (cells.length < 6) continue;
    out.push({ key: cells[0].slice(2).trim(), text: line, state: cells[cells.length - 1].replace(/\s*\|\s*$/, '').trim() });
  }
  return out;
}

export function citations(rowText) {
  const out = [];
  for (const m of rowText.matchAll(CITE_RE)) out.push({ path: m[1], line: +m[2], to: m[3] ? +m[3] : null });
  return out;
}

export function identifiers(rowText) {
  const ids = new Set();
  const add = (t) => {
    if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t) && !PATHLIKE.test(t)) ids.add(t);
  };
  for (const m of rowText.matchAll(SPAN_RE)) {
    const span = m[1] || m[2] || m[3];
    if (!span) continue;
    if (!m[1]) {
      add(span); // a quoted string is matched whole — it is a literal the code carries verbatim
      continue;
    }
    for (const t of span.match(TOKEN_RE) || []) {
      add(t);
      if (t.includes('.')) add(t.split('.').pop()); // `mod.alpha` → also `alpha`
    }
  }
  return [...ids];
}

/* The judgement, pure: one citation against the file's lines and the row's identifiers. */
export function judge(cite, fileLines, ids) {
  if (fileLines === null) return { verdict: 'missing-file' };
  if (cite.line < 1 || cite.line > fileLines.length) return { verdict: 'beyond-eof', length: fileLines.length };
  const at = fileLines[cite.line - 1];
  const hit = ids.filter((id) => at.includes(id));
  if (hit.length) return { verdict: 'anchored', ids: hit };
  // Only a CODE-SHAPED identifier can testify that the line moved — snake_case, dotted, camelCase or a
  // literal string. A plain word (`ambient`, `reconcile`, `ABSENCE`) occurs in prose and comments all
  // over a file and would report every citation as "moved" to wherever it first appears.
  const specific = ids.filter((id) => /[_.]/.test(id) || /[a-z][A-Z]/.test(id) || /\s/.test(id));
  const now = {};
  for (const id of specific) {
    const where = [];
    for (let i = 0; i < fileLines.length && where.length < 4; i++) if (fileLines[i].includes(id)) where.push(i + 1);
    if (where.length) now[id] = where;
  }
  if (Object.keys(now).length) return { verdict: 'moved', now };
  return { verdict: 'unanchored', tried: ids.length, specific: specific.length };
}

/* The ledger cites paths from wherever its author stood: repo root, capture-host/, tools/, briefs/…
   ONE list, read by the resolver AND by the history probe. Two lists would let the probe ask about
   spellings the reader never tried, and a path absent from history under the probe's spellings would
   then score `off-tree` while the reader had looked somewhere else entirely. */
export function trySpellings(relPath) {
  return [
    relPath,
    `capture-host/${relPath}`,
    `tools/${relPath}`,
    `capture-host/tools/${relPath}`,
    `capture-host/tests/${relPath}`,
    `capture-host/deploy/${relPath}`,
    `briefs/${relPath}`,
    `docs/${relPath}`,
    `.claude/hooks/${relPath}`,
    `.github/workflows/${relPath}`
  ];
}

function readAt(ref, relPath) {
  const tryPaths = trySpellings(relPath);
  for (const p of tryPaths) {
    try {
      if (ref === 'worktree') {
        const f = path.join(REPO, p);
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').split('\n');
        continue;
      }
      return execFileSync('git', ['show', `${ref}:${p}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).split('\n');
    } catch {
      /* not at this path under this ref — try the next spelling */
    }
  }
  return null;
}

/* ONE UNRESOLVED PATH, TWO UNLIKE THINGS, AND THE EVIDENCE DECIDES WHICH. `prov` is what a
   provenance probe returned for this path: `carried` is whether ANY tried spelling appears in this
   repo's history, and `candidates` are tracked files sharing its basename. ∅ `carried === null` is
   the question nobody could ask — no probe, or a shallow clone — and it keeps the citation in
   `missing-file`, the class that decides `--strict`. Only a history that was READ and came back
   empty, with no basename candidate either, may move a citation out of the defect sum. */
export function binMissing(prov) {
  if (!prov || prov.carried === null || prov.carried === undefined) return { verdict: 'missing-file', why: 'the provenance probe did not run, so this path is judged as rot' };
  if (prov.carried) return { verdict: 'missing-file', why: `this repo's history carries ${prov.at || 'this path'}` };
  const candidates = prov.candidates || [];
  if (candidates.length) return { verdict: 'missing-file', why: `a tracked file carries this basename: ${candidates.slice(0, 3).join(', ')}`, candidates };
  return { verdict: 'off-tree', why: 'no spelling of this path is in the history and no tracked file carries its basename' };
}

/* THE EXIT CODE READS THE CLASSES THIS FILE RANKS AS DEFECTS. `--strict` read `r.moved.length`
   alone, which inverted the ordering stated in the header: a moved hint is advisory, and §📌 forbids
   editing a row cell, so nobody may repair one where it sits — the flag's green was unreachable
   while 76 citations in the three actionable classes left it green. `moved` stays out of the sum on
   purpose. (Row 2026-10-26-the-strict-exit-reads-the-one-class-the-tool-calls-benign.) */
export function strictFailures(r) {
  return r.missing.length + r.unanchored.length + r.beyondEof.length;
}

/* THE ROWS A BRANCH ADDED, BY KEY. Rows are append-and-close, so a key the base ledger does not
   carry is a row this branch wrote, and a key both carry is a row whose state cell may have moved —
   which is not this tool's business. Keying on the key rather than on the row TEXT is deliberate: a
   closure edits the state cell, and a text diff would hand every closed row back to the gate. */
export function addedRows(rows, baseRows) {
  const seen = new Set(baseRows.map((r) => r.key));
  return rows.filter((r) => !seen.has(r.key));
}

/* THE CRITERION NAMES ITS OWN SCOPE AND ITS OWN COUNT. Two modes judge two populations, so one
   shared name would have to lie about one of them (the lesson of residue
   `2026-10-31-the-mutation-verdicts-criterion-names-lines-not-functions`): `--base` bounds the
   citations of the ADDED rows and the plain run bounds every row's. Both count the three classes
   this file ranks as defects, never the advisory `moved` or the external `off-tree`. */
export const CRITERION = {
  added: { name: 'defect_class_citations_in_added_rows', threshold: 0, unit: 'citations', direction: 'lte' },
  ledger: { name: 'defect_class_citations_in_every_row', threshold: 0, unit: 'citations', direction: 'lte' }
};

export function verdictFor(r, commit, opts = {}) {
  const n = r ? strictFailures(r) : 0;
  const criterion = opts.base ? CRITERION.added : CRITERION.ledger;
  let status = 'PASS';
  let reason = null;
  if (opts.notRun) {
    status = 'NOT_RUN';
    reason = opts.notRun;
  } else if (!r.citations) {
    /* ∅ EXAMINED AND THE RULE DOES NOT BIND — never PASS over a population of nothing. */
    status = 'NOT_APPLICABLE';
    reason = opts.base ? `no row added against ${opts.base} cites a file:line, so the cite-by-identifier rule binds nothing here` : 'no row in the ledger cites a file:line';
  } else if (n) {
    status = 'FAIL';
    reason = `${n} citation(s) in the classes this tool ranks as defects (missing-file ${r.missing.length} · unanchored ${r.unanchored.length} · beyond-eof ${r.beyondEof.length}); cite by identifier, with the line as a dated hint`;
  }
  const notMeasured = status === 'NOT_RUN' || status === 'NOT_APPLICABLE';
  return Verdict.make({
    gate: 'residue-cite-drift',
    status,
    scope: 'internal',
    population: { checked: r ? r.citations : 0, eligible: r ? r.citations : 0, excluded: 0 },
    criterion,
    /* THE CONTRACT REFUSES A RESULT NOBODY MEASURED. `NOT_RUN` examined nothing and
       `NOT_APPLICABLE` examined a population the criterion does not bind, so both carry
       `result: null` rather than a tidy row of zeros that reads like a measurement. */
    result: notMeasured
      ? null
      : {
          rows: r ? r.rows : 0,
          base: opts.base || null,
          ref: opts.ref || null,
          ...(r ? r.byVerdict : {}),
          defectClass: n,
          missingFile: r ? r.missing.length : 0,
          unanchored: r ? r.unanchored.length : 0,
          beyondEof: r ? r.beyondEof.length : 0,
          moved: r ? r.moved.length : 0,
          offTree: r ? r.offTree.length : 0
        },
    evidence: [LEDGER, 'tools/residue-cite-drift.mjs'],
    reason,
    producedBy: { tool: 'tools/residue-cite-drift.mjs', commit }
  });
}

function commitSha() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/* ∅ THE BASE LEDGER IS A MEASUREMENT AND ITS ABSENCE IS NOT AN EMPTY DIFF. */
export function readLedgerAt(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${LEDGER}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

export function sweep(rows, reader, provenance = null) {
  const cache = new Map();
  const provCache = new Map();
  const prov = (q) => {
    if (!provenance) return null;
    if (!provCache.has(q)) provCache.set(q, provenance(q));
    return provCache.get(q);
  };
  const lines = (p) => {
    if (!cache.has(p)) cache.set(p, reader(p));
    return cache.get(p);
  };
  /* EVERY NON-ANCHORED CLASS CARRIES KEYS. `unanchored` was an integer and `beyond-eof` had no field
     at all, so the two verdicts a reader must act on were the two the report could not locate (row
     2026-10-26-the-unanchored-class-is-counted-and-never-named). `anchored` stays a count, because a
     pointer that still points names nothing to chase. */
  const report = { rows: rows.length, citations: 0, byVerdict: {}, moved: [], unanchored: [], beyondEof: [], missing: [], offTree: [], provenanceProbe: provenance ? 'read' : 'not-run' };
  for (const row of rows) {
    const ids = identifiers(row.text);
    for (const c of citations(row.text)) {
      report.citations++;
      const j0 = judge(c, lines(c.path), ids);
      /* The judgement is pure and reads a file; the SPLIT of its missing bin reads the repo, so it
         happens here, where the probe lives. `byVerdict` counts the final class. */
      const j = j0.verdict === 'missing-file' ? { ...j0, ...binMissing(prov(c.path)) } : j0;
      report.byVerdict[j.verdict] = (report.byVerdict[j.verdict] || 0) + 1;
      if (j.verdict === 'moved') report.moved.push({ key: row.key, state: row.state, cite: `${c.path}:${c.line}`, now: j.now });
      else if (j.verdict === 'missing-file') report.missing.push({ key: row.key, cite: `${c.path}:${c.line}`, why: j.why });
      else if (j.verdict === 'off-tree') report.offTree.push({ key: row.key, state: row.state, cite: `${c.path}:${c.line}`, why: j.why });
      else if (j.verdict === 'beyond-eof') report.beyondEof.push({ key: row.key, state: row.state, cite: `${c.path}:${c.line}`, length: j.length });
      else if (j.verdict === 'unanchored') report.unanchored.push({ key: row.key, state: row.state, cite: `${c.path}:${c.line}`, tried: j.tried, specific: j.specific });
    }
  }
  return report;
}

function selftest() {
  const file = ['import os', 'def alpha():', '    return 1', '', 'def beta(x):', '    return x + 1', 'BETA_CONST = 3', 'import pull_session'];
  const ids = identifiers('cites `beta` and `BETA_CONST` and "pull_session" and `mod.alpha()` here');
  const fails = [];
  let ran = 0;
  const check = (n, c) => {
    ran += 1;
    if (!c) fails.push(n);
  };
  check(
    'identifiers: backticked, quoted, dotted-call last segment',
    ['beta', 'BETA_CONST', 'pull_session', 'mod.alpha', 'alpha'].every((i) => ids.includes(i))
  );
  check(
    'identifiers: a span with SPACES yields its tokens (`import pull_session` → pull_session), never `import`',
    identifiers('cites `import pull_session` at `capture.py:5306`').includes('pull_session') &&
      !identifiers('cites `import pull_session`').includes('import') &&
      !identifiers('`capture.py:5306`').some((x) => /\.py$/.test(x))
  );
  check(
    'citations: backticked path:line and a bare path:line-range',
    JSON.stringify(citations('see `capture.py:5306` and tools/x.mjs:10-12 and prose.')) ===
      JSON.stringify([
        { path: 'capture.py', line: 5306, to: null },
        { path: 'tools/x.mjs', line: 10, to: 12 }
      ])
  );
  check('anchored: the identifier is on the cited line', judge({ line: 5 }, file, ['beta']).verdict === 'anchored');
  // THE PLANT — the residue's own example: the import cited at one line now lives at another
  const moved = judge({ line: 1 }, file, ['pull_session']);
  check('PLANT moved: `import pull_session` cited at :1 is now at :8 — reported with where it is', moved.verdict === 'moved' && JSON.stringify(moved.now) === JSON.stringify({ pull_session: [8] }));
  check('unanchored: the row names nothing that occurs in the file — not judged as drift', judge({ line: 2 }, file, ['gamma']).verdict === 'unanchored');
  check('beyond-eof', judge({ line: 99 }, file, ['beta']).verdict === 'beyond-eof');
  check('missing-file', judge({ line: 1 }, null, ['beta']).verdict === 'missing-file');
  check('a row with NO identifiers is unanchored, never anchored by vacuity', judge({ line: 5 }, file, []).verdict === 'unanchored');
  check('a PLAIN-WORD identifier (`alpha`, `beta`) cannot testify to a move — unanchored, not moved', judge({ line: 4 }, file, ['alpha', 'beta']).verdict === 'unanchored');
  check('…but it still anchors when it IS on the cited line', judge({ line: 2 }, file, ['def']).verdict === 'anchored');
  // the sweep over a synthetic ledger, with a reader that serves one file
  const ledger = [
    '| 2026-09-20-a | 2026-09-20 | `x.py` | cites `beta` at `mod.py:5` and `gamma` at `mod.py:3` | ok | OPEN |',
    '| 2026-09-20-b | 2026-09-20 | `x.py` | cites `pull_session` at `mod.py:1` | ok | OPEN |',
    '| 2026-09-20-c | 2026-09-20 | `x.py` | cites `beta` at `gone.py:1` and `beta` at `mod.py:99` | ok | fixed #1 |',
    '| not a row |',
    '| 2026-09-20-d | 2026-09-20 | `x.py` | no citation at all | ok | OPEN |'
  ].join('\n');
  const rows = parseRows(ledger);
  check('parseRows keeps the four rows and drops the non-row', rows.length === 4 && rows[2].state === 'fixed #1');
  const r = sweep(rows, (p) => (p === 'mod.py' ? file : null));
  check(
    'sweep: 5 citations → 1 each of anchored, moved, missing, unanchored and beyond-eof',
    r.citations === 5 && r.byVerdict.anchored === 1 && r.byVerdict.moved === 1 && r.byVerdict['missing-file'] === 1 && r.byVerdict.unanchored === 1 && r.byVerdict['beyond-eof'] === 1
  );
  check('the moved entry names the row, the citation and the current line', r.moved[0].key === '2026-09-20-b' && r.moved[0].cite === 'mod.py:1' && r.moved[0].now.pull_session[0] === 8);
  /* THE CLASS A READER MUST ACT ON IS THE ONE THE REPORT COULD NOT LOCATE. `unanchored` was an
     integer and `beyond-eof` had no field, so both are pinned as key-bearing lists here. */
  check(
    'the UNANCHORED entry names the row and the citation, not just a count',
    Array.isArray(r.unanchored) && r.unanchored.length === 1 && r.unanchored[0].key === '2026-09-20-a' && r.unanchored[0].cite === 'mod.py:3' && r.unanchored[0].state === 'OPEN'
  );
  check('…and it carries why it could not be judged — identifiers read, and how many were code-shaped', r.unanchored[0].tried === 2 && r.unanchored[0].specific === 0);
  check(
    'the BEYOND-EOF entry names the row, the citation and the length that refutes it',
    r.beyondEof.length === 1 && r.beyondEof[0].key === '2026-09-20-c' && r.beyondEof[0].cite === 'mod.py:99' && r.beyondEof[0].length === 8
  );
  check('ANTI-VACUITY · anchored stays a count, since a pointer that still points names nothing to chase', r.byVerdict.anchored === 1 && r.anchored === undefined);
  /* THE EXIT CODE'S POPULATION. One of each class is planted above, so the sum is the three
     actionable ones and the moved hint is absent from it. The control below carries a moved citation
     and nothing else: it must read zero, or `--strict` is still gating on the advisory class. */
  check('strictFailures sums the three classes the tool ranks as defects', strictFailures(r) === 3);
  {
    const movedOnly = parseRows('| 2026-09-20-m | 2026-09-20 | `mod.py` | cites `pull_session` at mod.py:1 | ok | OPEN |');
    const rm = sweep(movedOnly, (q) => (q === 'mod.py' ? file : null));
    check('CONTROL · a sweep whose only finding is MOVED decides nothing, so --strict stays green', rm.byVerdict.moved === 1 && strictFailures(rm) === 0);
  }
  check(
    'TRIPWIRE · the flag is wired to that sum and reads `moved` nowhere in its exit',
    (() => {
      const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
      /* MATCH THE STATEMENT, NOT ITS NAME. A first version searched for the exit's own text and
         found THIS leg's string literal instead — the §4 self-match, one layer up. */
      const line = src.split('\n').find((l) => /^\s*process\.exit\(/.test(l) && l.includes('strictN'));
      /* AND THE GATE'S EXIT TAKES NO SECOND FLAG. The pin read `process.exit(has(` until the
         `--base` mode landed; `decides` is that mode OR the flag, so a later edit making the gate
         flag-dependent again reds here under its own name rather than passing silently. */
      const wiring = src.split('\n').find((l) => /^\s*const decides = /.test(l));
      return Boolean(line) && !line.includes('moved') && Boolean(wiring) && wiring.includes('base !== null') && wiring.includes("has('--strict')");
    })()
  );
  /* ── THE MISSING BIN SPLITS BY EVIDENCE (row
     2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried) ──────────────────────
     Every leg below is pure: the probe is a literal, so the selftest reads no git and no corpus. */
  check(
    '∅ no probe at all — the citation stays a defect, and the reason says the probe did not run',
    (() => {
      const b = binMissing(null);
      return b.verdict === 'missing-file' && /did not run/.test(b.why);
    })()
  );
  check('∅ a shallow clone answers `null`, which is NOT `false` — the citation stays a defect', binMissing({ carried: null, candidates: [] }).verdict === 'missing-file');
  check(
    'a path this repo once carried is rot, and the reason names where the history saw it',
    (() => {
      const b = binMissing({ carried: true, candidates: [], at: 'Unifier.html (9d93ca3a)' });
      return b.verdict === 'missing-file' && b.why.includes('Unifier.html (9d93ca3a)');
    })()
  );
  check(
    'a tracked basename makes it a repo file cited under the wrong directory, and the reason names the candidate',
    (() => {
      const b = binMissing({ carried: false, candidates: ['analysis/published-numbers/hat.json'] });
      return b.verdict === 'missing-file' && b.why.includes('analysis/published-numbers/hat.json');
    })()
  );
  check('ONLY a history that was read and came back empty, with no candidate, scores off-tree', binMissing({ carried: false, candidates: [] }).verdict === 'off-tree');
  {
    /* Two citations, one of each kind, through the whole sweep. */
    const two = parseRows(
      '| 2026-09-05-ext | 2026-09-05 | `mutmut` | the installed `runner` at mutmut/__main__.py:1556 | ok | OPEN |\n' +
        '| 2026-09-20-rot | 2026-09-20 | `gone.py` | the deleted `helper` at gone.py:4 | ok | OPEN |'
    );
    const probe = (q) => (q === 'gone.py' ? { carried: true, candidates: [], at: 'gone.py (abc1234)' } : { carried: false, candidates: [] });
    const r2 = sweep(two, () => null, probe);
    check('a sweep WITH the probe splits the bin and keeps only the repo-related half in the sum', r2.byVerdict['off-tree'] === 1 && r2.byVerdict['missing-file'] === 1 && strictFailures(r2) === 1);
    check('an off-tree citation is NAMED — key and cite, never a bare count', r2.offTree.length === 1 && r2.offTree[0].key === '2026-09-05-ext' && r2.offTree[0].cite === 'mutmut/__main__.py:1556');
    check('the report says whether the probe ran at all', r2.provenanceProbe === 'read');
    /* CONTROL, and it is the whole fail-closed claim: the SAME rows with no probe keep both
       citations in the defect sum. Without this leg the split could pass by emptying the sum. */
    const r3 = sweep(two, () => null);
    check(
      'CONTROL · the same sweep with NO probe leaves both citations as defects',
      r3.byVerdict['missing-file'] === 2 && r3.byVerdict['off-tree'] === undefined && strictFailures(r3) === 2 && r3.provenanceProbe === 'not-run'
    );
  }
  check(
    'ONE list of spellings serves the reader and the probe',
    (() => {
      const sp = trySpellings('x.py');
      const src2 = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
      /* A second hand-written prefix list is the failure this leg exists for: the probe would then
       ask about spellings the reader never tried. Count the CONSTRUCTION, not the mentions. */
      const built = (src2.match(/`capture-host\/\$\{relPath\}`/g) || []).length;
      return sp[0] === 'x.py' && sp.includes('capture-host/x.py') && sp.length === 10 && built === 1;
    })()
  );
  check(
    'each file is read once per sweep (cache)',
    (() => {
      let n = 0;
      sweep(rows, () => {
        n++;
        return file;
      });
      return n === 2;
    })()
  );
  /* ── THE GATE: `--base` judges the ADDED rows, and its exit needs no second flag ─────────── */
  const SYN_B = '2026-09-20-b';
  /* HOISTED, never inlined below: `residue-citations.mjs` reads a key literal as a CITATION once
     the bare word `rows` sits within 40 characters before it (`CITE_WORDS` + `CITE_WINDOW`). An
     inlined key beside `rows.filter` therefore cited a line this selftest alone invents, and reded
     that gate at step 6 of 46. A hoisted name keeps the plant and leaves the scan nothing to read. */
  const baseRows = rows.filter((x) => x.key !== SYN_B);
  check('addedRows keeps the one key the base does not carry', JSON.stringify(addedRows(rows, baseRows).map((x) => x.key)) === JSON.stringify([SYN_B]));
  check('addedRows keeps nothing when the base carries every key', addedRows(rows, rows).length === 0);
  /* A CLOSURE MOVES A STATE CELL, AND THAT IS NOT A ROW THIS BRANCH WROTE. Keying on the row TEXT
     would hand every closed row back to the gate, which is the whole open ledger on a RESIDUE-only
     PR. The base copy here carries the same key with the state it had before the close. */
  const closed = rows.map((x) => (x.key === SYN_B ? { ...x, state: 'fixed #9', text: x.text.replace(/OPEN/, 'fixed #9') } : x));
  check('a row whose state cell moved is NOT an added row', addedRows(closed, rows).length === 0);

  const vAdded = verdictFor(r, '3b32a759', { base: 'origin/main', ref: 'HEAD' });
  check('the gate FAILS on the defect classes with no --strict passed', vAdded.status === 'FAIL');
  check('the failing verdict counts the three classes and not the advisory moved', vAdded.result.defectClass === 3 && vAdded.result.moved === 1);
  check('the criterion names the ADDED-row scope', vAdded.criterion.name === 'defect_class_citations_in_added_rows');
  check('…and never the whole-ledger scope, whose population is every row', verdictFor(r, '3b32a759', {}).criterion.name === 'defect_class_citations_in_every_row');
  check('every non-PASS verdict carries a reason', typeof vAdded.reason === 'string' && vAdded.reason.length > 0);
  check('the emitted verdict validates against the contract', Verdict.validate(vAdded).ok);
  /* ANTI-VACUITY: a gate that reds on everything proves nothing, so the same judge is pointed at a
     citation whose identifier IS on the cited line and must come back green. */
  const anchoredOnly = parseRows(['| 2026-09-20-z | 2026-09-20 | `src` | cites `beta` at `mod.py:5` | ev | OPEN |'].join('\n'));
  const rOk = sweep(anchoredOnly, (q) => (q === 'mod.py' ? file : null));
  const vOk = verdictFor(rOk, '3b32a759', { base: 'origin/main', ref: 'HEAD' });
  check('CONTROL: one anchored citation passes the same gate', rOk.citations === 1 && vOk.status === 'PASS' && vOk.reason === null);
  /* ∅ A POPULATION OF NOTHING IS NOT A PASS, AND AN UNREADABLE BASE IS NOT AN EMPTY DIFF. */
  const vNone = verdictFor(
    sweep([], () => null),
    '3b32a759',
    { base: 'origin/main' }
  );
  check('no added citation reads NOT_APPLICABLE, never PASS over checked 0', vNone.status === 'NOT_APPLICABLE' && vNone.population.checked === 0);
  const vNR = verdictFor(null, '3b32a759', { base: 'origin/main', notRun: 'the ledger could not be read at origin/main' });
  check('an unreadable base reads NOT_RUN with its reason', vNR.status === 'NOT_RUN' && /could not be read/.test(vNR.reason));
  check('both refusal verdicts validate', Verdict.validate(vNone).ok && Verdict.validate(vNR).ok);

  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${ran}`);
    process.exit(1);
  }
  console.log(`all ${ran} selftests passed`);
}

/* THE PROBE, AND IT FAILS CLOSED TWICE. A shallow clone cannot answer "did this repo ever carry
   it", so it returns `carried: null` and every unresolved path stays a defect — the same discipline
   `tools/commit-shape.mjs` applies, and the reason CI's `fetch-depth: 0` is load-bearing. A git
   invocation that throws returns `null` for the same reason. The basenames come from the REF being
   judged, so the two halves of the answer describe one tree. */
function repoProvenance(ref) {
  const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  let shallow = true;
  let tracked = [];
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    tracked = (ref === 'worktree' ? git(['ls-files']) : git(['ls-tree', '-r', '--name-only', ref])).split('\n').filter(Boolean);
  } catch {
    return { probe: null, reason: 'git could not be read' };
  }
  if (shallow) return { probe: null, reason: 'the clone is shallow, so its history cannot answer whether a path ever existed' };
  const byBase = new Map();
  for (const f of tracked) {
    const b = f.slice(f.lastIndexOf('/') + 1);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const probe = (relPath) => {
    const specs = trySpellings(relPath);
    const base = relPath.slice(relPath.lastIndexOf('/') + 1);
    const candidates = byBase.get(base) || [];
    let hit = '';
    try {
      hit = git(['log', '--all', '--format=%h', '-1', '--', ...specs]).trim();
    } catch {
      return { carried: null, candidates };
    }
    if (!hit) return { carried: false, candidates };
    /* Name the spelling, not just the commit — a reader who cannot see WHICH of the ten matched
       cannot check the answer. Only a path the history knows pays for this second pass. */
    let at = `a commit (${hit})`;
    for (const sp of specs) {
      try {
        if (git(['log', '--all', '--format=%h', '-1', '--', sp]).trim()) {
          at = `${sp} (${hit})`;
          break;
        }
      } catch {
        /* this spelling could not be asked about — try the next */
      }
    }
    return { carried: true, candidates, at };
  };
  return { probe, reason: null };
}

function main() {
  if (has('--selftest')) return selftest();
  const base = arg('--base', null);
  /* A row this branch ADDS must point into the tree this branch HAS, so the gate reads files at the
     checkout; the census keeps judging the ref, which is what its four refinement rows measured. */
  const ref = arg('--ref', base ? 'HEAD' : 'origin/main');
  const ledger = fs.readFileSync(path.join(REPO, 'briefs', 'RESIDUE.md'), 'utf8');
  let rows = parseRows(ledger);
  if (base) {
    const baseText = readLedgerAt(base);
    if (baseText === null) {
      const v = verdictFor(null, commitSha(), {
        base,
        ref,
        notRun: `the ledger could not be read at ${base}, so the set of added rows is unknown — an unfetched ref, or a clone that does not carry it`
      });
      console.log(`residue-cite-drift: ⏱ UNEXAMINED — ${v.reason}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
      process.exit(2);
    }
    rows = addedRows(rows, parseRows(baseText));
  }
  const { probe, reason: probeReason } = repoProvenance(ref);
  const r = sweep(rows, (p) => readAt(ref, p), probe);
  const v = verdictFor(r, commitSha(), { base, ref });
  /* `Verdict.validate` answers `{ ok, errors }`. A truth test on `.length` would read `undefined`
     and never fire, which is CLAUDE.md §4b: a check reporting a verdict about what it never read. */
  const checkedV = Verdict.validate(v);
  if (!checkedV.ok) {
    console.error(`invalid verdict: ${checkedV.errors.join('; ')}`);
    process.exit(2);
  }
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (has('--json')) {
    console.log(JSON.stringify({ ref, base: base || null, verdict: v, ...r }, null, 2));
  } else {
    console.log(
      base
        ? `residue-cite-drift: ${r.rows} row(s) added against ${base} · ${r.citations} file:line citation(s) judged against ${ref}`
        : `residue-cite-drift: ${r.rows} rows · ${r.citations} file:line citations judged against ${ref}`
    );
    if (r.citations)
      console.log(
        '  ' +
          Object.entries(r.byVerdict)
            .sort()
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')
      );
    if (r.moved.length) {
      console.log(`\n  MOVED — the cited line no longer carries the row's identifier; it is now at:`);
      for (const m of r.moved)
        console.log(
          `    ${m.cite}  (${m.key}, ${m.state})  →  ${Object.entries(m.now)
            .map(([id, ls]) => `${id} @ :${ls.join(',:')}`)
            .join('; ')}`
        );
    }
    if (r.missing.length) {
      console.log(`\n  MISSING FILE — the path resolves nowhere under ${ref}, and this repo can be shown to relate to it:`);
      for (const m of r.missing) console.log(`    ${m.cite}  (${m.key})  →  ${m.why}`);
    }
    if (r.offTree.length) {
      console.log(
        `\n  OFF TREE (${r.offTree.length}) — the path resolves nowhere, no spelling of it appears in this repo's history, and no tracked file carries its basename. A row may cite the standard library, an installed package or a vendor config; such a pointer is not a defect in THIS repo, and it does not decide --strict:`
      );
      for (const o of r.offTree) console.log(`    ${o.cite}  (${o.key}, ${o.state})`);
    }
    if (probeReason) console.log(`\n  ⚠ provenance probe NOT RUN — ${probeReason}. Every unresolved path is judged as rot, which is the fail-closed reading.`);
    if (r.beyondEof.length) {
      console.log(`\n  BEYOND EOF — the cited line is past the end of the file, so the pointer cannot resolve at all:`);
      for (const b of r.beyondEof) console.log(`    ${b.cite}  (${b.key}, ${b.state})  →  the file is ${b.length} line(s) long`);
    }
    if (r.unanchored.length) {
      console.log(
        `\n  UNANCHORED (${r.unanchored.length}) — the row names no identifier found in the file, so the line cannot be judged. This is the class the residue's rule exists for (cite by identifier):`
      );
      for (const u of r.unanchored) console.log(`    ${u.cite}  (${u.key}, ${u.state})  →  ${u.tried} identifier(s) read from the row, ${u.specific} of them code-shaped`);
    }
    console.log('\n  Advisory: a moved hint is not a defect in the row — grep the identifier; the line was only ever a shortcut.');
  }
  /* THE EXIT IS NOT A SECOND FLAG IN GATE MODE. `--strict` sat latent because no caller passed it,
     and a mode that needed one more flag than its caller passes would be that defect renamed. */
  const strictN = strictFailures(r);
  const decides = base !== null || has('--strict');
  if (!has('--json')) {
    if (decides && strictN)
      console.log(
        `\n  ${base !== null ? `--base ${base}` : '--strict'}: ${strictN} citation(s) in the classes this tool ranks as defects (missing-file ${r.missing.length} · unanchored ${r.unanchored.length} · beyond-eof ${r.beyondEof.length}). The ${r.moved.length} moved hint(s) and the ${r.offTree.length} off-tree citation(s) do not decide this exit.`
      );
    console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  }
  process.exit(decides && strictN ? 1 : 0);
}
/* `isCliEntry` is the one sanctioned predicate — this file exports its judge, so an importer must
   not pay for the whole census. A raw `process.argv[1]` test breaks through a symlink. */
if (isCliEntry(import.meta.url)) main();
