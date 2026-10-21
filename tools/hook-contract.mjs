/*
 * hook-contract.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * EVERY CLAUDE-CODE HOOK DRAINS ITS STDIN BEFORE IT CAN EXIT.
 *
 * The harness writes each hook's tool-call JSON down a PIPE. A hook that exits before reading it
 * leaves the writer holding a closed pipe: the writer takes SIGPIPE, a `jq | hook` pipeline reports
 * 141, and the hook's own code still reads 0 (#3493; `trim-output.sh:72-91`). The decision the
 * harness asked for is intact; the writer's death is not, and under `pipefail` the writer's death is
 * what the pipeline reports.
 *
 * WHY A GATE AND NOT A REVIEW. Residue
 * `2026-10-12-seven-hooks-exit-before-draining-stdin-and-their-tests-cannot-see-it` named seven
 * hooks with this shape, and its second half is that no self-test could observe it: every leg read
 * the hook's own exit code, so a writer's 141 scored as the ALLOW it wanted. Both halves were
 * repaired hook by hook, the last two by #3759 with a `read` builtin so the hot path kept its
 * measured cost. Nothing held the shape for the NEXT hook: `session-tailnet.sh` was written after
 * that row was logged and shipped with no drain at all. Prevention is agent-coupled, detection is
 * agent-neutral and lives in CI (CLAUDE.md §👥.2), so the contract belongs in `npm run check`.
 *
 * TWO INDEPENDENT READINGS, because either one alone can be fooled.
 *   · STATIC — only comments, `set`/`shopt` and plain assignments may precede the drain. Measured
 *     2026-10-20 over all ten draining hooks: each is `set -uo pipefail`, optional assignments, then
 *     the drain. A rule the tree already satisfies costs nothing to adopt, and it names any new
 *     executable line that jumps the queue.
 *   · BEHAVIOURAL — 100 KB down a real pipe into the hook, with the hook's earliest exit staged,
 *     five trials, watching the WRITER for EPIPE. 100 KB cannot fit the 64 KB pipe buffer, so the
 *     writer is still writing when a non-draining hook exits. The defect is a race, and a payload
 *     that fits the buffer loses it only sometimes — which is how it once reached main as an
 *     intermittent red in a required job.
 * A static reading cannot see a drain that does not drain. A behavioural reading cannot see an exit
 * its staged payload never reached. Agreement is the verdict; a disagreement is a defect in one of
 * the two readings and is reported as a failure, never averaged away.
 *
 * THE PROBE TABLE IS DECLARED AND FAIL-CLOSED. Each hook names the environment that takes its
 * EARLIEST exit: the hatch for nine of them, an absent binary for `board-hook.sh`, an absent key for
 * `session-tailnet.sh`. A hook with no row is a FAIL that names it, so a new hook cannot arrive
 * unmeasured — and arriving unmeasured is the thing this gate exists to stop.
 *
 * THE THIRD READING IS THE ENUMERATION. `test:hooks` is a hand-written `&&` chain in `package.json`,
 * so a hook whose self-test is not named there is a hook nobody runs — the row's second half with a
 * different mechanism. Each hook must have a `<name>.test.sh` beside it, and that file must appear
 * in the chain.
 *
 * NOT CHECKED HERE. Whether a hook's verdict is correct, and whether its self-test asserts the right
 * things. That is the self-test's own job and `test:hooks` runs it. This gate checks only that a
 * hook reads what it was handed, and that somebody runs its test.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const HOOK_DIR = join(ROOT, '.claude', 'hooks');

/* ⚠ THE PAYLOAD SIZE IS A MEASUREMENT, AND 100 KB IS NOT ENOUGH. A pipe holds 16 pages — 65536 bytes,
   `F_GETPIPE_SZ` on this box — so 100 KB looked like plenty, and the nine writer-fate legs in the hook
   self-tests all use it. It is a coin flip. `cat` moves a file into a pipe with `copy_file_range`, and
   that path may push pages past the 16-slot limit up to `fs.pipe-max-size` (1048576 here), so the
   writer often finishes before a hook that never reads has exited. Measured 2026-10-20 against a
   planted `set -u; exit 0`, 12 trials a size, counting the writer's SIGPIPE:
     100 KB → 7 of 12 · 300 KB → 8 of 12 · 1000 KB → 7 of 12 · 4000 KB → 12 of 12
   The drained twin survived 6 of 6 at every size, so the sizes differ in SENSITIVITY, not in bias.
   So the payload is sized from the kernel's own ceiling rather than from a round number: anything
   past `pipe-max-size` cannot be absorbed, and a gate whose negative control is a coin flip measures
   nothing. */
export const PIPE_MAX_DEFAULT = 1048576;
export function probeBytes(readMax = pipeMaxSize) {
  const max = readMax();
  return Math.min(Math.max(4 * (Number.isFinite(max) && max > 0 ? max : PIPE_MAX_DEFAULT), 4 * 1024 * 1024), 64 * 1024 * 1024);
}
export function pipeMaxSize() {
  try {
    return Number.parseInt(readFileSync('/proc/sys/fs/pipe-max-size', 'utf-8').trim(), 10);
  } catch {
    return PIPE_MAX_DEFAULT; // not Linux, or procfs is not mounted — fall back to the documented default
  }
}
export const PROBE_TRIALS = 5;

/* ⚠ THE NINE SHELL LEGS STAGED 100 KB, AND A 100 KB PAYLOAD IS A COIN FLIP ON A BROKEN HOOK. Each
   hook self-test pipes a staged payload into its hook and asserts the writer survived, which reads
   the drain the gate above reads in Node. They all wrote `head -c 100000`, so against an unrepaired
   hook each leg stranded the writer only when the kernel happened not to absorb the payload — 7 of
   12 trials, measured 2026-10-20 — and 35 of 36 when the same rig ran that afternoon under load
   average 20, one batch reading 11 of 12. So the RATE is the box's scheduling at that moment and no
   sample bounds it; the derived size needs no rate, because nothing past `fs.pipe-max-size` can be
   absorbed at all. The error direction is what makes it worth fixing: the legs pass today because
   every hook drains, so a coin-flip leg is SILENT rather than flaky, and it would announce a
   reintroduced defect only sometimes. The legs now read `--probe-bytes`, so one formula
   serves Node and shell alike, and `scanWriterFateLeg` keeps a literal from coming back. */
/* A writer-fate leg is the one that reads `PIPESTATUS[0]` — the WRITER's own code rather than the
   pipeline's, which is the only way to see whether the hook drained. The two retired sizes are the
   regression this names: 100 KB in the nine `stdin-big` legs and 70 KB in `trim-output.test.sh`,
   both measured as coin flips against an unrepaired hook. A size that cannot track the box's own
   `fs.pipe-max-size` cannot stay beyond absorption, and that is what the payload is for. */
const WF_LEG = /PIPESTATUS\[0\]/;
const WF_DERIVES = /--probe-bytes/;
const WF_RETIRED = /head\s+-c\s+(100000|70000)\b/g;

export function scanWriterFateLeg(text, name = '<text>') {
  const t = String(text || '');
  const retired = [...t.matchAll(WF_RETIRED)].map((m) => Number.parseInt(m[1], 10));
  return { name, hasLeg: WF_LEG.test(t), derives: WF_DERIVES.test(t), retired };
}

/* ── the declared probes ──────────────────────────────────────────────────────────────────────
   `env` stages each hook's EARLIEST exit. The child gets a CLEAN environment plus these, so a hatch
   exported in the session that runs this gate cannot move which exit the probe reaches. */
export const PROBES = {
  'board-hook.sh': { env: { AGENT_BOARD_BIN: '/nonexistent/agent-board' }, exit: 'the board binary is absent' },
  'guard-doc-search.sh': { env: { CLAUDE_ALLOW_NO_DOC_SEARCH: '1' }, exit: 'the hatch' },
  'guard-format.sh': { env: { CLAUDE_ALLOW_UNFORMATTED_FORMAT: '1' }, exit: 'the hatch' },
  'guard-memory-stale.sh': { env: { CLAUDE_ALLOW_STALE_MEMORY: '1' }, exit: 'the hatch' },
  'guard-ruff.sh': { env: { CLAUDE_ALLOW_UNFORMATTED_RUFF: '1' }, exit: 'the hatch' },
  'guard-shared-tree.sh': { env: { CLAUDE_ALLOW_BLANKET_GIT: '1' }, exit: 'the hatch' },
  'guard-stale-brief.sh': { env: { CLAUDE_ALLOW_STALE_BRIEF: '1' }, exit: 'the hatch' },
  'guard-syntax.sh': { env: { CLAUDE_ALLOW_SYNTAX_ERROR: '1' }, exit: 'the hatch' },
  'guard-trailer.sh': { env: { CLAUDE_ALLOW_NO_TRAILER: '1' }, exit: 'the hatch' },
  'session-tailnet.sh': { env: {}, exit: 'no TS_AUTHKEY — the exit every local session takes' },
  'trim-output.sh': { env: { CLAUDE_ALLOW_UNTRIMMED: '1' }, exit: 'the hatch' }
};

/* ── pure core ────────────────────────────────────────────────────────────────────────────────
   Takes hook TEXT, never a path, so the selftest can plant a hook that does not exist on disk. */

/* A line that may precede the drain: blank, comment, `set`/`shopt`, or a plain NAME=value assignment
   (no command substitution — `x="$(cat)"` IS the drain, and `x="$(git …)"` is a command that ran). */
const PRE_DRAIN_OK = /^\s*$|^\s*#|^\s*(set|shopt)\s|^\s*[A-Za-z_][A-Za-z0-9_]*=(?!.*\$\()[^\n]*$/;

/* The drain, in the three forms the tree uses: a forked `cat`, the `read` builtin with a NUL
   delimiter, or `mapfile`. A bare `read line` is NOT a drain — it stops at the first newline. */
const DRAIN = /\$\(\s*cat\b|\bread\b[^#]*-d\s*''|\bmapfile\b/;

export function scanHook(text, name = '<text>') {
  const lines = String(text || '').split('\n');
  let drain = null;
  const before = [];
  for (let i = 0; i < lines.length; i++) {
    if (DRAIN.test(lines[i])) {
      drain = i + 1;
      break;
    }
    if (!PRE_DRAIN_OK.test(lines[i])) before.push({ line: i + 1, text: lines[i].trim() });
  }
  return { name, drain, before };
}

/* `test:hooks` is one `&&` chain; the parse asks only whether a path appears in it, which is the
   question — a chain that names a file runs it, and the ORDER is the chain's own business. */
export function enumeratedTests(pkgText) {
  let chain = '';
  try {
    chain = JSON.parse(pkgText)?.scripts?.['test:hooks'] || '';
  } catch {
    return null; // an unreadable package.json fails closed in `evaluate`
  }
  return chain;
}

export function evaluate(findings, producedBy) {
  const eligible = findings.length;
  const undeclared = findings.filter((f) => !f.declared);
  const bad = findings.filter((f) => f.problems.length);
  const status = eligible === 0 ? 'NOT_RUN' : bad.length ? 'FAIL' : 'PASS';
  const reason =
    status === 'NOT_RUN'
      ? `no hook was examined — \`${HOOK_DIR}\` holds no \`*.sh\` outside \`*.test.sh\`, so this gate decided nothing`
      : status === 'FAIL'
        ? `${bad.length} hook(s) break the contract: ${bad.map((f) => `${f.name} (${f.problems.join('; ')})`).join(' · ')}`
        : null;
  const v = Verdict.make({
    gate: 'hook-stdin-contract',
    status,
    scope: 'internal',
    population: { checked: eligible - undeclared.length, eligible, excluded: undeclared.length },
    criterion: { name: 'hooks_breaking_the_stdin_contract', threshold: 0, unit: 'hooks', direction: 'lte' },
    result: {
      failing: bad.length,
      hooks: eligible,
      probeBytes: probeBytes(),
      probeTrials: PROBE_TRIALS,
      writerEpipe: findings.filter((f) => f.epipe > 0).length
    },
    evidence: ['tools/hook-contract.mjs', ...findings.map((f) => `.claude/hooks/${f.name}`)],
    reason,
    producedBy
  });
  return { status, bad, undeclared, verdict: v };
}

/* ── side-effecting shell ─────────────────────────────────────────────────────────────────── */

/* One trial: push the whole payload into the hook and report the WRITER's fate. This process is the
   writer's grandparent: `bash` runs the pipeline and hands back `PIPESTATUS[0]`, which is the
   writer's own code and not the pipeline's — the distinction CLAUDE.md §4b exists for. */
/* ── the probe ────────────────────────────────────────────────────────────────────────────────
   ⚠ THE PROBE MUST USE A REAL PIPE, AND NODE CANNOT LEND ONE. A child's `stdio: 'pipe'` is a unix
   SOCKET pair under libuv, not a pipe: its send buffer is `net.core.wmem_default`, measured 212992
   bytes on this box, so a 100 KB payload FITS IT and the writer can finish before a non-draining
   hook exits. Measured 2026-10-20 against a planted `set -u; exit 0`, five trials a size: 100 KB
   stranded the writer 4 times, 400 KB and 1 MB 5 times each. A gate whose negative control is a coin
   flip is not a gate, and raising the payload would measure a socket nobody ships.
   So the probe spawns the same rig the hook self-tests use — `cat file | bash hook`, a 64 KB kernel
   pipe, the writer's own code read back out of `PIPESTATUS[0]`. 141 is SIGPIPE: the writer died
   because the hook had already gone. */
const PROBE_RIG = 'cat "$1" | bash "$2" >/dev/null 2>&1; printf %s "${PIPESTATUS[0]}"';

export function probeWriterOnce(hookPath, env, payloadPath, { timeoutMs = 10000 } = {}) {
  try {
    const out = execFileSync('bash', ['-c', PROBE_RIG, 'bash', payloadPath, hookPath], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/tmp', ...env }
    });
    const rc = Number.parseInt(out.trim(), 10);
    return Number.isInteger(rc) ? rc : 'UNREADABLE';
  } catch (e) {
    /* The rig itself failed (a timeout, no bash). That is not a surviving writer. */
    return `RIG:${e.code || e.message}`;
  }
}

/* The payload is written ONCE for the whole run and read by every trial: the measurement is the
   writer's fate, never the cost of building a few megabytes. */
export function writePayload(bytes = probeBytes()) {
  const file = join(mkdtempSync(join(tmpdir(), 'hook-contract-')), 'payload.json');
  const pad = 'x'.repeat(Math.max(0, bytes - 64));
  writeFileSync(file, `${JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'true' }, pad })}\n`);
  return file;
}

export function probeWriter(hookPath, env, payloadFile = writePayload(), trials = PROBE_TRIALS) {
  const file = payloadFile;
  let epipe = 0;
  const codes = new Set();
  for (let i = 0; i < trials; i++) {
    const rc = probeWriterOnce(hookPath, env, file);
    codes.add(rc);
    if (rc !== 0) epipe++;
  }
  return { epipe, trials, codes: [...codes] };
}

function hookFiles() {
  if (!existsSync(HOOK_DIR)) return [];
  return readdirSync(HOOK_DIR)
    .filter((f) => f.endsWith('.sh') && !f.endsWith('.test.sh'))
    .sort();
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim().slice(0, 12);
  } catch {
    return null;
  }
}

function producedBy() {
  const commit = headSha();
  const p = { tool: 'tools/hook-contract.mjs', commit };
  if (!commit) p.commitReason = 'git rev-parse failed — not a repository checkout, or git is unavailable';
  return p;
}

/* The three readings, collected per hook. Impure (it runs each hook); the judging is `evaluate`. */
export function collect(files = hookFiles()) {
  const payload = files.length ? writePayload() : null;
  let chain = null;
  const pkg = join(ROOT, 'package.json');
  if (existsSync(pkg)) chain = enumeratedTests(readFileSync(pkg, 'utf-8'));
  const out = [];
  for (const name of files) {
    const path = join(HOOK_DIR, name);
    const scan = scanHook(readFileSync(path, 'utf-8'), name);
    const declared = Object.hasOwn(PROBES, name);
    const problems = [];
    if (scan.drain == null) problems.push('STATIC: no stdin drain at all');
    else if (scan.before.length) problems.push(`STATIC: ${scan.before.length} executable line(s) precede the drain — ${scan.before.map((b) => `${name}:${b.line} \`${b.text}\``).join(', ')}`);
    let epipe = 0;
    if (!declared) problems.push('UNDECLARED: no row in PROBES, so its earliest exit was never staged');
    else {
      const r = probeWriter(path, PROBES[name].env, payload);
      epipe = r.epipe;
      if (epipe > 0)
        problems.push(
          `BEHAVIOURAL: the writer exited ${r.codes.filter((c) => c !== 0).join('/')} on ${epipe} of ${r.trials} trial(s) at ${probeBytes()} bytes with ${PROBES[name].exit} staged (141 = SIGPIPE)`
        );
      /* The two readings must agree. A drain the static pass can see and the writer cannot feel is
         not a drain, and a hook the writer survives with an executable line ahead of its drain is a
         rule this gate has mis-stated. Either way the tree and the gate disagree, which is a
         finding — the one shape a two-reading gate exists to surface. */
      if (epipe === 0 && scan.drain == null) problems.push('DISAGREEMENT: the writer survived a hook with no drain this pass can find');
    }
    if (chain != null && !chain.includes(`.claude/hooks/${name.replace(/\.sh$/, '.test.sh')}`))
      problems.push(`ENUMERATION: \`test:hooks\` does not name ${name.replace(/\.sh$/, '.test.sh')}, so nobody runs it`);
    if (chain == null) problems.push('ENUMERATION: package.json was unreadable, so the chain could not be read');
    out.push({ name, declared, drain: scan.drain, before: scan.before, epipe, problems });
  }
  return out;
}

function run() {
  const files = hookFiles();
  const findings = collect(files);
  const { status, bad, undeclared, verdict } = evaluate(findings, producedBy());
  const chk = Verdict.validate(verdict);
  if (!chk.ok) throw new Error(`hook-contract produced an invalid verdict: ${chk.errors.join('; ')}`);
  process.stdout.write(`${JSON.stringify(verdict, null, 1)}\n`);
  if (status === 'NOT_RUN') {
    console.error(`✗ hook-contract examined NOTHING — no \`*.sh\` under ${HOOK_DIR}. That is a defect in this gate's reach, not a pass`);
    return 2;
  }
  if (status === 'PASS') {
    console.log(`✓ ${files.length} hook(s) drain stdin before any exit — static + ${PROBE_TRIALS} writer trials at ${probeBytes()} bytes each, and \`test:hooks\` names every self-test`);
    return 0;
  }
  console.error(`✗ ${bad.length} of ${files.length} hook(s) break the stdin contract:`);
  for (const f of bad) for (const p of f.problems) console.error(`   · ${f.name} — ${p}`);
  if (undeclared.length) console.error('  An UNDECLARED hook needs a PROBES row naming the environment that takes its earliest exit.');
  console.error('  The fix is one line: drain stdin before every exit, with a builtin on a hot path');
  console.error("  (`IFS= read -r -d '' payload || true`) or a forked `cat` elsewhere. See #3493 and #3759.");
  return 1;
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (what, cond, detail) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error(`  ✕ ${what}${detail ? ` — ${detail}` : ''}`);
    }
  };
  const PB = { tool: 'tools/hook-contract.mjs', commit: 'deadbeefcafe' };
  const F = (over = {}) => ({ name: 'x.sh', declared: true, drain: 2, before: [], epipe: 0, problems: [], ...over });

  // PLANT 1 · the static reading.
  const good = '#!/usr/bin/env bash\nset -uo pipefail\nTRIM=1\npayload="$(cat 2>/dev/null)" || exit 0\n[ "${H:-}" = 1 ] && exit 0\n';
  ok('a drain after only `set` and an assignment scans clean', scanHook(good).before.length === 0 && scanHook(good).drain === 4, JSON.stringify(scanHook(good)));
  const late = 'set -uo pipefail\n[ "${H:-}" = 1 ] && exit 0\npayload="$(cat)" || exit 0\n';
  ok('a hatch ahead of the drain is named with its line', scanHook(late, 'h.sh').before.length === 1 && scanHook(late, 'h.sh').before[0].line === 2, JSON.stringify(scanHook(late, 'h.sh').before));
  ok('a hook with no drain at all reports drain=null', scanHook('set -u\nexit 0\n').drain === null);
  const builtin = 'set -u\nIFS= read -r -d \'\' payload || true\n[ -z "$payload" ] && exit 0\n';
  ok('the `read` builtin counts as a drain', scanHook(builtin).drain === 2 && scanHook(builtin).before.length === 0, JSON.stringify(scanHook(builtin)));
  ok('a bare `read line` is NOT a drain', scanHook('set -u\nread line\nexit 0\n').drain === null);
  const subst = 'set -u\nroot="$(git rev-parse --show-toplevel)"\npayload="$(cat)"\n';
  ok('an assignment that RUNS something is not pre-drain furniture', scanHook(subst).before.length === 1, JSON.stringify(scanHook(subst).before));

  // PLANT 2 · the verdict words.
  ok(
    'a clean population is PASS with a null reason',
    (() => {
      const r = evaluate([F()], PB);
      return r.status === 'PASS' && r.verdict.reason === null;
    })()
  );
  const r3 = evaluate([F({ problems: ['STATIC: no stdin drain at all'] })], PB);
  ok('one broken hook is FAIL', r3.status === 'FAIL', r3.status);
  ok('…and the reason names the hook and the problem', /x\.sh \(STATIC/.test(r3.verdict.reason || ''), r3.verdict.reason);
  const r4 = evaluate([], PB);
  ok('an empty population is NOT_RUN, never PASS', r4.status === 'NOT_RUN' && r4.verdict.population.eligible === 0, r4.status);
  ok('…and NOT_RUN carries a reason', !!r4.verdict.reason);
  const r5 = evaluate([F({ declared: false, problems: ['UNDECLARED: no row in PROBES, so its earliest exit was never staged'] })], PB);
  ok(
    'an undeclared hook FAILS and is counted excluded, not checked',
    r5.status === 'FAIL' && r5.verdict.population.checked === 0 && r5.verdict.population.excluded === 1,
    JSON.stringify(r5.verdict.population)
  );
  ok(
    'checked + excluded = eligible on a mixed population',
    (() => {
      const p = evaluate([F(), F({ name: 'y.sh', declared: false, problems: ['UNDECLARED: x'] })], PB).verdict.population;
      return p.checked + p.excluded === p.eligible && p.checked === 1;
    })()
  );

  // PLANT 3 · the sizing, which is where a sensitive probe is won or lost.
  ok('the payload clears the kernel ceiling that absorbs it', probeBytes() > pipeMaxSize(), `${probeBytes()} vs ${pipeMaxSize()}`);
  ok('…and a tiny declared ceiling still buys the 4 MB floor', probeBytes(() => 1024) === 4 * 1024 * 1024, String(probeBytes(() => 1024)));
  ok(
    '…and an unreadable ceiling falls back to the documented default, never to 0',
    probeBytes(() => Number.NaN) === Math.max(4 * PIPE_MAX_DEFAULT, 4 * 1024 * 1024),
    String(probeBytes(() => Number.NaN))
  );
  ok('…and a huge ceiling is capped rather than believed', probeBytes(() => 1024 * 1024 * 1024) === 64 * 1024 * 1024, String(probeBytes(() => 1024 * 1024 * 1024)));
  ok('the real kernel ceiling reads as a positive integer', Number.isInteger(pipeMaxSize()) && pipeMaxSize() > 0, String(pipeMaxSize()));

  // PLANT 4 · the enumeration reading.
  ok(
    'a chain that names the test is read as naming it',
    (enumeratedTests('{"scripts":{"test:hooks":"bash .claude/hooks/a.test.sh && bash .claude/hooks/b.test.sh"}}') || '').includes('.claude/hooks/b.test.sh')
  );
  ok('an unreadable package.json fails closed (null, not an empty chain)', enumeratedTests('{ not json') === null);
  ok('an absent `test:hooks` reads as an empty chain, which names nothing', enumeratedTests('{"scripts":{}}') === '');

  /* PLANT 5 · THE NEGATIVE CONTROL FOR THE BEHAVIOURAL READING, and the one assertion that cannot be
     faked by any amount of static parsing: a planted hook that exits without draining must make the
     writer take EPIPE, and its drained twin must not. If this pair ever reads the same, the probe
     measures nothing and every PASS above it is vacuous. */
  const dir = mkdtempSync(join(tmpdir(), 'hookcontract-'));
  const nodrain = join(dir, 'nodrain.sh');
  writeFileSync(nodrain, 'set -u\nexit 0\n');
  const drained = join(dir, 'drained.sh');
  writeFileSync(drained, 'set -u\npayload="$(cat 2>/dev/null)" || exit 0\nexit 0\n');
  const pr1 = probeWriter(nodrain, {});
  const pr2 = probeWriter(drained, {});
  ok(
    `a hook that exits without draining strands the writer (${probeBytes()} bytes, ${PROBE_TRIALS} trials)`,
    pr1.epipe === PROBE_TRIALS,
    `stranded on ${pr1.epipe} of ${pr1.trials}, codes ${JSON.stringify(pr1.codes)}`
  );
  ok(
    '…and the writer died of SIGPIPE, not of something else',
    pr1.codes.every((c) => c === 141),
    JSON.stringify(pr1.codes)
  );
  ok('…and its drained twin never does', pr2.epipe === 0, `stranded on ${pr2.epipe} of ${pr2.trials}, codes ${JSON.stringify(pr2.codes)}`);
  ok('…so the two readings agree on the plants', scanHook(readFileSync(nodrain, 'utf-8')).drain === null && scanHook(readFileSync(drained, 'utf-8')).drain === 2);

  /* PLANT 6 · THE NINE SHELL LEGS, read statically. The planted pair differs in ONE property, so a
     scanner that answered the same for both would score as loudly here as it does on the tree. */
  const legDerived = 'x="$(node t/hook-contract.mjs --probe-bytes)"\nhead -c "$x" /dev/zero > "$TMP/p"\nrc="${PIPESTATUS[0]}"\n';
  const legRetired = 'head -c 100000 /dev/zero > "$TMP/p"\nrc="${PIPESTATUS[0]}"\n';
  ok(
    'a leg that reads --probe-bytes scans as derived',
    (() => {
      const r = scanWriterFateLeg(legDerived);
      return r.hasLeg && r.derives && r.retired.length === 0;
    })(),
    JSON.stringify(scanWriterFateLeg(legDerived))
  );
  ok(
    'a leg on a retired size is named with that size',
    (() => {
      const r = scanWriterFateLeg(legRetired);
      return r.hasLeg && !r.derives && r.retired[0] === 100000;
    })(),
    JSON.stringify(scanWriterFateLeg(legRetired))
  );
  ok("a file that never reads the WRITER's code carries no leg", scanWriterFateLeg('set -u\nhead -c 100000 /dev/zero > b\n').hasLeg === false);
  ok('…and a payload size that is neither retired size is left alone', scanWriterFateLeg('rc="${PIPESTATUS[0]}"\nhead -c 120000 /dev/zero > b\n').retired.length === 0);

  /* And the tree itself: every self-test that stages a payload must derive its size. This is the
     population half — the two plants above would pass while no real leg was ever read. */
  const legScans = existsSync(HOOK_DIR)
    ? readdirSync(HOOK_DIR)
        .filter((f) => f.endsWith('.test.sh'))
        .map((f) => scanWriterFateLeg(readFileSync(join(HOOK_DIR, f), 'utf-8'), f))
    : [];
  const legFiles = legScans.filter((r) => r.hasLeg);
  ok('the writer-fate legs are found in the real tree (non-vacuous)', legFiles.length >= 11, `found ${legFiles.length} leg(s)`);
  /* THE POPULATION IS CLOSED, so a count is no longer the assertion. `board-hook.test.sh` was the
     one self-test with no leg, and its hook drains before an absent binary, the hatch and
     `stop_hook_active` alike — a drain moving below any of the three would have cost the harness a
     SIGPIPE with no red leg anywhere (row 2026-10-20-board-hook-self-test-has-no-writer-fate-leg).
     A NEW self-test with no leg now names itself here rather than hiding under a floor. */
  ok('…and every hook self-test carries one', legScans.length > 0 && legScans.every((r) => r.hasLeg), JSON.stringify(legScans.filter((r) => !r.hasLeg).map((r) => r.name)));
  ok(
    '…and every one of them derives its payload size',
    legFiles.every((r) => r.derives),
    JSON.stringify(legFiles.filter((r) => !r.derives).map((r) => r.name))
  );
  ok(
    '…and none of them stages a retired size',
    legFiles.every((r) => r.retired.length === 0),
    JSON.stringify(legFiles.filter((r) => r.retired.length).map((r) => `${r.name}:${r.retired.join(',')}`))
  );

  /* THE REAL TREE IS THE POPULATION CHECK. Every assertion above would pass while this gate examined
     no real hook — the §4b shape: success reported about something never examined. */
  const files = hookFiles();
  ok('the gate finds the REAL hook tree (non-vacuous)', files.length >= 10, `found ${files.length} hook(s)`);
  ok(
    '…and every real hook has a PROBES row',
    files.every((f) => Object.hasOwn(PROBES, f)),
    JSON.stringify(files.filter((f) => !Object.hasOwn(PROBES, f)))
  );
  ok(
    '…and every PROBES row names a hook that exists',
    Object.keys(PROBES).every((k) => files.includes(k)),
    JSON.stringify(Object.keys(PROBES).filter((k) => !files.includes(k)))
  );

  console.log(fail ? `✗ ${fail} of ${pass + fail} assertions FAILED` : `✓ all ${pass} assertions passed`);
  return fail ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  if (process.argv.includes('--probe-bytes')) {
    /* The one number the nine shell legs cannot derive for themselves without repeating the formula
       nine times. It prints bytes and nothing else, so a caller can read it with `$(...)`. */
    process.stdout.write(`${probeBytes()}\n`);
    process.exit(0);
  }
  if (process.argv.includes('--verdict-sample')) {
    process.stdout.write(`${JSON.stringify(evaluate(collect(), producedBy()).verdict, null, 1)}\n`);
    process.exit(0);
  }
  process.exit(run());
}
