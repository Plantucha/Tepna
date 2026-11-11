// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/write-root-adoption.mjs — the adopted write-root and judge-root sets, named

       node tools/write-root-adoption.mjs --check            # the gate
       node tools/write-root-adoption.mjs --census           # the measured sets, deciding nothing
       node tools/write-root-adoption.mjs --json             # the verdict object alone on stdout
       node tools/write-root-adoption.mjs --verdict-sample   # the verdict shape, examining nothing
       node tools/write-root-adoption.mjs --selftest

   WHY. The write-root brief asks for one gate twice: §4 wants the adopted WRITE set named, and §6.5
   wants the adopted JUDGE set named, "so a new writing tool joins it deliberately rather than by
   habit". `tools/write-root.mjs` holds the four wrappers and three tools call them. Nothing made a
   fourth tool join, so the next arrival inherits the defect by default — the same mechanism
   `tools/verdict-adoption.mjs` exists to break on the verdict arm.

   WHAT IT READS. Every `tools/*.mjs`, comment-blanked through `bareSource`, against two shapes the
   brief published as greps: a WRITE candidate resolves a root from `import.meta.url` and writes; a
   JUDGE candidate touches a verdict, resolves a root from `import.meta.url` and passes that root as a
   child's `cwd`. `tools/write-root-adoption.json` names, per arm, every tool that ADOPTED a wrapper
   and every candidate still PENDING a reading.

   THE FOUR REDS, each with its remedy:
     · a candidate in neither list — adopt it, or add its name to `pending` and put the reading in its
       own header;
     · a tool that calls a wrapper and holds no `adopted` row — declare the adoption;
     · an `adopted` row whose tool no longer calls a wrapper — the conversion went away;
     · a stale row — the file is gone, or a `pending` tool no longer matches the shape.
   The ratchet adds a fifth: a tool `adopted` at the merge base and not adopted here. A retired tool is
   not a de-adoption, so a vanished file passes the ratchet and reds as a stale row instead.

   THE SHAPE IS NOT THE EXPOSURE (§6.3). An adopter still matches all three judge greps, because `main`
   reassigns `ROOT` through `judgeRoot` and the git calls still read `cwd: ROOT`. So this gate
   subtracts an adopter BY NAME and never by regex. A count here is a count of shapes, and the reading
   in each tool's header is what decides the site.

   THE READING FOR THIS TOOL (§6.4, judge arm). It judges the tool tree of the RUN's work-unit, so it
   resolves through `judgeRoot` inside `main` and refuses a cross-checkout run with one `NOT_RUN`
   object and exit 2. A library import and `--verdict-sample` examine no tree, so neither can refuse.
   ════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { bareSource } from './verdict-adoption.mjs';
import { WriteRootRefusal, judgeRoot } from './write-root.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
/* The DEFAULT only, for a library import and for `--verdict-sample`, which examine no tree. A real run
   replaces it in `main` with the checkout it was RUN FROM. */
let ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/write-root-adoption.mjs';
const GATE = 'write-root-adoption';
export const MANIFEST = 'tools/write-root-adoption.json';
/* The module that DEFINES the wrappers names them on every line that declares one, so it would read as
   an adopter of both arms. It is the route, never a site. */
export const DEFINER = 'tools/write-root.mjs';
export const ARMS = ['write', 'judge'];
export const CRITERION = { name: 'undeclared_or_dropped_sites', threshold: 0, unit: 'sites', direction: 'lte' };

/* THE TWO SHAPES, from the brief's own published greps. Every regex here reads comment-blanked source,
   so a tool that merely NAMES a wrapper in a comment is not a candidate and not an adopter. */
export const SHAPES = {
  write: {
    from: 'the brief §1 grep: a root from `import.meta.url`, filtered by `writeFileSync` or `appendFileSync`',
    all: [/const (ROOT|REPO_ROOT|repoRoot)\s*=[^\n]*import\.meta\.url/, /writeFileSync|appendFileSync/]
  },
  judge: {
    from: 'the brief §6.2 grep: a verdict, `fileURLToPath(import.meta.url)`, and that root as a child `cwd`',
    all: [/tepna\.verdict\/1|verdict\.js|Verdict\./, /fileURLToPath\(import\.meta\.url\)/, /cwd: *(ROOT|REPO|REPO_ROOT|repoRoot|SELF_ROOT)/]
  }
};
/* A CALL, never a mention: the paren is the whole point. An `import { judgeRoot } from …` line brings
   the name in and decides nothing, so it must not read as an adoption. */
export const WRAPPERS = { write: /\bwriteRoot(OrDie)?\s*\(/, judge: /\bjudgeRoot(OrDie)?\s*\(/ };

/** Does this blanked source match the arm's shape? PURE. */
export function isCandidate(arm, bare) {
  return SHAPES[arm].all.every((re) => re.test(bare));
}

/** Does this blanked source CALL one of the arm's two wrappers? PURE. */
export function callsWrapper(arm, bare) {
  return WRAPPERS[arm].test(bare);
}

/** Both arms over a path→source map, comment-blanked once per file. PURE but for the blanker. */
export function censusOf(texts) {
  const out = { write: { candidates: [], adopters: [] }, judge: { candidates: [], adopters: [] } };
  for (const p of [...texts.keys()].sort()) {
    const bare = bareSource(texts.get(p), false);
    for (const arm of ARMS) {
      if (isCandidate(arm, bare)) out[arm].candidates.push(p);
      if (p !== DEFINER && callsWrapper(arm, bare)) out[arm].adopters.push(p);
    }
  }
  return out;
}

/* THE ONE EXEMPTION, and why it has to exist. A tool that PLANTS a shape as a fixture inside its own
   selftest matches the regexes over its own test data. This gate is the first such tool: its selftests
   carry a planted `const ROOT = … import.meta.url` beside a planted `writeFileSync`, so the write shape
   reads its test strings. An exemption suppresses the two undeclared reds for that path alone, it
   carries a sentence saying why, and an exemption with no reason is itself a red. It never suppresses
   a stale row, so an exemption whose file is gone — or that matches nothing any more — still reds. */
/** One arm judged against its manifest rows. `exists` answers for a path. PURE. */
export function armFindings({ candidates, adopters, rows, exists }) {
  const adoptedRows = (rows && rows.adopted) || {};
  const exemptRows = (rows && rows.exempt) || {};
  const adopted = Object.keys(adoptedRows).sort();
  const pending = ((rows && rows.pending) || []).slice().sort();
  const exempt = Object.keys(exemptRows).sort();
  const declared = new Set([...adopted, ...pending, ...exempt]);
  const cand = new Set(candidates);
  const callers = new Set(adopters);
  const gone = [...declared].filter((p) => !exists(p));
  const stalePending = pending.filter((p) => exists(p) && !cand.has(p));
  /* An exemption answers for a shape or a wrapper call. With neither, it exempts nothing. */
  const staleExempt = exempt.filter((p) => exists(p) && !cand.has(p) && !callers.has(p));
  return {
    undeclared: candidates.filter((p) => !declared.has(p)),
    undeclaredAdopter: adopters.filter((p) => !(p in adoptedRows) && !(p in exemptRows)),
    notCalling: adopted.filter((p) => exists(p) && !callers.has(p)),
    muteExemptions: exempt.filter((p) => typeof exemptRows[p] !== 'string' || exemptRows[p].trim() === ''),
    staleRows: [...new Set([...gone, ...stalePending, ...staleExempt])].sort(),
    counts: { candidates: candidates.length, adopted: adopted.length, pending: pending.length, exempt: exempt.length, adopters: adopters.length }
  };
}

/** A row that was `adopted` at the base and is not adopted here. A gone file is a retirement. PURE. */
export function ratchetOf({ baseRows, headRows, exists }) {
  const base = Object.keys((baseRows && baseRows.adopted) || {});
  const head = new Set(Object.keys((headRows && headRows.adopted) || {}));
  return { deAdopted: base.filter((p) => exists(p) && !head.has(p)).sort() };
}

/** Every red, as one flat list of sentences a reader can act on. PURE. */
export function findingLines(perArm, ratchet) {
  const out = [];
  for (const arm of ARMS) {
    const f = perArm[arm];
    for (const p of f.undeclared)
      out.push(p + ' matches the ' + arm + ' shape and sits in no row: adopt the wrapper, or add the name to `pending` in ' + MANIFEST + ' and put the reading in the tool’s own header');
    for (const p of f.undeclaredAdopter) out.push(p + ' calls a ' + arm + '-root wrapper and holds no `adopted` row in ' + MANIFEST + ': declare the adoption');
    for (const p of f.notCalling) out.push(p + ' holds an `adopted` ' + arm + ' row and calls no wrapper: the conversion went away, or the row names the wrong tool');
    for (const p of f.muteExemptions) out.push(p + ' holds a mute ' + arm + ' exemption: an exemption carries the sentence that says why the shape reads its own test data');
    for (const p of f.staleRows) out.push(p + ' holds a stale ' + arm + ' row: the file is gone, or a `pending` tool no longer matches the shape — remove the row');
  }
  for (const p of ratchet.deAdopted) out.push(p + ' was `adopted` at the base and is not adopted here: a merge dropped the row, so restore it');
  return out;
}

/* `checked` is the UNION of the two candidate sets, because one tool can be a site on both arms, and
   `eligible` is every `tools/*.mjs` this run read. So `excluded` counts the tools that match no shape,
   which is the honest reading of a population this gate looked at and let through. */
export function verdictOf({ perArm, ratchet, lines, checked = 0, eligible = 0, commit, commitReason = null, status = null, reason = null }) {
  const blind = status != null;
  /* A NULL IDENTITY OWES A REASON, and the reason derives from the lookup that failed: the verdict
     module refuses a null commit that carries none, so a mute refusal would throw instead of
     publishing. */
  const by = commit ? { tool: SELF, commit } : { tool: SELF, commit: null, commitReason: commitReason || 'git rev-parse --short HEAD did not answer in the tree this run read' };
  return Verdict.make({
    gate: GATE,
    status: blind ? status : lines.length === 0 ? 'PASS' : 'FAIL',
    population: blind ? { checked: 0, eligible: 0, excluded: 0 } : { checked: checked, eligible: eligible, excluded: eligible - checked },
    criterion: CRITERION,
    result: blind
      ? null
      : {
          sites: lines.length,
          write: perArm.write.counts,
          judge: perArm.judge.counts,
          deAdopted: ratchet.deAdopted.length
        },
    evidence: [SELF, MANIFEST],
    reason: blind ? reason : lines.length === 0 ? null : lines.length + ' site(s) the adopted sets do not name; each line below carries its remedy',
    producedBy: by
  });
}

/* ── THE READERS ──────────────────────────────────────────────────────── */

/** Every `tools/*.mjs` under `root`, as repo-relative path → source. Non-recursive, as both greps are. */
export function toolTexts(root) {
  const dir = join(root, 'tools');
  const out = new Map();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.mjs')) continue;
    out.set('tools/' + f, readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
}

function gitAt(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

function gitCommit(root) {
  return gitAt(root, ['rev-parse', '--short', 'HEAD']);
}

/** The manifest as it stood at the merge base, or `null` when no base copy can be read. */
export function baseManifest(root, base) {
  const mb = gitAt(root, ['merge-base', 'HEAD', base]);
  if (mb == null) return null;
  const txt = gitAt(root, ['show', mb + ':' + MANIFEST]);
  if (txt == null) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function refuse(reason) {
  console.log(
    JSON.stringify(
      verdictOf({
        perArm: null,
        ratchet: null,
        lines: [],
        commit: null,
        commitReason: 'the run resolved no tree, so no commit was read',
        status: 'NOT_RUN',
        reason
      })
    )
  );
  console.error('REFUSING: ' + reason);
  process.exit(2);
}

/* ── THE RUN ──────────────────────────────────────────────────────────── */

function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--check', '--census', '--json'], valued: ['--base'] }, { tool: 'write-root-adoption' });
  /* A GATE JUDGES THE CHECKOUT IT WAS RUN FROM, never the one it lives in. The same defect this brief
     owns: a run by absolute path from a worktree would otherwise census the shared root's tools and
     publish that census as the answer to a question about the branch. */
  try {
    ROOT = judgeRoot(import.meta.url);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    console.error(e.message);
    refuse('this run and ' + SELF + ' sit in different checkouts (' + e.reason + '), so which tool tree to census is undecided');
  }
  const prose = !argv.includes('--json');
  const base = (() => {
    const i = argv.indexOf('--base');
    return i >= 0 && argv[i + 1] ? argv[i + 1] : 'origin/main';
  })();

  const texts = toolTexts(ROOT);
  const census = censusOf(texts);
  const exists = (p) => existsSync(join(ROOT, p));
  let manifest;
  try {
    manifest = readManifest(ROOT);
  } catch (e) {
    refuse(MANIFEST + ' did not parse (' + e.message + '), so the adopted sets are unreadable');
  }

  if (argv.includes('--census')) {
    for (const arm of ARMS) {
      const rows = manifest.arms[arm] || {};
      console.log('▸ ' + arm + ' arm — ' + SHAPES[arm].from);
      console.log(
        '  candidates ' +
          census[arm].candidates.length +
          ' · adopted ' +
          Object.keys(rows.adopted || {}).length +
          ' · pending ' +
          (rows.pending || []).length +
          ' · exempt ' +
          Object.keys(rows.exempt || {}).length
      );
      for (const p of census[arm].candidates) console.log('    ' + (census[arm].adopters.includes(p) ? '✓' : '·') + ' ' + p);
    }
    console.log('tools read: ' + texts.size);
    process.exit(0);
  }

  const perArm = {};
  for (const arm of ARMS) perArm[arm] = armFindings({ ...census[arm], rows: manifest.arms[arm], exists });
  const baseM = baseManifest(ROOT, base);
  const ratchet = { deAdopted: [] };
  if (baseM != null) {
    for (const arm of ARMS) ratchet.deAdopted.push(...ratchetOf({ baseRows: baseM.arms && baseM.arms[arm], headRows: manifest.arms[arm], exists }).deAdopted);
  }
  const lines = findingLines(perArm, ratchet);
  const checked = new Set([...census.write.candidates, ...census.judge.candidates]).size;
  const v = verdictOf({ perArm, ratchet, lines, checked, eligible: texts.size, commit: gitCommit(ROOT) });
  if (baseM == null) v.result.ratchet = 'unexamined';
  console.log(JSON.stringify(v, null, prose ? 1 : 0));
  if (baseM == null) console.error('⚠ the ratchet examined nothing: no `' + MANIFEST + '` at merge-base(HEAD, ' + base + ')');
  if (prose) {
    for (const arm of ARMS) {
      const c = perArm[arm].counts;
      console.error('▸ ' + arm + ': ' + c.candidates + ' candidate(s), ' + c.adopted + ' adopted, ' + c.pending + ' pending a reading, ' + c.exempt + ' exempt by name');
    }
  }
  if (lines.length === 0) {
    if (prose) console.error('✓ ' + GATE + ' — every write-root and judge-root site sits in a named set');
    process.exit(0);
  }
  for (const l of lines) console.error('  ✕ ' + l);
  process.exit(1);
}

/* ── SELFTESTS ────────────────────────────────────────────────────────── */

function selftest() {
  let bad = 0,
    ran = 0;
  const ok = (n, cond) => {
    ran++;
    if (cond) console.log('  ✓ ' + n);
    else {
      bad++;
      console.log('  ✕ ' + n);
    }
  };
  const eq = (n, got, want) => ok(n + ' — got ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want));

  const W_SRC = 'const ROOT = dirname(fileURLToPath(import.meta.url));\nwriteFileSync(x, y);\n';
  const J_SRC = "const Verdict = require('../verdict.js');\nconst ROOT = fileURLToPath(import.meta.url);\nspawnSync('git', a, { cwd: ROOT });\n";
  ok('a write candidate resolves a root and writes', isCandidate('write', W_SRC));
  ok('a root with no write is no write candidate', !isCandidate('write', 'const ROOT = dirname(fileURLToPath(import.meta.url));\n'));
  ok('a write with no root is no write candidate', !isCandidate('write', 'writeFileSync(a, b);\n'));
  ok('a judge candidate needs all three', isCandidate('judge', J_SRC));
  ok('a verdict with no child cwd is no judge candidate', !isCandidate('judge', "const Verdict = require('../verdict.js');\nconst ROOT = fileURLToPath(import.meta.url);\n"));
  ok('a shape reads blanked source, so a commented write is no candidate', !isCandidate('write', bareSource('const ROOT = dirname(fileURLToPath(import.meta.url));\n// writeFileSync(x, y)\n', false)));
  ok('a wrapper call is an adoption', callsWrapper('write', 'ROOT = writeRootOrDie(import.meta.url);'));
  ok('a judge wrapper is not a write adoption', !callsWrapper('write', 'ROOT = judgeRoot(import.meta.url);'));
  ok('an import line is a mention, never an adoption', !callsWrapper('judge', "import { judgeRoot } from './write-root.mjs';"));
  ok('a commented wrapper is no adoption', !callsWrapper('judge', bareSource('/* call judgeRoot(import.meta.url) here */\n', false)));

  const texts = new Map([
    ['tools/a.mjs', W_SRC],
    ['tools/b.mjs', W_SRC + 'ROOT = writeRootOrDie(import.meta.url);\n'],
    ['tools/c.mjs', J_SRC + 'ROOT = judgeRoot(import.meta.url);\n'],
    [DEFINER, 'export function writeRoot(selfUrl) {}\nexport function judgeRoot(selfUrl) {}\n']
  ]);
  const cen = censusOf(texts);
  eq('the census sorts the write candidates', cen.write.candidates, ['tools/a.mjs', 'tools/b.mjs']);
  eq('the census names the write adopter', cen.write.adopters, ['tools/b.mjs']);
  eq('the census names the judge adopter', cen.judge.adopters, ['tools/c.mjs']);
  ok('the definer is the route, never a site', !cen.write.adopters.includes(DEFINER) && !cen.judge.adopters.includes(DEFINER));

  const all = () => true;
  const clean = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: ['tools/a.mjs'] }, exists: all });
  eq('a fully named arm reports nothing', [clean.undeclared, clean.undeclaredAdopter, clean.notCalling, clean.staleRows], [[], [], [], []]);
  eq('the counts carry the population', clean.counts, { candidates: 2, adopted: 1, pending: 1, exempt: 0, adopters: 1 });
  const undec = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: [] }, exists: all });
  eq('an undeclared candidate is named', undec.undeclared, ['tools/a.mjs']);
  const undecA = armFindings({ ...cen.write, rows: { adopted: {}, pending: ['tools/a.mjs', 'tools/b.mjs'] }, exists: all });
  eq('an adopter with no row is named', undecA.undeclaredAdopter, ['tools/b.mjs']);
  const notCall = armFindings({ ...cen.write, rows: { adopted: { 'tools/a.mjs': {} }, pending: ['tools/b.mjs'] }, exists: all });
  eq('an adopted row that calls nothing is named', notCall.notCalling, ['tools/a.mjs']);
  eq('that same row is not also an undeclared adopter', notCall.undeclaredAdopter, ['tools/b.mjs']);
  const goneRow = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: ['tools/a.mjs', 'tools/gone.mjs'] }, exists: (p) => p !== 'tools/gone.mjs' });
  eq('a row whose file is gone is stale', goneRow.staleRows, ['tools/gone.mjs']);
  const shapeless = armFindings({ candidates: ['tools/a.mjs'], adopters: [], rows: { adopted: {}, pending: ['tools/a.mjs', 'tools/c.mjs'] }, exists: all });
  eq('a pending tool that no longer matches the shape is stale', shapeless.staleRows, ['tools/c.mjs']);

  const exReason = { 'tools/a.mjs': 'its selftest plants the shape as a fixture string' };
  const exempted = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: [], exempt: exReason }, exists: all });
  eq('an exempt candidate raises no undeclared red', exempted.undeclared, []);
  const exAdopter = armFindings({ ...cen.write, rows: { adopted: {}, pending: ['tools/a.mjs'], exempt: { 'tools/b.mjs': 'a planted wrapper call' } }, exists: all });
  eq('an exempt wrapper call raises no undeclared-adopter red', exAdopter.undeclaredAdopter, []);
  const mute = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: [], exempt: { 'tools/a.mjs': '  ' } }, exists: all });
  eq('an exemption with no reason is a red', mute.muteExemptions, ['tools/a.mjs']);
  const exGone = armFindings({ ...cen.write, rows: { adopted: { 'tools/b.mjs': {} }, pending: ['tools/a.mjs'], exempt: { 'tools/gone.mjs': 'why' } }, exists: (p) => p !== 'tools/gone.mjs' });
  eq('an exemption never suppresses a stale row', exGone.staleRows, ['tools/gone.mjs']);
  const exNothing = armFindings({ candidates: [], adopters: [], rows: { adopted: {}, pending: [], exempt: { 'tools/a.mjs': 'why' } }, exists: all });
  eq('an exemption that answers for nothing is stale', exNothing.staleRows, ['tools/a.mjs']);
  eq('the ratchet names a dropped adoption', ratchetOf({ baseRows: { adopted: { 'tools/b.mjs': {} } }, headRows: { adopted: {} }, exists: all }).deAdopted, ['tools/b.mjs']);
  eq('a retired tool is not a de-adoption', ratchetOf({ baseRows: { adopted: { 'tools/gone.mjs': {} } }, headRows: { adopted: {} }, exists: (p) => p !== 'tools/gone.mjs' }).deAdopted, []);
  eq('a kept adoption passes the ratchet', ratchetOf({ baseRows: { adopted: { 'tools/b.mjs': {} } }, headRows: { adopted: { 'tools/b.mjs': {} } }, exists: all }).deAdopted, []);

  const cleanArms = { write: clean, judge: armFindings({ ...cen.judge, rows: { adopted: { 'tools/c.mjs': {} }, pending: [] }, exists: all }) };
  eq('a clean tree yields no line', findingLines(cleanArms, { deAdopted: [] }), []);
  const dirtyArms = { write: undec, judge: cleanArms.judge };
  const dLines = findingLines(dirtyArms, { deAdopted: ['tools/x.mjs'] });
  eq('every red yields one line', dLines.length, 2);
  const mLines = findingLines({ write: mute, judge: cleanArms.judge }, { deAdopted: [] });
  ok('a mute exemption yields its own line', mLines.length === 1 && mLines[0].includes('mute'));
  ok('an undeclared line names both remedies', dLines[0].includes('adopt the wrapper') && dLines[0].includes('pending'));
  ok('a de-adoption line says restore', dLines[1].includes('restore'));

  const pass = verdictOf({ perArm: cleanArms, ratchet: { deAdopted: [] }, lines: [], checked: 3, eligible: 4, commit: 'abc1234' });
  eq('a clean run passes', pass.status, 'PASS');
  eq('the population arithmetic holds', pass.population.checked + pass.population.excluded, pass.population.eligible);
  eq('a PASS carries no reason', pass.reason, null);
  eq('the criterion is pre-stated', pass.criterion, CRITERION);
  const fail = verdictOf({ perArm: dirtyArms, ratchet: { deAdopted: ['tools/x.mjs'] }, lines: dLines, checked: 3, eligible: 4, commit: 'abc1234' });
  eq('a red run fails', fail.status, 'FAIL');
  ok('a FAIL carries a reason', typeof fail.reason === 'string' && fail.reason.includes('2 site(s)'));
  eq('the result counts the dropped adoptions', fail.result.deAdopted, 1);
  const blind = verdictOf({ perArm: null, ratchet: null, lines: [], commit: null, status: 'NOT_RUN', reason: 'sample only' });
  eq('a blind run examines nothing', [blind.status, blind.result, blind.population.checked], ['NOT_RUN', null, 0]);
  for (const [n, v] of [
    ['pass', pass],
    ['fail', fail],
    ['blind', blind]
  ]) {
    const got = Verdict.validate(v);
    eq('the ' + n + ' object validates', got.errors, []);
  }
  /* The refusal path reads no tree, so it carries no commit. The verdict module refuses a null commit
     with no reason, so this leg holds the path that would otherwise throw where a reader expects an
     object. */
  ok('a blind object states why it names no commit', blind.producedBy.commit === null && typeof blind.producedBy.commitReason === 'string');
  eq('a commit present leaves no reason behind', Object.keys(pass.producedBy).sort(), ['commit', 'tool']);

  console.log(bad === 0 ? '✓ all ' + ran + ' selftests passed' : '✕ ' + bad + ' of ' + ran + ' selftests failed');
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv.includes('--verdict-sample') && isCliEntry(import.meta.url)) {
  const v = verdictOf({ perArm: null, ratchet: null, lines: [], commit: gitCommit(ROOT), status: 'NOT_RUN', reason: 'sample only; this invocation read no tool' });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
} else if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  selftest();
} else if (isCliEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
