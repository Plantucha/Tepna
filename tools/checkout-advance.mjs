#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// checkout-advance.mjs — say what blocks a fast-forward of a checkout, path by path, and which of
// those paths an advance would not change at all.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: GIT NAMES THE BLOCKERS AND REFUSES TO RANK THEM.
//
// A long-lived checkout falls behind the ref. Someone runs `git merge --ff-only origin/main` and
// gets:
//
//     error: The following untracked working tree files would be overwritten by merge:
//         handoffs/heron-acqstart.md
//         … 111 more …
//     Please move or remove them before you merge. Aborting
//
// Every line of that list reads the same. MEASURED on a two-clone fixture in this tool's own
// selftest: git lists a file whose bytes are IDENTICAL to the ref's copy beside one that holds
// work nobody else has. It is right to refuse both — it will not overwrite an untracked file it
// did not write, whatever is in it — but the refusal flattens two very different situations into
// one list, and the person reading it has no way to tell them apart without opening 112 files.
//
// So the list sits. The checkout stays 194 commits behind, the service that renders from it serves
// a stale tree, and the row that reports this stays open because the cheap half — deciding — was
// never done.
//
// THIS TOOL DECIDES NOTHING AND DELETES NOTHING. It reads a checkout, sorts every would-be blocker
// into one of four classes, and emits one `tepna.verdict/1`:
//
//   not-in-ref   the ref has no such path, so an advance cannot touch it — NOT a blocker
//   identical    the ref's blob equals the file on disk — a blocker whose removal loses NOTHING
//   differs      the file holds lines the ref's copy does not — removal loses those lines
//   unreadable   the comparison did not run (§∅) — a blocker, and never reported as identical
//
// THE ∅ RULE IS LOAD-BEARING HERE. "I could not read the ref's copy" and "the copies match" are
// one keystroke apart and opposite in consequence: one says delete freely, the other says someone
// must look. A path whose comparison did not complete is `unreadable` with `localOnlyLines: null`,
// counts as a blocker, and carries the reason. It is never defaulted into `identical`.
//
// A VACUOUS PASS IS REFUSED BY CONSTRUCTION. A checkout with no untracked path at all has nothing
// for the criterion to bind to, so it reports NOT_APPLICABLE rather than a PASS over a population
// of zero — the shape `verdict.js` refuses at the type level, written out here so the next reader
// does not "fix" it into a PASS.
//
// Usage:
//   node tools/checkout-advance.mjs                      # the primary checkout, against origin/main
//   node tools/checkout-advance.mjs --checkout <path> --ref <ref>
//   node tools/checkout-advance.mjs --json               # the verdict object alone
//   node tools/checkout-advance.mjs --selftest
//
// Removing anything it lists is the OWNER'S call. This tool writes nothing into the tree it reads.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Bytes above which the line comparison is not attempted — a handoff is kilobytes; a bundle is not. */
export const COMPARE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * THE CLASSIFIER. Pure: it reads three measurements and names the class, so every rule below is
 * testable without a disk.
 *
 * `inRef`      true | false | null (the lookup did not complete)
 * `identical`  true | false | null (the blob comparison did not complete)
 * `localOnlyLines`  a count, or null when it was not measured
 */
export function classifyPath(path, { inRef, identical, localOnlyLines = null, note = null } = {}) {
  if (inRef === false) return { path, class: 'not-in-ref', blocks: false, localOnlyLines: null, why: 'the ref has no such path — an advance cannot overwrite it' };
  if (inRef !== true) return { path, class: 'unreadable', blocks: true, localOnlyLines: null, why: note || 'the ref lookup did not complete — unknown, never assumed identical' };
  if (identical === true) return { path, class: 'identical', blocks: true, localOnlyLines: 0, why: 'byte-identical to the ref — removing it loses nothing' };
  if (identical === false)
    return {
      path,
      class: 'differs',
      blocks: true,
      localOnlyLines,
      why: localOnlyLines === null ? note || 'differs from the ref; the local-only lines were not counted' : `differs from the ref — ${localOnlyLines} line(s) exist only here`
    };
  return { path, class: 'unreadable', blocks: true, localOnlyLines: null, why: note || 'the blob comparison did not complete — unknown, never assumed identical' };
}

/** Lines present in the local text that no line of the ref text matches. Blank lines do not count. */
export function localOnlyLineCount(localText, refText) {
  const refSet = new Set(refText.split('\n').map((l) => l.trim()));
  let n = 0;
  for (const l of localText.split('\n')) {
    const t = l.trim();
    if (t && !refSet.has(t)) n++;
  }
  return n;
}

/**
 * THE VERDICT. `rows === null` means the checkout could not be read at all — NOT_RUN, not a clean
 * sheet. Status order matters: a checkout that is AHEAD can never fast-forward however tidy it is,
 * so that is decided before any path is weighed.
 */
export function advanceVerdict(rows, { checkout, ref, behind, ahead, dirtyTracked, commit = null, commitReason = null, at = null } = {}) {
  const base = {
    schema: 'tepna.verdict/1',
    gate: 'checkout-advance',
    scope: 'internal',
    criterion: { name: 'paths_blocking_fast_forward', threshold: 0, unit: 'paths', direction: 'lte' },
    evidence: ['tools/checkout-advance.mjs', `git status --porcelain -z --untracked-files=all (${ref})`],
    producedBy: { tool: 'tools/checkout-advance.mjs', commit, ...(commitReason ? { commitReason } : {}) },
    at: at || new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };

  if (rows === null || rows === undefined) {
    return { ...base, status: 'NOT_RUN', population: { checked: 0, eligible: 0, excluded: 0 }, result: null, reason: `the checkout at ${checkout} could not be read — nothing was examined` };
  }

  const unreadable = rows.filter((r) => r.class === 'unreadable');
  const identical = rows.filter((r) => r.class === 'identical');
  const differs = rows.filter((r) => r.class === 'differs');
  const notInRef = rows.filter((r) => r.class === 'not-in-ref');
  const blocking = rows.filter((r) => r.blocks);
  const localOnlyLinesTotal = differs.reduce((a, r) => a + (r.localOnlyLines || 0), 0);

  const population = { checked: rows.length - unreadable.length, eligible: rows.length, excluded: unreadable.length };
  const result = {
    checkout,
    ref,
    behind,
    ahead,
    dirtyTracked,
    untracked: rows.length,
    blocking: blocking.length,
    byClass: { identical: identical.length, differs: differs.length, unreadable: unreadable.length, 'not-in-ref': notInRef.length },
    localOnlyLinesTotal,
    paths: rows
  };

  if (ahead > 0) {
    return { ...base, status: 'FAIL', population, result, reason: `the checkout is ${ahead} commit(s) AHEAD of ${ref} — a fast-forward cannot succeed at any value of the criterion` };
  }
  if (behind === 0) {
    return { ...base, status: 'NOT_APPLICABLE', population, result: null, reason: `the checkout is level with ${ref} — there is no advance for a path to block` };
  }
  if (rows.length === 0 && dirtyTracked === 0) {
    return {
      ...base,
      status: 'NOT_APPLICABLE',
      population,
      result: null,
      reason: 'the checkout holds no untracked path and no modified tracked file, so the criterion has no population to bind to — a PASS over zero examined paths would be the examined-nothing shape'
    };
  }
  if (blocking.length > 0 || dirtyTracked > 0) {
    const parts = [];
    if (blocking.length)
      parts.push(
        `${blocking.length} untracked path(s) block the advance: ${identical.length} byte-identical (removing them loses nothing), ${differs.length} holding ${localOnlyLinesTotal} local-only line(s), ${unreadable.length} not compared`
      );
    if (dirtyTracked) parts.push(`${dirtyTracked} tracked file(s) are modified`);
    return { ...base, status: 'SHORTFALL', population, result, reason: parts.join('; ') };
  }
  return { ...base, status: 'PASS', population, result, reason: null };
}

// ── the impure half: one checkout, read through git, nothing written ─────────────────────────────

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** `{ behind, ahead, untracked[], dirtyTracked }`, or null when the checkout cannot be read. */
export function readCheckout(checkout, ref) {
  let counts;
  try {
    counts = git(checkout, ['rev-list', '--left-right', '--count', `HEAD...${ref}`])
      .trim()
      .split(/\s+/)
      .map(Number);
  } catch {
    return null;
  }
  if (counts.length !== 2 || counts.some((n) => !Number.isFinite(n))) return null;
  const [ahead, behind] = counts;

  let porcelain;
  try {
    porcelain = git(checkout, ['status', '--porcelain', '-z', '--untracked-files=all']);
  } catch {
    return null;
  }
  const entries = porcelain.split('\0').filter(Boolean);
  const untracked = [];
  let dirtyTracked = 0;
  for (const e of entries) {
    const code = e.slice(0, 2);
    const path = e.slice(3);
    if (code === '??') untracked.push(path);
    else dirtyTracked++;
  }
  return { ahead, behind, untracked, dirtyTracked };
}

/** Classify ONE untracked path against the ref. Reads lazily: a blob hash first, bytes only if needed. */
export function classifyAgainstRef(checkout, ref, path) {
  let refSha;
  try {
    refSha = git(checkout, ['rev-parse', '--verify', '--quiet', `${ref}:${path}`]).trim();
  } catch {
    return classifyPath(path, { inRef: false });
  }
  if (!refSha) return classifyPath(path, { inRef: false });

  let localSha;
  try {
    localSha = git(checkout, ['hash-object', '--', path]).trim();
  } catch (err) {
    return classifyPath(path, { inRef: true, identical: null, note: `the working copy could not be hashed (${String(err.message).split('\n')[0]})` });
  }
  if (localSha === refSha) return classifyPath(path, { inRef: true, identical: true });

  let size = null;
  try {
    size = statSync(join(checkout, path)).size;
  } catch {
    /* a file that vanished between the status and the stat is reported unmeasured, not as 0 */
  }
  if (size === null || size > COMPARE_MAX_BYTES) {
    return classifyPath(path, {
      inRef: true,
      identical: false,
      localOnlyLines: null,
      note:
        size === null
          ? 'differs from the ref; the working copy could not be sized, so its local-only lines were not counted'
          : `differs from the ref; ${size} bytes is over the ${COMPARE_MAX_BYTES}-byte lazy-read cap, so its local-only lines were not counted`
    });
  }
  try {
    const refText = git(checkout, ['show', `${ref}:${path}`]);
    const localText = readFileSync(join(checkout, path), 'utf8');
    return classifyPath(path, { inRef: true, identical: false, localOnlyLines: localOnlyLineCount(localText, refText) });
  } catch (err) {
    return classifyPath(path, { inRef: true, identical: false, localOnlyLines: null, note: `differs from the ref; the comparison did not complete (${String(err.message).split('\n')[0]})` });
  }
}

export function surveyCheckout(checkout, ref) {
  const st = readCheckout(checkout, ref);
  if (!st) return { state: null, rows: null };
  return { state: st, rows: st.untracked.map((p) => classifyAgainstRef(checkout, ref, p)) };
}

/** The primary checkout: the common git dir's parent. A worktree's own dir is not it. */
export function primaryCheckout(from = ROOT) {
  const common = resolve(from, git(from, ['rev-parse', '--git-common-dir']).trim());
  return dirname(common);
}

// ── selftest ─────────────────────────────────────────────────────────────────────────────────────

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (n, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ✓ ${n}`);
    } else {
      fail++;
      console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`);
    }
  };
  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const META = { checkout: '/x', ref: 'origin/main', behind: 10, ahead: 0, dirtyTracked: 0, commit: null, commitReason: 'selftest runs on injected data, not on a checkout' };

  console.log('classifyPath — the four classes');
  ok('a path absent from the ref blocks NOTHING', classifyPath('a', { inRef: false }).blocks === false);
  ok(
    'a byte-identical path DOES block, and says removing it loses nothing',
    (() => {
      const r = classifyPath('a', { inRef: true, identical: true });
      return r.class === 'identical' && r.blocks === true && /loses nothing/.test(r.why);
    })()
  );
  ok('a differing path carries its local-only line count', classifyPath('a', { inRef: true, identical: false, localOnlyLines: 7 }).localOnlyLines === 7);
  /* PLANT — ∅. An unfinished comparison is the one input that must never land in `identical`:
     the two readings are one keystroke apart and opposite in consequence. */
  ok(
    'an unfinished REF lookup is unreadable, never identical',
    (() => {
      const r = classifyPath('a', { inRef: null, identical: true });
      return r.class === 'unreadable' && r.blocks === true && r.localOnlyLines === null;
    })()
  );
  ok('an unfinished BLOB comparison is unreadable, never identical', classifyPath('a', { inRef: true, identical: null }).class === 'unreadable');
  ok('a differing path with no count says so instead of reporting 0', classifyPath('a', { inRef: true, identical: false, localOnlyLines: null }).localOnlyLines === null);

  console.log('localOnlyLineCount');
  ok('lines only in the local copy are counted', localOnlyLineCount('a\nb\nc\n', 'a\nc\n') === 1);
  ok('a reordered file has no local-only lines', localOnlyLineCount('b\na\n', 'a\nb\n') === 0);
  ok('blank lines are not local-only content', localOnlyLineCount('a\n\n\n', 'a\n') === 0);

  console.log('advanceVerdict — status before population');
  const rowsClean = [classifyPath('new.md', { inRef: false }), classifyPath('new2.md', { inRef: false })];
  const vPass = advanceVerdict(rowsClean, META);
  ok('nothing in the ref collides → PASS with reason null', vPass.status === 'PASS' && vPass.reason === null, vPass.status);
  ok('PASS examined the paths it passed over', vPass.population.checked === 2 && vPass.population.eligible === 2);
  ok('the PASS verdict validates', V.validate(vPass).ok, V.validate(vPass).errors.join(' | '));

  /* PLANT — the defect this tool exists for: a byte-identical file still blocks, and a verdict that
     reported it as clean would reproduce exactly the flattening git already does. */
  const vIdent = advanceVerdict([...rowsClean, classifyPath('same.md', { inRef: true, identical: true })], META);
  ok('ONE byte-identical path is still a blocker → SHORTFALL', vIdent.status === 'SHORTFALL' && vIdent.result.blocking === 1, vIdent.status);
  ok('and the reason separates the no-ops from the rest', /1 byte-identical/.test(vIdent.reason), vIdent.reason);
  ok('the SHORTFALL verdict validates', V.validate(vIdent).ok, V.validate(vIdent).errors.join(' | '));

  const vMix = advanceVerdict(
    [
      classifyPath('same.md', { inRef: true, identical: true }),
      classifyPath('mine.md', { inRef: true, identical: false, localOnlyLines: 4 }),
      classifyPath('huh.md', { inRef: null }),
      classifyPath('fresh.md', { inRef: false })
    ],
    META
  );
  ok('an unreadable path is EXCLUDED from checked, not counted as examined', vMix.population.checked === 3 && vMix.population.excluded === 1);
  ok('checked + excluded = eligible holds with an exclusion', vMix.population.checked + vMix.population.excluded === vMix.population.eligible);
  ok('the local-only lines are totalled across the differing paths', vMix.result.localOnlyLinesTotal === 4);
  ok('the mixed verdict validates', V.validate(vMix).ok, V.validate(vMix).errors.join(' | '));

  ok(
    'a checkout that could not be read is NOT_RUN with result null',
    (() => {
      const v = advanceVerdict(null, META);
      return v.status === 'NOT_RUN' && v.result === null && V.validate(v).ok;
    })()
  );
  ok(
    'a level checkout is NOT_APPLICABLE, not a PASS',
    (() => {
      const v = advanceVerdict(rowsClean, { ...META, behind: 0 });
      return v.status === 'NOT_APPLICABLE' && v.result === null && V.validate(v).ok;
    })()
  );
  /* PLANT — an AHEAD checkout cannot fast-forward however clean it is, so a tidy tree must not read
     as a PASS: the criterion is not what decides it. */
  ok(
    'an AHEAD checkout FAILs even with no blocker at all',
    (() => {
      const v = advanceVerdict(rowsClean, { ...META, ahead: 3 });
      return v.status === 'FAIL' && /AHEAD/.test(v.reason) && V.validate(v).ok;
    })()
  );
  ok(
    'an EMPTY tree is NOT_APPLICABLE, never a PASS over zero examined paths',
    (() => {
      const v = advanceVerdict([], META);
      return v.status === 'NOT_APPLICABLE' && V.validate(v).ok;
    })()
  );
  ok('a modified TRACKED file blocks on its own', advanceVerdict([], { ...META, dirtyTracked: 2 }).status === 'SHORTFALL');

  /* ── THE REAL-GIT LEG ───────────────────────────────────────────────────────────────────────────
     Every rule above is about a classification. This one is about git: it builds two clones, puts a
     byte-identical untracked file and a differing one in the stale clone, and MEASURES that
     `merge --ff-only` refuses over both. If git ever stopped refusing over the identical one, the
     `identical` class would be a fiction and this leg would say so. */
  const tmp = mkdtempSync(join(tmpdir(), 'ffblock-'));
  try {
    const up = join(tmp, 'up');
    mkdirSync(up, { recursive: true });
    git(up, ['init', '-q', '--initial-branch=main', '.']);
    git(up, ['config', 'user.email', 'selftest@example.invalid']);
    git(up, ['config', 'user.name', 'selftest']);
    writeFileSync(join(up, 'base.txt'), 'base\n');
    git(up, ['add', 'base.txt']);
    git(up, ['commit', '-qm', 'base']);
    execFileSync('git', ['clone', '-q', up, join(tmp, 'down')], { encoding: 'utf8' });
    const down = join(tmp, 'down');

    writeFileSync(join(up, 'same.txt'), 'line1\nline2\n');
    writeFileSync(join(up, 'diff.txt'), 'ref-version\n');
    git(up, ['add', 'same.txt', 'diff.txt']);
    git(up, ['commit', '-qm', 'two files']);

    writeFileSync(join(down, 'same.txt'), 'line1\nline2\n');
    writeFileSync(join(down, 'diff.txt'), 'ref-version\nLOCAL EXTRA\n');
    writeFileSync(join(down, 'mine-alone.txt'), 'nobody else has this\n');
    git(down, ['fetch', '-q', 'origin']);

    const { state, rows } = surveyCheckout(down, 'origin/main');
    ok('the stale clone reads behind, not ahead', state.behind === 1 && state.ahead === 0, JSON.stringify(state && { b: state.behind, a: state.ahead }));
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    ok('git classifies the byte-identical file as identical', byPath['same.txt'].class === 'identical', JSON.stringify(byPath['same.txt']));
    ok('the differing file is differs, with its one local-only line', byPath['diff.txt'].class === 'differs' && byPath['diff.txt'].localOnlyLines === 1, JSON.stringify(byPath['diff.txt']));
    ok('a file the ref never had blocks nothing', byPath['mine-alone.txt'].blocks === false);

    let ffOut = '';
    let ffFailed = false;
    try {
      git(down, ['merge', '--ff-only', 'origin/main']);
    } catch (err) {
      ffFailed = true;
      ffOut = String(err.stderr || '') + String(err.stdout || '');
    }
    ok('git REALLY refuses the fast-forward here', ffFailed, ffOut.slice(0, 120));
    /* The measurement the header rests on: git lists the no-op beside the real one. */
    ok('and git lists the byte-identical file among the blockers', /same\.txt/.test(ffOut), ffOut.slice(0, 200));
    ok('git never says which of them is a no-op', !/identical|no-op|unchanged/i.test(ffOut), ffOut.slice(0, 200));
    ok('the tool does say it', advanceVerdict(rows, { ...META, behind: state.behind, ahead: state.ahead, dirtyTracked: state.dirtyTracked }).result.byClass.identical === 1);
  } finally {
    execFileSync('rm', ['-rf', tmp]);
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} checkout-advance selftest — ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--json', '--selftest', '--verdict-sample'], valued: ['--checkout', '--ref'] }, { tool: 'checkout-advance.mjs' });
  if (argv.includes('--selftest')) {
    process.exit(selftest());
  }
  /* The checkout-free sample the adoption gate runs: the shape measured on the primary checkout on
     2026-10-28 in miniature — a byte-identical no-op and a file holding local-only lines, listed by
     git as one undifferentiated refusal. */
  if (argv.includes('--verdict-sample')) {
    const rows = [
      classifyPath('handoffs/sample-identical.md', { inRef: true, identical: true }),
      classifyPath('handoffs/sample-differs.md', { inRef: true, identical: false, localOnlyLines: 7 }),
      classifyPath('handoffs/sample-fresh.md', { inRef: false })
    ];
    console.log(
      JSON.stringify(
        advanceVerdict(rows, {
          checkout: '/example/stale-checkout',
          ref: 'origin/main',
          behind: 195,
          ahead: 0,
          dirtyTracked: 0,
          commit: null,
          commitReason: 'the sample runs on injected rows, not on a checkout'
        }),
        null,
        2
      )
    );
    return;
  }

  const at = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const ref = at('--ref', 'origin/main');
  const checkout = resolve(at('--checkout', primaryCheckout()));
  if (!existsSync(checkout)) {
    console.error(`✗ checkout-advance.mjs: no such checkout: ${checkout}`);
    process.exit(2);
  }

  let commit = null;
  let commitReason = null;
  try {
    commit = git(ROOT, ['rev-parse', 'HEAD']).trim();
  } catch {
    commitReason = 'the tool is not running inside a checkout';
  }

  const { state, rows } = surveyCheckout(checkout, ref);
  const v = advanceVerdict(rows, { checkout, ref, behind: state ? state.behind : null, ahead: state ? state.ahead : null, dirtyTracked: state ? state.dirtyTracked : null, commit, commitReason });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.status === 'NOT_RUN' ? 2 : 0);
  }

  console.log(`checkout-advance · ${checkout} · against ${ref}\n`);
  if (!state) {
    console.log(`  ${v.status}: ${v.reason}`);
    process.exit(2);
  }
  console.log(`  ${state.behind} behind · ${state.ahead} ahead · ${state.dirtyTracked} modified tracked file(s) · ${rows.length} untracked path(s)\n`);
  const order = ['differs', 'unreadable', 'identical', 'not-in-ref'];
  for (const cls of order) {
    const g = rows.filter((r) => r.class === cls);
    if (!g.length) continue;
    const head = {
      differs: 'removal loses the lines counted beside each path',
      unreadable: 'someone must look — never assumed identical',
      identical: 'blocks the advance, and removal loses nothing',
      'not-in-ref': 'blocks nothing, listed for completeness'
    }[cls];
    console.log(`  ${cls.toUpperCase()} (${g.length}) — ${head}`);
    for (const r of g) console.log(`    ${cls === 'not-in-ref' ? '    ' : r.localOnlyLines === null ? '   ?' : String(r.localOnlyLines).padStart(4)}  ${r.path}`);
    console.log('');
  }
  console.log(`  ${v.status}: ${v.reason || 'nothing blocks the advance'}`);
  console.log('  This tool removed nothing. Which of the blockers may go is the owner’s call.');
}

if (isCliEntry(import.meta.url)) main();
