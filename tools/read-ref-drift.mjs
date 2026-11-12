#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// read-ref-drift.mjs — hold the paths a census read against the ref, and name the censused
// checkout's distance from the ref beside the answer.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: A CODE CENSUS ANSWERS HONESTLY ABOUT A TREE NOBODY ADVANCES.
//
// The guard set holds a LEDGER read and a BRIEF edit to `origin/main`. It holds a CODE read to
// nothing. So `git grep` in a long-lived checkout returns a well-formed answer, with no line saying
// the tree is old, and the answer is about whatever that tree last pulled.
//
// MEASURED 2026-11-12 (residue 2026-11-12-a-code-census-in-the-root-checkout-reads-a-dead-tree):
// the primary checkout sat 2 commits behind the ref, and a five-tool census read three copies of
// one axis helper as unrouted. Re-run inside a worktree cut from the ref, every copy read routed
// and the owning gate read PASS over 10 of 10. The census was not wrong about its tree. It was
// wrong about the code, and nothing in its output could tell the two apart.
//
// THIS TOOL DECIDES NOTHING ABOUT THE CENSUS and changes no file. It takes the paths a census read,
// classifies each one against the ref, prints the censused checkout's distance from the ref beside
// that, and emits one `tepna.verdict/1`. Feed it the census's own file list:
//
//     git grep -l 'rPeakTimesOnAxis' | node tools/read-ref-drift.mjs -
//
// THE SUBJECT OF THE SENTENCE IS LOAD-BEARING (`tools/board.mjs` runnerVerdict `separateRoots`,
// which Magpie named on the board at #5954). "The running checkout is 84 behind" reads as a
// statement about the code. It is false about the code when the reader's tree and the censused tree
// are two trees, which is exactly what `--checkout` allows. So the subject is derived, never
// assumed, and every sentence names which tree it measured.
//
// THE ∅ RULE IS LOAD-BEARING HERE. "The copies match" and "I could not compare them" are one
// keystroke apart and opposite in consequence: the first blesses the census, the second says nobody
// has checked it. A comparison that did not complete is `unreadable`, never `current`.
//
// THE WRITE-ROOT READING (brief WRITE-ROOT-ADOPTION-2026-11-03 §3, exempt arm). This tool matches
// the write shape and writes no product. Both `writeFileSync` calls sit in the selftest, which
// builds a two-clone git fixture under `mkdtemp` and removes it in a `finally`. Nothing it writes
// lands under a checkout, so there is no root for a wrapper to resolve and no artifact a wrong
// checkout could lose.
//
// A BAD REF IS NOT A TREE FULL OF LOCAL FILES. `git rev-parse <ref>:<path>` exits 1 both for a path
// the ref lacks and for a ref git cannot resolve, so reading the per-path failure alone would call
// every censused path `local-only` and pass. The ref is verified ONCE, before any path is read, and
// an unresolvable ref examines nothing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The six answers a censused path can carry. `current` is the only one that blesses the census. */
export const CLASSES = ['current', 'drifted', 'ref-only', 'local-only', 'in-neither', 'unreadable'];

/**
 * CLASSIFY ONE CENSUSED PATH. `holds` answers the only question the caller has: does the census's
 * answer about this path describe the ref? `true`, `false`, or `null` for "nobody has checked".
 *
 * Every unknown input lands in `unreadable`. The two readings that must never merge are "identical"
 * and "not compared", so `identical: null` is checked before `identical === true` can be believed.
 */
export function classifyCensusPath(path, { inRef, inLocal, identical, note = null } = {}) {
  const unreadable = (why) => ({ path, class: 'unreadable', holds: null, why: note || why });
  if (inRef !== true && inRef !== false) return unreadable('the ref copy could not be read, so this path was not compared');
  if (inLocal !== true && inLocal !== false) return unreadable('the working copy could not be read, so this path was not compared');
  if (inRef === false && inLocal === false)
    return { path, class: 'in-neither', holds: false, why: note || 'neither tree holds this path, so the census named a file that does not exist and is over-matching' };
  if (inRef === false) return { path, class: 'local-only', holds: false, why: note || 'only the censused tree holds this path, so the ref can neither confirm nor refute the census about it' };
  if (inLocal === false) return { path, class: 'ref-only', holds: false, why: note || 'only the ref holds this path, so the census never read it at all' };
  if (identical === true) return { path, class: 'current', holds: true, why: note || 'the two copies are byte-identical, so the census answer about this path describes the ref' };
  if (identical === false) return { path, class: 'drifted', holds: false, why: note || 'the two copies differ, so the census answer about this path describes a tree the ref does not have' };
  return unreadable('the two copies were not compared, so neither a match nor a difference was measured');
}

/**
 * WHOSE DISTANCE IS BEING REPORTED. With one tree the subject is the running checkout, which is the
 * ordinary case: the census and the reader ran in the same place. With two it is the censused tree,
 * and saying otherwise would attribute one tree's staleness to another's code.
 */
export function driftSubject(censusRoot, selfRoot) {
  const separate = Boolean(censusRoot && selfRoot && resolve(censusRoot) !== resolve(selfRoot));
  return { separateRoots: separate, subject: separate ? 'the checkout censused' : 'the running checkout' };
}

/**
 * THE VERDICT. `rows === null` means the reader could not look — an unreadable checkout or an
 * unresolvable ref — and that is NOT_RUN, never a clean sheet.
 *
 * Status order: measured refutation first, absence second. A single drifted path already proves the
 * census describes another tree, whatever else could not be read. `behind` NEVER decides the
 * status, because the criterion is the FILE: a checkout 84 commits behind on commits that touch
 * none of the censused paths holds a census that is exactly right.
 */
export function refDriftVerdict(rows, { checkout, ref, behind, ahead, subject = 'the censused checkout', separateRoots = false, commit = null, commitReason = null, at = null } = {}) {
  const base = {
    schema: 'tepna.verdict/1',
    gate: 'read-ref-drift',
    scope: 'internal',
    criterion: { name: 'censused_paths_differing_from_the_ref', threshold: 0, unit: 'paths', direction: 'lte' },
    evidence: ['tools/read-ref-drift.mjs', `git rev-parse ${ref}:<path> and git hash-object per censused path`],
    producedBy: { tool: 'tools/read-ref-drift.mjs', commit, ...(commitReason ? { commitReason } : {}) },
    at: at || new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };
  const empty = { checked: 0, eligible: 0, excluded: 0 };

  if (rows === null || rows === undefined) {
    return { ...base, status: 'NOT_RUN', population: empty, result: null, reason: `${subject} could not be compared with ${ref} — nothing was examined` };
  }
  if (rows.length === 0) {
    return {
      ...base,
      status: 'NOT_RUN',
      population: empty,
      result: null,
      reason: 'the reader was given no censused path, so it examined nothing — a PASS here would be the examined-nothing shape'
    };
  }

  const of = (cls) => rows.filter((r) => r.class === cls);
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, of(c).length]));
  const refuting = [...of('drifted'), ...of('ref-only'), ...of('in-neither')];
  const unreadable = of('unreadable');
  const localOnly = of('local-only');

  const population = { checked: rows.length - unreadable.length, eligible: rows.length, excluded: unreadable.length };
  const distance = Number.isFinite(behind)
    ? `${subject} is ${behind} commit(s) behind ${ref}${Number.isFinite(ahead) && ahead > 0 ? ` and ${ahead} ahead of it` : ''}`
    : `${subject}'s distance from ${ref} was not read`;
  const result = {
    checkout,
    ref,
    behind: Number.isFinite(behind) ? behind : null,
    ahead: Number.isFinite(ahead) ? ahead : null,
    subject,
    separateRoots,
    distance,
    censused: rows.length,
    byClass,
    paths: rows
  };

  if (refuting.length > 0) {
    return {
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `${refuting.length} of ${rows.length} censused path(s) do not match ${ref} — ${byClass.drifted} drifted, ${byClass['ref-only']} absent from the censused tree, ${byClass['in-neither']} in neither tree: ${refuting.map((r) => r.path).join(', ')} — so the census describes a tree the ref does not have, while ${distance}`
    };
  }
  if (unreadable.length > 0) {
    return {
      ...base,
      status: 'SHORTFALL',
      population,
      result,
      reason: `${unreadable.length} of ${rows.length} censused path(s) were not compared with ${ref} (${unreadable.map((r) => r.path).join(', ')}), so this reader cannot say the census describes the ref, while ${distance}`
    };
  }
  if (localOnly.length > 0) {
    return {
      ...base,
      status: 'SHORTFALL',
      population,
      result,
      reason: `${localOnly.length} of ${rows.length} censused path(s) exist only in the censused tree (${localOnly.map((r) => r.path).join(', ')}), so the ref can neither confirm nor refute the census about them, while ${distance}`
    };
  }
  /* THE CONTRACT REFUSES A REASON ON A PASS, and the distance must still reach the reader. So it
     is a RESULT field on every status, never prose only on the ones that fail. */
  return { ...base, status: 'PASS', population, result, reason: null };
}

// ── the impure half: one checkout, read through git, nothing written ─────────────────────────────

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** `{ behind, ahead }`, or null when the checkout cannot be read. */
export function readDistance(checkout, ref) {
  try {
    const counts = git(checkout, ['rev-list', '--left-right', '--count', `HEAD...${ref}`])
      .trim()
      .split(/\s+/)
      .map(Number);
    if (counts.length !== 2 || counts.some((n) => !Number.isFinite(n))) return null;
    return { ahead: counts[0], behind: counts[1] };
  } catch {
    return null;
  }
}

/** Does the ref resolve to a commit in this checkout? Read ONCE — see the header. */
export function refResolves(checkout, ref) {
  try {
    return Boolean(git(checkout, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim());
  } catch {
    return false;
  }
}

/** Classify ONE censused path. Blob hashes only: no file is read into memory to compare it. */
export function classifyAgainstRef(checkout, ref, path) {
  let refSha = null;
  try {
    refSha = git(checkout, ['rev-parse', '--verify', '--quiet', `${ref}:${path}`]).trim() || null;
  } catch {
    /* `--quiet` exits 1 for a path the ref lacks; the ref itself was verified before any path. */
  }
  const inLocal = existsSync(join(checkout, path));
  if (!refSha) return classifyCensusPath(path, { inRef: false, inLocal });
  if (!inLocal) return classifyCensusPath(path, { inRef: true, inLocal: false });

  let localSha;
  try {
    localSha = git(checkout, ['hash-object', '--', path]).trim();
  } catch (err) {
    return classifyCensusPath(path, { inRef: true, inLocal: true, identical: null, note: `the working copy could not be hashed (${String(err.message).split('\n')[0]})` });
  }
  return classifyCensusPath(path, { inRef: true, inLocal: true, identical: localSha === refSha });
}

/** `{ rows, distance, reason }`. `rows: null` carries the reason the reader could not look. */
export function surveyCensus(checkout, ref, paths) {
  if (!refResolves(checkout, ref)) return { rows: null, distance: null, reason: `${ref} does not resolve to a commit in that checkout, so no path could be compared` };
  const distance = readDistance(checkout, ref);
  if (!distance) return { rows: null, distance: null, reason: 'the checkout could not be read with git' };
  return { rows: paths.map((p) => classifyAgainstRef(checkout, ref, p)), distance, reason: null };
}

/** The checkout a path belongs to: its own working tree, worktree or primary alike. */
export function checkoutOf(from) {
  try {
    return git(from, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

/** One path per line; blanks and `#` comments dropped, so a census list may carry a header. */
export function parsePathList(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
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
  const META = {
    checkout: '/example/censused-checkout',
    ref: 'origin/main',
    behind: 84,
    ahead: 0,
    subject: 'the checkout censused',
    separateRoots: true,
    commit: null,
    commitReason: 'the selftest runs on injected rows, not on a checkout'
  };
  const cur = (p) => classifyCensusPath(p, { inRef: true, inLocal: true, identical: true });

  console.log('classifyCensusPath — the six classes');
  ok('a byte-identical pair is current, and it blesses the census', cur('a.js').class === 'current' && cur('a.js').holds === true);
  ok('a differing pair is drifted, and it refutes the census', classifyCensusPath('a.js', { inRef: true, inLocal: true, identical: false }).holds === false);
  ok('a path only the censused tree has is local-only', classifyCensusPath('a.js', { inRef: false, inLocal: true }).class === 'local-only');
  ok('a path only the ref has is ref-only, because the census never read it', classifyCensusPath('a.js', { inRef: true, inLocal: false }).class === 'ref-only');
  ok('a path in neither tree says the census is over-matching', /over-matching/.test(classifyCensusPath('a.js', { inRef: false, inLocal: false }).why));
  /* PLANT — ∅. These three inputs are the whole reason this classifier is a function: "they match"
     and "I could not compare them" are one keystroke apart and opposite in consequence. */
  ok('an uncompared pair is unreadable, never current', classifyCensusPath('a.js', { inRef: true, inLocal: true, identical: null }).class === 'unreadable');
  ok('an unread REF copy is unreadable even when identical says true', classifyCensusPath('a.js', { inRef: null, inLocal: true, identical: true }).class === 'unreadable');
  ok('an unread WORKING copy is unreadable even when identical says true', classifyCensusPath('a.js', { inRef: true, inLocal: null, identical: true }).class === 'unreadable');
  ok('and an unreadable path holds NOTHING, neither true nor false', classifyCensusPath('a.js', { inRef: true, inLocal: true, identical: null }).holds === null);

  console.log('driftSubject — whose staleness the sentence reports');
  ok('one tree reports on the running checkout', driftSubject('/x/wt', '/x/wt').subject === 'the running checkout');
  ok('two trees report on the checkout censused', driftSubject('/x/root', '/x/wt').subject === 'the checkout censused');
  ok('and two trees set separateRoots, which the verdict carries', driftSubject('/x/root', '/x/wt').separateRoots === true);

  console.log('refDriftVerdict — refutation before absence, and behind decides nothing');
  const vNull = refDriftVerdict(null, META);
  ok('an unreadable checkout is NOT_RUN over zero paths', vNull.status === 'NOT_RUN' && vNull.population.eligible === 0, vNull.status);
  const vEmpty = refDriftVerdict([], META);
  ok('no censused path is NOT_RUN, never a PASS', vEmpty.status === 'NOT_RUN' && /examined-nothing/.test(vEmpty.reason), vEmpty.status);
  const vFail = refDriftVerdict([cur('a.js'), cur('b.js'), classifyCensusPath('c.js', { inRef: true, inLocal: true, identical: false })], META);
  ok('ONE drifted path among two current ones is FAIL', vFail.status === 'FAIL' && /c\.js/.test(vFail.reason), vFail.status);
  ok('and the FAIL names the distance beside the paths', /84 commit\(s\) behind/.test(vFail.reason), vFail.reason);
  ok('the FAIL sentence names which tree it measured', /the checkout censused is 84/.test(vFail.reason), vFail.reason);
  const vUnread = refDriftVerdict([cur('a.js'), classifyCensusPath('c.js', { inRef: true, inLocal: true, identical: null })], META);
  ok('an uncompared path is SHORTFALL and is EXCLUDED from checked', vUnread.status === 'SHORTFALL' && vUnread.population.checked === 1 && vUnread.population.excluded === 1, vUnread.status);
  const vLocal = refDriftVerdict([cur('a.js'), classifyCensusPath('c.js', { inRef: false, inLocal: true })], META);
  ok('a local-only path is SHORTFALL, because the ref cannot speak to it', vLocal.status === 'SHORTFALL' && /only in the censused tree/.test(vLocal.reason), vLocal.status);
  ok(
    'a drifted path outranks an uncompared one',
    refDriftVerdict([classifyCensusPath('c.js', { inRef: true, inLocal: true, identical: null }), classifyCensusPath('d.js', { inRef: true, inLocal: true, identical: false })], META).status === 'FAIL'
  );
  /* CONTROL — the criterion is the FILE, not the commit count. A census in a checkout 84 commits
     behind is exactly right when those commits touch none of the paths it read. */
  const vPass = refDriftVerdict([cur('a.js'), cur('b.js')], META);
  ok('CONTROL · every path current is a PASS however far behind the tree is', vPass.status === 'PASS', vPass.status);
  /* The contract refuses a reason on a PASS, so the distance rides the RESULT. A reader that
     printed only `reason` would show a bare PASS over a tree 84 commits behind the ref. */
  ok('the PASS still carries the distance, in the result', /84 commit\(s\) behind/.test(vPass.result.distance), vPass.result.distance);
  ok('and the PASS carries no reason, as the contract requires', vPass.reason === null);
  ok(
    'every status carries the distance, not just the failing ones',
    [vFail, vUnread, vLocal].every((v) => /84 commit\(s\) behind/.test(v.result.distance))
  );
  ok('a level checkout says 0 behind in the result', /is 0 commit\(s\) behind/.test(refDriftVerdict([cur('a.js')], { ...META, behind: 0 }).result.distance));
  ok('an unread distance says so rather than reporting 0', /distance from origin\/main was not read/.test(refDriftVerdict([cur('a.js')], { ...META, behind: null }).result.distance));
  ok('population arithmetic holds on the PASS', vPass.population.checked + vPass.population.excluded === vPass.population.eligible);
  for (const [i, v] of [vNull, vEmpty, vFail, vUnread, vLocal, vPass].entries()) {
    const r = V.validate(v);
    ok(`verdict ${i + 1} of 6 validates (${v.status})`, r.ok, r.errors.join(' | '));
  }

  console.log('parsePathList');
  ok('blank lines and comments are dropped', parsePathList('# a census\n\na.js\n b.js \n').join(',') === 'a.js,b.js');

  console.log('two real clones — the defect the row reports');
  const tmp = mkdtempSync(join(tmpdir(), 'refdrift-'));
  try {
    const up = join(tmp, 'up');
    execFileSync('git', ['init', '-q', '-b', 'main', up], { encoding: 'utf8' });
    git(up, ['config', 'user.email', 'selftest@example.invalid']);
    git(up, ['config', 'user.name', 'selftest']);
    writeFileSync(join(up, 'router.js'), 'export const route = 1;\n');
    writeFileSync(join(up, 'stable.js'), 'export const stable = 1;\n');
    git(up, ['add', 'router.js', 'stable.js']);
    git(up, ['commit', '-qm', 'base']);
    execFileSync('git', ['clone', '-q', up, join(tmp, 'down')], { encoding: 'utf8' });
    const down = join(tmp, 'down');

    /* The ref moves, the clone does not. This is the whole row in two lines. */
    writeFileSync(join(up, 'router.js'), 'export const route = 1;\nexport const onAxis = 2;\n');
    git(up, ['add', 'router.js']);
    git(up, ['commit', '-qm', 'the helper the census looks for']);
    git(down, ['fetch', '-q', 'origin']);

    const censused = ['router.js', 'stable.js'];
    const { rows, distance, reason } = surveyCensus(down, 'origin/main', censused);
    ok('the stale clone reads 1 behind and 0 ahead', distance && distance.behind === 1 && distance.ahead === 0, JSON.stringify(distance) + String(reason || ''));
    const byPath = Object.fromEntries((rows || []).map((r) => [r.path, r]));
    ok('the file the ref moved reads drifted', byPath['router.js'].class === 'drifted', JSON.stringify(byPath['router.js']));
    ok('the file neither tree moved reads current', byPath['stable.js'].class === 'current', JSON.stringify(byPath['stable.js']));
    /* THE MEASUREMENT THE HEADER RESTS ON: the census is internally consistent and wrong. */
    const localHits = /onAxis/.test(readFileSync(join(down, 'router.js'), 'utf8')) ? 1 : 0;
    const refHits = /onAxis/.test(git(down, ['show', 'origin/main:router.js'])) ? 1 : 0;
    ok('a grep census really answers 0 in the clone and 1 on the ref', localHits === 0 && refHits === 1, `local ${localHits} ref ${refHits}`);
    ok('and git says nothing about that while answering', refDriftVerdict(rows, { ...META, behind: distance.behind, ahead: distance.ahead }).status === 'FAIL');

    /* THE WHOLE-POPULATION LIE: an unresolvable ref must examine nothing, not read every path as
       local-only and then pass over them. */
    const bad = surveyCensus(down, 'origin/no-such-ref', censused);
    ok('an unresolvable ref examines nothing', bad.rows === null && /does not resolve/.test(bad.reason), JSON.stringify(bad.reason));
    ok('and that is NOT_RUN, never a PASS over paths read as local-only', refDriftVerdict(bad.rows, { ...META, behind: null, ahead: null }).status === 'NOT_RUN');

    const ghost = surveyCensus(down, 'origin/main', ['no-such-file.js']);
    ok('a path neither tree holds is in-neither, and that is a FAIL', ghost.rows[0].class === 'in-neither' && refDriftVerdict(ghost.rows, META).status === 'FAIL');

    ok('checkoutOf reads the clone it is pointed at', checkoutOf(down) === down, String(checkoutOf(down)));
  } finally {
    execFileSync('rm', ['-rf', tmp]);
  }

  console.log(`\n${fail === 0 ? '✓' : '✗'} read-ref-drift selftest — ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(
    argv,
    { boolean: ['--json', '--selftest', '--verdict-sample'], valued: ['--checkout', '--ref', '--paths-from'], positional: true, stdin: true },
    { tool: 'read-ref-drift.mjs' }
  );
  if (argv.includes('--selftest')) process.exit(selftest());

  /* The checkout-free sample the adoption gate runs: the shape measured on 2026-11-12 in miniature
     — one censused path the ref moved, one it did not, in a tree 84 commits behind. */
  if (argv.includes('--verdict-sample')) {
    const rows = [
      classifyCensusPath('ecgdex-dsp.js', { inRef: true, inLocal: true, identical: true }),
      classifyCensusPath('tools/sample-axis-census.mjs', { inRef: true, inLocal: true, identical: false })
    ];
    console.log(
      JSON.stringify(
        refDriftVerdict(rows, {
          checkout: '/example/censused-checkout',
          ref: 'origin/main',
          behind: 84,
          ahead: 0,
          subject: 'the checkout censused',
          separateRoots: true,
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
  const listed = positionalArgs(argv, { valued: ['--checkout', '--ref', '--paths-from'], stdin: true });
  const fromFile = at('--paths-from', null);
  const paths = [...listed.filter((p) => p !== '-'), ...(listed.includes('-') ? parsePathList(readFileSync(0, 'utf8')) : []), ...(fromFile ? parsePathList(readFileSync(fromFile, 'utf8')) : [])];

  const self = checkoutOf(ROOT);
  const checkout = resolve(at('--checkout', checkoutOf(process.cwd()) || ROOT));
  if (!existsSync(checkout)) {
    console.error(`✗ read-ref-drift.mjs: no such checkout: ${checkout}`);
    process.exit(2);
  }
  const { separateRoots, subject } = driftSubject(checkout, self);

  let commit = null;
  let commitReason = null;
  try {
    commit = git(ROOT, ['rev-parse', 'HEAD']).trim();
  } catch {
    commitReason = 'the tool is not running inside a checkout';
  }

  const { rows, distance, reason } = surveyCensus(checkout, ref, paths);
  const v = refDriftVerdict(rows, { checkout, ref, behind: distance ? distance.behind : null, ahead: distance ? distance.ahead : null, subject, separateRoots, commit, commitReason });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.status === 'NOT_RUN' ? 2 : v.status === 'FAIL' ? 1 : 0);
  }

  console.log(`read-ref-drift · ${checkout} · against ${ref}\n`);
  if (!rows) {
    console.log(`  ${v.status}: ${reason || v.reason}`);
    process.exit(2);
  }
  console.log(`  ${subject} is ${distance.behind} commit(s) behind ${ref} and ${distance.ahead} ahead · ${rows.length} censused path(s)\n`);
  for (const cls of ['drifted', 'ref-only', 'in-neither', 'unreadable', 'local-only', 'current']) {
    const g = rows.filter((r) => r.class === cls);
    if (!g.length) continue;
    console.log(`  ${cls.toUpperCase()} (${g.length}) — ${g[0].why}`);
    for (const r of g) console.log(`    ${r.path}`);
    console.log('');
  }
  console.log(`  ${v.status}: ${v.reason || 'every censused path matches the ref'}`);
  console.log('  This reader re-ran no census. Whether the answer must be taken again is the caller’s call.');
  process.exit(v.status === 'NOT_RUN' ? 2 : v.status === 'FAIL' ? 1 : 0);
}

if (isCliEntry(import.meta.url)) main();
