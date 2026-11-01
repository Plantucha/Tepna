#!/usr/bin/env node
/*
 * tools/port-parity.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * "PORTED VERBATIM FROM X" IS A CLAIM, AND NOTHING IN THE TREE READ IT.
 *
 * Four source files carry that sentence about a function they copied. No gate reads any of them,
 * so a copy and its source drift silently and the copy keeps asserting it is the source. Measured
 * 2026-11-01 on the PAT pair, which has drifted in BOTH directions:
 *
 *   · `pat-feasibility-worker.js ppgFootTimes` gained the pinned-span refusal in #4069 (2026-10-28).
 *     `tools/pat-matchrate-strict.mjs`'s copy was last revised in #4002 (2026-10-27), so it carries
 *     no pinned-span refusal at all, while its header calls itself the shipped definition.
 *   · The copy applies `applyConsensusPolarity` and the worker does not, so each side carries a
 *     correction the other lacks.
 *
 * THE INSTRUMENT PINS THE SOURCE, NOT THE COPY. A byte comparison cannot serve: the worker is ES5
 * and the copies are modern, so two correct copies of one rule never match byte for byte. Instead a
 * copy declares which SOURCE TEXT it was last reconciled against. When the source moves, this reds
 * and a person re-reads the copy. That is the `verifiedUnder` shape: the claim names the code it was
 * established over, and the code moving retires the claim rather than the claim covering the move.
 *
 * ∅ A DECLARED-BEHIND COPY IS A THIRD STATE, NOT A PASS AND NOT A FAIL. A copy that is knowingly
 * behind its source states the source text it is behind, so the gate reads SHORTFALL and says which
 * row holds the debt. It still FAILS when the source moves PAST that declared text, because that is
 * new drift nobody has read. The gate's condition is the pinned text, never the row's state, so
 * closing the row disarms nothing.
 *
 * TWO LIMITS, STATED RATHER THAN IMPLIED. This reads that the SOURCE moved, never that the copy is
 * faithful: a copy that never implemented a rule its source carries reads as reconciled the moment
 * its declaration names today's source text. So `@port-sha` names the source text a person READ and
 * brought the copy into line with, with every deliberate difference documented beside the copy — the
 * `verifiedUnder` meaning, not a commit date. A declaration whose date is later than the source's
 * last change proves nothing on its own, which is why both PAT copies below declare the pre-#4069
 * text: one of them was revised ten hours after #4069 and still carries none of it.
 *
 * A DECLARATION LIVES IN A COMMENT. The line it sits on must open with a comment marker, so this
 * file's own selftest strings are not a declared port of anything.
 *
 * GRAMMAR — three directives, the first required, within six lines of each other:
 *
 *   @port-from <repo-relative path>#<symbol>
 *   @port-sha <12 hex>                      the source text this copy was reconciled against
 *   @port-behind <12 hex> <residue key>     OPTIONAL: the source text today, declared unreconciled
 *
 * CLI: --check (default) · --json · --print <path#symbol> · --selftest · --verdict-sample
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { maskNonCode } from './argv-reads.mjs';
import { escapeRe } from './regex-escape-core.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* The trees a declaration may live in. Named, never globbed from the repo root: a glob would pull
   `node_modules` and every generated bundle into the population, and an unreadable tree would then
   read as "no declaration". Each entry is a directory plus the extensions that are source there. */
const SCAN = [
  { dir: '.', exts: ['.js'], recurse: false },
  { dir: 'tools', exts: ['.mjs', '.js'], recurse: false },
  { dir: 'tests', exts: ['.mjs'], recurse: false }
];

export function hash12(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/* ── the declaration ─────────────────────────────────────────────────────────────────────────── */

const FROM_RE = /@port-from\s+([^\s#]+)#([A-Za-z_$][\w$]*)/g;
/* The marker that makes a line a comment in the trees this scans — `*` covers a block comment's
   continuation lines, `#` a shell or python port. A `@port-from` inside code is a string, and a
   string is not a declaration. */
const COMMENT_LINE = /^\s*(?:\*|\/\/|\/\*|#)/;
const SHA_RE = /@port-sha\s+([0-9a-f]{12})\b/;
const BEHIND_RE = /@port-behind\s+([0-9a-f]{12})\s+(\S+)/;

/* A directive block is the `@port-from` line plus the five after it. A copy's declaration is prose
   in a comment, so the window is what keeps an unrelated later `@port-sha` from binding to it. */
export function parseDeclarations(text, path) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    FROM_RE.lastIndex = 0;
    const m = FROM_RE.exec(lines[i]);
    if (!m) continue;
    if (!COMMENT_LINE.test(lines[i])) continue;
    const window = lines.slice(i, i + 6).join('\n');
    const sha = SHA_RE.exec(window);
    const behind = BEHIND_RE.exec(window);
    out.push({
      in: path,
      line: i + 1,
      from: m[1],
      symbol: m[2],
      sha: sha ? sha[1] : null,
      behindSha: behind ? behind[1] : null,
      behindRow: behind ? behind[2] : null
    });
  }
  return out;
}

/* ── the source text a declaration names ─────────────────────────────────────────────────────── */

function matchBracket(masked, from, open, close) {
  let depth = 0;
  for (let k = from; k < masked.length; k++) {
    if (masked[k] === open) depth++;
    else if (masked[k] === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/* Throws with a named reason rather than returning a fallback: a symbol this cannot find is a
   declaration nobody can evaluate, and a gate that cannot look must say so (§4b). */
export function extractSymbol(text, name) {
  const masked = maskNonCode(text);
  const n = escapeRe(name);
  const re = new RegExp(`(?:^|[^\\w$.])(?:function\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=|${n}\\s*[:=]\\s*function\\b)`, 'g');
  const hits = [];
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    hits.push(m.index + (/^[\w$.]/.test(m[0]) ? 0 : 1));
    re.lastIndex = m.index + m[0].length;
  }
  if (!hits.length) throw new Error(`the source declares no \`${name}\``);
  if (hits.length > 1) throw new Error(`the source declares \`${name}\` ${hits.length} times, so no one site can be pinned`);
  const start = hits[0];
  /* An arrow with a bare parameter has no parens, so whichever of `(` and `=>` comes first is the
     anchor. Taking `(` unconditionally would walk into an unrelated call further down the file. */
  const paren = masked.indexOf('(', start);
  const arrow = masked.indexOf('=>', start);
  let bodyFrom;
  if (arrow >= 0 && (paren < 0 || arrow < paren)) bodyFrom = arrow + 2;
  else {
    if (paren < 0) throw new Error(`\`${name}\` has no parameter list`);
    const closeParen = matchBracket(masked, paren, '(', ')');
    if (closeParen < 0) throw new Error(`\`${name}\`'s parameter list does not close`);
    bodyFrom = closeParen + 1;
  }
  /* The body's `{` is searched AFTER the parameter list, because a destructured parameter puts a
     brace inside the parens and matching that one ends the slice at the signature. */
  const brace = masked.indexOf('{', bodyFrom);
  if (brace < 0) throw new Error(`\`${name}\` has no braced body`);
  const end = matchBracket(masked, brace, '{', '}');
  if (end < 0) throw new Error(`\`${name}\`'s body does not close`);
  return text.slice(start, end + 1);
}

/* ── evaluation ──────────────────────────────────────────────────────────────────────────────── */

export function evaluate(decls, read) {
  return decls.map((d) => {
    const row = { ...d, state: 'error', actual: null, why: null };
    if (!d.sha) {
      row.why = 'the declaration names a source and no @port-sha';
      return row;
    }
    let src;
    try {
      src = read(d.from);
    } catch (e) {
      row.why = `the source is unreadable: ${(e && e.message) || e}`;
      return row;
    }
    if (src == null) {
      row.why = 'the source file is absent';
      return row;
    }
    let body;
    try {
      body = extractSymbol(src, d.symbol);
    } catch (e) {
      row.why = (e && e.message) || String(e);
      return row;
    }
    row.actual = hash12(body);
    if (row.actual === d.sha) {
      row.state = 'match';
      return row;
    }
    if (d.behindSha && d.behindSha === row.actual) {
      row.state = 'behind';
      row.why = `the copy is declared behind this source text, held by ${d.behindRow}`;
      return row;
    }
    row.state = 'drift';
    row.why = d.behindSha ? `the source moved past the declared-behind text ${d.behindSha}, so the drift is unread` : 'the source moved since the copy was reconciled against it';
    return row;
  });
}

export function buildVerdict(rows, scanned, opts = {}) {
  const drift = rows.filter((r) => r.state === 'drift' || r.state === 'error');
  const behind = rows.filter((r) => r.state === 'behind');
  const checked = rows.length;
  const status = checked === 0 ? 'NOT_RUN' : drift.length ? 'FAIL' : behind.length ? 'SHORTFALL' : 'PASS';
  const reason =
    checked === 0
      ? opts.emptyReason || 'no file in the scanned trees declares a port, so nothing was compared'
      : drift.length
        ? `${drift.length} declared port(s) no longer match the source: ${drift.map((r) => `${r.in}:${r.line} ${r.from}#${r.symbol} — ${r.why}`).join(' · ')}`
        : behind.length
          ? `${behind.length} declared port(s) stand knowingly behind their source: ${behind.map((r) => `${r.in}:${r.line} ${r.from}#${r.symbol} (${r.behindRow})`).join(' · ')}`
          : null;
  return makeVerdict({
    gate: 'port-parity',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'declared_ports_whose_source_moved_unread', threshold: 0, unit: 'ports', direction: 'lte' },
    result: checked === 0 ? null : { match: rows.filter((r) => r.state === 'match').length, behind: behind.length, drift: drift.length, filesScanned: scanned },
    evidence: ['tools/port-parity.mjs', ...new Set(rows.map((r) => r.in))],
    reason,
    tool: 'tools/port-parity.mjs'
  });
}

/* ── io ──────────────────────────────────────────────────────────────────────────────────────── */

function scanFiles(root) {
  const out = [];
  for (const s of SCAN) {
    const dir = join(root, s.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (!statSync(p).isFile()) continue;
      if (!s.exts.some((e) => f.endsWith(e))) continue;
      out.push(relative(root, p));
    }
  }
  return out.sort();
}

function run(root) {
  const files = scanFiles(root);
  const decls = [];
  for (const f of files) decls.push(...parseDeclarations(readFileSync(join(root, f), 'utf8'), f));
  const read = (p) => {
    const abs = join(root, p);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  return { rows: evaluate(decls, read), scanned: files.length, files };
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

const SRC_MATCH = 'function ppgFootTimes(text, runsText) {\n  var s = "a { brace in a string";\n  return s;\n}\n';

function selftest() {
  let ran = 0;
  const ok = (cond, what) => {
    ran++;
    if (!cond) {
      console.error(`  ✗ ${what}`);
      process.exitCode = 1;
      throw new Error(`selftest: ${what}`);
    }
    console.log(`  ✓ ${what}`);
  };
  const read = (p) => (p === 'src.js' ? SRC_MATCH : null);
  const good = hash12(extractSymbol(SRC_MATCH, 'ppgFootTimes'));

  ok(extractSymbol(SRC_MATCH, 'ppgFootTimes').includes('a { brace in a string'), 'the slice carries the whole body, braces inside a string included');
  ok(extractSymbol(SRC_MATCH, 'ppgFootTimes').trimEnd().endsWith('}'), 'and it ends at the body brace, not at the signature');

  const decl = (body) => parseDeclarations(`/* ${body} */\n`, 'copy.mjs');
  ok(decl(`@port-from src.js#ppgFootTimes @port-sha ${good}`).length === 1, 'a one-line declaration parses');
  ok(decl(`@port-from src.js#ppgFootTimes @port-sha ${good}`)[0].symbol === 'ppgFootTimes', 'and it carries the symbol');
  ok(parseDeclarations(`// @port-from src.js#f\n// @port-sha ${good}\n`, 'c.mjs')[0].sha === good, 'the @port-sha may sit on a later line of the block');
  ok(parseDeclarations(`// @port-from src.js#f\n\n\n\n\n\n\n// @port-sha ${good}\n`, 'c.mjs')[0].sha === null, 'and a sha seven lines down does not bind to it');

  ok(parseDeclarations(`const s = '@port-from src.js#f @port-sha ${good}';\n`, 'c.mjs').length === 0, 'a declaration in a code line is a string, not a port');
  ok(parseDeclarations(` * @port-from src.js#f @port-sha ${good}\n`, 'c.mjs').length === 1, 'a block comment continuation line declares');

  const ev = (body) => evaluate(decl(body), read);
  ok(ev(`@port-from src.js#ppgFootTimes @port-sha ${good}`)[0].state === 'match', 'a reconciled copy matches');
  ok(ev('@port-from src.js#ppgFootTimes @port-sha 000000000000')[0].state === 'drift', 'a moved source is drift');
  ok(ev(`@port-from src.js#ppgFootTimes @port-sha 000000000000 @port-behind ${good} 2026-11-01-a-row`)[0].state === 'behind', 'a declared-behind copy is neither a pass nor a drift');
  ok(
    ev('@port-from src.js#ppgFootTimes @port-sha 000000000000 @port-behind 111111111111 2026-11-01-a-row')[0].state === 'drift',
    'and a source that moved past the declared-behind text is drift again'
  );
  ok(ev('@port-from gone.js#ppgFootTimes @port-sha 000000000000')[0].why === 'the source file is absent', 'an absent source is named, never skipped');
  ok(/declares no/.test(ev(`@port-from src.js#nosuch @port-sha ${good}`)[0].why || ''), 'an absent symbol is named');
  ok(ev('@port-from src.js#ppgFootTimes')[0].why === 'the declaration names a source and no @port-sha', 'a declaration with no sha is an error, not a pass');

  const twice = (p) => (p === 'src.js' ? `${SRC_MATCH}\nfunction ppgFootTimes(a) {\n  return a;\n}\n` : null);
  ok(/2 times/.test(evaluate(decl(`@port-from src.js#ppgFootTimes @port-sha ${good}`), twice)[0].why || ''), 'two declarations of one symbol pin nothing');

  const destr = 'function f({ a, b }, c) {\n  return a + b + c;\n}\n';
  ok(extractSymbol(destr, 'f').includes('return a + b + c'), 'a destructured parameter does not end the slice at the signature');
  const arrow = 'const g = (x) => {\n  return x;\n};\n';
  ok(extractSymbol(arrow, 'g').includes('return x'), 'an arrow with parens extracts');
  const bare = 'const h = x => {\n  return x * 2;\n};\n';
  ok(extractSymbol(bare, 'h').includes('return x * 2'), 'an arrow with a bare parameter extracts through the fat arrow');

  const v0 = buildVerdict([], 0);
  ok(v0.status === 'NOT_RUN' && v0.result === null, 'no declaration anywhere examines nothing and says NOT_RUN');
  ok(buildVerdict(ev(`@port-from src.js#ppgFootTimes @port-sha ${good}`), 1).status === 'PASS', 'an all-reconciled population is a PASS');
  ok(buildVerdict(ev('@port-from src.js#ppgFootTimes @port-sha 000000000000'), 1).status === 'FAIL', 'unread drift is a FAIL');
  const sh = buildVerdict(ev(`@port-from src.js#ppgFootTimes @port-sha 000000000000 @port-behind ${good} 2026-11-01-a-row`), 1);
  ok(sh.status === 'SHORTFALL' && /2026-11-01-a-row/.test(sh.reason || ''), 'a declared-behind population is a SHORTFALL naming the row');

  /* THE CONTROL: the real tree must be the population this gate claims. A scan that returns no file
     would make every leg above a statement about planted strings only. */
  const files = scanFiles(ROOT);
  ok(files.length > 100 && files.includes('tools/port-parity.mjs'), 'the real scan reaches the tools tree and finds this file');
  console.log(`selftest: all ${ran} assertions passed`);
}

/* ── cli ─────────────────────────────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: ['--print'], boolean: ['--check', '--json', '--selftest', '--verdict-sample'] }, { tool: 'port-parity' });
  const has = (f) => argv.includes(f);
  if (has('--selftest')) {
    selftest();
    process.exit(process.exitCode || 0);
  }
  if (has('--verdict-sample')) {
    /* The sample runs the SAME builder over a root that cannot exist, so no second copy of the
       object can drift from the one a real refusal prints. */
    const sample = run(join(ROOT, 'no-such-tree-for-a-verdict-sample'));
    printVerdict(buildVerdict(sample.rows, sample.scanned, { emptyReason: 'the scanned root does not exist, so no file was read' }));
    process.exit(0);
  }
  const want = argv[argv.indexOf('--print') + 1];
  if (has('--print')) {
    const [p, sym] = String(want).split('#');
    if (!p || !sym) {
      console.error('port-parity: --print takes <repo-relative path>#<symbol>');
      process.exit(2);
    }
    const abs = join(ROOT, p);
    if (!existsSync(abs)) {
      console.error(`port-parity: ${p} does not exist`);
      process.exit(2);
    }
    console.log(hash12(extractSymbol(readFileSync(abs, 'utf8'), sym)));
    process.exit(0);
  }
  const { rows, scanned } = run(ROOT);
  const verdict = buildVerdict(rows, scanned);
  if (has('--json')) console.log(JSON.stringify({ rows, scanned }, null, 1));
  else {
    for (const r of rows) {
      const mark = r.state === 'match' ? '✓' : r.state === 'behind' ? '◐' : '✗';
      console.log(`  ${mark} ${r.in}:${r.line} → ${r.from}#${r.symbol}${r.why ? ` — ${r.why}` : ''}`);
    }
    console.log(
      `port-parity: ${rows.length} declared port(s) over ${scanned} file(s) — ${verdict.result ? `${verdict.result.match} reconciled · ${verdict.result.behind} declared behind · ${verdict.result.drift} unread` : 'nothing declared'}`
    );
  }
  printVerdict(verdict);
  process.exit(verdict.status === 'FAIL' ? 1 : 0);
}
