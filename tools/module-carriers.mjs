#!/usr/bin/env node
/*
 * module-carriers.mjs — the shared node-named module declaration.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * A FILE NAMED FOR ONE NODE CAN BE READ BY A SURFACE THAT HAS NOTHING TO DO WITH THAT NODE. Residue
 * row `2026-11-10-the-edf-reader-is-named-for-one-node-and-five-surfaces-carry-it`: `cpapdex-edf.js`
 * holds the suite's only EDF reader, and `odi-bias-analysis.html` carries it, so a session that opens
 * the file to change CPAPDex cannot see from the name who else depends on it. Enumerated over the
 * tree, the class holds NINE modules rather than one.
 *
 * WHY THE DECLARATION SITS HERE AND NOT IN EACH MODULE'S OWN HEADER. Every one of the nine sits in a
 * bundle's compute closure, so one comment line moves each carrying bundle's `manifestHash` and its
 * `computeHash`. Four CPAPDex fixtures carry `verifiedUnder` over a real multi-file EDF input that the
 * equivalence gate cannot re-run, so a comment in `cpapdex-edf.js` would owe a corpus re-verification
 * before the next release. This gate is inlined by no bundle, so the declaration costs no fixture.
 *
 *   node tools/module-carriers.mjs            # check
 *   node tools/module-carriers.mjs --json     # the tepna.verdict/1 object alone on stdout
 *   node tools/module-carriers.mjs --selftest
 *
 * THE RULE IS ONE-DIRECTIONAL, because the honest direction is the one a reader needs. A node-named
 * module carried by a page outside its own node and outside the broad surfaces must stand in
 * `DECLARED`. A `DECLARED` entry whose module no longer reaches such a page reds too, so a declaration
 * cannot outlive the sharing it describes. The per-module carrier SETS are reported and never pinned:
 * a new analysis page carrying one of the nine is a fact for the verdict, never a red.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

/* The node name space. `integrator` is a node here, because its DSP carries the same risk. */
export const NODE_PREFIXES = ['cpapdex', 'ecgdex', 'eegdex', 'glucodex', 'hrvdex', 'integrator', 'motiondex', 'oxydex', 'ppgdex', 'pulsedex'];

/* THE FOUR SURFACES THAT CARRY EVERY NODE BY DESIGN. An orchestrator inlines each node's DSP, and the
   suite page boots each node's modules, so counting them would name every node file and tell a reader
   nothing. They stay in the verdict's excluded population, never silently dropped. */
export const BROAD_SURFACES = new Set(['Data Unifier.html', 'Dex-Test-Suite.html', 'OverDex.html', 'verify-provenance.html']);

/* EACH LINE STATES WHAT THE MODULE IS AND WHO READS IT OUTSIDE ITS NODE. Measured 2026-11-10 over the
   58 pages in the tree. The outside reader is named here as prose; the gate reports the live set. */
export const DECLARED = {
  'cpapdex-edf.js': 'the EDF/EDF+ binary reader, the only one in the suite; the ODI bias analysis page reads it outside CPAPDex',
  'glucodex-dsp.js': 'the CGM ingest and glycemic metric engine; the cohort harness runs it outside GlucoDex',
  'hrvdex-chart.js': 'the dependency-free canvas chart engine; the sensor trio night page draws with it outside HRVDex',
  'integrator-dsp.js': 'the Ganglior fusion layer; the cohort runner and the respiratory-ACC analysis fuse with it',
  'motiondex-dsp.js': 'the IMU ingest and motion metric engine; the respiratory-ACC analysis reads it outside MotionDex',
  'oxydex-dsp.js': 'the SpO2 analysis engine; the cohort harness and the ODI bias analysis run it outside OxyDex',
  'oxydex-profile.js': 'the profile store and every personalization formula; the same two analysis pages read it',
  'oxydex-util.js': 'the null-safe export and CSV helpers loaded first; the same two analysis pages read them',
  'pulsedex-dsp.js': 'the RR and HRV math; the cohort harness runs it outside PulseDex'
};

/** Every module a page carries, by mechanism. A path is reduced to its basename, which is the logical
    name the build writes. */
export function carriageSites(text) {
  const inline = [...text.matchAll(/data-inline-src="([^"]+)"/g)].map((m) => m[1].split('/').pop());
  const script = [...text.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)].map((m) => m[1].split('/').pop());
  return { inline, script };
}

/** The carriage map over an explicit page list. PURE given its pages. */
export function carriageOf(pages) {
  const byModule = new Map();
  for (const page of pages) {
    const sites = carriageSites(page.text);
    for (const mech of ['inline', 'script']) {
      for (const name of sites[mech]) {
        if (!byModule.has(name)) byModule.set(name, { inline: new Set(), script: new Set() });
        byModule.get(name)[mech].add(page.name);
      }
    }
  }
  return byModule;
}

/** The node a filename claims, or null. `oxydex.js` and `oxydex-util.js` both claim OxyDex; `odi.js`
    claims nobody. */
export function prefixOf(module, prefixes = NODE_PREFIXES) {
  const stem = module.replace(/\.js$/, '');
  return prefixes.find((p) => stem === p || stem.startsWith(`${p}-`)) || null;
}

/** One row per node-named module that a page outside its node and outside the broad surfaces carries. */
export function sharedOutside(byModule, { broad = BROAD_SURFACES, prefixes = NODE_PREFIXES } = {}) {
  const rows = [];
  for (const [module, mech] of [...byModule.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const prefix = prefixOf(module, prefixes);
    if (!prefix) continue;
    const pages = [...new Set([...mech.inline, ...mech.script])].sort();
    const own = pages.filter((p) => p.toLowerCase().startsWith(prefix));
    const broadPages = pages.filter((p) => broad.has(p));
    const outside = pages.filter((p) => !p.toLowerCase().startsWith(prefix) && !broad.has(p));
    if (outside.length > 0) rows.push({ module, prefix, own, broad: broadPages, outside });
  }
  return rows;
}

/** The two directions of the rule, read from one row set. */
export function classify(rows, declared = DECLARED) {
  const shared = new Set(rows.map((r) => r.module));
  return {
    undeclared: rows.filter((r) => !(r.module in declared)).map((r) => `${r.module} → ${r.outside.join(', ')}`),
    stale: Object.keys(declared)
      .filter((m) => !shared.has(m))
      .sort()
  };
}

function readPages() {
  return readdirSync(ROOT)
    .filter((n) => n.endsWith('.html') && !n.endsWith('.src.html'))
    .sort()
    .map((n) => ({ name: n, text: readFileSync(join(ROOT, n), 'utf8') }));
}

function headCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function verdictOf({ status, pages, byModule, rows, bad, reason }) {
  const nodeNamed = [...byModule.keys()].filter((m) => prefixOf(m)).length;
  const v = Verdict.make({
    gate: 'module-carriers',
    status,
    population: { checked: nodeNamed, eligible: byModule.size, excluded: byModule.size - nodeNamed },
    criterion: {
      name: 'no_undeclared_node_named_module_carried_outside_its_node',
      threshold: 0,
      unit: 'modules',
      direction: 'eq'
    },
    result: {
      pagesScanned: pages.length,
      broadSurfacesExcludedFromCarriage: [...BROAD_SURFACES].sort(),
      sharedOutsideNode: rows.length,
      declared: Object.keys(DECLARED).length,
      undeclared: bad.undeclared,
      staleDeclarations: bad.stale,
      carriers: rows.map((r) => ({ module: r.module, own: r.own, broad: r.broad, outside: r.outside }))
    },
    evidence: ['tools/module-carriers.mjs', ...rows.map((r) => r.module)],
    reason: status === 'PASS' ? null : reason,
    producedBy: { tool: 'tools/module-carriers.mjs', commit: headCommit() },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`module-carriers produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (label, got, want) => {
    ran += 1;
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) fail.push(`${label} got ${g}, want ${w}`);
  };

  /* ── THE TWO MECHANISMS, READ FROM TEXT ──────────────────────────────────────────────────────── */
  const sample = '<script src="a/cpapdex-edf.js"></script><div data-inline-src="oxydex-util.js">x</div>';
  ok('a script tag is read down to its basename', carriageSites(sample).script, ['cpapdex-edf.js']);
  ok('an inline block is read by its logical name', carriageSites(sample).inline, ['oxydex-util.js']);
  ok('a page with neither carries nothing', carriageSites('<p>no module here</p>'), { inline: [], script: [] });

  /* ── THE PREFIX IS THE NODE CLAIM, AND A FILE MAY CLAIM NOBODY ───────────────────────────────── */
  ok('a hyphenated node name claims its node', prefixOf('cpapdex-edf.js'), 'cpapdex');
  ok('a bare node name claims it too', prefixOf('oxydex.js'), 'oxydex');
  ok('a spine module claims nobody, so this gate never judges it', prefixOf('clock.js'), null);
  ok('a prefix must end at a hyphen', prefixOf('oxydexter.js'), null);

  /* ── THE RULE, OVER A PLANTED TREE ───────────────────────────────────────────────────────────── */
  const plant = (pages) => sharedOutside(carriageOf(pages));
  const ownOnly = plant([
    { name: 'CPAPDex.html', text: '<div data-inline-src="cpapdex-edf.js"></div>' },
    { name: 'OverDex.html', text: '<div data-inline-src="cpapdex-edf.js"></div>' }
  ]);
  ok('its own page and a broad surface are not sharing', ownOnly.length, 0);
  const outside = plant([
    { name: 'CPAPDex.html', text: '<div data-inline-src="cpapdex-edf.js"></div>' },
    { name: 'odi-bias-analysis.html', text: '<script src="cpapdex-edf.js"></script>' }
  ]);
  ok(
    'one outside page makes it shared',
    outside.map((r) => r.module),
    ['cpapdex-edf.js']
  );
  ok('and the row names that page, which is what a reader opens', outside[0].outside, ['odi-bias-analysis.html']);
  ok('the row keeps its own pages too', outside[0].own, ['CPAPDex.html']);
  const spine = plant([
    { name: 'CPAPDex.html', text: '<div data-inline-src="clock.js"></div>' },
    { name: 'odi-bias-analysis.html', text: '<script src="clock.js"></script>' }
  ]);
  ok('a module claiming no node stays out of scope, however many pages carry it', spine.length, 0);

  /* ── BOTH DIRECTIONS OF THE DECLARATION ──────────────────────────────────────────────────────── */
  ok('an undeclared shared module is named with its outside page', classify(outside, {}).undeclared, ['cpapdex-edf.js → odi-bias-analysis.html']);
  ok('a declared one is not', classify(outside, { 'cpapdex-edf.js': 'x' }).undeclared, []);
  ok('a declaration the tree no longer supports is named', classify([], { 'ecgdex-dsp.js': 'x' }).stale, ['ecgdex-dsp.js']);

  /* ── THE REAL TREE · ANTI-VACUITY FIRST, because a green over an empty scan says nothing ─────── */
  const pages = readPages();
  const byModule = carriageOf(pages);
  ok('ANTI-VACUITY · the tree holds pages to read', pages.length >= 40, true);
  ok('ANTI-VACUITY · those pages carry modules', byModule.size >= 100, true);
  const rows = sharedOutside(byModule);
  const bad = classify(rows);
  ok('every node-named module shared beyond its node is declared', bad.undeclared, []);
  ok('every declaration still describes real sharing', bad.stale, []);
  ok('the declared set is the shared set, so the gate judges the whole class', rows.length, Object.keys(DECLARED).length);
  /* THE EXCLUSION IS LOAD-BEARING, so one leg measures what it costs. Counting the broad surfaces as
     outside readers would flag far more modules, and that control keeps the four names honest. */
  const noBroad = sharedOutside(byModule, { broad: new Set() });
  ok('dropping the broad-surface exclusion flags strictly more, which is why it is declared', noBroad.length > rows.length, true);

  const line = fail.length ? `module-carriers selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const pages = readPages();
  const byModule = carriageOf(pages);
  const prose = !argv.includes('--json');
  if (pages.length === 0 || byModule.size === 0) {
    const v = verdictOf({
      status: 'NOT_RUN',
      pages,
      byModule,
      rows: [],
      bad: { undeclared: [], stale: [] },
      reason: `the scan examined nothing: ${pages.length} page(s), ${byModule.size} carried module(s)`
    });
    process.stdout.write(`${JSON.stringify(v)}\n`);
    process.stderr.write('✕ module-carriers: no page carried a module — a gate that examined nothing is not a pass\n');
    process.exit(1);
  }
  const rows = sharedOutside(byModule);
  const bad = classify(rows);
  const broken = bad.undeclared.length + bad.stale.length;
  const reason = broken === 0 ? null : `${bad.undeclared.length} undeclared, ${bad.stale.length} stale declaration(s)`;
  const v = verdictOf({ status: broken === 0 ? 'PASS' : 'FAIL', pages, byModule, rows, bad, reason });
  process.stdout.write(`${JSON.stringify(v)}\n`);
  if (broken > 0) {
    for (const u of bad.undeclared) process.stderr.write(`  ✕ undeclared · ${u}\n`);
    for (const s of bad.stale) process.stderr.write(`  ✕ stale declaration · ${s} reaches no page outside its node\n`);
    process.stderr.write('✕ module-carriers: DECLARED and the tree disagree — state the sharing or drop the entry\n');
    process.exit(1);
  }
  if (prose) {
    process.stdout.write(`✓ module-carriers — ${pages.length} page(s), ${byModule.size} carried module(s), ${rows.length} node-named module(s) shared beyond their node, all declared\n`);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('module-carriers.mjs')) main();
