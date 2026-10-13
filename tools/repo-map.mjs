#!/usr/bin/env node
/*
 * tools/repo-map.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ──────────────────────────────────────────────────────────────────────────────────────────
 * MAP EVERY AUTHORED SOURCE FILE TO THE FUNCTIONS AND EXPORTS IT DECLARES — so a symbol can be
 * found without already knowing which of the 426 JS and 492 Python files holds it (measured
 * 2026-10-12: 918 files, 20,472 functions, 12,496 exports, in 0.9 s).
 *
 * `docs/TOOLS-INDEX.md` answers "does a tool for this exist", one line per tool. This answers the
 * question one level down: which file declares `hostAxis`, and what else does that file expose. The
 * two halves of a surface — what a file DECLARES and what it EXPOSES — are different sets here, and
 * the gap is where the fleet loses time. `clock.js` declares 13 functions inside one IIFE and exposes
 * 12 of them on `root.DexClock`; a session reading the file top-down cannot see which is which
 * without scrolling to the bottom, and the one that is NOT exposed is `_ckMk`, the range validator
 * the Clock Contract §2.7 turns on.
 *
 * 🔴 THIS TOOL DECIDES NOTHING AND EMITS NO `tepna.verdict/1` OBJECT. A map is a reference, not a
 * gate: there is no pre-stated criterion it could pass or fail, and `CLAUDE.md` §🧾 reserves the
 * verdict object for a tool that decides something. A status printed over a map would be exactly the
 * §4b shape this repo keeps catching — a green word about a question nobody asked.
 *
 * ── TWO METHODS, AND THE WEAKER ONE SAYS SO ──────────────────────────────────────────────────
 * Python is parsed with the `ast` module, so its answer is EXACT for a file that parses. JavaScript
 * is scanned by REGEX, so its answer is approximate — it finds the declaration forms this repo
 * actually uses and will miss anything else. Every record therefore carries `method`, `"ast"` or
 * `"regex"`, and the report prints the method beside the counts. A reader who needs certainty about
 * a JS symbol greps for it; this narrows where to grep.
 *
 * What the JS scan reads, measured against this repo's own conventions:
 *   · `function f`, `async function f`, `function* f` at any indentation (root modules wrap
 *     everything in an IIFE, so a `^function` anchor would have found nothing in `clock.js`)
 *   · `const f = () => …`, `const f = function …`, `class C`
 *   · ESM: `export function`, `export const`, `export default`, `export { a, b as c }`
 *   · the global-assignment surface this repo uses instead of ESM in root modules:
 *     `root.DexClock = { … }`, `window.X =`, `globalThis.X =`, `module.exports =` — and for an
 *     object literal, its depth-1 keys, which ARE the exposed surface
 *
 * ⚠️ AN EMPTY LIST AND AN ABSENT ONE ARE DIFFERENT (`CLAUDE.md` §∅). A file that genuinely declares
 * no function reports `functions: []` — a measurement. A file that could not be read or parsed
 * reports `symbols: null` with a named `reason`, and is counted as `unparsed`, never as a file with
 * zero symbols. The same rule governs the Python half as a whole: with no `python3` on PATH every
 * Python record is `null` with reason `python3-absent`, and the report says so on its own line. It
 * does not print a zero.
 *
 * ⚠️ `__all__` HAS THREE STATES, not two. Absent, a readable literal, or present but not literal
 * (built by a loop or a concatenation). The third cannot be flattened into the first without
 * claiming a file exports its public names when it does not say so, so `dunderAllState` carries
 * `absent` · `literal` · `not-a-literal` and the export basis is labelled per file.
 *
 * Usage:
 *   node tools/repo-map.mjs                      # the map, one block per file
 *   node tools/repo-map.mjs --summary            # counts only, one line per file
 *   node tools/repo-map.mjs --only <substring>   # files whose path contains it
 *   node tools/repo-map.mjs --symbol <name>      # every file declaring or exposing that name
 *   node tools/repo-map.mjs --json               # the whole map as one JSON object
 *   node tools/repo-map.mjs --selftest
 * ────────────────────────────────────────────────────────────────────────────────────────── */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* WHAT COUNTS AS AUTHORED SOURCE — `git ls-files`, not a directory allowlist.
   The first draft of this tool listed the trees it knew: root, tools, tests, codegen. It scanned 408
   of the 425 JS files then tracked and 487 of its 492 Python files, and the report read complete. The
   missing ones were `adapters/`, `experiments/` and `how-to-collect/` — directories nobody had
   thought of, which is the whole failure mode. `selftest-all.mjs` records the same lesson for tools:
   "a hardcoded list is the thing that goes stale … its absence would look identical to it passing".
   So the index is the git index, and only the GENERATED trees are named. */
const SKIP_PREFIX = ['docs/', 'docs-archive/', 'codegen/generated/'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'docs', 'docs-archive', 'generated', '.venv', '__pycache__', 'uploads', 'analysis', 'provenance']);

/** Line number of a byte offset, via a prefix table built once per file. */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const FN_DECL = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)/g;
const FN_ASSIGN = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*(?:async[ \t]+)?(?:function\b|\([^)\n]*\)[ \t]*=>|[A-Za-z_$][\w$]*[ \t]*=>)/g;
const CLASS_DECL = /(?:^|\n)[ \t]*(?:export[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)/g;
const EX_FN = /(?:^|\n)[ \t]*export[ \t]+(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)/g;
const EX_DECL = /(?:^|\n)[ \t]*export[ \t]+(?:const|let|var|class)[ \t]+([A-Za-z_$][\w$]*)/g;
const EX_LIST = /(?:^|\n)[ \t]*export[ \t]*\{([^}]*)\}/g;
const EX_DEFAULT = /(?:^|\n)[ \t]*export[ \t]+default\b/g;
/* OBJECT-LITERAL FORMS. `adapters/coospo-rr.js` declares every one of its functions as a property of
   the object it hands to `REG.registerAdapter({ … detect(name, head) { … } … })`. The four patterns
   above found NOTHING there, and the record read `functions: []` — a false measurement in the worst
   direction, since an empty list is otherwise a real one (§∅). So method shorthand and `key: fn` are
   read too, and a keyword denylist keeps `if (…) {` and `catch (e) {` out of the symbol list. */
const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'do',
  'try',
  'else',
  'typeof',
  'new',
  'delete',
  'void',
  'await',
  'in',
  'of',
  'case',
  'with',
  'yield',
  'throw'
]);
const METHOD_SHORTHAND = /(?:^|\n)[ \t]*(?:async[ \t]+)?([A-Za-z_$][\w$]*)[ \t]*\([^)\n]*\)[ \t]*\{/g;
const KEY_FN = /(?:^|\n)[ \t]*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))[ \t]*:[ \t]*(?:async[ \t]+)?(?:function\b|\([^)\n]*\)[ \t]*=>|[A-Za-z_$][\w$]*[ \t]*=>)/g;
/* Does the file contain function-shaped tokens at all? If it does and NOTHING matched, the scan
   missed a form and the record says so instead of reporting a zero. */
const FN_TOKEN = /\bfunction\b|=>/g;

const GLOBAL_ASSIGN = /(?:^|\n)[ \t]*(?:window|globalThis|self|root|exports)\.([A-Za-z_$][\w$]*)[ \t]*=/g;
/* NOT anchored to the line start: this repo guards the assignment — `if (typeof module !== 'undefined'
   && module.exports) module.exports = root.DexClock;` — so an anchored pattern missed every one. */
const CJS_EXPORT = /module\.exports[ \t]*=/g;

/** Depth-1 keys of the object literal starting at `open` (the index of its `{`). */
export function objectKeys(text, open) {
  const keys = [];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && /[A-Za-z_$'"]/.test(c)) {
      const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))[ \t]*:/.exec(text.slice(i, i + 80));
      if (m) {
        keys.push(m[1] || m[2] || m[3]);
        i += m[0].length - 1;
      }
    }
  }
  return keys;
}

/** Functions, classes and exports a JS/MJS source declares. Regex — see the header. */
export function jsSymbols(text) {
  const at = lineIndex(text);
  const fns = new Map();
  const classes = new Map();
  const exports = new Map();
  /* `(?:^|\n)` CONSUMES the newline, so m.index points at the line BEFORE the declaration. Every
     offset below is therefore stepped past it; measured against a fixture whose first function sits
     on line 2 and reported line 1. */
  const off0 = (m) => m.index + (text[m.index] === '\n' ? 1 : 0);
  const add = (into, name, off) => {
    if (!into.has(name)) into.set(name, at(off));
  };
  for (const re of [FN_DECL, FN_ASSIGN]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) add(fns, m[1], off0(m));
  }
  for (const re of [METHOD_SHORTHAND, KEY_FN]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const name = m[1] || m[2] || m[3];
      if (name && !KEYWORDS.has(name)) add(fns, name, off0(m));
    }
  }
  CLASS_DECL.lastIndex = 0;
  for (let m = CLASS_DECL.exec(text); m; m = CLASS_DECL.exec(text)) add(classes, m[1], off0(m));
  for (const re of [EX_FN, EX_DECL]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) add(exports, m[1], off0(m));
  }
  EX_DEFAULT.lastIndex = 0;
  for (let m = EX_DEFAULT.exec(text); m; m = EX_DEFAULT.exec(text)) add(exports, 'default', off0(m));
  EX_LIST.lastIndex = 0;
  for (let m = EX_LIST.exec(text); m; m = EX_LIST.exec(text)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(exports, name, off0(m));
    }
  }
  GLOBAL_ASSIGN.lastIndex = 0;
  for (let m = GLOBAL_ASSIGN.exec(text); m; m = GLOBAL_ASSIGN.exec(text)) {
    add(exports, m[1], off0(m));
    const brace = text.indexOf('{', m.index + m[0].length - 1);
    const between = brace < 0 ? '' : text.slice(m.index + m[0].length, brace);
    if (brace >= 0 && /^[ \t\r\n]*$/.test(between)) {
      for (const k of objectKeys(text, brace)) add(exports, `${m[1]}.${k}`, brace);
    }
  }
  CJS_EXPORT.lastIndex = 0;
  for (let m = CJS_EXPORT.exec(text); m; m = CJS_EXPORT.exec(text)) add(exports, 'module.exports', m.index);
  const named = (map) => [...map].map(([name, line]) => ({ name, line })).sort((a, b) => a.line - b.line);
  FN_TOKEN.lastIndex = 0;
  const tokens = (text.match(FN_TOKEN) || []).length;
  const out = { method: 'regex', functions: named(fns), classes: named(classes), exports: named(exports) };
  if (out.functions.length === 0 && out.classes.length === 0 && tokens > 0) {
    out.note = `${tokens} function-shaped token(s) and no NAMED declaration — anonymous callbacks, or a form this scan does not read`;
  }
  return out;
}

/* The Python half runs ONE isolated interpreter over every path. `-I` keeps the script's directory
   and site-packages off `sys.path`, so a stray `ast.py` beside a source file cannot be imported in
   its place; the script itself arrives on stdin and the paths as argv. */
const PY_SCRIPT = `
import ast, json, sys
for p in sys.argv[1:]:
    rec = {"file": p}
    try:
        src = open(p, encoding="utf-8").read()
    except OSError as e:
        rec["symbols"] = None
        rec["reason"] = "unreadable: %s" % type(e).__name__
        print(json.dumps(rec)); continue
    try:
        tree = ast.parse(src, filename=p)
    except SyntaxError as e:
        rec["symbols"] = None
        rec["reason"] = "syntax-error at line %s" % (e.lineno,)
        print(json.dumps(rec)); continue
    funcs, classes, state, names = [], [], "absent", None
    FN = (ast.FunctionDef, ast.AsyncFunctionDef)
    for node in tree.body:
        if isinstance(node, FN):
            funcs.append({"name": node.name, "line": node.lineno})
        elif isinstance(node, ast.ClassDef):
            classes.append({"name": node.name, "line": node.lineno,
                            "methods": [m.name for m in node.body if isinstance(m, FN)]})
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "__all__":
                    try:
                        names = list(ast.literal_eval(node.value)); state = "literal"
                    except Exception:
                        names = None; state = "not-a-literal"
    rec["symbols"] = {"functions": funcs, "classes": classes,
                      "dunderAllState": state, "dunderAll": names}
    print(json.dumps(rec))
`;

/** Parse every path with python3's `ast`. Returns a Map path → record; `null` symbols when absent. */
export function pySymbols(paths, { python = 'python3', root = ROOT } = {}) {
  const out = new Map();
  if (paths.length === 0) return out;
  let lines;
  try {
    lines = execFileSync(python, ['-I', '-', ...paths], {
      cwd: root,
      input: PY_SCRIPT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }).split('\n');
  } catch (e) {
    /* §∅: no interpreter is not zero symbols. Every record says why it is absent. */
    const reason = e?.code === 'ENOENT' ? 'python3-absent' : `python3-failed: ${String(e?.message || e).split('\n')[0]}`;
    for (const p of paths) out.set(p, { file: p, method: 'ast', symbols: null, reason });
    return out;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    out.set(rec.file, { ...rec, method: 'ast' });
  }
  for (const p of paths) if (!out.has(p)) out.set(p, { file: p, method: 'ast', symbols: null, reason: 'no record returned' });
  return out;
}

/** Authored source paths with one of `exts`, from the git index; a filesystem walk when git cannot
    answer. `discovery` says which ran, because the two cover different sets and a reader of the
    count is owed the basis. */
export function discover(exts, { root = ROOT } = {}) {
  const keep = (rel) => exts.some((x) => rel.endsWith(x)) && !SKIP_PREFIX.some((d) => rel.startsWith(d));
  try {
    /* `--others --exclude-standard` as well as the index, so a source file WRITTEN THIS SESSION and not
       yet `git add`-ed is in the map. Without it this tool could not find itself, which was measured.
       `--exclude-standard` keeps gitignored build output out. */
    const listed = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore']
    })
      .split('\0')
      .filter((rel) => rel && keep(rel));
    return { discovery: 'git', paths: listed.sort() };
  } catch (e) {
    const found = [];
    const walk = (dir, depth) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const en of entries) {
        const full = join(dir, en.name);
        if (en.isDirectory()) {
          if (!SKIP_DIRS.has(en.name) && !en.name.startsWith('.') && depth < 8) walk(full, depth + 1);
        } else {
          const rel = relative(root, full);
          if (keep(rel)) found.push(rel);
        }
      }
    };
    walk(resolve(root), 0);
    return { discovery: `walk (git unavailable: ${String(e?.code || e?.message || e).split('\n')[0]})`, paths: found.sort() };
  }
}

/** The export basis for a Python record: what the file SAYS, else its public top-level names. */
export function pyExports(sym) {
  if (!sym) return null;
  if (sym.dunderAllState === 'literal') return { basis: '__all__', names: sym.dunderAll.slice() };
  const names = [...sym.functions.map((f) => f.name), ...sym.classes.map((c) => c.name)].filter((n) => !n.startsWith('_'));
  return { basis: sym.dunderAllState === 'not-a-literal' ? 'public-names (__all__ present, not-a-literal)' : 'public-names', names };
}

export function buildMap({ root = ROOT, python = 'python3' } = {}) {
  const files = [];
  const js = discover(['.js', '.mjs'], { root });
  const py = discover(['.py'], { root });
  for (const rel of js.paths) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      files.push({ file: rel, lang: 'js', method: 'regex', symbols: null, reason: `unreadable: ${e.code || 'error'}` });
      continue;
    }
    const s = jsSymbols(text);
    files.push({ file: rel, lang: 'js', method: 'regex', symbols: s, exports: { basis: 'declared', names: s.exports.map((x) => x.name) } });
  }
  const pyPaths = py.paths;
  const pyRecs = pySymbols(pyPaths, { python, root });
  for (const rel of pyPaths) {
    const rec = pyRecs.get(rel);
    files.push({ file: rel, lang: 'py', method: 'ast', symbols: rec.symbols, reason: rec.reason, exports: pyExports(rec.symbols) });
  }
  const unparsed = files.filter((f) => !f.symbols);
  return {
    root: relative(resolve(root, '..'), root) || '.',
    discovery: js.discovery,
    skipped: SKIP_PREFIX.slice(),
    files,
    totals: {
      files: files.length,
      js: files.filter((f) => f.lang === 'js').length,
      py: files.filter((f) => f.lang === 'py').length,
      unparsed: unparsed.length,
      unparsedReasons: [...new Set(unparsed.map((f) => f.reason))].sort(),
      noNamedDeclaration: files.filter((f) => f.symbols?.note).length,
      functions: files.reduce((n, f) => n + (f.symbols ? f.symbols.functions.length : 0), 0),
      exports: files.reduce((n, f) => n + (f.exports ? f.exports.names.length : 0), 0)
    }
  };
}

/* ── REPORT ──────────────────────────────────────────────────────────────────────────────────── */

function blockFor(f) {
  const out = [`${f.file}  (${f.lang}, ${f.method})`];
  if (!f.symbols) {
    out.push(`    symbols: null — ${f.reason}`);
    return out.join('\n');
  }
  const fns = f.symbols.functions.map((x) => `${x.name}:${x.line}`);
  const cls = (f.symbols.classes || []).map((c) => `${c.name}:${c.line}${c.methods?.length ? `(${c.methods.join(' ')})` : ''}`);
  out.push(`    functions (${fns.length}): ${fns.join(' ') || '—'}`);
  if (f.symbols.note) out.push(`    ⚠ ${f.symbols.note}`);
  if (cls.length) out.push(`    classes (${cls.length}): ${cls.join(' ')}`);
  out.push(`    exports (${f.exports.names.length}, ${f.exports.basis}): ${f.exports.names.join(' ') || '—'}`);
  return out.join('\n');
}

function report(map, { summary, only, symbol }) {
  const lines = [];
  let files = map.files;
  if (only) files = files.filter((f) => f.file.includes(only));
  if (symbol) {
    files = files.filter(
      (f) =>
        f.symbols &&
        (f.symbols.functions.some((x) => x.name === symbol) || (f.symbols.classes || []).some((c) => c.name === symbol) || f.exports.names.some((n) => n === symbol || n.endsWith(`.${symbol}`)))
    );
    lines.push(`▸ ${symbol} — declared or exposed in ${files.length} file(s)`);
  }
  for (const f of files) {
    lines.push(
      summary && !symbol
        ? `  ${f.file.padEnd(46)} ${f.method.padEnd(6)} ${f.symbols ? `fn ${String(f.symbols.functions.length).padStart(3)}  ex ${String(f.exports.names.length).padStart(3)}` : `null — ${f.reason}`}`
        : blockFor(f)
    );
  }
  const t = map.totals;
  lines.push('');
  lines.push(`  ${t.files} file(s) — ${t.js} JS by regex, ${t.py} Python by ast · ${t.functions} function(s) · ${t.exports} export(s)`);
  if (t.noNamedDeclaration) lines.push(`  ${t.noNamedDeclaration} file(s) carry function-shaped tokens with no NAMED declaration — each says so on its own line`);
  lines.push(`  discovered by ${map.discovery || 'unknown'}; generated trees excluded by name: ${(map.skipped || []).join(' ') || '—'}`);
  lines.push(t.unparsed === 0 ? '  every file parsed' : `  ⚠ ${t.unparsed} file(s) report symbols: null — ${t.unparsedReasons.join(' · ')} (NOT counted as zero symbols)`);
  lines.push('  the JS half is a REGEX scan and is approximate; the Python half is exact for a file that parses');
  return lines.join('\n');
}

/* ── SELFTEST ────────────────────────────────────────────────────────────────────────────────── */

function selftest() {
  let n = 0;
  let bad = 0;
  const eq = (cond, what) => {
    n++;
    if (!cond) {
      bad++;
      console.error(`  ✗ ${what}`);
    }
  };

  const iife = [
    '(function (root) {',
    '  function parseTimestamp(raw) { return raw; }',
    '  const tzOffset = (ms) => ms;',
    '  async function hostAxis(a) { return a; }',
    '  root.DexClock = {',
    '    parseTimestamp: parseTimestamp,',
    "    'quoted-key': 1,",
    '    nested: { inner: 2 },',
    '  };',
    '  if (module.exports) module.exports = root.DexClock;',
    '})(globalThis);'
  ].join('\n');
  const s = jsSymbols(iife);
  const fn = s.functions.map((x) => x.name);
  eq(fn.includes('parseTimestamp'), 'an indented `function` inside an IIFE is found (a ^function anchor finds nothing here)');
  eq(fn.includes('hostAxis'), 'an indented `async function` is found');
  eq(fn.includes('tzOffset'), 'a `const f = () =>` form is found');
  const ex = s.exports.map((x) => x.name);
  eq(ex.includes('DexClock'), 'the global-assignment surface `root.X =` is an export');
  eq(ex.includes('DexClock.parseTimestamp'), "the object literal's depth-1 keys are the exposed surface");
  eq(ex.includes('DexClock.quoted-key'), 'a quoted key is read');
  eq(!ex.includes('DexClock.inner'), 'a nested key is NOT read as depth-1');
  eq(ex.includes('module.exports'), 'a `module.exports =` assignment is an export');
  eq(s.functions.find((x) => x.name === 'parseTimestamp').line === 2, 'the line number is the declaration line');

  const esm = 'export function a() {}\nexport const b = 1;\nexport default a;\nconst c = 2;\nexport { c as d };\nclass E {}\n';
  const e2 = jsSymbols(esm).exports.map((x) => x.name);
  eq(e2.includes('a') && e2.includes('b'), '`export function` and `export const` are exports');
  eq(e2.includes('default'), '`export default` is reported under the name default');
  eq(e2.includes('d'), 'a renamed `export { c as d }` is reported by its EXTERNAL name');
  eq(
    jsSymbols(esm).classes.some((c) => c.name === 'E'),
    'a class declaration is found'
  );

  eq(jsSymbols('const x = 1;\n').functions.length === 0, 'a file declaring no function reports an EMPTY list, which is a measurement');
  eq(!jsSymbols('const x = 1;\n').note, 'and carries no missed-form note, because there is nothing function-shaped in it');

  /* The adapter form: every function is a property of an argument object. */
  const adapter = [
    'REG.registerAdapter({',
    '  id: "coospo-rr",',
    '  detect(name, head) { return /x/.test(name); },',
    '  async load(text) { return text; },',
    '  parse: function (t) { return t; },',
    '  score: (t) => t.length,',
    '});',
    'if (REG) { for (const a of REG) { } }'
  ].join('\n');
  const an = jsSymbols(adapter).functions.map((x) => x.name);
  eq(an.includes('detect') && an.includes('load'), 'object method shorthand is read, async included');
  eq(an.includes('parse') && an.includes('score'), '`key: function` and `key: () =>` are read');
  eq(!an.includes('if') && !an.includes('for'), 'a control keyword followed by a brace is NOT a function name');
  eq(!jsSymbols(adapter).note, 'a file whose forms ARE read carries no note');
  eq(/no NAMED declaration/.test(jsSymbols('const f = fns.map(x => x);\n').note || ''), 'a file with function tokens and no matched name SAYS so, instead of reporting a bare zero');

  eq(objectKeys('{ a: 1, b: 2 }', 0).join(',') === 'a,b', 'objectKeys reads a flat literal');
  eq(objectKeys('{ a: { b: 1 }, c: 2 }', 0).join(',') === 'a,c', 'objectKeys stops at depth 1');

  /* §∅ — absence is null, with a reason, and never a zero. */
  const absent = pySymbols(['x.py'], { python: '/nonexistent/python3' });
  eq(absent.get('x.py').symbols === null, 'with no interpreter the Python record is null, not an empty symbol set');
  eq(absent.get('x.py').reason === 'python3-absent', 'and it names the reason');
  eq(pyExports(null) === null, 'pyExports over an absent record is null, never an empty export list');

  const lit = {
    functions: [
      { name: 'pub', line: 1 },
      { name: '_priv', line: 2 }
    ],
    classes: [],
    dunderAllState: 'absent',
    dunderAll: null
  };
  eq(pyExports(lit).basis === 'public-names' && pyExports(lit).names.join() === 'pub', 'with no __all__ the basis is the public top-level names');
  eq(pyExports({ ...lit, dunderAllState: 'literal', dunderAll: ['_priv'] }).names.join() === '_priv', 'a literal __all__ wins over the public names');
  eq(/not-a-literal/.test(pyExports({ ...lit, dunderAllState: 'not-a-literal' }).basis), 'an __all__ that is not a literal is NAMED in the basis, not flattened into absent');

  /* DISCOVERY — the basis is reported, and the generated trees stay out. */
  const d = discover(['.mjs']);
  eq(d.discovery === 'git', 'discovery runs off the git index in a checkout');
  eq(d.paths.includes('tools/repo-map.mjs'), 'and finds this file');
  eq(!d.paths.some((x) => x.startsWith('docs/')), 'a generated tree is excluded by prefix');
  const tmp = mkdtempSync(join(tmpdir(), 'repo-map-'));
  writeFileSync(join(tmp, 'solo.js'), 'function only() {}\n');
  const w = discover(['.js'], { root: tmp });
  eq(/^walk \(git unavailable/.test(w.discovery), 'outside a checkout it falls back to a walk and SAYS so');
  eq(w.paths.join() === 'solo.js', 'the walk finds the same shape of path');
  rmSync(tmp, { recursive: true, force: true });

  const m = {
    files: [{ file: 'a.js', lang: 'js', method: 'regex', symbols: null, reason: 'unreadable: EACCES' }],
    totals: { files: 1, js: 1, py: 0, unparsed: 1, unparsedReasons: ['unreadable: EACCES'], functions: 0, exports: 0 }
  };
  eq(/NOT counted as zero/.test(report(m, {})), 'the report states that an unparsed file is not a zero');
  eq(/approximate/.test(report(m, {})), 'the report names the weaker method as approximate');

  console.log(bad === 0 ? `repo-map: all ${n} selftests passed` : `repo-map: ${bad} of ${n} selftests FAILED`);
  return bad === 0 ? 0 : 1;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: ['--only', '--symbol'], boolean: ['--json', '--summary', '--selftest'] }, { tool: 'tools/repo-map.mjs' });
  if (argv.includes('--selftest')) process.exit(selftest());
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const map = buildMap();
  if (argv.includes('--json')) console.log(JSON.stringify(map, null, 2));
  else console.log(report(map, { summary: argv.includes('--summary'), only: opt('--only'), symbol: opt('--symbol') }));
}
