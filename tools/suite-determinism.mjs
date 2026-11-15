/* tools/suite-determinism.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the project root, or
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * IS A SUITE SELECTOR DECIDED THE SAME WAY TWICE?
 *
 * `2026-10-20-the-js-gate-survivor-set-does-not-reproduce-across-runs` measured three legs over one
 * identical mutant population, and each leg named a DIFFERENT survivor while every leg reported the
 * same headline of 6 survivors over 26. A kill rate is not a survivor list. The row named three
 * candidate mechanisms; #4001 refuted the timeout path and #4003 refuted write-through from the
 * hard-linked worker trees, which left ONE: a flaky assertion in the covering group.
 *
 * That candidate is about the SUITE, not about mutation, so this tool runs a selector N times over an
 * unchanged tree and compares the result sets. It answers one question and no other: does the gate
 * that decides a mutant decide the SAME WAY twice when nothing changed?
 *
 * 🔴 THE VACUOUS PASS THIS TOOL REFUSES. A selector that matches nothing runs no group and agrees with
 * itself perfectly, so determinism over an empty selection is the §4b defect — a verdict about
 * something never examined. `tests/run-tests.mjs` prints its selection on stdout, this tool reads the
 * count, and a run that selected 0 groups returns NOT_RUN with that reason rather than PASS.
 *
 * 🔴 COMPARE LEGS OF ONE TREE STATE, NEVER AGAINST A STORED HASH. The suite's own output counts the
 *   repository: one assertion label prints `the scan has a denominator (495 authored sources)`, and
 *   three more print the DSP's length in characters. Measured 2026-11-15: adding THIS FILE moved the
 *   clean result set from 8dd9ae31000b to d2647657afac, and a mutant leg holding the older hash as its
 *   baseline read that as the mutant moving the suite. This tool is safe from that by construction,
 *   because every leg runs the same tree, and a caller that pins a hash across an edit is not.
 *
 * 🔴 AND THE ONE A NORMALIZER CREATES. A timing figure moves on every run and says nothing about an
 * assertion, so it is stripped. Strip one token too many and every run agrees: the selftest therefore
 * holds a control where two outputs differ ONLY in an assertion COUNT, which must read FAIL, beside a
 * control where they differ only in a duration, which must read PASS.
 *
 * Usage:
 *   node tools/suite-determinism.mjs --group ppgdex-dsp --legs 3
 *   node tools/suite-determinism.mjs --group ppgdex-dsp --json      # ONE tepna.verdict/1 on stdout
 *   node tools/suite-determinism.mjs --verdict-sample               # the object alone
 *   node tools/suite-determinism.mjs --selftest
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedChild } from './child-bound.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF, '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const GATE = 'suite-determinism';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

/* A duration and a wall-clock stamp move on every run and carry no verdict. NOTHING ELSE is stripped:
   an assertion count, a group count, a name and a reported value all survive into the hash. */
export function normalize(text) {
  return String(text)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d+(\.\d+)?\s?ms\b/g, '<ms>')
    .replace(/\b\d+(\.\d+)?\s?s\b/g, '<s>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<at>')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/* The selection count, read from the runner's own stdout. `null` means this tool could not read it,
   which is never the same as zero. */
export function groupsSelected(text) {
  const s = String(text).replace(/\u001b\[[0-9;]*m/g, '');
  if (/filter matched ZERO groups/.test(s)) return 0;
  const arrow = s.match(/→\s+(\d+) of (\d+) groups/);
  if (arrow) return Number(arrow[1]);
  const paren = s.match(/\((\d+) groups?\)/);
  if (paren) return Number(paren[1]);
  return null;
}

export function firstDifference(a, b) {
  const la = String(a).split('\n');
  const lb = String(b).split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: la[i] ?? null, b: lb[i] ?? null };
  }
  return null;
}

/* One leg: run the selector once and reduce it to a comparable result set. */
export function runLeg({ group, tree, boundMs, impl, legNo }) {
  const got = boundedChild(process.execPath, ['tests/run-tests.mjs', `--group=${group}`], {
    ms: boundMs,
    label: `leg ${legNo} of the "${group}" selection`,
    cwd: tree,
    ...(impl ? { impl } : {})
  });
  /* A FAILING suite is still a readable result set - a mutant's gate reads exactly that - and its
     text lives in `partial`, because `boundedChild` holds `out` at null for every breach.
     🔴 MEASURED 2026-11-15: the first version of this line read `got.out || got.stdout || ''`, and
     `stdout` is a field the real `boundedChild` never set. So EVERY failing leg normalized to the
     empty string, every pair of failing legs agreed, and this tool would have returned PASS over a
     suite it never read. That is the vacuous pass it exists to refuse, one layer down. A leg with no
     readable text is EXCLUDED, and an empty capture is not a result set. */
  const text = got.ok ? got.out : got.timedOut || got.status === null ? null : got.partial;
  if (text === null || text === '') {
    const why = got.reason || 'the suite failed and wrote nothing this tool could read';
    return { ok: false, reason: why, groups: null, hash: null, text: null };
  }
  const norm = normalize(text);
  return {
    ok: true,
    reason: null,
    status: got.ok ? 0 : got.status,
    groups: groupsSelected(text),
    hash: createHash('sha256').update(norm).digest('hex').slice(0, 12),
    text: norm
  };
}

export function judge(legs, requested) {
  const read = legs.filter((l) => l.ok);
  const unread = legs.filter((l) => !l.ok);
  const base = {
    population: { checked: read.length, eligible: requested, excluded: unread.length },
    result: null,
    reason: null,
    status: 'UNKNOWN'
  };
  if (unread.length) {
    return { ...base, status: 'NOT_RUN', reason: `${unread.length} of ${requested} leg(s) were unreadable — first: ${unread[0].reason}` };
  }
  if (read.length < 2) {
    return { ...base, status: 'UNDERPOWERED', reason: `${read.length} readable leg(s): determinism needs at least 2` };
  }
  const zero = read.find((l) => l.groups === 0);
  if (zero) {
    return { ...base, status: 'NOT_RUN', reason: 'the selector matched ZERO groups, so every leg agreed about nothing' };
  }
  const blind = read.find((l) => l.groups === null);
  if (blind) {
    return { ...base, status: 'NOT_RUN', reason: 'the selection count could not be read from the runner output, and an unread count is not a non-empty one' };
  }
  const hashes = [...new Set(read.map((l) => l.hash))];
  const statuses = [...new Set(read.map((l) => l.status))];
  const result = {
    legs: read.length,
    groups: read[0].groups,
    distinctResultSets: hashes.length,
    distinctExitStatuses: statuses.length,
    hashes
  };
  if (hashes.length === 1 && statuses.length === 1) return { ...base, status: 'PASS', result };
  const a = read.find((l) => l.hash === hashes[0]);
  const b = read.find((l) => l.hash !== hashes[0]) || read[1];
  const diff = firstDifference(a.text, b.text);
  return {
    ...base,
    status: 'FAIL',
    result: { ...result, firstDifference: diff },
    reason: diff
      ? `${hashes.length} distinct result set(s) over ${read.length} leg(s); first difference at line ${diff.line}: ${JSON.stringify((diff.a || '').slice(0, 120))} against ${JSON.stringify((diff.b || '').slice(0, 120))}`
      : `${statuses.length} distinct exit status(es) over ${read.length} leg(s) with one result set`
  };
}

function commitOf() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
  } catch {
    return null;
  }
}

export function verdictOf({ status, population, result, reason, group, legs }) {
  const commit = commitOf();
  const v = Verdict.make({
    gate: GATE,
    status,
    population,
    criterion: {
      name: 'distinct_result_sets',
      threshold: 1,
      unit: `normalized result sets over ${legs} repetition(s) of one selector`,
      direction: 'lte'
    },
    result,
    evidence: ['tools/suite-determinism.mjs', 'tools/child-bound.mjs', `selector:--group=${group}`],
    reason: status === 'PASS' ? null : reason,
    producedBy: { tool: 'tools/suite-determinism.mjs', commit, ...(commit ? {} : { commitReason: 'git could not be read from this checkout' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`${GATE} produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

const SAMPLE = {
  status: 'PASS',
  population: { checked: 3, eligible: 3, excluded: 0 },
  result: { legs: 3, groups: 116, distinctResultSets: 1, distinctExitStatuses: 1, hashes: ['8dd9ae31000b'] },
  reason: null,
  group: 'ppgdex-dsp',
  legs: 3
};

function main() {
  if (has('--verdict-sample')) {
    process.stdout.write(JSON.stringify(verdictOf(SAMPLE), null, 2) + '\n');
    return 0;
  }
  const group = opt('--group', null);
  if (!group) {
    process.stderr.write('usage: node tools/suite-determinism.mjs --group <pattern> [--legs N] [--tree <path>] [--json]\n');
    return 2;
  }
  const legsWanted = Math.max(1, Number(opt('--legs', '3')));
  const tree = opt('--tree', ROOT);
  const boundMs = Number(opt('--bound-ms', '900000'));
  const asJson = has('--json');
  const say = asJson ? (s) => process.stderr.write(s + '\n') : (s) => process.stdout.write(s + '\n');

  const legs = [];
  for (let i = 1; i <= legsWanted; i++) {
    const t0 = Date.now();
    const leg = runLeg({ group, tree, boundMs, legNo: i });
    legs.push(leg);
    say(`  leg ${i}/${legsWanted}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${leg.ok ? `groups=${leg.groups} status=${leg.status} hash=${leg.hash}` : `UNREADABLE — ${leg.reason}`}`);
  }
  const j = judge(legs, legsWanted);
  const v = verdictOf({ ...j, group, legs: legsWanted });
  if (asJson) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  say(`▸ ${GATE}: ${j.status}${j.reason ? ' — ' + j.reason : ''}`);
  return j.status === 'PASS' ? 0 : j.status === 'FAIL' ? 1 : 2;
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      process.stdout.write(`  ✓ ${name}${detail ? '  — ' + detail : ''}\n`);
    } else {
      fail++;
      process.stdout.write(`  ✗ ${name}${detail ? '  — ' + detail : ''}\n`);
    }
  };
  const SUITE = (assertions, groups, extra = '') =>
    `▸ FILTERED RUN  --group="x"  →  ${groups} of 300 groups\n  [  1/${groups}]     18ms  elapsed 0s\n${extra}Tepna test suite  ✓ all ${assertions} assertions passed  (${groups} groups)\n`;
  const implOf = (outs) => {
    let n = 0;
    return () => {
      const o = outs[n++];
      if (o instanceof Error) throw o;
      return o;
    };
  };
  const legsFrom = (outs) => outs.map((_, i) => runLeg({ group: 'x', tree: ROOT, boundMs: 1000, impl: implOf(outs.slice(i)), legNo: i + 1 }));

  ok('normalize strips a duration', normalize('took 18ms') === 'took <ms>', normalize('took 18ms'));
  ok('normalize strips a seconds figure', normalize('elapsed 44s') === 'elapsed <s>', normalize('elapsed 44s'));
  ok('normalize strips an ISO stamp', normalize('at 2026-11-15T04:40:00Z') === 'at <at>');
  ok('normalize KEEPS an assertion count', normalize('all 1722 assertions passed').includes('1722'));
  ok('normalize KEEPS a group count', normalize('(116 groups)').includes('116'));
  ok('normalize drops blank lines', normalize('a\n\n\nb') === 'a\nb');
  ok('groupsSelected reads the filtered-run arrow', groupsSelected(SUITE(10, 116)) === 116);
  ok('groupsSelected reads a parenthesised count alone', groupsSelected('✓ all 3 assertions passed  (7 groups)') === 7);
  ok('groupsSelected reads the ZERO-match line as 0', groupsSelected('  ✗ filter matched ZERO groups — check the pattern') === 0);
  ok('groupsSelected cannot read a silent output, and says null', groupsSelected('nothing here') === null);

  const same = legsFrom([SUITE(1722, 116), SUITE(1722, 116), SUITE(1722, 116)]);
  const jSame = judge(same, 3);
  ok('three identical legs PASS', jSame.status === 'PASS', `${jSame.status} sets=${jSame.result && jSame.result.distinctResultSets}`);
  ok('…and the population arithmetic holds', jSame.population.checked + jSame.population.excluded === jSame.population.eligible);

  /* CONTROL · a duration is the one thing that may move between legs. */
  const timing = legsFrom([SUITE(1722, 116, '  one group  11ms\n'), SUITE(1722, 116, '  one group  97ms\n')]);
  ok('a leg differing ONLY in a duration still PASSes', judge(timing, 2).status === 'PASS', judge(timing, 2).reason || '');

  /* CONTROL · over-stripping would hide this, and it is the defect the normalizer could create. */
  const counts = legsFrom([SUITE(1722, 116), SUITE(1721, 116)]);
  const jCounts = judge(counts, 2);
  ok('a leg differing in an ASSERTION COUNT reads FAIL', jCounts.status === 'FAIL', jCounts.status);
  ok('…and the reason names the line that moved', !!jCounts.reason && jCounts.reason.includes('1722') && jCounts.reason.includes('1721'), (jCounts.reason || '').slice(0, 90));
  ok('…and the first difference carries a line number', !!jCounts.result.firstDifference && jCounts.result.firstDifference.line > 0);

  const named = legsFrom([SUITE(1722, 116, '  ✓ the beat set holds\n'), SUITE(1722, 116, '  ✗ the beat set holds\n')]);
  ok('a leg whose ASSERTION flipped reads FAIL', judge(named, 2).status === 'FAIL');

  /* The vacuous pass: perfect agreement about nothing. */
  const zero = legsFrom(['  ✗ filter matched ZERO groups — check the pattern\n', '  ✗ filter matched ZERO groups — check the pattern\n']);
  const jZero = judge(zero, 2);
  ok('two agreeing EMPTY selections read NOT_RUN, never PASS', jZero.status === 'NOT_RUN', jZero.status);
  ok('…and the reason says the legs agreed about nothing', !!jZero.reason && jZero.reason.includes('ZERO groups'), jZero.reason || '');

  const blind = legsFrom(['some output with no count\n', 'some output with no count\n']);
  ok('an unreadable selection count is NOT_RUN, because it is not a non-empty one', judge(blind, 2).status === 'NOT_RUN');

  const one = legsFrom([SUITE(1722, 116)]);
  ok('one leg is UNDERPOWERED, never PASS', judge(one, 1).status === 'UNDERPOWERED', judge(one, 1).reason || '');

  const err = Object.assign(new Error('boom'), { code: 'ETIMEDOUT', killed: false, status: 0 });
  const unread = [runLeg({ group: 'x', tree: ROOT, boundMs: 1000, impl: implOf([err]), legNo: 1 }), ...legsFrom([SUITE(1722, 116)])];
  const jUnread = judge(unread, 2);
  ok('an unreadable leg reads NOT_RUN and is EXCLUDED', jUnread.status === 'NOT_RUN' && jUnread.population.excluded === 1, `${jUnread.status} excluded=${jUnread.population.excluded}`);
  ok('…and its reason names the breach', !!jUnread.reason && /TIMED OUT|timed out/i.test(jUnread.reason), (jUnread.reason || '').slice(0, 100));

  /* A FAILING suite is a readable result set, because that is exactly what decides a mutant. The
     error carries `stdout`, which is the shape `execFileSync` throws and which `boundedChild` turns
     into `partial` - this leg therefore runs the real capture path and not a field of my own. */
  const failErr = Object.assign(new Error('suite failed'), { status: 1, killed: false, stdout: SUITE(1721, 116, '  ✗ one assertion\n') });
  const failLeg = runLeg({ group: 'x', tree: ROOT, boundMs: 1000, impl: implOf([failErr]), legNo: 1 });
  ok('a leg whose suite FAILED is still read, not excluded', failLeg.ok === true && failLeg.status === 1, `ok=${failLeg.ok} status=${failLeg.status}`);
  ok('…and its text is the suite output, not an empty string', !!failLeg.hash && failLeg.groups === 116 && failLeg.text.includes('1721'));

  /* CONTROL · the defect this tool shipped with for one hour. A failing suite that wrote NOTHING must
     be excluded, because the alternative is that two such legs agree about the empty string. */
  const muteErr = Object.assign(new Error('suite failed with no output'), { status: 1, killed: false });
  const muteLeg = runLeg({ group: 'x', tree: ROOT, boundMs: 1000, impl: implOf([muteErr]), legNo: 1 });
  ok('a failing suite that wrote NOTHING is excluded, never read as an empty result', muteLeg.ok === false, `ok=${muteLeg.ok} hash=${muteLeg.hash}`);
  const mute2 = runLeg({ group: 'x', tree: ROOT, boundMs: 1000, impl: implOf([muteErr]), legNo: 2 });
  const jMute = judge([muteLeg, mute2], 2);
  ok('…so two silent failures read NOT_RUN and never PASS', jMute.status === 'NOT_RUN', `${jMute.status}: ${jMute.reason}`);

  const vPass = verdictOf({ ...SAMPLE });
  ok('the PASS verdict validates', Verdict.validate(vPass).ok);
  ok('…and its criterion is pre-stated as a threshold of 1', vPass.criterion.threshold === 1 && vPass.criterion.direction === 'lte');
  const vFail = verdictOf({ ...jCounts, group: 'x', legs: 2 });
  ok('the FAIL verdict validates and carries a reason', Verdict.validate(vFail).ok && !!vFail.reason);
  const vZero = verdictOf({ ...jZero, group: 'x', legs: 2 });
  ok('the NOT_RUN verdict validates with a null result', Verdict.validate(vZero).ok && vZero.result === null);

  process.stdout.write(fail === 0 ? `\n✓ all ${pass} selftests passed\n` : `\n✗ ${fail} of ${pass + fail} selftests FAILED\n`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('suite-determinism.mjs')) {
  process.exit(has('--selftest') ? selftest() : main());
}
