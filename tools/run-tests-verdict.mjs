// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * tools/run-tests-verdict.mjs — Tepna
 *
 * THE TEST RUNNER'S tepna.verdict/1 OBJECT — VERDICT-CONTRACT §3d, the third and largest runner
 * adopter, through the same `aggregateChildren` as run-check (#2827) and selftest-all (#2828).
 * `tests/run-tests.mjs` calls these; the builders live here, pure, so the plants can drive every
 * table row without spending ten minutes of suite, and so the adoption gate (which enumerates
 * `tools/*.mjs`) can read the producer.
 *
 *   A GROUP IS A CHILD; AN ASSERTION IS NOT. The runner's `T.ok` is per assertion; a group's status
 *   is the summary of its assertions (provenance `assertions` — a structured read the runner vouches
 *   for): any failing assertion ⇒ FAIL · ≥ 1 pass and none failing ⇒ PASS · only declared skips ⇒
 *   NOT_APPLICABLE (the corpus that leg needs is absent on this tree — checked, not binding, never
 *   green evidence) · no assertions at all ⇒ UNKNOWN (an empty group decided nothing).
 *   A DECLARED EXCLUSION (`--group=`, `--shard=i/N`) ⇒ `filtered: true` with the consumer rule: a
 *   filtered PASS is NOT the gate.
 *   THE SKIP BUDGET is the runner's one criterion of its own: an UNDECLARED skip is FAIL by name
 *   (tests/expected-skips.json — shrinking the gate must be a reviewable act).
 *   THE UNION over `--jobs=N` aggregates the SHARD OBJECTS: a shard that died without a parseable
 *   object is an undeclared NOT_RUN child, so the union is UNKNOWN, never a pass over the shards that
 *   finished (CLAUDE.md §4c made structural). The exit code stays for the shell and CI.
 *
 *   node tools/run-tests-verdict.mjs --selftest
 *   node tools/run-tests-verdict.mjs --verdict-sample     the union over three scratch shards, one dead
 */
import { pathToFileURL } from 'node:url';
import { aggregateChildren, makeVerdict } from './verdict-emit.mjs';

const CRITERION = {
  name: 'children_failing (a group with a failing assertion ⇒ FAIL; an undeclared skip ⇒ FAIL by the skip budget; a group of declared skips only is NOT_APPLICABLE; a filtered run (--group=, --shard=) is never the gate; a dead shard is an undeclared NOT_RUN ⇒ UNKNOWN)',
  threshold: 0,
  unit: 'failing children',
  direction: 'eq'
};

/* One group → one child. `g.tests` as run-tests.mjs shapes them: { name, pass, skip, detail }. */
export function groupChild(g) {
  const tests = g.tests || [];
  const skip = tests.filter((t) => t.skip).length;
  const pass = tests.filter((t) => t.pass && !t.skip).length;
  const fail = tests.length - pass - skip;
  const status = fail > 0 ? 'FAIL' : pass > 0 ? 'PASS' : skip > 0 ? 'NOT_APPLICABLE' : 'UNKNOWN';
  return { name: g.title, provenance: 'assertions', status, n: { pass, fail, skip } };
}

/* The object for ONE process — a full serial run, a --group= run, or one shard's run. */
export function suiteVerdict({ groups, totalGroups, groupFilter = null, shard = null, skipViolations = [] }, { commit, commitReason, at } = {}) {
  const children = groups.map(groupChild);
  const total = Number.isInteger(totalGroups) ? totalGroups : groups.length;
  const excludedBy = groupFilter ? `--group=${groupFilter}` : shard ? `--shard=${shard}` : null;
  const agg = aggregateChildren(children, { eligible: total, declaredExcluded: excludedBy ? Math.max(0, total - groups.length) : 0, excludedBy });
  let { status, reason, result } = agg;
  const assertions = children.reduce((a, c) => ({ pass: a.pass + c.n.pass, fail: a.fail + c.n.fail, skip: a.skip + c.n.skip }), { pass: 0, fail: 0, skip: 0 });
  if (result) result = { ...result, assertions, skipViolations: skipViolations.length, shard, groupFilter, children: result.children.map((c, i) => ({ ...c, n: children[i].n })) };
  /* THE SKIP BUDGET — the runner's own pre-stated criterion. */
  if (skipViolations.length && status !== 'FAIL') {
    status = 'FAIL';
    reason =
      `${skipViolations.length} UNDECLARED skip(s) — the gate shrank without a declaration in tests/expected-skips.json: ${skipViolations
        .slice(0, 5)
        .map((v) => `[${v.group}] ${v.test}`)
        .join('; ')}${skipViolations.length > 5 ? '; …' : ''}` + (agg.reason ? `; also ${agg.reason}` : '');
  }
  return makeVerdict({
    gate: 'run-tests',
    status,
    population: agg.population,
    criterion: CRITERION,
    result,
    evidence: ['tests/dex-tests.js', 'tests/expected-skips.json', ...(shard ? ['tests/shard-plan.mjs', 'tests/group-timings.json'] : [])],
    reason,
    tool: 'tools/run-tests-verdict.mjs',
    commit,
    commitReason,
    at
  });
}

/* The UNION over N forked shards. shards: [{ i, code, verdict | null }] — `verdict` is the shard's own
   object read from its --json payload, null when the shard produced none (died, or unparseable). */
export function unionVerdict(shards, jobs, { groupFilter = null, commit, commitReason, at } = {}) {
  /* A live shard whose object is NOT_RUN because a --group= passed through left it NO groups is a
     DECLARED exclusion (the filter), not a dead shard — it answered; the answer was "nothing of mine
     matched". Without a filter a NOT_RUN shard object stays a NOT_RUN child (something else emptied it). */
  const declared = [];
  const children = [];
  for (const s of shards) {
    const name = `shard ${s.i}/${jobs}`;
    if (!s.verdict || !s.verdict.status) children.push({ name, provenance: 'not-run', code: s.code });
    else if (s.verdict.status === 'NOT_RUN' && groupFilter) declared.push(name);
    else children.push({ name, provenance: 'object', status: s.verdict.status });
  }
  const agg = aggregateChildren(children, { eligible: jobs, declaredExcluded: declared, excludedBy: declared.length ? `--group=${groupFilter}` : null });
  let { result } = agg;
  const live = shards.filter((s) => s.verdict && s.verdict.result);
  if (result) {
    const sum = (k) => live.reduce((a, s) => a + ((s.verdict.result.assertions || {})[k] || 0), 0);
    result = {
      ...result,
      jobs,
      groups: live.reduce((a, s) => a + (s.verdict.population.checked || 0), 0),
      assertions: { pass: sum('pass'), fail: sum('fail'), skip: sum('skip') },
      skipViolations: live.reduce((a, s) => a + (s.verdict.result.skipViolations || 0), 0)
    };
    /* a --group= passed through to every shard filters the union too; say so at this level. A shard's
       own `--shard=i/N` exclusion is NOT a filter here — the union is exactly what resolves it. */
    const f = live.find((s) => s.verdict.result && s.verdict.result.filtered && /^--group=/.test(s.verdict.result.excludedBy || ''));
    if (f && !result.filtered) {
      result.filtered = true;
      result.excludedBy = f.verdict.result.excludedBy;
      if (agg.status === 'PASS') result.consumerRule = 'a filtered PASS is NOT the gate — the CI summary and any merge decision must not read it as the full run (§3d)';
    }
  }
  return makeVerdict({
    gate: 'run-tests',
    status: agg.status,
    population: agg.population,
    criterion: CRITERION,
    result,
    evidence: ['tests/dex-tests.js', 'tests/shard-plan.mjs', 'tests/verify-shard-union.mjs'],
    reason: agg.reason,
    tool: 'tools/run-tests-verdict.mjs',
    commit,
    commitReason,
    at
  });
}

/* Three scratch shards, one dead — §4c made structural: the union is UNKNOWN, never a pass over the
   two that finished. No suite run, no code identity claimed. */
export function verdictSample() {
  const AT = { commit: null, commitReason: '--verdict-sample: three scratch shards, no suite run, no code identity claimed', at: '2026-09-22T00:00:00Z' };
  const G = (title, pass) => ({ title, tests: Array.from({ length: pass }, (_, i) => ({ name: `a${i}`, pass: true, skip: false })) });
  const s1 = suiteVerdict({ groups: [G('scratch:one', 4), G('scratch:two', 3)], totalGroups: 6, shard: '1/3' }, AT);
  const s2 = suiteVerdict({ groups: [G('scratch:three', 5), G('scratch:four', 2)], totalGroups: 6, shard: '2/3' }, AT);
  return unionVerdict(
    [
      { i: 1, code: 0, verdict: s1 },
      { i: 2, code: 0, verdict: s2 },
      { i: 3, code: null, verdict: null }
    ],
    3,
    AT
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const T = (pass, fail = 0, skip = 0) => [
    ...Array.from({ length: pass }, (_, i) => ({ name: `p${i}`, pass: true, skip: false })),
    ...Array.from({ length: fail }, (_, i) => ({ name: `f${i}`, pass: false, skip: false, detail: 'planted' })),
    ...Array.from({ length: skip }, (_, i) => ({ name: `s${i}`, pass: false, skip: true }))
  ];
  const G = (title, ...t) => ({ title, tests: T(...t) });
  /* a group is a child, an assertion is not */
  eq(groupChild(G('g', 3)).status, 'PASS', 'group: 3 passing ⇒ PASS');
  eq(groupChild(G('g', 3, 1)).status, 'FAIL', 'group: one failing assertion ⇒ FAIL');
  eq(groupChild(G('g', 0, 0, 2)).status, 'NOT_APPLICABLE', 'group: only declared skips ⇒ NOT_APPLICABLE');
  eq(groupChild(G('g', 2, 0, 1)).status, 'PASS', 'group: passes with a skip ⇒ PASS (the skip rides in n)');
  eq(groupChild(G('g')).status, 'UNKNOWN', 'group: no assertions ⇒ UNKNOWN (decided nothing)');
  eq(groupChild(G('g', 1)).provenance, 'assertions', 'group child provenance is `assertions`, not object');
  /* one process */
  const full = suiteVerdict({ groups: [G('a', 3), G('b', 4), G('c', 0, 0, 2)], totalGroups: 3 }, AT);
  eq(full.status, 'PASS', '§3d · full run, every group PASS or NOT_APPLICABLE ⇒ PASS');
  eq(JSON.stringify(full.population), JSON.stringify({ checked: 3, eligible: 3, excluded: 0 }), '§3d · population = groups, the skipped-only group is checked');
  eq(full.result.notApplicable, 1, '§3d · NOT_APPLICABLE counted, never green evidence');
  eq(full.result.assertions.pass, 7, '§3d · assertions summed in the result');
  eq(full.result.filtered, false, '§3d control · an unfiltered run is not filtered');
  const red = suiteVerdict({ groups: [G('a', 3), G('b', 2, 1)], totalGroups: 2 }, AT);
  eq(red.status === 'FAIL' && red.result.firstFailure === 'b', true, '§3d plant · a failing group ⇒ FAIL, named');
  const filt = suiteVerdict({ groups: [G('clock', 5)], totalGroups: 640, groupFilter: 'clock' }, AT);
  eq(filt.status, 'PASS', '§3d plant · --group= ⇒ PASS over the smaller checked');
  eq(JSON.stringify(filt.population), JSON.stringify({ checked: 1, eligible: 640, excluded: 639 }), '§3d plant · …population names the 639 groups never asked');
  eq(filt.result.filtered === true && filt.result.excludedBy === '--group=clock', true, '§3d plant · …filtered:true, excludedBy --group=');
  eq(/NOT the gate/.test(filt.result.consumerRule || ''), true, '§3d plant · …carries the consumer rule');
  const sh = suiteVerdict({ groups: [G('a', 1), G('b', 1)], totalGroups: 8, shard: '2/4' }, AT);
  eq(sh.result.filtered === true && sh.result.excludedBy === '--shard=2/4' && sh.population.excluded === 6, true, '§3d plant · a shard is a declared exclusion too');
  const sv = suiteVerdict({ groups: [G('a', 3)], totalGroups: 1, skipViolations: [{ group: 'a', test: 'x' }] }, AT);
  eq(sv.status === 'FAIL' && /UNDECLARED skip/.test(sv.reason) && /\[a\] x/.test(sv.reason), true, '§3d plant · an undeclared skip ⇒ FAIL by the skip budget, named');
  const unk = suiteVerdict({ groups: [G('a', 3), G('empty')], totalGroups: 2 }, AT);
  eq(unk.status === 'UNKNOWN' && /empty/.test(unk.reason), true, '§3d plant · an empty group ⇒ the run is UNKNOWN (precedence, not a vote)');
  eq(suiteVerdict({ groups: [], totalGroups: 0 }, AT).status, 'NOT_RUN', '§3d plant · no groups ⇒ NOT_RUN');
  /* the union */
  const s1 = suiteVerdict({ groups: [G('a', 4)], totalGroups: 2, shard: '1/2' }, AT);
  const s2 = suiteVerdict({ groups: [G('b', 3)], totalGroups: 2, shard: '2/2' }, AT);
  const u = unionVerdict(
    [
      { i: 1, code: 0, verdict: s1 },
      { i: 2, code: 0, verdict: s2 }
    ],
    2,
    AT
  );
  eq(u.status, 'PASS', '§3d union · two PASS shards ⇒ PASS');
  eq(JSON.stringify(u.population), JSON.stringify({ checked: 2, eligible: 2, excluded: 0 }), '§3d union · population = shards');
  eq(u.result.groups === 2 && u.result.assertions.pass === 7, true, '§3d union · groups and assertions summed across shards');
  eq(u.result.filtered, false, '§3d union · shards are not a filter at the union level');
  const dead = unionVerdict(
    [
      { i: 1, code: 0, verdict: s1 },
      { i: 2, code: null, verdict: null }
    ],
    2,
    AT
  );
  eq(dead.status, 'UNKNOWN', '§3d plant · a DEAD shard ⇒ the union is UNKNOWN, never a pass over the shard that finished (§4c)');
  eq(JSON.stringify(dead.population), JSON.stringify({ checked: 1, eligible: 2, excluded: 1 }), '§3d plant · …the dead shard is an undeclared NOT_RUN, counted excluded');
  eq(/shard 2\/2/.test(dead.reason), true, '§3d plant · …and named');
  const redU = unionVerdict(
    [
      { i: 1, code: 0, verdict: s1 },
      { i: 2, code: 1, verdict: suiteVerdict({ groups: [G('b', 2, 1)], totalGroups: 2, shard: '2/2' }, AT) }
    ],
    2,
    AT
  );
  eq(redU.status === 'FAIL' && /shard 2\/2/.test(redU.reason), true, '§3d plant · a FAIL shard ⇒ FAIL, even beside a dead one it would outrank');
  const fu = unionVerdict(
    [
      { i: 1, code: 0, verdict: suiteVerdict({ groups: [G('clock', 2)], totalGroups: 640, groupFilter: 'clock', shard: '1/2' }, AT) },
      { i: 2, code: 0, verdict: suiteVerdict({ groups: [], totalGroups: 640, groupFilter: 'clock', shard: '2/2' }, AT) }
    ],
    2,
    AT
  );
  eq(fu.status === 'UNKNOWN' || fu.status === 'PASS', true, '§3d union · a --group= passed through the shards is read (status from the children)');
  eq(fu.result.filtered === true && fu.result.excludedBy === '--group=clock', true, '§3d union · …and the union says it is filtered');
  eq(unionVerdict([], 0, AT).status, 'NOT_RUN', '§3d union · no shards ⇒ NOT_RUN');
  const emptyShard = suiteVerdict({ groups: [], totalGroups: 640, groupFilter: 'clock', shard: '2/2' }, AT);
  eq(emptyShard.status, 'NOT_RUN', '§3d · a shard the filter left empty is NOT_RUN as its own object');
  const fu2 = unionVerdict(
    [
      { i: 1, code: 0, verdict: suiteVerdict({ groups: [G('clock', 2)], totalGroups: 640, groupFilter: 'clock', shard: '1/2' }, AT) },
      { i: 2, code: 0, verdict: emptyShard }
    ],
    2,
    { ...AT, groupFilter: 'clock' }
  );
  eq(
    fu2.status === 'PASS' && JSON.stringify(fu2.population) === JSON.stringify({ checked: 1, eligible: 2, excluded: 1 }) && fu2.result.filtered === true,
    true,
    '§3d plant · …but at the union level, under the same --group=, it is a DECLARED exclusion: PASS over 1/2, filtered'
  );
  const fu3 = unionVerdict(
    [
      { i: 1, code: 0, verdict: suiteVerdict({ groups: [G('clock', 2)], totalGroups: 640, groupFilter: 'clock', shard: '1/2' }, AT) },
      { i: 2, code: 0, verdict: emptyShard }
    ],
    2,
    AT
  );
  eq(fu3.status, 'UNKNOWN', '§3d control · the same shards with NO filter known to the union ⇒ UNKNOWN (an empty shard nobody declared)');
  const sample = verdictSample();
  eq(sample.status === 'UNKNOWN' && sample.population.checked === 2 && sample.producedBy.commit === null, true, '§3d · --verdict-sample: three shards, one dead ⇒ UNKNOWN over 2/3, no commit');
  console.log(`all ${n} selftests passed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) selftest();
  else if (process.argv.includes('--verdict-sample')) console.log(JSON.stringify(verdictSample()));
  else {
    console.error('usage: node tools/run-tests-verdict.mjs --selftest | --verdict-sample   (the builders are called by tests/run-tests.mjs)');
    process.exit(2);
  }
}
