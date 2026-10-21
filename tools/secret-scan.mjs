// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/secret-scan.mjs — the diff-scoped secret gate

       node tools/secret-scan.mjs                     # scan merge-base(origin/main)..HEAD
       node tools/secret-scan.mjs --base <ref>        # another base
       node tools/secret-scan.mjs --verdict-sample    # the verdict shape, examining nothing
       node tools/secret-scan.mjs --selftest

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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/secret-scan.mjs';
const GATE = 'secret-scan';
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

export function verdictFor({ findings, commits, privateTerms, commit, reason = null, status = null }) {
  const blind = status != null;
  const ok = !blind && findings.length <= ALLOWED_FINDINGS;
  return Verdict.make({
    gate: GATE,
    status: blind ? status : ok ? 'PASS' : 'FAIL',
    population: blind ? { checked: 0, eligible: 0, excluded: 0 } : { checked: commits, eligible: commits, excluded: 0 },
    criterion: CRITERION,
    result: blind ? null : { findings: findings.length, files: new Set(findings.map((f) => f.file)).size, privateTerms },
    evidence: [SELF, '.gitleaks.toml'],
    reason: blind ? reason : ok ? null : findings.length + ' finding(s) in the commits this branch adds; remove the value, do not allowlist it',
    producedBy: { tool: SELF, commit }
  });
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

function refuse(reason, commit) {
  const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit, status: 'NOT_RUN', reason });
  console.log(JSON.stringify(v));
  console.error('REFUSING: ' + reason);
  process.exit(2);
}

function main() {
  const commit = gitCommit();
  const bin = process.env.GITLEAKS || 'gitleaks';
  const probe = spawnSync(bin, ['version'], { encoding: 'utf8' });
  if (probe.status !== 0) refuse('the scanner binary `' + bin + '` did not run; an absent scanner is not a clean scan', commit);
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') refuse('shallow clone; the merge base is unreachable (CI needs fetch-depth: 0)', commit);

  const base = arg('--base', 'origin/main');
  let mb;
  try {
    mb = git(['merge-base', base, 'HEAD']);
  } catch {
    refuse('no merge base between `' + base + '` and HEAD', commit);
  }
  const commits = Number(git(['rev-list', '--count', mb + '..HEAD']));
  /* A PASS over zero commits is invalid under the verdict contract: nothing was examined. */
  if (commits === 0) {
    const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit, status: 'NOT_RUN', reason: 'HEAD adds no commits over ' + base });
    console.log(JSON.stringify(v));
    process.exit(0);
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
      const r = spawnSync(
        bin,
        ['git', '--log-opts=' + mb + '..HEAD', '-c', cfg, '--redact', '--no-banner', '-l', 'error', '--report-format', 'json', '--report-path', report, '--exit-code', '3', ROOT],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
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

  const v = verdictFor({ findings, commits, privateTerms: terms.length ? 'configured' : 'not-configured', commit });
  console.log(JSON.stringify(v));
  if (!terms.length) console.error('⚠ TEPNA_PRIVATE_TERMS is not set: the private-literal rule did not run; the pattern rules did');
  if (v.status === 'PASS') {
    console.log('✓ no secret in the ' + commits + ' commit(s) since ' + mb.slice(0, 9));
    process.exit(0);
  }
  console.error(v.reason);
  for (const f of findings.slice(0, 40)) console.error('   · ' + f.rule + '  ' + f.file + ':' + f.line + '  (' + f.commit + ')');
  if (findings.length > 40) console.error('   … and ' + (findings.length - 40) + ' more');
  console.error('A finding stays in history after a fix commit. Rewrite the branch so no commit carries it.');
  process.exit(1);
}

if (process.argv.includes('--verdict-sample')) {
  const v = verdictFor({ findings: [], commits: 0, privateTerms: null, commit: gitCommit(), status: 'NOT_RUN', reason: 'sample only; this invocation scanned no commits' });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
} else if (process.argv.includes('--selftest')) {
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
  ck('one finding fails', verdictFor({ findings: rec, commits: 2, privateTerms: 'configured', commit: null }).status, 'FAIL');
  const blind = verdictFor({ findings: [], commits: 0, privateTerms: null, commit: null, status: 'NOT_RUN', reason: 'r' });
  ck('a blind run is NOT_RUN with a null result', [blind.status, blind.result], ['NOT_RUN', null]);

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
      const r = spawnSync(bin, ['git', '--log-opts=HEAD~1..HEAD', '-c', cfg, '--redact', '--no-banner', '-l', 'error', '--report-format', 'json', '--report-path', rep, '--exit-code', '3', repo]);
      const got = findingsFrom(JSON.parse(readFileSync(rep, 'utf8')))
        .map((f) => f.rule)
        .sort();
      ck('end to end: the scanner exits with the findings code', r.status, 3);
      ck('end to end: address, home path and private term each fire', got, ['home-path', 'private-ipv4', 'private-term']);
      ck('end to end: the report holds no planted text', readFileSync(rep, 'utf8').includes('7731'), false);
      rmSync(cfgDir, { recursive: true, force: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  } else console.log('  · end-to-end cases skipped: no scanner binary');
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
