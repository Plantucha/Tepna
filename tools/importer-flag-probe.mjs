#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * importer-flag-probe.mjs — DOES AN IMPORTER'S FLAG FIRE AN IMPORTED TOOL'S SELFTEST. Executable,
 * paired against a control, and bounded to tools whose closure cannot write, exec or fetch.
 *
 * WHY. Residue `2026-10-21-a-module-scope-selftest-reads-the-importers-flags`: twenty tools read
 * `--selftest` at module scope, so the flags of whoever runs the process decide, and an importer's
 * flag fires the imported tool's selftest. #3853 swapped the `main` guard to `isCliEntry`, and the
 * module-scope read sits ABOVE that guard, so the swap left it alone.
 *
 * WHY A PROBE AND NOT THE RENAME CONTROL. Residue
 * `2026-10-21-the-rename-probe-cannot-witness-a-module-scope-selftest`: #3853's paired control copies
 * a tool under a second filename and accepts OUTPUT as proof the entry guard works. A tool that
 * prints at module scope prints under either name, because the print happens before the guard runs,
 * so that control reads green whatever the guard says. The accept test here is the opposite one:
 * SILENCE while the flag is set and the entry is somebody else.
 *
 * THE INSTRUMENT. Two children per tool, same harness, same environment:
 *
 *   control   node <tmp>/harness.mjs              ← imports the tool, no flag
 *   probe     node <tmp>/harness.mjs --selftest   ← imports the tool with the flag in ARGV
 *
 * The harness is the entry in both, so `isCliEntry(import.meta.url)` is false inside the tool. A tool
 * whose read is guarded is silent in both. A tool whose read is not runs its selftest in the probe.
 *
 * A NOISY CONTROL IS UNDECIDED, NEVER A PASS (CLAUDE.md §4b). A tool that prints or throws on a bare
 * import says nothing about the flag: both children carry the same output and the comparison examined
 * nothing. Those land in `excluded` with that reason, and the static reading is printed beside them.
 *
 * SAFETY, AND WHY THE OBVIOUS BOUND LEFT THE PROBE EMPTY. Importing a tool runs its module scope, and
 * on an unguarded tool that fires its selftest. The first cut here reused `argv-survey.mjs`'s bound —
 * no write, exec or network call anywhere in the transitive local import closure — and measured
 * 2026-10-21 it excluded 23 of 24 candidates, leaving `strip-markup.mjs` as the whole population: a
 * PASS over one tool, which is the §4b family (a filter that examined almost nothing reporting
 * success). Nearly every candidate imports `verdict-emit.mjs`, which execs git for a short sha, so the
 * closure bound and this population are all but disjoint.
 *
 * The bound that fits the operation is the SANCTION, not the closure. What the probe triggers is the
 * tool's OWN SELFTEST, and `tools/selftest-all.mjs` runs that selftest on every `npm run check`. So a
 * tool whose selftest the gate already runs is in the population, hazards and all — measured
 * 2026-10-21, `declaresSelftest` discovers all 24 candidates. A tool the gate does NOT run stays
 * excluded by the closure bound, which is still imported from `argv-survey.mjs` rather than restated.
 * Every child runs with `DEX_UPLOADS` scrubbed, and the tree is diffed around every probe: a moved
 * tree makes the whole run UNKNOWN rather than failing a tool, because the sanction says these runs
 * write nothing, so a diff means something else did.
 *
 *   node tools/importer-flag-probe.mjs                  # probe the safe population, print the table
 *   node tools/importer-flag-probe.mjs --json           # the tepna.verdict/1 object + every row
 *   node tools/importer-flag-probe.mjs --only wt-done.mjs
 *   node tools/importer-flag-probe.mjs --tools-dir <dir> # read another checkout's tools (a BEFORE run)
 *   node tools/importer-flag-probe.mjs --selftest       # planted truth: a guarded tool and a bare one
 *   node tools/importer-flag-probe.mjs --verdict-sample # a sample object, probes nothing
 * ════════════════════════════════════════════════════════════════════════ */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { closureHazards } from './argv-survey.mjs';
import { declaresSelftest } from './selftest-all.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IS_MAIN = isCliEntry(import.meta.url);
const TIMEOUT_MS = 25000;
export const FIRE_BAR = 0;

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/* ── the static reading ────────────────────────────────────────────────────────────────────────────
   THREE SPELLINGS, NOT ONE. The row above states its population as 20 tools, from an anchored grep for
   `^if (process.argv.includes('--selftest')`. That anchor is narrower than the defect: measured
   2026-10-21 over `tools/*.mjs` at bfe372987, three more module-scope reads fire the same way and the
   anchor sees none of them — `browser-lane.mjs` reads `process.argv.slice(2).includes(…)`,
   `secret-scan.mjs` reads the flag in the second arm of a column-0 `else if` chain whose LAST arm
   carries the guard, and `build-analysis.mjs` binds the read to a module-scope `const` and fires on it
   85 lines later. A population taken from one spelling of a defect is a population of that spelling. */
export const SPELLINGS = [
  ['includes', /^(?:\} else )?if \((?:\()?process\.argv\.includes\((['"])--self-?test\1\)/],
  ['slice-includes', /^(?:\} else )?if \((?:\()?process\.argv\.slice\(2\)\.includes\((['"])--self-?test\1\)/],
  ['const-bound', /^(?:const|let|var) ([A-Z_][A-Z0-9_]*) = process\.argv(?:\.slice\(2\))?\.includes\((['"])--self-?test\2\)/]
];

/** Column-0 reads of the selftest flag, with whether each one is paired with an entry guard. */
export function moduleScopeFlagReads(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [spelling, re] of SPELLINGS) {
      const m = re.exec(line);
      if (!m) continue;
      if (spelling === 'const-bound') {
        /* The read itself cannot be guarded — a const binding is not a branch — so the firing SITE is
           what carries the guard, and a binding nothing fires on is no hazard at all. */
        const name = m[1];
        const fires = lines.map((l, j) => [l, j]).filter(([l]) => new RegExp(`^if \\(${name}\\b`).test(l));
        if (!fires.length) break;
        out.push({ line: fires[0][1] + 1, spelling, text: fires[0][0], guarded: fires.every(([l]) => l.includes('isCliEntry(import.meta.url)')) });
        break;
      }
      out.push({ line: i + 1, spelling, text: line, guarded: line.includes('isCliEntry(import.meta.url)') });
      break;
    }
  }
  return out;
}

/* ── THE EXCLUSION THIS PROBE BOUGHT WITH ONE RUN ─────────────────────────────────────────────────
   Measured 2026-10-21: the control child — a bare import, no flag — of `tools/verify-fixtures.mjs`
   printed `▸ re-running every fixture through the real suite` and was cut off by the 25 s leash. That
   tool's whole main body sits at column 0 behind `const IS_CLI` used on ONE line (its argv refusal),
   so an import runs the corpus verification, and line 456 writes `provenance/<App>.json`. CLAUDE.md §🔒
   names that file the only writer of `verifiedUnder`, and an importer is not it. Nothing was written
   here (the tree was diffed and did not move), and the row for it is
   `2026-10-21-importing-the-fixture-verifier-runs-its-whole-verification`.
   So candidacy and the gate's sanction are not enough: a tool whose OWN file can write, exec or fetch
   and whose module scope holds an action line naming no entry guard is never imported. The selftest
   plants both directions, because an exclusion nothing excludes would be a silent change of
   population. */
const ENTRY_TOKENS = /\b(isCliEntry|IS_CLI|IS_MAIN|DIRECT|INVOKED_DIRECTLY|POOL_IS_CLI|isDirect|isMain)\b/;
const ACTION_LINE = /^(?:if|for|while|await|try|switch|do)\b|^[A-Za-z_$][\w$.]*\(/;
const OWN_HAZARD =
  /\b(writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync|unlinkSync|renameSync|cpSync|copyFileSync|execSync|execFileSync|spawnSync|spawn|execFile|fork|fetch|request)\s*\(/;

/** Column-0 action lines that name no entry guard, in a file that can itself write, exec or fetch. */
export function unguardedModuleWork(src) {
  const text = String(src || '');
  if (!OWN_HAZARD.test(text)) return [];
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ACTION_LINE.test(line) || ENTRY_TOKENS.test(line)) continue;
    if (/process\.argv/.test(line)) continue; // an argv read is the question above, not module work
    out.push({ line: i + 1, text: line.slice(0, 120) });
  }
  return out;
}

/** Tools with a module-scope read, and whether each one is safe to import. */
export function scanTools(toolsDir) {
  const out = [];
  for (const name of readdirSync(toolsDir)
    .filter((f) => /\.mjs$/.test(f))
    .sort()) {
    const p = join(toolsDir, name);
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    const reads = moduleScopeFlagReads(text);
    if (!reads.length) continue;
    /* `sanctioned` is the gate's own decision about this tool: `selftest-all.mjs` runs the selftest of
       every tool its predicate discovers, so firing that selftest here adds no operation the gate does
       not already perform on every run. */
    out.push({ name, path: p, reads, hazards: closureHazards(p), sanctioned: declaresSelftest(text), moduleWork: unguardedModuleWork(text) });
  }
  return out;
}

/* ── the runtime probe ─────────────────────────────────────────────────────────────────────────── */

/** A harness directory whose entry imports one tool by URL from the environment. */
export function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'importer-flag-'));
  writeFileSync(join(dir, 'harness.mjs'), 'await import(process.env.IFP_TOOL_URL);\n');
  return dir;
}

const treeState = () => spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';

function runHarness(harnessDir, toolAbs, args) {
  const env = { ...process.env, IFP_TOOL_URL: pathToFileURL(toolAbs).href };
  delete env.DEX_UPLOADS; // never let a probe reach the real corpus
  const r = spawnSync(process.execPath, [join(harnessDir, 'harness.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env,
    maxBuffer: 8 << 20
  });
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  return { exit: timedOut ? null : r.status, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: !!timedOut };
}

/** Pure, so the planted-truth selftest asserts the DECISION and not a subprocess. */
export function classifyProbe({ control, probe }) {
  if (control.timedOut || probe.timedOut) return 'UNDECIDED-timeout';
  if (control.out !== '' || control.exit !== 0) return 'UNDECIDED-noisy-control';
  if (probe.out === '' && probe.exit === 0) return 'SILENT';
  return 'FIRES';
}

export function probeOne(toolAbs, harnessDir, { watchTree = false } = {}) {
  const before = watchTree ? treeState() : '';
  const control = runHarness(harnessDir, toolAbs, []);
  const probe = runHarness(harnessDir, toolAbs, ['--selftest']);
  return {
    verdict: classifyProbe({ control, probe }),
    exit: { control: control.exit, probe: probe.exit },
    treeMoved: watchTree ? treeState() !== before : false,
    probeHead: probe.out.split('\n').slice(0, 2).join(' ⏎ ').slice(0, 160)
  };
}

/* ── the verdict ───────────────────────────────────────────────────────────────────────────────── */
export function probeVerdict(rows, { bar = FIRE_BAR, commit } = {}) {
  const tally = rows.reduce((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] || 0) + 1 }), {});
  const fires = tally.FIRES || 0;
  const undecided = (tally['UNDECIDED-timeout'] || 0) + (tally['UNDECIDED-noisy-control'] || 0) + (tally['EXCLUDED-can-write'] || 0) + (tally['EXCLUDED-module-work'] || 0);
  const checked = rows.length - undecided;
  let status = fires > bar ? 'FAIL' : 'PASS';
  let reason = fires > bar ? `${fires} tool(s) run their selftest on an importer's flag, over the bar of ${bar}` : null;
  if (checked === 0) {
    status = 'NOT_RUN';
    reason = rows.length === 0 ? 'no tool was probed' : `all ${rows.length} candidate(s) were excluded, so the flag was never put to a tool`;
  }
  const unguarded = rows.filter((r) => r.reads && r.reads.some((d) => !d.guarded)).map((r) => r.name);
  const moved = rows.filter((r) => r.treeMoved).map((r) => r.name);
  if (moved.length) {
    status = 'UNKNOWN';
    reason = `the working tree moved during the run (${moved.join(', ')}) — re-run in a clean checkout before reading this`;
  }
  return makeVerdict({
    gate: 'importer-flag-probe',
    status,
    population: { checked, eligible: rows.length, excluded: undecided },
    criterion: { name: 'tools_whose_selftest_fires_on_an_importers_flag', threshold: bar, unit: 'tools', direction: 'lte' },
    /* §∅ at the verdict layer: NOT_RUN carries no result, because a tally of zero over nothing
       examined is not a measurement of zero. */
    result: checked === 0 ? null : { fires, tally, unguardedByText: unguarded.length, unguarded },
    evidence: ['tools/importer-flag-probe.mjs'],
    reason,
    tool: 'tools/importer-flag-probe.mjs',
    commit
  });
}

/* ── planted truth ─────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let bad = 0;
  let ran = 0;
  const ok = (name, cond, detail) => {
    ran++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : `  — ${detail}`}`);
    if (!cond) bad++;
  };

  /* (1) the DECISION over recorded runs. */
  const R = (exit, out, timedOut = false) => ({ exit, out, timedOut });
  ok('silent under the flag ⇒ SILENT', classifyProbe({ control: R(0, ''), probe: R(0, '') }) === 'SILENT');
  ok('output under the flag ⇒ FIRES', classifyProbe({ control: R(0, ''), probe: R(0, '✓ all 9 selftests passed\n') }) === 'FIRES');
  ok('a non-zero exit under the flag ⇒ FIRES, with no output at all', classifyProbe({ control: R(0, ''), probe: R(1, '') }) === 'FIRES');
  ok('a control that prints ⇒ UNDECIDED, never SILENT', classifyProbe({ control: R(0, 'scanning…\n'), probe: R(0, 'scanning…\n') }) === 'UNDECIDED-noisy-control');
  ok('a control that throws ⇒ UNDECIDED, never FIRES', classifyProbe({ control: R(1, 'Error: boom\n'), probe: R(1, 'Error: boom\n') }) === 'UNDECIDED-noisy-control');
  ok('a timeout ⇒ UNDECIDED', classifyProbe({ control: R(null, '', true), probe: R(null, '', true) }) === 'UNDECIDED-timeout');

  /* (2) the static reading, over the three spellings the defect wears. */
  const reads = (s) => moduleScopeFlagReads(s);
  ok(
    'bare includes ⇒ one unguarded read',
    (() => {
      const r = reads("if (process.argv.includes('--selftest')) {\n");
      return r.length === 1 && r[0].spelling === 'includes' && !r[0].guarded;
    })()
  );
  ok('paired with the entry guard ⇒ guarded', reads("if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {\n")[0].guarded === true);
  ok(
    'the or-form carries its guard outside the parens',
    reads("if ((process.argv.includes('--selftest') || process.argv.includes('--self-test')) && isCliEntry(import.meta.url)) {\n")[0].guarded === true
  );
  ok('slice(2).includes is the same read', reads("if (process.argv.slice(2).includes('--selftest')) {\n")[0].spelling === 'slice-includes');
  ok('the second arm of an else-if chain is column 0 too', reads("} else if (process.argv.includes('--selftest')) {\n")[0].spelling === 'includes');
  ok(
    'a const binding is read at its FIRING site',
    (() => {
      const r = reads("const SELFTEST = process.argv.includes('--selftest');\nconst x = 1;\nif (SELFTEST) selftest();\n");
      return r.length === 1 && r[0].spelling === 'const-bound' && r[0].line === 3 && !r[0].guarded;
    })()
  );
  ok('…and a guarded firing site is guarded', reads("const SELFTEST = process.argv.includes('--selftest');\nif (SELFTEST && isCliEntry(import.meta.url)) selftest();\n")[0].guarded === true);
  /* CONTROL. A binding nothing fires on is not this defect, and counting it would put tools with no
     hazard into the population and dilute every figure the table prints. */
  ok('CONTROL · a const nothing fires on is no read', reads("const SELFTEST = process.argv.includes('--selftest');\nif (OTHER) go();\n").length === 0);
  /* CONTROL. An INDENTED read is inside a function, which runs when the function is called, so the
     importer's flags never reach it. Anchoring at column 0 is the whole discrimination. */
  ok('CONTROL · an indented read is not module scope', reads("function main() {\n  if (process.argv.includes('--selftest')) go();\n}\n").length === 0);
  ok('CONTROL · a usage comment is not a read', reads(' *   node tools/x.mjs --selftest\n').length === 0);

  /* (3) END TO END on two tools written for the purpose. Without this, "nobody fires" would be a
         property of the harness. */
  const dir = mkdtempSync(join(tmpdir(), 'importer-flag-planted-'));
  const guardUrl = JSON.stringify(join(HERE, 'argv-guard.mjs'));
  writeFileSync(join(dir, 'bare.mjs'), "if (process.argv.includes('--selftest')) {\n  console.log('✓ all 1 selftests passed');\n}\n");
  writeFileSync(
    join(dir, 'guarded.mjs'),
    `import { isCliEntry } from ${guardUrl};\nif (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {\n  console.log('✓ all 1 selftests passed');\n}\n`
  );
  writeFileSync(join(dir, 'noisy.mjs'), "console.log('I print on import');\n");
  const h = makeHarness();
  ok('PLANTED BARE tool is seen to FIRE', probeOne(join(dir, 'bare.mjs'), h).verdict === 'FIRES');
  ok('PLANTED GUARDED tool is seen SILENT', probeOne(join(dir, 'guarded.mjs'), h).verdict === 'SILENT');
  ok('PLANTED NOISY tool is UNDECIDED, not SILENT', probeOne(join(dir, 'noisy.mjs'), h).verdict === 'UNDECIDED-noisy-control');
  /* THE RENAME CONTROL'S BLIND SPOT, demonstrated rather than argued: the bare tool prints under its
     own name too, so an accept test made of OUTPUT cannot tell the two planted tools apart. */
  const underOwnName = (f) => spawnSync(process.execPath, [join(dir, f), '--selftest'], { encoding: 'utf8', timeout: TIMEOUT_MS });
  ok(
    'the rename control cannot discriminate: both print under their own name',
    underOwnName('bare.mjs').stdout.includes('selftests passed') && underOwnName('guarded.mjs').stdout.includes('selftests passed')
  );

  /* (4) the safety bound, and that the scan reads a directory. CANDIDACY ALL BUT IMPLIES THE SANCTION:
         the read that makes a tool a candidate is the same call `selftest-all.mjs` discovers, so the
         closure bound decides only the one spelling that predicate misses — the hyphenated
         `--self-test`, which that file tracks separately as a near miss. Both halves get a plant. */
  writeFileSync(join(dir, 'writer.mjs'), "import { writeFileSync } from 'node:fs';\nif (process.argv.includes('--selftest')) writeFileSync('x', '');\n");
  writeFileSync(join(dir, 'hyphen.mjs'), "import { writeFileSync } from 'node:fs';\nif (process.argv.includes('--self-test')) writeFileSync('x', '');\n");
  const scanned = scanTools(dir);
  const by = (n) => scanned.find((x) => x.name === n) || {};
  ok('the scan finds the planted CANDIDATES, and a tool with no read is not one', scanned.length === 4 && !scanned.some((x) => x.name === 'noisy.mjs'), scanned.map((x) => x.name).join(' '));
  ok('a tool that writes carries a hazard', by('writer.mjs').hazards.length > 0);
  ok('…and a bare printer carries none', by('bare.mjs').hazards.length === 0);
  ok('a hazardous tool the GATE ALREADY RUNS is sanctioned, so the hazard does not exclude it', by('writer.mjs').sanctioned === true);
  ok('the hyphenated spelling is a candidate the gate does NOT run, so its hazard excludes it', by('hyphen.mjs').sanctioned === false && by('hyphen.mjs').hazards.length > 0);
  /* THE MODULE-WORK EXCLUSION, both directions. The positive is the real shape that bought it. */
  ok(
    'a column-0 action line in a file that can write ⇒ module work',
    unguardedModuleWork("import { writeFileSync } from 'node:fs';\nconst CHECK = 1;\nif (CHECK) {\n  writeFileSync('x', '');\n}\n").length === 1
  );
  ok(
    '…and the line it names is the column-0 branch, not the write inside it',
    unguardedModuleWork("import { writeFileSync } from 'node:fs';\nconst CHECK = 1;\nif (CHECK) {\n  writeFileSync('x', '');\n}\n")[0].line === 3
  );
  ok('CONTROL · the same line under an entry guard is not module work', unguardedModuleWork("import { writeFileSync } from 'node:fs';\nif (IS_CLI) {\n  writeFileSync('x', '');\n}\n").length === 0);
  ok('CONTROL · a file that cannot write has no module work to refuse', unguardedModuleWork("const CHECK = 1;\nif (CHECK) {\n  console.log('pure');\n}\n").length === 0);
  ok(
    'CONTROL · an argv read is the question above, not module work',
    unguardedModuleWork("import { writeFileSync } from 'node:fs';\nif (process.argv.includes('--selftest')) writeFileSync('x', '');\n").length === 0
  );
  ok(
    'the real shape that bought this exclusion is caught',
    (() => {
      const w = unguardedModuleWork(readFileSync(join(HERE, 'verify-fixtures.mjs'), 'utf8'));
      return w.length > 0;
    })(),
    'tools/verify-fixtures.mjs acts at module scope'
  );

  /* (5) the verdict's arithmetic and its refusals. */
  const rows = [
    { verdict: 'SILENT', reads: [{ guarded: true }], name: 'a' },
    { verdict: 'FIRES', reads: [{ guarded: false }], name: 'b' },
    { verdict: 'UNDECIDED-noisy-control', reads: [{ guarded: true }], name: 'c' }
  ];
  const v = probeVerdict(rows, { bar: 5, commit: null });
  ok('population balances: checked + excluded = eligible', v.population.checked + v.population.excluded === v.population.eligible, JSON.stringify(v.population));
  ok('under the bar ⇒ PASS', v.status === 'PASS', v.status);
  ok(
    'over the bar ⇒ FAIL with a reason',
    (() => {
      const f = probeVerdict(rows, { bar: 0, commit: null });
      return f.status === 'FAIL' && !!f.reason;
    })()
  );
  ok('the unguarded names ride the result', probeVerdict(rows, { bar: 5, commit: null }).result.unguarded.join() === 'b');
  ok('a moved tree ⇒ UNKNOWN, not a result about the tools', probeVerdict([{ verdict: 'SILENT', reads: [{ guarded: true }], name: 't', treeMoved: true }], { commit: null }).status === 'UNKNOWN');
  ok(
    'nothing probed ⇒ NOT_RUN with no result',
    (() => {
      const n = probeVerdict([], { commit: null });
      return n.status === 'NOT_RUN' && n.result === null;
    })()
  );
  ok(
    'every candidate excluded ⇒ NOT_RUN, never PASS',
    (() => {
      const n = probeVerdict([{ verdict: 'EXCLUDED-can-write', reads: [{ guarded: true }], name: 'w' }], { commit: null });
      return n.status === 'NOT_RUN' && /never put to a tool/.test(n.reason);
    })()
  );

  console.log(`\n${bad ? `✗ ${bad} of ${ran} failed` : `✓ all ${ran} selftests passed`}`);
  return bad ? 1 : 0;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────── */
if (IS_MAIN) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json'], valued: ['--only', '--tools-dir'] }, { tool: 'tools/importer-flag-probe.mjs' });

  if (flag('--selftest')) process.exit(selftest());

  if (flag('--verdict-sample')) {
    console.log(JSON.stringify(probeVerdict([{ verdict: 'SILENT', reads: [{ guarded: true }], name: 'sample' }]), null, 1));
    process.exit(0);
  }

  const only = opt('--only', null);
  const toolsDir = resolve(opt('--tools-dir', join(ROOT, 'tools')));
  const candidates = scanTools(toolsDir).filter((c) => !only || c.name === only);
  if (only && candidates.length === 0) {
    console.error(`✗ importer-flag-probe: ${only} has no module-scope selftest read in ${toolsDir}`);
    process.exit(2);
  }

  const harness = makeHarness();
  const MARK = { SILENT: '✓', FIRES: '⚠', 'UNDECIDED-noisy-control': '⊘', 'UNDECIDED-timeout': '⊘', 'EXCLUDED-can-write': '·', 'EXCLUDED-module-work': '·' };
  const rows = [];
  for (const c of candidates) {
    const unguarded = c.reads.filter((r) => !r.guarded).length;
    /* THE RUNG THAT ADMITS MORE HAZARD WINS: unguarded module work is refused before the sanction is
       consulted, because the sanction speaks for the SELFTEST and that work is not it. */
    let row;
    if (c.moduleWork.length) {
      row = { verdict: 'EXCLUDED-module-work', exit: { control: null, probe: null }, probeHead: `acts at module scope with no entry guard (first: line ${c.moduleWork[0].line})` };
    } else if (c.hazards.length && !c.sanctioned) {
      row = { verdict: 'EXCLUDED-can-write', exit: { control: null, probe: null }, probeHead: `${c.hazards.join(',')} and no selftest the gate runs` };
    } else {
      row = probeOne(c.path, harness, { watchTree: true });
    }
    rows.push({ ...row, name: c.name, reads: c.reads, hazards: c.hazards, sanctioned: c.sanctioned, moduleWork: c.moduleWork.length });
    if (!flag('--json')) {
      console.log(`${MARK[row.verdict] || '?'} ${row.verdict.padEnd(24)} ${c.name.padEnd(34)} text:${unguarded ? `${unguarded} unguarded` : 'guarded'.padEnd(11)} ${row.probeHead || ''}`.trimEnd());
    }
  }
  const verdict = probeVerdict(rows);
  if (flag('--json')) {
    console.log(JSON.stringify({ verdict, rows }, null, 1));
  } else {
    console.log(`\n--- ${rows.length} candidate(s), ${verdict.population.checked} probed: ${JSON.stringify(verdict.result ? verdict.result.tally : {})}`);
    console.log(`--- ${verdict.status}: fires ${verdict.result ? verdict.result.fires : 'n/a'} against a bar of ${FIRE_BAR}${verdict.reason ? ` — ${verdict.reason}` : ''}`);
    console.log('--- a FIRES row runs its selftest because somebody else passed the flag; the static column is the same question read from the source.');
  }
  process.exit(verdict.status === 'FAIL' ? 1 : 0);
}
