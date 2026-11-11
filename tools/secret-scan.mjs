// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/secret-scan.mjs — the diff-scoped secret gate

       node tools/secret-scan.mjs                     # scan merge-base(origin/main)..HEAD
       node tools/secret-scan.mjs --base <ref>        # another base
       node tools/secret-scan.mjs --tree              # the walked tree, opt-in, never a gate
       node tools/secret-scan.mjs --json              # the verdict object alone on stdout
       node tools/secret-scan.mjs --verdict-sample    # the verdict shape, examining nothing
       node tools/secret-scan.mjs --selftest

   Run it from the checkout you mean: this gate judges the tree it was RUN FROM, and refuses when that
   disagrees with the copy you invoked (`tools/write-root.mjs`).

   Owner, 2026-10-20: a secret scanner with our own rules as a CI gate. The
   scanner is the pinned `gitleaks` binary (CI downloads it by checksum; set
   $GITLEAKS to point at a local copy). The rules are `.gitleaks.toml`: the
   scanner's default credential rules plus private and shared addresses and
   home-directory paths.

   ⚠️ THREE CONSTRAINTS SHAPE IT.

   1 · DIFF-SCOPED, BECAUSE HISTORY ALREADY LEAKS. Tracked files on main hold
       private addresses and home paths today. A whole-tree gate reds on every
       PR until history is rewritten, and that is the owner's decision. This
       gate scans the commits a PR adds, so it stops NEW leaks and nothing else.

       ⚠️ A GREEN IS A STATEMENT ABOUT THE WALK, NEVER ABOUT THE TREE. `--tree`
       runs the scanner over the files on disk, so a value that landed before
       this gate existed can be examined on demand. It is OPT-IN and no workflow
       calls it: wiring a whole-tree gate stays the owner's call, and a tree
       finding is history the owner decides how to rewrite. Every verdict names
       its walk in `result.walk`, and the population counts commits for `diff`
       and walked files for `tree`, so neither green can be read as the other.
       The walk list is git's own `ls-files --cached --others --exclude-standard`
       and the count is the files that walk covers; the scanner may skip one it
       cannot read, so the count is the walk and not a proof of every byte.
       `dir` reads the DIRECTORY, so it also reaches git-ignored paths the walk
       list never names — a virtualenv, a cache, a build tree. A tree verdict
       therefore counts only the findings whose file the walk list holds, and
       states the rest as `droppedFindings` / `droppedFiles` beside them. One
       verdict names one population: `population.checked` and `result.findings`
       describe the same file set, and what the filter removed stays visible.
       `dir` is the scanner's whole-tree command (pinned 8.30.1); unlike the
       diff walk it needs no merge base, so it answers on a shallow clone.

   2 · THE LITERALS NEVER ENTER THE REPO. The exact device addresses, serials
       and host names are private, and the repo is public. They arrive at run
       time in $TEPNA_PRIVATE_TERMS (one per line, a CI secret). The tool
       writes them into a 0600 temp config, deletes it in a `finally`, and
       always runs the scanner with `--redact`. A finding prints its rule, file
       and line, never the text.

   3 · BLIND IS NOT CLEAN. An absent scanner, a shallow clone or an unreadable
       report exits 2 with a non-PASS verdict. Each one produces the same
       silence as a clean scan and means the opposite.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { WriteRootRefusal, judgeRoot } from './write-root.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
/* The DEFAULT only, for a library import and for `--verdict-sample`, which examine no tree. A real run
   replaces it in `main` with the checkout it was RUN FROM — see the comment there. */
let ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/secret-scan.mjs';
const GATE = 'secret-scan';
/* The one rule whose literals never enter this repo: it reads them from the environment. */
export const PRIVATE_RULE = 'private-term';
export const ALLOWED_FINDINGS = 0;
const CRITERION = { name: 'secret_findings', threshold: ALLOWED_FINDINGS, unit: 'findings', direction: 'lte' };

/** One term per line; blank lines and `#` comments drop. Never logged. */
export function parseTerms(text) {
  if (text == null) return [];
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

/** Escape a literal for a Go RE2 regex inside a TOML literal string. */
export function escapeRe(s) {
  return s.replace(/[\\.*+?^${}()|[\]]/g, '\\$&');
}

/** The extra rule for the private literals, or '' when none are set. */
export function privateTermsToml(terms, base = '.gitleaks.toml') {
  if (!terms.length) return '';
  /* A term holding ''' would close the TOML literal string. Refuse it rather than corrupt the rule. */
  if (terms.some((t) => t.includes("'''"))) throw new Error('a private term contains three single quotes');
  return [
    '[extend]',
    'path = ' + JSON.stringify(base),
    '',
    '[[rules]]',
    'id = "private-term"',
    'description = "a private literal from TEPNA_PRIVATE_TERMS"',
    "regex = '''(?i)(?:" + terms.map(escapeRe).join('|') + ")'''",
    ''
  ].join('\n');
}

/** Map the scanner's JSON report to records that carry NO matched text. */
export function findingsFrom(report) {
  if (!Array.isArray(report)) throw new Error('the scanner report is not a JSON array');
  return report.map((f) => ({
    rule: String(f.RuleID),
    file: String(f.File),
    line: Number(f.StartLine),
    commit: String(f.Commit || '').slice(0, 9) || null
  }));
}

/** Repo-relative form of a report path: `dir` reports the absolute path it was handed. */
export function relPathIn(file, root) {
  const r = String(root).endsWith('/') ? String(root) : String(root) + '/';
  return file.startsWith(r) ? file.slice(r.length) : file;
}

/**
 * Split tree findings by the walk list, which IS the stated population.
 * `dir` reads the directory, so it reaches git-ignored paths the list never
 * names; counting those against a population of walked files would describe two
 * file sets in one verdict. Kept and dropped findings both carry the
 * repo-relative path, so a dropped count is readable and prints no home path.
 */
export function partitionByWalk(findings, walkList, root) {
  if (!(walkList instanceof Set)) throw new Error('the walk list is the population; a partition against an absent one states nothing');
  const kept = [];
  const dropped = [];
  for (const f of findings) {
    const rel = relPathIn(f.file, root);
    (walkList.has(rel) ? kept : dropped).push({ ...f, file: rel });
  }
  return { kept, dropped };
}

export const WALKS = ['diff', 'tree'];

/**
 * The scanner argv for one walk — the ONE place either shape is spelled, so the
 * selftest drives the same builder the scan runs. `diff` reads a commit range;
 * `tree` reads the files on disk. An unknown walk throws, because a scan with no
 * scope would silently take the other one.
 */
export function scannerArgs({ walk, range = null, cfg, report, target }) {
  if (!WALKS.includes(walk)) throw new Error('unknown walk `' + walk + '`: a scan has no default scope');
  if (walk === 'diff' && !range) throw new Error('the diff walk needs a commit range; an absent range is every commit, which is another scope');
  const tail = ['-c', cfg, '--redact', '--no-banner', '-l', 'error', '--report-format', 'json', '--report-path', report, '--exit-code', '3', target];
  return walk === 'diff' ? ['git', '--log-opts=' + range, ...tail] : ['dir', ...tail];
}

/** What the filter removed, stated rather than silent. */
export function droppedNote(dropped) {
  const files = new Set(dropped.map((f) => f.file)).size;
  return '⚠ ' + dropped.length + ' finding(s) in ' + files + ' file(s) sit outside this verdict: the scanner read them and the walk list does not name them (an ignored path).';
}

export function verdictFor({ findings, commits, privateTerms, commit, reason = null, status = null, walk = 'diff', walked = null, dropped = null }) {
  const blind = status != null;
  const ok = !blind && findings.length <= ALLOWED_FINDINGS;
  /* Row 2026-11-10-the-required-secret-gate-never-ran-its-private-literal-rule. The pattern rules
     read the population; the private-literal rule read 0 term(s) whenever the term list is empty.
     One PASS over two different examined sets would report a clean scan of literals nobody looked
     for, so the status names the skip. The exit code keeps reading the findings, never the status,
     because a rule that examined nothing is not a reason to block every branch. */
  const litBlind = !blind && ok && privateTerms === 'not-configured';
  if (!WALKS.includes(walk)) throw new Error('unknown walk `' + walk + '`: a verdict names the scope it examined');
  /* A tree verdict with no file count would claim a walk over an unstated population. */
  if (!blind && walk === 'tree' && !(Number.isFinite(walked) && walked > 0)) throw new Error('the tree walk needs its file count; a population of none is NOT_RUN');
  /* Without the dropped set the tree verdict would count a filtered population and hide the filter. */
  if (!blind && walk === 'tree' && !Array.isArray(dropped)) throw new Error('the tree verdict states what the walk list dropped; an absent drop count hides a second population');
  const n = walk === 'tree' ? walked : commits;
  return Verdict.make({
    gate: GATE,
    status: blind ? status : ok ? (litBlind ? 'SHORTFALL' : 'PASS') : 'FAIL',
    population: blind ? { checked: 0, eligible: 0, excluded: 0 } : { checked: n, eligible: n, excluded: 0 },
    criterion: CRITERION,
    result: blind
      ? null
      : {
          findings: findings.length,
          files: new Set(findings.map((f) => f.file)).size,
          privateTerms,
          skippedRules: litBlind ? [PRIVATE_RULE] : [],
          walk,
          walked,
          ...(walk === 'tree' ? { droppedFindings: dropped.length, droppedFiles: new Set(dropped.map((f) => f.file)).size } : {})
        },
    evidence: [SELF, '.gitleaks.toml'],
    reason: blind
      ? reason
      : litBlind
        ? 'the `' +
          PRIVATE_RULE +
          '` rule examined 0 term(s): TEPNA_PRIVATE_TERMS is empty, so the literals this gate exists for reached no rule; the pattern rules read all ' +
          n +
          ' ' +
          (walk === 'tree' ? 'walked file(s)' : 'commit(s)')
        : ok
          ? null
          : findings.length +
            (walk === 'tree'
              ? ' finding(s) in the ' + walked + ' walked file(s), beside ' + dropped.length + ' the walk list drops; a value may predate this gate, so report the rule and file to the owner'
              : ' finding(s) in the commits this branch adds; remove the value, do not allowlist it'),
    producedBy: { tool: SELF, commit }
  });
}

/**
 * The gate blocks on findings alone. A status that reports a skipped rule is a statement about
 * COVERAGE, and blocking every branch over it would stop the fleet without examining one literal.
 */
export function blocksLanding(findings) {
  return findings.length > ALLOWED_FINDINGS;
}

/** The run summary a reader sees beside a green check, so a skipped rule leaves the job log. */
export function summaryFor(v) {
  const skipped = (v && v.result && v.result.skippedRules) || [];
  const lines = ['### secret-scan \u2014 ' + (v && v.status ? v.status : 'no verdict object'), ''];
  lines.push('- rules that examined nothing: ' + (skipped.length ? skipped.join(', ') : 'none'));
  if (v && v.reason) lines.push('- ' + v.reason);
  return lines.join('\n') + '\n';
}

function writeStepSummary(v) {
  const dest = process.env.GITHUB_STEP_SUMMARY;
  if (!dest) return false;
  try {
    appendFileSync(dest, summaryFor(v));
    return true;
  } catch {
    /* A summary nobody can write is never a reason to change the scan's answer. */
    return false;
  }
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function gitCommit() {
  try {
    return git(['rev-parse', '--short', 'HEAD']) || null;
  } catch {
    return null;
  }
}

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/* Per walk, because the flags differ: `--base` is a diff word and names a range the tree walk never
   reads. One flat spec would accept `--tree --base <ref>` and answer about a scope nobody asked for. */
function argvSpecFor(walk) {
  /* `--tree` sits in the diff spec for the SUGGESTION only: a literal `--tree` always selects the
     tree spec above, so the diff walk never reads it. Without it, `--tre` would be refused with no
     hint of the word it nearly spelled. */
  return walk === 'tree' ? { boolean: ['--tree', '--json'] } : { boolean: ['--tree', '--json'], valued: ['--base'] };
}

/* ── THE OBJECT IS THE API, SO ONE STREAM CARRIES ONE SHAPE ────────────────────────────────
   Residue `2026-11-10-secret-scan-prose-shares-stdout-with-its-verdict`. Measured 2026-11-10 at
   `4f6d6ecab`: one clean run wrote the `tepna.verdict/1` object AND one prose line to stdout, so
   `json.loads` raised `Extra data: line 2 column 1`. CI reads the exit code alone, so the defect
   stayed latent, and a consumer that wanted the object had no way to ask for it. `--json` drops the
   prose, as `ste-lint.mjs`, `pr-compliance.mjs` and `residue-ids.mjs` each already do. Every
   diagnostic line already goes to stderr, so the flag hides nothing a reader of a red needs. */
export function proseWanted(argv) {
  return !argv.includes('--json');
}

/* The clean sentence, pure. Under a skipped rule a bare "no secret" would claim a scan of the
   literals nobody read, so a SHORTFALL names that rule and every other clean status names the
   population it examined. */
export function passNote(status, population, rule = PRIVATE_RULE) {
  return status === 'SHORTFALL' ? '⚠ no pattern-rule secret in the ' + population + '; the `' + rule + '` rule examined 0 term(s)' : '✓ no secret in the ' + population;
}

function refuse(reason, commit) {
  const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit, status: 'NOT_RUN', reason });
  console.log(JSON.stringify(v));
  console.error('REFUSING: ' + reason);
  process.exit(2);
}

function main() {
  /* The walk is read before the guard, because the spec that judges the argv depends on it. */
  const walk = process.argv.includes('--tree') ? 'tree' : 'diff';
  refuseUnknownArgvOrExit(process.argv.slice(2), argvSpecFor(walk), { tool: 'secret-scan' });

  /* A GATE JUDGES THE CHECKOUT IT WAS RUN FROM, never the one it lives in. Measured 2026-11-04:
     `node <shared root>/tools/secret-scan.mjs` from a worktree answered `NOT_RUN — HEAD adds no
     commits over origin/main`, because every `git` call below runs with `cwd: ROOT`. That sentence was
     true of the shared root and said nothing about the branch the reader had just pushed. Residue
     `2026-11-04-a-verdict-gate-judges-the-checkout-it-lives-in-not-the-one-it-ran-from`. The refusal
     goes through `refuse`, so the run still emits one verdict rather than dying mute. */
  try {
    ROOT = judgeRoot(import.meta.url);
  } catch (e) {
    if (!(e instanceof WriteRootRefusal)) throw e;
    console.error(e.message);
    refuse('this run and ' + SELF + ' sit in different checkouts (' + e.reason + '), so which tree to scan is undecided', null);
  }

  const commit = gitCommit();
  const bin = process.env.GITLEAKS || 'gitleaks';
  const probe = spawnSync(bin, ['version'], { encoding: 'utf8' });
  if (probe.status !== 0) refuse('the scanner binary `' + bin + '` did not run; an absent scanner is not a clean scan', commit);

  let mb = null;
  let commits = 0;
  let walked = null;
  let walkList = null;
  if (walk === 'tree') {
    /* No merge base and no shallow check: the files on disk are everything this walk reads. */
    const list = git(['ls-files', '--cached', '--others', '--exclude-standard']);
    walkList = new Set(list ? list.split('\n') : []);
    walked = walkList.size;
    if (walked === 0) refuse('the walk listed no file; nothing was examined', commit);
  } else {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') refuse('shallow clone; the merge base is unreachable (CI needs fetch-depth: 0)', commit);
    const base = arg('--base', 'origin/main');
    try {
      mb = git(['merge-base', base, 'HEAD']);
    } catch {
      refuse('no merge base between `' + base + '` and HEAD', commit);
    }
    commits = Number(git(['rev-list', '--count', mb + '..HEAD']));
    /* A PASS over zero commits is invalid under the verdict contract: nothing was examined. */
    if (commits === 0) {
      const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit, status: 'NOT_RUN', reason: 'HEAD adds no commits over ' + base });
      console.log(JSON.stringify(v));
      process.exit(0);
    }
  }

  const terms = parseTerms(process.env.TEPNA_PRIVATE_TERMS);
  const tmp = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  let findings;
  try {
    let cfg = join(ROOT, '.gitleaks.toml');
    if (terms.length) {
      const extra = join(tmp, 'private.toml');
      writeFileSync(extra, privateTermsToml(terms, cfg), { mode: 0o600 });
      cfg = extra;
    }
    const report = join(tmp, 'report.json');
    {
      const r = spawnSync(bin, scannerArgs({ walk, range: mb ? mb + '..HEAD' : null, cfg, report, target: ROOT }), {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      });
      /* 0 = clean, 3 = findings (our exit code); anything else is the scanner failing. */
      if (r.status !== 0 && r.status !== 3) refuse('the scanner exited ' + r.status + ' without a verdict', commit);
      try {
        findings = findingsFrom(JSON.parse(readFileSync(report, 'utf8')));
      } catch (e) {
        refuse('the scanner report did not parse (' + e.message + ')', commit);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  /* The scanner's `dir` walk reaches git-ignored paths, so the report is wider than the population. */
  let dropped = null;
  if (walk === 'tree') {
    const part = partitionByWalk(findings, walkList, ROOT);
    findings = part.kept;
    dropped = part.dropped;
  }

  const v = verdictFor({ findings, commits, privateTerms: terms.length ? 'configured' : 'not-configured', commit, walk, walked, dropped });
  console.log(JSON.stringify(v));
  writeStepSummary(v);
  if (!terms.length) console.error('⚠ TEPNA_PRIVATE_TERMS is not set: the private-literal rule did not run; the pattern rules did');
  if (!blocksLanding(findings)) {
    const population = walk === 'tree' ? walked + ' walked file(s)' : commits + ' commit(s) since ' + mb.slice(0, 9);
    if (proseWanted(process.argv)) console.log(passNote(v.status, population));
    if (dropped && dropped.length) console.error(droppedNote(dropped));
    process.exit(0);
  }
  console.error(v.reason);
  if (dropped && dropped.length) console.error(droppedNote(dropped));
  for (const f of findings.slice(0, 40)) console.error('   · ' + f.rule + '  ' + f.file + ':' + f.line + '  (' + f.commit + ')');
  if (findings.length > 40) console.error('   … and ' + (findings.length - 40) + ' more');
  console.error(
    walk === 'tree'
      ? "A tree finding may predate this gate. Report the rule and file to the owner, never the value; rewriting history is the owner's call."
      : 'A finding stays in history after a fix commit. Rewrite the branch so no commit carries it.'
  );
  process.exit(1);
}

if (process.argv.includes('--verdict-sample') && isCliEntry(import.meta.url)) {
  const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit: gitCommit(), status: 'NOT_RUN', reason: 'sample only; this invocation scanned no commits' });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
} else if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  let bad = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const okk = JSON.stringify(got) === JSON.stringify(want);
    if (!okk) {
      bad++;
      console.log('  ✕ ' + n + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
    } else console.log('  ✓ ' + n);
  };
  ck('terms: blank lines and comments drop', parseTerms('a\n\n# note\n  b  \r\n'), ['a', 'b']);
  ck('terms: an unset variable is no terms, not one empty term', parseTerms(undefined), []);
  ck('escape: a dotted literal matches only itself', escapeRe('a.b'), 'a\\.b');
  ck('escape: colons pass through', escapeRe('AA:BB'), 'AA:BB');
  ck('no terms -> no extra rule', privateTermsToml([]), '');
  const toml = privateTermsToml(['x.y', 'Z1'], 'base.toml');
  ck('the extra rule extends the base file', toml.includes('path = "base.toml"'), true);
  ck('the extra rule is case-insensitive and escaped', toml.includes("'''(?i)(?:x\\.y|Z1)'''"), true);
  let threw = false;
  try {
    privateTermsToml(["a'''b"]);
  } catch {
    threw = true;
  }
  ck('a term that would close the TOML string is refused', threw, true);
  const rec = findingsFrom([{ RuleID: 'r', File: 'f', StartLine: 3, Commit: 'abcdef0123', Secret: 'S', Match: 'M', Line: 'L' }]);
  ck('a finding record carries no matched text', Object.keys(rec[0]).sort(), ['commit', 'file', 'line', 'rule']);
  threw = false;
  try {
    findingsFrom({});
  } catch {
    threw = true;
  }
  ck('a non-array report is refused, not read as clean', threw, true);
  ck('zero findings over commits passes', verdictFor({ findings: [], commits: 2, privateTerms: 'configured', commit: null }).status, 'PASS');
  const unlit = verdictFor({ findings: [], commits: 2, privateTerms: 'not-configured', commit: null });
  ck('a clean run with no term list is SHORTFALL, not PASS', unlit.status, 'SHORTFALL');
  ck('and it names the rule that examined nothing', unlit.result.skippedRules, [PRIVATE_RULE]);
  ck('and the reason states the term count it read', unlit.reason.includes('examined 0 term(s)'), true);
  ck('a configured clean run skips no rule', verdictFor({ findings: [], commits: 2, privateTerms: 'configured', commit: null }).result.skippedRules, []);
  ck('the exit decision reads the findings, never the status word', [blocksLanding([]), blocksLanding(rec)], [false, true]);
  ck('a finding with no term list still FAILs', verdictFor({ findings: rec, commits: 2, privateTerms: 'not-configured', commit: null }).status, 'FAIL');
  ck('the summary names the status and the skipped rule', [summaryFor(unlit).includes('SHORTFALL'), summaryFor(unlit).includes(PRIVATE_RULE)], [true, true]);
  ck('the summary of a configured run names no skipped rule', summaryFor(verdictFor({ findings: [], commits: 2, privateTerms: 'configured', commit: null })).includes('nothing: none'), true);
  ck('a verdict with no result still summarises', summaryFor(null).includes('no verdict object'), true);
  ck('one finding fails', verdictFor({ findings: rec, commits: 2, privateTerms: 'configured', commit: null }).status, 'FAIL');
  const blind = verdictFor({ findings: [], commits: 0, privateTerms: null, commit: null, status: 'NOT_RUN', reason: 'r' });
  ck('a blind run is NOT_RUN with a null result', [blind.status, blind.result], ['NOT_RUN', null]);
  ck('the diff spec accepts --json', argvSpecFor('diff').boolean.includes('--json'), true);
  ck('the tree spec accepts it too, so neither walk refuses the word', argvSpecFor('tree').boolean.includes('--json'), true);
  ck('--json drops the prose', proseWanted(['--json']), false);
  ck('a run without it keeps the prose', proseWanted(['--base', 'origin/main']), true);
  ck('a SHORTFALL note names the rule that examined nothing', passNote('SHORTFALL', '2 commit(s)').includes(PRIVATE_RULE), true);
  ck('and it never reads as a clean scan of those literals', passNote('SHORTFALL', '2 commit(s)').includes('✓'), false);
  ck('a PASS note names its population', passNote('PASS', '2 commit(s)'), '✓ no secret in the 2 commit(s)');
  /* ── THE PURITY CASE DRIVES THE REAL CLI, BECAUSE A HELPER CANNOT PROVE A STREAM ────────────
     A stub stands in for the scanner, so this case needs no binary: it answers the version probe and
     writes an empty report. The run then reaches the clean path that used to mix prose into stdout.
     A run that examined nothing says so and asserts nothing about the prose — a refusal prints one
     object and no sentence, which would read as a pass for the wrong reason. */
  {
    const d = mkdtempSync(join(tmpdir(), 'secret-scan-cli-'));
    const stub = join(d, 'stub.mjs');
    writeFileSync(
      stub,
      "#!/usr/bin/env node\nimport { writeFileSync as w } from 'node:fs';\nconst a = process.argv.slice(2);\nif (a[0] === 'version') { console.log('stub 0.0.0'); process.exit(0); }\nw(a[a.indexOf('--report-path') + 1], '[]');\n",
      { mode: 0o755 }
    );
    const run = (...extra) =>
      spawnSync(process.execPath, [join(ROOT, SELF), '--base', 'HEAD~1', ...extra], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, GITLEAKS: stub, GITHUB_STEP_SUMMARY: '' }
      });
    const quiet = run('--json');
    const loud = run();
    let parsed = null;
    try {
      parsed = JSON.parse(quiet.stdout);
    } catch {
      parsed = null;
    }
    ck('the --json run writes one parseable object to stdout', parsed && parsed.schema, 'tepna.verdict/1');
    if (!parsed || parsed.status === 'NOT_RUN') {
      console.log('  · the prose case examined nothing: ' + ((parsed && parsed.reason) || 'stdout did not parse'));
    } else {
      ck('the ordinary run still explains itself on stdout', loud.stdout.trim().split('\n').length, 2);
      ck('and --json drops exactly that one line', quiet.stdout.trim().split('\n').length, 1);
    }
    rmSync(d, { recursive: true, force: true });
  }
  const dArgs = scannerArgs({ walk: 'diff', range: 'A..B', cfg: 'c.toml', report: 'r.json', target: '/t' });
  ck('the diff walk reads a range', [dArgs[0], dArgs[1]], ['git', '--log-opts=A..B']);
  const tArgs = scannerArgs({ walk: 'tree', cfg: 'c.toml', report: 'r.json', target: '/t' });
  ck('the tree walk reads the files on disk and names no range', [tArgs[0], tArgs.some((a) => String(a).startsWith('--log-opts'))], ['dir', false]);
  ck('both walks redact and carry the findings code', [dArgs.includes('--redact'), tArgs.includes('--redact'), tArgs[tArgs.indexOf('--exit-code') + 1]], [true, true, '3']);
  for (const [n, f] of [
    ['an unknown walk is refused, not defaulted', () => scannerArgs({ walk: 'all', cfg: 'c', report: 'r', target: '/t' })],
    ['a diff walk with no range is refused', () => scannerArgs({ walk: 'diff', cfg: 'c', report: 'r', target: '/t' })],
    ['a tree verdict with no file count is refused', () => verdictFor({ findings: [], commits: 0, privateTerms: null, commit: null, walk: 'tree' })],
    ['a tree verdict with no dropped set is refused', () => verdictFor({ findings: [], commits: 0, privateTerms: null, commit: null, walk: 'tree', walked: 7 })],
    ['a partition against an absent walk list is refused', () => partitionByWalk([], ['a.txt'], '/r')]
  ]) {
    let t = false;
    try {
      f();
    } catch {
      t = true;
    }
    ck(n, t, true);
  }
  const tv = verdictFor({ findings: [], commits: 0, privateTerms: 'configured', commit: null, walk: 'tree', walked: 3401, dropped: [] });
  ck('a tree verdict counts walked files and names its walk', [tv.population.checked, tv.result.walk], [3401, 'tree']);
  ck('a tree verdict states a drop of none rather than omitting it', [tv.result.droppedFindings, tv.result.droppedFiles], [0, 0]);
  ck('relative paths: the root prefix comes off and a relative path is left alone', [relPathIn('/r/a/b.txt', '/r'), relPathIn('a/b.txt', '/r')], ['a/b.txt', 'a/b.txt']);
  ck('relative paths: a sibling directory sharing the prefix stays absolute', relPathIn('/root2/a.txt', '/root'), '/root2/a.txt');
  const part = partitionByWalk(
    [
      { rule: 'r', file: '/r/kept.txt', line: 1, commit: null },
      { rule: 'r', file: '/r/.venv/lib/x.py', line: 2, commit: null },
      { rule: 'r', file: '/r/.venv/lib/y.py', line: 3, commit: null }
    ],
    new Set(['kept.txt']),
    '/r'
  );
  ck('the walk list keeps its own file and drops an ignored path', [part.kept.map((f) => f.file), part.dropped.length], [['kept.txt'], 2]);
  ck(
    'both sides carry the repo-relative path, so no home path is printed',
    part.dropped.map((f) => f.file),
    ['.venv/lib/x.py', '.venv/lib/y.py']
  );
  const dv = verdictFor({ findings: part.kept, commits: 0, privateTerms: 'configured', commit: null, walk: 'tree', walked: 9, dropped: part.dropped });
  ck('one tree verdict, one population: the findings count is the walked set', [dv.result.findings, dv.result.files, dv.population.checked], [1, 1, 9]);
  ck('the drop is published beside it, one file set each', [dv.result.droppedFindings, dv.result.droppedFiles], [2, 2]);
  ck('a drop alone never fails the gate', verdictFor({ findings: [], commits: 0, privateTerms: 'configured', commit: null, walk: 'tree', walked: 9, dropped: part.dropped }).status, 'PASS');
  ck('the dropped note counts findings and files and quotes no path', [droppedNote(part.dropped).includes('2 finding(s) in 2 file(s)'), droppedNote(part.dropped).includes('.venv')], [true, false]);
  ck(
    'a diff verdict counts commits and names its walk',
    (() => {
      const d = verdictFor({ findings: [], commits: 2, privateTerms: 'configured', commit: null });
      return [d.population.checked, d.result.walk, d.result.walked];
    })(),
    [2, 'diff', null]
  );

  /* The end-to-end case needs the binary. CI's selftest loop has none, so this half is optional. */
  const bin = process.env.GITLEAKS || 'gitleaks';
  if (spawnSync(bin, ['version']).status === 0) {
    const repo = mkdtempSync(join(tmpdir(), 'secret-scan-st-'));
    try {
      const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
      g('init', '-q');
      g('config', 'user.email', 't@t');
      g('config', 'user.name', 't');
      writeFileSync(join(repo, 'a.txt'), 'clean\n');
      g('add', 'a.txt');
      g('commit', '-qm', 'base');
      /* Every planted value is assembled at run time, so this source is not a finding itself. */
      const planted = ['host ' + ['192', '168', '7', '20'].join('.'), 'path /ho' + 'me/alice/x', 'device ' + 'QX' + '7731'];
      writeFileSync(join(repo, 'a.txt'), planted.join('\n') + '\n');
      g('add', 'a.txt');
      g('commit', '-qm', 'leak');
      const cfgDir = mkdtempSync(join(tmpdir(), 'secret-scan-cfg-'));
      const cfg = join(cfgDir, 'c.toml');
      writeFileSync(cfg, privateTermsToml(['qx' + '7731'], join(ROOT, '.gitleaks.toml')), { mode: 0o600 });
      const rep = join(cfgDir, 'r.json');
      const r = spawnSync(bin, scannerArgs({ walk: 'diff', range: 'HEAD~1..HEAD', cfg, report: rep, target: repo }));
      const got = findingsFrom(JSON.parse(readFileSync(rep, 'utf8')))
        .map((f) => f.rule)
        .sort();
      ck('end to end: the scanner exits with the findings code', r.status, 3);
      ck('end to end: address, home path and private term each fire', got, ['home-path', 'private-ipv4', 'private-term']);
      ck('end to end: the report holds no planted text', readFileSync(rep, 'utf8').includes('7731'), false);
      const trep = join(cfgDir, 'tree.json');
      const rt = spawnSync(bin, scannerArgs({ walk: 'tree', cfg, report: trep, target: repo }));
      const tree = findingsFrom(JSON.parse(readFileSync(trep, 'utf8')));
      ck('end to end: the tree walk reads the same value from the file on disk', rt.status, 3);
      ck('end to end: the tree walk fires the same three rules', tree.map((f) => f.rule).sort(), ['home-path', 'private-ipv4', 'private-term']);
      ck(
        'end to end: a tree finding names no commit',
        tree.every((f) => f.commit === null),
        true
      );
      /* The same three values in a git-ignored directory: the scanner reads them, the walk list drops them. */
      mkdirSync(join(repo, 'cache'));
      writeFileSync(join(repo, 'cache', 'b.txt'), planted.join('\n') + '\n');
      writeFileSync(join(repo, '.gitignore'), 'cache/\n');
      const irep = join(cfgDir, 'ignored.json');
      spawnSync(bin, scannerArgs({ walk: 'tree', cfg, report: irep, target: repo }));
      const wide = findingsFrom(JSON.parse(readFileSync(irep, 'utf8')));
      const list = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim();
      const split = partitionByWalk(wide, new Set(list.split('\n')), repo);
      ck('end to end: the scanner report is wider than the walk list', wide.length > split.kept.length, true);
      ck(
        'end to end: the ignored copy drops and the tracked one stays',
        [split.kept.map((f) => f.file).sort(), split.dropped.map((f) => f.file).sort()],
        [
          ['a.txt', 'a.txt', 'a.txt'],
          ['cache/b.txt', 'cache/b.txt', 'cache/b.txt']
        ]
      );
      const ev = verdictFor({ findings: split.kept, commits: 0, privateTerms: 'configured', commit: null, walk: 'tree', walked: new Set(list.split('\n')).size, dropped: split.dropped });
      ck('end to end: the verdict counts the walked set and states the drop', [ev.result.findings, ev.result.droppedFindings, ev.result.droppedFiles], [3, 3, 1]);
      rmSync(cfgDir, { recursive: true, force: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  } else console.log('  · end-to-end cases skipped: no scanner binary');
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
} else if (isCliEntry(import.meta.url)) main();
