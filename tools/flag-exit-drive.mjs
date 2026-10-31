#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * flag-exit-drive.mjs — DRIVE EACH CENSUS TOOL PAST THE STATEMENT ITS HEALTH FLAG SKIPS.
 *
 * WHY. `tools/flag-exit-scan.mjs` names the tools whose `--selftest` or `--verdict-sample` exits at
 * module scope ABOVE a later top-level statement that can throw. Its own header says the thing this
 * file answers: the census sees the SHAPE and never the coverage, and `covered` is a spawn-grep lower
 * bound. Residue `2026-10-30-thirteen-health-flags-exit-above-module-work-nothing-drives` logged the
 * gap. A green flag over a dead tool is the §4b family — success reported about something the run
 * never examined.
 *
 * THE CRITERION, PRE-STATED. A tool counts as DRIVEN when all five hold:
 *
 *   1. the tool still sits in the census, with a flag that claims health,
 *   2. the recipe's marker occurs in the source ONLY below the census risk line,
 *   3. the risk statement evaluates unconditionally, or the recipe's `enters` predicate holds,
 *   4. the child exits with the pre-stated code, and
 *   5. the child's output carries the marker.
 *
 * 🔴 THE MARKER IS THE PROOF, AND IT IS STATIC. A child that exits 0 proves nothing on its own: the
 * flag guard exits 0 too. So every recipe names a string whose only home in the source lies BELOW the
 * risk line. The child printing it places execution past the statement in question. Leg 2 reads the
 * source for that, so a marker that moves above the risk reds the leg rather than passing quietly.
 *
 * 🔴 THE RISK LINE COMES FROM `flagExitShape`, NEVER FROM A CONSTANT HERE. One reading feeds both
 * tools, so the census and the drive cannot drift apart. A recipe for a tool that has left the census
 * reds leg 1 instead of driving something no longer at issue.
 *
 * 🔴 A CONDITIONAL RISK OWES AN ENTRY PREDICATE. Four of the risk statements sit inside a top-level
 * `if` or `for` block. Module evaluation reaches the block, which is why the census counts them, and
 * a run that skips the branch still evaluates nothing. `aperiodic-method-compare.mjs` measures this:
 * its `readFileSync` lives in the `--grids` sweep, so a run without that flag never loads a byte.
 * `riskEnclosure` reads the enclosing top-level statement and demands the predicate.
 *
 * ⚠️ THE UNDRIVEN TOOLS APPEAR AS SLUGS, AND THAT ASYMMETRY IS LOAD-BEARING. `spawnedTools()` in the
 * census credits coverage to every `tools/<name>.mjs` string inside a file that spawns a child. It
 * cannot tell a drive from a mention, so writing an undriven tool's full path here would hand it a
 * green `covered` in another tool's census. `UNDRIVEN` therefore holds bare slugs and builds the path
 * at runtime. Never normalise the two tables into one spelling. A selftest leg asserts the asymmetry.
 *
 * ⚠️ A CHILD THAT TIMES OUT IS UNEXAMINED, NEVER FAILING (§4c). A fixed child cap closes early under
 * box load, which measurably turned a `verdict-adoption` step red mid-run on 2026-10-27. So a timeout
 * prints `⏱ UNEXAMINED <tool>` and the gate exits 2 — it could not look — where exit 1 means it
 * looked and a drive failed.
 *
 * WHAT THIS DOES NOT CLAIM. The population is the 11 census tools that no test spawned on 2026-10-30,
 * and the other census tools stay out of scope here. `verify:flag-exit` holds the growth ratchet at
 * zero, so a tool joining the census reds there rather than slipping past this driver unnoticed.
 *
 * USAGE
 *   node tools/flag-exit-drive.mjs                  # drive every recipe, human + verdict
 *   node tools/flag-exit-drive.mjs --json           # the per-tool results as JSON
 *   node tools/flag-exit-drive.mjs --selftest       # known answers over both static halves
 *   node tools/flag-exit-drive.mjs --verdict-sample # the verdict alone, for the adoption gate
 *   node tools/flag-exit-drive.mjs --help           # the accepted flags
 * ════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { flagExitShape, jsParse } from './flag-exit-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const PARSE = { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true };
/* 60 s per child, against a measured 1.5 s for all eight together. The cap exists for a wedged
   child, not for a slow one, and a run that hits it reports UNEXAMINED rather than a failure. */
const CHILD_MS = 60000;

/** A synthetic Polar-shaped ACC export: 2 minutes at 20 Hz, with a movement burst every 5 s.
    `shiftMs` moves the bursts, so the pair shares a real lag and the sweep has something to find. */
export function plantAcc(path, shiftMs) {
  const rows = ['Phone timestamp;sensor timestamp [ns];X;Y;Z'];
  const t0 = Date.UTC(2026, 6, 1, 0, 0, 0);
  for (let i = 0; i < 2400; i++) {
    const ms = i * 50;
    const burst = Math.floor((ms + shiftMs) / 5000) % 4 === 0 && (ms + shiftMs) % 5000 < 400 ? 1 : 0;
    const iso = new Date(t0 + ms).toISOString().replace('Z', '');
    rows.push(`${iso};${ms * 1000000};${burst};0;1`);
  }
  writeFileSync(path, `${rows.join('\n')}\n`);
  return path;
}

/** An empty directory, which is what a corpus-free drive offers a tool that scans one. */
function plantDir(dir, name) {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  return p;
}

/** A one-file mutation-sweep state dir, which is what a directory-reader in that lane scans. The
    survivor shape is the one `probesFrom` lifts a condition pair out of, so the drive plants state
    rather than borrowing the shared lane's, whose contents move between sweeps. */
export function plantSweepState(dir, name) {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  const survivors = [{ line: 3, op: 'cmp', before: '  if (h < 0) return null;', after: '  if (h <= 0) return null;' }];
  writeFileSync(join(p, 'planted.json'), `${JSON.stringify({ file: 'planted.js', survivors })}\n`);
  return p;
}

function plantFile(dir, name, text) {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}

/* ── the recipes ──────────────────────────────────────────────────────────────────────────────────
   Each one is pre-stated: the argv, the expected exit code, and the marker that only exists below
   the risk line. The full `tools/<name>.mjs` spelling is deliberate here — these tools ARE driven,
   so the census may credit them. Read the UNDRIVEN note above before you copy that form. */
export const RECIPES = [
  {
    tool: 'tools/aperiodic-method-compare.mjs',
    why: 'the risk is a `readFileSync` inside the `--grids` sweep, so only the sweep drives it',
    plant: (d) => ({ a: plantAcc(join(d, 'accA.txt'), 0), b: plantAcc(join(d, 'accB.txt'), 500) }),
    argv: (_d, p) => ['--a', p.a, '--b', p.b, '--grids', '250'],
    code: 0,
    marker: 'nearest-advocate spread ACROSS GRIDS:',
    enters: (argv) => argv.includes('--grids'),
    entersWhy: 'the `--grids` flag is the branch test'
  },
  {
    tool: 'tools/deep-flow-join.mjs',
    why: 'the risk reads the anchors file inside `if (ANCH)`, so the recipe hands it one',
    plant: (d) => ({ eve: plantDir(d, 'eve'), anch: plantFile(d, 'anchors.txt', '20260701 -300 0.9\n') }),
    argv: (_d, p) => ['--eve', p.eve, '--anchors', p.anch],
    code: 0,
    marker: 'deep-flow join · cohort boundary',
    enters: (argv) => argv.includes('--anchors'),
    entersWhy: '`--anchors` sets ANCH, and the block tests ANCH'
  },
  {
    tool: 'tools/oxydex-export-staleness.mjs',
    why: 'the risk is an unconditional module-scope read, so any later line proves it ran',
    plant: (d) => ({ dir: plantDir(d, 'exports') }),
    argv: (_d, p) => [p.dir],
    code: 0,
    marker: 'night(s) checked',
    enters: null
  },
  {
    tool: 'tools/pat-hrv-windows.mjs',
    why: 'the risk is the unconditional vm realm build',
    plant: (d) => ({ dir: plantDir(d, 'captures') }),
    argv: (_d, p) => ['--dir', p.dir],
    code: 0,
    marker: 'night        win  kept  rej',
    enters: null
  },
  {
    tool: 'tools/pat-window-scaling.mjs',
    why: 'the risk is the unconditional vm realm build',
    plant: (d) => ({ dir: plantDir(d, 'captures') }),
    argv: (_d, p) => ['--dir', p.dir],
    code: 0,
    marker: 'drift integrates, physiology does not',
    enters: null
  },
  {
    tool: 'tools/ppg-gap-bridge-scan.mjs',
    why: 'the risk reads each offered file inside the scan loop, so the recipe offers one file',
    plant: (d) => ({ txt: plantFile(d, 'O2Ring_PPG.txt', 'x\n') }),
    argv: (_d, p) => [p.txt],
    code: 0,
    marker: 'read failed: ',
    enters: (argv) => argv.some((a) => a.endsWith('_PPG.txt')),
    entersWhy: 'the loop runs over the offered files, so one file is the entry'
  },
  {
    tool: 'tools/validate-exports.mjs',
    why: 'the risk is the unconditional vm realm build',
    plant: (d) => ({ dir: plantDir(d, 'uploads') }),
    argv: (_d, p) => ['--dir', p.dir],
    code: 0,
    marker: 'ganglior.node-export files',
    enters: null
  },
  {
    tool: 'tools/assertion-strength.mjs',
    why: 'the risk reads the suite inside `if (IS_MAIN && !--selftest)`, so a plain run is the entry',
    plant: () => ({}),
    argv: () => [],
    code: 0,
    marker: 'ASSERTION STRENGTH —',
    enters: (argv) => !argv.includes('--selftest'),
    entersWhy: 'the branch tests for the ABSENCE of the flag, so a plain run enters it'
  },
  {
    tool: 'tools/witness-baseline.mjs',
    why: 'the risk is the probe loop over the state files; the whole set is 1939 probes at 73 ms each, measured 2026-10-30, so only a declared budget finishes inside the child cap',
    plant: (d) => ({ dir: plantSweepState(d, 'sweeps') }),
    argv: (_d, p) => ['--state-dir', p.dir, '--max-probes', '1'],
    code: 0,
    marker: 'probes considered',
    enters: (argv) => !argv.includes('--selftest'),
    entersWhy: 'the risk sits in the main block, which the absence of `--selftest` opens; `--max-probes` then bounds the loop inside it'
  }
];

/* ── the tools this driver will not drive ─────────────────────────────────────────────────────────
   Slugs only. Writing the full path here would credit them in the census for a mention (see above).
   Each reason below rests on a measurement, and §∅ holds them as excluded rather than green. */
export const UNDRIVEN = [
  {
    slug: 'survivor-witness',
    reason: 'a bare run calls mkdirSync and appendFileSync into the shared mutation-sweep state, which is another session lane'
  },
  {
    slug: 'tch-third-corner',
    reason: 'its usage exit sits ABOVE the risk line, and entering the branch needs four real capture streams'
  }
];

/** Every line where `marker` occurs. The proof needs them all below the risk line. */
export function markerLines(src, marker) {
  const out = [];
  const lines = src.split('\n');
  for (const [i, line] of lines.entries()) if (line.includes(marker)) out.push(i + 1);
  return out;
}

/** The top-level statement holding `riskLine`. A statement that STARTS on another line wraps the
    risk in a block, so the recipe owes an entry predicate. A test holding the risk starts on the
    risk line itself, and evaluates on every run. */
export function riskEnclosure(src, riskLine, parse = jsParse()) {
  if (!parse) return null;
  let ast;
  try {
    ast = parse(src, PARSE);
  } catch (err) {
    return { found: false, reason: err.message, conditional: null };
  }
  const st = ast.body.find((s) => s.loc.start.line <= riskLine && s.loc.end.line >= riskLine);
  if (!st) return { found: false, reason: `no top-level statement holds line ${riskLine}`, conditional: null };
  return { found: true, type: st.type, startLine: st.loc.start.line, endLine: st.loc.end.line, conditional: st.loc.start.line !== riskLine };
}

/** One recipe, driven. Returns the five legs, the child's exit code, and the reason on a miss. */
export function driveOne(r, parse = jsParse()) {
  const src = readFileSync(join(REPO, r.tool), 'utf8');
  const shape = flagExitShape(src, r.tool, parse);
  const out = { tool: r.tool, legs: {}, riskLine: shape.risk ? shape.risk.line : null, riskKind: shape.risk ? shape.risk.kind : null };
  out.legs.inCensus = shape.parsed === true && shape.risk !== null && shape.claiming.length > 0;
  if (!out.legs.inCensus) {
    out.reason = `the recipe names a tool that is no longer in the census: parsed=${shape.parsed}, risk=${shape.risk ? shape.risk.line : null}, claiming=${shape.claiming.join(' ')}`;
    return out;
  }
  const lines = markerLines(src, r.marker);
  out.markerLines = lines;
  out.legs.markerBelowRisk = lines.length > 0 && lines.every((l) => l > out.riskLine);
  const encl = riskEnclosure(src, out.riskLine, parse);
  out.enclosure = encl;

  const dir = mkdtempSync(join(tmpdir(), 'flag-exit-drive-'));
  try {
    const planted = (r.plant || (() => ({})))(dir);
    const argv = r.argv(dir, planted);
    out.argv = argv.map((a) => a.replace(dir, '<tmp>'));
    out.legs.entryDeclared = encl && encl.conditional ? typeof r.enters === 'function' && r.enters(argv) === true : true;
    const child = spawnSync(process.execPath, [join(REPO, r.tool), ...argv], { cwd: REPO, encoding: 'utf8', timeout: CHILD_MS, maxBuffer: 32 * 1024 * 1024 });
    out.code = child.status;
    /* A cap that closes on a slow child examined nothing, so this is neither a pass nor a fail. */
    if (child.error && child.error.code === 'ETIMEDOUT') {
      out.unexamined = true;
      out.reason = `the child did not finish inside ${CHILD_MS} ms`;
      return out;
    }
    if (child.error) {
      out.reason = `the child did not run: ${child.error.message}`;
      return out;
    }
    const text = `${child.stdout || ''}${child.stderr || ''}`;
    out.legs.exitedAsStated = child.status === r.code;
    out.legs.printedMarker = text.includes(r.marker);
    if (!out.legs.exitedAsStated) out.reason = `the child exited ${child.status}, and the recipe states ${r.code}`;
    else if (!out.legs.printedMarker) out.reason = `the child never printed the marker ${JSON.stringify(r.marker)}`;
    else if (!out.legs.markerBelowRisk) out.reason = `the marker also occurs at or above the risk line ${out.riskLine}: ${lines.join(', ')}`;
    else if (!out.legs.entryDeclared) out.reason = 'the risk sits inside a block and the recipe declares no entry predicate';
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function allLegsPass(res) {
  const want = ['inCensus', 'markerBelowRisk', 'entryDeclared', 'exitedAsStated', 'printedMarker'];
  return want.every((k) => res.legs[k] === true);
}

function commitOf() {
  try {
    return spawnSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null;
  } catch {
    return null;
  }
}

function producedBy() {
  const commit = commitOf();
  return { tool: 'tools/flag-exit-drive.mjs', commit, ...(commit ? {} : { commitReason: 'not a git checkout, or git is unavailable here' }) };
}

const CRITERION = { name: 'census_tools_driven_past_their_risk_statement', threshold: RECIPES.length, unit: 'tools', direction: 'gte' };

export function verdict(results) {
  const unexamined = results.filter((r) => r.unexamined);
  const driven = results.filter((r) => allLegsPass(r));
  const failing = results.filter((r) => !r.unexamined && !allLegsPass(r));
  let status = 'PASS';
  let reason = null;
  if (unexamined.length) {
    status = 'UNKNOWN';
    reason = `${unexamined.length} child(ren) did not finish inside the cap: ${unexamined.map((r) => r.tool).join(', ')}`;
  } else if (failing.length) {
    status = 'FAIL';
    reason = `${failing.length} tool(s) were not driven past the risk: ${failing.map((r) => `${r.tool} (${r.reason})`).join('; ')}`;
  }
  return {
    schema: 'tepna.verdict/1',
    gate: 'flag-exit-drive',
    status,
    scope: 'internal',
    population: { checked: results.length - unexamined.length, eligible: RECIPES.length + UNDRIVEN.length, excluded: UNDRIVEN.length + unexamined.length },
    criterion: CRITERION,
    result: {
      driven: driven.length,
      failing: failing.map((r) => r.tool),
      unexamined: unexamined.map((r) => r.tool),
      undriven: UNDRIVEN.map((u) => ({ tool: u.slug, reason: u.reason })),
      byRiskKind: driven.reduce((a, r) => ({ ...a, [r.riskKind]: (a[r.riskKind] || 0) + 1 }), {})
    },
    evidence: ['tools/flag-exit-drive.mjs', 'tools/flag-exit-scan.mjs'],
    reason,
    producedBy: producedBy(),
    at: new Date().toISOString()
  };
}

/** No parser means the run examined nothing, so the object says so over an empty population (§∅). */
export function noParserVerdict() {
  return {
    schema: 'tepna.verdict/1',
    gate: 'flag-exit-drive',
    status: 'NOT_RUN',
    scope: 'internal',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: CRITERION,
    result: null,
    evidence: ['tools/flag-exit-drive.mjs', '.github/workflows/tests.yml'],
    reason: 'no JS parser available: acorn is a devDependency and this environment has no node_modules',
    producedBy: producedBy(),
    at: new Date().toISOString()
  };
}

function report(results) {
  console.log(`▸ ${results.length} recipe(s) driven, ${UNDRIVEN.length} tool(s) excluded with a reason`);
  for (const r of results) {
    if (r.unexamined) {
      console.log(`  ⏱ UNEXAMINED ${r.tool} — ${r.reason}`);
      continue;
    }
    const mark = allLegsPass(r) ? '✓' : '✗';
    console.log(`  ${mark} ${r.tool}  ${r.riskKind} at :${r.riskLine}, marker at :${(r.markerLines || []).join(',')}, child exited ${r.code}`);
    if (r.reason) console.log(`      ${r.reason}`);
  }
  for (const u of UNDRIVEN) console.log(`  ⊘ tools/${u.slug} — ${u.reason}`);
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────────
   Static legs plus one real child, so the suite stays cheap enough for the CI selftest loop. */
function selftest(parse = jsParse()) {
  if (!parse) {
    console.log('⊘ SKIP flag-exit-drive selftest: no JS parser in this environment, 0 leg(s) examined');
    process.exit(0);
  }
  let pass = 0;
  let fail = 0;
  const ok = (what, cond) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.log(`  ✗ ${what}`);
    }
  };

  ok('markerLines finds every occurrence', markerLines('a\nMARK\nb\nMARK\n', 'MARK').join() === '2,4');
  ok('markerLines finds none when the marker is absent', markerLines('a\nb\n', 'MARK').length === 0);

  const UNCOND = ["const x = require('node:vm');", 'const y = 2;'].join('\n');
  const e1 = riskEnclosure(UNCOND, 1, parse);
  ok('an unconditional risk needs no entry predicate', e1.found === true && e1.conditional === false);

  const COND = ['if (flag) {', "  const x = require('node:vm');", '}'].join('\n');
  const e2 = riskEnclosure(COND, 2, parse);
  ok('PLANT · a risk inside a block reads as conditional', e2.found === true && e2.conditional === true && e2.type === 'IfStatement');

  const INTEST = ["if (require('node:vm')) { 1; }"].join('\n');
  ok('CONTROL · a risk in the branch TEST is unconditional', riskEnclosure(INTEST, 1, parse).conditional === false);

  ok('§∅ · an unparsable source reports not-found with a reason', riskEnclosure('const = ;', 1, parse).found === false);

  /* Every recipe and every exclusion must still name a census tool with a health-claiming flag. */
  for (const r of RECIPES) {
    const s = flagExitShape(readFileSync(join(REPO, r.tool), 'utf8'), r.tool, parse);
    ok(`${r.tool} is still in the census with a claiming flag`, s.risk !== null && s.claiming.length > 0);
    const lines = markerLines(readFileSync(join(REPO, r.tool), 'utf8'), r.marker);
    ok(`${r.tool} marker occurs only below :${s.risk ? s.risk.line : '?'}`, lines.length > 0 && lines.every((l) => l > s.risk.line));
  }
  for (const u of UNDRIVEN) {
    const p = join(REPO, 'tools', `${u.slug}.mjs`);
    const s = flagExitShape(readFileSync(p, 'utf8'), u.slug, parse);
    ok(`${u.slug} is still in the census`, s.risk !== null && s.claiming.length > 0);
  }

  /* The grep-credit safeguard: no excluded tool may appear here in the spelling the census greps. */
  /* Read THIS module by its own URL, never by a hardcoded name: a copy under another filename
     would otherwise read the original and report the original's safeguard as its own. */
  const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const u of UNDRIVEN) {
    ok(`${u.slug} is named as a slug, so the census credits it nothing`, !new RegExp(`tools/${u.slug}\\.mjs`).test(selfSrc));
  }

  /* PLANT · a wrong expected code must FAIL the leg, so a passing leg can fail. */
  const plant = { ...RECIPES.find((r) => r.tool === 'tools/pat-window-scaling.mjs'), code: 7 };
  const bad = driveOne(plant, parse);
  ok('PLANT · a child exiting other than the stated code fails the leg', bad.legs.exitedAsStated === false && allLegsPass(bad) === false);

  /* CONTROL · the same recipe with its real code passes, so the plant above moved one thing. */
  const good = driveOne(
    RECIPES.find((r) => r.tool === 'tools/pat-window-scaling.mjs'),
    parse
  );
  ok('CONTROL · the unmodified recipe drives the tool past its risk', allLegsPass(good) === true);

  /* The object is only arithmetically valid over the FULL recipe set, because `checked + excluded`
     must equal `eligible`. So the schema leg replicates one result rather than driving eight again. */
  const V = createRequire(import.meta.url)(join(REPO, 'verdict.js'));
  ok('verdict.js accepts the emitted verdict', V.validate(verdict(RECIPES.map(() => good))).ok === true);
  ok('verdict.js accepts the NOT_RUN object', V.validate(noParserVerdict()).ok === true);
  ok('an absent parser emits NOT_RUN over an empty population', noParserVerdict().status === 'NOT_RUN' && noParserVerdict().population.eligible === 0);

  /* This driver holds its whole program in `main()`, so it never wears the shape it drives. */
  const self = flagExitShape(selfSrc, 'flag-exit-drive.mjs', parse);
  ok('the driver does not wear the shape it reports', self.parsed === true && self.risk === null);

  console.log(fail ? `flag-exit-drive selftest: ${pass} passed, ${fail} failed` : `all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}

/* ── entry ─────────────────────────────────────────────────────────────────────────────────────────
   The whole program sits in `main()` behind the entry guard, exactly as `flag-exit-scan.mjs` does,
   so module scope evaluates nothing a flag can skip and this file stays out of its own census. */
function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--selftest', '--verdict-sample', '--help'] }, { tool: 'flag-exit-drive' });
  if (argv.includes('--help')) {
    console.log('usage: node tools/flag-exit-drive.mjs [--json | --selftest | --verdict-sample | --help]');
    process.exit(0);
  }
  const parse = jsParse();
  if (argv.includes('--selftest')) selftest(parse);
  if (!parse) {
    console.log(JSON.stringify(noParserVerdict()));
    process.exit(2);
  }

  const results = RECIPES.map((r) => driveOne(r, parse));
  const v = verdict(results);
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ results, undriven: UNDRIVEN, verdict: v }, null, 2));
    process.exit(v.status === 'PASS' ? 0 : 1);
  }
  report(results);
  console.log(JSON.stringify(v));
  /* UNKNOWN is exit 2 — it could not look. A real drive failure is exit 1. */
  process.exit(v.status === 'PASS' ? 0 : v.status === 'UNKNOWN' ? 2 : 1);
}

if (isCliEntry(import.meta.url)) main();
