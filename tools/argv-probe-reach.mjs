#!/usr/bin/env node
/*
 * tools/argv-probe-reach.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * HOW MANY ABSTAINING TOOLS CAN THE PROBE REACH TODAY? — the join nobody computed.
 *
 * Two instruments exist and neither answers this. `argv-reads.mjs` scans statically and sorts every
 * tool mentioning `process.argv` into five classes; its `undecidable` class is the ABSTENTION COLUMN,
 * and an abstention there is never a clearance. `argv-survey.mjs` RUNS tools, and it bounds what it
 * may run by a closure proof: a tool whose transitive local imports hold no write, exec or network
 * call cannot move anything, whatever it does with argv. That bound is the PROBE BAR.
 *
 * The reach is the intersection of the two, and a reader produced it by hand until now. Row
 * `2026-10-26-the-probe-reach-figure-moved-with-the-column-and-the-bar` logged what that costs: the
 * headline `4 of 40` was typed at #3843, and every term under it then moved. Measured here, against
 * that row's own numbers:
 *
 *                                tools reading argv   abstention column   probe bar   reach
 *   482e39264 (the row)                   269 files                  37          45       5
 *   b2e7590ad (before this file)                320                  41          66       6
 *   b2e7590ad (with this file)                  321                  41          66       6
 *
 * Nothing in the tree reported the drift, because no gate read the join. This file reads argv and
 * refuses an unknown token, so it joins the scanned population and stays out of the abstention
 * column: a count that includes the counter says so, and the third row above is that statement.
 *
 * WHAT IT DECIDES. A tool inside the reach CAN be probed, so an abstention there is work somebody can
 * do today. The pre-stated criterion is zero probe-safe abstentions with no CURRENT probe row.
 * `audits/ARGV-REFUSAL-SURVEY-2026-09-28.json` is that record, and `crossCheck` from the scanner
 * decides currency rather than this file: a row whose tool's bytes moved since the recorded tree
 * described OTHER bytes, so it reads as unprobed and never as a probe. Measured at `b2e7590ad`, 5 of
 * the 6 reach tools carry no row at all, and `guarantees.mjs` carries one reading IGNORES.
 *
 * WHAT IT LEAVES ALONE. The abstentions outside the probe bar (35 at `b2e7590ad`) carry the owner's
 * question in the parent row: a sandbox for the hazard class, or named abstentions. This tool counts
 * them as `excluded` with that reason and recommends nothing about them.
 *
 * ⚠ THIS TOOL CANNOT SIT IN ITS OWN REACH. It imports the scanner, which execs git through
 * `verdict-emit.mjs`, so the closure proof excludes it by construction. An instrument that could
 * enter its own candidate set would judge itself.
 *
 * ⚠ A SHORTFALL IS A MEASURED BACKLOG, NEVER A RED DIFF. The bare run exits 0 and reports; `--strict`
 * exits 1 on any non-PASS, which is the form a caller uses once the backlog reads 0.
 *
 * USAGE
 *   node tools/argv-probe-reach.mjs                 # report plus the verdict, exit 0
 *   node tools/argv-probe-reach.mjs --json
 *   node tools/argv-probe-reach.mjs --strict        # exit 1 on any non-PASS
 *   node tools/argv-probe-reach.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { crossCheck, scanDir } from './argv-reads.mjs';
import { inertPopulation } from './argv-survey.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROL_PATH = 'audits/ARGV-REFUSAL-SURVEY-2026-09-28.json';
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
/** The survey keys a row by repo-relative path and the scan by basename, so every join normalises. */
const base = (t) => String(t).replace(/^.*\//, '');

/* ── the join ──────────────────────────────────────────────────────────────────────────────────── */
/** Abstention column ∩ probe bar, then each reach tool against the recorded run.
 *
 *  A reach tool is PROBED only while a control row for it is comparable. `crossCheck` excludes a row
 *  whose bytes moved, and this counts such a tool as unprobed WITH that exclusion as the reason: the
 *  recorded run described bytes the tree no longer carries, so it says nothing about today. */
export function reachJoin({ rows, inert, controls }) {
  /* An ABSENT record is not an empty one. With `controls: null` every reach tool would read "no row",
     which states a backlog this run never examined, so the join carries the distinction and the
     verdict below turns it into NOT_RUN. */
  const recorded = controls != null;
  const bar = new Set([...inert].map(base));
  const column = rows
    .filter((r) => r.cls === 'undecidable')
    .map((r) => base(r.tool))
    .sort();
  const reach = column.filter((t) => bar.has(t));
  const byTool = new Map();
  for (const c of controls || []) byTool.set(base(c.tool), c);
  const probed = [];
  const unprobed = [];
  for (const tool of reach) {
    const c = byTool.get(tool);
    if (c && !c.excluded) probed.push({ tool, probe: c.probe });
    else unprobed.push({ tool, why: c ? c.excluded : 'no row in the recorded survey' });
  }
  return { scanned: rows.length, recorded, column, bar: bar.size, reach, probed, unprobed };
}

/** PASS only over a non-empty reach with every member currently probed. An empty intersection is
 *  NOT_APPLICABLE — the rule examined the two columns and does not bind — never a PASS over nothing. */
export function reachVerdict(join, { commit } = {}) {
  const { scanned, recorded, column, bar, reach, probed, unprobed } = join;
  const notRun = scanned === 0 || recorded === false;
  const status = notRun ? 'NOT_RUN' : reach.length === 0 ? 'NOT_APPLICABLE' : unprobed.length ? 'SHORTFALL' : 'PASS';
  const reason =
    status === 'NOT_RUN'
      ? scanned === 0
        ? 'the scan read no tool, so neither column exists'
        : `the recorded survey ${CONTROL_PATH} is absent, so no probe row can be read and currency cannot be decided`
      : status === 'NOT_APPLICABLE'
        ? `the abstention column (${column.length}) and the probe bar (${bar}) do not intersect, so no abstention can be probed today`
        : status === 'SHORTFALL'
          ? `${unprobed.length} of ${reach.length} probe-safe abstention(s) carry no current probe row: ${unprobed.map((u) => u.tool).join(', ')}`
          : null;
  return makeVerdict({
    gate: 'argv-probe-reach',
    status,
    /* The abstentions outside the bar are excluded with a stated reason, never silently dropped. */
    population: { checked: reach.length, eligible: column.length, excluded: column.length - reach.length },
    criterion: { name: 'probe_safe_abstentions_with_no_current_probe', threshold: 0, unit: 'tools', direction: 'lte' },
    /* NOT_RUN examined nothing and NOT_APPLICABLE does not bind, and the contract gives both
       `result: null`; only a binding run carries numbers. */
    result:
      notRun || reach.length === 0
        ? null
        : {
            scanned,
            abstentionColumn: column.length,
            probeBar: bar,
            reach: reach.length,
            reachTools: reach,
            probed: probed.length,
            unprobed: unprobed.length,
            unprobedTools: unprobed,
            excludedReason: 'the abstention carries a write, exec or network call in its import closure, so the probe may not run it'
          },
    evidence: ['tools/argv-probe-reach.mjs', 'tools/argv-reads.mjs', 'tools/argv-survey.mjs', CONTROL_PATH],
    reason,
    tool: 'tools/argv-probe-reach.mjs',
    commit
  });
}

/* ── io ────────────────────────────────────────────────────────────────────────────────────────── */
function measure() {
  const dir = join(ROOT, 'tools');
  const rows = scanDir(dir);
  const path = join(ROOT, CONTROL_PATH);
  if (!existsSync(path)) return { rows, controls: null };
  return { rows, controls: crossCheck(JSON.parse(readFileSync(path, 'utf8')), rows) };
}

/* ── selftest ──────────────────────────────────────────────────────────────────────────────────── */
/** Every leg runs on synthetic rows: the join is the subject, and the tree is not. */
function selftest() {
  let ran = 0;
  const ok = (cond, what) => {
    ran++;
    if (!cond) {
      console.error(`✗ ${what}`);
      process.exit(1);
    }
  };
  const ROWS = [
    { tool: 'inside.mjs', cls: 'undecidable' },
    { tool: 'hazard.mjs', cls: 'undecidable' },
    { tool: 'probed.mjs', cls: 'undecidable' },
    { tool: 'moved.mjs', cls: 'undecidable' },
    { tool: 'refuser.mjs', cls: 'refuses' }
  ];
  const INERT = ['inside.mjs', 'probed.mjs', 'moved.mjs', 'refuser.mjs'];
  const CONTROLS = [
    { tool: 'tools/probed.mjs', probe: 'IGNORES' },
    { tool: 'tools/moved.mjs', probe: 'REFUSES', excluded: 'the tool changed since the probe tree' }
  ];
  const j = reachJoin({ rows: ROWS, inert: INERT, controls: CONTROLS });
  ok(j.column.length === 4, 'the abstention column holds every undecidable tool');
  ok(j.reach.join(',') === 'inside.mjs,moved.mjs,probed.mjs', 'the reach is the abstention column inside the probe bar');
  ok(!j.reach.includes('hazard.mjs'), 'an abstention outside the probe bar stays out of the reach');
  /* CONTROL · a refuser inside the bar is not work, so the bar alone never puts a tool in the reach. */
  ok(!j.reach.includes('refuser.mjs'), 'CONTROL · a probe-safe tool that is not abstaining never enters the reach');
  ok(j.probed.length === 1 && j.probed[0].tool === 'probed.mjs', 'a comparable control row counts as probed');
  ok(j.unprobed.length === 2, 'the rest of the reach counts as unprobed');
  const moved = j.unprobed.find((u) => u.tool === 'moved.mjs');
  ok(!!moved && /changed since the probe tree/.test(moved.why), 'an excluded control row reads as unprobed and keeps the exclusion as its reason');
  const none = j.unprobed.find((u) => u.tool === 'inside.mjs');
  ok(!!none && /no row in the recorded survey/.test(none.why), 'a reach tool with no control row names that absence');
  const v = reachVerdict(j, { commit: null });
  ok(v.status === 'SHORTFALL', 'an unprobed reach reads SHORTFALL, never FAIL and never PASS');
  ok(/2 of 3/.test(v.reason || ''), 'and the reason carries both counts');
  ok(v.population.checked + v.population.excluded === v.population.eligible, 'the population arithmetic closes');
  ok(v.population.checked === 3 && v.population.excluded === 1, 'the hazard-carrying abstention is the excluded one');
  const clean = reachVerdict(reachJoin({ rows: ROWS, inert: INERT, controls: [...CONTROLS.map((c) => ({ ...c, excluded: undefined })), { tool: 'tools/inside.mjs', probe: 'REFUSES' }] }));
  ok(clean.status === 'PASS' && clean.reason === null, 'a fully probed reach reads PASS with no reason');
  const empty = reachVerdict(reachJoin({ rows: ROWS, inert: [], controls: [] }));
  ok(empty.status === 'NOT_APPLICABLE' && /do not intersect/.test(empty.reason), 'an empty intersection reads NOT_APPLICABLE, never PASS over nothing');
  ok(reachVerdict(reachJoin({ rows: [], inert: [], controls: [] })).status === 'NOT_RUN', 'a scan that read no tool reads NOT_RUN');
  const noRec = reachVerdict(reachJoin({ rows: ROWS, inert: INERT, controls: null }));
  ok(noRec.status === 'NOT_RUN' && /is absent/.test(noRec.reason), 'an ABSENT record reads NOT_RUN and names the artifact, never a backlog it never examined');
  ok(noRec.result === null, 'and it carries no result, because it examined no probe row');
  /* `makeVerdict` validates and THROWS, so every object above reached this line only by satisfying
     tepna.verdict/1. This leg proves that guard still bites from here: a non-binding status carrying
     numbers is exactly the projection the contract refuses. */
  let threw = null;
  try {
    makeVerdict({
      gate: 'argv-probe-reach',
      status: 'NOT_APPLICABLE',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'probe_safe_abstentions_with_no_current_probe', threshold: 0, unit: 'tools', direction: 'lte' },
      result: { reach: 0 },
      evidence: ['tools/argv-probe-reach.mjs'],
      reason: 'a non-binding status may not carry a result',
      tool: 'tools/argv-probe-reach.mjs',
      commit: null
    });
  } catch (e) {
    threw = String(e && e.message);
  }
  ok(!!threw && /result: null/.test(threw), 'CONTROL · the emit path refuses a non-binding status that carries numbers');
  console.log(`selftest: all ${ran} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  /* This tool's subject is a token nobody reads, so it may not be a tool that ignores one. */
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--strict', '--selftest', '--verdict-sample'] }, { tool: 'argv-probe-reach' });
  if (flag('--selftest')) {
    selftest();
    process.exit(0);
  }
  const { rows, controls } = measure();
  const j = reachJoin({ rows, inert: inertPopulation(join(ROOT, 'tools')), controls });
  const verdict = reachVerdict(j);
  if (flag('--verdict-sample')) {
    /* The REAL object over today's tree: it reads files and runs no tool, so it costs a scan. */
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(0);
  }
  if (!j.recorded) {
    /* It could not look (§4c), so this is exit 2 and never a red. */
    console.error(`argv-probe-reach: the control artifact ${CONTROL_PATH} is absent - currency cannot be decided`);
    console.log(`--- ${verdict.status} - ${verdict.reason}`);
    process.exit(2);
  }
  if (flag('--json')) {
    console.log(JSON.stringify({ verdict, join: j }, null, 2));
    process.exit(flag('--strict') && verdict.status !== 'PASS' ? 1 : 0);
  }
  console.log(`argv-probe-reach: ${j.scanned} tool(s) read process.argv · abstention column ${j.column.length} · probe bar ${j.bar} · reach ${j.reach.length}`);
  for (const p of j.probed) console.log(`  ✓ ${p.tool.padEnd(30)} probed — ${p.probe}`);
  for (const u of j.unprobed) console.log(`  ? ${u.tool.padEnd(30)} unprobed — ${u.why}`);
  console.log('argv-probe-reach: an abstention outside the probe bar is excluded, and the parent row holds that question for the owner');
  console.log(`--- ${verdict.status}${verdict.reason ? ` — ${verdict.reason}` : ''}`);
  process.exit(flag('--strict') && verdict.status !== 'PASS' ? 1 : 0);
}
