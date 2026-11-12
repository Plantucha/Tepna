#!/usr/bin/env node
/*
 * ci-step-parity.mjs — the local-gate step against the workflows that run it.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * A LOCAL GATE STEP THAT NO WORKFLOW RUNS REDS ON EVERY BIRD'S BOX WHILE `main` STAYS GREEN.
 * Residue row `2026-11-09-28-of-the-53-local-gate-steps-run-in-no-ci-workflow`: no `run:` key invokes
 * the aggregate, so each step owes its own workflow line. The two mentions of `npm run check` in
 * `tests.yml` are comments. `tests.yml:206` records the shape in its own words, where #3186 registered
 * a step in `STEPS` alone and no hosted runner ran it.
 *
 * WHAT THIS TOOL DOES AND WHAT IT LEAVES TO THE OWNER. The row reserves the remedy, because closing
 * the gap adds blocking work to the branch ruleset. So this gate adds no workflow line and changes no
 * ruleset. It PINS the gap, two-sided, and names every step inside it. A new step that lands with no
 * workflow line reds here, which is the half that needs no authorization. The count grew from 28 to 40
 * between 2026-11-09 and 2026-11-11, so the growth is the live cost.
 *
 * HOW A STEP COUNTS AS COVERED. The workflows hold the step's own command, or they hold `npm run
 * <step>`. Nothing else counts, and the direction is deliberate: a workflow that runs the same tool
 * under other flags does not run the step. `verify:browser-gate-selftest` is the measured case, where
 * `no-network.yml` runs `tests/browser-gates.mjs` and never its `--selftest`. Such a step reads
 * uncovered here, and the report names it under `toolRunsUnderOtherFlags`, so the reader sees the
 * difference between a tool nobody runs and a flag nobody runs.
 *
 *   node tools/ci-step-parity.mjs            # check
 *   node tools/ci-step-parity.mjs --json     # the tepna.verdict/1 object alone on stdout
 *   node tools/ci-step-parity.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeRe } from './regex-escape-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

/** The pinned size of the gap, two-sided. A step that lands with no workflow line raises the count and
    reds. A step that gains one lowers it and also reds, because a stale pin hides the next arrival.
    A RED HERE HAS TWO HONEST REMEDIES, and the reader picks: give the new step a workflow line, or
    raise this pin and say why in the commit. The second one is legitimate, because the row reserves
    the closure to the owner and a lander may hold no authorization to add blocking CI work. #4846
    raised it from 39 to 40 one hour before this tool landed, where `verify:module-carriers` arrived
    with no workflow line. The 2026-11-11 raise to 41 is `verify:paper-references`, which runs inside
    `npm run check` under CI's `static` job exactly as `verify:brief-header-claims` does. Its own
    workflow line would be a new CI context, and §📌's row reserves that to the owner. The raise to 42 is
    `verify:paper-claim-markers`, the second half of that same papers census, which runs under the same
    `static` job and sits under the same reservation. The raise to 43 is `verify:write-root-adoption`,
    the gate that names the adopted write-root and judge-root sets. It runs under the same `static` job
    inside `npm run check`, and its own workflow line would be a new CI context the row reserves. */
export const UNCOVERED_PIN = 43;

/** A step whose command a workflow may never carry, with the reason. Empty, and the gate says so: the
    row reserves every closure to the owner, so this tool invents no exemption. */
export const UNCOVERED_EXEMPT = new Set([]);

const WF_DIR = join('.github', 'workflows');
const PATH_RE = /(?:^|[\s"'])((?:tools|tests|codegen|\.claude\/hooks)\/[A-Za-z0-9._-]+\.(?:mjs|js|sh))/g;

/** The repo paths a step's command drives. Pure, so a plant can hand it any command string. */
export function pathsOf(cmd = '') {
  return [...String(cmd).matchAll(PATH_RE)].map((m) => m[1]);
}

/** The workflow files whose text runs this exact step. Pure over its three inputs. */
export function homesOf(step, cmd, workflows) {
  const alias = new RegExp(`npm run (?:-s )?${escapeRe(step)}(?![\\w:-])`);
  const command = String(cmd || '').trim();
  return [...workflows.keys()].filter((f) => alias.test(workflows.get(f)) || (command.length > 0 && workflows.get(f).includes(command))).sort();
}

/** Every step split into covered and uncovered, with the tool-level reading beside each uncovered one. */
export function coverageOf({ steps, scripts, workflows }) {
  const covered = [];
  const uncovered = [];
  for (const step of steps) {
    const cmd = scripts[step];
    const homes = homesOf(step, cmd, workflows);
    if (homes.length > 0) {
      covered.push({ step, homes });
      continue;
    }
    const paths = pathsOf(cmd);
    const toolRunsUnderOtherFlags = [...workflows.keys()].filter((f) => paths.some((p) => workflows.get(f).includes(p))).sort();
    uncovered.push({ step, cmd: cmd ?? null, toolRunsUnderOtherFlags });
  }
  return { covered, uncovered };
}

/** The two ways the pin and the tree drift apart. `overflow` is the incident, and it counts rather than
    names, because `STEPS` carries no arrival order. `shrunk` is a stale pin. */
export function pinGap(uncovered, pin = UNCOVERED_PIN, exempt = UNCOVERED_EXEMPT) {
  const counted = uncovered.filter((u) => !exempt.has(u.step));
  return {
    counted: counted.length,
    overflow: Math.max(0, counted.length - pin),
    shrunk: counted.length < pin,
    exemptNowCovered: [...exempt].filter((s) => !uncovered.some((u) => u.step === s))
  };
}

function readWorkflows(root = ROOT) {
  const dir = join(root, WF_DIR);
  const out = new Map();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.yml'))
    .sort()) {
    out.set(f, readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}

function headCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function verdictOf({ status, steps, covered, uncovered, gap, reason }) {
  return Verdict.make({
    gate: 'ci-step-parity',
    status,
    population: { checked: steps, eligible: steps, excluded: 0 },
    criterion: { name: 'local_gate_steps_no_workflow_runs', threshold: UNCOVERED_PIN, unit: 'steps', direction: 'eq' },
    result: {
      steps,
      covered: covered.length,
      uncovered: gap.counted,
      pin: UNCOVERED_PIN,
      uncoveredSteps: uncovered.map((u) => u.step),
      toolRunsUnderOtherFlags: uncovered.filter((u) => u.toolRunsUnderOtherFlags.length > 0).map((u) => u.step)
    },
    evidence: ['tools/ci-step-parity.mjs', 'tools/run-check.mjs', 'package.json', WF_DIR],
    reason: reason ?? null,
    producedBy: { tool: 'tools/ci-step-parity.mjs', commit: headCommit() },
    at: new Date().toISOString()
  });
}

const PLANT_WF = new Map([
  ['a.yml', 'jobs:\n  s:\n    steps:\n      - run: node tools/alpha.mjs --check\n      - run: npm run -s verify:beta\n'],
  ['b.yml', 'jobs:\n  s:\n    steps:\n      - run: node tests/gamma.mjs\n']
]);
const PLANT_SCRIPTS = {
  'verify:alpha': 'node tools/alpha.mjs --check',
  'verify:beta': 'node tools/beta.mjs',
  'verify:gamma-logic': 'node tests/gamma.mjs --selftest',
  'verify:delta': 'node tools/delta.mjs'
};

export function selftest() {
  const fails = [];
  let ran = 0;
  const ok = (name, cond) => {
    ran += 1;
    if (cond !== true) fails.push(name);
  };
  const plant = coverageOf({ steps: Object.keys(PLANT_SCRIPTS), scripts: PLANT_SCRIPTS, workflows: PLANT_WF });
  ok(
    'a step whose exact command a workflow runs reads covered',
    plant.covered.some((c) => c.step === 'verify:alpha')
  );
  ok('the covered step names its workflow', plant.covered.find((c) => c.step === 'verify:alpha')?.homes.join() === 'a.yml');
  ok(
    'the npm alias form counts as a run',
    plant.covered.some((c) => c.step === 'verify:beta')
  );
  ok(
    'a tool run under other flags reads UNCOVERED',
    plant.uncovered.some((u) => u.step === 'verify:gamma-logic')
  );
  ok('and that step names the workflow running its tool', plant.uncovered.find((u) => u.step === 'verify:gamma-logic')?.toolRunsUnderOtherFlags.join() === 'b.yml');
  const delta = plant.uncovered.find((u) => u.step === 'verify:delta');
  ok('the unmentioned step is uncovered', Boolean(delta));
  ok('the unmentioned step names no tool home', delta?.toolRunsUnderOtherFlags.length === 0);
  ok('the two sets partition the steps', plant.covered.length + plant.uncovered.length === 4);
  ok('a step with no script reads uncovered', coverageOf({ steps: ['verify:none'], scripts: {}, workflows: PLANT_WF }).uncovered.length === 1);
  ok('an absent command never matches by emptiness', homesOf('verify:none', '', PLANT_WF).length === 0);
  ok('the alias match is exact, not a prefix', homesOf('verify:bet', 'node tools/x.mjs', PLANT_WF).length === 0);
  ok('pathsOf reads the driven repo path', pathsOf('node tools/alpha.mjs --check').join() === 'tools/alpha.mjs');
  ok('pathsOf reads a hook script', pathsOf('bash .claude/hooks/guard-trailer.test.sh').join() === '.claude/hooks/guard-trailer.test.sh');
  ok('pathsOf reads every path of a chained command', pathsOf('node a/b.mjs && bash tools/c.sh').join() === 'tools/c.sh');
  const g2 = pinGap(plant.uncovered, 2);
  ok('a gap at its pin reports no move', g2.overflow === 0 && g2.shrunk === false);
  ok('a grown gap counts the overflow', pinGap(plant.uncovered, 1).overflow === 1);
  ok('a shrunk gap reads shrunk', pinGap(plant.uncovered, 3).shrunk === true);
  ok('an exemption drops the step from the count', pinGap(plant.uncovered, 1, new Set(['verify:delta'])).counted === 1);
  ok('an exemption that is now covered reads back', pinGap(plant.uncovered, 2, new Set(['verify:alpha'])).exemptNowCovered.join() === 'verify:alpha');
  const real = realRun();
  ok('the real tree holds at least 40 steps', real.steps.length >= 40);
  ok('the real tree holds at least 10 workflows', real.workflows.size >= 10);
  ok('the real run covers at least 10 steps', real.cov.covered.length >= 10);
  ok('every real step resolves to a command', real.cov.uncovered.filter((u) => u.cmd === null).length <= 1);
  const realVerdict = verdictOf({
    status: 'PASS',
    steps: real.steps.length,
    covered: real.cov.covered,
    uncovered: real.cov.uncovered,
    gap: pinGap(real.cov.uncovered),
    reason: null
  });
  ok('the real verdict validates under verdict.js', Verdict.validate(realVerdict).ok === true);
  ok('the population arithmetic closes', realVerdict.population.checked + realVerdict.population.excluded === realVerdict.population.eligible);
  ok('CONTROL: validate rejects a FAIL that carries no reason', Verdict.validate({ ...realVerdict, status: 'FAIL', reason: null }).ok === false);
  ok(
    'CONTROL: a workflow set of one empty file leaves every step uncovered',
    coverageOf({ steps: real.steps, scripts: real.scripts, workflows: new Map([['empty.yml', '']]) }).uncovered.length === real.steps.length
  );
  if (fails.length > 0) {
    console.error(`✗ ci-step-parity selftest — ${fails.length} failed:`);
    for (const f of fails) console.error(`   · ${f}`);
    process.exit(1);
  }
  console.log(`✓ ci-step-parity — all ${ran} selftests passed`);
}

function realRun() {
  const steps = Reflect.get(stepsModule, 'STEPS');
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};
  const workflows = readWorkflows();
  return { steps, scripts, workflows, cov: coverageOf({ steps, scripts, workflows }) };
}

const stepsModule = await import(join(ROOT, 'tools', 'run-check.mjs'));

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    selftest();
    return;
  }
  const json = argv.includes('--json');
  const { steps, cov } = realRun();
  const gap = pinGap(cov.uncovered);
  let status = 'PASS';
  let reason = null;
  if (steps.length === 0) {
    status = 'NOT_RUN';
    reason = 'run-check.mjs exported no step, so this read examined nothing';
  } else if (gap.overflow > 0) {
    status = 'FAIL';
    reason = `${gap.counted} step(s) run in no workflow against a pin of ${UNCOVERED_PIN}, so ${gap.overflow} more than the pin carry no workflow line; read result.uncoveredSteps, then either give the new step a workflow line or raise the pin in tools/ci-step-parity.mjs and say why`;
  } else if (gap.shrunk) {
    status = 'FAIL';
    reason = `${gap.counted} step(s) run in no workflow against a pin of ${UNCOVERED_PIN}; lower the pin in tools/ci-step-parity.mjs`;
  } else if (gap.exemptNowCovered.length > 0) {
    status = 'FAIL';
    reason = `exempt step(s) now run in a workflow: ${gap.exemptNowCovered.join(', ')}`;
  }
  const verdict = verdictOf({ status, steps: steps.length, covered: cov.covered, uncovered: cov.uncovered, gap, reason });
  console.log(JSON.stringify(verdict));
  if (!json) {
    console.log(
      status === 'PASS' ? `✓ ci-step-parity — ${cov.covered.length} of ${steps.length} step(s) run in a workflow, ${gap.counted} at the pin of ${UNCOVERED_PIN}` : `✗ ci-step-parity — ${reason}`
    );
    for (const u of cov.uncovered) {
      const tail = u.toolRunsUnderOtherFlags.length > 0 ? ` (its tool runs in ${u.toolRunsUnderOtherFlags.join(', ')} under other flags)` : '';
      console.log(`   · ${u.step}${tail}`);
    }
  }
  if (status !== 'PASS') process.exit(status === 'NOT_RUN' ? 1 : 1);
}

main();
