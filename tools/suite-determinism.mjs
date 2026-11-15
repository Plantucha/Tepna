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
 * 🔴 AND THE ONE AGREEMENT ITSELF CREATES. A rare event needs legs to appear in. Row
 * `2026-11-04-the-hooks-gate-flakes-on-the-worktree-creating-cd-shape` is the measured case: one red in
 * 30 runs at six-way concurrency, then 0 reds in 310 further runs. Three agreeing legs over a one in 30
 * event agree about 90 % of the time BY CHANCE. So a caller states the rate it wants to see and the
 * confidence it wants, `powerFloor` names the legs that needs, and a would-be PASS under that floor is
 * downgraded to UNDERPOWERED with both numbers in its reason. A FAIL is never downgraded, because a
 * disagreement is its own evidence.
 *
 * 🔴 THE EMPTY-SELECTION REFUSAL TRAVELS WITH THE SELECTOR. `tests/run-tests.mjs` prints its group
 * count, so a 0 there is readable. An arbitrary command prints whatever it prints, so `--cmd` callers
 * pre-state `--min-units N` and this tool counts the command's own result lines. A run below the
 * declared floor reads NOT_RUN. A tool that guesses the population of a command it does not know is
 * the §4b defect wearing a number.
 *
 * Usage:
 *   node tools/suite-determinism.mjs --group ppgdex-dsp --legs 3
 *   node tools/suite-determinism.mjs --group ppgdex-dsp --json      # ONE tepna.verdict/1 on stdout
 *   node tools/suite-determinism.mjs --legs 89 --rate 1/30 --min-units 30 \
 *     --cmd -- bash .claude/hooks/guard-stale-brief.test.sh
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
export function normalize(text, volatile) {
  let out = String(text)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d+(\.\d+)?\s?ms\b/g, '<ms>')
    .replace(/\b\d+(\.\d+)?\s?s\b/g, '<s>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<at>');
  /* 🔴 A VOLATILE TOKEN THE CALLER DECLARES, AND NOTHING THIS TOOL GUESSES. Measured 2026-11-15:
     89 legs of `.claude/hooks/guard-stale-brief.test.sh` produced 89 DISTINCT result sets, and the
     first difference was the throwaway repo's `mktemp` path, printed on its own fixture line. That is
     a run nonce and not a flake, and 89 of 89 is the shape a nonce makes. Widening the built-in strips
     to cover it would strip every path from every caller, so the pattern is an ARGUMENT: it lands in
     the verdict's evidence, and a reader sees what was held volatile. */
  for (const re of volatile || []) out = out.replace(new RegExp(re, 'g'), '<volatile>');
  return out
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

/* The command's OWN result lines, for a selector this tool does not know. It counts the shapes a test
   file prints per leg and nothing else, so prose scores 0 — which is why `--min-units` is the caller's
   to declare and never this tool's to infer. */
export function unitsCounted(text) {
  const s = String(text).replace(/\u001b\[[0-9;]*m/g, '');
  const m = s.split('\n').filter((l) => /^\s*(?:ok|OK|not ok|PASS|FAIL|REFUSE|\u2713|\u2717)\b/.test(l));
  return m.length;
}

/* `1/30`, `0.033` or nothing. A rate this tool cannot read is `null`, never a default — §∅. */
export function parseRate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const v = frac ? Number(frac[1]) / Number(frac[2]) : Number(s);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
}

/* The legs a rate `p` needs before agreement MEANS anything at confidence `conf`:
   the smallest n with 1 - (1-p)^n >= conf. At one event in 30 legs and 95 %, that is 89 — and 88 legs
   reach 94.94 %, which is the arithmetic my own claim for this unit got wrong. */
export function powerFloor(p, conf) {
  if (!(Number.isFinite(p) && p > 0 && p < 1)) throw new Error('powerFloor needs a rate in (0,1)');
  if (!(Number.isFinite(conf) && conf > 0 && conf < 1)) throw new Error('powerFloor needs a confidence in (0,1)');
  return Math.ceil(Math.log(1 - conf) / Math.log(1 - p));
}

/* The selector, built once and carried into every leg. Two kinds only, and each one brings its own
   population reader — see the header. */
export function parseSelector(args) {
  const list = Array.isArray(args) ? args : [];
  const ci = list.indexOf('--cmd');
  if (ci >= 0) {
    const dash = list.indexOf('--', ci);
    const rest = dash >= 0 ? list.slice(dash + 1) : [];
    if (!rest.length) {
      return { ok: false, reason: '--cmd needs its command after a `--` terminator, so no shell quoting can reach it' };
    }
    return { ok: true, kind: 'cmd', exe: rest[0], args: rest.slice(1), label: rest.join(' '), countsGroups: false };
  }
  const gi = list.indexOf('--group');
  const group = gi >= 0 && list[gi + 1] && !list[gi + 1].startsWith('--') ? list[gi + 1] : null;
  if (!group) return { ok: false, reason: 'neither --group <pattern> nor --cmd -- <argv> was given' };
  return {
    ok: true,
    kind: 'group',
    exe: process.execPath,
    args: ['tests/run-tests.mjs', `--group=${group}`],
    label: `--group=${group}`,
    group,
    countsGroups: true
  };
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
export function runLeg({ selector, group, tree, boundMs, impl, legNo, volatile }) {
  const sel = selector || parseSelector(['--group', group]);
  if (!sel.ok) return { ok: false, reason: sel.reason, groups: null, hash: null, text: null };
  const got = boundedChild(sel.exe, sel.args, {
    ms: boundMs,
    label: `leg ${legNo} of "${sel.label}"`,
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
  const norm = normalize(text, volatile);
  /* A declared pattern that swallows the whole result set makes every leg agree about nothing — the
     same vacuous pass as a selector that matched no group, reached from the other side.
     🔴 THE FIRST VERSION OF THIS GUARD COULD NOT FIRE. It tested `norm === ''`, and a substitution
     WRITES its placeholder, so the text is never empty however greedy the pattern is. The reachable
     test is whether anything of the run SURVIVES the placeholders. */
  const survives = norm.replace(/<volatile>/g, '').replace(/[\s\n]/g, '');
  if (norm === '' || survives === '') {
    return { ok: false, reason: 'the declared volatile pattern(s) swallowed the whole result set, so nothing of the run survived to compare', groups: null, hash: null, text: null };
  }
  return {
    ok: true,
    reason: null,
    status: got.ok ? 0 : got.status,
    /* ONE field, two readers. The runner prints its group count; an arbitrary command prints its own
       result lines. Neither is ever inferred from the other. */
    groups: sel.countsGroups ? groupsSelected(text) : unitsCounted(text),
    hash: createHash('sha256').update(norm).digest('hex').slice(0, 12),
    text: norm
  };
}

export function judge(legs, requested, opts) {
  const { floor = null, minUnits = null, rate = null, confidence = null } = opts || {};
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
  if (minUnits !== null) {
    const thin = read.find((l) => Number(l.groups) < minUnits);
    if (thin) {
      return {
        ...base,
        status: 'NOT_RUN',
        reason: `a leg reported ${thin.groups} countable unit(s) against the declared floor of ${minUnits}, so the legs agreed about less than the caller asked to examine`
      };
    }
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
  if (hashes.length === 1 && statuses.length === 1) {
    /* 🔴 AGREEMENT IS NOT A READING UNTIL IT HAD THE LEGS TO DISAGREE IN. Only a would-be PASS is
       downgraded: a FAIL below the floor already saw the event. */
    if (floor !== null && read.length < floor) {
      return {
        ...base,
        status: 'UNDERPOWERED',
        result: { ...result, powerFloor: floor, rate, confidence },
        reason: `${read.length} agreeing leg(s) against a floor of ${floor}: at a pre-stated rate of ${rate} and ${confidence} confidence, this many legs agree by chance`
      };
    }
    return { ...base, status: 'PASS', result: floor === null ? result : { ...result, powerFloor: floor, rate, confidence } };
  }
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

export function verdictOf({ status, population, result, reason, group, selector, legs, volatile }) {
  const label = selector || (group ? `--group=${group}` : 'unknown selector');
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
    evidence: ['tools/suite-determinism.mjs', 'tools/child-bound.mjs', `selector:${label}`, ...(volatile || []).map((r) => `volatile:${r}`)],
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
  const selector = parseSelector(argv);
  if (!selector.ok) {
    process.stderr.write(`suite-determinism: ${selector.reason}\n`);
    process.stderr.write('usage: node tools/suite-determinism.mjs (--group <pattern> | --cmd -- <argv>...) [--legs N]\n');
    process.stderr.write('       [--rate 1/30] [--confidence 0.95] [--min-units N] [--tree <path>] [--bound-ms N] [--json]\n');
    return 2;
  }
  const legsWanted = Math.max(1, Number(opt('--legs', '3')));
  const tree = opt('--tree', ROOT);
  const boundMs = Number(opt('--bound-ms', '900000'));
  const asJson = has('--json');
  const say = asJson ? (s) => process.stderr.write(s + '\n') : (s) => process.stdout.write(s + '\n');
  /* The rate and the confidence are the CALLER's, pre-stated on the command line, and a rate this tool
     cannot read is absent rather than assumed — so no floor binds and the reason says nothing about one. */
  const rate = parseRate(opt('--rate', null));
  const confidence = rate === null ? null : Number(opt('--confidence', '0.95'));
  const floor = rate === null ? null : powerFloor(rate, confidence);
  /* Repeatable. Each one is a regex source, and all of them reach the verdict's evidence. */
  const volatile = argv.reduce((acc, a, i) => (a === '--volatile' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
  const minUnitsRaw = opt('--min-units', null);
  const minUnits = minUnitsRaw === null ? null : Math.max(0, Number(minUnitsRaw));
  if (floor !== null) say(`▸ power floor ${floor} leg(s) at a pre-stated rate of ${rate.toFixed(4)} and ${confidence} confidence`);

  const legs = [];
  for (let i = 1; i <= legsWanted; i++) {
    const t0 = Date.now();
    const leg = runLeg({ selector, tree, boundMs, legNo: i, volatile });
    legs.push(leg);
    say(`  leg ${i}/${legsWanted}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${leg.ok ? `units=${leg.groups} status=${leg.status} hash=${leg.hash}` : `UNREADABLE — ${leg.reason}`}`);
  }
  const j = judge(legs, legsWanted, { floor, minUnits, rate, confidence });
  const v = verdictOf({ ...j, selector: selector.label, legs: legsWanted, volatile });
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

  /* ── the power floor ──────────────────────────────────────────────────────────────────────── */
  /* 🔴 89, NOT 88. The claim for this unit pre-stated 88 and the arithmetic says otherwise: 88 legs
     reach 94.94 % and miss the stated confidence. The leg was right and my number was wrong. */
  ok('powerFloor names 89 legs for one event in 30 at 95 %', powerFloor(1 / 30, 0.95) === 89, `${powerFloor(1 / 30, 0.95)}`);
  ok('…and 5 legs for a coin flip', powerFloor(0.5, 0.95) === 5, `${powerFloor(0.5, 0.95)}`);
  ok(
    '…and it REFUSES a rate of 0, which would need infinite legs',
    (() => {
      try {
        powerFloor(0, 0.95);
        return false;
      } catch (e) {
        return /rate in \(0,1\)/.test(e.message);
      }
    })()
  );
  ok(
    '…and REFUSES a confidence of 1, by name',
    (() => {
      try {
        powerFloor(0.1, 1);
        return false;
      } catch (e) {
        return /confidence in \(0,1\)/.test(e.message);
      }
    })()
  );
  ok('parseRate reads a fraction and a decimal', Math.abs(parseRate('1/30') - 1 / 30) < 1e-12 && parseRate('0.05') === 0.05);
  ok('…and an unreadable rate is null, never a default', parseRate('sometimes') === null && parseRate(null) === null && parseRate('1') === null);

  const agree = (n) => Array.from({ length: n }, (_, i) => ({ ok: true, status: 0, groups: 40, hash: 'aaaaaaaaaaaa', text: `x\n${i}`.replace(/\n\d+/, '') }));
  const floored = judge(agree(3), 3, { floor: 89, rate: 1 / 30, confidence: 0.95 });
  ok('3 agreeing legs under a floor of 89 read UNDERPOWERED', floored.status === 'UNDERPOWERED', floored.status);
  ok('…and the reason names BOTH numbers', /\b3 agreeing leg\(s\) against a floor of 89\b/.test(floored.reason || ''), (floored.reason || '').slice(0, 80));
  ok('…and the result carries the floor it was judged against', floored.result && floored.result.powerFloor === 89);
  const powered = judge(agree(89), 89, { floor: 89, rate: 1 / 30, confidence: 0.95 });
  ok('89 agreeing legs at the floor read PASS', powered.status === 'PASS', powered.status);
  const disagree = [
    { ok: true, status: 0, groups: 40, hash: 'aaaaaaaaaaaa', text: 'ok one\nok two' },
    { ok: true, status: 1, groups: 40, hash: 'bbbbbbbbbbbb', text: 'ok one\nFAIL two' }
  ];
  const notDowngraded = judge(disagree, 2, { floor: 89, rate: 1 / 30, confidence: 0.95 });
  ok('a DISAGREEMENT under the floor stays FAIL — it already saw the event', notDowngraded.status === 'FAIL', notDowngraded.status);
  ok('…and no floor at all leaves a PASS untouched', judge(agree(2), 2).status === 'PASS');

  /* ── the population of a command this tool does not know ──────────────────────────────────── */
  ok(
    'unitsCounted counts a test file result lines',
    unitsCounted('  ok    first leg   3 of 3\nnot ok  second\nPASS — done\nsome prose') === 3,
    `${unitsCounted('  ok    first leg   3 of 3\nnot ok  second\nPASS — done\nsome prose')}`
  );
  ok("…and reads 0 over prose, which is why --min-units is the CALLER's", unitsCounted('this ran nothing at all\nand said so') === 0);
  const thin = judge(
    [
      { ok: true, status: 0, groups: 2, hash: 'aaaaaaaaaaaa', text: 'ok a' },
      { ok: true, status: 0, groups: 2, hash: 'aaaaaaaaaaaa', text: 'ok a' }
    ],
    2,
    { minUnits: 30 }
  );
  ok('a leg below --min-units reads NOT_RUN', thin.status === 'NOT_RUN', thin.status);
  ok('…and the reason names the reported count and the declared floor', /2 countable unit\(s\) against the declared floor of 30/.test(thin.reason || ''), (thin.reason || '').slice(0, 90));

  /* ── the selector ─────────────────────────────────────────────────────────────────────────── */
  const selCmd = parseSelector(['--legs', '4', '--cmd', '--', 'bash', 'x.sh', '--flag']);
  ok('parseSelector builds a cmd selector from the argv after `--`', selCmd.ok && selCmd.kind === 'cmd' && selCmd.exe === 'bash' && selCmd.args.join(' ') === 'x.sh --flag');
  ok('…and a cmd selector brings NO group reader', selCmd.countsGroups === false);
  const selBad = parseSelector(['--cmd']);
  ok('…and --cmd with no argv REFUSES, naming the terminator', !selBad.ok && /`--` terminator/.test(selBad.reason));
  const selGroup = parseSelector(['--group', 'ppgdex-dsp']);
  ok('parseSelector still builds the group selector', selGroup.ok && selGroup.kind === 'group' && selGroup.countsGroups === true && selGroup.args[1] === '--group=ppgdex-dsp');
  ok('…and neither flag REFUSES, naming both', !parseSelector([]).ok && /--group/.test(parseSelector([]).reason) && /--cmd/.test(parseSelector([]).reason));
  const vSel = verdictOf({ status: 'PASS', population: { checked: 2, eligible: 2, excluded: 0 }, result: { legs: 2 }, reason: null, selector: 'bash x.sh', legs: 2 });
  ok('the verdict names the SELECTOR it ran, not a group it did not', vSel.evidence.includes('selector:bash x.sh'));

  /* ── the caller-declared volatile token ───────────────────────────────────────────────────── */
  const nonceA = '  ok    fixture: the stub shadows the real sort   /tmp/tmp.Hu2Jq29qni/blindbin/sort\n  ok    second leg  3 of 3';
  const nonceB = '  ok    fixture: the stub shadows the real sort   /tmp/tmp.C3h0SR8wQn/blindbin/sort\n  ok    second leg  3 of 3';
  const NONCE = '/tmp/tmp\\.[A-Za-z0-9]+';
  ok('CONTROL · with NO pattern the two legs differ, which is the measured 89 of 89', normalize(nonceA) !== normalize(nonceB));
  ok('…and the declared pattern makes them one result set', normalize(nonceA, [NONCE]) === normalize(nonceB, [NONCE]));
  const nonceC = nonceB.replace('second leg  3 of 3', 'second leg  2 of 3');
  ok('…and it does NOT hide a real difference beside the nonce', normalize(nonceA, [NONCE]) !== normalize(nonceC, [NONCE]), 'the assertion count survives');
  const eraseSel = parseSelector(['--cmd', '--', process.execPath, '-e', 'console.log("  ok    a leg")']);
  const erased = runLeg({ selector: eraseSel, tree: ROOT, boundMs: 20000, legNo: 1, volatile: ['[\\s\\S]'] });
  ok('a pattern that SWALLOWS the result set is refused, not passed', !erased.ok && /swallowed the whole result set/.test(erased.reason), erased.ok ? `hash=${erased.hash}` : erased.reason);
  ok(
    'CONTROL · and a pattern that leaves one token behind is still read',
    (() => {
      const kept = runLeg({ selector: eraseSel, tree: ROOT, boundMs: 20000, legNo: 1, volatile: ['ok'] });
      return kept.ok && kept.hash !== null;
    })(),
    'the guard refuses total loss and nothing less'
  );
  const vVol = verdictOf({ status: 'PASS', population: { checked: 2, eligible: 2, excluded: 0 }, result: { legs: 2 }, reason: null, selector: 'bash x.sh', legs: 2, volatile: [NONCE] });
  ok('…and every declared pattern reaches the verdict evidence', vVol.evidence.includes(`volatile:${NONCE}`));

  /* ── a REAL child, because an injected one proves the reader and not the capture ─────────── */
  const realSel = parseSelector(['--cmd', '--', process.execPath, '-e', 'console.log("  ok    a leg  1 of 1");console.log("PASS — done")']);
  const realLeg = runLeg({ selector: realSel, tree: ROOT, boundMs: 20000, legNo: 1 });
  ok('a REAL child leg reads its own result lines', realLeg.ok && realLeg.groups === 2, realLeg.ok ? `units=${realLeg.groups}` : realLeg.reason);
  const realFailSel = parseSelector(['--cmd', '--', process.execPath, '-e', 'console.log("  ok    a leg");process.exit(7)']);
  const realFailLeg = runLeg({ selector: realFailSel, tree: ROOT, boundMs: 20000, legNo: 1 });
  ok(
    'a REAL failing child is still a result set, through `partial`',
    realFailLeg.ok && realFailLeg.status === 7 && realFailLeg.groups === 1,
    realFailLeg.ok ? `status=${realFailLeg.status} units=${realFailLeg.groups}` : realFailLeg.reason
  );

  process.stdout.write(fail === 0 ? `\n✓ all ${pass} selftests passed\n` : `\n✗ ${fail} of ${pass + fail} selftests FAILED\n`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('suite-determinism.mjs')) {
  process.exit(has('--selftest') ? selftest() : main());
}
