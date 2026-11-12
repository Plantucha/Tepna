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
 * THE STEP `verify:fixture-currency` IS BLOCKING HERE AND INFORMATIONAL IN CI, DELIBERATELY. (It is
 * named, not numbered: the list below grows, and a comment naming a position goes stale with nothing
 * reading it.) The comparison it runs — each fixture's `verifiedUnder` against the `computeHash` of
 * the bundle on disk — is `tools/verify-fixtures.mjs --check`, and it has run in `tests.yml` under
 * `continue-on-error: true` all along, because an outside contributor has no corpus to FIX a red
 * with. Measured 2026-10-13 on #3543 (residue
 * `2026-10-27-the-ci-fixture-currency-step-reported-to-nobody`): an edit to `dex-export.js`
 * moved the compute closure of eight bundles, CI printed all 19 fixtures by name as UNVERIFIED, and
 * the `tests` run still concluded `success` — so `gh pr checks` read 25 pass and no reviewer saw it.
 * The one party who HAS the corpus is the author, and the author's gate is this file, which never
 * ran the check at all. So the detector stays where it was and gains the one reader who can act.
 *
 *   node tools/run-check.mjs             # the gate
 *   node tools/run-check.mjs --list      # print the ordered steps, run nothing
 *   node tools/run-check.mjs --json      # the gate, plus ONE tepna.verdict/1 object on stdout (log → stderr)
 *   node tools/run-check.mjs --steps=typecheck,lint   # a DECLARED subset — the object is `filtered`
 *   node tools/run-check.mjs --verdict-sample         # the object over a scratch step list, no gate run
 *   node tools/run-check.mjs --selftest
 *
 * RUN IT FROM THE CHECKOUT YOU MEAN. Every step is `npm run <step>` with `cwd: ROOT`, and `ROOT` used
 * to come from `import.meta.url` alone, so `node <other checkout>/tools/run-check.mjs` from a worktree
 * ran all 50 steps against the OTHER tree and then reported the result as this one's. `judgeRoot`
 * (tools/write-root.mjs) now resolves the tree inside the CLI block and refuses a disagreement with
 * exit 2. Residue `2026-11-05-verdict-gates-still-judge-the-checkout-they-live-in`, whose own
 * measurement hid this file: it reached 49 sites by also requiring the literal word `git`, and this
 * one hands its root to npm.
 *
 * VERDICT — the first RUNNER adopter of VERDICT-CONTRACT §3d. The object is a projection of what this
 * file already computes (ran · notRun · failedIdx · each child's exit code) through the shared
 * aggregation `aggregateChildren` (tools/verdict-emit.mjs): population = the steps (eligible = STEPS,
 * checked = ran to an exit, excluded = never asked after an abort + a `--steps=` exclusion); status by
 * precedence FAIL > SHORTFALL > UNKNOWN > PASS. ⚠️ EVERY STEP IS STILL AN EXIT CODE, so on a real run a
 * green step is UNKNOWN BY PROVENANCE and the run-level object reads **UNKNOWN** until the steps adopt —
 * that is the point (§3d: a runner can never read greener than its least-adopted child); a red step is
 * FAIL. The EXIT CODE STAYS: the shell and CI keep reading process.exit until the consumer switches.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateChildren, makeVerdict } from './verdict-emit.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { declaresSelftest } from './selftest-all.mjs';
import { WriteRootRefusal, judgeRoot } from './write-root.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* THE DEFAULT ONLY. It serves `--list`, `--verdict-sample`, the selftest and a library import, which
   all examine no tree. A real run replaces it with the checkout it was RUN FROM — see the CLI block. */
let ROOT = join(HERE, '..');

/* Order matters and is the chain's own: cheap/fast first so a one-line type error is caught before
   anything spends minutes (CLAUDE.md §🔏 "FORMAT BEFORE YOU BUNDLE"). */
export const STEPS = [
  'gate:subject',
  'typecheck',
  'verify:commit-shape',
  'verify:residue-ids',
  'verify:residue-claims',
  'verify:residue-citations',
  'verify:residue-cite-drift',
  'verify:residue-cite-delta',
  'verify:bus-conf-provenance',
  'verify:sidecar-census',
  'verify:defect-pins',
  'verify:survivor-ratchet',
  'verify:flag-exit',
  'verify:flag-drive',
  'verify:absence',
  'verify:seals',
  'verify:port-parity',
  'verify:consensus-polarity',
  'verify:hook-contract',
  'test:guards',
  'test:tools',
  'lint',
  'verify:shellcheck',
  'verify:shellcheck-logic',
  'test:par',
  'verify:shard-union',
  'verify:shard-union-logic',
  'verify:shard-timings',
  'verify:shard-timings-logic',
  'verify:no-names',
  'verify:integrator-surface',
  'test:build-core',
  'test:trio-anchor',
  'test:fold-provenance',
  'test:trio-fold-clock',
  'test:trio-fold-validity',
  'test:trio-fold-merge',
  'test:read-lines-bounded',
  'test:seqnet-port',
  'test:stage-lab-core',
  'test:oxydex-stager',
  'test:hypno-export',
  'test:reconcile',
  'build:check',
  'verify:analysis',
  'verify:docs',
  'verify:codegen',
  'verify:tools-index',
  'verify:workflow-timeouts',
  'verify:required-contexts',
  'verify:ci-step-parity',
  'verify:no-network-surface',
  'verify:absence-regression',
  'verify:astgrep',
  'verify:xss-sink',
  'verify:docs-constants',
  'verify:brief-header-claims',
  'verify:paper-references',
  'verify:paper-claim-markers',
  'verify:module-carriers',
  'verify:pr-compliance',
  'verify:verdict-adoption',
  'verify:write-root-adoption',
  'verify:manifest',
  'verify:manifest-logic',
  'verify:fixture-currency',
  'verify:check-dex-logic',
  'verify:browser-gate-selftest',
  'test:hooks'
];

/* ── THE REVERSE DIRECTION ─────────────────────────────────────────────────────────────────────
   The selftest below asserts that every STEPS entry resolves to a real npm script, which catches a
   typo. It cannot catch the opposite: a gate script that `package.json` DECLARES and STEPS OMITS.
   Such a script runs in no `npm run check`, reds nothing, and reads as covered because its name
   sits in `package.json` beside the ones that do run. Residue
   `2026-11-07-run-check-misses-a-verify-script-absent-from-steps`, logged from Muse's hunt.

   A gate script is one the suite entry point owns: the `verify:` family plus `build:check`. The
   other families are deliberately outside this runner — `test:` steps appear in STEPS by their own
   names, and `gates:browser`, `pseudo:check` or `release` are not part of the unattended gate.
   `verify:browser-gate-selftest` IS: it runs `tests/browser-gates.mjs --selftest`, which launches
   no browser and needs no server, so the browser gate's own decision logic — its verdict aggregation
   and its skip budget — is judged here while the lane itself stays a CI job. Nothing ran that
   selftest before 2026-11-10, so the budget it guards would have been a number nobody tested.
   The step carried the name `verify:browser-gate-logic` until 2026-11-12. Three sessions read that
   name inside a green step list and heard browser coverage in one night, so `-selftest` now says
   in the name what the step judges. A green round here still proves nothing about the browser
   realm; only the `browser-gates` CI job or `npm run gates:browser:local` reaches it.
   An omission that is DELIBERATE goes in STEPS_EXEMPT with its reason written here. The set is
   empty today, because every declared gate script is in STEPS. A count stood here and no gate read
   it, so two diffs in one day each corrected it by one and it still went stale:
   `gateScriptsMissingFromSteps` computes the only number that decides anything. */
export const GATE_SCRIPT_RE = /^(?:verify:|build:check$)/;
export const STEPS_EXEMPT = new Set([]);

/** Gate scripts that `scripts` declares, STEPS omits, and no exemption excuses. Sorted, so the
    failure message is stable. Pure, so the selftest can plant one. */
export function gateScriptsMissingFromSteps(scripts = {}, steps = STEPS, exempt = STEPS_EXEMPT) {
  const inSteps = new Set(steps);
  return Object.keys(scripts)
    .filter((s) => GATE_SCRIPT_RE.test(s) && !inSteps.has(s) && !exempt.has(s))
    .sort();
}

/* ── THE THIRD DIRECTION ────────────────────────────────────────────────────────────
   Both legs above read the SCRIPT list. One asks whether every STEPS name is a real script; the
   other asks whether every gate script is a step. Neither reads `tests/`. So a file there can
   declare a `--selftest` handler that NO script passes the flag to, and both legs stay green.

   Measured 2026-11-10 on `0cdc9211c`: six files under `tests/` declared a handler, and
   `tests/check-dex.mjs`, `tests/verify-manifest.mjs` and `tests/verify-shard-timings.mjs` ran only
   WITHOUT the flag, so their 33 assertions decided nothing. Each of those three files IS a gate,
   and its selftest is what proves the gate's own verdict logic. Residue
   `2026-11-10-three-tests-mjs-selftests-run-under-no-loop-and-no-script`.

   `tools/` needs no such leg. CI's "Analysis-tool selftests" step globs `tools/*.mjs` for the
   handler, runs every hit, and refuses a run that finds fewer than ten; `tools/selftest-all.mjs`
   does the same locally as a STEPS entry. Nothing globs `tests/`, because each file there is its
   own gate and carries its own npm name, so the wiring is per file and a glob would hide it again.

   The declaration reader is `declaresSelftest` from `tools/selftest-all.mjs`. One reader, so a
   usage comment cannot enrol a file here while a near miss drops it there. */
export const SELFTEST_EXEMPT = new Set([]);

/** Paths under `tests/` that declare a `--selftest` handler which no npm script passes
    `--selftest` to. Takes the declaring paths, so the caller owns the directory read. Sorted, so
    the failure message is stable. Pure, so the selftest can plant one. */
export function selftestsRunByNoScript(declaring = [], scripts = {}, exempt = SELFTEST_EXEMPT) {
  const flagged = Object.values(scripts).filter((c) => typeof c === 'string' && c.includes('--selftest'));
  return declaring.filter((f) => !exempt.has(f) && !flagged.some((c) => c.includes(f))).sort();
}

/** The declaring population under `tests/`, as `tests/<file>` paths. A path, not a bare name, so a
    same-named file in another directory cannot satisfy the match. */
export function declaringTests(dir = join(ROOT, 'tests')) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => declaresSelftest(readFileSync(join(dir, f), 'utf8')))
    .map((f) => 'tests/' + f)
    .sort();
}

/* The real executor. Exported so the selftest can prove the default path is THIS and not a stub —
   an injected collaborator and an injected no-op are the same syntax, and only one of them means
   the caller is wired up. */
export function defaultExec(step, { toStderr = false } = {}) {
  /* Under --json stdout carries ONE object and nothing else, so the children write to stderr. */
  const r = spawnSync('npm', ['run', step], { cwd: ROOT, stdio: toStderr ? [0, 2, 2] : 'inherit', encoding: 'utf8' });
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

/* ── the §3d object ───────────────────────────────────────────────────────────────────────────────
   `r` is runAll's result; `steps` the steps this invocation ran (the plan); `declaredExcluded` the
   STEPS a `--steps=` subset left out. `childVerdict(step)` may hand a child's own object (none of the
   steps emits one yet — the hook exists so the plants can prove every §3d table row, and so the day a
   step prints an object the runner can read it instead of the exit code). */
export function runVerdict(r, { steps = STEPS, declaredExcluded = [], excludedBy = null, codes = {}, childVerdict = null, commit, commitReason, at } = {}) {
  const children = steps.map((name) => {
    if (r.notRun.includes(name)) return { name, provenance: 'not-run' };
    const own = childVerdict ? childVerdict(name) : null;
    if (own && own.status) return { name, provenance: 'object', status: own.status };
    return { name, provenance: 'exit-code', code: name === r.failed ? r.code : codes[name] == null ? 0 : codes[name] };
  });
  const agg = aggregateChildren(children, { eligible: steps.length + declaredExcluded.length, declaredExcluded, excludedBy });
  return makeVerdict({
    gate: 'run-check',
    status: agg.status,
    population: agg.population,
    criterion: {
      name: 'children_failing (any FAIL ⇒ FAIL; SHORTFALL ⇒ SHORTFALL; an UNKNOWN or exit-code-only child, or an unplanned NOT_RUN, is never green; a declared exclusion is filtered)',
      threshold: 0,
      unit: 'failing children',
      direction: 'eq'
    },
    result: agg.result,
    evidence: children.filter((c) => c.provenance !== 'not-run').map((c) => `npm run ${c.name}`),
    reason: agg.reason,
    tool: 'tools/run-check.mjs',
    commit,
    commitReason,
    at
  });
}

/* A scratch step list, every step exit 0 — the honest shape of the first adopted runner: UNKNOWN by
   provenance over 5/5, no gate run, no code identity claimed. */
export function verdictSample() {
  const S = ['scratch:a', 'scratch:b', 'scratch:c', 'scratch:d', 'scratch:e'];
  const r = runAll({ steps: S, exec: () => ({ code: 0 }), log: () => {} });
  return runVerdict(r, { steps: S, commit: null, commitReason: '--verdict-sample: a scratch step list, no gate run, no code identity claimed', at: '2026-09-22T00:00:00Z' });
}

/* A REFUSAL OWES A VERDICT (§🧾). A run whose cwd and whose own copy sit in different checkouts
   examined no tree, so the object says `NOT_RUN` over zero children and carries `result: null`. The
   whole step list is the exclusion, which keeps `checked + excluded = eligible` true. */
export function refusalVerdict(reason, { at } = {}) {
  return makeVerdict({
    gate: 'run-check',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: STEPS.length, excluded: STEPS.length },
    criterion: { name: 'children_failing', threshold: 0, unit: 'failing children', direction: 'eq' },
    result: null,
    evidence: ['tools/write-root.mjs'],
    reason,
    tool: 'tools/run-check.mjs',
    at
  });
}

const IS_MAIN = isCliEntry(import.meta.url);

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

  /* THE REVERSE LEG — a gate script declared in package.json and absent from STEPS runs in no
     `npm run check`. The forward leg above cannot see it, because it reads STEPS and never the
     script list. */
  const unrun = gateScriptsMissingFromSteps(pkg.scripts || {});
  ok('every declared gate script appears in STEPS (the reverse direction)', unrun.length === 0, 'declared but run by no step: ' + unrun.join(', '));
  ok(
    'plant · a declared verify: script absent from STEPS is NAMED',
    JSON.stringify(gateScriptsMissingFromSteps({ 'verify:docs': 'x', 'verify:__planted__': 'x', lint: 'x' }, ['verify:docs', 'lint'])) === JSON.stringify(['verify:__planted__'])
  );
  ok('plant · build:check absent from STEPS is NAMED', JSON.stringify(gateScriptsMissingFromSteps({ 'build:check': 'x' }, [])) === JSON.stringify(['build:check']));
  ok('control · a script outside the gate family is NOT named', gateScriptsMissingFromSteps({ release: 'x', 'pseudo:check': 'x', 'check:dex': 'x', 'test:par': 'x' }, []).length === 0);
  ok(
    'plant · an exempt name is withheld and its neighbour is still named',
    JSON.stringify(gateScriptsMissingFromSteps({ 'verify:a': 'x', 'verify:b': 'x' }, [], new Set(['verify:a']))) === JSON.stringify(['verify:b'])
  );
  /* A tripwire on the exemption itself: a stale exempt name would excuse a script nobody declares
     any more, so the first exemption written here is held to a real script. */
  const staleExempt = [...STEPS_EXEMPT].filter((s) => !(pkg.scripts && pkg.scripts[s]));
  ok('every STEPS_EXEMPT entry is still a declared script', staleExempt.length === 0, 'stale: ' + staleExempt.join(', '));

  /* THE THIRD LEG — a `tests/` selftest that no script passes `--selftest` to. The two legs above
     read the script list and never the directory, so neither one can see it. */
  const declaring = declaringTests();
  ok('the tests/ selftest population is non-empty, so this leg examined something', declaring.length > 0, 'declaring: ' + declaring.length);
  ok('the population reader finds the shard-union gate, which declares one by construction', declaring.includes('tests/verify-shard-union.mjs'), declaring.join(', '));
  const unflagged = selftestsRunByNoScript(declaring, pkg.scripts || {});
  ok('every tests/ selftest is run by a script that passes --selftest', unflagged.length === 0, 'declared but run by no script with the flag: ' + unflagged.join(', '));
  ok(
    'plant · a tests/ selftest a script runs WITHOUT the flag is NAMED',
    JSON.stringify(selftestsRunByNoScript(['tests/a.mjs', 'tests/b.mjs'], { 'verify:a': 'node tests/a.mjs --selftest', 'verify:b': 'node tests/b.mjs' })) === JSON.stringify(['tests/b.mjs'])
  );
  ok(
    'plant · a file no script names is NAMED, and an exempt neighbour is withheld',
    JSON.stringify(selftestsRunByNoScript(['tests/a.mjs', 'tests/b.mjs'], {}, new Set(['tests/a.mjs']))) === JSON.stringify(['tests/b.mjs'])
  );
  ok('control · a path match is whole, so tools/a.mjs does not satisfy tests/a.mjs', selftestsRunByNoScript(['tests/a.mjs'], { x: 'node tools/a.mjs --selftest' }).length === 1);
  ok('edge · an EMPTY population names nothing, so the non-vacuity leg above owns that case', selftestsRunByNoScript([], {}).length === 0);
  const staleSelftestExempt = [...SELFTEST_EXEMPT].filter((f) => !declaring.includes(f));
  ok('every SELFTEST_EXEMPT entry still declares a selftest', staleSelftestExempt.length === 0, 'stale: ' + staleSelftestExempt.join(', '));

  ok('package.json check delegates to this runner', /run-check\.mjs/.test((pkg.scripts && pkg.scripts.check) || ''), pkg.scripts && pkg.scripts.check);

  /* THE DEFAULT EXECUTOR IS REAL. Injecting `exec` in every test above proves the reporting works;
     it cannot prove the shipped path uses a real runner rather than a stub. Running a step that does
     not exist must FAIL through the default — a no-op default would return 0 and pass. */
  const viaDefault = runAll({ steps: ['__tepna_no_such_script__'], log: () => {} });
  ok('the DEFAULT executor really runs npm (a missing script fails)', !viaDefault.ok && viaDefault.code !== 0, 'code=' + viaDefault.code);

  /* ── §3d PLANTS, one per table row — each object is built through makeVerdict, so an invalid one
     THROWS here rather than passing. */
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const obj = (map) => (name) => (map[name] ? { status: map[name] } : null);
  const allPass = obj({ a: 'PASS', b: 'PASS', c: 'PASS', d: 'PASS', e: 'PASS' });
  const vGreenExit = runVerdict(green, { steps: S, ...AT });
  ok('§3d · every child green by EXIT CODE only ⇒ run UNKNOWN by provenance', vGreenExit.status === 'UNKNOWN' && vGreenExit.result.exitCodeOnly === 5, vGreenExit.reason);
  ok('§3d · …population 5 checked / 5 eligible / 0 excluded', JSON.stringify(vGreenExit.population) === JSON.stringify({ checked: 5, eligible: 5, excluded: 0 }));
  ok('§3d · …the reason says UNKNOWN by provenance and names the children', /UNKNOWN by provenance/.test(vGreenExit.reason) && /a · b · c · d · e/.test(vGreenExit.reason), vGreenExit.reason);
  const vFail = runVerdict(planted, { steps: S, ...AT });
  ok('§3d plant · a FAIL child ⇒ run FAIL, first failure named with its exit', vFail.status === 'FAIL' && vFail.result.firstFailure === 'b' && /b \(exit 3\)/.test(vFail.reason), vFail.reason);
  ok(
    '§3d plant · …steps after the abort are NOT_RUN and counted EXCLUDED, never green',
    vFail.result.notRun === 3 && JSON.stringify(vFail.population) === JSON.stringify({ checked: 2, eligible: 5, excluded: 3 }),
    JSON.stringify(vFail.population)
  );
  const vAllObj = runVerdict(green, { steps: S, childVerdict: allPass, ...AT });
  ok('§3d plant · every child a PASS object ⇒ run PASS (the only way to green)', vAllObj.status === 'PASS' && vAllObj.reason === null && vAllObj.result.exitCodeOnly === 0);
  const vUnk = runVerdict(green, { steps: S, childVerdict: obj({ a: 'PASS', b: 'PASS', c: 'UNKNOWN', d: 'PASS', e: 'PASS' }), ...AT });
  ok('§3d plant · one UNKNOWN child among PASS objects ⇒ UNKNOWN (precedence, not a vote)', vUnk.status === 'UNKNOWN' && /1 UNKNOWN: c/.test(vUnk.reason), vUnk.reason);
  const vSf = runVerdict(green, { steps: S, childVerdict: obj({ a: 'PASS', b: 'SHORTFALL', c: 'PASS', d: 'PASS', e: 'PASS' }), ...AT });
  ok('§3d plant · a SHORTFALL child with no FAIL ⇒ SHORTFALL', vSf.status === 'SHORTFALL' && /b/.test(vSf.reason));
  const vNa = runVerdict(green, { steps: S, childVerdict: obj({ a: 'PASS', b: 'NOT_APPLICABLE', c: 'PASS', d: 'PASS', e: 'PASS' }), ...AT });
  ok('§3d plant · a NOT_APPLICABLE child is checked-not-binding: run PASS, counted, never evidence', vNa.status === 'PASS' && vNa.result.notApplicable === 1 && vNa.population.checked === 5);
  const abortObj = runVerdict(planted, { steps: S, childVerdict: obj({ a: 'PASS' }), ...AT });
  ok('§3d plant · an abort keeps FAIL precedence even with PASS objects before it', abortObj.status === 'FAIL');
  const unplanned = runVerdict({ ...green, notRun: ['e'], ran: ['a', 'b', 'c', 'd'] }, { steps: S, childVerdict: allPass, ...AT });
  ok(
    '§3d plant · an UNPLANNED NOT_RUN child with everything else PASS ⇒ UNKNOWN, never green',
    unplanned.status === 'UNKNOWN' && /NOT_RUN without a declared exclusion/.test(unplanned.reason),
    unplanned.reason
  );
  const sub = ['a', 'b'];
  const subRun = runAll({ steps: sub, exec: () => ({ code: 0 }), log: () => {} });
  const vFilt = runVerdict(subRun, { steps: sub, declaredExcluded: ['c', 'd', 'e'], excludedBy: '--steps=a,b', childVerdict: allPass, ...AT });
  ok(
    '§3d plant · a DECLARED exclusion ⇒ PASS over the smaller checked, filtered:true, excludedBy named',
    vFilt.status === 'PASS' &&
      vFilt.result.filtered === true &&
      vFilt.result.excludedBy === '--steps=a,b' &&
      JSON.stringify(vFilt.population) === JSON.stringify({ checked: 2, eligible: 5, excluded: 3 }),
    JSON.stringify(vFilt.population)
  );
  ok('§3d plant · …and carries the consumer rule: a filtered PASS is NOT the gate', /NOT the gate/.test(vFilt.result.consumerRule || ''));
  ok('§3d control · an unfiltered run has filtered:false and no consumer rule', vAllObj.result.filtered === false && vAllObj.result.consumerRule === undefined);
  const vNone = runVerdict({ ...planted, notRun: S.slice(), ran: [], failed: null, code: 0 }, { steps: S, ...AT });
  ok('§3d plant · checked = 0 ⇒ NOT_RUN', vNone.status === 'NOT_RUN' && vNone.population.checked === 0);
  const sample = verdictSample();
  ok(
    '§3d · --verdict-sample is the honest first shape: UNKNOWN by provenance over 5/5, no commit',
    sample.status === 'UNKNOWN' && sample.population.checked === 5 && sample.producedBy.commit === null
  );
  ok('§3d · the exit code is unchanged by adoption (a red run still propagates its code)', planted.code === 3 && green.code === 0);

  /* ── the run's tree, not the file's (residue 2026-11-05-verdict-gates-still-judge-…) ──────────── */
  const vRef = refusalVerdict('cwd-not-a-checkout here', AT);
  ok('a refusal is NOT_RUN and carries result: null', vRef.status === 'NOT_RUN' && vRef.result === null, JSON.stringify(vRef.result));
  ok(
    '…over an honest population: nothing checked, every step excluded',
    vRef.population.checked === 0 && vRef.population.excluded === STEPS.length && vRef.population.eligible === STEPS.length,
    JSON.stringify(vRef.population)
  );
  ok('…and names a reason, because every non-PASS owes one', /cwd-not-a-checkout/.test(vRef.reason || ''), String(vRef.reason));
  const SELF_TEXT = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  ok("ANTI-VACUITY · the CLI resolves the run's tree through judgeRoot", /ROOT = judgeRoot\(import\.meta\.url\)/.test(SELF_TEXT));
  ok('CONTROL · the children still take that root as their cwd, so the resolution reaches them', /spawnSync\('npm', \['run', step\], \{ cwd: ROOT/.test(SELF_TEXT));
  ok('CONTROL · the default root is still DERIVED, never read from the cwd', /^let ROOT = join\(HERE, '\.\.'\);$/m.test(SELF_TEXT));

  console.log(fail ? `\n✗ ${fail} failed, ${pass} passed` : `\n✓ all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) {
  if (process.argv.includes('--list')) {
    STEPS.forEach((s, i) => console.log(`${i + 1}/${STEPS.length}  ${s}`));
    process.exit(0);
  }
  if (process.argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample()));
    process.exit(0);
  }
  const json = process.argv.includes('--json');
  const stepsArg = process.argv.find((a) => a.startsWith('--steps='));
  const selected = stepsArg ? stepsArg.slice('--steps='.length).split(',').filter(Boolean) : null;
  const unknownStep = (selected || []).filter((s) => !STEPS.includes(s));
  if (unknownStep.length) {
    console.error(`--steps names step(s) not in STEPS: ${unknownStep.join(', ')}`);
    process.exit(2);
  }
  const steps = selected ? STEPS.filter((s) => selected.includes(s)) : STEPS;
  const declaredExcluded = selected ? STEPS.filter((s) => !selected.includes(s)) : [];
  /* THE TREE THIS RUN GATES IS THE ONE IT WAS RUN FROM. Every step below is `npm run <step>` with
     `cwd: ROOT`, so a run by this file's absolute path from another checkout gated the tree the FILE
     lives in and then printed a verdict about it. */
  try {
    ROOT = judgeRoot(import.meta.url);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    console.error(e.message);
    const reason = 'this run and tools/run-check.mjs sit in different checkouts (' + e.reason + '), so which tree to gate is undecided';
    console.error('✕ run-check: ' + reason);
    if (json) console.log(JSON.stringify(refusalVerdict(reason)));
    process.exit(2);
  }
  const codes = {};
  const r = runAll({ steps, exec: (step) => ((codes[step] = defaultExec(step, { toStderr: json }).code), { code: codes[step] }), log: json ? (...a) => console.error(...a) : console.log });
  if (json) console.log(JSON.stringify(runVerdict(r, { steps, declaredExcluded, excludedBy: selected ? stepsArg : null, codes })));
  /* THE EXIT CODE STAYS — the shell and CI read it until the consumer reads the object (§3d). */
  process.exit(r.ok ? 0 : r.code || 1);
}
