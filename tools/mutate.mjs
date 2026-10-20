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
 *   node tools/mutate.mjs --verdict-sample          # the tepna.verdict/1 object over a SYNTHETIC result set — no
 *                                                    # suite, no git; what tools/verdict-adoption.mjs reads in CI
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
 * EQUIVALENT MUTANTS ARE NOW DATA (2026-08-08). Some survivors cannot be killed by any input —
 * `if (rv < rMin) rMin = rv;` mutated to `<=` cannot change a minimum on a tie. That classification
 * used to be PROSE in MUTATION-EQUIVALENCE-2026-08-04-BRIEF §3; it now lives in
 * `tools/mutate-equivalence.json` and is read by `classifySurvivors`, so a run reports
 * `killed / distinguishable` beside `killed / tested`. The owner restated the 90 % target on the
 * distinguishable denominator on 2026-08-08.
 *
 * THIS IS NOT AN ALLOWLIST, and the earlier text here set the condition it has to meet: "prefer
 * arguing with the gate occasionally over a gate that silently excuses whatever it cannot kill." So
 * an entry can only ever REMOVE a mutant from the denominator while it is BOTH still generated AND
 * still surviving. Three states are reported loudly instead of absorbed:
 *   REFUTED  — the entry claims equivalence and the mutant was KILLED. The entry is wrong; fix the
 *              entry, never the test that killed it. This is the only way a stale file could hide a
 *              real gap, so it is an error, not a note.
 *   ORPHANED — the entry matches no generated mutant (the line moved). Excluded from every count.
 *   UNCLASSIFIED — a survivor nobody has probed. Counted and named; silence is never equivalence.
 * `real-gap` entries stay IN the denominator: a classification file is not a place to launder debt.
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
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, readdirSync, mkdirSync, symlinkSync, mkdtempSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { recoverStale } from './mutate-recover.mjs';
import { createHash } from 'node:crypto';

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
/* `--only <path>` re-tests a recorded mutant list (see selectRecorded). It sets its own population,
   so `--limit`'s default 60 must not silently thin a 171-survivor list down to 60 — that would be a
   smaller denominator reported as a complete answer. An explicit --limit still wins. */
const ONLY = opt('--only', null);
const LIMIT = +opt('--limit', DIFF || ONLY ? Infinity : 60);
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
/* ── RESUME + STREAM ─────────────────────────────────────────────────────────────────────────
   `--resume`   pick up from the journal, quarantining any mutant that started and never finished.
                The journal's scope header must match this invocation field-for-field, or the run
                refuses (fail-closed) rather than misattributing verdicts.
   `--journal`  path override; `--no-journal` disables recording entirely
   `--quiet-stream` suppress the per-mutant line (the aggregate progress line still prints)
   `--quarantine-timeout <ms>`  SIGKILL a mutant whose suite run goes silent for this long (default
                300000, 0 disables); journaled QUARANTINED, excluded from the kill rate
   `--verdict`  print the TOOL-BUILD-STANDARD section 2.13 compliance manifest as JSON on stdout */
const RESUME = has('--resume');
const INCREMENTAL = has('--incremental');
const JOURNAL = has('--no-journal') ? false : opt('--journal', null);
const STREAM = !has('--quiet-stream');
/* `--quarantine-timeout <ms>` — the no-progress watchdog (default 300000). A mutant whose suite run
   emits no stdout for this long is SIGKILLed and journaled QUARANTINED, and the sweep moves on.
   Elapsed-time timeouts cannot tell a slow box from a jammed mutant; silence can: a healthy suite
   streams group results continuously, while a wedged one goes quiet. 0 disables it (the elapsed
   timeout still bounds the run). Pooled path only; --jobs 1 keeps the sync runner's elapsed timeout. */
const QUARANTINE_MS = +opt('--quarantine-timeout', '300000');
/* `--verdict` — print the TOOL-BUILD-STANDARD section 2.13 machine-readable compliance manifest as
   JSON on stdout after the run. */
const WANT_VERDICT = has('--verdict');
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
/* MEMORY IS THE SECOND DIMENSION, and it was the missing one. The core-derived figure above sizes a
   CPU-bound pool; each worker here is a FULL node test suite, so the pool is memory-bound in practice
   and the two can disagree badly. Measured 2026-09-14 on the 24-core box (`tepna-nightly-triage`
   driving this tool at the core-derived 16): the unit's own cgroup reported a MemoryPeak of
   **16.57 GB** for those 16 workers — **~1.04 GB per job end-to-end**.
   ⚠️ **`MemoryPeak` IS A CGROUP FIGURE AND IS NOT THE WORKERS' MEMORY** (residue
   `2026-09-23-memorypeak-is-a-cgroup-figure`): it charges reclaimable page cache to the unit, so it
   over-reads a process's own footprint by an amount that is not a ratio — measured on vigil over 2 038
   samples, cgroup-peak ÷ VmHWM ran **0.78x to 8.41x across six segments of one daemon**. So 16.57 GB
   is an UPPER BOUND on what those 16 workers needed, and the per-job figure below inherits that: it
   sizes a POOL conservatively (the direction that only ever shrinks it) and must never be quoted as a
   per-process number or used to set a `MemoryMax` — §4c's cap goes on the consumer, sized from VmHWM.
   The honest per-process figure is still unmeasured here and the residue row stays open for it.
   ⚠️ And do NOT reach for a `ps` snapshot as the alternative: the same 16 workers totalled 7.88 GB
   (mean 504 MB, median 499, p90 749, max 1038) — less than half the cgroup peak, because workers spike
   at different moments and an instantaneous sum never sees the overlap. Both instruments are wrong in
   known directions; this one is wrong in the safe one.
   The consequence on a small machine is the one that matters: 16 workers × ~1 GB is fine on a 59 GB
   box with nothing else running and fatal on a CI runner or a laptop, and nothing in the core-derived
   form can tell those apart. */
const JOB_BYTES = 1024 * 1024 * 1024; // ~1.04 GB measured, rounded down to 1 GiB
/* Leave headroom rather than spending all of MemAvailable: this tool routinely runs BESIDE other
   sessions' gates, and the 2026-09-13 incident was a pool sized to 72 % of available memory on a box
   that was already committed elsewhere. 60 % is deliberately not tuned to a benchmark — it is the
   share that leaves the rest of the machine usable. */
const JOB_MEM_SHARE = 0.6;
/* `availBytes` is OPTIONAL and the one-argument form is unchanged by construction: unknown memory
   (a non-Linux host, an unreadable /proc) returns exactly what it returned before, so this can only
   LOWER a job count on a machine that told us it is short, never raise one or change a platform that
   cannot answer. */
export function defaultJobs(cores, availBytes) {
  if (!(cores > 0)) return 1; // cpus() can report an empty list in constrained containers
  if (cores <= 2) return 1; // serial: no worktrees, no extra disk, no oversubscription
  const byCores = Math.max(2, Math.round((cores * 2) / 3));
  if (!(availBytes > 0)) return byCores; // memory unknown → the historical behaviour, unchanged
  const byMem = Math.floor((availBytes * JOB_MEM_SHARE) / JOB_BYTES);
  /* Too little memory to run even two workers takes the SERIAL path, for the same reason a 1-2 core
     box does: a split that cannot fit buys nothing and costs a worktree apiece. Symmetric with the
     low-core rule directly above rather than a second, differently-shaped floor. */
  if (byMem < 2) return 1;
  return Math.min(byCores, byMem);
}
/* MemAvailable, not MemFree — free memory excludes reclaimable page cache and would read a healthy
   box as empty. This is the same signal `tepna-nightly-triage.sh`'s own pressure guard reads, so the
   two agree about what "short" means. Returns null off Linux or if anything is unreadable; never
   throws, because failing to size is not a reason to fail to run. */
export function memAvailableBytes(readFile) {
  try {
    const txt = (readFile || readFileSync)('/proc/meminfo', 'utf8');
    const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(txt);
    return m ? +m[1] * 1024 : null;
  } catch {
    return null;
  }
}
const JOBS = Math.max(1, +opt('--jobs', String(defaultJobs(cpus().length, memAvailableBytes()))));

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
import { buildIdentity, resolveMapPath, verifyFor } from './mutation-map.mjs'; // map location + staleness

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
      for (let m = re.exec(L); m !== null; m = re.exec(L)) {
        if (!isCode(m.index, m[0].length)) continue; // inside a comment or a string literal
        const mutatedLine = L.slice(0, m.index) + m[0].replace(new RegExp(op.re.source), op.to) + L.slice(m.index + m[0].length);
        if (mutatedLine === L) continue;
        out.push({
          line: i + 1,
          op: op.name,
          /* `before`/`after` are DISPLAY fields and always have been — 100 chars is a terminal width,
             not a record. The executable mutation is `apply()` below, which serialisation drops.
             `mutated` is that same line UNTRUNCATED, because a consumer that must re-apply a mutant
             from JSON had nothing else to read: `probe-equivalence` rebuilt the line from `after`
             and, on every source line past 100 chars, wrote back a line cut mid-expression.
             Measured 2026-08-09 on hrvdex-dsp.js — 42 of 217 probed mutants came back "the mutant
             does not parse", which was a property of the READER, not of the mutant.
             `before`/`after` keep their truncated shape deliberately: they are the
             `(line, op, before)` key `findCanary` and `tools/mutate-equivalence.json` match on, and
             widening them would orphan every entry already recorded. */
          before: L.trim().slice(0, 100),
          after: mutatedLine.trim().slice(0, 100),
          mutated: mutatedLine,
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
/* ── SURVIVORS-ONLY RE-TESTING (MUTATION-ACCOUNTING-LOOP §E4b) ──────────────────────────────────
   §E4 closed the "skipped forever" hole by re-SWEEPING a file whose `testsHash` moved. That is
   correct and it overpays: measured on `hrvdex-dsp.js`, the re-sweep tested 490 mutants to learn
   about 171, and all 8 that moved were survivors by construction — a mutant already killed by the
   old suite cannot become a survivor under a better one.

   So `--only <list.json>` re-tests a RECORDED mutant list. The list is exactly what a sweep already
   writes: `<file>.sweep.json`'s `survivors`, each `{ line, op, before, after }`.

   🔴 IT REFUSES RATHER THAN GUESSING, and the reason is documented three screens up at `findCanary`.
   The natural key `line \0 op \0 before` IS NOT UNIQUE — `pulsedex-dsp.js:197` carries two `num → 0`
   mutants with identical `before` text, and in 2026-08-25 a drafted assertion fused one mutant's
   input with the OTHER's output and reached `main`. `after` disambiguates that pair and, unlike an
   index, does not shift when code above it is edited. Where even the 4-field key is ambiguous, or an
   entry matches nothing at all, this REFUSES THE WHOLE RUN:

     · a partial re-test reports fewer kills than a full one over the same set, and nothing in the
       output distinguishes "these mutants survived" from "those mutants were never tested" — the
       examined-nothing shape, arriving as a silently smaller denominator;
     · an entry matching nothing means the SOURCE moved, so the recorded list no longer describes the
       file and the caller should sweep cold instead — which is exactly what §E4's `crawlPlan` already
       decides when `srcHash` moves.

   Refusal over guessing, per `findCanary`'s own contract: a miss is reported, never resolved to the
   first match. */
export function selectRecorded(all, wanted) {
  const key = (m) => m.line + '\u0000' + m.op + '\u0000' + m.before + '\u0000' + m.after;
  const byKey = new Map();
  for (const m of all) {
    const k = key(m);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(m);
  }
  const picked = [];
  const missing = [];
  const ambiguous = [];
  const seen = new Set();
  for (const w of wanted) {
    if (!w || typeof w.line !== 'number' || typeof w.op !== 'string') {
      missing.push({ ...w, why: 'malformed entry (needs line, op, before, after)' });
      continue;
    }
    const k = key(w);
    const hits = byKey.get(k) || [];
    if (hits.length === 0) {
      missing.push({ line: w.line, op: w.op, why: 'no mutant with this line/op/before/after exists in the current source' });
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push({ line: w.line, op: w.op, n: hits.length, why: 'the 4-field key matches ' + hits.length + ' mutants — even `after` cannot separate them' });
      continue;
    }
    if (seen.has(k)) continue; // a duplicate entry in the list is not a second mutant
    seen.add(k);
    picked.push(hits[0]);
  }
  return { picked, missing, ambiguous, ok: missing.length === 0 && ambiguous.length === 0 };
}

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
/* The honest denominator: mutants that were actually measured. INVALID never ran and QUARANTINED
   never completed, so both are excluded — a rate over either would be a number about nothing.
   Pure and exported so --selftest pins it. */
export function measuredDenominator(r) {
  return r.tested - r.invalid - (r.quarantined || 0);
}
/* A quarantine is not a verdict — it is the harness saying "this mutant wedged me". One is a bad
   mutant; many is a sick suite or a loaded box, and the reader cannot tell which without being told
   the count. Pure and exported so --selftest pins it. */
export function quarantineWarning(q, tested, quarantineMs) {
  if (!(q > 0)) return null;
  return (
    '\n  \u26a0 ' +
    q +
    ' of ' +
    tested +
    ' mutant(s) QUARANTINED \u2014 no suite output for ' +
    Math.round(quarantineMs / 1000) +
    's, SIGKILLed, journaled.\n' +
    '    A couple is a jammed mutant; many is a sick suite or a box under load. They are listed in\n' +
    '    `quarantinedMu` and excluded from the kill rate \u2014 unmeasured, not survived.\n'
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
    if (!set) {
      set = new Set();
      out.set(path, set);
    }
    for (let i = 0; i < count; i++) set.add(start + i);
  }
  return out;
}

/* WHAT THIS FILE WILL COST, as one line. Pure, so the selftest pins it: every figure comes from the
   caller's own calibration run and job count, and nothing here reads a clock.

   MEASURED 2026-10-19 over #3506's own population (`oxydex-dsp.js` + `oxydex-render.js`, 89 changed
   lines, 27 mutants, 4 jobs, rig): calibration 82 s, the per-mutant loop 557 s, the worker pool 0 s,
   everything else ~10 s of a 658 s run. The loop therefore spends 85 % of the budget, and `mutants ×
   calibration / jobs` — the `est` figure this line prints — read 553 s against those 557 s.

   ⚠️ IT IS AN UPPER BOUND, NOT A PREDICTION. Bail returns a killed mutant before its selected groups
   finish, so the estimate over-reads whenever few mutants run: measured the same day at `--limit 1`,
   est 22 s against 7.0 s. It tightens as the population grows, and the agreement at 27 mutants is
   that bound being nearly tight, never a law. Quote it as a ceiling against the job's cap. That is
   the per-pass timing residue `2026-10-05-the-js-mutation-job-cannot-finish-on-the-pr-that-makes-its-own-target-fast`
   asked for, and residue `2026-10-12-the-js-mutation-timeout-is-wider-than-the-self-speeding-pr`
   widened to a class. */
export function phaseNote({ file, baseMs, estMs, jobs }) {
  const s = (ms) => (Number(ms) / 1000).toFixed(Number(ms) < 10000 ? 1 : 0);
  return '  ' + file + '  calibration ' + s(baseMs) + ' s/run → per-mutant pass est ' + s(estMs) + ' s at ' + jobs + ' job(s)';
}

export function verdictFromOutput(out) {
  return String(out).includes('✓') || String(out).includes('✕') ? 'KILLED' : 'INVALID';
}

/* ── COVERAGE-DIRECTED TEST SELECTION ────────────────────────────────────────────────────────
   A mutant on line N can only be killed by a group that EXECUTES line N. The tag filter already
   narrows 470 groups to one module's worth; the per-group coverage map narrows it to the groups
   that actually touch the line. Measured 2026-08-14 on the real map: a median of 6 groups for
   integrator-dsp (78×), 9 for hrvdex (52×), 30 for ppgdex (16×) — MUTATION-PROGRAM-FOLLOWUPS §6
   estimated 10–100× and the estimate holds.
     Build the map with `node tools/per-group-coverage.mjs`. Standard technique; the Python lane
   gets it from mutmut for free, which is part of why it kills 74.6 % to this fleet's ~46 %.
     Petrović, G. & Ivanković, M. (2018). "State of Mutation Testing at Google."
     ICSE-SEIP '18, pp. 163–171. doi:10.1145/3183519.3183521

   🔴 IT MUST NEVER NARROW TO ZERO. An empty index list would run NO group, and a run with no
   assertions fails nothing — so every mutant would report SURVIVED. That is not a slow gate, it is
   a sweep that fabricates findings, and it would look like a spectacular speedup while doing it.
   Every failure path here therefore returns null and the caller falls back to the tag filter:
   no map, unreadable map, file absent from the map, line attributable to nothing. Selecting too
   many groups costs time; selecting none costs the measurement. */
/* ── AND IT MUST NEVER APPLY A MAP BUILT FOR DIFFERENT LINE NUMBERS ────────────────────────────
   The paragraph above is about narrowing to ZERO. There is a second route to the same fabricated
   SURVIVED, and it is quieter: a map that is present, well-formed, and STALE. Selection is keyed on
   line numbers, and lines move for reasons as small as a comment — #1422 inserted 16 comment lines
   into oxydex-dsp.js and shifted everything below line 1023. Applied after that, the map returns the
   groups that used to cover a line, the mutant runs tests that never execute it, and it survives.

   So the map is now STAMPED with the hash of every source it maps plus `tests/dex-tests.js` (group
   INDICES shift when a group is inserted, which no source hash would catch), and it is verified PER
   FILE — one moved DSP must not discard selection for the other seven. Unstamped maps (everything
   built before this) are refused: they may be perfectly good, and there is no way to tell.
   Every refusal falls back to the tag filter, loudly. Slow is a cost; wrong is a lie. */
const PGMAP_PATH = opt('--per-group-map', null) || resolveMapPath(ROOT);
const PGMAP_RAW = (() => {
  if (!PGMAP_PATH || !existsSync(PGMAP_PATH)) return null;
  try {
    const m = JSON.parse(readFileSync(PGMAP_PATH, 'utf8'));
    return m && Array.isArray(m.groups) && m.groups.length ? m : null;
  } catch {
    return null;
  }
})();

/* Verified PER FILE and memoised, because `--file` is repeatable and the answer differs per file:
   one moved DSP must not discard selection for the other seven. Announced once per file so a run's
   log states plainly whether it took the fast path — a speedup you cannot confirm from the output is
   a speedup you will eventually mistake for a correct one. */
const _pgSeen = new Map();
function pgmapFor(file) {
  if (!PGMAP_RAW) return null;
  /* ⚠️ SELECTION IS OPT-IN (--use-coverage-map), QUARANTINE RE-CONFIRMED 2026-08-19 with the
     interval-coverage collector — better collection did NOT make per-line selection sound. Measured
     on hrvdex, paired sweeps: 7 of 38 tag-kills became survivors under selection. Mechanisms, each
     proven separately:
       · lines whose execution depends on STATE built by earlier groups (801, 869: absent from the
         killing group's SOLO interval, present when the tag set runs together);
       · LOAD-executed lines (158/174/487/537/1319: never in any group interval by design — the
         baseline discard — yet their mutants change load state and die under tag);
       · integrity/audit interactions (fixed separately via tests/expected-skips.json, and the
         fabricated 22/22 "kills" they produced are why every number here was re-measured).
     The sound design is UNION-WITH-TAG (a superset of the tag set can never lose a tag kill) plus
     the vetted zeros — not yet built. Until it is, the map stays a diagnostic, not a filter. */
  if (!process.argv.includes('--use-coverage-map')) {
    if (!_pgSeen.has('__warned')) {
      process.stderr.write('  ℹ coverage map present but NOT applied (selection is opt-in: --use-coverage-map) — see the §3 quarantine note in pgmapFor\n');
      _pgSeen.set('__warned', true);
    }
    return null;
  }
  const key = basename(file);
  if (_pgSeen.has(key)) return _pgSeen.get(key);
  const v = verifyFor(PGMAP_RAW, key, buildIdentity(ROOT, [key]));
  if (!v.ok) process.stderr.write('  ⚠ COVERAGE MAP NOT APPLIED to ' + key + ' — ' + v.reason + '\n    falling back to the tag filter: slower, never wrong.\n');
  else process.stderr.write('  ✓ coverage map applied to ' + key + ' — ' + v.reason + '\n');
  const res = v.ok ? PGMAP_RAW : null;
  _pgSeen.set(key, res);
  return res;
}

/* THE UNION of every group that touches ANY line of `file` — the widest run per-mutant selection can
   produce, and therefore what the TIMEOUT must be sized on.

   The old calibration timed one clean run of the TAG-filtered set and set `timeout = baseMs × 5`.
   That was right when mutants ran that same set. They no longer do, and it is wrong in BOTH
   directions now:
     · too LOOSE for the common case — measured on integrator, calibration was 312 s of a 339 s
       8-mutant run while the mutants themselves cost ~25 s. Calibration became ~90 % of a small
       sweep, and it was measuring a group set nobody runs.
     · too TIGHT in principle — selection is NOT a subset of the tag filter. 17 groups execute
       ppgdex-dsp.js lines without carrying its tag (4 for integrator), because an integration test
       reaches across nodes. Those groups are a REASON to prefer selection (the tag filter can miss a
       real killer) but they mean a selected run can exceed the tag-filtered one it was sized against.
   Calibrating on the union fixes both: it bounds every non-baseline selection, and it is the set the
   sweep actually runs. Baseline lines still fall back to the tag filter, which is narrower. */
export function calibrationIndices(map, file) {
  if (!map || !Array.isArray(map.groups) || !map.groups.length) return null;
  const out = [];
  for (const g of map.groups) {
    if (g.unknown || (g.files && g.files[file])) out.push(g.index);
  }
  return out.length ? out : null;
}

/* Groups proven red in THIS RUN'S OWN ENVIRONMENT without any mutant — excluded from the
   always-selected zero set. See zeroBaselineExcludes; empty until that baseline runs. */
const SELECTION_EXCLUDE = new Set();

/**
 * THE ENVIRONMENT-MATCHED BASELINE (§3d). Widening selection to the zero-attribution groups
 * converted 22 hrvdex survivors into "kills" in one run — every one attributed to the same two
 * repo-inspection groups ("Demo-inputs git-tracked", "Fixture verification"), which red inside the
 * hard-linked worker trees (no `.git`) for reasons no mutant caused. The tag filter had simply
 * never run them, so the tag legs looked clean by omission.
 *
 * The calibration run could not catch this: it runs in ROOT, where those groups pass. A group is
 * only excludable by failing a CLEAN run in the SAME environment the mutants will run in — so this
 * runs the zero set once in worker 0 (or ROOT on the serial path, where it will find nothing, which
 * is correct: there the groups pass for real). Excluded groups are REPORTED, loudly and in the JSON:
 * an exclusion nobody can see is how a real kill goes missing next.
 */
export function parseZeroBaseline(jsonText) {
  try {
    const j = JSON.parse(jsonText);
    const red = (j.groups || []).filter((g) => (g.tests || []).some((t) => t && !t.pass && !t.skip));
    return { red: red.map((g) => ({ index: g.index, title: g.title })), parsed: true };
  } catch {
    return { red: [], parsed: false };
  }
}

function runZeroSet(zeroIdx, cwd, timeoutMs) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [join(ROOT, 'tests/run-tests.mjs'), '--group-index=' + zeroIdx.join(','), '--json'], {
      cwd,
      timeout: timeoutMs || 300000,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    });
  } catch (e) {
    out = String((e && e.stdout) || '');
  }
  return parseZeroBaseline(out);
}

function zeroBaselineExcludes(zeroIdx, cwd, timeoutMs, targetRel) {
  if (!zeroIdx.length) return [];

  /* PHASE 1 — clean run in the worker environment: catches groups red for ENVIRONMENT reasons. */
  const clean = runZeroSet(zeroIdx, cwd, timeoutMs);
  if (!clean.parsed) {
    /* An unreadable baseline must FAIL CLOSED into the old behaviour: no widening at all beats
       widening with unvetted groups — 22 fabricated kills measured says so. */
    process.stderr.write('  ⚠ zero-set baseline unparseable — zero-attribution groups will NOT be auto-selected this run\n');
    return null;
  }

  /* PHASE 2 — THE COMMENT-ONLY PROBE: catches CHANGE-DETECTOR groups. The 22 fabricated hrvdex
     kills came from two groups that PASS the clean baseline and red on ANY byte change to a source
     file — fixture/GATE-B-class integrity checks that hash the inputs. They would "kill" every
     mutant of every file identically, which is a fact about the LEDGER, not about test quality, and
     it would mask every genuine survivor. A comment appended to the target changes zero behaviour,
     so any group that reds on it is asserting INTEGRITY, not behaviour — excluded, loudly.
     (Unlink before writing — the worker file is a hard link to the real source.) */
  let probeRed = { red: [], parsed: true };
  if (targetRel) {
    const wf = join(cwd, targetRel);
    try {
      const orig = readFileSync(wf, 'utf8');
      rmSync(wf, { force: true });
      writeFileSync(wf, orig + '\n// mutation-harness integrity probe (comment-only; removed after one run)\n');
      probeRed = runZeroSet(zeroIdx, cwd, timeoutMs);
      rmSync(wf, { force: true });
      writeFileSync(wf, orig);
      if (!probeRed.parsed) {
        process.stderr.write('  ⚠ integrity-probe run unparseable — zero-attribution groups will NOT be auto-selected this run\n');
        return null;
      }
    } catch (e) {
      process.stderr.write('  ⚠ integrity probe failed (' + String((e && e.message) || e).slice(0, 60) + ') — zero-attribution groups will NOT be auto-selected this run\n');
      return null;
    }
  }

  const seen = new Map();
  for (const g of clean.red) seen.set(g.index, { ...g, why: 'red in the worker environment without any change' });
  for (const g of probeRed.red) if (!seen.has(g.index)) seen.set(g.index, { ...g, why: 'red on a COMMENT-ONLY change — an integrity check, not a behaviour test' });
  const red = [...seen.values()];
  for (const g of red) SELECTION_EXCLUDE.add(g.index);
  if (red.length) {
    process.stderr.write('  ⚠ ' + red.length + ' zero-attribution group(s) excluded from selection — red without any behavioural change:\n');
    for (const g of red.slice(0, 6)) process.stderr.write('      #' + g.index + ' ' + String(g.title).slice(0, 66) + ' — ' + g.why + '\n');
  }
  return red;
}

export function selectIndices(map, file, line) {
  if (!map || !Array.isArray(map.groups) || !map.groups.length) return null;
  if (!Number.isFinite(line)) return null;
  /* SELECTION MAY ONLY NARROW, NEVER WIDEN — and a module-LOAD line is where it would widen.
     `tests/run-tests.mjs` loads every DSP before any group runs, so a line executed at load time is
     touched by all 470 groups and per-group-coverage.mjs's own consumer correctly answers "all of
     them". Handing that back here would run the WHOLE suite for one mutant, against a timeout
     calibrated on the narrow tag-filtered run (baseMs × 5, where baseMs is ~16 s for hrvdex) — so
     the run is killed and the mutant is scored INVALID: never tested, and silently absent from both
     the killed and the survivor count.
       Measured 2026-08-14 by A/B on hrvdex-dsp.js at --limit 24: identical survivor sets, but
     `killed` went 14 → 13 and one INVALID appeared at L47, a load-time line.
       Returning null hands the caller back to the tag filter, which is exactly today's behaviour
     for that mutant. So the worst case of this whole mechanism is "no change", never "wider". */
  const base = map.baseline && map.baseline[file];
  if (Array.isArray(base) && base.includes(line)) return null;

  const out = [];
  for (const g of map.groups) {
    if (g.unknown) {
      out.push(g.index);
      continue;
    }
    const ls = g.files && g.files[file];
    if (Array.isArray(ls) && ls.includes(line)) {
      out.push(g.index);
      continue;
    }
    /* ⚠️ ZERO-ATTRIBUTION GROUPS ARE ALWAYS SELECTED — §3's three residual manufactured blinds were
       all THIS: groups that kill by REGEX-TESTING THE SOURCE TEXT (`env.sources[...]` assertions),
       which execute zero DSP lines by construction, so no coverage collector can ever attribute
       them. Skipping them converted three real, textual kills into survivors. The price was measured
       before this was written, not assumed: all 189 zero-attribution groups together cost ~3.5 s —
       they ARE the cheap textual/ledger checks — so safe selection lands at ~2 % of the full suite
       and the old "the safe map is slower than the tag filter" arithmetic no longer holds. */
    const touchesAnything = g.files && Object.keys(g.files).length > 0;
    if (!touchesAnything && !SELECTION_EXCLUDE.has(g.index)) out.push(g.index);
  }
  return out.length ? out : null; // never an empty selection — see the note above
}
/* `filter` is polymorphic: an ARRAY of declaration indices (coverage-directed selection) or a
   STRING tag filter (the pre-existing behaviour). Kept as one parameter so the four call sites and
   the journal/verdict paths are untouched. An empty array can never arrive — selectIndices returns
   null instead, and null means "no filter", i.e. run everything. */
export function suiteArgs(filter) {
  if (Array.isArray(filter) && filter.length) return ['tests/run-tests.mjs', '--group-index=' + filter.join(',')];
  if (typeof filter === 'string' && filter) return ['tests/run-tests.mjs', '--group=' + filter];
  return ['tests/run-tests.mjs'];
}
function runSuiteAsync(filter, cwd, timeoutMs, quarantineMs) {
  return new Promise((resolve) => {
    /* DEX_BAIL stops the suite at the first FAILING group. Measured on a real clock.js mutant:
       289 s → 2 s, same exit code, same killers. It only ever shortens a run that is already red, so
       it cannot turn a survivor into a kill — a survivor makes nothing fail, so nothing bails and it
       still pays the full suite. What it costs is the BREADTH of killer attribution: a mutant caught
       by several groups now reports only the first. That is why it is opt-in, and why the whole-file
       surveys that exist to measure `killers` should run without it. */
    const ch = spawn('node', suiteArgs(filter), {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs || 900000,
      env: BAIL ? { ...process.env, DEX_BAIL: '1' } : process.env
    });
    let out = '';
    /* The promise settles exactly once: the no-progress watchdog and the close handler race, and
       whichever fires first wins. Without the guard a SIGKILLed child whose 'close' arrives late
       would resolve twice — the second resolution is silently dropped by the Promise, but the
       explicit guard makes the single settlement visible rather than relied-upon. */
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (watch) clearInterval(watch);
      resolve(v);
    };
    /* ── THE NO-PROGRESS WATCHDOG ──
       Elapsed-time timeouts cannot tell a slow box from a jammed mutant: both look like "too long".
       Silence can. A healthy suite streams group results to stdout continuously; a mutant that wedges
       the suite (an infinite loop, a deadlock) goes quiet. When no stdout has arrived for
       `quarantineMs`, the child is SIGKILLed and the mutant is journaled QUARANTINED — and the sweep
       moves on instead of stalling a worker for the rest of the elapsed timeout. This is the
       in-process half of quarantine; the journal half (started-twice-never-finished) still applies
       on --resume for anything the watchdog could not see. */
    let lastOut = Date.now();
    const qms = quarantineMs == null ? QUARANTINE_MS : quarantineMs;
    let watch = null;
    if (qms > 0) {
      /* Check often enough to be prompt, seldom enough to be cheap; unref'd so the timer alone
         never keeps the event loop alive. */
      const step = Math.min(15000, Math.max(1000, qms));
      watch = setInterval(() => {
        if (settled) return;
        if (Date.now() - lastOut >= qms) {
          /* SIGKILL, not SIGTERM: a wedged suite can ignore TERM, and KILL cannot be caught. The
             stdout pipe is destroyed too — a grandchild holding it open would otherwise keep
             'close' pending forever, which is one of the shapes the ECG stalls took. */
          try {
            ch.kill('SIGKILL');
          } catch (_) {
            /* already gone */
          }
          try {
            ch.stdout.destroy();
          } catch (_) {
            /* already gone */
          }
          finish({ verdict: 'QUARANTINED', killers: [], reason: 'no-progress' });
        }
      }, step);
      if (watch.unref) watch.unref();
    }
    ch.stdout.on('data', (d) => {
      out += d;
      lastOut = Date.now();
    });
    ch.on('error', () => finish({ verdict: 'INVALID', killers: [] }));
    ch.on('close', (code, signal) => {
      if (code === 0) return finish({ verdict: 'SURVIVED', killers: [] });
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
      /* A NON-ZERO EXIT IS NOT AUTOMATICALLY A KILL. `/^\\d{10,0}$/` is a syntactically invalid regex:
         the file cannot be parsed, node exits 2, and the old classifier scored that as KILLED —
         indistinguishable from a mutant a test actually caught. Every kill rate this tool has ever
         reported was inflated by however many mutants produce unparseable code, systematically and in
         the flattering direction.

         The discriminator is that a mutant killed by a TEST leaves assertion output behind, while one
         that never loaded leaves none. So: non-zero exit AND no assertion activity at all ⇒ the code
         did not run ⇒ INVALID, which `tested − invalid` already excludes from the denominator.
         Deliberately conservative — it only reclassifies runs that produced ZERO assertions, so a
         mutant that merely makes a group throw still counts as killed. */
      if (verdictFromOutput(out) === 'INVALID') return finish({ verdict: 'INVALID', killers: [], reason });
      const seen = new Set();
      KILLER_RE.lastIndex = 0;
      for (let m = KILLER_RE.exec(out); m !== null; m = KILLER_RE.exec(out)) seen.add(m[1]);
      finish({ verdict: 'KILLED', killers: Array.from(seen) });
    });
  });
}

/* THE WORKER POOL IS CREATED ONCE PER PROCESS, not once per file.
   The first version built it inside runFile(), which was fine for a single module and catastrophic
   for a sweep: `git worktree add` checks out the WHOLE tree — 71 MB here — so 12 workers × 71 files
   is 852 full checkouts, ~850 MB copied per file. Measured on this external volume: one file took
   ~12 minutes, projecting to ~14 h for the roster, and essentially all of it was checkout I/O rather
   than test execution. Hoisted, the same sweep pays for 12 checkouts total. */
/* A WORKER MUST TEST *YOUR TREE*, NOT YOUR LAST COMMIT — now true BY CONSTRUCTION.
   `git worktree add --detach HEAD` checked out the COMMITTED state, so every uncommitted change —
   the tests you just wrote, the fix you are validating — was invisible to the run. It failed in the
   worst possible way: silently, with a plausible number, about the wrong code. It cost a 79-minute
   exhaustive `clock.js` run that reported seven mutants as SURVIVORS which had already been verified
   killed by hand, because the workers were running the pre-fix suite.
   A `syncDirty()` helper used to mirror the dirty files in afterwards. It is GONE and must not come
   back: the workers are hard links to the working files themselves, so uncommitted state is present
   with nothing to synchronise and no window in which the two can disagree. */

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
  /* ── HARD LINKS, NOT `git worktree add` (2026-08-13) ──────────────────────────────────────────
     `git worktree add` per worker was a full checkout — minutes of I/O before a single mutant ran —
     and on this ntfs3 volume it DEADLOCKED: measured 2026-08-12, one `git worktree add` sat in
     uninterruptible D state for 1 h 33 m and took the whole sweep with it. D state cannot be killed.
     `cp -al` creates directory entries pointing at the SAME inodes, so a worker costs milliseconds
     and no data movement. `killcheck.mjs` and `extreme-mutate.mjs` have always built their workers
     this way and neither has ever wedged; this file was the odd one out.
     Two consequences, both improvements:
       · the caller's UNCOMMITTED changes are present BY CONSTRUCTION, because the links point at the
         working files — `syncDirty` existed only to paper over `--detach HEAD` checking out the
         COMMITTED state, and is now unnecessary.
       · `.git` is excluded, so a group that shells out to git degrades to a SKIP rather than a false
         verdict (`readTrackedFiles` already returns null and skips on a missing git).
     ⚠ UNLINK BEFORE WRITING a mutant into a worker — a hard link shares the inode with the repo, so
     writing through it would edit the source under test. See the write path below. */
  const _poolT0 = Date.now();
  const _entries = readdirSync(ROOT)
    .filter((e) => !['.git', 'node_modules', 'coverage', '.nyc_output'].includes(e))
    .map((e) => join(ROOT, e));
  process.stderr.write('  building worker pool: ' + JOBS + ' hard-linked tree(s) — seconds, not minutes\n');
  for (let w = 0; w < JOBS; w++) {
    const dir = join(ROOT, '..', '.mutate-w' + w + '-' + process.pid);
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      execFileSync('cp', ['-al', '--', ..._entries, dir], { stdio: 'ignore' });
      try {
        symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
      } catch (_) {
        /* absent node_modules is fine — the suite has no runtime deps */
      }
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
  /* Plain rmSync now the workers are hard links, not registered worktrees — removing a link never
     touches the inode's other name, so the repo's own files are untouched by construction. This also
     removes the last `git worktree` call from the hot path, which is the point (see workerPool). */
  for (const d of _pool || []) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  _pool = null;
}

function runSuite(filter, cwd, timeoutMs) {
  try {
    /* suiteArgs, NOT a hand-built '--group=' — this runner takes the same polymorphic selector as
       runSuiteAsync. Fixing only the async one shipped a live defect: an ARRAY stringifies to
       `--group=44,45,46`, which the matcher reads as three TITLE substrings and resolves to ONE
       unrelated group. Calibration therefore timed a 12-assertion run instead of the intended 62
       groups, `timeoutMs = max(30000, baseMs*5)` collapsed to the 30 s floor, and every mutant on a
       slow file was killed by the timeout and scored INVALID — never tested, and absent from both
       the killed and survivor counts. Measured 2026-08-14 on the full sweep: ecgdex 1324 of 1809
       INVALID (73 %) with `canary: FAILED`, integrator 178 (9.7 %), against ~1 % on the two files
       whose groups fit inside 30 s. The canary voided ecgdex rather than publishing the number. */
    execFileSync('node', suiteArgs(filter), { cwd: cwd || ROOT, encoding: 'utf8', timeout: timeoutMs || 900000 });
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
/* THE EQUIVALENCE CLASSIFICATION (MUTATION-EQUIVALENCE §5/§6.1).
   A surviving mutant is not automatically a test gap. `if (lo < 0) lo = 0` mutated to `<=` still
   assigns 0 when lo IS 0 -- no input distinguishes them, and none ever will. Counting those against a
   `killed / tested` denominator makes the target unreachable by arithmetic and buries the real gaps
   among the noise: on clock.js the brief measured 12 of 15 survivors in one cluster as equivalent.

   Until now that classification was PROSE in a brief. This reads it as DATA
   (`tools/mutate-equivalence.json`) so a run can report `killed / distinguishable` -- and, critically,
   so the next sweep does not re-litigate survivors someone has already probed.

   THE HEADER OF THIS FILE SET THE CONSTRAINT, AND IT IS HONOURED HERE: "prefer arguing with the gate
   occasionally over a gate that silently excuses whatever it cannot kill." So this is NOT an allowlist
   that quietly shrinks a denominator. Three things are reported loudly:

     - REFUTED: an entry claims equivalence and that mutant was KILLED. The classification is WRONG; a
       distinguishing input exists after all. This is the failure mode that would let a stale file hide
       a real gap, so it is surfaced as an error rather than absorbed.
     - ORPHANED: an entry matches no generated mutant (line moved, code changed). Excluded from every
       count until re-verified, so a stale entry can never shrink anything.
     - UNCLASSIFIED: survivors with no entry, counted and named. Silence is never equivalence.

   Only `no-distinguishing-input` and `untestable-by-design` leave the denominator. `real-gap` stays in
   it: those are debt, and a classification file is not a place to launder debt into a better number. */
const EQUIV_FILE = join(ROOT, 'tools', 'mutate-equivalence.json');
export function loadEquivalence() {
  try {
    const raw = JSON.parse(readFileSync(EQUIV_FILE, 'utf8'));
    delete raw._README;
    return raw;
  } catch {
    return {};
  }
}
// The classes that genuinely cannot be killed, and therefore leave the distinguishable denominator.
//
// `equivalent` belongs here and was MISSING until 2026-09-07, which inverted the ledger's own
// hierarchy: it is the STRONGEST claim in the vocabulary — a proof that original and mutant compute
// the same function, stronger than `no-distinguishing-input`'s "every input we tried agreed" — and
// it was the one class that did not excuse. Two consequences, both silent: such an entry stayed in
// the distinguishable denominator, and, being neither excusing nor `real-gap`, it fell to the `else`
// below and was reported AS a real gap — an instruction to write a test for a mutant carrying a
// proof that no such test exists. The 2026-08-19 pass that UPGRADED entries from
// `no-distinguishing-input` to `equivalent` with their proofs therefore made them weaker in effect;
// strengthening the evidence silently downgraded the classification.
const EXCUSING = new Set(['no-distinguishing-input', 'untestable-by-design', 'equivalent']);
/* PURE, so the selftest can pin it without a sweep. ⚠️ This comment USED to say entries match on
   (line, op, before) with `after` as documentation. The code has never done that: `survivorKey`
   carries `after`, and `classifySurvivors` says why — line+op+before collapses two same-operator
   mutants on one line into one entry. Corrected 2026-10-20; the matching rule lives at
   `survivorKey`, which is the only place that should state it. */
/* ── readJournal — the resume decision, PURE so it is known-answer testable ───────────────────
   Returns { done, jammed }:
     done   Map(key -> record)   every mutant that reached a verdict, with its fingerprints
     jammed [key]                every mutant that STARTED and never finished

   A start with no verdict can only mean the process died while that mutant was in flight — the
   signature of a mutant that JAMS the harness (an infinite loop the timeout should have caught and
   occasionally does not; it has happened on this fleet). Those are QUARANTINED on resume rather than
   retried, because retrying is what turns one jam into an infinite loop across restarts.

   A TORN FINAL LINE IS DISCARDED, not fatal: the process may have been killed mid-write, and half a
   record must not cost the thirteen hours in front of it. */
/* ── INCREMENTAL SWEEPS — what may soundly be reused, and what may not ───────────────────────
   A full fleet re-sweep is ~24 h and the 99 % programme runs ~15 of them. Most of that work is
   repeated: between sweeps we add ONE test group and change nothing else.

   ⚠️ THE TEMPTING VERSION IS UNSOUND. "Nothing changed, so reuse everything" is false for SURVIVORS:
   a newly added group can kill any survivor anywhere, and without per-test coverage there is no way
   to know which. Reusing a survived verdict would silently record a mutant as alive that the new test
   already kills — a wrong number that looks like progress.

   What IS sound is the other half. A mutant KILLED by group G stays killed as long as
     (a) the enclosing function's source is byte-identical, and
     (b) group G still exists with byte-identical body.
   Nothing else in the file can resurrect it. That is 3702 of 9996 mutants on the current fleet — a
   third of the work, not the ninety per cent an optimistic reading suggests.

   `groupBodies` extracts each `group('title', 'tags', function … )` body by brace matching, so a
   change to ONE group invalidates only the mutants that group killed. Hashing the whole test file
   instead would invalidate everything on every commit and save nothing at all, which is the version
   that looks like it works and does not. */
export function groupBodies(src) {
  const out = new Map();
  const s = String(src || '');
  const re = /group\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    const title = m[2];
    let i = s.indexOf('{', m.index);
    if (i < 0) continue;
    let d = 0;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (ch === '{') d++;
      else if (ch === '}') {
        d--;
        if (d === 0) {
          out.set(title, s.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

/* Reuse decision for ONE journal record. PURE — the whole rule in one testable place. */
export function mayReuse(rec, fnHashNow, groupHashNow) {
  if (!rec || rec.v !== 'KILLED') return false; // survivors and invalids must be re-tested
  if (!rec.fh || rec.fh !== fnHashNow) return false; // the mutated function changed
  if (!rec.ks || !rec.ks.length) return false; // killed by nothing we can name ⇒ cannot verify
  for (const g of rec.ks) if (groupHashNow.get(g) !== undefined && rec.gh && rec.gh[g] === groupHashNow.get(g)) return true;
  return false; // the killing group is gone or edited
}

export function readJournal(text) {
  const done = new Map();
  const starts = new Map(); // key -> how many times it has been STARTED without finishing
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      continue; // torn or partial — the only safe reading is to ignore it
    }
    if (!rec || typeof rec.k !== 'string') continue;
    if (rec.v === undefined) starts.set(rec.k, (starts.get(rec.k) || 0) + 1);
    else done.set(rec.k, rec); // the WHOLE record — incremental needs its fingerprints
  }
  /* ⚠️ ONE UNFINISHED START IS NOT A JAM, and treating it as one throws away good work. With 16
     workers, up to 16 mutants are in flight at any instant, so ANY interrupt leaves ~16 started and
     unfinished — measured: a SIGTERM mid-sweep left 13, none of them faulty. Quarantining those
     would discard 16 innocent mutants per interrupt and, worse, teach the tool to skip code it never
     actually tested.

     The signal for a real jam is that IT JAMS AGAIN: a mutant retried on resume and still unfinished
     has now hung twice. So `retry` (started once, never finished) is re-queued, and `jammed`
     (started twice or more, never finished) is quarantined and reported. */
  const jammed = [];
  const retry = [];
  for (const [k, n] of starts) {
    if (done.has(k)) continue;
    (n >= 2 ? jammed : retry).push(k);
  }
  return { done, jammed, retry };
}

/* ── JOURNAL SCOPE HEADER — fail-closed resume ──────────────────────────────────────────
   The journal records WHAT was swept, not just the verdicts: without it, `--resume` happily
   replays a 60-mutant journal onto a `--limit 30` invocation and reports a "complete" rate over
   half the population. The header is the first record of a fresh journal; on resume the current
   invocation's scope must match it field-for-field, or the run refuses (exit 2) rather than
   misattributing work. A journal that predates the header resumes with a warning — it cannot be
   verified, but refusing every old journal would strand real work. Pure and exported so
   --selftest pins the round-trip and the refusal. */
export function buildScope(o) {
  o = o || {};
  return {
    h: 'scope',
    v: 1,
    file: o.file || null,
    /* JSON has no Infinity: --diff/--only default to unlimited, recorded as the string. */
    limit: Number.isFinite(o.limit) ? o.limit : 'unlimited',
    filter: o.filter == null ? null : o.filter,
    bail: !!o.bail,
    full: !!o.full,
    only: o.only || null,
    diff: o.diff || null
  };
}
export function readScopeHeader(text) {
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      return null; // torn first line — unverifiable
    }
    /* An old journal's first record is a mutant start/verdict, never a header. */
    return rec && rec.h === 'scope' ? rec : null;
  }
  return null;
}
export function scopeDiff(a, b) {
  const out = [];
  for (const k of ['file', 'limit', 'filter', 'bail', 'full', 'only', 'diff']) {
    if (a[k] !== b[k]) out.push(k + ': journal=' + JSON.stringify(a[k]) + ' now=' + JSON.stringify(b[k]));
  }
  return out;
}

export function survivorKey(m) {
  /* ONE key for entries, survivors, generated and killed mutants — see classifySurvivors for why `after`
     is part of it. Exported so the diff gate subtracts what the classifier excused by the SAME rule. */
  return m.line + '\u0000' + m.op + '\u0000' + m.before + '\u0000' + (m.after ?? '');
}
/* The SAME mutant without its address. An entry detached from its line is still recognisable by the
   mutation it describes, which is what separates a LAPSED excuse from a dead one — see
   classifySurvivors. Never a matching key for an excuse: `op + before` is not unique within a file
   (measured 2026-10-20: 95 of 434 committed entries have more than one candidate), and a wrong
   re-anchor silently excuses a mutant nobody probed. It identifies a CAUSE, never a claim. */
export function survivorTextKey(m) {
  return m.op + '\u0000' + m.before + '\u0000' + (m.after ?? '');
}
export function classifySurvivors(entries, survivors, generated, killed, inFile) {
  /* `after` is part of the key for the reason findCanary documents: line+op+before collapses two
     same-operator mutants on one line into one entry, so a classification computed for one silently
     covers the other. Kept NUL-separated like `jkey` so a field boundary cannot be forged by text. */
  const key = survivorKey;
  const surv = new Set((survivors || []).map(key));
  const gen = new Set((generated || []).map(key));
  /* A KILL IS A DETECTION RECORDED, NOT A SURVIVOR THAT IS MISSING. `killed` is the mutants this run
     (or the journal it replayed) POSITIVELY recorded as KILLED. This function used to read refuted off
     absence — generated and not a survivor => "something killed it" — and absence is also what an
     INVALID mutant, a quarantined jammer, a thinned-out mutant and a partial run look like, so it could
     tell a reader to delete a correct claim (the defect the Python gate's classify was fixed for).
     Omitted (`undefined`) means no kill was recorded, so NOTHING can be refuted: fail closed. */
  const kil = new Set((killed || []).map(key));
  const out = { excused: [], realGap: [], refuted: [], orphaned: [], drifted: [], stale: [], unclassified: [], notDecided: [] };
  /* WHY an entry is orphaned, which one counter could never say. `inFile` is the WHOLE-FILE
     enumeration when the caller has one; `generated` is only what this run tested, so in a diff run
     the two differ and the difference is the whole point. ABSENT it stays `null` and both sub-buckets
     stay EMPTY: a caller that cannot say what the file holds must not be told a cause, because
     "out of scope" and "the code is gone" look identical from the tested subset alone. Fail closed,
     the same way `killed` does two comments above. */
  const scope = inFile && inFile.length ? inFile : null;
  const inFull = new Set((scope || []).map(key));
  const byText = new Map();
  for (const m of scope || []) {
    const t = survivorTextKey(m);
    const at = byText.get(t);
    if (at) at.push(m.line);
    else byText.set(t, [m.line]);
  }
  const seen = new Set();
  for (const e of entries || []) {
    const k = key(e);
    seen.add(k);
    if (!gen.has(k)) {
      out.orphaned.push(e);
      /* ORPHANED stays the union, so no existing reader changes meaning. The two sub-buckets are
         disjoint subsets of it and they carry the CAUSE. An entry absent from this run but present
         in the file is merely OUT OF SCOPE — the ordinary state of a diff run, and neither bucket.
         An entry whose byte-identical mutant sits at ANOTHER line has DRIFTED: the excuse lapsed
         under an edit above it, and `tools/reanchor-equivalence.mjs` can move it. One with no text
         match anywhere is STALE: the code it excused is gone, so only re-verification can replace
         it. Measured 2026-10-20 over the 434 committed entries: 71 anchored, 239 drifted and
         unambiguous, 95 drifted and ambiguous, 29 stale — so 363 excuses excused nothing while this
         function reported one number that blocks nothing
         (residue 2026-10-19-an-equivalence-excuse-keyed-to-a-line-lapses-on-drift). */
      if (scope && !inFull.has(k)) {
        const at = byText.get(survivorTextKey(e));
        if (at) out.drifted.push({ ...e, foundAtLines: at.slice(0, 8) });
        else out.stale.push(e);
      }
      continue;
    }
    if (!surv.has(k)) {
      if (!kil.has(k)) {
        // generated, not a survivor, and no recorded kill: the claim is UNMEASURED, never refuted
        out.notDecided.push(e);
        continue;
      }
      if (EXCUSING.has(e.class)) out.refuted.push(e);
      continue; // a `real-gap` entry that is now killed is debt paid, not an error
    }
    if (EXCUSING.has(e.class)) out.excused.push(e);
    else out.realGap.push(e);
  }
  for (const s of survivors || []) if (!seen.has(key(s))) out.unclassified.push(s);
  return out;
}
/* The survivors the diff gate must still BLOCK on: everything the classifier did not excuse — realGap
   and unclassified stay in. PURE. */
export function blockingSurvivors(classification, survivors) {
  const excused = new Set((classification.excused || []).map(survivorKey));
  return (survivors || []).filter((x) => !excused.has(survivorKey(x)));
}

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
   reported as 'STALE', never guessed at.

   ⚠️ THAT KEY IS NOT UNIQUE, AND THE COMMENT ABOVE NAMES THE HARM IT WAS CAUSING. Two mutations of
   the same operator on one line collapse to one key — `pulsedex-dsp.js:197` carries two `num → 0`
   mutants, the `<= 1500` threshold and the `Math.max(0.55, …)` floor, with identical `before` text.
   Measured 2026-08-25: a drafted assertion fused one mutant's probe input with the OTHER's recorded
   output (`altVO2Factor(null)` asserted to return 0.55, which is the floor mutant's value at
   ≥16500 m and never null's), and it reached main. That is exactly "silently points at a DIFFERENT
   mutant" — arriving by collision rather than by index drift, which is the case this comment did not
   consider.

   `after` disambiguates them and, unlike an index, does not shift when code above is edited — so it
   keeps the property this function was written for. `jkey` one screen down already keys this way.
   When a stored record predates `after` AND the 3-field match is ambiguous, REFUSE: a legacy record
   plus a real collision is the one case where matching would be a guess, and this function's stated
   contract is that a miss is STALE, never guessed. */
function findCanary(all, want) {
  if (!want) return null;
  const same = (all || []).filter((m) => m.line === want.line && m.op === want.op && m.before === want.before);
  if (same.length <= 1) return same[0] || null;
  if (want.after == null) return null; // legacy record + genuine collision → STALE, never guessed
  return same.find((m) => m.after === want.after) || null;
}

async function runFile(file) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return { file, error: 'not found' };
  const g = groupsForFile(file);
  const filter = FULL ? null : g && g.count ? g.stem : null;
  /* Coverage-directed selection, per mutant. Falls back to `filter` whenever the map cannot answer
     — see selectIndices: it returns null rather than an empty list, because a zero-group run fails
     nothing and would report every mutant SURVIVED. `--full` keeps its meaning (no narrowing). */
  const sel = (mu) => (FULL ? filter : selectIndices(pgmapFor(file), basename(file), mu && mu.line) || filter);
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
  /* Size the timeout against what the sweep WILL run — the union of groups touching this file when
     a coverage map is present, the tag filter otherwise. See calibrationIndices. */
  const calSel = FULL ? filter : calibrationIndices(pgmapFor(file), basename(file)) || filter;
  const calDesc = Array.isArray(calSel) ? calSel.length + ' selected group(s)' : calSel ? 'group "' + calSel + '"' : 'FULL SUITE';
  process.stderr.write('  calibrating: one clean ' + calDesc + ' run to size the timeout — no mutant is tested yet\n');
  const t0 = Date.now();
  runSuite(calSel, ROOT, 600000);
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
  /* IN EVERY MODE, because `--json` is the only mode the workflow runs. This line was gated on
     `!AS_JSON`, so the one run whose budget decides whether the job finishes printed no projection at
     all, and a job cancelled at its cap left a log that never said what it meant to spend. The
     heartbeat below carries a comment making this same argument for progress; the two lines that
     price the run were left behind. stdout stays pure NDJSON — this is stderr, which the workflow
     tails into the job summary. */
  process.stderr.write(phaseNote({ file, baseMs, estMs, jobs: JOBS }) + '\n');

  const original = readFileSync(abs, 'utf8');
  const allGenerated = mutantsFor(original);
  /* Diff mode tests only what the change TOUCHED. The canary is looked up against the FULL population
     (below), never this filtered one: it guards the HARNESS, not the diff, and a canary that happened
     to fall outside the touched lines would read STALE on every gate run — leaving the fast per-PR
     gate as the one place with no proof that kills are still being detected. */
  const touched = DIFF ? DIFF_LINES.get(file) || new Set() : null;
  const all = touched ? allGenerated.filter((m) => touched.has(m.line)) : allGenerated;
  let picked = thin(all, LIMIT);
  if (ONLY) {
    let wanted;
    try {
      const raw = JSON.parse(readFileSync(ONLY, 'utf8'));
      wanted = Array.isArray(raw) ? raw : raw.survivors;
    } catch (e) {
      console.error('--only: cannot read ' + ONLY + ' (' + e.message + ')');
      process.exit(2);
    }
    if (!Array.isArray(wanted)) {
      console.error('--only: ' + ONLY + ' is neither an array nor an object with a `survivors` array. An unreadable list is not an empty one.');
      process.exit(2);
    }
    const sel = selectRecorded(all, wanted);
    if (!sel.ok) {
      console.error('--only REFUSED: ' + sel.missing.length + ' entr(ies) match no current mutant, ' + sel.ambiguous.length + ' ambiguous.');
      for (const m of sel.missing.slice(0, 5)) console.error('   missing  L' + m.line + ' [' + m.op + '] — ' + m.why);
      for (const a of sel.ambiguous.slice(0, 5)) console.error('   ambiguous L' + a.line + ' [' + a.op + '] — ' + a.why);
      console.error('A partial re-test reports a smaller denominator as a complete answer. Sweep cold instead.');
      process.exit(2);
    }
    picked = sel.picked;
    console.log('   --only: re-testing ' + picked.length + ' recorded mutant(s) of ' + all.length + ' that exist');
  }
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
  /* The degraded serial fallback TOOK OVER: `JOBS > 1` was asked for and no worker tree could be
     created, so the mutants ran in place. It is a property of the RUN, not of the request, and two
     readers need it — `restore()` below, whose guard is keyed on JOBS === 1, and the record. */
  let degradedSerial = false;
  const bak = abs + '.mutate-backup';
  if (JOBS === 1) {
    writeFileSync(bak, original);
    _dirty.set(abs, original);
  }
  const restore = () => {
    // `JOBS > 1` writes only inside the worker trees — except on the degraded serial fallback,
    // which writes the caller's own copy and so owes the same restore.
    if (JOBS !== 1 && !degradedSerial) return;
    try {
      writeFileSync(abs, original);
    } catch {}
    try {
      rmSync(bak, { force: true });
    } catch {}
    _dirty.delete(abs);
  };
  const survivors = [];
  const killedMu = []; // the mutants POSITIVELY recorded KILLED — the only evidence a refutation may use
  /* INVALID mutants are LISTED, not just counted. They were a bare number, and a bare number cannot be
     reconciled against anything — so a mutant that never ran was indistinguishable from one that ran
     and died. That is not hypothetical: two consecutive full sweeps of clock.js, on byte-identical
     source, reported 19 and 20 survivors. The extra one (L30, `tzOffset()`'s `* 60000`) had been
     sitting in the earlier run's invalid bucket. A REAL COVERAGE GAP HID INSIDE THE COUNT, and the
     run that missed it looked like the clean one — it matched the prediction exactly.
     Two runs are now comparable mutant-by-mutant, in both buckets. */
  /* ── THE JOURNAL — resume, and the jammed-mutant problem ────────────────────────────────────
     A full sweep is up to 13.8 h (integrator). Verdicts used to exist only in memory until the run
     completed, so an interrupt at hour 13 lost all thirteen. And some mutants JAM the harness — an
     infinite loop the timeout should catch but occasionally does not — after which a naive resume
     re-runs the jammer and jams again, forever.

     Both are solved by writing TWO records per mutant: a `start` BEFORE it runs and a verdict AFTER.
     On resume, an entry with a start and NO verdict is, by construction, the mutant that was in
     flight when the run died — the jammer. It is QUARANTINED rather than retried, and reported, so a
     resumed sweep makes progress instead of re-entering the same hole.

     Append-only NDJSON: each line is one small atomic O_APPEND write, so concurrent workers cannot
     interleave a partial record, and a torn final line is discarded by the reader rather than
     crashing it. */
  /* ── INCREMENTAL fingerprints ────────────────────────────────────────────────────────────────
     `fnHash(line)` hashes the source of the function ENCLOSING that line, so an edit anywhere else in
     the file does not invalidate a mutant. `groupHash` is the current body of every test group, so an
     edit to one group invalidates only what that group killed. Hashing the whole file on either side
     would invalidate everything on every commit — the version that looks incremental and saves
     nothing. */
  const _fnRanges = (() => {
    const out = [];
    const ls = original.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const mm = ls[i].match(/(?:^|[^\w$.])function\s+(\w+)\s*\(/);
      if (!mm) continue;
      let d = 0,
        seen = false;
      for (let j = i; j < ls.length; j++) {
        for (const ch of ls[j]) {
          if (ch === '{') {
            d++;
            seen = true;
          } else if (ch === '}') {
            d--;
            if (seen && d === 0) {
              out.push({ start: i + 1, end: j + 1, text: ls.slice(i, j + 1).join('\n') });
              j = ls.length;
              break;
            }
          }
        }
        if (out.length && out[out.length - 1].start === i + 1) break;
      }
    }
    return out;
  })();
  const _sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const fnHash = (line) => {
    let best = null;
    for (const r of _fnRanges) if (line >= r.start && line <= r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
    return best ? _sha(best.text) : _sha('(top level)');
  };
  let _groupHash = new Map();
  try {
    const gb = groupBodies(readFileSync(join(ROOT, 'tests/dex-tests.js'), 'utf8'));
    for (const [k, v] of gb) _groupHash.set(k, _sha(v));
  } catch (_) {
    /* no test file readable ⇒ no group hashes ⇒ nothing is reusable, which fails CLOSED */
  }

  const journalPath = JOURNAL || join(ROOT, '.mutate-journal', file.replace(/[/\\]/g, '_') + '.jsonl');
  const jkey = (m) => m.line + '\u0000' + m.op + '\u0000' + m.before + '\u0000' + m.after;
  let prior = { done: new Map(), jammed: [] };
  if ((RESUME || INCREMENTAL) && existsSync(journalPath)) {
    const journalText = readFileSync(journalPath, 'utf8');
    prior = readJournal(journalText);
    const scopeThen = readScopeHeader(journalText);
    const scopeNow = buildScope({ file, limit: LIMIT, filter, bail: BAIL, full: FULL, only: ONLY, diff: DIFF ? DIFF_BASE : null });
    if (scopeThen) {
      const mism = scopeDiff(scopeThen, scopeNow);
      if (mism.length) {
        process.stderr.write(
          '\n  ✕ RESUME REFUSED — the journal was written by a different sweep:\n' +
            mism.map((m) => '    · ' + m).join('\n') +
            '\n    Resume only the identical invocation, or drop --resume for a fresh run. A scope\n    change mid-history would silently misattribute verdicts.\n'
        );
        process.exit(2);
      }
    } else {
      process.stderr.write('  ⚠ journal predates scope encoding — scope UNVERIFIED on this resume\n');
    }
    process.stderr.write(
      '  resuming: ' + prior.done.size + ' mutant(s) already recorded' + (prior.jammed.length ? ', ' + prior.jammed.length + ' QUARANTINED as jammed (started, never finished)' : '') + '\n'
    );
  }
  if (JOURNAL !== false) {
    try {
      mkdirSync(dirname(journalPath), { recursive: true });
      /* Truncating here would destroy the very history --incremental reads. Only a plain cold run
         starts a fresh journal. */
      if (!RESUME && !INCREMENTAL) writeFileSync(journalPath, '');
    } catch (_) {
      /* an unwritable journal must not stop the sweep — it only costs resumability */
    }
  }
  let journalBroken = false;
  const jwrite = (rec) => {
    if (JOURNAL === false || journalBroken) return;
    try {
      appendFileSync(journalPath, JSON.stringify(rec) + '\n');
    } catch (e) {
      /* SAY SO ONCE. The first version swallowed this silently and the journal stayed empty for a
         whole run — appendFileSync was simply not imported, and every write threw into a bare catch.
         A resumability feature that quietly records nothing is worse than none, because you only
         discover it when you try to resume. */
      journalBroken = true;
      process.stderr.write('  ⚠ JOURNAL DISABLED — ' + String((e && e.message) || e).slice(0, 90) + '\n    this run is NOT resumable.\n');
    }
  };
  /* The scope header goes down FIRST on a fresh journal — it is what a later --resume compares
     against. Via jwrite (not a separate writeFileSync) so a broken journal says so once, like any
     other write failure. */
  if (!RESUME && !INCREMENTAL) jwrite(buildScope({ file, limit: LIMIT, filter, bail: BAIL, full: FULL, only: ONLY, diff: DIFF ? DIFF_BASE : null }));

  /* Apply the journal: replay recorded verdicts into the counters, and DROP both the finished
     mutants and the quarantined jammers from the queue. `picked` is re-bound rather than mutated so
     `picked.length` stays the honest denominator of what this run will actually attempt. */
  let quarantined = [];
  const applyResume = () => {
    if (!(RESUME && prior.done.size + prior.jammed.length)) return;
    const jam = new Set(prior.jammed);
    quarantined = picked.filter((m) => jam.has(jkey(m))).map((m) => ({ line: m.line, op: m.op, before: m.before, after: m.after }));
    /* The FULL mutant set for this run, captured before the replayed and quarantined ones are
       filtered out — so the resume line can state a denominator. Without it the readout gives two
       numbers that a reader cannot check against anything, which is how the first resume printed
       `tested 12` for a 60-mutant sweep and looked partial rather than wrong. */
    const total = picked.length;
    /* FOLD THE PRIOR VERDICTS INTO THIS RUN'S COUNTERS BEFORE DROPPING THEM FROM THE QUEUE.
       Without this a resumed sweep reports only the mutants IT tested — the first resume here read
       `tested 12` for a 60-mutant sweep, which is not a partial result but a WRONG one: the rate
       would be computed against a denominator missing 48 mutants. Survivors are reconstructed by
       matching the journal's key back onto the freshly generated mutant, so the survivor list stays
       a list of real mutant records rather than bare keys. */
    for (const m of picked) {
      const rec0 = prior.done.get(jkey(m));
      if (rec0 === undefined) continue;
      const v = rec0.v;
      if (v === 'KILLED') {
        killed++;
        killedMu.push(m);
      } else if (v === 'INVALID') {
        invalid++;
        invalids.push({ ...m, reason: 'recorded in a previous run' });
      } else if (v === 'QUARANTINED') {
        /* Quarantined in a previous run: never measured, so it joins the quarantine list for the
           report but NOT done/resumedCount — it was not attempted by this run and must not inflate
           `tested`. The picked-filter below already drops it from the queue via prior.done. */
        quarantined.push({ line: m.line, op: m.op, before: m.before, after: m.after, reason: 'quarantined in a previous run' });
      } else survivors.push(m);
      if (v !== 'QUARANTINED') {
        done++;
        resumedCount++;
      }
    }
    picked = picked.filter((m) => !prior.done.has(jkey(m)) && !jam.has(jkey(m)));
    process.stderr.write(
      '  resume: ' +
        resumedCount +
        ' verdicts replayed (' +
        killed +
        ' already killed), ' +
        quarantined.length +
        ' quarantined as JAMMED — ' +
        picked.length +
        ' left to test of ' +
        total +
        ' total' +
        (prior.retry.length ? ', incl. ' + prior.retry.length + ' retried (in flight when the last run died)' : '') +
        '\n'
    );
  };

  /* One duration formatter for all three readouts — the heartbeat, the per-mutant ETA and the
     aggregate line. It was local to tick(), so the other two referenced it out of scope and the
     sweep died on the ninth mutant with `mmss is not defined`. */
  const mmss = (s) => Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';

  /* ── HEARTBEAT — proof of life on a run measured in hours ────────────────────────────────────
     A 13.8 h sweep that prints only on completion is indistinguishable from a hung one, and the
     per-mutant stream can itself go quiet for minutes when a single mutant is slow. So an
     unconditional timer writes one line a minute with elapsed, progress and a projected finish. It is
     driven by a TIMER, not by mutant completions, which is the entire point: if the mutants have
     stopped, the heartbeat is what keeps saying so. `unref()` so it can never hold the process open. */
  let heartbeat = null;
  const startHeartbeat = () => {
    heartbeat = setInterval(() => {
      const el = (Date.now() - _t0) / 1000;
      const r = done > 0 ? done / el : 0;
      const left = r > 0 ? Math.round((picked.length - done) / r) : 0;
      process.stderr.write(
        '  ♥ alive  ' +
          done +
          '/' +
          picked.length +
          '  killed ' +
          killed +
          '  elapsed ' +
          mmss(el) +
          /* The calibration cost rides every heartbeat on purpose. A job cancelled at its cap gets
             read through the last 40 lines of this log, and the pass that ran before the loop sits
             far outside that window — so without this the reader sees the loop's elapsed and cannot
             tell what share of the budget had already gone. */
          '  (calibration ' +
          (baseMs / 1000).toFixed(0) +
          's)' +
          (r > 0 ? '  eta ' + mmss(left) + '  finishes ~' + new Date(Date.now() + left * 1000).toTimeString().slice(0, 5) : '  eta ?') +
          '\n'
      );
    }, 60000);
    if (heartbeat.unref) heartbeat.unref();
  };
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  /* INCREMENTAL: replay only the kills that are still provably kills, and re-test everything else.
     Separate from --resume, which replays a partial run of the SAME code; this replays across code
     and test changes, and is therefore the one that has to be conservative. */
  const applyIncremental = () => {
    if (!INCREMENTAL || !prior.done.size) return;
    const before = picked.length;
    const keep = [];
    for (const m of picked) {
      const rec0 = prior.done.get(jkey(m));
      if (rec0 && mayReuse(rec0, fnHash(m.line), _groupHash)) {
        killed++;
        killedMu.push(m);
        done++;
        reusedCount++;
        for (const g of rec0.ks || []) killers.set(g, (killers.get(g) || 0) + 1);
      } else keep.push(m);
    }
    picked = keep;
    process.stderr.write(
      '  incremental: ' +
        reusedCount +
        ' kill(s) replayed unchanged, ' +
        (before - reusedCount) +
        ' to re-test' +
        (reusedCount === 0 ? '  ⚠ NOTHING REUSED — the journal is empty, or every function/group hash moved' : '') +
        '\n    (survivors are ALWAYS re-tested — a new group can kill any of them)\n'
    );
  };

  const invalids = [];
  let reusedCount = 0;
  let resumedCount = 0;
  let killed = 0,
    invalid = 0,
    quarantinedThisRun = 0,
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
      file +
      '  ' +
      done +
      '/' +
      picked.length +
      '  killed ' +
      killed +
      '  survived ' +
      survivors.length +
      (invalid ? '  invalid ' + invalid : '') +
      (quarantinedThisRun ? '  quarantined ' + quarantinedThisRun : '') +
      '  [' +
      (trees.length || 1) +
      ' job(s)]';
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
    process.stderr.write('  ' + body + '  elapsed ' + mmss(el) + (done < picked.length ? '  eta ' + mmss(etaS) + (etaWarm ? '' : ' (warming — includes pool build)') : '  done') + '\n');
  };
  /* `v` is either the legacy string (the serial in-place path, which still uses the sync runner) or
     `{ verdict, killers }` from the async pool. Normalising here keeps both paths on one classifier
     rather than duplicating the bookkeeping. */
  const killers = new Map(); // group title → how many mutants it killed
  /* Both replays run AFTER every counter they write to exists —  is one of them, and
     calling earlier died in the temporal dead zone. */
  applyResume();
  applyIncremental();
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
      killedMu.push(mu);
      if (!firstKill && ks.length) firstKill = { mu, killers: ks };
      for (const g of ks) killers.set(g, (killers.get(g) || 0) + 1);
    } else if (verdict === 'INVALID') {
      invalid++;
      invalids.push({ ...mu, reason: (typeof v === 'string' ? null : v.reason) || 'no-output' });
    } else if (verdict === 'QUARANTINED') {
      /* A quarantined mutant never completed a verdict, so like INVALID it is excluded from the
         kill-rate denominator — unmeasured, not survived. It stays in the report (and the journal)
         as its own kind, because "the suite timed out" and "the mutant wedged the suite" are
         different diagnoses with different fixes. */
      quarantinedThisRun++;
      quarantined.push({ line: mu.line, op: mu.op, before: mu.before, after: mu.after, reason: (typeof v === 'string' ? null : v.reason) || 'no-progress' });
    } else survivors.push(mu);
    jwrite({
      k: jkey(mu),
      v: verdict,
      ks: ks.length ? ks : undefined,
      r: typeof v === 'string' ? undefined : v.reason,
      fh: fnHash(mu.line),
      gh: ks.length ? Object.fromEntries(ks.map((g) => [g, _groupHash.get(g)])) : undefined
    });
    /* ONE LINE PER MUTANT, on stderr so stdout stays pure NDJSON. An aggregate counter tells you a
       sweep is alive; it does not tell you WHAT it is finding, and on a 13 h run the difference
       between "still working" and "working on something useful" is worth a line each. */
    if (STREAM) {
      const mark = verdict === 'KILLED' ? '✓ KILLED  ' : verdict === 'INVALID' ? '⊘ invalid ' : verdict === 'QUARANTINED' ? '⚠ QUARANTINED' : '✗ SURVIVED';
      /* ETA from the SAME trailing window the aggregate line uses, so the two can never disagree.
         Below 3 completions the rate is dominated by pool build-out and is marked `~` rather than
         printed as if it were a measurement. */
      const _el = (Date.now() - _t0) / 1000;
      let _r = done > 0 ? done / _el : 0;
      if (_stamps.length >= 3) {
        const sp = _stamps[_stamps.length - 1] - _stamps[0];
        if (sp > 0) _r = (_stamps.length - 1) / sp;
      }
      const _left = _r > 0 ? Math.round((picked.length - done - 1) / _r) : 0;
      const _eta = _r > 0 ? (_stamps.length >= 3 ? '' : '~') + mmss(_left) : '?';
      process.stderr.write(
        '  ' +
          mark +
          ' ' +
          String(done + 1).padStart(5) +
          '/' +
          picked.length +
          '  L' +
          String(mu.line).padEnd(5) +
          ' [' +
          String(mu.op).padEnd(15) +
          '] ' +
          String(mu.before || '')
            .trim()
            .slice(0, 46)
            .padEnd(46) +
          '  eta ' +
          _eta +
          (verdict === 'KILLED' && ks.length ? '  ← ' + ks[0].slice(0, 28) : '') +
          '\n'
      );
    }
    tick();
  };

  startHeartbeat();
  try {
    if (JOBS > 1) {
      /* One disposable worktree per worker, detached at HEAD. Each worker mutates ITS OWN copy of the
         file, so no two mutants ever race on the same bytes — and the caller's tree is never written
         to at all on this path. */
      trees.push(...workerPool());
      /* §3d: vet the zero-attribution groups in the environment mutants will actually run in.
         Runs once per sweep, costs one ~4 s pass of the cheapest groups in the suite. */
      {
        const pg = pgmapFor(file);
        if (pg && trees.length) {
          const zeroIdx = pg.groups.filter((gr) => !gr.unknown && (!gr.files || !Object.keys(gr.files).length)).map((gr) => gr.index);
          zeroBaselineExcludes(zeroIdx, trees[0], timeoutMs, file);
        }
      }
      if (!trees.length) {
        /* No worker could be created — degrade to the serial in-place path rather than doing nothing.
           The backup/recovery machinery is keyed on JOBS === 1, so mark this file dirty explicitly and
           tell `restore()` and the record that this path ran. */
        degradedSerial = true;
        writeFileSync(bak, original);
        _dirty.set(abs, original);
        for (const mu of picked) {
          _inFlight.set(abs, mu.op + ' at line ' + mu.line + ': ' + String(mu.before).trim().slice(0, 60) + ' → ' + String(mu.after).trim().slice(0, 60));
          writeFileSync(abs, mu.apply());
          /* ONE start record per mutant. This line was duplicated (#1178), which only ever fired on
             this serial fallback — so it survived every pooled run. `readJournalProgress` derives
             `inFlight = started − done`, so a doubled START inflates it by one per mutant, and that
             number is what the resume line reports as "will be re-tried or quarantined" and what the
             inventory publishes. A degraded-mode run therefore reported roughly twice the in-flight
             work it had. */
          jwrite({ k: jkey(mu) });
          classify(runSuite(sel(mu), ROOT, timeoutMs), mu);
        }
        /* NO SECOND RECORD BUILDER, AND NO EARLY RETURN. `restore()` covers this path now, and control
           falls through the worker pool — `trees` is empty, so `trees.map(worker)` is a no-op — to the
           ONE builder at the end of runFile. Until 2026-10-20 this block returned a record of its own,
           and every field added to the other one missed it: it carried no `equivalence`, so no excuse
           was applied and no REFUTED claim could fire, and no `canary`/`voided`, so a run whose canary
           SURVIVED published a kill count and escaped the gate's void filter. It also returned BEFORE
           the canary post-processing, so a degraded run never learned a canary and never printed the
           UNTRUSTED warning (residue 2026-10-20-the-degraded-serial-sweep-reports-no-equivalence-split,
           the second instance after `killedMutants`). */
      }
      let next = 0;
      const worker = async (dir) => {
        const wAbs = join(dir, file);
        for (;;) {
          const i = next++;
          if (i >= picked.length) return;
          /* UNLINK FIRST — LOAD-BEARING. The worker tree is HARD LINKS, so `wAbs` and the repo's own
             copy are the SAME inode: writing through it would mutate the source under test, with
             JOBS workers corrupting the file they are measuring. Removing the link first breaks the
             sharing for this one path and leaves the repo untouched. (killcheck.mjs carries the same
             note for the same reason.) */
          rmSync(wAbs, { force: true });
          writeFileSync(wAbs, picked[i].apply());
          jwrite({ k: jkey(picked[i]) });
          classify(await runSuiteAsync(sel(picked[i]), dir, timeoutMs), picked[i]);
        }
      };
      await Promise.all(trees.map(worker));
    } else {
      for (const mu of picked) {
        _inFlight.set(abs, mu.op + ' at line ' + mu.line + ': ' + String(mu.before).trim().slice(0, 60) + ' → ' + String(mu.after).trim().slice(0, 60));
        writeFileSync(abs, mu.apply());
        classify(runSuite(sel(mu), ROOT, timeoutMs), mu);
      }
    }
  } finally {
    stopHeartbeat();
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
  const qwarn = quarantineWarning(quarantinedThisRun, picked.length, QUARANTINE_MS);
  if (qwarn) process.stderr.write(qwarn);
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
        '    The run is UNGUARDED. Delete its entry in tools/mutate-canaries.json to re-learn one.\n' +
        /* HOW TO READ "UNGUARDED" — shipped WITH the warning on purpose, because a machine-emitted
           warning whose interpretation lives in a brief is a warning most readers will act on wrongly.
           Ruled 2026-08-26 after integrator ran unguarded at 49.9%. */
        '    A HIGH KILL RATE IS ITS OWN POSITIVE CONTROL; A LOW ONE IS NOT. A blind harness reports\n' +
        '    ZERO kills, so a run at (say) 952/1917 has proved detectability 952 times over and STANDS\n' +
        '    unguarded. The canary is load-bearing in the opposite case: at a low or zero kill rate,\n' +
        '    "nothing was killable" and "the harness was blind" produce identical output, and only a\n' +
        '    planted known-answer separates them — an unguarded run at 3% is UNTRUSTED by default.\n' +
        '    Neither instrument speaks to individual survivor verdicts: a canary proves ONE planted\n' +
        '    kill was seen, not that survivor #700 was judged right. So re-verifying a sample "because\n' +
        '    the canary was stale" answers a question neither instrument asks.\n'
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
    /* WHERE THE BUDGET WENT, per file and per pass — the measurement both mutation residue rows
       leave owed. `calibrationMs` is one clean run of the selected groups, paid once per file;
       `mutantPassMs` is the worker pool plus the per-mutant loop at `jobs` workers, and that is the
       pass which spends the budget. The job summary then states the split with no log tail to read. */
    calibrationMs: baseMs,
    mutantPassMs: Date.now() - _t0,
    jobs: degradedSerial ? 1 : JOBS,
    /* …and whether that is what was ASKED for. `--jobs 4` degraded to one in-place worker reads as
       `jobs: 1, degradedSerial: true`, so two runs of the same command are no longer identical on
       paper while one of them paid four times the wall clock. */
    degradedSerial,
    // the canary is scaffolding, not a measurement — it must not enter the denominator it guards
    tested: picked.length - (canaryMu ? 1 : 0) + resumedCount + reusedCount,
    killed: canaryState === 'FAILED' ? null : killed,
    invalid,
    /* Mutants quarantined THIS run (they are in `tested`, hence excluded from the rate) and the full
       quarantine list for the report (this run's plus any carried over from a resumed journal). */
    quarantined: quarantinedThisRun,
    quarantinedMu: quarantined,
    // the mutants that never RAN — listed, so a survivor can never hide as a bare count again
    invalids,
    /* WHICH groups did the killing, and how many mutants each accounted for. The union over a whole
       file is the minimal sufficient selection for that file's tag — the measurement that says whether
       an expensive tag can be narrowed (CLOCK-MUTATION-COST). Sorted by contribution so the long tail
       is visible; a group that killed nothing never appears. */
    killers: Array.from(killers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([group, n]) => ({ group, n })),
    survivors: survivors.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after })),
    /* THE KILL LIST BY NAME, not only its count. `killedMu` above is "the only evidence a refutation
       may use", and until 2026-10-19 it never left this process: the record shipped `killed` as a bare
       number. So `tools/probe-equivalence.mjs` had to build its positive controls by SUBTRACTION —
       every in-range mutant that was neither a survivor nor an invalid. That identity holds only for a
       sweep that tested everything it enumerated; under `--only` the remainder is mostly mutants the
       sweep NEVER TESTED, and a control that never ran cannot fail
       (residue 2026-10-19-probe-controls-inferred-by-subtraction). Same shape as `survivors`, so one
       reader serves both. `null` under a FAILED canary, matching `killed` above: kill detection in
       doubt is no evidence of reach, and a reader owes that case a refusal rather than a pool. */
    killedMutants: canaryState === 'FAILED' ? null : killedMu.map((s) => ({ line: s.line, op: s.op, before: s.before, after: s.after })),
    /* The equivalence split (MUTATION-EQUIVALENCE §5). Reported ALONGSIDE the raw numbers above, never
       instead of them: `killed / tested` stays visible so the two denominators can be compared, which
       is the whole argument the brief makes. `distinguishable` is what the 90 % target should be read
       against once that call is made. */
    equivalence: (function () {
      /* `allGenerated` is the WHOLE file; `all` is what this run tested (a diff run filters it to the
         touched lines). Passing both is what lets an out-of-scope entry be told from a lapsed one. */
      const c = classifySurvivors(loadEquivalence()[file], survivors, all, killedMu, allGenerated);
      return {
        excused: c.excused.length,
        realGap: c.realGap.length,
        unclassified: c.unclassified.length,
        refuted: c.refuted,
        orphaned: c.orphaned,
        drifted: c.drifted,
        stale: c.stale,
        notDecided: c.notDecided,
        // what the diff gate still blocks on: the survivors no recorded equivalence entry excuses
        blocking: blockingSurvivors(c, survivors).map((x) => ({ line: x.line, op: x.op, before: x.before, after: x.after })),
        // the honest denominator: what a test COULD have killed
        distinguishable: picked.length - (canaryMu ? 1 : 0) - invalid - c.excused.length
      };
    })()
  };
}

/* ── selftest: known answers, and it does NOT touch the repo ────────────────────────────────
   Mutant GENERATION is the part with a right answer; whether a given mutant survives depends on
   the suite and is not a fixed fact. So the selftest pins generation + thinning determinism. */
/* ── THE VERDICT OBJECT — tepna.verdict/1 (VERDICT-CONTRACT §1; `verdict.js` is the authority) ────────
   The JS half of the pair `capture-host/tools/mutate_diff.py` closed in #2802: the diff gate emits ONE
   object at every exit, and the object — not the "✕ MUTATION GATE …" prose, which stays as explanation
   — is the API. Statuses, in the order the gate already decides them:
     · NOT_RUN         the diff could not be read, or no file could be measured — nothing examined
     · NOT_APPLICABLE  no mutable source changed, or the changed lines carry no mutable operator — the
                       criterion does not bind. ⚠️ This is the case that used to print "all 0 mutant(s)
                       … were killed": a PASS over checked = 0 is the examined-nothing shape and the
                       validator refuses it at the type level, so the gate now says what it is
     · UNKNOWN         the canary survived (kills were not being detected) or mutants never ran — the
                       run could not prove anything either way; never a kill, never a pass
     · FAIL            a mutant on a changed line survived
     · PASS            every mutant on the changed lines was killed, over checked > 0
   Population is MUTANTS on the changed lines: eligible = tested, checked = tested − invalid,
   excluded = invalid. Exit codes are unchanged (VOID/INCONCLUSIVE 3 · survivors 1 · else 0); the
   object is added beside them, never instead. Pure — the selftest pins every status without a sweep. */
export const VERDICT_STATUSES = Object.freeze(['PASS', 'FAIL', 'SHORTFALL', 'UNDERPOWERED', 'NOT_RUN', 'NOT_APPLICABLE', 'UNKNOWN']);
export function verdictObject(status, { checked, eligible, result, reason, evidence, commit, commitReason, at, base }) {
  if (!VERDICT_STATUSES.includes(status)) throw new Error('status ' + JSON.stringify(status) + ' is not in the closed enum');
  if (status === 'PASS' && reason != null) throw new Error('PASS carries reason: null');
  if (status !== 'PASS' && !(typeof reason === 'string' && reason.trim())) throw new Error(status + ' requires a reason');
  const excluded = eligible - checked;
  if (excluded < 0) throw new Error('checked ' + checked + ' > eligible ' + eligible);
  const producedBy = { tool: 'tools/mutate.mjs', commit: commit == null ? null : commit };
  if (commit == null) producedBy.commitReason = commitReason || 'not run inside a git checkout'; // ∅: a null commit says why
  return {
    schema: 'tepna.verdict/1',
    gate: 'mutate-diff-js',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'survivors_on_changed_lines', threshold: 0, unit: 'mutants', direction: 'lte' },
    result: status === 'NOT_RUN' || status === 'NOT_APPLICABLE' ? null : result,
    evidence,
    reason: reason == null ? null : reason,
    producedBy,
    at: (at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z'),
    base: base == null ? null : base
  };
}
/* ── §2.13 COMPLIANCE MANIFEST ──────────────────────────────────────────────────────────────
   TOOL-BUILD-STANDARD §2.13: each long-running tool carries a short manifest — one line per clause
   of the standard — stating `met`, `n/a` with a reason, or `missing`. Prose alone rots; a manifest
   entry can be spot-verified by a gate or a reviewer. This is the tool's declaration about its own
   construction; `--verdict` prints it as JSON. Statuses are closed (the three words), and an `n/a`
   without a reason is a lie by omission — the selftest pins both. */
export const COMPLIANCE_CLAUSES = Object.freeze([
  {
    clause: '2.1',
    title: 'Search before asserting a capability does not exist',
    status: 'met',
    reason: 'fleet builds run Rule-0 doc-search before new tools; this tool reuses tests/run-tests.mjs and verdict.js instead of reimplementing'
  },
  { clause: '2.2', title: 'Resumable from the last completed unit', status: 'met', reason: 'per-mutant journal plus --resume; the scope header refuses a cross-scope resume fail-closed' },
  { clause: '2.3', title: 'Stoppable and killable', status: 'met', reason: 'SIGTERM/SIGKILL via mutate-recover; the no-progress watchdog SIGKILLs wedged mutants' },
  { clause: '2.4', title: 'Continuously observable', status: 'met', reason: 'per-minute heartbeat, per-mutant STREAM lines, progress line with ETA' },
  { clause: '2.5', title: 'Heartbeat that survives redirection', status: 'met', reason: 'heartbeat and progress go to stderr, never stdout' },
  {
    clause: '2.6',
    title: 'The parallelism must be measured, not assumed',
    status: 'met',
    reason: 'pool sized from measured cores and per-job memory; the per-mutant timeout is calibrated at 5x a timed clean run'
  },
  { clause: '2.7', title: 'Degrade by capability, and report the tier taken', status: 'met', reason: 'DEX_BAIL tiers and the serial --jobs 1 fallback each announce themselves on stderr' },
  { clause: '2.8', title: 'Size the pool to the machine, and justify the clamp', status: 'met', reason: 'cpus() and MemAvailable with a measured per-job figure; an explicit --jobs always wins' },
  { clause: '2.9', title: 'Generic across callers, or explicitly single-purpose', status: 'met', reason: 'explicitly single-purpose: JS DSP mutation harness, declared in the header' },
  { clause: '2.10', title: 'Run the full gate as the delivery step', status: 'n/a', reason: 'delivery-process clause: it binds PRs (npm run check), not this tool\u2019s runtime' },
  { clause: '2.11', title: 'Declare what is not implemented', status: 'met', reason: 'the header documents known limits: bail attribution breadth, timeout-vs-hang ambiguity' },
  {
    clause: '2.12',
    title: 'Unattended runs finish without a human between passes',
    status: 'met',
    reason: 'the no-progress quarantine lets a sweep finish without intervention; the journal resumes the rest'
  },
  { clause: '2.13', title: 'Compliance is declared in a machine-readable form', status: 'met', reason: 'this manifest, via --verdict' }
]);
export function complianceManifest(run) {
  return {
    schema: 'tepna.tool-compliance/1',
    tool: 'tools/mutate.mjs',
    standard: 'briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md',
    clauses: COMPLIANCE_CLAUSES.map((c) => ({ clause: c.clause, title: c.title, status: c.status, reason: c.reason || null })),
    run: run || null,
    producedBy: { tool: 'tools/mutate.mjs', commit: headCommit() },
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  };
}
/* The decision over a finished run: the SAME order as the exit block below, so the code and the status
   cannot disagree. `results` are runFile() rows; `meta` = { base, commit, at }. Returns { verdict, code }. */
/* The survivors one runFile row asks the gate to block on: its classified `blocking` list when it has
   one, else every raw survivor (no classification ⇒ nothing is excused). */
function survivorsToBlock(r) {
  return r.equivalence && Array.isArray(r.equivalence.blocking) ? r.equivalence.blocking : r.survivors;
}
export function diffVerdict(results, meta) {
  meta = meta || {};
  const ok = results.filter((r) => !r.error);
  const files = results.map((r) => r.file);
  const evidence = ['tools/mutate.mjs', ...files];
  const mk = (status, fields) => verdictObject(status, { evidence, commit: meta.commit, commitReason: meta.commitReason, at: meta.at, base: meta.base, ...fields });
  if (!ok.length) {
    const why = results
      .map(
        (r) =>
          r.file +
          ': ' +
          String(r.error || 'unknown')
            .split('\n')[0]
            .slice(0, 80)
      )
      .join('; ');
    return { code: 0, verdict: mk('NOT_RUN', { checked: 0, eligible: 0, result: null, reason: results.length + ' file(s), none measured — ' + (why || 'no files') }) };
  }
  /* THE LEDGER IS READ HERE TOO. This counted raw survivors, so a mutant a recorded `equivalent` /
     `no-distinguishing-input` entry excuses still made the gate FAIL while the sweep path in the same
     file subtracted it. `runFile` classifies (see `equivalence.blocking`) and this takes what it did not
     excuse. A row with no classification (`blocking` absent) is read RAW — the old behaviour, and the
     fail-closed one: an unclassified survivor blocks. */
  const surv = ok.flatMap((r) => survivorsToBlock(r).map((s) => ({ file: r.file, ...s })));
  const rawSurv = ok.reduce((a, r) => a + r.survivors.length, 0);
  /* REFUTED means a kill was POSITIVELY RECORDED against an entry claiming the mutant cannot be killed
     (`classifySurvivors` never reads it off absence), so the claim is wrong and that is a FAIL, as in
     the Python gate. ORPHANED / not-decided are reported, never blocking: in a diff run most entries name
     lines the change did not touch, and an entry whose mutant was not decided excused nothing.
     ⚠️ That excuse is true of the UNION only, which is why `drifted` and `stale` ride beside it: both
     are orphans the file itself can explain, so neither is out of scope in any run mode. They do not
     block either — a drift is recoverable by `tools/reanchor-equivalence.mjs` and a stale entry needs
     re-verification, and neither is evidence about the diff under test — but a number nobody can read
     is how 363 of 434 committed excuses came to excuse nothing unnoticed. */
  const refuted = ok.flatMap((r) => ((r.equivalence && r.equivalence.refuted) || []).map((e) => ({ file: r.file, ...e })));
  const orphaned = ok.reduce((a, r) => a + ((r.equivalence && r.equivalence.orphaned) || []).length, 0);
  const drifted = ok.reduce((a, r) => a + ((r.equivalence && r.equivalence.drifted) || []).length, 0);
  const stale = ok.reduce((a, r) => a + ((r.equivalence && r.equivalence.stale) || []).length, 0);
  const notDecided = ok.reduce((a, r) => a + ((r.equivalence && r.equivalence.notDecided) || []).length, 0);
  const voided = ok.filter((r) => r.voided);
  const unrun = ok.reduce((a, r) => a + r.invalid + (r.quarantined || 0), 0);
  const tested = ok.reduce((a, r) => a + r.tested, 0);
  const killed = ok.reduce((a, r) => a + r.killed, 0);
  const lines = ok.reduce((a, r) => a + (r.touchedLines || 0), 0);
  const result = {
    tested,
    killed,
    survivors: surv.length,
    excused: rawSurv - surv.length,
    refuted: refuted.length,
    orphaned,
    drifted,
    stale,
    notDecided,
    invalid: unrun,
    changedLines: lines,
    files: ok.length,
    skipped: results.length - ok.length
  };
  const pop = { checked: tested - unrun, eligible: tested, result };
  if (voided.length)
    return {
      code: 3,
      verdict: mk('UNKNOWN', { ...pop, reason: 'canary survived on ' + voided.map((r) => r.file).join(', ') + ' — kills were not being detected, so "all killed" would prove nothing' })
    };
  if (unrun)
    return { code: 3, verdict: mk('UNKNOWN', { ...pop, reason: unrun + ' of ' + tested + ' mutant(s) never ran (did not compile, or timed out under load) — nothing was proven about them' }) };
  if (refuted.length && !surv.length)
    return {
      code: 1,
      verdict: mk('FAIL', {
        ...pop,
        reason:
          refuted.length +
          ' equivalence entr(ies) REFUTED — a kill was recorded for a mutant the ledger says cannot be killed: ' +
          refuted
            .slice(0, 5)
            .map((e) => e.file + ':' + e.line + ' [' + e.op + ']')
            .join(', ') +
          (refuted.length > 5 ? ', …' : '') +
          ' — correct the entry in tools/mutate-equivalence.json'
      })
    };
  if (surv.length)
    return {
      code: 1,
      verdict: mk('FAIL', {
        ...pop,
        reason:
          surv.length +
          ' of ' +
          tested +
          ' mutant(s) on ' +
          lines +
          ' changed line(s) survived: ' +
          surv
            .slice(0, 5)
            .map((s) => s.file + ':' + s.line + ' [' + s.op + ']')
            .join(', ') +
          (surv.length > 5 ? ', …' : '')
      })
    };
  if (!tested)
    return {
      code: 0,
      verdict: mk('NOT_APPLICABLE', { ...pop, result: null, reason: lines + ' changed line(s) in ' + ok.length + ' file(s) carry no mutable operator — nothing to gate, not a pass over nothing' })
    };
  return { code: 0, verdict: mk('PASS', { ...pop, reason: null }) };
}
/* What the adoption gate runs: a synthetic result set through the real decision. Fixed `at`, no git. */
export function verdictSample() {
  return diffVerdict(
    [
      { file: 'clock.js', tested: 12, invalid: 0, killed: 12, survivors: [], voided: false, touchedLines: 4 },
      { file: 'oxydex-dsp.js', tested: 3, invalid: 0, killed: 3, survivors: [], voided: false, touchedLines: 1 }
    ],
    { base: 'origin/main', commit: null, commitReason: '--verdict-sample: synthetic result set, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  ).verdict;
}
function emitVerdict(v) {
  // VERDICT-CONTRACT §1: under --json the object is the last NDJSON line (it has no `file`, so the
  // per-file readers skip it by shape); otherwise one labelled line on stdout beside the prose.
  console.log(AS_JSON ? JSON.stringify(v) : 'VERDICT (tepna.verdict/1): ' + JSON.stringify(v));
}
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

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
  /* MEMORY DIMENSION (2026-09-14). The one-argument form must be BYTE-IDENTICAL to what it was, or
     this change silently re-sizes every platform that cannot report memory — so that is asserted
     first, against the same cases pinned above, rather than assumed from "the parameter is
     optional". */
  ok('unknown memory → the core-derived figure, unchanged', defaultJobs(24) === 16 && defaultJobs(24, null) === 16 && defaultJobs(24, undefined) === 16 && defaultJobs(24, 0) === 16);
  /* A machine with plenty of memory is still CORE-bound: 64 GB available would allow 37 workers at
     ~1 GiB and 60 %, and the answer must stay 16. The memory rule is a CEILING, never a licence. */
  ok('memory never RAISES the pool above the core figure', defaultJobs(24, 64 * 1024 ** 3) === 16, 'got ' + defaultJobs(24, 64 * 1024 ** 3));
  /* …and when memory is the binding constraint it WINS. 8 GB × 0.6 / 1 GiB = 4. This is the CI-runner
     and laptop case the core-derived form could not see at all. */
  ok('memory LOWERS the pool when it is the binding constraint', defaultJobs(24, 8 * 1024 ** 3) === 4, 'got ' + defaultJobs(24, 8 * 1024 ** 3));
  /* The incident's own numbers, as a regression: 23 GB available on the 24-core box gave 16 workers
     and a 16.57 GB peak. The same inputs must now give fewer. */
  ok('the 2026-09-13 shape now sizes DOWN (23 GB avail, 24 cores)', defaultJobs(24, 23 * 1024 ** 3) < 16, 'got ' + defaultJobs(24, 23 * 1024 ** 3));
  /* Too little memory for two workers takes the SERIAL path, symmetric with the 1-2 core rule — not
     a floor of 2 that would hand a starved box two full worktrees it cannot feed. */
  ok('memory too tight for two workers → serial', defaultJobs(24, 2 * 1024 ** 3) === 1, 'got ' + defaultJobs(24, 2 * 1024 ** 3));
  ok('…and the low-core rule still wins regardless of free memory', defaultJobs(2, 999 * 1024 ** 3) === 1);
  /* memAvailableBytes parses the real format and REFUSES rather than guessing. A reader that returned
     0 or NaN on a malformed file would be worse than one that returns null, because null restores the
     historical behaviour while a bogus number silently re-sizes the pool. */
  ok('memAvailableBytes parses MemAvailable in kB → bytes', memAvailableBytes(() => 'MemTotal:  100 kB\nMemAvailable:   2048 kB\n') === 2 * 1024 * 1024);
  ok('…returns null when the field is absent', memAvailableBytes(() => 'MemTotal: 100 kB\n') === null);
  ok(
    '…returns null instead of throwing when the file is unreadable',
    memAvailableBytes(() => {
      throw new Error('ENOENT');
    }) === null
  );
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
  /* ── 🔴 THE OPERATOR TABLE MUST ASSERT ITS OWN CONTENTS ────────────────────────────────────
     Reported by a peer scanning for tests that walk a pinned constant without pinning its size,
     and calibrated DOWN by them rather than filed as an alarm: total emptying already breaks the
     two `OPS.find` lookups below, so this table was never exposed to complete loss. The exposure
     is PARTIAL — drop every operator except those two and every assertion here still passes,
     while the sweep silently measures a fraction of the operator set and reports a kill rate for
     it as though it were the whole.

     ⚠️ A `length > 0` FLOOR WOULD BE THE SAME DEFECT ONE LEVEL UP. The set is asserted by NAME,
     not by count, so a silent addition is caught as well as a removal — a new operator that
     nobody scored is the same lie as a missing one, in the other direction. */
  const OP_NAMES = OPS.map((o) => o.name)
    .sort()
    .join(' | ');
  ck(
    'the operator set is exactly the ten that are scored',
    OP_NAMES,
    ['bool && → ||', 'bool || → &&', 'cmp < → <=', 'cmp <= → <', 'cmp > → >=', 'cmp >= → >', 'eq !== → ===', 'eq === → !==', 'negate: drop !', 'num → 0'].sort().join(' | ')
  );
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

  /* classifySurvivors -- the equivalence split. PURE, so it is pinned here by known answer rather
     than by a sweep. Every branch is exercised, including the three that exist to stop this mechanism
     becoming the "gate that silently excuses whatever it cannot kill" the header warns against. */
  const M = (line, op, before) => ({ line, op, before });
  const genAll = [M(1, 'cmp < → <=', 'a'), M(2, 'cmp > → >=', 'b'), M(3, 'bool && → ||', 'c'), M(4, 'num → 0', 'd')];
  const survived = [M(1, 'cmp < → <=', 'a'), M(3, 'bool && → ||', 'c'), M(4, 'num → 0', 'd')];
  const entries = [
    { line: 1, op: 'cmp < → <=', before: 'a', class: 'no-distinguishing-input' }, // survived + excusing => excused
    { line: 2, op: 'cmp > → >=', before: 'b', class: 'no-distinguishing-input' }, // KILLED but claimed equivalent => refuted
    { line: 3, op: 'bool && → ||', before: 'c', class: 'real-gap' }, // survived but debt, stays countable
    { line: 9, op: 'cmp < → <=', before: 'z', class: 'untestable-by-design' } // matches nothing => orphaned
  ];
  const cls = classifySurvivors(entries, survived, genAll, [M(2, 'cmp > → >=', 'b')]);
  ck('classify · an excusing class that SURVIVED is excused', cls.excused.length, 1);
  ck('classify · an excusing class that was KILLED is REFUTED, never absorbed', cls.refuted.length, 1);
  ck('classify · a real-gap survivor is NOT excused', cls.realGap.length, 1);
  ck('classify · an entry matching no generated mutant is ORPHANED', cls.orphaned.length, 1);
  ck('classify · a survivor with no entry is UNCLASSIFIED, never assumed equivalent', cls.unclassified.length, 1);
  ck('classify · …and it is the one nobody wrote down', cls.unclassified[0].line, 4);
  /* The anti-laundering property, stated as a test: only the excusing classes leave the denominator,
     so a `real-gap` entry cannot be used to improve a rate. */
  ck(
    'classify · real-gap does not leave the denominator',
    cls.excused.some((e) => e.class === 'real-gap'),
    false
  );
  /* `equivalent` is the STRONGEST claim in the vocabulary and must excuse. It did not until
     2026-09-07: being neither excusing nor `real-gap`, it fell through to the `else` and was reported
     as a real gap — telling a reader to write a test for a mutant that carries a proof no such test
     exists, and keeping it in the denominator. Pinned in BOTH directions, because the failure was
     invisible in one: the entry appeared in `realGap` (a plausible place) rather than nowhere. */
  const eqGen = [M(5, 'cmp <= → <', 'e')];
  const eqCls = classifySurvivors([{ line: 5, op: 'cmp <= → <', before: 'e', class: 'equivalent' }], eqGen, eqGen);
  ck('classify · a proven-equivalent survivor is EXCUSED', eqCls.excused.length, 1);
  ck('classify · …and is NOT reported as a real gap', eqCls.realGap.length, 0);

  /* ⚠️ ABSENCE IS NOT A KILL (residue 2026-10-05-the-js-diff-gate-ignores-the-equivalence-ledger).
     The same entries, the same generated set, but NO recorded kill: the claim on line 2 is unmeasured —
     an INVALID mutant, a quarantined jammer or a partial run all look exactly like this — so it must
     land in notDecided and never in refuted. */
  const absent = classifySurvivors(entries, survived, genAll);
  ck('classify · generated, not a survivor, NO recorded kill ⇒ NOT DECIDED, never refuted', absent.refuted.length + ':' + absent.notDecided.length, '0:1');
  ck('classify · …and a kill recorded for a DIFFERENT mutant refutes nothing here', classifySurvivors(entries, survived, genAll, [M(1, 'cmp < → <=', 'a')]).refuted.length, 0);
  ck(
    'classify · a non-excusing (real-gap) entry that was killed is debt paid, not refuted',
    classifySurvivors([{ line: 2, op: 'cmp > → >=', before: 'b', class: 'real-gap' }], [], genAll, [M(2, 'cmp > → >=', 'b')]).refuted.length,
    0
  );
  /* ⚠️ THE ORPHAN COUNTER CARRIED TWO MEANINGS (residue
     2026-10-19-an-equivalence-excuse-keyed-to-a-line-lapses-on-drift). An entry keys on an absolute
     line, so any edit ABOVE it detaches the excuse. That read exactly like the ordinary diff-run
     orphan — an entry on a line the change never touched — and the one number blocks nothing, so
     363 of 434 committed entries excused nothing and nobody could see it. */
  const drFile = [M(1, 'cmp < → <=', 'a'), M(7, 'bool && → ||', 'c')]; // `c` now sits at L7
  const drEnt = [
    { line: 3, op: 'bool && → ||', before: 'c', class: 'equivalent' }, // the identical mutant moved ⇒ DRIFTED
    { line: 9, op: 'num → 0', before: 'q', class: 'equivalent' } // nothing like it in the file ⇒ STALE
  ];
  const drCls = classifySurvivors(drEnt, [], drFile, [], drFile);
  ck('classify · an entry whose identical mutant MOVED is drifted, and a vanished one is stale', drCls.drifted.length + ':' + drCls.stale.length, '1:1');
  ck('classify · …and drift names the line it moved to, so a re-anchor needs no second enumeration', String(drCls.drifted[0].foundAtLines), '7');
  ck('classify · the two causes PARTITION orphaned, which keeps its old meaning for old readers', drCls.orphaned.length, 2);
  /* The diff-run case, which is the one that hid: `generated` is the TOUCHED subset, so an entry on
     an untouched line is orphaned and must read as neither cause. Calling it drift would cry wolf on
     every diff run, which is why the whole-file enumeration is a separate argument. */
  const scoped = classifySurvivors([{ line: 1, op: 'cmp < → <=', before: 'a', class: 'equivalent' }], [], [M(7, 'bool && → ||', 'c')], [], drFile);
  ck('classify · a diff run does not call an UNTOUCHED entry drifted', scoped.orphaned.length + ':' + scoped.drifted.length + ':' + scoped.stale.length, '1:0:0');
  /* DECOY · the caller that cannot say what the file holds. From the tested subset alone "out of
     scope" and "the code is gone" are the same bytes, so a cause here would be invented. Fail closed. */
  const noFile = classifySurvivors([{ line: 1, op: 'cmp < → <=', before: 'a', class: 'equivalent' }], [], [M(7, 'bool && → ||', 'c')]);
  ck('classify · DECOY no whole-file enumeration ⇒ an orphan with NO cause, never a guessed one', noFile.orphaned.length + ':' + noFile.drifted.length + ':' + noFile.stale.length, '1:0:0');
  ck('classify · the text key drops the line and keeps `after`, so a collision cannot excuse its twin', survivorTextKey({ line: 5, op: 'num → 0', before: 'b', after: 'c' }), 'num → 0\u0000b\u0000c');
  /* blockingSurvivors -- what the diff gate subtracts: ONLY survivors an excusing entry covers. */
  /* THE COST PROJECTION — pure, and printed in every mode since the gate's own mode is `--json`.
     The figures are the ones measured on #3506: see phaseNote's header for the run behind them. */
  ck(
    'phases · the projection names the calibration, the per-mutant estimate and the job count',
    phaseNote({ file: 'oxydex-dsp.js', baseMs: 82000, estMs: 553000, jobs: 4 }),
    '  oxydex-dsp.js  calibration 82 s/run → per-mutant pass est 553 s at 4 job(s)'
  );
  ck(
    'phases · a sub-10-second calibration keeps its decimal, so a cheap file is not priced at 0 s',
    phaseNote({ file: 'b.js', baseMs: 5000, estMs: 4000, jobs: 2 }).includes('calibration 5.0 s/run'),
    true
  );
  ck('phases · one job is reported as one, never collapsed to the plural', phaseNote({ file: 'c.js', baseMs: 1000, estMs: 1000, jobs: 1 }).includes('at 1 job(s)'), true);
  const blk = blockingSurvivors(cls, survived);
  ck('blocking · the excused survivor leaves, the real-gap and the unclassified one stay', blk.map((x) => x.line).join(','), '3,4');
  ck('blocking · no classification excuses nothing', blockingSurvivors({ excused: [] }, survived).length, 3);
  ck('blocking · an undefined survivor list is empty, not a crash', blockingSurvivors(cls, undefined).length, 0);

  /* An empty classification must change nothing -- the mechanism is opt-in per file. */
  const none = classifySurvivors(undefined, survived, genAll);
  ck('classify · no entries ⇒ every survivor unclassified, nothing excused', none.unclassified.length + ':' + none.excused.length, '3:0');

  /* ── incremental · groupBodies + mayReuse ───────────────────────────────────────────────────── */
  const GB = groupBodies("group('alpha', 'tag', function (T) { a({ b: 1 }); });\ngroup(\"beta\", 't', function (T) { c(); });");
  ck('groups · both titles are found', [...GB.keys()].join(','), 'alpha,beta');
  ck('groups · a body with NESTED braces is captured whole', GB.get('alpha').includes('{ b: 1 }'), true);
  ck('groups · …and stops at its own closing brace', GB.get('alpha').endsWith('}'), true);
  ck('groups · an empty source yields nothing', groupBodies('').size, 0);

  const H = new Map([['G', 'ghash']]);
  ck('reuse · a KILLED mutant with matching function + group hashes is reusable', mayReuse({ v: 'KILLED', fh: 'f', ks: ['G'], gh: { G: 'ghash' } }, 'f', H), true);
  ck('reuse · …but NOT if the function source moved', mayReuse({ v: 'KILLED', fh: 'OLD', ks: ['G'], gh: { G: 'ghash' } }, 'f', H), false);
  ck('reuse · …NOT if the killing group was edited', mayReuse({ v: 'KILLED', fh: 'f', ks: ['G'], gh: { G: 'STALE' } }, 'f', H), false);
  ck('reuse · …NOT if the killing group is gone', mayReuse({ v: 'KILLED', fh: 'f', ks: ['GONE'], gh: { GONE: 'x' } }, 'f', H), false);
  /* THE LOAD-BEARING REFUSAL: a survivor can be killed by any newly added group, so reusing it would
     record a mutant as alive that the new test already kills — a wrong number wearing the shape of
     progress. Survivors and invalids are ALWAYS re-tested. */
  ck('reuse · a SURVIVED verdict is never reusable, however unchanged', mayReuse({ v: 'SURVIVED', fh: 'f', ks: ['G'], gh: { G: 'ghash' } }, 'f', H), false);
  ck('reuse · an INVALID verdict is never reusable', mayReuse({ v: 'INVALID', fh: 'f', ks: ['G'], gh: { G: 'ghash' } }, 'f', H), false);
  ck('reuse · a kill with no named killer cannot be verified, so is re-tested', mayReuse({ v: 'KILLED', fh: 'f', ks: [], gh: {} }, 'f', H), false);
  /* ── readJournal · resume + the JAMMED-mutant detection ─────────────────────────────────────
     The whole point of the two-record scheme: a `start` with no verdict is the mutant that was in
     flight when the process died, i.e. the one that jammed. Retrying it turns one jam into an
     infinite loop across restarts, so it must be QUARANTINED and reported. */
  const J = readJournal(['{"k":"a"}', '{"k":"a","v":"KILLED"}', '{"k":"JAMMER"}', '{"k":"c","v":"SURVIVED"}', '{"k":"d","v":"INVALID"}', '{"k":"tor'].join('\n'));
  ck('journal · a finished mutant is recorded with its verdict', J.done.get('a').v, 'KILLED');
  ck('journal · every verdict kind round-trips', J.done.get('c').v + '/' + J.done.get('d').v, 'SURVIVED/INVALID');
  ck('journal · ONE unfinished start is a RETRY, not a jam (it was merely in flight)', J.retry.join(','), 'JAMMER');
  ck('journal · …and nothing is quarantined on a single interrupt', J.jammed.length, 0);
  ck('journal · …and a finished mutant is neither', J.jammed.includes('a') || J.retry.includes('a'), false);
  /* TWO unfinished starts means it was retried and hung again — that is the jam. */
  const J2 = readJournal(['{"k":"J"}', '{"k":"J"}', '{"k":"ok"}', '{"k":"ok","v":"KILLED"}'].join('\n'));
  ck('journal · TWO unfinished starts IS the jam', J2.jammed.join(','), 'J');
  ck('journal · …and it is no longer offered for retry', J2.retry.length, 0);
  ck('journal · a mutant that finished after a retry is done, not jammed', readJournal('{"k":"x"}\n{"k":"x"}\n{"k":"x","v":"KILLED"}').jammed.length, 0);
  ck('journal · a TORN final line is ignored, not fatal', J.done.has('tor') || J.jammed.includes('tor'), false);
  ck('journal · an empty journal yields nothing to skip', readJournal('').done.size + ':' + readJournal('').jammed.length, '0:0');
  ck('journal · junk lines are skipped', readJournal('not json\n{"k":"z","v":"KILLED"}').done.get('z').v, 'KILLED');
  ck('journal · a record with no key is ignored', readJournal('{"v":"KILLED"}').done.size, 0);

  /* GAP 1 - hang quarantine: a silent mutant is QUARANTINED in-process, not retried into a stall */
  ck(
    'quarantine - a QUARANTINED journal record is done, never retried, never re-jammed',
    (() => {
      const q = readJournal('{"k":"q"}\n{"k":"q","v":"QUARANTINED","r":"no-progress"}');
      return q.done.get('q').v + ':' + q.jammed.length + ':' + q.retry.length;
    })(),
    'QUARANTINED:0:0'
  );
  ck('quarantine - the honest denominator excludes quarantined as well as invalid', measuredDenominator({ tested: 60, invalid: 3, quarantined: 2 }), 55);
  ck('quarantine - the warning fires on any quarantine and stays silent at zero', (quarantineWarning(0, 60, 300000) === null) + ':' + (quarantineWarning(2, 60, 300000) !== null), 'true:true');

  /* GAP 2 - journal scope header: resume across a changed scope must refuse, fail-closed */
  ck(
    'scope - the header round-trips through the journal',
    (() => {
      const s = buildScope({ file: 'x-dsp.js', limit: 60, filter: 'x', bail: true, full: false, only: null, diff: null });
      return readScopeHeader(JSON.stringify(s) + '\n{"k":"a"}').file;
    })(),
    'x-dsp.js'
  );
  ck('scope - a journal without a header reads as unverifiable, never as matching', readScopeHeader('{"k":"a"}' + '\n' + '{"k":"a","v":"KILLED"}'), null);
  ck(
    'scope - a changed --limit is a mismatch that must refuse resume',
    scopeDiff(
      buildScope({ file: 'x-dsp.js', limit: 60, filter: 'x', bail: true, full: false, only: null, diff: null }),
      buildScope({ file: 'x-dsp.js', limit: 30, filter: 'x', bail: true, full: false, only: null, diff: null })
    ).length > 0,
    true
  );
  ck(
    'scope - identical scopes diff clean',
    scopeDiff(
      buildScope({ file: 'x-dsp.js', limit: 60, filter: 'x', bail: true, full: false, only: null, diff: null }),
      buildScope({ file: 'x-dsp.js', limit: 60, filter: 'x', bail: true, full: false, only: null, diff: null })
    ).length,
    0
  );

  /* GAP 3 - section 2.13 compliance manifest: one line per clause, met/n-a/missing */
  ck('compliance - one line per clause of the standard', complianceManifest(null).clauses.length, 13);
  ck(
    'compliance - every clause carries a closed status',
    complianceManifest(null).clauses.every((c) => ['met', 'n/a', 'missing'].indexOf(c.status) >= 0),
    true
  );
  ck(
    'compliance - an n/a clause states its reason (never a bare n/a)',
    complianceManifest(null)
      .clauses.filter((c) => c.status === 'n/a')
      .every((c) => typeof c.reason === 'string' && c.reason.trim().length > 0),
    true
  );

  /* KEY UNIQUENESS — the collision that reached main (see findCanary's header). Both mutants are the
     same operator on the same line with identical `before` text: pulsedex-dsp.js:197's `<= 1500`
     threshold and its `Math.max(0.55, …)` floor. */
  const _collide = [
    { line: 197, op: 'num → 0', before: 'return elevM <= 1500 ? 1 : Math.max(0.55', after: 'return elevM <= 0 ? 1 : Math.max(0.55' },
    { line: 197, op: 'num → 0', before: 'return elevM <= 1500 ? 1 : Math.max(0.55', after: 'return elevM <= 1500 ? 1 : Math.max(0' }
  ];
  ck('key · a canary picks the mutant whose AFTER matches, not the first on the line', findCanary(_collide, _collide[1]).after, _collide[1].after);
  ck('key · …and the other one is still reachable', findCanary(_collide, _collide[0]).after, _collide[0].after);
  ck('key · a LEGACY canary with no `after` REFUSES a collided line rather than guessing', findCanary(_collide, { line: 197, op: 'num → 0', before: _collide[0].before }), null);
  ck('key · a legacy canary still matches where there is NO collision', findCanary([_collide[0]], { line: 197, op: 'num → 0', before: _collide[0].before }).after, _collide[0].after);
  ck('key · classifySurvivors keeps two same-op mutants on one line APART', classifySurvivors(_collide, [_collide[0]], _collide).realGap.length, 1);

  /* ── §E4b · selectRecorded — survivors-only re-testing, and the refusals that make it safe ──────
     The point of the shortcut is a smaller denominator ON PURPOSE. That is exactly why every way of
     silently getting an even smaller one has to be a refusal: a partial re-test and a complete one
     look identical in the output, differing only in a number nobody can check. */
  ck('E4b · a recorded list selects exactly its own mutants', selectRecorded(_collide, [_collide[1]]).picked.length, 1);
  ck('E4b · …and it is the RIGHT one — `after` disambiguates the documented collision', selectRecorded(_collide, [_collide[1]]).picked[0].after, _collide[1].after);
  ck('E4b · the other collided mutant is separately selectable', selectRecorded(_collide, [_collide[0]]).picked[0].after, _collide[0].after);
  /* THE COLLISION REFUSAL. `line \0 op \0 before` is not unique — pulsedex-dsp.js:197 — and in
     2026-08-25 a draft fused one mutant's input with the OTHER's output and reached main. A list
     entry that cannot name one mutant must not test the first match. */
  const _legacyEntry = { line: 197, op: 'num → 0', before: _collide[0].before, after: undefined };
  ck('E4b · an entry that cannot name ONE mutant is REFUSED, not resolved to the first', selectRecorded(_collide, [_legacyEntry]).ok, false);
  ck('E4b · …and the refusal is reported as a MISS, with nothing selected', selectRecorded(_collide, [_legacyEntry]).picked.length, 0);
  /* A key that genuinely collides on all four fields (a duplicated generation) is ambiguous, not a
     miss — different cause, different message, both refusals. */
  const _dup = [_collide[0], { ..._collide[0] }];
  ck('E4b · a 4-field key matching TWO mutants is AMBIGUOUS, and refuses', selectRecorded(_dup, [_collide[0]]).ambiguous.length, 1);
  /* AN ENTRY MATCHING NOTHING MEANS THE SOURCE MOVED. The recorded list no longer describes the
     file, so the caller must sweep cold — which is what §E4's crawlPlan already decides on a moved
     srcHash. Testing the rest anyway would report a smaller denominator as a complete answer. */
  ck('E4b · an entry matching no current mutant refuses the run', selectRecorded(_collide, [{ line: 999, op: 'num → 0', before: 'gone', after: 'gone' }]).ok, false);
  ck(
    'E4b · …and says the source moved rather than "0 survivors"',
    /no mutant with this/.test(selectRecorded(_collide, [{ line: 999, op: 'num → 0', before: 'gone', after: 'gone' }]).missing[0].why),
    true
  );
  ck('E4b · a malformed entry is a refusal, never a skip', selectRecorded(_collide, [{ op: 'num → 0' }]).ok, false);
  /* NULL CONTROL: the full recorded list selects the full population and refuses nothing. A selector
     that cannot reproduce "everything" is not selecting, it is filtering by accident. */
  const _full = selectRecorded(_collide, _collide);
  ck('NULL CONTROL · the complete list selects every mutant', _full.picked.length, _collide.length);
  ck('NULL CONTROL · …and refuses nothing', _full.ok, true);
  ck('E4b · a duplicated entry does not double-count its mutant', selectRecorded(_collide, [_collide[0], _collide[0]]).picked.length, 1);

  console.log('\none record builder — runFile returns through ONE object literal, on every path');
  {
    /* `runFile` built its result in TWO places — the main tail and the degraded serial fallback — and
       a field added to one reached neither the other nor any check. `killedMutants` hit it in #3717,
       and `equivalence` had been missing from the degraded record the whole time. The record's own
       signature keys ARE the tripwire: a second object literal carrying them is a second builder,
       whatever it is called. `groupsRun` and `killedMutants` read 2 on the code this replaced. */
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const sites = (k) => (self.match(new RegExp('^\\s+' + k + ':', 'gm')) || []).length;
    for (const k of ['groupsRun', 'killedMutants', 'equivalence', 'canary', 'voided', 'jobs', 'calibrationMs']) {
      ok('the result record builds `' + k + '` in exactly ONE place', sites(k) === 1, 'sites=' + sites(k));
    }
    /* WHY one builder is worth a gate, in one assertion: the void filter reads a KEY, so a record
       built without it is not "void and reported" — it is a run the gate cannot tell from a measured
       one. The degraded builder also published `killed` raw where the main one nulls it. The other
       half of this pair is the `voided: true` case in the verdict section below, which reads UNKNOWN. */
    const degradedShape = { file: 'clock.js', tested: 12, invalid: 0, killed: 12, touchedLines: 4, survivors: [{ line: 7, op: 'num → 0', before: 'a', after: 'b' }] };
    const blind = diffVerdict([degradedShape], { base: 'origin/main', commit: 'ec4e2d93', at: '2026-09-22T00:00:00Z' });
    ok('a record with NO `voided` key escapes the void filter entirely', blind.verdict.status !== 'UNKNOWN', blind.verdict.status);
  }

  console.log('\nverdict — tepna.verdict/1 at every diff-gate exit, pinned against verdict.js');
  {
    const V = createRequire(import.meta.url)('../verdict.js');
    const row = (over) => ({ file: 'a.js', tested: 10, invalid: 0, killed: 10, survivors: [], voided: false, touchedLines: 3, ...over });
    const meta = { base: 'origin/main', commit: 'ec4e2d93', at: '2026-09-22T00:00:00Z' };
    const val = (v) => V.validate(v).ok || V.validate(v).errors.join(' | ');
    const pass = diffVerdict([row()], meta);
    ck('all killed → PASS, exit 0', pass.verdict.status + ':' + pass.code, 'PASS:0');
    ck('…valid under verdict.js', val(pass.verdict), true);
    ck('…population is an equality over mutants', JSON.stringify(pass.verdict.population), '{"checked":10,"eligible":10,"excluded":0}');
    ck('…scope internal (P5)', pass.verdict.scope, 'internal');
    /* THE LEDGER IS READ BY THE DIFF GATE (residue …-the-js-diff-gate-ignores-the-equivalence-ledger…).
       A survivor an entry excuses leaves the blocking list: a fully drained file is PASS, not FAIL. */
    const _s7 = { line: 7, op: 'num → 0', before: 'x', after: 'y' };
    const drained = diffVerdict([row({ killed: 9, survivors: [_s7], equivalence: { blocking: [], refuted: [], orphaned: [], notDecided: [] } })], meta);
    ck('every survivor EXCUSED by the ledger → PASS, exit 0 (was FAIL on the raw count)', drained.verdict.status + ':' + drained.code, 'PASS:0');
    ck('…the excused one is counted in the result, not hidden', drained.verdict.result.excused + ':' + drained.verdict.result.survivors, '1:0');
    ck('…valid', val(drained.verdict), true);
    const stillBlocks = diffVerdict([row({ killed: 9, survivors: [_s7], equivalence: { blocking: [_s7], refuted: [], orphaned: [], notDecided: [] } })], meta);
    ck('a survivor the ledger does NOT excuse still FAILS', stillBlocks.verdict.status + ':' + stillBlocks.code + ':' + /a\.js:7/.test(stillBlocks.verdict.reason), 'FAIL:1:true');
    const _ref = { line: 9, op: 'cmp > → >=', class: 'equivalent', before: 'b' };
    const refuted = diffVerdict([row({ equivalence: { blocking: [], refuted: [_ref], orphaned: [], notDecided: [] } })], meta);
    ck(
      'a REFUTED entry (a recorded kill against a claimed-equivalent mutant) → FAIL, exit 1, names it',
      refuted.verdict.status + ':' + refuted.code + ':' + /REFUTED.*a\.js:9/.test(refuted.verdict.reason),
      'FAIL:1:true'
    );
    ck('…valid', val(refuted.verdict), true);
    const quiet = diffVerdict([row({ equivalence: { blocking: [], refuted: [], orphaned: [_ref, _ref], notDecided: [_ref] } })], meta);
    ck('ORPHANED and NOT-DECIDED entries are REPORTED in the result and block nothing', quiet.verdict.status + ':' + quiet.verdict.result.orphaned + ':' + quiet.verdict.result.notDecided, 'PASS:2:1');
    /* The cause rides beside the union at verdict level too, because the verdict object is the API
       and the prose is not. Both stay non-blocking: a drift is recoverable and a stale entry owes
       re-verification, and neither is evidence about the diff under test. */
    const causes = diffVerdict([row({ equivalence: { blocking: [], refuted: [], orphaned: [_ref, _ref, _ref], drifted: [_ref], stale: [_ref], notDecided: [] } })], meta);
    ck('…and the verdict reports WHY, which one counter could not', causes.verdict.status + ':' + causes.verdict.result.drifted + ':' + causes.verdict.result.stale, 'PASS:1:1');
    ck('…a record from before the split still verdicts, with the causes at zero', quiet.verdict.result.drifted + ':' + quiet.verdict.result.stale, '0:0');
    const f = diffVerdict([row({ killed: 9, survivors: [{ line: 7, op: 'num → 0', before: 'x' }] })], meta);
    ck('a survivor → FAIL, exit 1, reason names it', f.verdict.status + ':' + f.code + ':' + /a\.js:7/.test(f.verdict.reason), 'FAIL:1:true');
    ck('…valid', val(f.verdict), true);
    const u = diffVerdict([row({ invalid: 2, killed: 8 })], meta);
    ck('never-ran mutants → UNKNOWN (not a kill, not a pass), exit 3', u.verdict.status + ':' + u.code, 'UNKNOWN:3');
    ck('…excluded = the invalid ones', u.verdict.population.excluded, 2);
    ck('…valid', val(u.verdict), true);
    const vd = diffVerdict([row({ voided: true, killed: 10, survivors: [{ line: 1, op: 'x', before: 'y' }] })], meta);
    ck('canary survived outranks survivors → UNKNOWN, exit 3', vd.verdict.status + ':' + vd.code + ':' + /canary/.test(vd.verdict.reason), 'UNKNOWN:3:true');
    const na = diffVerdict([row({ tested: 0, killed: 0 })], meta);
    ck('changed lines with no mutant → NOT_APPLICABLE, exit 0 — never PASS over checked 0', na.verdict.status + ':' + na.code + ':' + na.verdict.result, 'NOT_APPLICABLE:0:null');
    ck('…valid', val(na.verdict), true);
    const nr = diffVerdict([{ file: 'a.js', error: 'ENOENT' }], meta);
    ck('every file errored → NOT_RUN with the error in the reason', nr.verdict.status + ':' + /ENOENT/.test(nr.verdict.reason), 'NOT_RUN:true');
    ck('…valid', val(nr.verdict), true);
    const smp = verdictSample();
    ck(
      '--verdict-sample: PASS over the synthetic set, no commit claimed, reason says synthetic',
      smp.status + ':' + smp.producedBy.commit + ':' + /synthetic/.test(smp.producedBy.commitReason),
      'PASS:null:true'
    );
    ck('…valid', val(smp), true);
    let threw = null;
    try {
      verdictObject('GREEN', { checked: 1, eligible: 1, result: {}, reason: null, evidence: [] });
    } catch (e) {
      threw = e.message;
    }
    ck('an eighth status word is refused by the builder, not just the validator', /closed enum/.test(threw), true);
    threw = null;
    try {
      verdictObject('PASS', { checked: 1, eligible: 1, result: {}, reason: 'fine', evidence: [] });
    } catch (e) {
      threw = e.message;
    }
    ck('PASS with a reason is refused', /reason: null/.test(threw), true);
  }

  /* ── SIGTERM MID-MUTANT: THE FILE COMES BACK, AND THE SENTINEL SAYS WHAT WAS UNDONE ────────────
     2026-09-28: a sweep was SIGTERMed by its unit's timeout and SIGKILLed 90 s later, leaving a live
     `&&`→`||` in `pulsedex-dsp.js` in the SHARED root — found by reading a one-character diff. The
     restore machinery existed; what it did not do was say what it had undone, and on the run that
     mattered it did not run at all.

     Driven as a REAL CHILD because a handler cannot be tested in-process: the assertion is that a
     signalled process restores before it dies. Scratch copy, never the repo's own file. */
  {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-sigterm-'));
    const target = join(dir, 'victim.js');
    const ORIGINAL = 'export const f = (a, b) => a && b;\n';
    writeFileSync(target, ORIGINAL);
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const {writeFileSync}=require('node:fs');
         const t=${JSON.stringify(target)};
         writeFileSync(t+'.mutate-backup', ${JSON.stringify(ORIGINAL)});
         writeFileSync(t, ${JSON.stringify(ORIGINAL.replace('&&', '||'))});
         process.on('SIGTERM',()=>{ writeFileSync(t, require('node:fs').readFileSync(t+'.mutate-backup','utf8'));
           require('node:fs').writeFileSync(${JSON.stringify(join(dir, MUTANT_SENTINEL))},
             JSON.stringify({undone:[{file:t,mutant:'logical at line 1: && → ||'}]})); process.exit(143); });
         console.log('applied'); setInterval(()=>{},1000);`
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let applied = false;
    child.stdout.on('data', () => {
      applied = true;
    });
    const waited = Date.now();
    while (!applied && Date.now() - waited < 10000) execFileSync('sleep', ['0.05']);
    ck('ANTI-VACUITY · the child really did put a mutant on disk before the signal', readFileSync(target, 'utf8') !== ORIGINAL, true);
    child.kill('SIGTERM');
    const t1 = Date.now();
    while (readFileSync(target, 'utf8') !== ORIGINAL && Date.now() - t1 < 10000) execFileSync('sleep', ['0.05']);
    ck('a SIGTERMed sweep restores the file BYTE-IDENTICALLY', readFileSync(target, 'utf8'), ORIGINAL);
    ck('…and leaves a sentinel naming the mutant it undid', existsSync(join(dir, MUTANT_SENTINEL)), true);
    if (existsSync(join(dir, MUTANT_SENTINEL))) {
      const s = JSON.parse(readFileSync(join(dir, MUTANT_SENTINEL), 'utf8'));
      ck('…with the operator and the line, not just a filename', /line 1/.test(s.undone[0].mutant) && /&&/.test(s.undone[0].mutant), true);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }

  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

/* HANDLERS ARE REGISTERED ONCE, FOR THE PROCESS — not per file.
   The per-file version leaked five listeners per file and a 71-file sweep tripped Node's
   MaxListenersExceededWarning at 11 uncaughtException listeners. Same restore semantics, one
   registration, and an explicit registry of what is currently dirty. */
const _dirty = new Map(); // absolute path → original text
/* WHICH MUTANT WAS ON DISK WHEN WE WERE INTERRUPTED. Restoring silently is not enough: on 2026-09-28
   a sweep was SIGKILLed 90 s after SIGTERM and `pulsedex-dsp.js` was left carrying a live `&&`→`||`
   that had to be found by reading a one-character diff in a shared root. A restore that names what it
   undid turns that search into a sentence. */
const _inFlight = new Map(); // absolute path → a human label for the mutant currently applied
export const MUTANT_SENTINEL = '.mutate-interrupted.json';
function restoreAll(why) {
  const undone = [];
  for (const [abs, original] of _dirty) {
    try {
      writeFileSync(abs, original);
      undone.push({ file: abs, mutant: _inFlight.get(abs) || null });
    } catch (e) {
      /* A restore that FAILED is the one thing a reader must not miss, so it is recorded as failed
         rather than omitted — an absent entry would read as "this file was fine" (§∅). */
      undone.push({ file: abs, mutant: _inFlight.get(abs) || null, restored: false, error: String(e.message).slice(0, 200) });
    }
    try {
      rmSync(abs + '.mutate-backup', { force: true });
    } catch {}
  }
  if (undone.length) {
    try {
      writeFileSync(join(ROOT, MUTANT_SENTINEL), JSON.stringify({ at: new Date().toISOString(), why: why || 'interrupted', pid: process.pid, undone }, null, 2) + '\n');
    } catch {}
  }
  _dirty.clear();
  _inFlight.clear();
}
for (const sg of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'])
  process.on(sg, () => {
    restoreAll(sg);
    dropPool();
    process.exit(sg === 'SIGINT' ? 130 : 143);
  });
process.on('uncaughtException', (e) => {
  restoreAll('uncaughtException: ' + String(e && e.message).slice(0, 120));
  dropPool();
  throw e;
});

/* The recovery lives in `tools/mutate-recover.mjs` so the CRAWL can call the same code at its own
   startup. See that file for why a second copy was the wrong fix. */
recoverStale(ROOT);

if (has('--selftest')) process.exit(selftest());
if (has('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 1));
  process.exit(0);
}

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
    emitVerdict(
      verdictObject('NOT_RUN', {
        checked: 0,
        eligible: 0,
        result: null,
        reason:
          'cannot diff against ' +
          DIFF_BASE +
          ': ' +
          String(e.message || e)
            .split('\n')[0]
            .slice(0, 120),
        evidence: ['tools/mutate.mjs'],
        commit: headCommit(),
        base: DIFF_BASE
      })
    );
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
    emitVerdict(
      verdictObject('NOT_APPLICABLE', {
        checked: 0,
        eligible: 0,
        result: null,
        reason: 'no mutable JS source changed vs ' + DIFF_BASE + ' (' + DIFF_LINES.size + ' file(s) in the diff) — the criterion does not bind',
        evidence: ['tools/mutate.mjs'],
        commit: headCommit(),
        base: DIFF_BASE
      })
    );
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
if (DIFF && !DRY) {
  let planned = 0;
  for (const f of files) {
    try {
      const t = DIFF_LINES.get(f);
      planned += mutantsFor(readFileSync(join(ROOT, f), 'utf8')).filter((m) => !t || t.has(m.line)).length;
    } catch {}
  }
  const each = FULL ? 461 : 180; // seconds/mutant, measured; bail makes KILLED ones far cheaper
  const mins = Math.round((planned * each) / Math.max(1, JOBS) / 60);
  /* STDERR, so `--json` carries the plan without a stray line in the NDJSON stream stdout owes its
     consumers. A plan is worth more to the run that gets cancelled than to the one that finishes. */
  process.stderr.write('  diff gate: ' + planned + ' mutant(s) on ' + [...DIFF_LINES.values()].reduce((a, s) => a + s.size, 0) + ' changed line(s) in ' + files.length + ' file(s)\n');
  process.stderr.write('  worst case ~' + mins + ' min at ' + JOBS + ' job(s); killed mutants return in seconds with bail' + (BAIL ? '' : ' (currently OFF)') + '\n\n');
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
  const measured = measuredDenominator(r);
  const score = measured ? ((r.killed / measured) * 100).toFixed(0) : '—';
  console.log(
    '  ' + r.file + '   groups: ' + r.groupsRun + ' (' + r.groupCount + ' tagged' + (r.groupsSelected != null && r.groupsSelected !== r.groupCount ? ', ' + r.groupsSelected + ' RUN' : '') + ')'
  );
  console.log('    generated ' + r.generated + ', tested ' + r.tested + ' → killed ' + r.killed + ', survived ' + r.survivors.length + ', invalid ' + r.invalid + '   [' + score + ' % killed]');
  /* THE DISTINGUISHABLE RATE, printed beside the raw one rather than replacing it. A reader must be
     able to see both denominators and the gap between them -- that gap IS the finding. */
  const eq = r.equivalence;
  if (eq && (eq.excused || eq.realGap || eq.unclassified || eq.refuted.length || eq.orphaned.length || (eq.notDecided && eq.notDecided.length))) {
    const dScore = eq.distinguishable > 0 ? ((r.killed / eq.distinguishable) * 100).toFixed(0) : '\u2014';
    console.log(
      '    equivalence: ' + eq.excused + ' excused, ' + eq.realGap + ' real-gap, ' + eq.unclassified + ' UNCLASSIFIED' + '   [' + dScore + ' % of ' + eq.distinguishable + ' distinguishable]'
    );
    /* A refuted entry is the one failure this mechanism could hide a real gap behind, so it shouts.
       The fix is always to correct the entry -- never to weaken the test that killed it. */
    for (const e of eq.refuted)
      console.log(
        '      \u26a0 REFUTED  ' +
          r.file +
          ':' +
          e.line +
          '  [' +
          e.op +
          '] is classified "' +
          e.class +
          '" but was KILLED.\n' +
          '        A distinguishing input exists after all. Correct the entry in tools/mutate-equivalence.json.'
      );
    // generated, not a survivor, and NO recorded kill: unmeasured, so neither excused nor refuted
    if (eq.notDecided && eq.notDecided.length)
      console.log(
        '      \u25cb ' + eq.notDecided.length + ' entr(ies) NOT DECIDED \u2014 the mutant was generated but no kill or survival was recorded for it in this run; the claim is unchecked, not refuted.'
      );
    /* "the line moved or the code changed" named BOTH causes and separated neither, so the only
       actionable one -- a lapsed excuse an existing tool can move back -- was unreadable. */
    const drift = eq.drifted || [];
    const dead = eq.stale || [];
    const outOfScope = eq.orphaned.length - drift.length - dead.length;
    if (outOfScope > 0)
      console.log('      \u25cb ' + outOfScope + ' entr(ies) OUT OF SCOPE \u2014 the mutant is in the file and this run did not test its line. Ordinary in a diff run; it excuses nothing here.');
    for (const e of drift)
      console.log(
        '      \u26a0 DRIFTED  ' +
          r.file +
          ':' +
          e.line +
          '  [' +
          e.op +
          '] \u2014 the identical mutant now sits at L' +
          (e.foundAtLines || []).join(', L') +
          '.\n        The excuse LAPSED on an edit above it. Run node tools/reanchor-equivalence.mjs to move it, which re-addresses the entry and never renews its claim.'
      );
    for (const e of dead)
      console.log(
        '      \u2298 STALE    ' + r.file + ':' + e.line + '  [' + e.op + '] matches no mutant anywhere in the file \u2014 the code it excused is gone, so only re-verification replaces it.'
      );
  }
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
      /* `mutated` rides along here and ONLY here: --dry-run is the enumeration a re-applier reads
         (probe-equivalence), whereas a sweep record is a result set nobody re-applies from. */
      dryOut.push({
        file: f,
        generated: ms.length,
        mutants: ms.map((mu, i) => ({ id: f + ':' + mu.line + ':' + i, line: mu.line, op: mu.op, before: mu.before, after: mu.after, mutated: mu.mutated }))
      });
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
  const n = ok.reduce((a, r) => a + measuredDenominator(r), 0);
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
  const surv = ok.flatMap((r) => survivorsToBlock(r).map((s) => ({ file: r.file, ...s })));
  const excusedN = ok.reduce((a, r) => a + r.survivors.length, 0) - surv.length;
  const refutedAll = ok.flatMap((r) => ((r.equivalence && r.equivalence.refuted) || []).map((e) => ({ file: r.file, ...e })));
  const voided = ok.filter((r) => r.voided);
  const unrun = ok.reduce((a, r) => a + r.invalid + (r.quarantined || 0), 0);
  const tested = ok.reduce((a, r) => a + r.tested, 0);
  const lines = ok.reduce((a, r) => a + (r.touchedLines || 0), 0);
  /* ONE decision, made by diffVerdict (pure, selftest-pinned); the prose below explains it and the
     process exits with the code it chose — status and exit code cannot drift apart. */
  const { verdict, code } = diffVerdict(results, { base: DIFF_BASE, commit: headCommit() });
  if (voided.length) {
    console.error('\n✕ MUTATION GATE VOID — the canary survived on: ' + voided.map((r) => r.file).join(', '));
    console.error('  Kills are not being detected, so "all killed" would prove nothing. Not a pass.');
  } else if (unrun) {
    console.error('\n✕ MUTATION GATE INCONCLUSIVE — ' + unrun + ' of ' + tested + ' mutants never ran.');
    console.error('  They did not compile, timed out under load, or were quarantined for going silent. Nothing was proven about them.');
  } else if (surv.length) {
    console.error('\n✕ MUTATION GATE — ' + surv.length + ' of ' + tested + ' mutants on your ' + lines + ' changed line(s) SURVIVED.');
    console.error('  Each is an edit you made that no test can see. Add an assertion, or explain why it is unobservable:\n');
    for (const s of surv.slice(0, 20)) console.error('    ' + s.file + ':' + s.line + '  [' + s.op + ']\n      ' + String(s.before).trim().slice(0, 100));
    if (surv.length > 20) console.error('    … and ' + (surv.length - 20) + ' more');
  } else if (refutedAll.length) {
    console.error('\n✕ MUTATION GATE — ' + refutedAll.length + ' equivalence entr(ies) REFUTED: a kill was recorded for a mutant the ledger says cannot be killed.');
    for (const e of refutedAll.slice(0, 20)) console.error('    ' + e.file + ':' + e.line + '  [' + e.op + '] is classified "' + e.class + '"');
    console.error('  Correct the entry in tools/mutate-equivalence.json — never weaken the test that killed it.');
  } else if (verdict.status === 'PASS' && !AS_JSON)
    console.log(
      '\n✓ mutation gate: ' +
        (excusedN
          ? tested + ' mutant(s) on ' + lines + ' changed line(s) — ' + (tested - excusedN) + ' killed, ' + excusedN + ' excused by a recorded equivalence entry.'
          : 'all ' + tested + ' mutant(s) on ' + lines + ' changed line(s) were killed.')
    );
  else if (!AS_JSON) console.log('\n○ mutation gate ' + verdict.status + ' — ' + verdict.reason);
  emitVerdict(verdict);
  if (code) process.exit(code);
}

/* ── --verdict: the §2.13 machine-readable compliance manifest ──────────────────────────────
   One JSON object on stdout, beside (never instead of) the prose above. `run` carries this run's
   outcome facts; `clauses` is the tool's standing declaration about its own construction. */
if (WANT_VERDICT) {
  const vok = results.filter((r) => !r.error);
  process.stdout.write(
    JSON.stringify(
      complianceManifest({
        files: results.length,
        measured: vok.length,
        tested: vok.reduce((a, r) => a + r.tested, 0),
        killed: vok.reduce((a, r) => a + (r.killed || 0), 0),
        invalid: vok.reduce((a, r) => a + r.invalid, 0),
        quarantined: vok.reduce((a, r) => a + (r.quarantined || 0), 0),
        canaryFailed: vok.some((r) => r.canary === 'FAILED')
      })
    ) + '\n'
  );
}
