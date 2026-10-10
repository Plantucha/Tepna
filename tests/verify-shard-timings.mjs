// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tests/verify-shard-timings.mjs — the UNTIMED-GROUP RATCHET
   ────────────────────────────────────────────────────────────────────────
       node tests/verify-shard-timings.mjs            # gate (exit 1 on growth)
       node tests/verify-shard-timings.mjs --json     # the verdict object alone
       npm run timings:refresh                        # shrink the number honestly

   WHAT THIS DOES NOT DO: it does not require `tests/group-timings.json` to be
   current, and it must never grow into that. That file's own header states the
   decision — drift there degrades BALANCE and never CORRECTNESS, so it is "safe
   by construction" and deliberately not gate-backed. Nothing here overrules it:
   the timings stay a HINT.

   WHAT IT DOES: it stops the UNTIMED SET growing silently. Before this, the
   planner's only report was one prose line — "(N group(s) had no committed
   timing — balance is a guess for those)" — printed mid-run where nothing reads
   it. A number that only ever appears as prose is a number nobody is
   accountable for: it drifted to 27 of 725 groups unremarked, all of them the
   recent §∅ families, which are exactly the groups whose cost nobody has
   measured yet.

   THE RATCHET IS PRE-STATED AND SHRINK-ONLY. It starts at the value measured on
   2026-10-10 — 27 — and may only go down. Adding a group is free; adding a group
   AND leaving it unpriced is what this refuses, unless you lower the ratchet
   deliberately in the same commit and say why.

   WHY IT IS CHEAP ENOUGH FOR THE STATIC JOB: the group set is RUNTIME-GENERATED
   (686 `group('` call sites under tests/ produce 725 executed groups — the
   `mutation drafts b2/b3` families and friends are built by their generators),
   so a source parse would ratchet against a denominator 39 short. `--list`
   enumerates the real set WITHOUT executing it in ~4 s, which is why this is a
   gate and not a nightly report.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readTimings } from './shard-plan.mjs';

/* verdict.js is CommonJS and assigns `module.exports = API` — a named import of `Verdict` throws at
   load. `createRequire` is the house idiom for reaching it from an .mjs tool (tools/box-sample.mjs:150). */
const Verdict = createRequire(import.meta.url)('../verdict.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Measured 2026-10-10 on 725 executed groups. SHRINK-ONLY — lower it with the commit that earns it. */
export const UNTIMED_RATCHET = 27;

/** §∅: not being in a git tree is an ABSENCE, and the verdict says so in `commitReason` — never a fake sha. */
function gitCommit(root = ROOT) {
  try {
    return (
      execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

/** The executed set, enumerated without running it. Returns [{ index, title }]. */
export function listGroups(root = ROOT) {
  const out = execFileSync('node', [join(root, 'tests/run-tests.mjs'), '--list'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const i = out.indexOf('{"totalGroups"');
  if (i < 0) throw new Error('`--list` printed no JSON — its output shape changed, and this gate cannot guess at it');
  return JSON.parse(out.slice(i)).groups;
}

/** Pure, so the selftest can exercise every branch without enumerating anything. */
export function untimedOf(groups, timings) {
  const timed = new Set(Object.keys(timings || {}));
  return groups.map((g) => g.title).filter((t) => !timed.has(t));
}

export function evaluate(untimed, ratchet = UNTIMED_RATCHET) {
  const n = untimed.length;
  if (n > ratchet)
    return {
      status: 'FAIL',
      reason: n + ' group(s) have no committed timing, over a ratchet of ' + ratchet + ' — price them with `npm run timings:refresh`, or lower the ratchet in the commit that earns it'
    };
  if (n < ratchet) return { status: 'PASS', reason: null, slack: ratchet - n };
  return { status: 'PASS', reason: null, slack: 0 };
}

/** Build the object from an ALREADY-COMPUTED count, so `--verdict-sample` costs nothing. */
function verdictFor(untimed, checked) {
  const r = evaluate(untimed);
  const commit = gitCommit();
  return Verdict.make({
    gate: 'shard-untimed-ratchet',
    status: r.status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'untimed_groups', threshold: UNTIMED_RATCHET, unit: 'groups', direction: 'lte' },
    result: { untimed: untimed.length },
    evidence: ['tests/verify-shard-timings.mjs', 'tests/group-timings.json'],
    reason: r.reason,
    producedBy: {
      tool: 'tests/verify-shard-timings.mjs',
      commit,
      ...(commit ? {} : { commitReason: 'not read from a git tree' })
    }
  });
}

function main() {
  const groups = listGroups();
  const untimed = untimedOf(groups, readTimings());
  const r = evaluate(untimed);
  const v = verdictFor(untimed, groups.length);
  const chk = Verdict.validate(v);
  if (!chk.ok) {
    console.error('✗ the verdict this gate emitted does not validate: ' + JSON.stringify(chk));
    process.exit(2);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(v));
  } else {
    console.log(JSON.stringify(v));
    console.log(
      (r.status === 'PASS' ? '✓' : '✗') + ' untimed groups: ' + untimed.length + ' of ' + groups.length + ' (ratchet ' + UNTIMED_RATCHET + (r.slack ? ', ' + r.slack + ' under — lower it' : '') + ')'
    );
    if (r.status !== 'PASS') {
      console.error('  ' + r.reason);
      for (const t of untimed.slice(0, 10)) console.error('   · ' + t);
      if (untimed.length > 10) console.error('   … and ' + (untimed.length - 10) + ' more');
    }
  }
  process.exit(r.status === 'PASS' ? 0 : 1);
}

if (process.argv.includes('--verdict-sample')) {
  /* The SHAPE, not a measurement: a sample that enumerated nothing must not claim it checked
     anything, so §🧾's `checked: 0` + NOT_RUN is the only honest sample of a gate like this. */
  const v = verdictFor([], 0);
  v.status = 'NOT_RUN';
  v.result = null; // §∅ in the verdict's own shape: nothing examined ⇒ nothing MEASURED, not a zero
  v.reason = 'sample only — this invocation enumerated no groups';
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  let bad = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      bad++;
      console.log('  ✕ ' + n + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
    } else console.log('  ✓ ' + n);
  };
  const G = (...t) => t.map((title, index) => ({ index, title }));
  ck('an untimed group is the one without an entry', untimedOf(G('a', 'b'), { a: 1 }), ['b']);
  ck('every group timed ⇒ none untimed', untimedOf(G('a'), { a: 1 }), []);
  ck('a STALE timing entry does not count as untimed', untimedOf(G('a'), { a: 1, gone: 9 }), []);
  ck('at the ratchet is a PASS', evaluate(new Array(27).fill('x')).status, 'PASS');
  ck('one over the ratchet FAILS', evaluate(new Array(28).fill('x')).status, 'FAIL');
  ck('…and the reason names both numbers and the refresh command', /28 group\(s\).*ratchet of 27.*timings:refresh/.test(evaluate(new Array(28).fill('x')).reason), true);
  ck('under the ratchet reports the slack, so it can be lowered', evaluate(new Array(20).fill('x')).slack, 7);
  ck('a shrink is never a failure', evaluate([]).status, 'PASS');
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
