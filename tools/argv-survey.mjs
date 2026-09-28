#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * argv-survey.mjs — WHICH TOOLS CAN TELL AN UNKNOWN FLAG FROM AN ABSENT ONE. Executable, controlled,
 * and bounded to the tools it can prove are inert.
 *
 * WHY. Residue `2026-09-28-which-tools-refuse-an-unknown-argv-token-is-unmeasured`, filed after
 * `tools/trio-batch.mjs` silently ignored `--dry` (for `--dry-run`), computed, and WROTE the corpus.
 * The row also records why a keyword scan cannot answer the question: searching the fleet for
 * validation words called trio-batch a VALIDATOR on the strength of the word "unknown" in an unrelated
 * comment — hours after experiment had proved it was not one. So the instrument here is executable.
 *
 * THE DEFECT'S OWN DEFINITION IS THE INSTRUMENT. A token nobody reads is INDISTINGUISHABLE FROM AN
 * ABSENT ONE, so a verdict cannot be read off an exit code — nearly every tool here exits non-zero
 * with no corpus, and that says nothing about argv. Each tool runs three times:
 *
 *   control-A   no arguments
 *   control-B   no arguments again        ← establishes run-to-run volatility BEFORE anything is compared
 *   probe       one bogus token
 *
 * IGNORES is then PROVEN rather than inferred: the probe is indistinguishable from the control, modulo
 * the volatility the two controls already exhibited.
 *
 * ⚠ "THE OUTPUT NAMES THE TOKEN" IS NOT A REFUSAL. The first cut of this harness scored five positives
 * and every one was wrong; read by hand, all five had CONSUMED the token as a path:
 *   · geometry-probe.mjs        printed it as a planted-shape row and exited 0 — it became data
 *   · geometry-scan.mjs         `ERROR: ENOENT … scandir '--no-such-flag-9f3'` and exited 0
 *   · pb-operating-point.mjs    uncaught ENOENT, exit 1, stack trace
 *   · synth-desat-kinetics.mjs  the same
 *   · tch-window-sensitivity.mjs the same
 * So a refusal needs refusal LANGUAGE plus a non-zero exit, and consumption gets its own verdict:
 * swallowing is WORSE than ignoring, because the token then names an input.
 *
 * SAFETY — why this does not probe everything. A tool that ignores the token proceeds to do its job,
 * and that is the hazard under investigation (it has already cost one corpus write). So the population
 * is bounded to tools whose TRANSITIVE local import closure contains no write, exec or network API at
 * all: those cannot move anything, whatever they do with argv. Probing anything else needs a human who
 * has read its no-argument path. Every run also scrubs `DEX_UPLOADS` so no probe can reach the real
 * corpus, bounds each child, and diffs `git status --short` around every tool.
 *
 * A TIMEOUT IS UNDECIDED, NEVER A REFUSAL (CLAUDE.md §4b: a filter that examined nothing is not a
 * pass). Two tools in the inert population run long computations with no arguments and land there.
 *
 *   node tools/argv-survey.mjs                      # probe the inert population, print the table
 *   node tools/argv-survey.mjs --json               # the tepna.verdict/1 object + every row
 *   node tools/argv-survey.mjs --only beat-comb-analysis.mjs
 *   node tools/argv-survey.mjs --timeout-ms 60000
 *   node tools/argv-survey.mjs --selftest           # planted truth: a refuser and an ignorer
 *   node tools/argv-survey.mjs --verdict-sample     # a sample object, probes nothing
 * ════════════════════════════════════════════════════════════════════════ */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';

/* Own location, never the caller's cwd — the PR #686 invariant: a tool that reads repo code must
   derive its root from itself, or running it in a worktree measures a different tree. */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const argv = process.argv.slice(2);
refuseUnknownArgvOrExit(argv, { valued: ['--only', '--timeout-ms'], boolean: ['--json', '--selftest', '--verdict-sample'] }, { tool: 'argv-survey' });
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

export const TOKEN = '--no-such-flag-9f3';
const TIMEOUT_MS = Number(opt('--timeout-ms', '25000'));

/* THE RATCHET, pre-stated (§🧾: a threshold derived from the data it judges is UNKNOWN). Measured
   2026-09-28 over the inert population: 5 tools consume a bogus token as a PATH. That count must not
   grow — a new tool that eats an unknown flag as an input path is a red with its name. The IGNORES
   count is population data, not a criterion: it is the backlog the adoption programme is working
   through, and it falls as tools adopt `argv-guard.mjs`. */
export const SWALLOW_BAR = 5;

/* ── the write/exec surface, named explicitly so the safety criterion is auditable ─────────────── */
const HAZARD = [
  [
    'fs-write',
    /\b(writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync|rmdirSync|unlinkSync|renameSync|cpSync|copyFileSync|writeSync|truncateSync|utimesSync|chmodSync|symlinkSync|linkSync)\s*\(/
  ],
  ['fs-promise-write', /\bfs(Promises)?\.(writeFile|appendFile|mkdir|rm|unlink|rename|cp|copyFile)\s*\(/],
  ['exec', /\b(execSync|execFileSync|spawnSync|spawn|exec|execFile|fork)\s*\(/],
  ['net', /\b(fetch|createServer|request)\s*\(/]
];

function localImports(file, text) {
  const out = new Set();
  const re = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let p = resolve(dirname(file), m[1]);
    if (!/\.(mjs|js|json)$/.test(p)) {
      for (const ext of ['.mjs', '.js', '.json']) {
        if (existsSync(p + ext)) {
          p += ext;
          break;
        }
      }
    }
    if (existsSync(p)) out.add(p);
  }
  return [...out];
}

/** Every hazard reachable from `file` through local imports. An unreadable dep is itself a hazard. */
export function closureHazards(file, seen = new Set()) {
  const abs = resolve(file);
  if (seen.has(abs)) return [];
  seen.add(abs);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return ['unreadable'];
  }
  const hz = new Set(HAZARD.filter(([, re]) => re.test(text)).map(([k]) => k));
  for (const dep of localImports(abs, text)) for (const h of closureHazards(dep, seen)) hz.add(`${h}@dep`);
  return [...hz].sort();
}

/** The probe-safe population: reads argv, and nothing in its closure can write, exec or fetch. */
export function inertPopulation(toolsDir) {
  const out = [];
  for (const name of readdirSync(toolsDir)
    .filter((f) => /\.(mjs|js)$/.test(f))
    .sort()) {
    const p = join(toolsDir, name);
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    if (!/process\.argv/.test(text)) continue;
    if (closureHazards(p).length) continue;
    out.push(name);
  }
  return out;
}

/* ── classification ────────────────────────────────────────────────────────────────────────────── */
const REFUSAL = /\b(unknown|unrecognis|unrecogniz|unexpected|not a (?:known )?(?:flag|option)|refus|invalid (?:flag|option|argument))/i;
const CONSUMED = /ENOENT|no such file|scandir|ENOTDIR|illegal operation on a directory/i;
const STACK = /^\s+at\s+.+(?:node:|\.mjs:\d+|\.js:\d+)/m;

/** Pure, so the planted-truth selftest asserts the DECISION and not a subprocess. */
export function classify({ controlA, controlB, probe }) {
  if (probe.timedOut || controlA.timedOut) return 'UNDECIDED-timeout';
  const volatileOut = controlA.out !== controlB.out;
  const namesToken = probe.out.includes(TOKEN);
  const sameExit = probe.exit === controlA.exit && probe.exit === controlB.exit;
  const sameOut = probe.out === controlA.out || probe.out === controlB.out;
  if (sameExit && (sameOut || (volatileOut && !namesToken))) return 'IGNORES';
  if (namesToken && REFUSAL.test(probe.out) && probe.exit !== 0) return 'REFUSES';
  if (namesToken && (CONSUMED.test(probe.out) || probe.exit === 0)) return 'SWALLOWS-AS-POSITIONAL';
  if (STACK.test(probe.out)) return 'CRASHES';
  return 'REACTS-other';
}

function runOnce(tool, args, cwd) {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.DEX_UPLOADS; // never let a probe reach the real corpus
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, env, maxBuffer: 8 << 20 });
  return {
    exit: r.status,
    timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM',
    ms: Date.now() - t0,
    out: `${r.stdout || ''}${r.stderr || ''}`
  };
}

const treeState = (cwd) => spawnSync('git', ['status', '--short'], { cwd, encoding: 'utf8' }).stdout || '';

export function probeTool(tool, cwd) {
  const before = treeState(cwd);
  const controlA = runOnce(tool, [], cwd);
  const controlB = runOnce(tool, [], cwd);
  const probe = runOnce(tool, [TOKEN], cwd);
  const after = treeState(cwd);
  return {
    tool,
    verdict: classify({ controlA, controlB, probe }),
    exit: { controlA: controlA.exit, controlB: controlB.exit, probe: probe.exit },
    ms: { controlA: controlA.ms, probe: probe.ms },
    volatileOutput: controlA.out !== controlB.out,
    treeMoved: before !== after,
    probeFirstLine: (probe.out.split('\n').find((l) => l.trim()) || '').slice(0, 140)
  };
}

/* ── the verdict ───────────────────────────────────────────────────────────────────────────────── */
export function surveyVerdict(rows, { bar = SWALLOW_BAR, commit } = {}) {
  const tally = rows.reduce((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] || 0) + 1 }), {});
  const swallows = tally['SWALLOWS-AS-POSITIONAL'] || 0;
  const undecided = tally['UNDECIDED-timeout'] || 0;
  const moved = rows.filter((r) => r.treeMoved).map((r) => r.tool);
  /* A moved tree invalidates the run rather than failing the tools: the closure proof says these cannot
     write, so a diff means something else did — a concurrent session, or an edit of mine. Measured
     2026-09-28: two rows flagged a moved tree while I was editing five other files in the same
     worktree, and a re-run in a pristine detached worktree reproduced identical verdicts with none. */
  let status = swallows > bar ? 'FAIL' : 'PASS';
  let reason = swallows > bar ? `${swallows} tool(s) consume an unknown token as a path, over the bar of ${bar}` : null;
  if (moved.length) {
    status = 'UNKNOWN';
    reason = `the working tree moved during the run (${moved.join(', ')}) — re-run in a clean checkout before reading this`;
  } else if (rows.length === 0) {
    status = 'NOT_RUN';
    reason = 'no tool was probed';
  }
  return makeVerdict({
    gate: 'argv-survey',
    status,
    population: { checked: rows.length - undecided, eligible: rows.length, excluded: undecided },
    criterion: { name: 'tools_that_swallow_an_unknown_token_as_a_path', threshold: bar, unit: 'tools', direction: 'lte' },
    /* NOT_RUN carries `result: null` — the contract rejects anything else, and it is right to: a tally
       of zero is a MEASUREMENT OF ZERO, and nothing was examined here. §∅ at the verdict layer. */
    result: rows.length === 0 ? null : { swallows, tally },
    evidence: ['tools/argv-survey.mjs'],
    reason,
    tool: 'tools/argv-survey.mjs',
    commit
  });
}

/* ── planted truth ─────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let bad = 0;
  /* COUNTED, and the count is PRINTED in one of `selftest-all.mjs`'s parseable forms. That count is the
     whole value the sweep adds over CI's loop: CI reads PASS either way, so a suite quietly shrinking
     from 18 assertions to 3 is visible only to a tool that reports how many it ran. */
  let ran = 0;
  const ok = (name, cond, detail) => {
    ran++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : `  — ${detail}`}`);
    if (!cond) bad++;
  };

  /* (1) the DECISION, as a pure function over recorded runs. These are the five hand-read cases. */
  const R = (exit, out, timedOut = false) => ({ exit, out, timedOut });
  ok('indistinguishable from the control ⇒ IGNORES', classify({ controlA: R(2, 'usage\n'), controlB: R(2, 'usage\n'), probe: R(2, 'usage\n') }) === 'IGNORES');
  ok('a real refusal ⇒ REFUSES', classify({ controlA: R(0, 'did work\n'), controlB: R(0, 'did work\n'), probe: R(2, `✗ t: unknown flag ${TOKEN}\n`) }) === 'REFUSES');
  ok(
    'the token echoed as DATA with exit 0 ⇒ SWALLOWS (geometry-probe)',
    classify({ controlA: R(0, 'clean | none\n'), controlB: R(0, 'clean | none\n'), probe: R(0, `${TOKEN} | none\n`) }) === 'SWALLOWS-AS-POSITIONAL'
  );
  ok(
    'ENOENT on the token ⇒ SWALLOWS, not REFUSES (geometry-scan)',
    classify({ controlA: R(2, 'usage\n'), controlB: R(2, 'usage\n'), probe: R(0, `ERROR: ENOENT: scandir '${TOKEN}'\n`) }) === 'SWALLOWS-AS-POSITIONAL'
  );
  ok('an uncaught throw naming no flag ⇒ CRASHES', classify({ controlA: R(2, 'usage\n'), controlB: R(2, 'usage\n'), probe: R(1, 'Error: boom\n    at x (node:fs:1)\n') }) === 'CRASHES');
  ok('a timeout ⇒ UNDECIDED, never a refusal', classify({ controlA: R(null, '', true), controlB: R(null, ''), probe: R(null, '', true) }) === 'UNDECIDED-timeout');
  ok('volatile control output does not manufacture a reaction', classify({ controlA: R(0, 'took 11ms\n'), controlB: R(0, 'took 12ms\n'), probe: R(0, 'took 13ms\n') }) === 'IGNORES');

  /* (2) END TO END on two tools written for the purpose: if the harness cannot see a guard refuse,
         its "nobody refuses" result would be a property of the harness and not of the fleet. */
  const dir = mkdtempSync(join(tmpdir(), 'argv-survey-'));
  const guard = join(HERE, 'argv-guard.mjs');
  writeFileSync(
    join(dir, 'refuser.mjs'),
    `import { refuseUnknownArgvOrExit } from ${JSON.stringify(guard)};\n` +
      `refuseUnknownArgvOrExit(process.argv.slice(2), { valued: ['--dir'], boolean: ['--json'] }, { tool: 'refuser' });\n` +
      "console.log('did work');\n"
  );
  writeFileSync(join(dir, 'ignorer.mjs'), "const argv = process.argv.slice(2);\nconsole.log('did work, json =', argv.includes('--json'));\n");
  ok('PLANTED REFUSER is seen to refuse', probeTool(join(dir, 'refuser.mjs'), dir).verdict === 'REFUSES');
  ok('PLANTED IGNORER is seen to ignore', probeTool(join(dir, 'ignorer.mjs'), dir).verdict === 'IGNORES');

  /* (3) the safety criterion actually excludes a writer. */
  writeFileSync(join(dir, 'writer.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync('x', process.argv[2] || '');\n");
  ok('a tool that writes is NOT in the inert population', inertPopulation(dir).indexOf('writer.mjs') < 0, inertPopulation(dir).join(' '));
  ok('…and the ignorer IS', inertPopulation(dir).indexOf('ignorer.mjs') >= 0);

  /* (4) the verdict's own arithmetic and its refusals. */
  const rows = [
    { verdict: 'IGNORES', treeMoved: false },
    { verdict: 'SWALLOWS-AS-POSITIONAL', treeMoved: false },
    { verdict: 'UNDECIDED-timeout', treeMoved: false }
  ];
  const v = surveyVerdict(rows, { bar: 5 });
  ok('population balances: checked + excluded = eligible', v.population.checked + v.population.excluded === v.population.eligible, JSON.stringify(v.population));
  ok('under the bar ⇒ PASS', v.status === 'PASS', v.status);
  ok(
    'over the bar ⇒ FAIL with a reason',
    (() => {
      const f = surveyVerdict(rows, { bar: 0 });
      return f.status === 'FAIL' && !!f.reason;
    })()
  );
  ok('a moved tree ⇒ UNKNOWN, not a result', surveyVerdict([{ verdict: 'IGNORES', treeMoved: true, tool: 't' }], {}).status === 'UNKNOWN');
  ok('nothing probed ⇒ NOT_RUN', surveyVerdict([], {}).status === 'NOT_RUN');

  console.log(`\n${bad ? `✗ ${bad} of ${ran} failed` : `✓ all ${ran} selftests passed`}`);
  return bad ? 1 : 0;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────── */
if (flag('--selftest')) process.exit(selftest());

if (flag('--verdict-sample')) {
  console.log(JSON.stringify(surveyVerdict([{ verdict: 'IGNORES', treeMoved: false, tool: 'sample' }]), null, 1));
  process.exit(0);
}

const only = opt('--only', null);
const toolsDir = join(ROOT, 'tools');
const population = inertPopulation(toolsDir).filter((n) => !only || n === only);
if (only && population.length === 0) {
  console.error(`✗ argv-survey: ${only} is not in the probe-safe population (it writes, execs or fetches, or does not read argv)`);
  console.error('  Probing it needs someone who has read its no-argument path. Nothing was run.');
  process.exit(2);
}

const MARK = { IGNORES: '✗', REFUSES: '✓', 'SWALLOWS-AS-POSITIONAL': '⚠', CRASHES: '💥', 'REACTS-other': '·', 'UNDECIDED-timeout': '⊘' };
const rows = [];
for (const name of population) {
  const row = probeTool(join('tools', name), ROOT);
  rows.push(row);
  if (!flag('--json')) {
    console.log(`${MARK[row.verdict] || '?'} ${row.verdict.padEnd(22)} ${name.padEnd(34)} exit ${String(row.exit.controlA)}/${String(row.exit.probe)}${row.treeMoved ? '  ⚠ TREE MOVED' : ''}`);
  }
}
const verdict = surveyVerdict(rows);
if (flag('--json')) {
  console.log(JSON.stringify({ verdict, rows }, null, 1));
} else {
  const tally = verdict.result.tally;
  console.log(`\n--- ${rows.length} probed: ${JSON.stringify(tally)}`);
  console.log(`--- ${verdict.status}: swallows ${verdict.result.swallows} against a bar of ${SWALLOW_BAR}${verdict.reason ? ` — ${verdict.reason}` : ''}`);
  console.log('--- a REFUSES row means the tool adopted tools/argv-guard.mjs; an IGNORES row is the backlog.');
}
process.exit(verdict.status === 'FAIL' ? 1 : 0);
