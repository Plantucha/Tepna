/*
 * tools/trio-eligible-nights.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE TRIO-ELIGIBLE NIGHT POPULATION, PRODUCED FROM THE COMMITTED TREE.
 *
 * `analysis/tri_device_nights.json` sourced CLAUDE.md's headline trio figure and nothing in the tree
 * wrote it: 20 night names and `count: 20`, no criterion, no population block, no producer, one commit
 * (`e518581530`, 2026-07-06, the squashed suite import). The sourced-claim resolver walks the pointer
 * and requires a number, so a green gate proved that the prose copies the artifact and said nothing
 * about whether the artifact matches the corpus. It did not: the committed folds carry 17 three-node
 * nights inside the claimed 2026-06-10 → 2026-07-05 window, four claimed nights fold two devices, and
 * 2026-07-04 folds three ways and is absent from the list (row
 * `2026-10-25-the-trio-eligible-claim-resolves-to-an-unproduced-list`).
 *
 * This tool is that artifact's producer. It writes the night NAMES beside the criterion that selects
 * them, so the published count is read off a list a reader can open rather than re-typed.
 *
 * TWO INSTRUMENTS, HELD EQUAL.
 *   fold   each night's own `.trio-stamp`, written by `tools/trio-batch.mjs` for a night its planner
 *          ACCEPTED (three-way nocturnal overlap ≥ 1 h). The stamp names the nodes it folded.
 *   tree   the three trio node-exports actually tracked in that night's folder.
 * A night counts only when both say yes, and a night where they DISAGREE reds this tool: the fold's
 * record of what it accepted and the tree's content are the same fact published twice, and a published
 * count over two instruments that drifted is the shape this artifact already shipped once.
 *
 * THE POPULATION IS THE TRACKED TREE. `git ls-files` is the authority, so an untracked local night
 * cannot move a published figure, and a clean clone and CI measure the same corpus.
 *
 * `PpgDexFinger_<night>.node-export.json` is NOT the PpgDex leg — 74 nights carry one and the stamps
 * never name it. Node names are matched whole for that reason.
 *
 * Usage
 *   node tools/trio-eligible-nights.mjs             write analysis/tri_device_nights.json
 *   node tools/trio-eligible-nights.mjs --check     recompute and compare, exit 1 on drift
 *   node tools/trio-eligible-nights.mjs --json      print the tepna.verdict/1 object, write nothing
 *   node tools/trio-eligible-nights.mjs --selftest  known answers over synthetic path lists, no I/O
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'analysis/tri_device_nights.json';
const CORPUS_REL = 'uploads/trio';
const Verdict = createRequire(import.meta.url)('../verdict.js');

/* The three legs of the trio. The stamp names exactly these on all 90 stamped nights. */
export const TRIO_NODES = ['ECGDex', 'OxyDex', 'PpgDex'];

/* The window the CLAIM is about, from CLAUDE.md §🎙️ — the tri-device capture run. The corpus holds
   nights on both sides of it (147 folders in all), so the window is part of the criterion, not a view. */
export const WINDOW = { from: '2026-06-10', to: '2026-07-05' };

const NIGHT_PATH = /^uploads\/trio\/(\d{4}-\d{2}-\d{2})\/(.+)$/;
const EXPORT_NAME = /^([A-Za-z]+)_(\d{4}-\d{2}-\d{2})\.node-export\.json$/;

const inWindow = (night) => night >= WINDOW.from && night <= WINDOW.to;

/* PURE. `paths` is a tracked-path list; `stamps` maps a night to its parsed `.trio-stamp` (or null).
   Every rejection is counted and named, because a population that only reports its accepted members
   cannot be audited against the tree it came from. */
export function classify(paths, stamps = {}) {
  const per = new Map();
  const misdated = [];
  const night = (n) => {
    if (!per.has(n)) per.set(n, { night: n, nodes: [], stamped: false });
    return per.get(n);
  };
  for (const p of paths || []) {
    const m = NIGHT_PATH.exec(p);
    if (!m) continue;
    const rec = night(m[1]);
    if (m[2] === '.trio-stamp') {
      rec.stamped = true;
      continue;
    }
    const e = EXPORT_NAME.exec(m[2]);
    if (!e) continue;
    /* A node-export whose own name dates it to another night is not evidence about this one. */
    if (e[2] !== m[1]) {
      misdated.push(p);
      continue;
    }
    if (TRIO_NODES.indexOf(e[1]) >= 0 && rec.nodes.indexOf(e[1]) < 0) rec.nodes.push(e[1]);
  }
  const nights = [...per.values()].sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : 0));
  const out = [];
  for (const rec of nights) {
    const st = stamps[rec.night] || null;
    const stampNodes = st && Array.isArray(st.nodes) ? st.nodes.slice() : null;
    const fold = rec.stamped && !!stampNodes && TRIO_NODES.every((n) => stampNodes.indexOf(n) >= 0);
    const tree = TRIO_NODES.every((n) => rec.nodes.indexOf(n) >= 0);
    out.push({ night: rec.night, fold, tree, accepted: fold && tree, nodes: rec.nodes.slice().sort(), stampNodes });
  }
  const accepted = out.filter((r) => r.accepted).map((r) => r.night);
  return {
    nights: out,
    accepted,
    rejected: out.length - accepted.length,
    disagreements: out.filter((r) => r.fold !== r.tree).map((r) => ({ night: r.night, fold: r.fold, tree: r.tree, nodes: r.nodes })),
    misdated,
    window: accepted.filter(inWindow)
  };
}

/* PURE. The verdict object, from a classification plus the two volatile fields. */
export function verdictFor(c, { commit = null, at = new Date().toISOString() } = {}) {
  const bad = c.disagreements.length + c.misdated.length;
  const reason = c.disagreements.length
    ? `${c.disagreements.length} night(s) where the fold stamp and the tracked exports disagree: ` + c.disagreements.map((d) => `${d.night} (fold ${d.fold}, tree ${d.tree})`).join(', ')
    : c.misdated.length
      ? `${c.misdated.length} node-export(s) dated to another night: ${c.misdated.join(', ')}`
      : null;
  return {
    schema: 'tepna.verdict/1',
    gate: 'trio-eligible-nights',
    status: bad ? 'FAIL' : 'PASS',
    scope: 'internal',
    population: { checked: c.nights.length, eligible: c.nights.length, excluded: 0 },
    criterion: { name: 'trio_fold_accepted_nodes', threshold: TRIO_NODES.length, unit: 'node-exports', direction: 'gte' },
    result: {
      accepted: c.accepted.length,
      rejected: c.rejected,
      window: { from: WINDOW.from, to: WINDOW.to, count: c.window.length, nights: c.window.slice() },
      corpus: { count: c.accepted.length, nights: c.accepted.slice() },
      disagreements: c.disagreements,
      misdated: c.misdated.slice()
    },
    evidence: ['tools/trio-eligible-nights.mjs', 'uploads/trio/<night>/.trio-stamp', 'uploads/trio/<night>/{ECGDex,OxyDex,PpgDex}_<night>.node-export.json'],
    reason,
    producedBy: { tool: 'tools/trio-eligible-nights.mjs', commit, ...(commit ? {} : { commitReason: 'not run inside a git tree' }) },
    at
  };
}

/* The volatile fields, dropped — what `--check` compares and what a reviewer diffs. */
export const stableText = (v) => JSON.stringify({ ...v, at: null, producedBy: null }, null, 2);

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z', '--', CORPUS_REL], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function readStamps(paths) {
  const out = {};
  for (const p of paths) {
    const m = NIGHT_PATH.exec(p);
    if (!m || m[2] !== '.trio-stamp') continue;
    try {
      out[m[1]] = JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
    } catch (_e) {
      /* unparseable ⇒ the fold instrument says no for that night, and the disagreement reds */
      out[m[1]] = {};
    }
  }
  return out;
}

function headCommit() {
  try {
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch (_e) {
    return null;
  }
}

function build() {
  const paths = tracked();
  const c = classify(paths, readStamps(paths));
  const v = verdictFor(c, { commit: headCommit() });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`trio-eligible-nights: the verdict is invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return { c, v };
}

function selftest() {
  let fails = 0;
  let legs = 0;
  const ok = (what, got, want) => {
    legs += 1;
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) console.log(`  ok   ${what}`);
    else {
      fails += 1;
      console.log(`  FAIL ${what}\n       got  ${g}\n       want ${w}`);
    }
  };
  const three = (n) => [
    `uploads/trio/${n}/.trio-stamp`,
    `uploads/trio/${n}/ECGDex_${n}.node-export.json`,
    `uploads/trio/${n}/OxyDex_${n}.node-export.json`,
    `uploads/trio/${n}/PpgDex_${n}.node-export.json`
  ];
  const S = (n) => ({ [n]: { nodes: TRIO_NODES.slice() } });

  let c = classify(three('2026-06-10'), S('2026-06-10'));
  ok('a stamped three-export night is accepted', c.accepted, ['2026-06-10']);
  ok('…and lands in the window', c.window, ['2026-06-10']);
  ok('…with no disagreement', c.disagreements.length, 0);

  /* THE TRAP: a fourth node whose name STARTS with a trio node name. */
  c = classify(
    [
      `uploads/trio/2026-07-17/.trio-stamp`,
      `uploads/trio/2026-07-17/ECGDex_2026-07-17.node-export.json`,
      `uploads/trio/2026-07-17/OxyDex_2026-07-17.node-export.json`,
      `uploads/trio/2026-07-17/PpgDexFinger_2026-07-17.node-export.json`
    ],
    S('2026-07-17')
  );
  ok('PpgDexFinger is not the PpgDex leg', c.accepted, []);
  ok('…and the stamp-vs-tree split is a DISAGREEMENT, not a quiet rejection', c.disagreements.length, 1);

  c = classify(
    three('2026-06-13').filter((p) => !/ECGDex/.test(p)),
    S('2026-06-13')
  );
  ok('a two-device night is rejected', c.accepted, []);
  ok(
    '…and reds as a disagreement (the fold claims three)',
    c.disagreements.map((d) => d.night),
    ['2026-06-13']
  );

  c = classify(
    three('2026-07-04').filter((p) => !/\.trio-stamp$/.test(p)),
    {}
  );
  ok('an unstamped three-export night is rejected', c.accepted, []);
  ok('…and reds as a disagreement (the tree carries three, the fold never judged it)', c.disagreements.length, 1);

  c = classify(three('2026-06-11').concat([`uploads/trio/2026-06-11/PpgDex_2026-06-12.node-export.json`]), S('2026-06-11'));
  ok('an export dated to another night is counted as misdated', c.misdated, ['uploads/trio/2026-06-11/PpgDex_2026-06-12.node-export.json']);
  ok('…and does not disturb the night it sits in', c.accepted, ['2026-06-11']);

  c = classify(three('2026-07-19'), S('2026-07-19'));
  ok('a night outside the window counts in the corpus only', [c.accepted.length, c.window.length], [1, 0]);

  const vOk = verdictFor(classify(three('2026-06-10'), S('2026-06-10')), { commit: 'deadbeef', at: '2026-01-01T00:00:00Z' });
  ok('a clean population is PASS with a null reason', [vOk.status, vOk.reason], ['PASS', null]);
  ok('the window count equals the window list length', vOk.result.window.count, vOk.result.window.nights.length);
  ok('checked + excluded = eligible', vOk.population.checked + vOk.population.excluded, vOk.population.eligible);
  ok('the verdict validates under verdict.js', Verdict.validate(vOk).ok, true);

  const vBad = verdictFor(
    classify(
      three('2026-06-13').filter((p) => !/ECGDex/.test(p)),
      S('2026-06-13')
    ),
    { commit: 'deadbeef', at: '2026-01-01T00:00:00Z' }
  );
  ok('a disagreement is FAIL', vBad.status, 'FAIL');
  ok('…and carries a reason naming the night', /2026-06-13/.test(String(vBad.reason)), true);
  ok('…and still validates (a FAIL is a verdict, not an error)', Verdict.validate(vBad).ok, true);

  ok('the volatile fields are dropped from the compared text', /"at": null/.test(stableText(vOk)), true);

  console.log(fails ? `\ntrio-eligible-nights --selftest: ${fails} FAILED of ${legs}` : `\ntrio-eligible-nights --selftest: all ${legs} selftests passed`);
  return fails === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(7, 41)
        .join('\n')
    );
    return 0;
  }
  if (args.includes('--selftest')) return selftest() ? 0 : 1;

  const { c, v } = build();
  const abs = join(ROOT, OUT_REL);
  const summary =
    `${v.status} — ${v.result.corpus.count} of ${v.population.checked} tracked night folder(s) are trio-eligible; ` +
    `${v.result.window.count} inside ${WINDOW.from} → ${WINDOW.to}` +
    (v.reason ? `\n  reason: ${v.reason}` : '');

  if (args.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    return v.status === 'PASS' ? 0 : 1;
  }
  if (args.includes('--check')) {
    if (!existsSync(abs)) {
      console.error(`trio-eligible-nights --check: ${OUT_REL} is absent — run the tool with no flags and commit it`);
      return 1;
    }
    let have = null;
    try {
      have = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      console.error(`trio-eligible-nights --check: ${OUT_REL} does not parse — ${e.message}`);
      return 1;
    }
    if (stableText(have) !== stableText(v)) {
      console.error(`trio-eligible-nights --check: ${OUT_REL} is STALE against the tracked corpus — re-run the tool with no flags and commit it`);
      console.error(`  committed: ${JSON.stringify(have.result && have.result.window)}`);
      console.error(`  measured:  ${JSON.stringify(v.result.window)}`);
      return 1;
    }
    console.log(`✓ ${OUT_REL} is current against the tracked corpus — ${summary}`);
    return v.status === 'PASS' ? 0 : 1;
  }
  writeFileSync(abs, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
  console.log(`wrote ${OUT_REL} — ${summary}`);
  if (c.misdated.length) console.log(`  misdated export(s): ${c.misdated.join(', ')}`);
  return v.status === 'PASS' ? 0 : 1;
}

/* THE CLI RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT. `tests/run-tests.mjs` imports the classifier
   to hold the committed artifact against the tracked tree, and a CLI at module scope would exit the
   suite instead (row `2026-10-21-selftest-all-runs-its-cli-at-module-scope`). The one sanctioned
   spelling is `isCliEntry`, because comparing `process.argv[1]` with this module by hand answers
   wrongly through a symlink; a suite leg reds every other spelling. */
if (isCliEntry(import.meta.url)) process.exit(main());
