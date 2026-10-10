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

   THE CAP IS PRE-STATED AND SHRINK-ONLY: the untimed SHARE may not exceed 5 %.
   Measured 2026-10-10 at 29 of 727 = 3.99 %. It is a share and not a count for a
   reason recorded at the constant below — the count version red on the merge
   that added two groups, which is a toll on adding tests, not a finding.

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

/* WHY A RATIO AND NOT A COUNT. The first version of this gate capped the COUNT at the 27 measured
   on 2026-10-10 — and it went red on the very next merge, which added two groups. That is the flaw,
   not a success: a NEW group is unpriced BY CONSTRUCTION, so an absolute cap reds every PR that adds
   a test and makes the repo's most valuable activity pay a toll. What deserves refusing is the
   untimed SHARE drifting upward — nobody ever pricing anything. Measured 2026-10-10: 29 of 727 =
   3.99 %. The cap is 5 %, which reds at 37 of 727: ~8 groups of headroom, enough that an ordinary PR
   never trips it and systematic neglect does. SHRINK-ONLY — lower it with the commit that earns it,
   never raise it. */
export const UNTIMED_RATCHET_PCT = 5;

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

export function evaluate(untimed, checked, ratchetPct = UNTIMED_RATCHET_PCT) {
  const n = untimed.length;
  /* §∅: over an empty population the SHARE is not 0 %, it is UNDEFINED — nothing was examined. */
  if (!checked) return { status: 'NOT_RUN', reason: 'no groups were enumerated, so the untimed share is undefined', pct: null, slack: null };
  const pct = (n / checked) * 100;
  const cap = Math.floor((ratchetPct / 100) * checked);
  if (n > cap)
    return {
      status: 'FAIL',
      pct,
      slack: cap - n,
      reason:
        n +
        ' of ' +
        checked +
        ' groups have no committed timing (' +
        pct.toFixed(2) +
        ' %), over the ' +
        ratchetPct +
        ' % cap (' +
        cap +
        ' groups) — price them with `npm run timings:refresh`, or lower the cap in the commit that earns it'
    };
  return { status: 'PASS', reason: null, pct, slack: cap - n };
}

/** Build the object from an ALREADY-COMPUTED count, so `--verdict-sample` costs nothing. */
function verdictFor(untimed, checked) {
  const r = evaluate(untimed, checked);
  const commit = gitCommit();
  return Verdict.make({
    gate: 'shard-untimed-ratchet',
    status: r.status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'untimed_group_share', threshold: UNTIMED_RATCHET_PCT, unit: 'percent', direction: 'lte' },
    result: { untimed: untimed.length, checked, pct: r.pct === null ? null : Number(r.pct.toFixed(2)) },
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
  const r = evaluate(untimed, groups.length);
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
      (r.status === 'PASS' ? '✓' : '✗') +
        ' untimed groups: ' +
        untimed.length +
        ' of ' +
        groups.length +
        ' = ' +
        r.pct.toFixed(2) +
        ' % (cap ' +
        UNTIMED_RATCHET_PCT +
        ' %' +
        (r.slack > 0 ? ', ' + r.slack + ' under' : '') +
        ')'
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
  const X = (n) => new Array(n).fill('x');
  /* THE CASE THAT MOTIVATED THE RATIO: 27 of 725 was the measured state, then a merge added two
     groups. Under the old COUNT cap of 27 this was a FAIL — a red earned by adding tests, not by
     neglect. Under the share cap it is the PASS it should always have been. */
  ck('the merge that added two groups is NOT a failure (29 of 727 = 3.99 %)', evaluate(X(29), 727).status, 'PASS');
  ck('…and the state it grew from passes too (27 of 725)', evaluate(X(27), 725).status, 'PASS');
  ck('exactly at the cap is a PASS (36 of 727 = 4.95 %, cap floor is 36)', evaluate(X(36), 727).status, 'PASS');
  ck('one past the cap FAILS (37 of 727)', evaluate(X(37), 727).status, 'FAIL');
  ck('…and the reason names the count, the share, the cap and the fix', /37 of 727.*5\.09 %.*5 % cap \(36 groups\).*timings:refresh/.test(evaluate(X(37), 727).reason), true);
  ck('a PASS carries no reason', evaluate(X(29), 727).reason, null);
  ck('nothing untimed is a PASS with the whole cap as slack', evaluate([], 727).slack, 36);
  /* §∅ ANTI-VACUITY: a gate handed an empty population must not report a clean 0 % — it examined
     nothing, so the share is UNDEFINED. This is the shape the adoption gate refused in --verdict-sample. */
  ck('an EMPTY population is NOT_RUN, never a 0 % pass', evaluate([], 0).status, 'NOT_RUN');
  ck('…and its share is null, not zero', evaluate([], 0).pct, null);
  ck('the cap scales with the population, so growth alone never reds it', evaluate(X(50), 2000).status, 'PASS');
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
