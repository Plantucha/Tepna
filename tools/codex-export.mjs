/**
 * tools/codex-export.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * THE SOURCE-ONLY EXPORT AN EXTERNAL READER MAY SEE. Owner ruling 2026-10-04: an external model (Codex)
 * may read SOURCE, never the CORPUS. Until this tool the rule lived in a relay message and in each session's
 * shell, and the hand-built export it described used `-C <worktree>` — which carries a git-tracked
 * `uploads/` (735 files) and test fixtures with captured device frames. This builds the export from git,
 * omits what must not leave the box, and VERIFIES the omission before printing the directory.
 *
 * OMITTED, always:
 *   · the data and record trees: uploads/ provenance/ audits/ briefs/ docs/ docs-archive/ papers/ changes/
 *   · every `capture-host/tests` path whose class in `capture-host/tests/FIXTURE-PROVENANCE.json` is
 *     `captured` or `derived` — device frames, real addresses, host output, a real night's values.
 * Kept: code, tests whose bytes were built in the test, and the root orientation docs a reader needs.
 *
 * ⚠️ REAL DEVICE ADDRESSES ARE NOT SCANNED FOR in the exported source. They are already public in this
 * repo (briefs, `ble_sniff.py`, a udev rule), so a refusal on them would refuse every export; the registry
 * classifies the TEST files that carry them, and those are omitted.
 *
 *   node tools/codex-export.mjs [--ref <rev>] [--out <dir>]     # prints the export dir; exit 1 on refusal
 *   node tools/codex-export.mjs --json [--cleanup]               # one tepna.verdict/1 on stdout
 *   node tools/codex-export.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OMIT_DIRS = ['uploads', 'provenance', 'audits', 'briefs', 'docs', 'docs-archive', 'papers', 'changes'];
export const REGISTRY = 'capture-host/tests/FIXTURE-PROVENANCE.json';
export const WITHHELD = ['captured', 'derived'];

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

/** The repo paths this export must not contain, read from the registry AT `ref`. Pure given the text. */
export function withheldPaths(registryText) {
  const reg = JSON.parse(registryText);
  return Object.entries(reg.entries || {})
    .filter(([, e]) => WITHHELD.includes(e.class))
    .map(([p]) => `capture-host/tests/${p}`)
    .sort();
}

/** Every file under `dir`, relative, sorted. */
function walk(dir) {
  const out = [];
  const go = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) go(p);
      else out.push(relative(dir, p));
    }
  };
  go(dir);
  return out.sort();
}

/** What in an export dir breaks the rule. Pure given the listing; empty means clean. */
export function leaks(files, withheld) {
  const bad = [];
  const w = new Set(withheld);
  for (const f of files) {
    const top = f.split('/')[0];
    if (OMIT_DIRS.includes(top)) bad.push(`${f} (under ${top}/)`);
    else if (w.has(f)) bad.push(`${f} (registry class withheld)`);
  }
  return bad;
}

/** No registry at `ref` means nobody can say which fixtures carry real bytes: refuse, export nothing. */
function noRegistry(ref, all) {
  const v = makeVerdict({
    gate: 'codex-export',
    tool: 'tools/codex-export.mjs',
    status: 'UNKNOWN',
    scope: 'internal',
    population: { checked: 0, eligible: all.length, excluded: all.length },
    criterion: { name: 'withheld_paths_in_export', threshold: 0, unit: 'files', direction: 'eq' },
    result: null,
    evidence: ['tools/codex-export.mjs'],
    reason: `${REGISTRY} does not exist at ${ref}, so which fixtures carry real bytes is unknown — nothing was exported`
  });
  return { dir: null, files: [], bad: [`no ${REGISTRY} at ${ref}`], verdict: v };
}

export function build({ ref = 'HEAD', out = null } = {}) {
  const all = git(['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean);
  if (!all.includes(REGISTRY)) return noRegistry(ref, all);
  const regText = git(['show', `${ref}:${REGISTRY}`]);
  const withheld = withheldPaths(regText);
  // `--out` names a directory that need not exist yet: `tar -x -C` into a missing one died as an EPIPE stack.
  const dir = out ? (mkdirSync(out, { recursive: true }), out) : mkdtempSync(join(tmpdir(), 'codex-export-'));
  const specs = ['.', ...OMIT_DIRS.map((d) => `:(exclude)${d}`), ...withheld.map((p) => `:(exclude)${p}`)];
  const tar = execFileSync('git', ['archive', '--format=tar', ref, '--', ...specs], { cwd: ROOT, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  const files = walk(dir);
  const bad = leaks(files, withheld);
  const excluded = all.length - files.length;
  const v = makeVerdict({
    gate: 'codex-export',
    tool: 'tools/codex-export.mjs',
    status: bad.length ? 'FAIL' : 'PASS',
    scope: 'internal',
    population: { checked: files.length, eligible: all.length, excluded },
    criterion: { name: 'withheld_paths_in_export', threshold: 0, unit: 'files', direction: 'eq' },
    result: { leaks: bad.length, exported: files.length, withheld_registry: withheld.length, omitted_dirs: OMIT_DIRS, dir },
    evidence: [REGISTRY, 'tools/codex-export.mjs'],
    reason: bad.length ? `the export holds ${bad.length} withheld file(s), e.g. ${bad.slice(0, 3).join('; ')}` : null
  });
  return { dir, files, bad, verdict: v };
}

/** The real-export checks. A refusal (`dir: null`) records its own reason as the failure and stops there:
 * every check below reads the exported tree, and `rmSync(null)` / `join(null, …)` threw a TypeError that
 * discarded that reason — the one message saying why nothing was exported. */
function checkExport(r, ok) {
  const v = r.verdict;
  ok(v.status === 'PASS', `the export of HEAD is clean (got ${v.status}: ${v.reason})`);
  if (!r.dir) return;
  try {
    ok(v.population.checked + v.population.excluded === v.population.eligible, 'checked + excluded = eligible');
    ok(!existsSync(join(r.dir, 'uploads')) && !existsSync(join(r.dir, 'audits')), 'no uploads/ or audits/ directory exists');
    ok(r.files.includes('tools/codex-export.mjs') && r.files.includes('CLAUDE.md'), 'code and root docs are present');
    const withheld = withheldPaths(readFileSync(join(ROOT, REGISTRY), 'utf8'));
    ok(withheld.length > 0 && withheld.every((p) => !existsSync(join(r.dir, p))), 'no withheld fixture was exported');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, what) => {
    ran += 1;
    if (!c) fail.push(what);
  };
  /* 1 · the pure leak check sees each kind, and nothing else */
  ok(leaks(['tools/a.mjs', 'capture-host/x.py'], []).length === 0, 'code passes');
  ok(leaks(['uploads/a.edf'], []).length === 1, 'an uploads/ file is a leak');
  ok(leaks(['audits/x.json', 'briefs/y.md'], []).length === 2, 'audits/ and briefs/ are leaks');
  ok(leaks(['capture-host/tests/test_oxyii.py'], ['capture-host/tests/test_oxyii.py']).length === 1, 'a withheld registry path is a leak');
  ok(leaks(['capture-host/tests/test_ok.py'], ['capture-host/tests/test_oxyii.py']).length === 0, 'an authored test is not');
  ok(leaks(['docsx/a.md'], []).length === 0, 'a prefix match is not a directory match');
  /* 2 · the registry reader returns repo paths for exactly the withheld classes */
  const reg = JSON.stringify({ entries: { 'a.py': { class: 'captured' }, 'b.py': { class: 'derived' }, 'c.py': { class: 'authored' } } });
  const w = withheldPaths(reg);
  ok(w.length === 2 && w[0] === 'capture-host/tests/a.py' && w[1] === 'capture-host/tests/b.py', 'captured + derived are withheld, authored is not');
  /* 3 · a ref with no registry refuses (UNKNOWN) and exports nothing — the root commit has none */
  const rootRef = git(['rev-list', '--max-parents=0', 'HEAD']).split('\n').filter(Boolean)[0];
  const none = build({ ref: rootRef });
  ok(none.verdict.status === 'UNKNOWN' && none.dir === null, 'no registry at the ref is UNKNOWN with no export');
  /* 4 · the REAL export of this tree: clean, an equality population, and spot checks both ways */
  checkExport(build({}), ok);
  /* 5 · A REFUSED export reports its own reason — it does not die in its cleanup (residue
     2026-10-05-codex-export-selftest-dies-in-its-own-cleanup). The refusal from section 3 is driven
     through the same check: exactly one failure, and it is the refusal's reason. */
  const seen = [];
  let threw = null;
  try {
    checkExport(none, (c, what) => {
      if (!c) seen.push(what);
    });
  } catch (e) {
    threw = e;
  }
  ok(threw === null && seen.length === 1 && seen[0].includes('does not exist at'), 'a refused export reports its reason, not a cleanup TypeError');
  /* 6 · `--out` into a directory that does not exist yet is created, not an EPIPE crash */
  const nested = join(mkdtempSync(join(tmpdir(), 'codex-export-out-')), 'a', 'b');
  let outErr = null;
  try {
    const o = build({ out: nested });
    ok(o.verdict.status === 'PASS' && o.dir === nested && existsSync(join(nested, 'CLAUDE.md')), 'an --out directory that does not exist is created and filled');
  } catch (e) {
    outErr = e;
  } finally {
    rmSync(join(nested, '..', '..'), { recursive: true, force: true });
  }
  ok(outErr === null, `--out into a missing directory does not throw (${outErr && outErr.code})`);
  if (fail.length) {
    console.error(`✗ codex-export selftest: ${fail.length} failed`);
    for (const f of fail) console.error(`    ${f}`);
    return 1;
  }
  console.log(`  codex-export: all ${ran} selftests passed`);
  return 0;
}

function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--cleanup', '--selftest'], valued: ['--ref', '--out'] }, { tool: 'codex-export' });
  if (argv.includes('--selftest')) return selftest();
  const val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
  const r = build({ ref: val('--ref') || 'HEAD', out: val('--out') });
  if (argv.includes('--json')) console.log(JSON.stringify(r.verdict));
  else {
    for (const b of r.bad) console.error(`  ✗ withheld file in the export: ${b}`);
    console.log(r.bad.length ? `✗ REFUSED — ${r.verdict.reason}; do not hand ${r.dir || 'anything'} to an external reader` : r.dir);
  }
  if (argv.includes('--cleanup') && r.dir) rmSync(r.dir, { recursive: true, force: true });
  return r.bad.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('codex-export.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
