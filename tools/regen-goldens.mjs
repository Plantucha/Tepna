#!/usr/bin/env node
/*
 * tools/regen-goldens.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Unified entry for the per-node golden regenerators (CPAP-REAL-CORPUS-FOLLOWUPS-III §3). Dispatches
 * to the node's recipe (regen-<node>-goldens.mjs), which shares all scaffolding via regen-goldens-core.mjs.
 * The per-node names remain valid entry points (referenced by CLAUDE.md / docs); this is the one-command
 * front door that replaces "remember which node's tool is called what".
 *
 *   node tools/regen-goldens.mjs --node CPAPDex            # regenerate + re-record + report what moved
 *   node tools/regen-goldens.mjs --node GlucoDex --check   # report only, write nothing (CI-safe)
 *   node tools/regen-goldens.mjs --all --check             # every node, ONE combined summary
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { isCliEntry } from './argv-guard.mjs';

const NODES = {
  CPAPDex: './regen-cpap-goldens.mjs',
  GlucoDex: './regen-glucodex-goldens.mjs',
  PulseDex: './regen-pulsedex-goldens.mjs',
  MotionDex: './regen-motiondex-goldens.mjs',
  OxyDex: './regen-oxydex-goldens.mjs',
  PpgDex: './regen-ppgdex-goldens.mjs',
  HRVDex: './regen-hrvdex-goldens.mjs',
  ECGDex: './regen-ecgdex-goldens.mjs',
  // §F1.5 — the Integrator is a consumer-on-top rather than a node, which is why it was missed; but it
  // carries a code-gated fixture with a live equiv leg, so it needs a sanctioned regen path like any node.
  Integrator: './regen-integrator-goldens.mjs'
};

const i = process.argv.indexOf('--node');
const name = i !== -1 ? process.argv[i + 1] : null;
const ALL = process.argv.includes('--all');

/* ─── --selftest ────────────────────────────────────────────────────────────────────────────
   `regenExitCode` is a pure mapping over counts, which is the whole reason it was extracted: the
   branch that matters is the one nobody runs, and a regen over an absent corpus is exactly that.
   These legs pin the three outcomes — 0 only over a non-empty examined set, 1 for drift, 2 for a
   run that could not look — plus the coercion, because `isFinite(null)` is TRUE and a null count
   must read as zero rather than as a number. The count below is COMPUTED: a literal would satisfy
   `tools/selftest-all.mjs` in both directions. It writes nothing and runs before the dispatch. */
if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  const { regenExitCode, parseRegenSummary } = await import('./regen-goldens-core.mjs');
  let n = 0;
  const fail = [];
  const T = (label, cond) => {
    n += 1;
    if (!cond) fail.push(label);
  };
  const call = (o) => regenExitCode(o);

  // Regen mode never raises: it is there to WRITE, and it reports what it wrote in its own summary.
  T('regen mode over a clean set exits 0', call({ check: false, unchanged: 6 }).code === 0);
  T('regen mode over drift exits 0', call({ check: false, moved: 3, unchanged: 3 }).code === 0);
  T('regen mode over an absent corpus exits 0', call({ check: false, absent: 6 }).code === 0);
  T('regen mode carries no note', call({ check: false, absent: 6 }).note === null);

  // Check mode: 0 is reserved for a comparison that actually happened over every fixture.
  T('a clean examined set exits 0', call({ check: true, unchanged: 6 }).code === 0);
  T('a clean examined set carries no note', call({ check: true, unchanged: 6 }).note === null);
  T('a deliberate skip beside an examined set exits 0', call({ check: true, unchanged: 6, skipped: 2 }).code === 0);

  // Drift is the actionable finding and outranks a hole.
  T('a moved output exits 1', call({ check: true, moved: 1, unchanged: 5 }).code === 1);
  T('a minted output exits 1', call({ check: true, minted: 2, unchanged: 4 }).code === 1);
  T('drift outranks a hole', call({ check: true, moved: 1, absent: 3 }).code === 1);
  T('drift carries no UNEXAMINED note', call({ check: true, moved: 1, absent: 3 }).note === null);

  // Exit 2 — it could not look. This is the row the unit closes: an all-absent corpus exited 0.
  const abs = call({ check: true, absent: 6 });
  T('an all-absent corpus exits 2', abs.code === 2);
  T('the note names the absent inputs', /6 input absent/.test(abs.note || ''));
  T('the note sizes the hole against the whole set', /6 of 6 fixture\(s\) never reached/.test(abs.note || ''));
  T('the note states what the run did examine', /examined 0/.test(abs.note || ''));
  const thr = call({ check: true, threw: 1, unchanged: 5 });
  T('a build that threw is a hole even beside an examined set', thr.code === 2);
  T('the note names the throw', /1 build threw/.test(thr.note || ''));
  T('the note sizes a partial hole', /1 of 6 fixture\(s\) never reached/.test(thr.note || ''));
  const allSkipped = call({ check: true, skipped: 3 });
  T('an examined population of zero exits 2', allSkipped.code === 2);
  T('the note names the absent fixtures', /3 no committed fixture/.test(allSkipped.note || ''));

  /* Coercion. A field the caller never set is zero; a field holding `null` or a string is a broken
     producer, and the mapping refuses on it rather than reporting a clean set. */
  T('an unset count field reads as zero', call({ check: true, unchanged: 6, threw: undefined }).code === 0);
  T('an omitted count field reads as zero', call({ check: true, unchanged: 6 }).code === 0);
  const nul = call({ check: true, unchanged: 6, absent: null });
  T('a null count refuses rather than reading as zero', nul.code === 2);
  T('the refusal names the field', /absent did not arrive as numbers/.test(nul.note || ''));
  const str = call({ check: true, unchanged: 6, moved: '3' });
  T('a non-numeric count refuses', str.code === 2);
  T('the refusal names every bad field', /moved, skipped/.test(call({ check: true, moved: '1', skipped: null }).note || ''));
  T('a broken producer refuses in regen mode too', call({ check: false, absent: null }).code === 2);
  T('an all-empty check call exits 2', call({ check: true }).code === 2);

  /* The summary parse. The clause ORDER is the regression: this unit's own fix added a `build threw`
     clause, and a single positional optional group would have read `absent` as 0 for every node. */
  const LINE = 'check: 0 fixture(s) moved, 0 minted, 0 skipped';
  T('a line with no trailing clause parses', parseRegenSummary(LINE)?.absent === 0);
  T(
    'the three leading counts parse',
    (() => {
      const r = parseRegenSummary('regen: 1 fixture(s) moved, 2 minted, 3 skipped');
      return r.moved === 1 && r.minted === 2 && r.skipped === 3;
    })()
  );
  T('NOT REACHED parses alone', parseRegenSummary(`${LINE}, 6 NOT REACHED (input absent)`).absent === 6);
  T('build threw parses alone', parseRegenSummary(`${LINE}, 2 build threw`).threw === 2);
  T(
    'a clause ahead of NOT REACHED does not silence it',
    (() => {
      const r = parseRegenSummary(`${LINE}, 2 build threw, 6 NOT REACHED (input absent)`);
      return r.threw === 2 && r.absent === 6;
    })()
  );
  T(
    'the order of the two clauses does not matter',
    (() => {
      const r = parseRegenSummary(`${LINE}, 6 NOT REACHED (input absent), 2 build threw`);
      return r.threw === 2 && r.absent === 6;
    })()
  );
  T('a line buried in other output parses', parseRegenSummary(`  = a fixture\n${LINE}, 4 NOT REACHED\ndone`).absent === 4);
  T('no summary line returns null', parseRegenSummary('nothing here') === null);
  T('empty output returns null', parseRegenSummary('') === null);
  T('absent output returns null', parseRegenSummary(null) === null);
  T('a clause on a DIFFERENT line is not borrowed', parseRegenSummary(`${LINE}\nsomething, 9 NOT REACHED`).absent === 0);

  if (fail.length) {
    console.error(`regen-goldens --selftest: ${fail.length} of ${n} FAILED`);
    for (const f of fail) console.error(`  \u2717 ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`regen-goldens --selftest: all ${n} selftests passed`);
  }
} else if (!ALL && (!name || !NODES[name])) {
  console.error(`usage: node tools/regen-goldens.mjs (--node <${Object.keys(NODES).join('|')}> | --all) [--check]`);
  process.exitCode = 2;
} else if (!ALL) {
  // The recipe reads process.argv for --check itself; importing it runs the regeneration.
  await import(NODES[name]);
} else {
  /* REGEN-CORPUS-PATH-FOLLOWUPS-II §3 — "regenerate everything" used to be a hand-written nine-node
     shell loop, which is a step nobody repeats and nobody reviews. It also printed nine separate
     summaries, and reading nine `0 skipped` lines is exactly the conflation the parent brief removed:
     a HOLE in one node disappears into a wall of per-node output. One combined summary, with
     `NOT REACHED` kept distinct from `skipped`, is the whole point of having the flag.
     A CHILD PROCESS PER NODE, not nine imports into one realm: each recipe co-loads the real modules
     into its own realm and several define the same globals, so sharing a process would let one node's
     modules answer another node's regeneration — silently, and in the tool whose job is to be the
     trustworthy way to move an output byte. */
  const { spawnSync } = await import('node:child_process');
  const { parseRegenSummary } = await import('./regen-goldens-core.mjs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const passthru = process.argv.slice(2).filter((a) => a !== '--all' && a !== '--node' && !NODES[a]);
  const tot = { moved: 0, minted: 0, skipped: 0, absent: 0, threw: 0 };
  const failed = [];
  const perNode = [];
  /* A node that could not look (core exit 2, CLAUDE.md §4c) is a REPORTED run with a HOLE in it, not a
     failure to report. The combined verdict aggregates the children's own codes rather than re-deriving
     one from the printed counts: the child already decided, and `unchanged` never reaches this line. */
  const unexamined = [];
  for (const [node, rel] of Object.entries(NODES)) {
    console.log(`\n\u25b8 ${node}`);
    const r = spawnSync(process.execPath, [path.join(HERE, rel), ...passthru], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out);
    if (r.status !== 0 && r.status !== 1 && r.status !== 2) {
      failed.push(node + ' (exit ' + r.status + ')');
      continue;
    }
    if (r.status === 2) unexamined.push(node);
    const m = parseRegenSummary(out);
    if (!m) {
      // A node that printed no summary did not report — never fold that into a zero.
      failed.push(node + ' (no summary line)');
      continue;
    }
    const one = { node, ...m };
    perNode.push(one);
    tot.moved += one.moved;
    tot.minted += one.minted;
    tot.skipped += one.skipped;
    tot.absent += one.absent;
    tot.threw += one.threw;
  }
  const CHECK = process.argv.includes('--check');
  console.log('\n' + '\u2500'.repeat(78));
  console.log(
    `${CHECK ? 'check' : 'regen'} --all: ${tot.moved} moved, ${tot.minted} minted, ${tot.skipped} skipped, ${tot.absent} NOT REACHED` +
      (tot.threw ? `, ${tot.threw} build threw` : '') +
      ` across ${perNode.length}/${Object.keys(NODES).length} node(s)`
  );
  for (const n of perNode) {
    if (n.moved || n.minted || n.absent) console.log(`   ${n.node.padEnd(11)} ${n.moved} moved, ${n.minted} minted, ${n.absent} NOT REACHED`);
  }
  if (tot.absent) console.log(`   \u26a0 ${tot.absent} fixture(s) NOT REACHED — an input was absent, so this run did NOT cover them. Point DEX_UPLOADS at the corpus.`);
  if (tot.threw) console.log(`   \u26a0 ${tot.threw} fixture(s) threw during the rebuild — the comparison never ran for them.`);
  if (failed.length) console.log(`   \u2717 ${failed.length} node(s) did not report: ${failed.join(', ')}`);
  if (unexamined.length) console.log(`   \u23f1 UNEXAMINED \u2014 ${unexamined.length} node(s) reached no comparison: ${unexamined.join(', ')}; ` + 'this run cannot report their fixtures current');
  /* Drift (1) outranks a hole (2): a moved output is the actionable finding, and a caller that treats
     any non-zero as "look at this" loses nothing. A node that failed to report is not a pass, in either
     mode. Exit 2 means this run COULD NOT LOOK at part of the set — never that the set is clean. */
  process.exit(failed.length || (CHECK && (tot.moved || tot.minted)) ? 1 : CHECK && unexamined.length ? 2 : 0);
}
