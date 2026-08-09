#!/usr/bin/env node
/*
 * tools/mutate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * MUTATION HARNESS — break the code on purpose and find out which gates do not notice.
 *
 * This repo's central anxiety is the hollow gate: an assertion that passes, is quoted as evidence,
 * and could never have failed. `TEST-AUDIT-FINDINGS` found **42** of them — by applying 40 mutations
 * BY HAND, one at a time, and re-running the suite for each. That was a heroic one-off and it is not
 * repeatable, which is why the Python side was never audited at all and why nothing has re-checked
 * the JS side since.
 *
 * A SURVIVING MUTANT IS THE FINDING. If a line can be changed and the whole suite stays green, then
 * nothing tests that line — whatever the coverage number says. Coverage asks "was this executed?";
 * mutation asks "would anyone notice if it were wrong?", which is the question this repo actually
 * cares about.
 *
 * WHY IT IS FAST ENOUGH TO USE. Running the full suite per mutant (~2-4 min × hundreds) is a
 * non-starter. But every group in `tests/dex-tests.js` carries a TAG naming its module
 * (`ppgdex-dsp`, `integrator-dsp`, …), and `run-tests.mjs --group=` filters on title OR tag. So a
 * mutant of `ppgdex-dsp.js` only runs the groups tagged `ppgdex-dsp` — seconds, not minutes.
 * `--full` runs the whole suite per mutant when you want certainty over speed.
 *
 * THE TAG SELECTION IS ITSELF A RESULT. If a file has NO matching groups, every mutant survives
 * trivially — and that is worth knowing loudly rather than reporting as "0 killed". The tool says
 * `NO GROUPS` for that file instead of pretending it measured something.
 *
 * WHAT A SURVIVOR IS NOT: proof of a bug. It is proof that the SUITE cannot see a change there.
 * Some survivors are legitimately untestable (a log string, a defensive branch that cannot be
 * reached). Triage is the reader's; this tool only refuses to let them stay invisible.
 *
 * AN AUDIT TOOL, NOT A GATE — deliberately. A survivor needs TRIAGE: some are legitimately
 * untestable (an unreachable defensive branch, a log string, a float boundary that cannot be hit),
 * and a gate that reds on those is a gate someone turns off. That is the same objection
 * `DOCS-LEDGER-CHECK3B-BLIND-ROW` §4a used to refuse a cry-wolf checker, and it applies here with
 * more force because mutation survivors are noisier than status strings. Run it when you touch a
 * module, when a brief claims something is "gated", and periodically over the DSPs.
 *   The ONE bounded form that would belong in CI is DIFF-SCOPED: mutate only the lines a PR
 * changed and require them killed — a handful of mutants, seconds, and it enforces exactly "if you
 * touched it, some test can see it" without ever judging pre-existing code. Not built here; it is
 * the obvious follow-up and the reason it is not the default is that it needs the PR's diff, not
 * the file.
 *
 * SCOPE: JavaScript only. `capture-host/` is Python under pytest and is NOT covered — a different
 * runner and a different mutation grammar. `TEST-AUDIT-FINDINGS` §34 already recorded that the
 * Python side has never been mutation-audited and pointed at `mutmut`/`cosmic-ray`; that remains
 * true and is not fixed by this tool.
 *
 * USAGE
 *   node tools/mutate.mjs --changed                 # files changed vs origin/main (default)
 *   node tools/mutate.mjs --file ppgdex-dsp.js      # one file (repeatable)
 *   node tools/mutate.mjs --file X --limit 40       # cap mutants per file (default 60)
 *   node tools/mutate.mjs --file X --jobs 12        # parallel workers (default: ~⅔ of cores; 1 at ≤2 cores)
 *   node tools/mutate.mjs --budget 120              # skip a file whose estimate exceeds 120 s/file
 *   node tools/mutate.mjs --file X --full           # run the WHOLE suite per mutant
 *   node tools/mutate.mjs --json                    # NDJSON, one line per file, streamed
 *   node tools/mutate.mjs --file X --dry-run       # list the mutants; run nothing, write nothing
 *   node tools/mutate.mjs --selftest                # known-answer, no repo mutation
 *   node tools/mutate.mjs --diff                    # GATE: only the lines changed vs origin/main
 *   node tools/mutate.mjs --diff <ref> --dry-run    # what the gate would test, running nothing
 *   node tools/mutate.mjs --file X --bail           # stop each suite run at its first failure
 *
 * --diff IS A GATE AND EXITS NON-ZERO: 1 if a mutant on a changed line survived (you changed it and
 * no test can see it), 3 if the run could not prove anything (canary survived, or a mutant never
 * ran). Survey mode always exits 0, because a survivor in code nobody touched is information, not a
 * verdict. Bail is ON by default under --diff and OFF for surveys, whose `killers` breakdown is the
 * point; `--no-bail` / `--bail` override.
 *
 * KNOWN SHARP EDGE: the gate does not yet know which mutants are EQUIVALENT. Touch a line carrying
 * one — `if (rv < rMin) rMin = rv;` mutated to `<=` cannot change a minimum on a tie — and it will
 * be reported as a survivor you must justify, because no test can kill it and none ever could. The
 * classification exists (MUTATION-EQUIVALENCE-2026-08-04-BRIEF §3) but is prose, not data. Feeding it
 * in as an allowlist is the obvious follow-up; until then, expect to argue with the gate occasionally
 * and prefer that over a gate that silently excuses whatever it cannot kill.
 *
 * SAFETY — and this was got WRONG first, so it is spelled out. With `--jobs > 1` (the default) the
 * caller's tree is NEVER written to: each worker mutates its own `git worktree`. On the `--jobs 1`
 * path the file is edited in place, and signal handlers are NOT a guarantee — the serial run blocks
 * in `execFileSync`, so the event loop cannot service a handler while a suite is running, and
 * SIGKILL is uncatchable anyway. Verified rather than assumed: a `pkill` mid-run left `clock.js`
 * mutated in the working tree with all four handlers registered. The guarantee is therefore an
 * on-disk `<file>.mutate-backup` that exists for the whole window, plus `recoverStale()` at startup
 * which restores any leftover before doing anything else and says so.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const DIFF = has('--diff');
/* `--diff` alone means origin/main; `--diff <ref>` overrides it. The next argv slot is only a base if
   it isn't another flag, so `--diff --json` doesn't silently become base "--json" and then diff
   against nothing — which would produce an EMPTY touched-line set and a green gate that tested zero
   mutants. A gate that passes by measuring nothing is the failure mode this whole tool exists for. */
const DIFF_BASE = (() => {
  const i = argv.indexOf('--diff');
  const nxt = i >= 0 ? argv[i + 1] : null;
  return nxt && !nxt.startsWith('--') ? nxt : 'origin/main';
})();
/* Diff mode must test EVERY mutant on a touched line. The default cap of 60 exists to keep a
   whole-file survey affordable; applied to a gate it would silently drop mutants and still report
   "all killed". A diff rarely reaches 60 anyway — but "rarely" is not a guarantee. */
/* Default ON in diff mode (a gate only asks "did anything go red?"), off for whole-file surveys
   (whose `killers` breakdown is the point). `--no-bail` forces it off, `--bail` forces it on. */
const BAIL = has('--bail') || (DIFF && !has('--no-bail'));
const LIMIT = +opt('--limit', DIFF ? Infinity : 60);
const FULL = has('--full');
/* Per-file wall-clock ceiling in seconds. A sweep across 71 modules is dominated by a handful of
   pathologically expensive tags, and skipping them LOUDLY beats discovering them at minute forty. */
const BUDGET = +opt('--budget', '0');
/* List what WOULD be mutated and exit — no suite runs, no worktrees, no writes. Added while proving
   the regex-aware mask fix: verifying "no mutant lands in a comment" should not cost 40 minutes of
   test execution. It is also the honest way to inspect a module's mutation surface before committing
   to a run. */
const DRY = has('--dry-run');
const AS_JSON = has('--json');
/* Mutants are independent, so this is embarrassingly parallel — but every mutant rewrites the SAME
   file, so they cannot share a tree. Each worker gets its own `git worktree` (shares the object store)
   and mutates its own copy: the isolation CLAUDE.md §👥 already prescribes, applied to the harness
   itself. `--jobs 1` keeps the in-place serial path, for debugging the tool.

   THE DEFAULT IS MEASURED, NOT REASONED. It was `min(8, cores-2)`, and a contention argument talked me
   into going LOWER still. Both were wrong. On a 24-core box, `pulsedex-dsp.js` × 12 mutants:

       jobs  4 → 23 s     jobs  8 → 17 s     jobs 16 → 14 s     jobs 24 → 20 s     jobs 32 → 19 s

   Monotonically faster to ~⅔ of the cores, then it degrades — each worker is a full `node` running a
   real suite, so past that they fight for cores and page cache. One suite run for that module is
   6.58 s, so 16 jobs buys ~5.6× over serial. `cores × 2/3` reproduces the measured optimum here and
   degrades sanely on smaller machines; re-measure before trusting it on very different hardware.

   LOW-CORE MACHINES GET THE SERIAL PATH, deliberately. At 1–2 cores parallelism buys nothing (the
   workers just fight for the same core) and costs real resources: each worktree is a FULL checkout —
   71 MB here — so a 2-worker split on a 2-core laptop spends 142 MB of disk and a chunk of page cache
   to run no faster. `--jobs 1` also skips worktrees entirely and mutates in place, which is the right
   trade when there is nothing to parallelise over. An explicit `--jobs N` always wins, so a small box
   can still opt in. */
export function defaultJobs(cores) {
  if (!(cores > 0)) return 1; // cpus() can report an empty list in constrained containers
  if (cores <= 2) return 1; // serial: no worktrees, no extra disk, no oversubscription
  return Math.max(2, Math.round((cores * 2) / 3));
}
const JOBS = Math.max(1, +opt('--jobs', String(defaultJobs(cpus().length))));

/* ── the operators ───────────────────────────────────────────────────────────────────────────
   Deliberately small and high-signal. Each is a change that a competent test SHOULD catch, and
   each is a real defect shape this repo has actually shipped: an off-by-one in a threshold
   comparison, an && that should have been ||, a boundary constant, an inverted guard. Exotic
   operators (statement deletion, method swaps) produce mostly-invalid mutants and drown the signal. */
const OPS = [
  { name: 'cmp >= → >', re: />=/g, to: '>' },
  { name: 'cmp <= → <', re: /<=/g, to: '<' },
  /* The trailing lookahead excludes the SHIFT operators. Without `(?![=>])`, `win >> 1` matched at the
     first `>` and became `win >=> 1` — unparseable. Four such mutants were generated on `clock.js`
     alone, and because a non-zero exit used to mean KILLED, all four were counted as coverage while
     costing a full suite run each (~30 min of a 108-min sweep). The leading class already protects
     `=>` and the second `>` of a pair; this protects the first. */
  { name: 'cmp > → >=', re: /([^-=<>!])>(?![=>])/g, to: '$1>=' },
  { name: 'cmp < → <=', re: /([^-=<>!])<(?![=<])/g, to: '$1<=' },
  { name: 'eq === → !==', re: /===/g, to: '!==' },
  { name: 'eq !== → ===', re: /!==/g, to: '===' },
  { name: 'bool && → ||', re: /&&/g, to: '||' },
  { name: 'bool || → &&', re: /\|\|/g, to: '&&' },
  { name: 'negate: drop !', re: /([(\s])!(?![=!])/g, to: '$1' },
  { name: 'num → 0', re: /\b(\d+\.\d+|\d{2,})\b/g, to: '0' }
];

/* Skip lines that cannot carry behaviour: imports and license headers. */
const SKIP_LINE = /^\s*(import\s|export\s+\{)/;

import { codeMask } from './js-lex.mjs'; // the ONE regex-aware lexer — see that file

function mutantsFor(src) {
  const lines = src.split('\n');
  const mask = codeMask(src);
  const lineStart = [];
  let acc = 0;
  for (const L of lines) {
    lineStart.push(acc);
    acc += L.length + 1;
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim() || SKIP_LINE.test(L)) continue;
    if (L.includes('eslint') || L.includes('biome-ignore')) continue;
    const base = lineStart[i];
    const isCode = (off, len) => {
      for (let k = 0; k < len; k++) if (!mask[base + off + k]) return false;
      return true;
    };
    for (const op of OPS) {
      const re = new RegExp(op.re.source, op.re.flags);
      let m;
      while ((m = re.exec(L)) !== null) {
        if (!isCode(m.index, m[0].length)) continue; // inside a comment or a string literal
        const mutatedLine = L.slice(0, m.index) + m[0].replace(new RegExp(op.re.source), op.to) + L.slice(m.index + m[0].length);
        if (mutatedLine === L) continue;
        out.push({
          line: i + 1,
          op: op.name,
          before: L.trim().slice(0, 100),
          after: mutatedLine.trim().slice(0, 100),
          apply: () =>
            lines
              .slice(0, i)
              .concat(mutatedLine, lines.slice(i + 1))
              .join('\n')
        });
        if (op.re.flags.indexOf('g') < 0) break;
      }
    }
  }
  return out;
}

/* Deterministic thinning — a seeded stride, never Math.random, so two runs of the same command
   examine the same mutants and a reported survivor can be reproduced. */
function thin(list, limit) {
  if (list.length <= limit) return list;
  const step = list.length / limit;
  const out = [];
  for (let i = 0; i < limit; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

function groupsForFile(file) {
  const stem = basename(file).replace(/\.(js|mjs)$/, '');
  let listed;
  try {
    listed = JSON.parse(execSync('node tests/run-tests.mjs --list --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
  /* TAG hits — groups that name this module explicitly. This is what "is the file measurable at all"
     depends on: no tagged group means every mutant survives trivially, which the caller reports as
     NO GROUPS rather than 0 killed. */
  const hit = (listed.groups || []).filter((g) => (g.tag || '').split('·').some((t) => t.trim() === stem));
  /* …but the number that matters for COST is what `--group=<stem>` actually RUNS, and that is not the
     same set. `dexGroupMatcher` is a case-insensitive REGEX over title OR tag, so `--group=clock` also
     selects every group with "clock" anywhere in its TITLE — "ECGDex worker clock", "a real arousal
     near a clock hour". Measured on clock.js: 20 tag hits, 44 groups actually run. Reporting only the
     20 understated the tool's own workload by more than 2× and is why CLOCK-MUTATION-COST's cost model
     did not reconcile. Both are reported now; `count` stays the tag figure so existing readers are
     unchanged, and `selected` is the honest cost driver. */
  let selected = null;
  try {
    const rx = new RegExp(stem, 'i');
    selected = (listed.groups || []).filter((g) => rx.test(g.title || '') || rx.test(g.tag || '')).length;
  } catch {}
  return { stem, count: hit.length, selected };
}

/* Async twin of runSuite, for the worker pool. Same classification, non-blocking.

   WHY IT CAPTURES stdout NOW (CLOCK-MUTATION-COST §Done-when 1). This ran with `stdio: 'ignore'`, so a
   mutant's entire result was an exit code: the harness knew a mutant died but not WHICH group killed
   it. That is precisely the measurement needed to narrow an expensive tag — the union of killing groups
   over every mutant IS the minimal sufficient selection — and the brief assumed the tool already had
   it. It did not.

   Cost is a pipe instead of `ignore` plus one regex over the output; the suite prints a few KB. A
   SURVIVING mutant exits 0 and is not scanned at all, so the common case pays nothing. */
const KILLER_RE = /✕ \[([^\]]+)\]/g;
/* THE ONE PLACE that decides whether a non-zero suite exit is a kill. Pure, so --selftest can pin it:
   the bug it replaces (every non-zero exit == KILLED) was invisible precisely because nothing could
   assert on it. A mutant caught by a test leaves assertion output; one that never parsed leaves none. */
/* Returns the warning text when a run's INVALID count is high enough to change how its rate should be
   read, else null. Pure and exported so --selftest pins the threshold: an alarm nobody has watched
   fire is not an alarm. One invalid is normal (a mutated regex quantifier cannot compile); a quarter
   of the population is a machine problem, and both print the same confident-looking rate. */
export function invalidWarning(invalid, tested, killed) {
  const pct = tested ? (invalid / tested) * 100 : 0;
  if (!(invalid > 2 && pct >= 5)) return null;
  return (
    '\n  ⚠ ' +
    invalid +
    ' of ' +
    tested +
    ' mutants (' +
    pct.toFixed(0) +
    '%) never RAN — they are excluded from the rate.\n' +
    '    A mutant is INVALID when its suite run produced no assertion output at all: it did not\n' +
    '    compile, or it was killed before it could report. A couple is normal; this many usually\n' +
    '    means the suite TIMED OUT under load — check whether another job was running.\n' +
    '    ' +
    killed +
    '/' +
    (tested - invalid) +
    ' is the honest rate; ' +
    killed +
    '/' +
    tested +
    ' is not.\n'
  );
}
/* ── DIFF-SCOPED MUTATION ───────────────────────────────────────────────────────────────────────
   Sweeping a whole DSP is unaffordable: `oxydex-dsp.js` alone generates 2678 mutants, ~38 h at 20
   workers, and the fleet is ~11,500. That cost is why mutation testing gets run once, admired, and
   abandoned — and most of it is spent re-litigating code nobody touched.

   The bounded form is to mutate only the lines a change TOUCHED and require them killed. It enforces
   exactly "if you changed it, some test can see it", never judges pre-existing code, and costs a
   handful of mutants. It would have caught this file's own four `clock.js` gaps at the moment they
   were written rather than three sweeps later.

   Parses `git diff <base>...HEAD -U0`. Three-dot on purpose: it diffs against the MERGE BASE, which
   is what a PR shows — two-dot would also flag every line that moved on main since you branched, so
   a long-lived branch would be asked to prove tests for other people's code. */
export function changedLinesFromDiff(diffText) {
  const out = new Map();
  let path = null;
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('+++ ')) {
      /* Take the whole rest of the line, not a whitespace-split token: this repo really does ship
         `OxyDex Reference.html`, and splitting on space would silently truncate such a path to
         "OxyDex" and then match nothing. Strip only a trailing tab-timestamp, which is the one thing
         git appends after the name. */
      let p = line.slice(4).replace(/\t.*$/, '');
      path = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (!path || !line.startsWith('@@')) continue;
    const m = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (!count) continue; // a pure DELETION adds no line to test — not a gap, just nothing there
    let set = out.get(path);
    if (!set) out.set(path, (set = new Set()));
    for (let i = 0; i < count; i++) set.add(start + i);
  }
  return out;
}

export function verdictFromOutput(out) {
  return String(out).includes('✓') || String(out).includes('✕') ? 'KILLED' : 'INVALID';
}
function runSuiteAsync(filter, cwd, timeoutMs) {
  return new Promise((resolve) => {
    /* DEX_BAIL stops the suite at the first FAILING group. Measured on a real clock.js mutant:
       289 s → 2 s, same exit code, same killers. It only ever shortens a run that is already red, so
       it cannot turn a survivor into a kill — a survivor makes nothing fail, so nothing bails and it
       still pays the full suite. What it costs is the BREADTH of killer attribution: a mutant caught
       by several groups now reports only the first. That is why it is opt-in, and why the whole-file
       surveys that exist to measure `killers` should run without it. */
    const ch = spawn('node', filter ? ['tests/run-tests.mjs', '--group=' + filter] : ['tests/run-tests.mjs'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs || 900000,
      env: BAIL ? { ...process.env, DEX_BAIL: '1' } : process.env
    });
    let out = '';
    ch.stdout.on('data', (d) => {
      out += d;
    });
    ch.on('error', () => resolve({ verdict: 'INVALID', killers: [] }));
    ch.on('close', (code, signal) => {
      if (code === 0) return resolve({ verdict: 'SURVIVED', killers: [] });
      /* WHY it produced nothing matters, and the two causes look identical in the count. A mutant that
         HANGS was killed by the timeout (`code === null`, `signal` set); one that could not LOAD exited
         with a status. Both yield no assertion output, and lumping them together produced a wrong
         diagnosis on the record: clock.js's 5 invalids were blamed on a contended box, when 2 of them
         are `t += 0` and `while (hi2 - lo2 >= 1)` — non-terminating mutants that time out on any
         machine, idle or not.

         They stay OUT of the denominator rather than counted as kills, which is more conservative than
         Stryker/PIT/mutmut (all of which score a timeout as killed). The reason is local: this harness
         also times out under CPU contention, so "hung" here does not reliably mean "the mutant hangs".
         Recording the reason lets a reader tell a real infinite loop from a busy afternoon; guessing
         between them is what produced the wrong diagnosis in the first place. */
      const reason = code === null || signal ? 'timeout' : 'no-output';
      /* A NON-ZERO EXIT IS NOT AUTOMATICALLY A KILL. `/^\d{10,0}$/` is a syntactically invalid regex:
         the file cannot be parsed, node exits 2, and the old classifier scored that as KILLED —
         indistinguishable from a mutant a test actually caught. Every kill rate this tool has ever
         reported was inflated by however many mutants produce unparseable code, systematically and in
         the flattering direction.

         The discriminator is that a mutant killed by a TEST leaves assertion output behind, while one
         that never loaded leaves none. So: non-zero exit AND no assertion activity at all ⇒ the code
         did not run ⇒ INVALID, which `tested − invalid` already excludes from the denominator.
         Deliberately conservative — it only reclassifies runs that produced ZERO assertions, so a
         mutant that merely makes a group throw still counts as killed. */
      if (verdictFromOutput(out) === 'INVALID') return resolve({ verdict: 'INVALID', killers: [], reason });
      const seen = new Set();
      let m;
      KILLER_RE.lastIndex = 0;
      while ((m = KILLER_RE.exec(out))) seen.add(m[1]);
      resolve({ verdict: 'KILLED', killers: Array.from(seen) });
    });
  });
}

/* THE WORKER POOL IS CREATED ONCE PER PROCESS, not once per file.
   The first version built it inside runFile(), which was fine for a single module and catastrophic
   for a sweep: `git worktree add` checks out the WHOLE tree — 71 MB here — so 12 workers × 71 files
   is 852 full checkouts, ~850 MB copied per file. Measured on this external volume: one file took
   ~12 minutes, projecting to ~14 h for the roster, and essentially all of it was checkout I/O rather
   than test execution. Hoisted, the same sweep pays for 12 checkouts total. */
/* A WORKER MUST TEST *YOUR TREE*, NOT YOUR LAST COMMIT.
   `git worktree add --detach HEAD` checks out the committed state, so every UNCOMMITTED change — the
   tests you just wrote, the fix you are validating — is invisible to the run. It fails in the worst
   possible way: silently, with a plausible number, about the wrong code. It cost a 79-minute
   exhaustive `clock.js` run that reported seven mutants as SURVIVORS which had already been verified
   killed by hand, because the workers were running the pre-fix suite.
   So mirror the caller's dirty files into each fresh worker. `git status --porcelain` covers modified
   and untracked alike; deletions are applied as deletions. This is the whole point of the harness —
   it exists to tell you whether YOUR change is visible to the suite. */
function syncDirty(dir) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const rec of out.split('\0')) {
    if (!rec || rec.length < 4) continue;
    const path = rec.slice(3);
    if (!path || path.endsWith('.mutate-backup')) continue;
    const from = join(ROOT, path),
      to = join(dir, path);
    try {
      if (!existsSync(from)) {
        rmSync(to, { force: true });
        continue;
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    } catch {}
  }
}

let _pool = null;
function workerPool() {
  if (_pool) return _pool;
  _pool = [];
  /* SETUP IS NOT FREE AND MUST NOT BE SILENT. Each worker is a full `git worktree add` (~71 MB here),
     so building the pool takes MINUTES before a single mutant is tested — measured at ~11 min for 16
     workers. Printing nothing for that window makes a healthy run indistinguishable from a hang at
     exactly the moment a watcher first checks, which is the failure this tool's own header objects to
     elsewhere ("a measurement harness that lies about its own state"). One line per worker, on stderr,
     in every mode. */
  const _poolT0 = Date.now();
  process.stderr.write('  building worker pool: ' + JOBS + ' worktree(s), each a full checkout — this takes minutes\n');
  for (let w = 0; w < JOBS; w++) {
    const dir = join(ROOT, '..', '.mutate-w' + w + '-' + process.pid);
    try {
      execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
      syncDirty(dir);
      _pool.push(dir);
      process.stderr.write('    worker ' + _pool.length + '/' + JOBS + ' ready  (' + Math.round((Date.now() - _poolT0) / 1000) + 's)\n');
    } catch (e) {
      /* Out of disk, or git cannot add a worktree here. Do NOT abort the run: carry on with however
         many workers were created, and fall back to the serial in-place path if that is none. Each
         worktree is a full checkout, so a small machine hitting this is expected, not exceptional. */
      /* ALWAYS warn, INCLUDING under --json. stdout carries the NDJSON and stderr is free, so
         suppressing this bought nothing and hid the worst failure this tool has: losing the worker
         pool degrades a ~40 min run into a SERIAL one — the ~16 h figure CLOCK-MUTATION-COST measured
         — silently, while still printing a perfectly well-formed result. A measurement harness that
         quietly becomes 16× slower is the same class of defect as a gate that quietly stops checking. */
      console.error('  ⚠ worker ' + w + ' unavailable (' + ((e && e.message) || e).toString().split('\n')[0].slice(0, 80) + ') — continuing with ' + _pool.length);
      break;
    }
  }
  return _pool;
}
function dropPool() {
  for (const d of _pool || []) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', d], { cwd: ROOT, stdio: 'ignore' });
    } catch {}
  }
  _pool = null;
}

function runSuite(filter, cwd, timeoutMs) {
  try {
    execFileSync('node', filter ? ['tests/run-tests.mjs', '--group=' + filter] : ['tests/run-tests.mjs'], { cwd: cwd || ROOT, encoding: 'utf8', timeout: timeoutMs || 900000 });
    return 'SURVIVED'; // suite green with broken code → nothing tests this line
  } catch (e) {
    if (e.status === undefined) return 'INVALID'; // never ran (spawn failure / timeout kill)
    // Same rule as the pool path: no assertion output ⇒ the file did not parse ⇒ INVALID, not a kill.
    return verdictFromOutput(String(e.stdout || '') + String(e.stderr || ''));
  }
}

/* ── THE CANARY ─────────────────────────────────────────────────────────────────────────────────
   A mutation sweep reports a number nobody can sanity-check by eye. If the harness silently stops
   detecting kills — a changed suite exit convention, a broken killer regex, a worker whose checkout
   lost the tests — the run does not error. It reports a LOWER kill rate, which reads exactly like
   "the suite got worse" and sends you off writing tests against a lie. Nothing in the tool could
   tell those two apart, and one already bit: every non-zero exit was scored KILLED, so unparseable
   mutants were counted as coverage (fixed above).

   So each sweep carries a mutant that is KNOWN to die, tested alongside the real ones. If the canary
   survives, the harness is not detecting kills and the whole run is VOID — the rate is suppressed
   rather than reported. It is self-maintaining: the first attributed kill of a green sweep is
   recorded as that file's canary, so a file gets one automatically after its first run.

   Deliberately weak-but-real: it proves kills are still detected AND still attributed. It does not
   prove the count is right. That is the honest limit of a canary. */
const CANARY_FILE = join(ROOT, 'tools', 'mutate-canaries.json');
function loadCanaries() {
  try {
    return JSON.parse(readFileSync(CANARY_FILE, 'utf8'));
  } catch {
    return {};
  }
}
/* Serialise with keys sorted — PURE, so --selftest can prove it round-trips.
   The first version was `JSON.stringify(all, Object.keys(all).sort(), 2)`, intending "sort the keys".
   JSON.stringify's second parameter is the REPLACER, and an array there is an ALLOWLIST OF PROPERTY
   NAMES — so every property NOT named after a file (`line`, `op`, `before`, `after`, `killers`) was
   stripped and each entry serialised as `{}`.

   Two consequences, both silent. Every canary a sweep "learned" was empty, so the self-maintaining
   half of the mechanism had never once worked. And since the whole file is rewritten on each save,
   the first file to learn a canary DESTROYED the entry for every other file — including clock.js's,
   which had been seeded and verified by hand. A guard that quietly deletes other guards is worse
   than no guard, and nothing could have reported it: what is written is never read back. */
export function serializeCanaries(all) {
  const sorted = {};
  for (const k of Object.keys(all).sort()) sorted[k] = all[k];
  return JSON.stringify(sorted, null, 2) + '\n';
}
function saveCanary(file, mu, killerList) {
  try {
    /* FAIL CLOSED on an incomplete canary. findCanary matches on (line, op, before); an entry missing
       any of them can never match, so it would read STALE forever while looking like a live guard. */
    if (mu == null || mu.line == null || !mu.op || mu.before == null) return;
    const all = loadCanaries();
    all[file] = { line: mu.line, op: mu.op, before: mu.before, after: mu.after, killers: (killerList || []).slice(0, 3) };
    writeFileSync(CANARY_FILE, serializeCanaries(all));
  } catch {}
}
/* Match a stored canary back onto a freshly enumerated mutant. Matched on (line, op, before) rather
   than on an index: `file:line:index` shifts the moment anything above it is edited, and a canary
   that silently points at a DIFFERENT mutant after a refactor is worse than no canary. A miss is
   reported as 'STALE', never guessed at. */
function findCanary(all, want) {
  if (!want) return null;
  return all.find((m) => m.line === want.line && m.op === want.op && m.before === want.before) || null;
}

async function runFile(file) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return { file, error: 'not found' };
  const g = groupsForFile(file);
  const filter = FULL ? null : g && g.count ? g.stem : null;
  if (!FULL && (!g || !g.count)) return { file, error: 'NO GROUPS tagged "' + (g ? g.stem : '?') + '" — every mutant would survive trivially. Use --full, or give this file a tagged group.' };

  /* TIME ONE CLEAN RUN FIRST. Two things depend on it and both were guesses before.
     (a) THE TIMEOUT. It was a flat 900 s, which is not a timeout so much as a promise never to
         notice a hang: a mutant that wedges the suite stalled a worker for fifteen minutes, and with
         every worker able to do that a single module could eat an hour. Bound it at 5x the clean run
         (floor 30 s) — anything slower than that is not "slow", it is broken, and a broken mutant is
         INVALID, not a survivor.
     (b) THE ESTIMATE. The dominant cost is simply what this module's tagged groups cost to run, and
         that varies by three orders of magnitude across the roster: `quantity` is 0.21 s, `oxydex-dsp`
         16.3 s, `clock` **3 m 11 s** — because `clock` is loaded by everything and its tag selects 16
         heavy groups. Knowing that BEFORE spending twelve mutants on it is the difference between a
         sweep you can plan and one you watch. */
  /* THE CALIBRATION RUN IS THE LAST SILENT PHASE, and it is the longest one. This is a full clean
     suite run before any mutant is tested; under `--full` it is the WHOLE suite, measured at 480 s —
     eight minutes in which the tool produced not one byte and could not be told from a hang. The
     per-mutant loop and the pool build were both given progress; this was missed because it happens
     before either. Announce it up front and time it, so the number that follows is explained rather
     than merely late. */
  process.stderr.write('  calibrating: one clean ' + (filter ? 'group "' + filter + '"' : 'FULL SUITE') + ' run to size the timeout — no mutant is tested yet\n');
  const t0 = Date.now();
  runSuite(filter, ROOT, 600000);
  const baseMs = Math.max(1, Date.now() - t0);
  process.stderr.write('  calibrated: clean run took ' + (baseMs / 1000).toFixed(0) + 's\n');
  const timeoutMs = Math.max(30000, baseMs * 5);
  const estMs = (baseMs * Math.min(mutantsFor(readFileSync(abs, 'utf8')).length, LIMIT)) / Math.max(1, JOBS);
  if (BUDGET && estMs > BUDGET * 1000)
    return {
      file,
      error:
        'SKIPPED — one clean run of `' +
        filter +
        '` costs ' +
        (baseMs / 1000).toFixed(1) +
        ' s, so ' +
        LIMIT +
        ' mutants ≈ ' +
        (estMs / 1000).toFixed(0) +
        ' s > --budget ' +
        BUDGET +
        ' s. Raise --budget, lower --limit, or give this module cheaper groups.'
    };
  if (!AS_JSON) process.stderr.write('  ' + file + '  baseline ' + (baseMs / 1000).toFixed(1) + ' s/run → est ' + (estMs / 1000).toFixed(0) + ' s\n');

  const original = readFileSync(abs, 'utf8');
  const allGenerated = mutantsFor(original);
  /* Diff mode tests only what the change TOUCHED. The canary is looked up against the FULL population
     (below), never this filtered one: it guards the HARNESS, not the diff, and a canary that happened
     to fall outside the touched lines would read STALE on every gate run — leaving the fast per-PR
     gate as the one place with no proof that kills are still being detected. */
  const touched = DIFF ? DIFF_LINES.get(file) || new Set() : null;
  const all = touched ? allGenerated.filter((m) => touched.has(m.line)) : allGenerated;
  const picked = thin(all, LIMIT);
  /* The canary rides along as an extra mutant. It is EXCLUDED from every counter (see classify), so
     it can never flatter or dent the reported rate — it only decides whether that rate is reportable. */
  const canaryWant = loadCanaries()[file];
  const canaryMu = findCanary(allGenerated, canaryWant);
  if (canaryMu) {
    canaryMu.__canary = true;
    if (!picked.includes(canaryMu)) picked.push(canaryMu);
  }
  let canaryState = canaryWant ? (canaryMu ? 'PENDING' : 'STALE') : 'NONE';
  let firstKill = null; // for self-maintenance: adopt the first attributed kill as next run's canary
  /* CRASH-SAFE RESTORE. The first version registered SIGINT only, and a `pkill` (SIGTERM) during a run
     left `clock.js` MUTATED IN THE WORKING TREE — the `finally` never ran, and nothing said so. A tool
     that edits your source must survive being killed the way people actually kill things. So: an
     on-disk backup exists for the whole window (recoverable even from SIGKILL, which no handler can
     catch), and every catchable fatal signal restores. */
  /* The on-disk backup is only meaningful on the SERIAL path — with `--jobs > 1` the caller's tree is
     never mutated, so writing one there left a stray `*.mutate-backup` in the working tree after every
     parallel run for no benefit. Observed after a killed sweep: a lone `ppgdex-dsp.js.mutate-backup`
     beside a perfectly clean source. */
  const bak = abs + '.mutate-backup';
  if (JOBS === 1) {
    writeFileSync(bak, original);
    _dirty.set(abs, original);
  }
  const restore = () => {
    if (JOBS !== 1) return; // nothing was written here
    try {
      writeFileSync(abs, original);
    } catch {}
    try {
      rmSync(bak, { force: true });
    } catch {}
    _dirty.delete(abs);
  };
  const survivors = [];
  /* INVALID mutants are LISTED, not just counted. They were a bare number, and a bare number cannot be
     reconciled against anything — so a mutant that never ran was indistinguishable from one that ran
     and died. That is not hypothetical: two consecutive full sweeps of clock.js, on byte-identical
     source, reported 19 and 20 survivors. The extra one (L30, `tzOffset()`'s `* 60000`) had been
     sitting in the earlier run's invalid bucket. A REAL COVERAGE GAP HID INSIDE THE COUNT, and the
     run that missed it looked like the clean one — it matched the prediction exactly.
     Two runs are now comparable mutant-by-mutant, in both buckets. */
  const invalids = [];
  let killed = 0,
    invalid = 0,
    done = 0;
  const trees = [];
  const _t0 = Date.now();
  let _lastLine = 0;
  const _stamps = []; // completion times, for a trailing-window rate
  const tick = () => {
    /* Progress on stderr in EVERY mode. It was gated on !AS_JSON, so a --json run printed nothing at
       all for its whole duration: no way to distinguish a working run from a stalled one, and no way
       to see the job count that would have exposed a collapsed pool. stdout stays pure NDJSON.

       TWO SHAPES, because `\r` is only progress on a terminal. Piped to a file or a CI log — which is
       how any run long enough to need progress is actually watched — a carriage return overwrites
       nothing and the whole sweep lands as ONE unreadable line, indistinguishable from silence. A
       40-80 minute run that prints nothing legible cannot be told from a hung one. So when stderr is
       not a TTY, emit a NEWLINE checkpoint periodically instead, with elapsed and a projected finish
       so the reader can decide whether to keep waiting. */
    ++done;
    const el = (Date.now() - _t0) / 1000;
    /* `invalid` IS PART OF THE PROGRESS LINE, not just the JSON. A run on a contended box timed out
       24 mutants; each was correctly classified INVALID rather than counted as a kill — but the line
       read `killed 79 survived 18` and nothing else, so it looked like coverage had collapsed by a
       quarter. The number that explained it was in a field you had to open the JSON to see. A count
       that changes how you read every other count belongs beside them. */
    const body =
      file + '  ' + done + '/' + picked.length + '  killed ' + killed + '  survived ' + survivors.length + (invalid ? '  invalid ' + invalid : '') + '  [' + (trees.length || 1) + ' job(s)]';
    if (process.stderr.isTTY) {
      process.stderr.write('\r  ' + body + '   ');
      return;
    }
    // every 10th mutant, every ~30 s, and always on the last one — bounded output, never silent
    const dueCount = done % 10 === 0 || done === picked.length || done === 1;
    const dueTime = el - _lastLine >= 30;
    if (!dueCount && !dueTime) return;
    _lastLine = el;
    /* ETA FROM A TRAILING WINDOW, not from `done/elapsed`. The first mutant carries the whole pool
       build, so a cumulative rate projected 644 min for a run that takes ~10 h and would have read
       far worse on a shorter one — an ETA that wrong is noise, and a watcher who learns to ignore it
       has lost the only signal that says whether to wait. Measure the recent slope instead: the time
       for the last `_win` completions, which after the first few is the steady-state rate. */
    _stamps.push(el);
    if (_stamps.length > 12) _stamps.shift();
    let rate;
    if (_stamps.length >= 3) {
      const span = _stamps[_stamps.length - 1] - _stamps[0];
      rate = span > 0 ? (_stamps.length - 1) / span : 0;
    } else {
      rate = done / Math.max(el, 0.001); // too few samples to trend — cumulative, and it says so below
    }
    const etaS = rate > 0 ? Math.round((picked.length - done) / rate) : 0;
    const etaWarm = _stamps.length >= 3;
    const mmss = (t) => Math.floor(t / 60) + 'm' + String(Math.round(t % 60)).padStart(2, '0') + 's';
    process.stderr.write('  ' + body + '  elapsed ' + mmss(el) + (done < picked.length ? '  eta ' + mmss(etaS) + (etaWarm ? '' : ' (warming — includes pool build)') : '  done') + '\n');
  };
  /* `v` is either the legacy string (the serial in-place path, which still uses the sync runner) or
     `{ verdict, killers }` from the async pool. Normalising here keeps both paths on one classifier
     rather than duplicating the bookkeeping. */
  const killers = new Map(); // group title → how many mutants it killed
  const classify = (v, mu) => {
    const verdict = typeof v === 'string' ? v : v.verdict;
    const ks = (typeof v === 'string' ? [] : v.killers) || [];
    if (mu.__canary) {
      /* The canary's verdict IS the run's licence to report a number. A canary that dies with an
         attributed killer means kills are still being detected and attributed; anything else means
         they may not be, and a rate computed under that doubt is not evidence. */
      canaryState = verdict === 'KILLED' && ks.length ? 'PASSED' : 'FAILED';
      tick();
      return;
    }
    if (verdict === 'KILLED') {
      killed++;
      if (!firstKill && ks.length) firstKill = { mu, killers: ks };
      for (const g of ks) killers.set(g, (killers.get(g) || 0) + 1);
    } else if (verdict === 'INVALID') {
      invalid++;
      invalids.push({ ...mu, reason: (typeof v === 'string' ? null : v.reason) || 'no-output' });
    } else survivors.push(mu);
    tick();
  };

  try {
    if (JOBS > 1) {
      /* One disposable worktree per worker, detached at HEAD. Each worker mutates ITS OWN copy of the
         file, so no two mutants ever race on the same bytes — and the caller's tree is never written
         to at all on this path. */
      trees.push(...workerPool());
      if (!trees.length) {
        /* No worker could be created — degrade to the serial in-place path rather than doing nothing.
           The backup/recovery machinery is keyed on JOBS === 1, so mark this file dirty explicitly. */
        writeFileSync(bak, original);
        _dirty.set(abs, original);
        for (const mu of picked) {
          writeFileSync(abs, mu.apply());
          classify(runSuite(filter, ROOT, timeoutMs), mu);
        }
        writeFileSync(abs, original);
        rmSync(bak, { force: true });
        _dirty.delete(abs);
        return {
          file,
          groupsRun: filter || 'FULL SUITE',
          groupCount: g ? g.count : null,
          groupsSelected: g ? g.selected : null,
          generated: all.length,
          generatedInFile: touched ? allGenerated.length : undefined,
          touchedLines: touched ? touched.size : undefined,
          tested: picked.length,
          killed,
          invalid,
          invalids,
          killers: Array.from(killers.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([group, n]) => ({ group, n })),
          survivors: survivors.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after }))
        };
      }
      let next = 0;
      const worker = async (dir) => {
        const wAbs = join(dir, file);
        for (;;) {
          const i = next++;
          if (i >= picked.length) return;
          writeFileSync(wAbs, picked[i].apply());
          classify(await runSuiteAsync(filter, dir, timeoutMs), picked[i]);
        }
      };
      await Promise.all(trees.map(worker));
    } else {
      for (const mu of picked) {
        writeFileSync(abs, mu.apply());
        classify(runSuite(filter, ROOT, timeoutMs), mu);
      }
    }
  } finally {
    restore(); // the shared pool is torn down once, by dropPool() at the end of the run
  }
  if (!AS_JSON) process.stderr.write('\r' + ' '.repeat(78) + '\r');
  /* Self-maintenance: a green sweep donates its first attributed kill as the next run's canary. Only
     from a run whose own canary passed (or that had none yet) — adopting a canary from a run we
     already suspect would launder the doubt forward. */
  if (firstKill && (canaryState === 'PASSED' || canaryState === 'NONE')) {
    if (canaryState === 'NONE') saveCanary(file, firstKill.mu, firstKill.killers);
  }
  /* An INVALID mutant is one that never ran, so it is excluded from the denominator — which means a
     run can quietly measure far fewer mutants than it tested and still report a confident rate. One
     invalid is normal (a mutated regex quantifier that cannot compile). Twenty-five is a machine
     problem, and the reader has no way to know which they are looking at unless the tool says so. */
  const warn = invalidWarning(invalid, picked.length, killed);
  if (warn) process.stderr.write(warn);
  if (canaryState === 'FAILED') {
    process.stderr.write(
      '\n  ✕ CANARY SURVIVED on ' +
        file +
        ' — a mutant known to be killed was not killed.\n' +
        "    The harness is not reliably detecting kills, so this run's kill rate is NOT reported.\n" +
        '    Expected killers: ' +
        (canaryWant.killers || []).join(', ') +
        '\n' +
        '    Canary: L' +
        canaryWant.line +
        ' [' +
        canaryWant.op +
        ']\n'
    );
  } else if (canaryState === 'STALE') {
    process.stderr.write(
      '\n  ⚠ CANARY STALE on ' +
        file +
        ' — the recorded canary (L' +
        canaryWant.line +
        ' [' +
        canaryWant.op +
        ']) no longer matches any generated mutant; the file changed under it.\n' +
        '    The run is UNGUARDED. Delete its entry in tools/mutate-canaries.json to re-learn one.\n'
    );
  }
  return {
    file,
    /* A rate nobody can trust is worse than no rate: on a failed canary the counts are still emitted
       for debugging, but `killed`/`rate` are nulled so no reader — human or script — can quote them. */
    canary: canaryState,
    voided: canaryState === 'FAILED',
    groupsRun: filter || 'FULL SUITE',
    groupCount: g ? g.count : null,
    groupsSelected: g ? g.selected : null,
    generated: all.length,
    /* In diff mode: how many mutants the FILE has, and how many lines the change touched — so a
       result of "3" reads as "3 on the 2 lines you changed", not "this file is nearly mutant-free". */
    generatedInFile: touched ? allGenerated.length : undefined,
    touchedLines: touched ? touched.size : undefined,
    // the canary is scaffolding, not a measurement — it must not enter the denominator it guards
    tested: picked.length - (canaryMu ? 1 : 0),
    killed: canaryState === 'FAILED' ? null : killed,
    invalid,
    // the mutants that never RAN — listed, so a survivor can never hide as a bare count again
    invalids,
    /* WHICH groups did the killing, and how many mutants each accounted for. The union over a whole
       file is the minimal sufficient selection for that file's tag — the measurement that says whether
       an expensive tag can be narrowed (CLOCK-MUTATION-COST). Sorted by contribution so the long tail
       is visible; a group that killed nothing never appears. */
    killers: Array.from(killers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([group, n]) => ({ group, n })),
    survivors: survivors.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after }))
  };
}

/* ── selftest: known answers, and it does NOT touch the repo ────────────────────────────────
   Mutant GENERATION is the part with a right answer; whether a given mutant survives depends on
   the suite and is not a fixed fact. So the selftest pins generation + thinning determinism. */
function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const src = [
    '// a line comment with >= in it', // 1
    'const a = x >= 3 && y !== 2;', // 2
    '/* a block comment', // 3
    '   whose body mentions < and 42 on a plain line */', // 4
    'if (!ready) return 0;', // 5
    'const msg = "read >= 10 files";', // 6  string literal
    'const EPOCH = 5400; // 90 min' // 7  trailing comment after real code
  ].join('\n');
  const ms = mutantsFor(src);
  const lines = [...new Set(ms.map((m) => m.line))].sort((a, b) => a - b);
  ok('a whole-line comment is not mutated', !lines.includes(1), 'lines=' + lines.join(','));
  ok('a BLOCK-comment body is not mutated, even on a plain continuation line', !lines.includes(4), 'lines=' + lines.join(','));
  ok('a STRING literal is not mutated', !lines.includes(6), 'lines=' + lines.join(','));
  ok('code lines are mutated', lines.includes(2) && lines.includes(5), 'lines=' + lines.join(','));
  // Line 7 is the sharp one: real code AND a trailing comment. The 5400 must mutate, the 90 must not.
  const l7 = ms.filter((m) => m.line === 7);
  ok(
    'a trailing comment does not shield the statement before it',
    l7.some((m) => m.after.includes('const EPOCH = 0')),
    l7.map((m) => m.after).join(' | ') || 'no mutant on line 7'
  );
  ok('…and the number INSIDE that trailing comment is left alone', !l7.some((m) => /\/\/ 0 min/.test(m.after)), l7.map((m) => m.after).join(' | '));
  const ops = new Set(ms.filter((m) => m.line === 2).map((m) => m.op));
  ok('line 2 yields the >=, && and !== operators', ops.has('cmp >= → >') && ops.has('bool && → ||') && ops.has('eq !== → ==='), [...ops].join(' | '));
  ok(
    'a mutant actually changes the line',
    ms.every((m) => m.after !== m.before),
    'some mutant is a no-op'
  );
  ok(
    'the ! drop fires on `if (!ready)`',
    ms.some((m) => m.line === 5 && m.op === 'negate: drop !'),
    'ops@5=' +
      ms
        .filter((m) => m.line === 5)
        .map((m) => m.op)
        .join(',')
  );
  /* THE REGEX-LITERAL CASE, which corrupted a real audit before it was handled.
     `clock.js:81` is `s.replace(/^["']|["']$/g, '')` — a regex containing BOTH quote characters. A
     scanner that is not regex-aware sees `/`, stays in code state, then meets `"` and enters string
     state, and every quote after that flips it wrongly for the REST OF THE FILE. The damage runs both
     ways: six mutants landed inside a comment (noise), and real code was suppressed as "string" —
     mutant count went 81 → 123 once fixed. So the published 38 % was wrong in both directions. */
  const rx = ['const RE = /^["\']|["\']$/g;', 'if (a >= 3) return 1;', '// a comment with >= in it'].join('\n');
  const rxm = mutantsFor(rx);
  const rxl = [...new Set(rxm.map((m) => m.line))];
  ok('a regex literal containing quotes does not desync the scanner', rxl.includes(2), 'lines=' + rxl.join(','));
  ok('…and the comment AFTER it is still protected', !rxl.includes(3), 'lines=' + rxl.join(','));
  // Division must still be division: `a / b` is not a regex opening.
  const div = mutantsFor('const r = total / count >= 2;');
  ok(
    'a division slash is not mistaken for a regex opener',
    div.some((m) => m.op.startsWith('cmp >=')),
    div.map((m) => m.op).join(',')
  );

  /* Low-core behaviour is a CORRECTNESS property, not a tuning detail: at 1-2 cores the tool must
     take the serial in-place path, because each parallel worker is a full 71 MB checkout that buys
     nothing when there is one core to share. Pinned so a future tuning pass cannot quietly hand a
     2-core laptop a 2-worktree split. */
  ok('1 core → serial (no worktrees)', defaultJobs(1) === 1, 'got ' + defaultJobs(1));
  ok('2 cores → serial (no worktrees)', defaultJobs(2) === 1, 'got ' + defaultJobs(2));
  ok('an empty cpus() list → serial, not a crash', defaultJobs(0) === 1 && defaultJobs(undefined) === 1);
  ok('3 cores → 2 workers (parallel begins)', defaultJobs(3) === 2, 'got ' + defaultJobs(3));
  ok('24 cores → 16, the measured optimum on this box', defaultJobs(24) === 16, 'got ' + defaultJobs(24));
  ok(
    'scales monotonically and never exceeds core count',
    [4, 6, 8, 12, 16, 32].every((c, i, a) => defaultJobs(c) <= c && (i === 0 || defaultJobs(c) >= defaultJobs(a[i - 1])))
  );

  // Thinning must be deterministic and order-preserving — a survivor has to be reproducible.
  const big = Array.from({ length: 100 }, (_, i) => ({ i }));
  const t1 = thin(big, 10),
    t2 = thin(big, 10);
  ok('thinning is deterministic', JSON.stringify(t1) === JSON.stringify(t2));
  ok('thinning preserves order and count', t1.length === 10 && t1[0].i === 0 && t1[9].i > t1[0].i);
  /* The classifier and the canary matcher — both added after a real miscount, both pure, both
     asserted here so the next regression is a red selftest rather than a flattering rate. */
  const ck = (name, got, want) => {
    const ok = got === want;
    console.log((ok ? '  ✓ ' : '  ✕ ') + name + (ok ? '' : '  got ' + got + ' want ' + want));
    if (!ok) fail = (fail || 0) + 1;
  };
  /* EVERY generated mutant must PARSE. A mutant that cannot be loaded tests nothing, and until the
     classifier above was fixed it was scored as a kill — so a generator bug read as coverage. These
     pin the shift operators, which is where it actually happened. */
  console.log('\ngenerated mutants must parse — the shift operators are not comparisons');
  const mutOne = (src, op) => {
    op.re.lastIndex = 0;
    return src.replace(op.re, op.to);
  };
  const gt = OPS.find((o) => o.name === 'cmp > → >=');
  const lt = OPS.find((o) => o.name === 'cmp < → <=');
  ck('>> is not mutated into >=>', mutOne('var m = s.length >> 1;', gt), 'var m = s.length >> 1;');
  ck('<< is not mutated into <=<', mutOne('var m = s.length << 1;', lt), 'var m = s.length << 1;');
  ck('=> (arrow) is not mutated', mutOne('var f = (a) => a;', gt), 'var f = (a) => a;');
  ck('a real > IS still mutated', mutOne('if (a > b) {', gt), 'if (a >= b) {');
  ck('a real < IS still mutated', mutOne('if (a < b) {', lt), 'if (a <= b) {');
  console.log('\nverdictFromOutput — a non-zero exit is not automatically a kill');
  ck('assertion failure → KILLED', verdictFromOutput('✕ [clock] parseTimestamp\n'), 'KILLED');
  ck('green marks then a late crash → KILLED', verdictFromOutput('✓ clock\nsegfault\n'), 'KILLED');
  ck('unparseable file, no suite output → INVALID', verdictFromOutput('SyntaxError: Invalid regular expression'), 'INVALID');
  ck('empty output → INVALID', verdictFromOutput(''), 'INVALID');
  /* The diff parser decides WHICH lines get gated. A bug here doesn't error — it gates the wrong
     lines, or none, and reports a confident green. So every hunk shape it can meet is pinned. */
  console.log('\nchangedLinesFromDiff — the parser that decides what the gate looks at');
  const D = (t) => changedLinesFromDiff(t);
  const L = (t, f) => [...(D(t).get(f) || [])].join(',');
  ck('added hunk → its new lines', L('+++ b/a.js\n@@ -10,0 +11,3 @@\n', 'a.js'), '11,12,13');
  ck('no-count hunk means exactly one line', L('+++ b/a.js\n@@ -1 +1 @@\n', 'a.js'), '1');
  ck('pure DELETION contributes nothing', L('+++ b/a.js\n@@ -5,2 +5,0 @@\n', 'a.js'), '');
  ck('a deleted FILE is skipped, not attributed', D('+++ /dev/null\n@@ -1,5 +0,0 @@\n').size, 0);
  ck('two files stay separate', D('+++ b/a.js\n@@ -1 +1 @@\n+++ b/b.js\n@@ -9 +9 @@\n').get('b.js').has(9), true);
  ck('…and do not bleed into each other', D('+++ b/a.js\n@@ -1 +1 @@\n+++ b/b.js\n@@ -9 +9 @@\n').get('a.js').has(9), false);
  /* This repo really does ship `OxyDex Reference.html`. Splitting the +++ line on whitespace would
     truncate it to "OxyDex", match no file, and gate nothing — silently. */
  ck('a path containing a SPACE survives', D('+++ b/OxyDex Reference.html\n@@ -3 +3 @@\n').has('OxyDex Reference.html'), true);
  ck('a trailing tab-timestamp is stripped', D('+++ b/a.js\t2026-08-05\n@@ -3 +3 @@\n').has('a.js'), true);
  ck('hunks accumulate within one file', L('+++ b/a.js\n@@ -1 +1 @@\n@@ -8,0 +9,2 @@\n', 'a.js'), '1,9,10');
  ck('empty diff → empty map', D('').size, 0);
  console.log('\ninvalidWarning — a run that did not measure what it claims must say so');
  ck('1 of 123 (the regex quantifier) → silent', invalidWarning(1, 123, 103), null);
  ck('2 of 123 → still silent', invalidWarning(2, 123, 102), null);
  ck('25 of 122 → warns', typeof invalidWarning(25, 122, 79) === 'string', true);
  ck('…and names the honest denominator', /79\/97/.test(invalidWarning(25, 122, 79) || ''), true);
  ck('3 of 200 (1.5%) → silent, count alone is not enough', invalidWarning(3, 200, 150), null);
  ck('3 of 10 (30%) → warns', typeof invalidWarning(3, 10, 5) === 'string', true);
  ck('0 tested → no divide-by-zero', invalidWarning(0, 0, 0), null);
  /* The canary file is WRITTEN and never read back by the writer, so a serialisation bug is invisible
     — and this one deleted other files' guards while looking like it was adding one. Round-trip it. */
  console.log('\nserializeCanaries — a guard that silently deletes other guards is worse than none');
  const CE = { line: 386, op: 'cmp <= → <', before: 'if (x <= a) return b;', after: 'if (x < a) return b;', killers: ['g'] };
  const rt = JSON.parse(serializeCanaries({ 'clock.js': CE }));
  ck('an entry survives the round-trip at all', JSON.stringify(rt['clock.js']), JSON.stringify(CE));
  ck('…line survives', rt['clock.js'].line, 386);
  ck('…op survives', rt['clock.js'].op, 'cmp <= → <');
  ck('…before survives (findCanary matches on it)', rt['clock.js'].before, 'if (x <= a) return b;');
  ck('…killers survive', JSON.stringify(rt['clock.js'].killers), '["g"]');
  const two = JSON.parse(serializeCanaries({ 'z.js': CE, 'a.js': CE }));
  ck('adding a second file does NOT empty the first', JSON.stringify(two['z.js']), JSON.stringify(CE));
  ck('…and the new one is populated too', JSON.stringify(two['a.js']), JSON.stringify(CE));
  ck('keys are sorted', Object.keys(two).join(','), 'a.js,z.js');
  ck('a round-tripped entry still MATCHES its mutant', findCanary([{ line: 386, op: 'cmp <= → <', before: 'if (x <= a) return b;' }], rt['clock.js']) !== null, true);
  console.log('\nfindCanary — matched on (line, op, before), never on a positional index');
  const pool = [
    { line: 10, op: 'cmp > → >=', before: 'if (a > b) {' },
    { line: 20, op: 'num → 0', before: 'return 5;' }
  ];
  ck('exact match found', findCanary(pool, { line: 20, op: 'num → 0', before: 'return 5;' }) === pool[1], true);
  ck('line moved → null (STALE, not a wrong guess)', findCanary(pool, { line: 21, op: 'num → 0', before: 'return 5;' }), null);
  ck('same line, different op → null', findCanary(pool, { line: 10, op: 'num → 0', before: 'if (a > b) {' }), null);
  ck('no canary recorded → null', findCanary(pool, undefined), null);
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

/* HANDLERS ARE REGISTERED ONCE, FOR THE PROCESS — not per file.
   The per-file version leaked five listeners per file and a 71-file sweep tripped Node's
   MaxListenersExceededWarning at 11 uncaughtException listeners. Same restore semantics, one
   registration, and an explicit registry of what is currently dirty. */
const _dirty = new Map(); // absolute path → original text
function restoreAll() {
  for (const [abs, original] of _dirty) {
    try {
      writeFileSync(abs, original);
    } catch {}
    try {
      rmSync(abs + '.mutate-backup', { force: true });
    } catch {}
  }
  _dirty.clear();
}
for (const sg of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'])
  process.on(sg, () => {
    restoreAll();
    dropPool();
    process.exit(sg === 'SIGINT' ? 130 : 143);
  });
process.on('uncaughtException', (e) => {
  restoreAll();
  dropPool();
  throw e;
});

/* RECOVER FIRST, ALWAYS. A previous run killed mid-mutation leaves `<file>.mutate-backup` beside a
   mutated source. Restore it before doing anything, so the damage window closes on the next
   invocation instead of waiting to be noticed in a diff — or worse, committed. */
function recoverStale() {
  let out = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) continue;
      if (!e.name.endsWith('.mutate-backup')) continue;
      const bak = join(dir, e.name),
        target = bak.replace(/\.mutate-backup$/, '');
      try {
        writeFileSync(target, readFileSync(bak, 'utf8'));
        rmSync(bak, { force: true });
        out.push(target.replace(ROOT + '/', ''));
      } catch {}
    }
  };
  scan(ROOT);
  /* Orphaned worker worktrees from a killed sweep. `dropPool()` cannot run when the process is
     SIGKILLed or reaped by `timeout`, and each tree is a FULL checkout — 34 of them survived one
     killed run here, ~2.4 GB. Reap any that no live process owns before starting. */
  try {
    for (const e of readdirSync(join(ROOT, '..'), { withFileTypes: true })) {
      const m = e.name.match(/^\.mutate-w\d+-(\d+)$/);
      if (!m) continue;
      let alive = false;
      try {
        process.kill(+m[1], 0);
        alive = true;
      } catch {}
      if (alive) continue;
      const dir = join(ROOT, '..', e.name);
      try {
        execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT, stdio: 'ignore' });
      } catch {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      out.push(e.name + ' (orphaned worktree)');
    }
    execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' });
  } catch {}
  try {
    scan(join(ROOT, 'tools'));
  } catch {}
  if (out.length) console.error('  ⚠ recovered ' + out.length + ' file(s) from a killed run: ' + out.join(', '));
}
recoverStale();

if (has('--selftest')) process.exit(selftest());

/* DIFF_LINES is read ONCE, here, and consulted per file inside runFile. Empty when --diff is off. */
const DIFF_LINES = new Map();
if (DIFF) {
  /* NAMES FIRST, then a line-diff restricted to just those files. Asking for the whole patch blew the
     64 MB buffer with ENOBUFS against a base a few weeks old — `uploads/` alone is enormous — and a
     gate that dies on a long branch is a gate people switch off. Restricting the second call keeps it
     small however far back the base is.

     execFileSync with an ARGS ARRAY rather than a shell string: this repo ships paths with spaces
     (`OxyDex Reference.html`), and interpolating one into `sh -c` mangles it. */
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let names = [];
  try {
    names = git(['diff', '--name-only', DIFF_BASE + '...HEAD'])
      .split('\n')
      .filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('tests/') && !f.startsWith('tools/'));
  } catch (e) {
    // FAIL CLOSED. A gate that cannot see the diff must never report "nothing to test".
    console.error('--diff: cannot diff against ' + DIFF_BASE + ' — ' + String(e.message || e).split('\n')[0]);
    console.error('  Is the base fetched?   git fetch origin main');
    process.exit(2);
  }
  if (names.length) {
    try {
      /* `-w` (ignore whitespace) because a REFORMAT is not a behavioural change. Measured: a `biome`
         format commit touches every line of clock.js, and without this the gate would select the
         entire 123-mutant population — a ~2 h "gate" on a PR that changed no behaviour at all. It
         does not cover re-wrapping (which genuinely moves tokens between lines), which is why the
         cost is also printed up front rather than discovered by waiting. */
      for (const [f, lines] of changedLinesFromDiff(git(['diff', DIFF_BASE + '...HEAD', '-U0', '-w', '--', ...names]))) DIFF_LINES.set(f, lines);
    } catch (e) {
      console.error('--diff: cannot read the line-level diff — ' + String(e.message || e).split('\n')[0]);
      process.exit(2);
    }
  }
}

let files = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[i + 1]);
if (DIFF && !files.length) {
  files = [...DIFF_LINES.keys()].filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('tests/') && !f.startsWith('tools/') && existsSync(join(ROOT, f)));
  if (!files.length) {
    // A real, honest pass: the change touched no mutable source. Say which, so it is not read as a skip.
    console.error('--diff: no mutable JS source changed vs ' + DIFF_BASE + ' (' + DIFF_LINES.size + ' file(s) in the diff) — nothing to gate.');
    process.exit(0);
  }
}
if (!files.length) {
  try {
    files = execSync('git diff --name-only origin/main...HEAD', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('tests/') && !f.startsWith('tools/'));
  } catch {
    files = [];
  }
}
if (!files.length) {
  console.error('nothing to mutate — pass --file <path>, or have changes vs origin/main. --selftest needs neither.');
  process.exit(2);
}

/* SAY WHAT IT WILL COST, BEFORE SPENDING IT. `-w` stops a pure re-indent from selecting the whole
   file, but it cannot stop a re-WRAP — a biome format commit still selected 92 of clock.js's 123
   mutants. Someone expecting a PR gate should learn that from a line printed in the first second,
   not by watching a "quick check" run for two hours. Cheap because --dry-run runs no suite. */
if (DIFF && !AS_JSON && !DRY) {
  let planned = 0;
  for (const f of files) {
    try {
      const t = DIFF_LINES.get(f);
      planned += mutantsFor(readFileSync(join(ROOT, f), 'utf8')).filter((m) => !t || t.has(m.line)).length;
    } catch {}
  }
  const each = FULL ? 461 : 180; // seconds/mutant, measured; bail makes KILLED ones far cheaper
  const mins = Math.round((planned * each) / Math.max(1, JOBS) / 60);
  console.log('  diff gate: ' + planned + ' mutant(s) on ' + [...DIFF_LINES.values()].reduce((a, s) => a + s.size, 0) + ' changed line(s) in ' + files.length + ' file(s)');
  console.log('  worst case ~' + mins + ' min at ' + JOBS + ' job(s); killed mutants return in seconds with bail' + (BAIL ? '' : ' (currently OFF)') + '\n');
}

/* REPORT PER FILE, AS IT COMPLETES — never buffer a long run to the end.
   The first version accumulated every result and printed once, so a 71-file sweep showed NOTHING for
   its entire duration and a kill (or a timeout) lost the lot. That is the same shape as a gate whose
   output you cannot see until it is too late to act on. `--json` now emits NDJSON: one compact object
   per line, per file, flushed as it lands — greppable, `jq`-able line by line, and whatever finished
   before an interrupt is still on disk. */
function reportOne(r) {
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(r) + '\n');
    return;
  }
  if (r.error) {
    console.log('  ' + r.file + '\n    ⊘ ' + r.error + '\n');
    return;
  }
  const score = r.tested - r.invalid ? ((r.killed / (r.tested - r.invalid)) * 100).toFixed(0) : '—';
  console.log(
    '  ' + r.file + '   groups: ' + r.groupsRun + ' (' + r.groupCount + ' tagged' + (r.groupsSelected != null && r.groupsSelected !== r.groupCount ? ', ' + r.groupsSelected + ' RUN' : '') + ')'
  );
  console.log('    generated ' + r.generated + ', tested ' + r.tested + ' → killed ' + r.killed + ', survived ' + r.survivors.length + ', invalid ' + r.invalid + '   [' + score + ' % killed]');
  for (const s of r.survivors.slice(0, 25)) console.log('      SURVIVED ' + r.file + ':' + s.line + '  [' + s.op + ']\n        ' + s.before + '\n        ' + s.after);
  if (r.survivors.length > 25) console.log('      … and ' + (r.survivors.length - 25) + ' more');
  console.log('');
}

if (!AS_JSON) console.log('MUTATION SWEEP — a surviving mutant means the suite cannot see a change there\n');
if (DRY) {
  /* `--dry-run --json` is the ENUMERATE-WITHOUT-TESTING lane (mutmut's `mutmut run --dry-run`
     equivalent): it emits every mutant with a stable id so a triage tool can reproduce one by id
     without re-deriving the operator set. `--json` used to be ignored here, so the only enumeration
     was human-readable text — which meant any sibling tool had to re-implement OPS and would drift
     (the divergent-copy failure this repo has hit before). */
  const dryOut = [];
  for (const f of files) {
    const abs = join(ROOT, f);
    if (!existsSync(abs)) {
      if (!AS_JSON) console.log('  ' + f + '  ⊘ not found');
      else dryOut.push({ file: f, error: 'not found' });
      continue;
    }
    /* Dry-run honours --diff too. Without this, `--diff --dry-run` would enumerate the WHOLE file and
       give a wildly wrong picture of what the gate is about to test — the one command someone runs to
       check the gate's scope before trusting it. */
    const _touched = DIFF ? DIFF_LINES.get(f) || new Set() : null;
    const ms = mutantsFor(readFileSync(abs, 'utf8')).filter((m) => !_touched || _touched.has(m.line));
    if (AS_JSON) {
      dryOut.push({ file: f, generated: ms.length, mutants: ms.map((mu, i) => ({ id: f + ':' + mu.line + ':' + i, line: mu.line, op: mu.op, before: mu.before, after: mu.after })) });
    } else {
      console.log('  ' + f + '  ' + ms.length + ' mutant(s)');
      for (const mu of thin(ms, LIMIT)) console.log('    L' + mu.line + '  [' + mu.op + ']  ' + mu.before.slice(0, 88));
    }
  }
  if (AS_JSON) console.log(JSON.stringify({ dryRun: true, files: dryOut }, null, 2));
  process.exit(0);
}

const results = [];
try {
  for (const f of files) {
    const r = await runFile(f);
    results.push(r);
    reportOne(r);
  }
} finally {
  dropPool();
}
/* A one-line roll-up at the end, so a sweep does not have to be re-aggregated by hand to answer the
   only question that spans files: how much of this codebase can the suite actually see? */
if (!AS_JSON) {
  const ok = results.filter((r) => !r.error);
  const k = ok.reduce((a, r) => a + r.killed, 0);
  const n = ok.reduce((a, r) => a + (r.tested - r.invalid), 0);
  const gen = ok.reduce((a, r) => a + r.generated, 0);
  console.log(
    '  ── ' +
      ok.length +
      ' file(s) measured, ' +
      (results.length - ok.length) +
      ' skipped ── ' +
      k +
      '/' +
      n +
      ' killed = ' +
      (n ? ((k / n) * 100).toFixed(0) : '—') +
      ' %  (of ' +
      gen +
      ' mutants that exist)'
  );
}

/* ── DIFF MODE IS A GATE, so it decides an EXIT CODE ────────────────────────────────────────────
   Survey mode reports and always exits 0: a survivor in code nobody touched is information, not a
   verdict. Diff mode is the opposite — every mutant it tested sits on a line this change wrote, so a
   survivor means "you changed this and no test can see it", which is exactly the thing to block on.

   It refuses in three ways, and only one of them is "a survivor":
     · a VOIDED run (canary survived) exits 3 — the harness could not be trusted to detect kills, so
       "all killed" would be an unearned pass, and passing on an unverifiable measurement is worse
       than failing on a real one;
     · INVALID mutants exit 3 too — they never ran, so nothing about them was proven;
     · survivors exit 1, listed with file:line and the exact edit that went unnoticed. */
if (DIFF) {
  const ok = results.filter((r) => !r.error);
  const surv = ok.flatMap((r) => r.survivors.map((s) => ({ file: r.file, ...s })));
  const voided = ok.filter((r) => r.voided);
  const unrun = ok.reduce((a, r) => a + r.invalid, 0);
  const tested = ok.reduce((a, r) => a + r.tested, 0);
  const lines = ok.reduce((a, r) => a + (r.touchedLines || 0), 0);
  if (voided.length) {
    console.error('\n✕ MUTATION GATE VOID — the canary survived on: ' + voided.map((r) => r.file).join(', '));
    console.error('  Kills are not being detected, so "all killed" would prove nothing. Not a pass.');
    process.exit(3);
  }
  if (unrun) {
    console.error('\n✕ MUTATION GATE INCONCLUSIVE — ' + unrun + ' of ' + tested + ' mutants never ran.');
    console.error('  They did not compile, or timed out under load. Nothing was proven about them.');
    process.exit(3);
  }
  if (surv.length) {
    console.error('\n✕ MUTATION GATE — ' + surv.length + ' of ' + tested + ' mutants on your ' + lines + ' changed line(s) SURVIVED.');
    console.error('  Each is an edit you made that no test can see. Add an assertion, or explain why it is unobservable:\n');
    for (const s of surv.slice(0, 20)) console.error('    ' + s.file + ':' + s.line + '  [' + s.op + ']\n      ' + String(s.before).trim().slice(0, 100));
    if (surv.length > 20) console.error('    … and ' + (surv.length - 20) + ' more');
    process.exit(1);
  }
  if (!AS_JSON) console.log('\n✓ mutation gate: all ' + tested + ' mutant(s) on ' + lines + ' changed line(s) were killed.');
}
