#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * flag-exit-scan.mjs — WHICH HEALTH FLAGS EXIT ABOVE MODULE-SCOPE EVALUATION THEY NEVER REACH.
 *
 * WHY. Residue `2026-10-28-a-selftest-that-exits-before-the-realm-build-reads-green-on-a-dead-tool`:
 * `tools/cpap-oxy-couple.mjs` reads `--verdict-sample` and `--selftest` at module scope and exits
 * there, while its `vm` realm is built 120 lines BELOW. Both flags printed green for three months on
 * a tool that exited 1 at the realm load on every real run. The row closed the instance with a test
 * that spawns the tool past its realm build, and left the CLASS unmeasured. This measures it.
 *
 * 🔴 WHY A SECOND SCANNER, WHEN `importer-flag-probe.mjs` ALREADY READS MODULE SCOPE. Because that
 * tool's `unguardedModuleWork` is blind to this direction BY AN EXPLICIT LINE:
 *
 *     if (/process\.argv/.test(line)) continue; // an argv read is the question above, not module work
 *
 * Its question is work that runs on a bare IMPORT, so a flag guard is a guard and the line is skipped.
 * The question here is the complement: the guard FIRES, exits, and everything below it stays
 * unevaluated — so the flag's green says nothing about the rest of the file. Its population is also
 * narrower twice over: `scanTools` keeps only tools holding a module-scope flag read, and
 * `unguardedModuleWork` returns early unless the file itself can write, exec or fetch. Adjacency is
 * not equivalence.
 *
 * THE CRITERION, PRE-STATED. A tool is IN the census when all three hold at module scope, in source
 * order, with no function body between them:
 *
 *   1. a top-level branch whose test reads `process.argv`,
 *   2. whose body calls `process.exit(...)` — so control leaves the module there,
 *   3. followed by a later top-level statement that EVALUATES something able to throw:
 *      a `vm` realm, a `require`/dynamic `import`, a file read, a child process, or `new Function`.
 *
 * A flag naming `--help`, `--usage`, `--version` or `--list` makes no claim about the tool's health,
 * so it is reported and excluded from the criterion. A flag naming a selftest, check, verification,
 * verdict or sample does make that claim, and those are what the threshold binds on.
 *
 * ⚠️ THE SHAPE IS WHAT THIS SEES, NEVER THE COVERAGE. The measured instance is still in the census
 * after its fix, and correctly: the file did not move, a test grew. So `covered` below counts tools a
 * test or selftest SPAWNS as a child, and it is a LOWER bound by construction — a grep cannot prove a
 * spawn drives the tool past the statement in question. The criterion binds on the census, which is
 * decidable, and never on coverage, which is not.
 *
 * ⚠️ A FILE THAT DOES NOT PARSE IS `null`, NEVER CLEAN (CLAUDE.md §∅). Parse failures are counted,
 * named and reported as `excluded`, because a scanner that silently drops what it cannot read reports
 * success about something it never examined (§4b).
 *
 * USAGE
 *   node tools/flag-exit-scan.mjs                 # census over tools/, human + verdict
 *   node tools/flag-exit-scan.mjs --json          # the census as JSON
 *   node tools/flag-exit-scan.mjs --baseline      # write the ratchet baseline
 *   node tools/flag-exit-scan.mjs --check         # red only when the census GREW past the baseline
 *   node tools/flag-exit-scan.mjs --selftest      # known answers, with both controls
 *   node tools/flag-exit-scan.mjs --verdict-sample # the census verdict alone, for the adoption gate
 * ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { isCliEntry } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const BASELINE = join(HERE, 'flag-exit-baseline.json');

/* `acorn` is a DECLARED devDependency (package.json, since #3529 on 2026-10-12), not a transitive
   one, so a parse here is as available as biome is. `tools/find-unwired-js.mjs` still carries the
   comment "no typescript, acorn, espree or babel in node_modules" and hand-rolls a tokenizer against
   it; that claim is stale, and its own header says to replace the tokenizer once a parser exists. */
const PARSE = { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true };

/* A flag spelling that CLAIMS the tool is healthy. The claim is what makes a green exit a lie, so the
   threshold binds on this set and on nothing else. */
const CLAIMS_HEALTH = /^--(self-?test|check|verify|verdict|sample|probe|selfcheck|test)\b/;
/* A flag spelling that claims nothing. Reported, never counted. */
const CLAIMS_NOTHING = /^--(help|usage|version|list|print|show)\b/;

/** Every string literal in a subtree, which is where a flag's own spelling lives. */
function literals(node, out = []) {
  walk(node, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value);
  });
  return out;
}

/** Depth-first over every child node. One walker, so no shape is reached by two different readings. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit);
    }
  }
}

/** The dotted name a callee spells, so `vm.createContext` is one string and not a shape to re-derive. */
function calleeName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) {
    const left = calleeName(node.object);
    const right = node.property && node.property.name;
    return left && right ? `${left}.${right}` : right || '';
  }
  return '';
}

/* What counts as module-scope EVALUATION ABLE TO THROW. Each entry is a thing the measured instance's
   real runs actually died on, or the same kind of load by another spelling. A bare assignment of a
   literal is not here, because a flag exiting above one hides nothing. */
const RISK = [
  [/^vm\.(createContext|SourceTextModule|Script|runInContext|runInNewContext|compileFunction)$/, 'vm-realm'],
  [/^(createRequire|require)$/, 'require'],
  [/^(readFileSync|readdirSync|statSync|realpathSync)$/, 'fs-read'],
  [/\.(readFileSync|readdirSync|statSync|realpathSync)$/, 'fs-read'],
  [/^(execSync|execFileSync|spawnSync)$/, 'child-process'],
  [/\.(execSync|execFileSync|spawnSync)$/, 'child-process']
];

/** The first risk this statement evaluates, or `null` when it evaluates none. */
function riskIn(node) {
  let hit = null;
  walk(node, (n) => {
    if (hit) return;
    if (n.type === 'ImportExpression') {
      hit = { kind: 'dynamic-import', line: n.loc.start.line };
      return;
    }
    if (n.type === 'NewExpression' && calleeName(n.callee) === 'Function') {
      hit = { kind: 'new-Function', line: n.loc.start.line };
      return;
    }
    if (n.type !== 'CallExpression') return;
    const name = calleeName(n.callee);
    if (!name) return;
    for (const [re, kind] of RISK) {
      if (re.test(name)) {
        hit = { kind, line: n.loc.start.line, callee: name };
        return;
      }
    }
  });
  return hit;
}

/* 🔴 AN ALIAS IS THE COMMONEST SPELLING, AND A LITERAL `process.argv` READ IS THE RARE ONE.
   `const argv = process.argv.slice(2)` then `if (argv.includes('--selftest'))` is the same flag read,
   and a detector keyed on the literal member expression sees none of it. This scanner was written that
   way too: its own self-check passed on both counts while the file wore the shape twice over. So the
   argv-derived NAMES are collected from module scope first, and a read of one of them counts. */
function argvAliases(ast) {
  const names = new Set();
  for (const stmt of ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) {
      if (!d.id || d.id.type !== 'Identifier' || !d.init) continue;
      let derived = false;
      walk(d.init, (n) => {
        if (n.type === 'MemberExpression' && calleeName(n) === 'process.argv') derived = true;
      });
      if (derived) names.add(d.id.name);
    }
  }
  return names;
}

/** Does this subtree read `process.argv`, directly or through a module-scope alias of it. */
function readsArgv(node, aliases) {
  const names = aliases || new Set();
  let yes = false;
  walk(node, (n) => {
    if (yes) return;
    if (n.type === 'MemberExpression' && calleeName(n) === 'process.argv') yes = true;
    if (n.type === 'Identifier' && names.has(n.name)) yes = true;
  });
  return yes;
}

/** Does this subtree call `process.exit`. */
function exitsProcess(node) {
  let yes = false;
  walk(node, (n) => {
    if (yes) return;
    if (n.type === 'CallExpression' && calleeName(n.callee) === 'process.exit') yes = true;
  });
  return yes;
}

/* A top-level statement is an argv-gated exit when its TEST reads argv and its BODY exits. Both the
   `if (flag) { … exit }` form and the `flag && (…, exit())` expression form are the same shape, so
   both are read, rather than one being the shape and the other a near miss nobody counted. */
function argvGatedExit(stmt, exiters, aliases) {
  if (stmt.type === 'IfStatement') {
    if (!readsArgv(stmt.test, aliases)) return null;
    const how = bodyExits(stmt.consequent, exiters);
    if (!how) return null;
    return { line: stmt.loc.start.line, flags: literals(stmt.test), form: 'if', via: how };
  }
  if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'LogicalExpression' && stmt.expression.operator === '&&') {
    const { left, right } = stmt.expression;
    if (!readsArgv(left, aliases)) return null;
    const how = bodyExits(right, exiters);
    if (!how) return null;
    return { line: stmt.loc.start.line, flags: literals(left), form: 'logical-and', via: how };
  }
  return null;
}

/* 🔴 ONE HOP, BECAUSE THE COMMONEST SPELLING OF THIS DEFECT DELEGATES. `if (flag) selftest();` leaves
   the module exactly as `if (flag) process.exit(0);` does, and a reading that only looks for a literal
   `process.exit` inside the branch misses every tool written the first way. This scanner was itself
   written that way, and its own self-check passed while the file wore the shape — which is the
   `a-selftest-needle-in-the-same-file-self-matches` family, caught here before it shipped.

   The hop is ONE level and names no recursion: a branch calling a top-level function whose own body
   calls `process.exit`. A deeper chain is NOT read, and the header says so, because a blind spot
   stated is a bound and a blind spot unstated is a false count. */
function bodyExits(node, exiters) {
  if (exitsProcess(node)) return 'direct';
  let via = null;
  walk(node, (n) => {
    if (via) return;
    if (n.type !== 'CallExpression') return;
    const name = calleeName(n.callee);
    if (name && exiters.has(name)) via = `calls ${name}()`;
  });
  return via;
}

/** Top-level function names whose own body calls `process.exit`. The one hop's whole lookup. */
function exitingFunctions(ast) {
  const names = new Set();
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id && exitsProcess(stmt.body)) names.add(stmt.id.name);
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (!d.id || d.id.type !== 'Identifier' || !d.init) continue;
        if ((d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression') && exitsProcess(d.init)) names.add(d.id.name);
      }
    }
  }
  return names;
}

/** The census reading for one source text. `null` when it does not parse — never an empty pass. */
export function flagExitShape(src, label = '<src>') {
  let ast;
  try {
    ast = acorn.parse(String(src || ''), PARSE);
  } catch (err) {
    return { parsed: false, reason: `${err && err.message ? err.message : err}`, label };
  }
  const exiters = exitingFunctions(ast);
  const aliases = argvAliases(ast);
  const guards = [];
  let firstGuardIdx = -1;
  for (const [i, stmt] of ast.body.entries()) {
    const g = argvGatedExit(stmt, exiters, aliases);
    if (!g) continue;
    guards.push(g);
    if (firstGuardIdx < 0) firstGuardIdx = i;
  }
  if (!guards.length) return { parsed: true, label, guards: [], risk: null };
  /* ONLY what sits BELOW the first guard is hidden by it. A risk above it is evaluated on every run,
     flag or no flag, so it is not this defect and must not be counted as one. */
  let risk = null;
  for (const stmt of ast.body.slice(firstGuardIdx + 1)) {
    risk = riskIn(stmt);
    if (risk) break;
  }
  const flags = [...new Set(guards.flatMap((g) => g.flags))].filter((f) => f.startsWith('--'));
  return {
    parsed: true,
    label,
    guards,
    risk,
    flags,
    claiming: flags.filter((f) => CLAIMS_HEALTH.test(f)),
    benign: flags.filter((f) => CLAIMS_NOTHING.test(f))
  };
}

/** Tools a test or selftest SPAWNS as a child. A LOWER bound: a grep cannot prove what a spawn drives. */
function spawnedTools() {
  const named = new Set();
  const roots = [join(REPO, 'tests'), join(REPO, 'tools')];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/\.(mjs|js)$/.test(name)) continue;
      let text;
      try {
        text = readFileSync(join(root, name), 'utf8');
      } catch {
        continue;
      }
      if (!/(execFileSync|spawnSync|execSync|spawn\()/.test(text)) continue;
      for (const m of text.matchAll(/tools\/([a-z0-9-]+\.mjs)/g)) named.add(m[1]);
    }
  }
  return named;
}

function census() {
  const dir = join(REPO, 'tools');
  const rows = [];
  const unparsed = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()) {
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch (err) {
      unparsed.push({ name, reason: `unreadable: ${err.message}` });
      continue;
    }
    const shape = flagExitShape(text, name);
    if (!shape.parsed) {
      unparsed.push({ name, reason: shape.reason });
      continue;
    }
    if (!shape.guards.length || !shape.risk) continue;
    rows.push({
      tool: `tools/${name}`,
      exitLine: shape.guards[0].line,
      riskLine: shape.risk.line,
      riskKind: shape.risk.kind,
      flags: shape.flags,
      claiming: shape.claiming,
      benign: shape.benign
    });
  }
  const spawned = spawnedTools();
  for (const r of rows) r.covered = spawned.has(r.tool.replace('tools/', ''));
  return { rows, unparsed, examined: readdirSync(dir).filter((f) => f.endsWith('.mjs')).length };
}

function commitOf() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/* 🔴 TWO MODES, TWO CRITERIA, BECAUSE ONE WOULD LIE. The census judges the absolute shape, which 52
   tools wear today, so its honest status is SHORTFALL. The ratchet judges GROWTH against a recorded
   baseline, and its threshold is zero NEW tools. Published under one criterion the ratchet would print
   `PASS` beside `threshold: 0` with 52 in the result — a verdict a reader cannot act on, which is what
   the contract exists to prevent. The mode names which one it answered. */
const CRITERIA = {
  census: { name: 'health_flag_branches_exiting_above_module_scope_evaluation', threshold: 0, unit: 'tools', direction: 'lte' },
  ratchet: { name: 'tools_joining_the_census_since_the_baseline', threshold: 0, unit: 'tools', direction: 'lte' }
};

function verdict(c, status, reason, mode = 'census', grew = null) {
  const claiming = c.rows.filter((r) => r.claiming.length);
  return {
    schema: 'tepna.verdict/1',
    gate: 'flag-exit-scan',
    status,
    scope: 'internal',
    population: { checked: c.examined - c.unparsed.length, eligible: c.examined, excluded: c.unparsed.length },
    criterion: CRITERIA[mode],
    result: {
      mode,
      joinedSinceBaseline: grew,
      census: c.rows.length,
      claimingHealth: claiming.length,
      benignOnly: c.rows.length - claiming.length,
      coveredLowerBound: claiming.filter((r) => r.covered).length,
      byRisk: claiming.reduce((a, r) => ({ ...a, [r.riskKind]: (a[r.riskKind] || 0) + 1 }), {}),
      unparsed: c.unparsed.map((u) => u.name)
    },
    evidence: ['tools/flag-exit-scan.mjs', 'tools/importer-flag-probe.mjs'],
    reason: reason || null,
    producedBy: { tool: 'tools/flag-exit-scan.mjs', commit: commitOf() },
    at: new Date().toISOString()
  };
}

function report(c) {
  const claiming = c.rows.filter((r) => r.claiming.length);
  console.log(`▸ ${c.examined} tool(s) examined, ${c.unparsed.length} unparsed, ${c.rows.length} in the census`);
  for (const r of claiming) {
    console.log(`  ${r.covered ? '○' : '●'} ${r.tool}  ${r.flags.join(' ')} exits at :${r.exitLine}, ` + `${r.riskKind} at :${r.riskLine}${r.covered ? ' (a test spawns it)' : ''}`);
  }
  const benignOnly = c.rows.filter((r) => !r.claiming.length);
  if (benignOnly.length) {
    console.log(`  ─ ${benignOnly.length} tool(s) whose flags claim no health (reported, not counted):`);
    for (const r of benignOnly) console.log(`    · ${r.tool}  ${r.flags.join(' ')}`);
  }
  for (const u of c.unparsed) console.log(`  ⊘ ${u.name} — ${u.reason}`);
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────────
   Placed ABOVE nothing: this block is the last thing in the file, so the tool cannot be its own
   instance. That is the defect it exists to find, and a scanner wearing it would be the §4b family. */
function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (what, cond) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.log(`  ✗ ${what}`);
    }
  };

  const POSITIVE = ["import vm from 'node:vm';", "if (process.argv.includes('--selftest')) { process.exit(0); }", 'const ctx = vm.createContext({});'].join('\n');
  const p = flagExitShape(POSITIVE, 'positive');
  ok('the measured shape is found', p.guards.length === 1 && p.risk && p.risk.kind === 'vm-realm');
  ok('the flag spelling is read from the test', p.flags.join() === '--selftest');
  ok('a selftest flag claims health', p.claiming.join() === '--selftest');

  const LOGICAL = ["import vm from 'node:vm';", "process.argv.includes('--check') && process.exit(0);", 'const ctx = vm.createContext({});'].join('\n');
  ok('the `flag && exit` form is the same shape', flagExitShape(LOGICAL, 'logical').risk !== null);

  /* CONTROL · the risk ABOVE the guard is evaluated on every run, so it is not this defect. */
  const ABOVE = ["import vm from 'node:vm';", 'const ctx = vm.createContext({});', "if (process.argv.includes('--selftest')) { process.exit(0); }"].join('\n');
  ok('CONTROL · a realm built ABOVE the guard is not counted', flagExitShape(ABOVE, 'above').risk === null);

  /* CONTROL · a guard that does not exit hides nothing: control returns to module scope. */
  const NOEXIT = ["import vm from 'node:vm';", "if (process.argv.includes('--selftest')) { console.log('hi'); }", 'const ctx = vm.createContext({});'].join('\n');
  ok('CONTROL · a branch that does not exit is not a guard', flagExitShape(NOEXIT, 'noexit').guards.length === 0);

  /* CONTROL · an exit on a condition that is not a flag is not this shape. */
  const NOARGV = ["import vm from 'node:vm';", 'if (x) { process.exit(1); }', 'const ctx = vm.createContext({});'].join('\n');
  ok('CONTROL · an exit on no flag read is not a guard', flagExitShape(NOARGV, 'noargv').guards.length === 0);

  /* CONTROL · work below the guard that cannot throw is not a risk. */
  const INERT = ["if (process.argv.includes('--selftest')) { process.exit(0); }", 'const n = 1 + 1;'].join('\n');
  ok('CONTROL · an inert statement below the guard is no risk', flagExitShape(INERT, 'inert').risk === null);

  /* CONTROL · a `--help` flag makes no claim about health. */
  const HELP = ["import vm from 'node:vm';", "if (process.argv.includes('--help')) { process.exit(0); }", 'const ctx = vm.createContext({});'].join('\n');
  const h = flagExitShape(HELP, 'help');
  ok('CONTROL · --help is in the census and claims nothing', h.risk !== null && h.claiming.length === 0 && h.benign.join() === '--help');

  /* §∅ · a file that does not parse is `null`, never clean. */
  const BROKEN = flagExitShape('const = ;', 'broken');
  ok('§∅ · an unparsable file reports `parsed: false`, not a clean read', BROKEN.parsed === false && typeof BROKEN.reason === 'string');

  /* A guard INSIDE a function body is not module scope: the exit happens when the function is called. */
  const NESTED = ["import vm from 'node:vm';", "function main() { if (process.argv.includes('--selftest')) process.exit(0); }", 'const ctx = vm.createContext({});'].join('\n');
  ok('CONTROL · a guard inside a function body is not module scope', flagExitShape(NESTED, 'nested').guards.length === 0);

  /* The measured instance still wears the shape after its fix: the file did not move, a test grew. */
  let instance = null;
  try {
    instance = flagExitShape(readFileSync(join(REPO, 'tools', 'cpap-oxy-couple.mjs'), 'utf8'), 'cpap-oxy-couple.mjs');
  } catch {
    /* absent in a partial checkout: the leg below says so rather than passing silently */
  }
  ok("the row's own instance is in the census, because the SHAPE is what this reads", instance !== null && instance.parsed === true && instance.risk !== null && instance.claiming.length > 0);

  /* This tool is never its own instance. */
  const self = flagExitShape(readFileSync(join(HERE, 'flag-exit-scan.mjs'), 'utf8'), 'flag-exit-scan.mjs');
  ok('the scanner does not wear the shape it reports', self.parsed === true && self.risk === null);

  console.log(fail ? `flag-exit-scan selftest: ${pass} passed, ${fail} failed` : `all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}

/* ── entry ─────────────────────────────────────────────────────────────────────────────────────────
   🔴 THE WHOLE PROGRAM SITS IN `main()` BEHIND THE ENTRY GUARD, and that is not style. Written the
   obvious way — `if (argv.includes('--selftest')) selftest();` at column 0, with `census()` reading
   files below it — this file wore the exact shape it reports. Its own self-check caught that only
   after the alias and one-hop readings above were added, and the fix is the same one
   `2026-10-21-importing-the-fixture-verifier-runs-its-whole-verification` took: hold the program in a
   function behind the guard, so module scope evaluates nothing a flag can skip. */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) selftest();

  const c = census();
  const claiming = c.rows.filter((r) => r.claiming.length);

  /* `--verdict-sample` is how the adoption gate READS this producer (§🧾,
     `tools/verdict-adoption.json`). It prints the REAL census verdict and nothing else: this scan
     needs no corpus and costs ~1.3 s, so a hand-written sample object would be a claim standing
     where a measurement fits. The gate parses stdout from its first `{`, and the census report
     prints tool paths above that brace, so the sample must stay the only thing on stdout. */
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdict(c, claiming.length ? 'SHORTFALL' : 'PASS', claiming.length ? `${claiming.length} health flag(s) exit above module-scope evaluation` : null)));
    process.exit(0);
  }

  if (argv.includes('--baseline')) {
    const base = {
      criterion: 'health_flag_branches_exiting_above_module_scope_evaluation',
      count: claiming.length,
      tools: claiming.map((r) => r.tool).sort(),
      at: new Date().toISOString(),
      commit: commitOf()
    };
    writeFileSync(BASELINE, `${JSON.stringify(base, null, 2)}\n`);
    console.log(`▸ baseline written: ${claiming.length} tool(s) → ${relative(REPO, BASELINE)}`);
    process.exit(0);
  }

  if (argv.includes('--check')) {
    let base;
    try {
      base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    } catch (err) {
      /* An absent baseline is UNKNOWN, never a pass: the ratchet examined nothing to compare against. */
      console.log(JSON.stringify(verdict(c, 'UNKNOWN', `no baseline to ratchet against: ${err.message}`, 'ratchet', null)));
      process.exit(2);
    }
    const grew = claiming.map((r) => r.tool).filter((tool) => !base.tools.includes(tool));
    report(c);
    console.log(JSON.stringify(verdict(c, grew.length ? 'FAIL' : 'PASS', grew.length ? `${grew.length} tool(s) joined the census since the baseline: ${grew.join(', ')}` : null, 'ratchet', grew)));
    process.exit(grew.length ? 1 : 0);
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ census: c.rows, unparsed: c.unparsed, examined: c.examined }, null, 2));
    process.exit(0);
  }

  report(c);
  console.log(JSON.stringify(verdict(c, claiming.length ? 'SHORTFALL' : 'PASS', claiming.length ? `${claiming.length} health flag(s) exit above module-scope evaluation` : null)));
}

if (isCliEntry(import.meta.url)) main();
