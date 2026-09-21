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
 *   beyond-eof   the file is shorter than the cited line
 *   missing-file the path resolves nowhere (tried as given, then under capture-host/)
 * The identifiers are the ROW'S, never a guess of this tool's: a citation is judged against what its
 * author wrote beside it, so "anchored" means the author's own words still hold at that line.
 *
 * ADVISORY: exits 0 and prints the list (`--strict` exits 1 on any `moved`). A row's line hint moving
 * is not a defect in the row; it is the reason the identifier rule exists. Rows are never edited by
 * this tool — the ledger's rows are append-only.
 *
 *   node tools/residue-cite-drift.mjs                 # every row, against origin/main
 *   node tools/residue-cite-drift.mjs --ref HEAD      # against the checkout's HEAD
 *   node tools/residue-cite-drift.mjs --json
 *   node tools/residue-cite-drift.mjs --selftest      # the plants: moved · anchored · unanchored · eof · missing
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

function readAt(ref, relPath) {
  // The ledger cites paths from wherever its author stood: repo root, capture-host/, tools/, briefs/…
  const tryPaths = [
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

export function sweep(rows, reader) {
  const cache = new Map();
  const lines = (p) => {
    if (!cache.has(p)) cache.set(p, reader(p));
    return cache.get(p);
  };
  const report = { rows: rows.length, citations: 0, byVerdict: {}, moved: [], unanchored: 0, missing: [] };
  for (const row of rows) {
    const ids = identifiers(row.text);
    for (const c of citations(row.text)) {
      report.citations++;
      const j = judge(c, lines(c.path), ids);
      report.byVerdict[j.verdict] = (report.byVerdict[j.verdict] || 0) + 1;
      if (j.verdict === 'moved') report.moved.push({ key: row.key, state: row.state, cite: `${c.path}:${c.line}`, now: j.now });
      else if (j.verdict === 'missing-file') report.missing.push({ key: row.key, cite: `${c.path}:${c.line}` });
      else if (j.verdict === 'unanchored') report.unanchored++;
    }
  }
  return report;
}

function selftest() {
  const file = ['import os', 'def alpha():', '    return 1', '', 'def beta(x):', '    return x + 1', 'BETA_CONST = 3', 'import pull_session'];
  const ids = identifiers('cites `beta` and `BETA_CONST` and "pull_session" and `mod.alpha()` here');
  const fails = [];
  const check = (n, c) => {
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
    '| 2026-09-20-a | 2026-09-20 | `x.py` | cites `beta` at `mod.py:5` | ok | OPEN |',
    '| 2026-09-20-b | 2026-09-20 | `x.py` | cites `pull_session` at `mod.py:1` | ok | OPEN |',
    '| 2026-09-20-c | 2026-09-20 | `x.py` | cites `beta` at `gone.py:1` | ok | fixed #1 |',
    '| not a row |',
    '| 2026-09-20-d | 2026-09-20 | `x.py` | no citation at all | ok | OPEN |'
  ].join('\n');
  const rows = parseRows(ledger);
  check('parseRows keeps the four rows and drops the non-row', rows.length === 4 && rows[2].state === 'fixed #1');
  const r = sweep(rows, (p) => (p === 'mod.py' ? file : null));
  check('sweep: 3 citations → 1 anchored, 1 moved, 1 missing', r.citations === 3 && r.byVerdict.anchored === 1 && r.byVerdict.moved === 1 && r.byVerdict['missing-file'] === 1);
  check('the moved entry names the row, the citation and the current line', r.moved[0].key === '2026-09-20-b' && r.moved[0].cite === 'mod.py:1' && r.moved[0].now.pull_session[0] === 8);
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
  const N = 15;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${N}`);
    process.exit(1);
  }
  console.log(`all ${N} selftests passed`);
}

function main() {
  if (has('--selftest')) return selftest();
  const ref = arg('--ref', 'origin/main');
  const ledger = fs.readFileSync(path.join(REPO, 'briefs', 'RESIDUE.md'), 'utf8');
  const rows = parseRows(ledger);
  const r = sweep(rows, (p) => readAt(ref, p));
  if (has('--json')) {
    console.log(JSON.stringify({ ref, ...r }, null, 2));
  } else {
    console.log(`residue-cite-drift: ${r.rows} rows · ${r.citations} file:line citations judged against ${ref}`);
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
      console.log(`\n  MISSING FILE — the path resolves nowhere under ${ref} (renamed, deleted, or cited from another tree):`);
      for (const m of r.missing) console.log(`    ${m.cite}  (${m.key})`);
    }
    if (r.unanchored)
      console.log(
        `\n  ${r.unanchored} citation(s) UNANCHORED: the row names no identifier found in the file, so the line cannot be judged — the class the residue's rule exists for (cite by identifier).`
      );
    console.log('\n  Advisory: a moved hint is not a defect in the row — grep the identifier; the line was only ever a shortcut.');
  }
  process.exit(has('--strict') && r.moved.length ? 1 : 0);
}
main();
