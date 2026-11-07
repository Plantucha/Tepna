/*
 * required-contexts.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE REQUIRED-CONTEXT SET IS RECORDED TWICE IN THIS TREE, AND NOTHING COMPARED THE TWO COPIES.
 *
 * Residue `2026-11-06-the-required-context-set-reads-eleven-where-a-row-records-nine`. Ruleset
 * `protect-main` (18794443) names the contexts that hold a merge. Two files in this tree carry that
 * set:
 *
 *   • `tools/pr-walker.mjs`                      — `FALLBACK_REQUIRED`, the walker's degraded-path mirror
 *   • `capture-host/tests/test_check_script.py`  — `REQUIRED_CONTEXTS`, a dated reading
 *
 * WHAT ALREADY WORKS, AND MUST NOT BE RE-BUILT: the walker reads the live ruleset on every pass
 * (about every 90 s) and `fallbackDrift` prints a DRIFT line when its own mirror lags. Measured
 * 2026-11-07: the journal carries `required set: ruleset(11)` on every pass and zero DRIFT lines,
 * because that mirror currently agrees. So the row's words "no instrument re-reads the ruleset" are
 * REFUTED for the JS copy.
 *
 * WHAT HAS NO READER AT ALL:
 *   1. The Python constant. Nothing compares it to the ruleset or to the JS mirror.
 *   2. The two copies against EACH OTHER. The walker's drift line reads live-vs-JS only, so a JS
 *      copy updated with the Python one left behind keeps that drift line silent.
 *
 * SO THE COMPARISON THIS GATE MAKES NEEDS NO TOKEN, which is the whole point: CI holds no credential
 * for that ruleset, and a gate that can only run on one laptop is a gate that does not run. The
 * live read is a SEPARATE, OPTIONAL leg (`--live`), and with no token it reports NOT_RUN. It never
 * reports PASS about a ruleset it could not reach.
 *
 * ANTI-VACUITY, which is the defect this file is most likely to grow: two regexes that both match
 * nothing produce two empty sets, and two empty sets are EQUAL. A copy that parses to zero contexts
 * is therefore EXCLUDED, never compared, and the gate exits 2 — it could not look — rather than
 * printing a PASS about a file it never read.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The ruleset that holds a merge. The id is the owner's; this gate only READS it. */
export const RULESET_ID = '18794443';

/* The two recorded copies. A third copy added later belongs here, or this gate stops covering it. */
export const COPIES = [
  {
    name: 'walker-mirror',
    file: 'tools/pr-walker.mjs',
    symbol: 'FALLBACK_REQUIRED',
    parse: parseJsMirror
  },
  {
    name: 'capture-host-constant',
    file: 'capture-host/tests/test_check_script.py',
    symbol: 'REQUIRED_CONTEXTS',
    parse: parsePyConstant
  }
];

/* `export const FALLBACK_REQUIRED = [ '…', '…' ];` — read as TEXT, never imported. An import would
   run the walker module, and a gate must not start the thing it judges. */
export function parseJsMirror(text) {
  const m = /export const FALLBACK_REQUIRED\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
}

/* `REQUIRED_CONTEXTS = frozenset( { "…", "…" } )`. */
export function parsePyConstant(text) {
  const m = /REQUIRED_CONTEXTS\s*=\s*frozenset\(([\s\S]*?)\n\)/.exec(text);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] ?? x[2]);
}

/* Read every copy. A copy whose symbol is absent, or whose parse yields nothing, is EXCLUDED and
   carries its own reason — it is never a copy that agreed. */
export function readCopies(copies = COPIES, root = ROOT, readFile = (p) => fs.readFileSync(path.join(root, p), 'utf8')) {
  return copies.map((c) => {
    let text;
    try {
      text = readFile(c.file);
    } catch (e) {
      return { ...c, contexts: null, excluded: `unreadable: ${e.code || e.message}` };
    }
    const got = c.parse(text);
    if (got === null) return { ...c, contexts: null, excluded: `${c.symbol} not found in ${c.file}` };
    if (got.length === 0) return { ...c, contexts: null, excluded: `${c.symbol} parsed to an EMPTY set — two empty sets would compare equal` };
    return { ...c, contexts: [...new Set(got)].sort(), excluded: null };
  });
}

/* Every copy against every other, by name. Counts and context names only. */
export function compare(read) {
  const kept = read.filter((r) => !r.excluded);
  const pairs = [];
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i];
      const b = kept[j];
      const sa = new Set(a.contexts);
      const sb = new Set(b.contexts);
      const onlyA = a.contexts.filter((c) => !sb.has(c));
      const onlyB = b.contexts.filter((c) => !sa.has(c));
      pairs.push({ a: a.name, b: b.name, onlyA, onlyB, agree: onlyA.length === 0 && onlyB.length === 0 });
    }
  }
  return pairs;
}

/* The OPTIONAL live leg. No `gh`, no auth, no network → NOT_RUN with the reason, never PASS. */
export function readLive(run = defaultGh) {
  let out;
  try {
    out = run();
  } catch (e) {
    const why = (e.stderr && String(e.stderr).trim().split('\n')[0]) || e.message || String(e.code);
    return { status: 'NOT_RUN', contexts: null, reason: `the ruleset read failed: ${why}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return { status: 'NOT_RUN', contexts: null, reason: 'the ruleset read returned no JSON' };
  }
  const ctx = [];
  for (const rule of parsed.rules || []) {
    if (rule.type !== 'required_status_checks') continue;
    for (const c of rule.parameters?.required_status_checks || []) if (c.context) ctx.push(c.context);
  }
  if (ctx.length === 0) return { status: 'NOT_RUN', contexts: null, reason: 'the ruleset named no required status check — a read that examined nothing' };
  return { status: 'READ', contexts: [...new Set(ctx)].sort(), reason: null };
}

function defaultGh() {
  return execFileSync('gh', ['api', `repos/{owner}/{repo}/rulesets/${RULESET_ID}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/* One verdict over the whole gate. */
export function evaluate({ read, live = null, at = new Date().toISOString(), commit = null }) {
  const eligible = read.length;
  const kept = read.filter((r) => !r.excluded);
  const checked = kept.length;
  const excluded = eligible - checked;
  const pairs = compare(read);
  const disagreeing = pairs.filter((p) => !p.agree);

  const livePairs = [];
  if (live && live.status === 'READ') {
    const sl = new Set(live.contexts);
    for (const c of kept) {
      const sc = new Set(c.contexts);
      const onlyLive = live.contexts.filter((x) => !sc.has(x));
      const onlyCopy = c.contexts.filter((x) => !sl.has(x));
      livePairs.push({ copy: c.name, onlyLive, onlyCopy, agree: onlyLive.length === 0 && onlyCopy.length === 0 });
    }
  }
  const liveDisagreeing = livePairs.filter((p) => !p.agree);

  let status;
  let reason = null;
  if (checked < 2) {
    status = 'NOT_RUN';
    reason = `fewer than two copies could be read, so no comparison ran: ${read
      .filter((r) => r.excluded)
      .map((r) => `${r.name} — ${r.excluded}`)
      .join(' · ')}`;
  } else if (disagreeing.length || liveDisagreeing.length) {
    status = 'FAIL';
    const parts = [];
    for (const p of disagreeing) parts.push(`${p.a} vs ${p.b}: only in ${p.a} ${p.onlyA.join(', ') || 'nothing'}; only in ${p.b} ${p.onlyB.join(', ') || 'nothing'}`);
    for (const p of liveDisagreeing)
      parts.push(`the live ruleset vs ${p.copy}: protection also requires ${p.onlyLive.join(', ') || 'nothing'}; the copy still names ${p.onlyCopy.join(', ') || 'nothing'}`);
    reason = parts.join(' · ');
  } else {
    status = 'PASS';
  }

  const verdict = {
    schema: 'tepna.verdict/1',
    gate: 'required-contexts',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'recorded_copies_disagree', threshold: 0, unit: 'contexts', direction: 'lte' },
    result: {
      copies: Object.fromEntries(read.map((r) => [r.name, r.excluded ? null : r.contexts.length])),
      excluded: read.filter((r) => r.excluded).map((r) => ({ copy: r.name, why: r.excluded })),
      pairsCompared: pairs.length,
      pairsDisagreeing: disagreeing.length,
      live: live ? live.status : 'NOT_REQUESTED',
      liveCount: live && live.contexts ? live.contexts.length : null,
      liveReason: live ? live.reason : null,
      livePairsDisagreeing: liveDisagreeing.length
    },
    evidence: ['tools/required-contexts.mjs', ...read.map((r) => r.file)],
    reason,
    producedBy: { tool: 'tools/required-contexts.mjs', commit },
    at
  };
  return { status, verdict, pairs, livePairs, read };
}

export function render(res) {
  const L = [];
  for (const r of res.read) {
    if (r.excluded) L.push(`  ⊘ ${r.name} (${r.file}) — ${r.excluded}`);
    else L.push(`  ✓ ${r.name} (${r.file}) — ${r.contexts.length} context(s)`);
  }
  for (const p of res.pairs) L.push(`  ${p.agree ? '✓' : '✕'} ${p.a} ≡ ${p.b}`);
  for (const p of res.livePairs) L.push(`  ${p.agree ? '✓' : '✕'} the live ruleset ≡ ${p.copy}`);
  const v = res.verdict;
  if (v.result.live === 'NOT_RUN') L.push(`  ⏱ the live ruleset was NOT read — ${v.result.liveReason}`);
  L.push('');
  L.push(`VERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  L.push(
    res.status === 'PASS'
      ? `✓ required-contexts — ${v.population.checked} recorded copy(ies) agree over ${v.result.pairsCompared} pair(s)`
      : res.status === 'NOT_RUN'
        ? `⏱ UNEXAMINED required-contexts — ${v.reason}`
        : `✕ required-contexts — ${v.reason}`
  );
  return L.join('\n');
}

function commitOf() {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────── */

export function selftest() {
  let ok = 0;
  let fail = 0;
  const t = (cond, what) => {
    if (cond) ok++;
    else {
      fail++;
      console.log(`  FAIL ${what}`);
    }
  };

  const jsSrc = "export const FALLBACK_REQUIRED = [\n  'biome',\n  'test',\n];";
  const pySrc = 'REQUIRED_CONTEXTS = frozenset(\n    {\n        "biome",\n        "test",\n    }\n)';

  t(parseJsMirror(jsSrc).join(',') === 'biome,test', 'the JS mirror parses to its own names');
  t(parsePyConstant(pySrc).join(',') === 'biome,test', 'the Python constant parses to its own names');
  t(parseJsMirror('nothing here') === null, 'an absent JS symbol parses to null, not to an empty set');
  t(parsePyConstant('nothing here') === null, 'an absent Python symbol parses to null, not to an empty set');

  const files = { 'js.mjs': jsSrc, 'py.py': pySrc };
  const copies = [
    { name: 'js', file: 'js.mjs', symbol: 'FALLBACK_REQUIRED', parse: parseJsMirror },
    { name: 'py', file: 'py.py', symbol: 'REQUIRED_CONTEXTS', parse: parsePyConstant }
  ];
  const rd = (p) => {
    if (!(p in files)) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    return files[p];
  };

  let res = evaluate({ read: readCopies(copies, '', rd) });
  t(res.status === 'PASS' && res.verdict.population.checked === 2, 'two agreeing copies PASS with both checked');

  files['py.py'] = 'REQUIRED_CONTEXTS = frozenset(\n    {\n        "biome",\n    }\n)';
  res = evaluate({ read: readCopies(copies, '', rd) });
  t(res.status === 'FAIL' && /only in js test/.test(res.verdict.reason), 'a copy that lags one context FAILs and names it');

  /* ANTI-VACUITY: the defect this gate exists to avoid in itself. */
  files['py.py'] = 'REQUIRED_CONTEXTS = frozenset(\n    {\n    }\n)';
  res = evaluate({ read: readCopies(copies, '', rd) });
  t(res.status === 'NOT_RUN' && res.verdict.population.checked === 1, 'a copy parsing to an EMPTY set is EXCLUDED, not an agreement');
  t(/EMPTY set/.test(res.verdict.reason), 'the NOT_RUN reason names the empty parse');

  files['js.mjs'] = 'export const FALLBACK_REQUIRED = [\n];';
  res = evaluate({ read: readCopies(copies, '', rd) });
  t(res.status === 'NOT_RUN' && res.verdict.population.checked === 0, 'two empty parses are NOT_RUN, never a PASS over nothing');

  files['js.mjs'] = jsSrc;
  files['py.py'] = pySrc;
  delete files['py.py'];
  res = evaluate({ read: readCopies(copies, '', rd) });
  t(res.status === 'NOT_RUN' && /unreadable/.test(res.verdict.reason), 'an unreadable copy is EXCLUDED with its own reason');

  files['py.py'] = pySrc;

  /* population identity: checked + excluded = eligible, every time. */
  for (const variant of [pySrc, 'REQUIRED_CONTEXTS = frozenset(\n    {\n    }\n)', 'nothing']) {
    files['py.py'] = variant;
    const r = evaluate({ read: readCopies(copies, '', rd) });
    const p = r.verdict.population;
    t(p.checked + p.excluded === p.eligible, `population identity holds for a ${variant.length}-byte copy`);
  }
  files['py.py'] = pySrc;

  /* the live leg never turns an unread ruleset into a PASS about it. */
  let live = readLive(() => {
    throw Object.assign(new Error('gh not found'), { code: 'ENOENT' });
  });
  t(live.status === 'NOT_RUN' && /failed/.test(live.reason), 'an absent gh makes the live leg NOT_RUN');
  live = readLive(() => '{"rules":[]}');
  t(live.status === 'NOT_RUN' && /examined nothing/.test(live.reason), 'a ruleset naming no check is NOT_RUN, not an empty agreement');
  live = readLive(() => 'not json');
  t(live.status === 'NOT_RUN' && /no JSON/.test(live.reason), 'a non-JSON read is NOT_RUN');
  live = readLive(() => JSON.stringify({ rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'biome' }, { context: 'test' }] } }] }));
  t(live.status === 'READ' && live.contexts.join(',') === 'biome,test', 'a real ruleset read yields its own contexts');

  res = evaluate({ read: readCopies(copies, '', rd), live });
  t(res.status === 'PASS' && res.verdict.result.live === 'READ', 'copies agreeing with a read ruleset PASS');

  live = readLive(() =>
    JSON.stringify({ rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'biome' }, { context: 'test' }, { context: 'secret-scan' }] } }] })
  );
  res = evaluate({ read: readCopies(copies, '', rd), live });
  t(res.status === 'FAIL' && /protection also requires secret-scan/.test(res.verdict.reason), 'a ruleset ahead of both copies FAILs and names the context');

  res = evaluate({ read: readCopies(copies, '', rd), live: { status: 'NOT_RUN', contexts: null, reason: 'no token' } });
  t(res.status === 'PASS' && res.verdict.result.live === 'NOT_RUN', 'an unread ruleset does not red the token-free comparison');

  /* the real tree: both copies must parse, or this gate covers nothing here. */
  const realRead = readCopies();
  t(
    realRead.every((r) => !r.excluded),
    'both recorded copies parse in this tree'
  );
  t(
    realRead.every((r) => r.contexts.length >= 2),
    'each recorded copy names at least two contexts'
  );

  console.log(`required-contexts selftest: ${ok} passed, ${fail} failed`);
  return fail === 0;
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

  if (argv.includes('--verdict-sample')) {
    const res = evaluate({ read: readCopies(), at: '2026-11-07T00:00:00Z', commit: commitOf() });
    console.log(JSON.stringify(res.verdict));
    process.exit(0);
  }

  const live = argv.includes('--live') ? readLive() : null;
  const res = evaluate({ read: readCopies(), live, commit: commitOf() });
  console.log(render(res));
  process.exit(res.status === 'PASS' ? 0 : res.status === 'NOT_RUN' ? 2 : 1);
}
