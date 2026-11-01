#!/usr/bin/env node
/*
 * tools/astgrep-gate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * FIVE REVIEWER BUGS, MATCHED ON THE SYNTAX TREE — §∅, the Clock Contract and §🧾, mechanised.
 *
 * Five shapes that a reviewer reads as a defect, matched on the syntax tree rather than on text.
 * CLAUDE.md names them: `?? 0` and `.get(k, 0)` standing in for absence (§∅), and `new Date(str)` or
 * `Date.parse` standing in for a parse (§🔒 §2.4). The fifth is §🧾's: a `.length` read of a
 * `validate` result, which answers `{ ok, errors, checked }`, so the guard behind it is dead. A regex finds
 * three of them and cannot find the fourth honestly: `new Date($A)` is legal on a number and the root
 * modules make 126 such calls, so the ARGUMENT'S KIND is the rule. ast-grep matches the tree, so the
 * string and the template literal match and the number does not.
 *
 * ── WHAT THIS DOES NOT REPLACE ──────────────────────────────────────────────────────────────────
 * `tests/dex-tests.js` already carries the A1 regex lint (DEV-TOOLCHAIN Part A) over the wired source
 * set, and `tools/absence-regression.mjs` gates the `tMs: … || 0` shape on the diff. Both stay. This
 * gate adds what text cannot see — a template literal passed to `new Date`, which A1's
 * `/new Date\(\s*['"]/` misses by construction — and it adds a second lane, the capture host's
 * Python, which no JS lint reaches.
 *
 * ── THE ALLOW-LIST IS THE MEASUREMENT ───────────────────────────────────────────────────────────
 * Each rule was counted on main before it was made to bite, and every hit was read. 65 Python sites
 * and 3 JS sites are legal and carry a reason in `tools/astgrep-allow.json`; the two Date rules hit
 * ZERO sites in scope, so they are tripwires with an empty allow-list. A stale entry — one whose hit
 * is gone — FAILS the gate, because an exemption that outlives its reason is how one file-keyed
 * allowance blinded a whole module to Clock Contract §5 (DEEP-AUDIT-IV §2).
 *
 * ── THE CONTROLS RUN EVERY TIME ─────────────────────────────────────────────────────────────────
 * A rule file whose pattern breaks matches nothing, and nothing reads as clean. So every run first
 * scans a planted fixture: each rule must match its plant AND ignore its legal twin, or the gate is
 * FAIL with no claim about the tree. A gate that cannot prove it still bites does not get to pass.
 *
 * USAGE
 *   node tools/astgrep-gate.mjs            # report + exit code
 *   node tools/astgrep-gate.mjs --json     # ONE tepna.verdict/1 on stdout (report → stderr)
 *   node tools/astgrep-gate.mjs --selftest # the pure core's assertions, no repository needed
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const SG = join(ROOT, 'node_modules', '.bin', 'ast-grep');
const GATE = 'astgrep-house-rules';

/* THE SCOPE IS A REGEX OVER `git ls-files`, NOT A GLOB AND NOT A DIRECTORY WALK. A tracked-file list
   cannot drift from the repository the way a hand-curated list does (DEEP-AUDIT-III §1.4, where a
   lint's scope silently shrank to 70 of 124 shipped modules), and a glob would pull in the generated
   bundles, `codegen/generated/` and `node_modules`. The authored JS is the root modules plus the two
   directories that ship no bundle; the Python lane is the capture-host tree, tests excluded because a
   test states an expectation about the code under test rather than publishing a measurement. */
export const SCOPES = {
  js: {
    label: 'root *.js + tests/*.{js,mjs} + codegen/*.{js,mjs}',
    keep: (f) => /^[^/]+\.js$/.test(f) || /^(?:tests|codegen)\/[^/]+\.(?:js|mjs)$/.test(f)
  },
  py: {
    label: 'capture-host/**.py (tests excluded)',
    keep: (f) => /^capture-host\/(?:tools\/|deploy\/)?[^/]+\.py$/.test(f)
  },
  /* THE `js` SCOPE DOES NOT REACH `tools/`, AND THAT IS WHERE THE VERDICT CONSUMERS LIVE. Measured
     2026-11-01 over the tree: all 80 bindings of a `validate` result sit in `tools/*.mjs` and
     `tests/dex-tests.js`, and all five defective ones are in `tools/`. So this scope is `js` plus the
     top-level tools, for the one rule that needs it. It is ADDITIVE: widening `js` itself would put
     306 more files under the four standing rules and turn their empty allow-lists into a backlog.
     `tools/probe-batteries/**` stays out — those are per-node DSP copies and none of them calls
     `validate`, so a hit there could only be a duplicate of its root module's. */
  jsTools: {
    label: 'root *.js + tests/*.{js,mjs} + codegen/*.{js,mjs} + tools/*.mjs',
    keep: (f) => SCOPES.js.keep(f) || /^tools\/[^/]+\.mjs$/.test(f)
  }
};

export const RULES = [
  { id: 'no-nullish-zero', scope: 'js' },
  { id: 'no-new-date-string', scope: 'js' },
  { id: 'no-date-parse', scope: 'js' },
  { id: 'no-dict-get-zero', scope: 'py' },
  { id: 'no-verdict-validate-length', scope: 'jsTools' }
];

/* PLANT AND LEGAL TWIN PER RULE. The twin is the half that matters: a rule that matched everything
   would pass a plant-only control. */
export const CONTROLS = {
  'no-nullish-zero': { ext: 'js', plant: 'const a = x ?? 0;\n', twin: 'const b = x ?? null;\nconst c = x || 0;\n' },
  'no-new-date-string': {
    ext: 'js',
    plant: "const a = new Date('2026-05-13');\nconst b = new Date(`${y}-${m}`);\n",
    twin: 'const c = new Date(tMs);\nconst d = new Date(Date.UTC(2026, 4, 13));\n'
  },
  'no-date-parse': { ext: 'js', plant: 'const a = Date.parse(raw);\n', twin: 'const b = parseTimestamp(raw);\n' },
  'no-dict-get-zero': { ext: 'py', plant: 'a = d.get(k, 0)\nb = d.get(k, 0.0)\n', twin: 'c = d.get(k)\ne = d.get(k, None)\n' },
  /* The twin carries BOTH legal reads of the object and a real array's `.length`, because a rule
     keyed on `.length` alone would match every array in the tree. */
  'no-verdict-validate-length': {
    ext: 'mjs',
    plant:
      'function a() {\n  const bad = Verdict.validate(v);\n  if (bad.length) process.exit(2);\n}\n' +
      'function b() {\n  const bad = Verdict.validate(v);\n  if (bad && bad.length) process.exit(2);\n}\n',
    twin:
      'function c() {\n  const ck = Verdict.validate(v);\n  if (!ck.ok) throw new Error(ck.errors.join("; "));\n}\n' +
      'function d() {\n  const chk = Verdict.validate(v);\n  if (!chk.ok) console.error(chk.errors.length);\n}\n' +
      'function e() {\n  const list = xs.filter(Boolean);\n  if (list.length) process.exit(2);\n}\n'
  }
};

/* ── PURE CORE ────────────────────────────────────────────────────────────────────────────────────
   Hits in, three disjoint sets out. No fs, no git, no ast-grep, so the selftest plants a stale entry
   and an unknown reason without a repository. The KEY is rule · file · normalised match · ordinal:
   line numbers move on every edit above them, and an occurrence ordinal separates two identical
   matches on one line (the absence-ledger key, #3192 — a content-only key mapped two mutants onto one
   entry and blanked four of them). */
export function normalise(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

export function keyOf(rule, file, match, ordinal) {
  return `${rule}\u0000${file}\u0000${normalise(match)}\u0000${ordinal}`;
}

export function withOrdinals(hits) {
  const seen = new Map();
  return hits.map((h) => {
    const k = `${h.rule}\u0000${h.file}\u0000${normalise(h.match)}`;
    const ordinal = seen.get(k) ?? 0;
    seen.set(k, ordinal + 1);
    return { ...h, match: normalise(h.match), ordinal };
  });
}

export function classify(hits, allowFile) {
  const reasons = (allowFile && allowFile.reasons) || {};
  const entries = [];
  for (const [rule, list] of Object.entries((allowFile && allowFile.allow) || {})) {
    for (const e of list || []) entries.push({ rule, ...e, key: keyOf(rule, e.file, e.match, e.ordinal ?? 0) });
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const ordered = withOrdinals(hits);
  const used = new Set();
  const unallowed = [];
  for (const h of ordered) {
    const k = keyOf(h.rule, h.file, h.match, h.ordinal);
    const e = byKey.get(k);
    if (!e) unallowed.push(h);
    else used.add(k);
  }
  const stale = entries.filter((e) => !used.has(e.key));
  const unreasoned = entries.filter((e) => !e.why || !reasons[e.why]);
  return { hits: ordered, unallowed, stale, unreasoned, allowed: used.size };
}

/* ── THE SCAN ─────────────────────────────────────────────────────────────────────────────────── */
function tracked() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf-8', maxBuffer: 1 << 28 });
  return out.split('\n').filter(Boolean);
}

/* `scan` exits 1 when it FINDS an error-severity match, which is the normal case here and not a tool
   failure; anything else is. A refusal returns no verdict about the tree rather than a green one. */
function scan(ruleId, paths) {
  const args = ['scan', '-r', join(ROOT, 'tools', 'astgrep-rules', `${ruleId}.yml`), '--json=compact', ...paths];
  let out;
  try {
    out = execFileSync(SG, args, { encoding: 'utf-8', maxBuffer: 1 << 28, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.status !== 1)
      throw new Error(
        `ast-grep ${ruleId} exited ${e.status ?? 'by signal'}: ${String(e.stderr || '')
          .trim()
          .slice(0, 400)}`
      );
    out = String(e.stdout || '');
  }
  return (JSON.parse(out || '[]') || []).map((m) => ({
    rule: ruleId,
    file: m.file.startsWith(ROOT) ? m.file.slice(ROOT.length + 1) : m.file,
    line: m.range.start.line + 1,
    match: m.text
  }));
}

function controls() {
  const dir = mkdtempSync(join(tmpdir(), 'astgrep-controls-'));
  const failed = [];
  try {
    for (const r of RULES) {
      const c = CONTROLS[r.id];
      if (!c) {
        failed.push(`${r.id}: no control is declared`);
        continue;
      }
      const plant = join(dir, `${r.id}-plant.${c.ext}`);
      const twin = join(dir, `${r.id}-twin.${c.ext}`);
      writeFileSync(plant, c.plant);
      writeFileSync(twin, c.twin);
      const onPlant = scan(r.id, [plant]).length;
      const onTwin = scan(r.id, [twin]).length;
      if (onPlant === 0) failed.push(`${r.id}: the plant was not matched — the rule has stopped biting`);
      if (onTwin !== 0) failed.push(`${r.id}: the legal twin matched ${onTwin} time(s) — the rule is too wide`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failed;
}

function verdictOf({ status, pairs, res, reason }) {
  const v = Verdict.make({
    gate: GATE,
    status,
    population: { checked: pairs, eligible: pairs, excluded: 0 },
    criterion: {
      name: 'unallowlisted_hits_plus_stale_allowlist_entries',
      threshold: 0,
      unit: 'sites over the (rule × tracked file) pairs in scope',
      direction: 'lte'
    },
    result: status === 'NOT_RUN' ? null : res,
    evidence: ['tools/astgrep-gate.mjs', 'tools/astgrep-allow.json', ...RULES.map((r) => `tools/astgrep-rules/${r.id}.yml`)],
    reason: status === 'PASS' ? null : reason,
    producedBy: {
      tool: 'tools/astgrep-gate.mjs',
      commit: (() => {
        try {
          return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`${GATE} produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function run(asJson) {
  const say = asJson ? (s) => process.stderr.write(s + '\n') : (s) => process.stdout.write(s + '\n');
  const emit = (v) => {
    if (asJson) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  };
  if (!existsSync(SG)) {
    const v = verdictOf({ status: 'NOT_RUN', pairs: 0, res: null, reason: 'ast-grep is not installed — run `npm ci` (a missing tool is not a pass)' });
    say(`✗ ${GATE}: ast-grep is not installed at node_modules/.bin/ast-grep — run \`npm ci\`. NOTHING was examined.`);
    emit(v);
    return 2;
  }
  const files = tracked();
  const scoped = Object.fromEntries(Object.entries(SCOPES).map(([k, s]) => [k, files.filter(s.keep)]));
  const empty = Object.entries(scoped).filter(([, v]) => v.length === 0);
  if (empty.length) {
    const v = verdictOf({ status: 'NOT_RUN', pairs: 0, res: null, reason: `scope ${empty.map(([k]) => k).join(', ')} resolved to zero tracked files` });
    say(`✗ ${GATE}: scope ${empty.map(([k]) => k).join(', ')} is EMPTY — the file list failed closed rather than passing over nothing.`);
    emit(v);
    return 2;
  }
  const ctl = controls();
  if (ctl.length) {
    const v = verdictOf({ status: 'FAIL', pairs: 0, res: { controls: ctl }, reason: `${ctl.length} positive control(s) failed — the rules cannot be shown to bite` });
    say(`✗ ${GATE}: the controls failed, so this run makes no claim about the tree:\n  · ${ctl.join('\n  · ')}`);
    emit(v);
    return 1;
  }
  const allowFile = JSON.parse(readFileSync(join(ROOT, 'tools', 'astgrep-allow.json'), 'utf-8'));
  let pairs = 0;
  const hits = [];
  for (const r of RULES) {
    const paths = scoped[r.scope];
    pairs += paths.length;
    hits.push(...scan(r.id, paths));
  }
  const c = classify(hits, allowFile);
  const bad = c.unallowed.length + c.stale.length + c.unreasoned.length;
  const res = {
    hits: c.hits.length,
    allowlisted: c.allowed,
    unallowlisted: c.unallowed.map((h) => `${h.file}:${h.line} ${h.rule} — ${h.match}`),
    staleAllowlistEntries: c.stale.map((e) => `${e.rule} · ${e.file} · ${e.match} #${e.ordinal ?? 0}`),
    entriesWithoutAReason: c.unreasoned.map((e) => `${e.rule} · ${e.file} · ${e.match}`),
    perRule: Object.fromEntries(RULES.map((r) => [r.id, c.hits.filter((h) => h.rule === r.id).length])),
    scopes: Object.fromEntries(Object.entries(scoped).map(([k, v]) => [k, { files: v.length, label: SCOPES[k].label }])),
    controls: 'pass'
  };
  const reason = bad ? `${c.unallowed.length} unallow-listed site(s), ${c.stale.length} stale entr(ies), ${c.unreasoned.length} entr(ies) without a reason` : null;
  const v = verdictOf({ status: bad ? 'FAIL' : 'PASS', pairs, res, reason });
  for (const r of RULES) {
    const n = res.perRule[r.id];
    say(`  ${n === 0 ? '✓' : '·'} ${r.id}: ${n} hit(s) over ${scoped[r.scope].length} file(s) — ${SCOPES[r.scope].label}`);
  }
  if (c.unallowed.length) say(`\n✗ ${c.unallowed.length} site(s) with no allow-list entry:\n  · ${res.unallowlisted.join('\n  · ')}`);
  if (c.stale.length) say(`\n✗ ${c.stale.length} stale allow-list entr(ies) — the hit is gone, so DELETE the entry:\n  · ${res.staleAllowlistEntries.join('\n  · ')}`);
  if (c.unreasoned.length) say(`\n✗ ${c.unreasoned.length} entr(ies) name no reason in \`reasons\`:\n  · ${res.entriesWithoutAReason.join('\n  · ')}`);
  say(bad ? `\n✗ ${GATE} FAIL — ${reason}` : `\n✓ ${GATE} PASS — ${c.hits.length} hit(s), all ${c.allowed} allow-listed with a reason; controls green`);
  emit(v);
  return bad ? 1 : 0;
}

/* ── SELFTEST ─────────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let n = 0;
  const eq = (cond, what) => {
    n += 1;
    if (!cond) {
      process.stdout.write(`  ✗ ${what}\n`);
      process.exitCode = 1;
    }
  };
  const allow = {
    reasons: { tally: 'a count of events' },
    allow: { 'no-dict-get-zero': [{ file: 'a.py', match: 'c.get(k, 0)', ordinal: 0, why: 'tally' }] }
  };
  const one = [{ rule: 'no-dict-get-zero', file: 'a.py', line: 3, match: 'c.get(k,  0)' }];
  let c = classify(one, allow);
  eq(c.unallowed.length === 0 && c.allowed === 1, 'whitespace in the match is normalised before the key is built');
  eq(c.stale.length === 0, 'an entry whose hit is present is not stale');
  c = classify([], allow);
  eq(c.stale.length === 1 && c.unallowed.length === 0, 'an entry whose hit is GONE is stale — a fix may not leave its licence behind');
  c = classify([...one, { rule: 'no-dict-get-zero', file: 'a.py', line: 3, match: 'c.get(k, 0)' }], allow);
  eq(c.unallowed.length === 1 && c.unallowed[0].ordinal === 1, 'a SECOND identical match on one line needs its own entry (the ordinal)');
  c = classify(one, { reasons: {}, allow: allow.allow });
  eq(c.unreasoned.length === 1, 'an entry whose `why` names no reason fails, so an exemption cannot be silent');
  c = classify([{ rule: 'no-nullish-zero', file: 'a.js', line: 1, match: 'x ?? 0' }], allow);
  eq(c.unallowed.length === 1, 'an entry for one rule does not exempt another rule at the same site');
  eq(withOrdinals([]).length === 0, 'no hits yields no ordinals');
  eq(keyOf('r', 'f', 'a  b', 2) === keyOf('r', 'f', 'a b', 2), 'the key is built on the normalised match');
  eq(
    RULES.every((r) => CONTROLS[r.id] && CONTROLS[r.id].plant && CONTROLS[r.id].twin),
    'every rule declares a plant AND a legal twin'
  );
  eq(
    RULES.every((r) => SCOPES[r.scope]),
    'every rule names a declared scope'
  );
  eq(
    SCOPES.js.keep('oxydex-dsp.js') && !SCOPES.js.keep('docs/OxyDex.html') && !SCOPES.js.keep('codegen/generated/eegdex-registry.js'),
    'the JS scope takes the authored modules and not the generated trees'
  );
  eq(
    SCOPES.py.keep('capture-host/capture.py') && SCOPES.py.keep('capture-host/tools/mutate.py') && !SCOPES.py.keep('capture-host/tests/test_capture.py'),
    'the Python scope takes the capture host and not its tests'
  );
  process.stdout.write(`all ${n} selftests passed\n`);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) selftest();
else process.exit(run(argv.includes('--json')));
