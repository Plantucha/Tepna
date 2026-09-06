// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * tools/run-check.mjs — Tepna
 *
 * `npm run check` used to be a 16-step `&&` chain. That is fine when a step fails on its merits and
 * useless when one fails for an unrelated reason: the shell stops, npm prints the failure, and the
 * TEN steps after it never execute — silently. Nothing in the output says which ones, so the run
 * reads as "the gate failed" when the honest reading is "one step failed and ten were never asked".
 *
 * Measured 2026-09-05 (residue `2026-09-05-check-chain-aborts-on-load-timeout`): under load 26.74 on
 * a shared box, step 6 `test:tools` timed out `dsp-review-qwen.mjs` at 120 s — a selftest that takes
 * 6.7 s and reports `21 ok, 0 failed` when run alone. The chain aborted there, so `lint`, `test:par`
 * (the whole suite), `build:check` and seven others never ran. Splitting the chain by hand is what
 * then surfaced `verify:tools-index` as genuinely RED — on `origin/main` as well — which the abort
 * had been hiding behind a timeout. That is CLAUDE.md §4b one level up: a check that reported a
 * verdict about what it never examined.
 *
 * So this runner executes the same steps in the same order and, on failure, NAMES what it skipped.
 * It does not continue past a failure — the chain's semantics are deliberate, and a later step can
 * depend on an earlier one (`build:check` after the builders). It only stops being silent.
 *
 * ⚠️ STEPS IS THE SINGLE SOURCE OF ORDER. The `&&` chain is gone from package.json on purpose: two
 * copies of an ordered list is a drift bug waiting to happen, and there is no gate that could
 * compare them once `check` calls this file. The selftest asserts every name here resolves to a real
 * npm script, so a typo fails loudly instead of silently never running.
 *
 *   node tools/run-check.mjs             # the gate
 *   node tools/run-check.mjs --list      # print the ordered steps, run nothing
 *   node tools/run-check.mjs --selftest
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* Order matters and is the chain's own: cheap/fast first so a one-line type error is caught before
   anything spends minutes (CLAUDE.md §🔏 "FORMAT BEFORE YOU BUNDLE"). */
export const STEPS = [
  'gate:subject',
  'typecheck',
  'verify:commit-shape',
  'verify:residue-ids',
  'test:guards',
  'test:tools',
  'lint',
  'test:par',
  'verify:shard-union',
  'test:build-core',
  'build:check',
  'verify:analysis',
  'verify:docs',
  'verify:tools-index',
  'verify:manifest',
  'test:hooks'
];

/* The real executor. Exported so the selftest can prove the default path is THIS and not a stub —
   an injected collaborator and an injected no-op are the same syntax, and only one of them means
   the caller is wired up. */
export function defaultExec(step) {
  const r = spawnSync('npm', ['run', step], { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' });
  return { code: r.status == null ? 1 : r.status };
}

/* Pure: given the step list and the index that failed, what did NOT run. Separated from execution so
   the reporting can be tested without spending 20 minutes of gate to produce one failure. */
export function planAfterFailure(steps, failedIdx) {
  if (failedIdx < 0 || failedIdx >= steps.length) return { failed: null, ran: steps.slice(), notRun: [] };
  return {
    failed: steps[failedIdx],
    ran: steps.slice(0, failedIdx),
    notRun: steps.slice(failedIdx + 1)
  };
}

export function renderAbort(steps, failedIdx, code) {
  const p = planAfterFailure(steps, failedIdx);
  const lines = [];
  lines.push(`\n✗ check FAILED at step ${failedIdx + 1}/${steps.length} — ${p.failed} (exit ${code})`);
  if (p.notRun.length) {
    lines.push(
      `⚠ ${p.notRun.length} step(s) NOT RUN — this run says NOTHING about them, pass or fail:`,
      '    ' + p.notRun.join(' · '),
      '  Re-run them individually before concluding the tree is green:',
      '    ' + p.notRun.map((s) => `npm run ${s}`).join(' ; ')
    );
  } else {
    lines.push('  (it was the last step — every other step ran)');
  }
  return lines.join('\n');
}

export function runAll(opts) {
  const o = opts || {};
  const steps = o.steps || STEPS;
  const exec = o.exec || defaultExec;
  const log = o.log || console.log;
  for (let i = 0; i < steps.length; i++) {
    log(`▸ [${i + 1}/${steps.length}] ${steps[i]}`);
    const { code } = exec(steps[i]);
    if (code !== 0) {
      const text = renderAbort(steps, i, code);
      log(text);
      return { ok: false, failedIdx: i, ...planAfterFailure(steps, i), text, code };
    }
  }
  log(`\n✓ check — all ${steps.length} steps passed`);
  return { ok: true, failedIdx: -1, failed: null, ran: steps.slice(), notRun: [], text: '', code: 0 };
}

const IS_MAIN = process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + name);
    } else {
      fail++;
      console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''));
    }
  };

  /* THE PLANT — force step 2 to fail and require the report to name steps 3..N. Without this the
     whole file could return an empty notRun list and every other assertion would still pass. */
  const S = ['a', 'b', 'c', 'd', 'e'];
  const planted = runAll({ steps: S, exec: (s) => ({ code: s === 'b' ? 3 : 0 }), log: () => {} });
  ok('plant · a failure at step 2 is reported as step 2', planted.failedIdx === 1 && planted.failed === 'b');
  ok('plant · steps 3..N are listed as NOT RUN', JSON.stringify(planted.notRun) === JSON.stringify(['c', 'd', 'e']), JSON.stringify(planted.notRun));
  ok(
    'plant · the rendered text NAMES each unrun step',
    ['c', 'd', 'e'].every((s) => planted.text.includes(s)),
    planted.text
  );
  ok('plant · it says how many were skipped', /3 step\(s\) NOT RUN/.test(planted.text), planted.text);
  ok('plant · the failing step exit code is propagated', planted.code === 3);
  ok('plant · steps before the failure are reported as ran', JSON.stringify(planted.ran) === JSON.stringify(['a']));

  /* ANTI-VACUITY — the same code on an all-green run must report NOTHING as unrun. If `notRun` were
     hardcoded or always-full, the assertions above would pass and this one would not. */
  const green = runAll({ steps: S, exec: () => ({ code: 0 }), log: () => {} });
  ok('control · an all-green run lists no unrun steps', green.ok && green.notRun.length === 0);
  ok('control · …and reports no failed step', green.failed === null && green.code === 0);

  /* A failure on the LAST step has nothing after it — the report must not claim otherwise. */
  const last = runAll({ steps: S, exec: (s) => ({ code: s === 'e' ? 1 : 0 }), log: () => {} });
  ok('edge · failing the last step lists zero unrun', last.notRun.length === 0 && /every other step ran/.test(last.text));

  /* NON-VACUITY OF THE STEP LIST — a typo'd name would never run and never be reported as missing,
     which is the same silence this tool exists to remove. Every step must be a real npm script. */
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const missing = STEPS.filter((s) => !pkg.scripts || !pkg.scripts[s]);
  ok('every STEPS entry resolves to a real npm script', missing.length === 0, 'missing: ' + missing.join(', '));
  ok('STEPS is non-empty and has no duplicates', STEPS.length > 0 && new Set(STEPS).size === STEPS.length);
  ok('package.json check delegates to this runner', /run-check\.mjs/.test((pkg.scripts && pkg.scripts.check) || ''), pkg.scripts && pkg.scripts.check);

  /* THE DEFAULT EXECUTOR IS REAL. Injecting `exec` in every test above proves the reporting works;
     it cannot prove the shipped path uses a real runner rather than a stub. Running a step that does
     not exist must FAIL through the default — a no-op default would return 0 and pass. */
  const viaDefault = runAll({ steps: ['__tepna_no_such_script__'], log: () => {} });
  ok('the DEFAULT executor really runs npm (a missing script fails)', !viaDefault.ok && viaDefault.code !== 0, 'code=' + viaDefault.code);

  console.log(fail ? `\n✗ ${fail} failed, ${pass} passed` : `\n✓ all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  if (process.argv.includes('--list')) {
    STEPS.forEach((s, i) => console.log(`${i + 1}/${STEPS.length}  ${s}`));
    process.exit(0);
  }
  const r = runAll({});
  process.exit(r.ok ? 0 : r.code || 1);
}
