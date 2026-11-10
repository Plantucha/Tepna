// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/shellcheck-gate.mjs — shellcheck over the repo's OWN shell scripts

       node tools/shellcheck-gate.mjs            # gate (exit 1 on a finding)
       node tools/shellcheck-gate.mjs --json     # the verdict alone
       node tools/shellcheck-gate.mjs --selftest

   THE GAP THIS CLOSES. shellcheck ran in exactly two places, and both of them
   ran it inside `capture-host/`: `capture-host/check.sh` and the
   `capture-host-ci.yml` lint step, each under `working-directory: capture-host`.
   So the 24 scripts in `.claude/hooks/`, the 11 in `tools/` and the one beside
   the stale-file workflow faced no shell linter at all — and those hooks gate
   every session's commits. Residue
   `2026-11-10-no-gate-shellchecks-the-hook-and-tool-shell-scripts`.

   WHAT IT CAUGHT ON THE FIRST RUN. `session-tailnet.test.sh:66` held a prose
   `echo` in DOUBLE quotes with a backticked term inside it. Bash ran that term
   as a command. Measured on `94ff059fe`: the suite printed the header with a
   hole in it and `fs.pipe-max-size: command not found` on stderr, and still
   exited 0, so `test:hooks` had been carrying a shell error with nothing to
   name it. 31 findings over 13 of 36 files on that commit; the branch that adds
   this gate brings the surface to 0.

   ⚠️ THREE THINGS THIS GATE MUST NOT DO.

   1 · IT MUST NOT READ A MISSING LINTER AS A PASS. CLAUDE.md §🐍 is right that
       exit 127 from `capture-host/check.sh` is an absent tool and not a failing
       gate — and that is exactly how a 127 waves through four times in a row.
       A gate that cannot look says so (§4c): no binary gives `NOT_RUN` and
       EXIT 2, which `run-check.mjs` reds. Exit 1 means it looked and a finding
       stands. The two codes are never the same verdict.

   2 · IT MUST NAME THE BINARY AND THE VERSION IT USED. Measured and written
       into `capture-host-ci.yml` before this gate existed: the runner image's
       `/usr/bin/shellcheck` flags three SC2015 sites that the pinned 0.11.0
       does not. Two shellchecks that disagree make a green local round and a
       red CI round the same diff. So resolution is explicit — `$SHELLCHECK`,
       then the venv beside capture-host's interpreter, then PATH — and the
       resolved path and version ride in the verdict's `result`.

   3 · IT MUST NOT LINT `capture-host/` AGAIN. That tree has its own gate at
       its own severity, and a second opinion on the same file is how a repo
       ends up with two gates that disagree about one script. The population
       here is every tracked `*.sh` OUTSIDE that tree.

   THE REMEDY FOR A DELIBERATE FINDING is `# shellcheck disable=SCxxxx` with a
   comment proving why, at the line — the house rule `capture-host-ci.yml`
   already states. Not a count baseline: a count cannot tell which finding
   moved, and a per-file count still cannot say which of the file's findings is
   the new one.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** THE RATCHET IS ZERO. See the header on why there is no baseline. */
export const ALLOWED_FINDINGS = 0;

/** The strictest level, the same one `capture-host/check.sh` uses. */
export const SEVERITY = 'style';

/** `capture-host/` has its own gate — see ⚠️3. A path, not a basename, so a
    `tools/capture-host-x.sh` is NOT excluded by a stem match. */
export function gatePopulation(tracked = []) {
  return tracked.filter((f) => f.endsWith('.sh') && !f.startsWith('capture-host/')).sort();
}

/** Every tracked file. Split on NUL so a path with a newline cannot merge two. */
export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/** The resolution order from ⚠️2. Returns the path, or null when none is runnable. */
export function resolveShellcheck(root = ROOT, env = process.env, exists = existsSync) {
  if (env.SHELLCHECK && exists(env.SHELLCHECK)) return env.SHELLCHECK;
  const pinned = join(root, 'capture-host', '.venv', 'bin', 'shellcheck');
  if (exists(pinned)) return pinned;
  try {
    return execFileSync('command', ['-v', 'shellcheck'], { encoding: 'utf8', shell: '/bin/sh', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/** shellcheck's `--format=json1` payload → the counts the verdict reports.
    Pure, so the selftest decides the arithmetic without running the binary. */
export function summarise(payload = {}) {
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const byFile = {};
  const byCode = {};
  for (const c of comments) {
    const f = String(c.file ?? '?');
    const code = 'SC' + String(c.code ?? '0');
    byFile[f] = (byFile[f] ?? 0) + 1;
    byCode[code] = (byCode[code] ?? 0) + 1;
  }
  return { total: comments.length, files: Object.keys(byFile).length, byFile, byCode };
}

/** PASS · FAIL · NOT_RUN, and nothing else. A null binary examined nothing. */
export function statusFor({ binary = null, found = 0 } = {}) {
  if (!binary) return 'NOT_RUN';
  return found <= ALLOWED_FINDINGS ? 'PASS' : 'FAIL';
}

/** 0 it passed · 1 it looked and a finding stands · 2 it could not look (§4c). */
export function exitFor(status) {
  if (status === 'PASS') return 0;
  if (status === 'NOT_RUN') return 2;
  return 1;
}

function versionOf(bin) {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/^version:\s*(.+)$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function gitCommit(root = ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/** Runs the binary. Exit 0 and exit 1 both carry a payload; anything else is a
    tool fault, not a verdict, so it throws rather than reading as clean. */
function runShellcheck(bin, files, root = ROOT) {
  let out = '';
  try {
    out = execFileSync(bin, ['--severity=' + SEVERITY, '--format=json1', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (e.status !== 1 || !e.stdout) throw new Error('shellcheck exited ' + e.status + ': ' + String(e.stderr || '').slice(0, 400));
    out = e.stdout;
  }
  return JSON.parse(out);
}

function main() {
  const files = gatePopulation(trackedFiles());
  const bin = resolveShellcheck();
  const sum = bin ? summarise(runShellcheck(bin, files)) : null;
  const status = statusFor({ binary: bin, found: sum ? sum.total : 0 });
  const v = Verdict.make({
    gate: 'shellcheck-gate',
    status,
    /* No binary means nothing was examined. §∅: that is `checked: 0`, not 0 findings. */
    population: { checked: bin ? files.length : 0, eligible: files.length, excluded: bin ? 0 : files.length },
    criterion: { name: 'shellcheck_findings', threshold: ALLOWED_FINDINGS, unit: 'findings', direction: 'lte' },
    result: sum ? { findings: sum.total, files: sum.files, byCode: sum.byCode, severity: SEVERITY, shellcheck: bin, version: versionOf(bin) } : null,
    evidence: ['tools/shellcheck-gate.mjs', 'capture-host/check.sh'],
    reason:
      status === 'PASS'
        ? null
        : status === 'NOT_RUN'
          ? 'no shellcheck binary — set $SHELLCHECK, or install the pinned wheel into capture-host/.venv; a missing linter is not a clean surface'
          : sum.total + ' shellcheck finding(s) over ' + sum.files + ' of ' + files.length + ' script(s) at --severity=' + SEVERITY,
    producedBy: { tool: 'tools/shellcheck-gate.mjs', commit: gitCommit() }
  });
  const JSON_ONLY = process.argv.includes('--json');
  console.log(JSON.stringify(v));
  if (status === 'PASS') {
    if (!JSON_ONLY) console.log('✓ shellcheck --severity=' + SEVERITY + ' clean over ' + files.length + ' script(s) outside capture-host/ (' + versionOf(bin) + ')');
  } else {
    console.error(v.reason);
    if (sum) for (const [f, n] of Object.entries(sum.byFile).sort((a, b) => b[1] - a[1])) console.error('   · ' + f + ' — ' + n);
  }
  process.exit(exitFor(status));
}

if (process.argv.includes('--verdict-sample')) {
  const v = Verdict.make({
    gate: 'shellcheck-gate',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'shellcheck_findings', threshold: ALLOWED_FINDINGS, unit: 'findings', direction: 'lte' },
    result: null,
    evidence: ['tools/shellcheck-gate.mjs'],
    reason: 'sample only — this invocation ran no linter',
    producedBy: { tool: 'tools/shellcheck-gate.mjs', commit: gitCommit() }
  });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  let bad = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      bad++;
      console.log('  ✕ ' + n + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
    } else console.log('  ✓ ' + n);
  };
  /* ── the population ── */
  const tracked = ['tools/a.sh', '.claude/hooks/b.sh', 'capture-host/check.sh', 'capture-host/deploy/x.sh', 'tools/a.mjs', 'README.md'];
  ck('only .sh files, and never one under capture-host/', gatePopulation(tracked), ['.claude/hooks/b.sh', 'tools/a.sh']);
  /* ⚠️3's exclusion is by PATH PREFIX, so a similarly named script elsewhere stays in. */
  ck('a capture-host-shaped name OUTSIDE that tree stays in', gatePopulation(['tools/capture-host-probe.sh']), ['tools/capture-host-probe.sh']);
  ck('an empty tree gives an empty population, not a throw', gatePopulation([]), []);
  ck('the real population is not empty', gatePopulation(trackedFiles()).length > 0, true);
  /* The three places the gap was: hooks, tools, and the one beside a workflow. */
  const real = gatePopulation(trackedFiles());
  ck(
    '…and it covers .claude/hooks/',
    real.some((f) => f.startsWith('.claude/hooks/')),
    true
  );
  ck(
    '…and tools/',
    real.some((f) => f.startsWith('tools/')),
    true
  );
  ck('…and the script beside a workflow', real.includes('.github/workflows/stale-file.test.sh'), true);
  ck(
    '…and no capture-host/ script',
    real.some((f) => f.startsWith('capture-host/')),
    false
  );
  /* ── the arithmetic ── */
  ck('no comments is a zero summary', summarise({ comments: [] }), { total: 0, files: 0, byFile: {}, byCode: {} });
  ck('a payload with no comments field does not throw', summarise({}).total, 0);
  ck(
    'two findings in one file count once as a file and twice as findings',
    summarise({
      comments: [
        { file: 'a.sh', code: 2069 },
        { file: 'a.sh', code: 2069 }
      ]
    }),
    { total: 2, files: 1, byFile: { 'a.sh': 2 }, byCode: { SC2069: 2 } }
  );
  ck(
    'codes are counted separately across files',
    summarise({
      comments: [
        { file: 'a.sh', code: 2016 },
        { file: 'b.sh', code: 2164 }
      ]
    }).byCode,
    { SC2016: 1, SC2164: 1 }
  );
  /* ── the three verdicts, and the exit code each one owes ── */
  ck('a clean run passes', statusFor({ binary: '/x/shellcheck', found: 0 }), 'PASS');
  ck('one finding fails', statusFor({ binary: '/x/shellcheck', found: 1 }), 'FAIL');
  /* 🔴 THE WHOLE POINT. No binary is NOT a clean surface. */
  ck('no binary and no findings is NOT_RUN, never PASS', statusFor({ binary: null, found: 0 }), 'NOT_RUN');
  ck('…and NOT_RUN exits 2, which means it could not look', exitFor('NOT_RUN'), 2);
  ck('a finding exits 1, which means it looked', exitFor('FAIL'), 1);
  ck('a pass exits 0', exitFor('PASS'), 0);
  ck('the ratchet is zero, with no baseline', ALLOWED_FINDINGS, 0);
  ck('the severity is the strictest level', SEVERITY, 'style');
  /* ── resolution order (⚠️2), decided without running a binary ── */
  const yes = () => true;
  const no = () => false;
  ck('$SHELLCHECK wins when it exists', resolveShellcheck('/r', { SHELLCHECK: '/env/sc' }, yes), '/env/sc');
  ck(
    '…and is skipped when it does not',
    resolveShellcheck('/r', { SHELLCHECK: '/gone/sc' }, (p) => p !== '/gone/sc'),
    join('/r', 'capture-host', '.venv', 'bin', 'shellcheck')
  );
  ck('the venv beside capture-host comes next', resolveShellcheck('/r', {}, yes), join('/r', 'capture-host', '.venv', 'bin', 'shellcheck'));
  ck('a tree with neither falls through to PATH, not to a throw', typeof resolveShellcheck('/r', {}, no), 'string');
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
