/*
 * tools/mutation-suite.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ONE FRONT END FOR THE MUTATION LANE — fast, resumable, killable, and it does not sit there.
 *
 * THIS TOOL REUSES; IT DOES NOT REPLACE. `mutate.mjs` (2032 lines) already does the hard part —
 * mutant generation, the worker pool, the journal, `--resume` with jammed-mutant quarantine, the
 * per-minute heartbeat, ETA, coverage-directed selection. `extreme-mutate.mjs`, `stmt-delete.mjs`,
 * `per-group-coverage.mjs`, `mutation-crawl.mjs` and `mutation-worklist.mjs` each own a real piece.
 * What did NOT exist was a driver that ties them together and survives an unattended overnight run.
 * Everything below is either wiring or one of the four gaps measured on the 2026-08-16/17 crawl:
 *
 *   FAST      The coverage map existed and no sweep ever saw it — it is an untracked artefact and
 *             sweeps run from worktrees. `mutation-map.mjs` resolves it from the git COMMON dir and
 *             verifies its identity per file. Measured cost of not having it: ecgdex 290 min.
 *   UNSTUCK   A probe wedged for 11 h 11 m of CPU at 93 % with no output and no result, blocking two
 *             files from ever being crawled. Nothing noticed, because a hung run and a slow run look
 *             identical from outside. The WATCHDOG below tells them apart by the only signal that
 *             distinguishes them — whether the journal is still growing — and auto-resumes.
 *   KILLABLE  Stopping a sweep by `pkill -f` is the self-match deadlock CLAUDE.md §👥.4 documents
 *             (measured: six mutually-blocked waiters with zero pytest processes running). This
 *             writes a PID file and kills by PID, matching no pattern at all.
 *   VERBOSE   `mutate.mjs` streams SURVIVED lines but never says what KILLED a mutant, though the
 *             journal has recorded the killing group all along. A kill you cannot attribute teaches
 *             nothing; a kill attributed to a named group tells you which assertion is load-bearing.
 *
 * USAGE
 *   node tools/mutation-suite.mjs                      # sweep the fleet, resuming what it can
 *   node tools/mutation-suite.mjs --file oxydex-dsp.js # one file (repeatable)
 *   node tools/mutation-suite.mjs --status             # read state, run nothing
 *   node tools/mutation-suite.mjs --kill               # stop a running suite, by PID
 *   node tools/mutation-suite.mjs --build-map          # (re)build the coverage map, stamped
 *   node tools/mutation-suite.mjs --inventory          # write docs/MUTATION-INVENTORY.md (the public list)
 *   node tools/mutation-suite.mjs --cluster <file>     # local-AI survivor families (ADVISORY)
 *   node tools/mutation-suite.mjs --draft <file>       # local-AI drafts a killing assertion per killable mutant
 *   node tools/mutation-suite.mjs --selftest           # known-answer, touches nothing
 *     --jobs N           worker pool          (default: cores − 2, min 2)
 *     --stall-min N      watchdog patience    (default 10)
 *     --max-restarts N   bounded auto-resume  (default 3)
 *     --lane L           operators (default) | pseudo | delete   — see LANES; they are NOT comparable
 *     --quiet            no per-mutant lines, keep the heartbeat
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, uptime as osUptime } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdentity, mapCandidates, resolveMapPath, stateDirs, verifyFor } from './mutation-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

/**
 * DISCOVERED, NOT LISTED — this suite must not need editing when Tepna grows a node.
 *
 * A literal fleet array is correct on the day it is written and silently wrong afterwards: the next
 * node (EEGDex, SpiroDex) would be swept by nobody while the fleet total kept printing as though it
 * covered everything. An omission with no symptom is the exact failure this lane exists to expose,
 * so the roster is read off the filesystem — and the count is REPORTED on every run, because a
 * discovered roster that is wrong must be visible rather than assumed.
 */
export function discoverFleet(names) {
  return names.filter((f) => /-dsp\.js$/.test(f)).sort();
}
const FLEET = (() => {
  try {
    return discoverFleet(readdirSync(ROOT));
  } catch {
    return [];
  }
})();

/* cores − 2 leaves the box usable and matches what every other tool here defaults to. Never 0. */
const JOBS = Math.max(2, Number(opt('--jobs', String(Math.max(2, cpus().length - 2)))) || 2);
const STALL_MS = Math.max(60, Number(opt('--stall-min', '10')) * 60) * 1000;
const MAX_RESTARTS = Math.max(0, Number(opt('--max-restarts', '3')));
const QUIET = has('--quiet');
/* An UNKNOWN lane is a stop, never a silent default. `--lane pseduo` running the operators lane and
   reporting operator numbers under a pseudo heading is the shape of error this repo keeps paying for:
   a run that succeeded at something other than what was asked. */
const LANE = (() => {
  const l = opt('--lane', 'operators');
  return l;
})();

const log = (s) => process.stderr.write(s + '\n');
const stateDir = () => {
  const c = mapCandidates(ROOT)[0];
  return dirname(c);
};
const pidFile = () => join(stateDir(), 'suite.pid');
const journalPath = (file) => join(ROOT, '.mutate-journal', file.replace(/[/\\]/g, '_') + '.jsonl');

/*
 * ── A PID FILE IS A CLAIM, NOT AN OBSERVATION ──────────────────────────────────────────────────
 *
 * `suite.pid` is written when a sweep starts and unlinked when it exits cleanly. Every other exit —
 * a crash, a SIGKILL, a reboot — leaves the record behind, and it then reads exactly like a running
 * sweep. Measured 2026-08-20: the box rebooted at 14:12 while a sweep of `integrator-dsp.js` was
 * jammed; afterwards `--status` printed `running: {"pid":74542,…,"file":"integrator-dsp.js"}` while
 * the truth was that integrator had been dead for hours and a DIFFERENT file was being swept. Both
 * halves of the answer were wrong, and nothing said so. That is this repo's dominant defect shape —
 * a check that reported about something it never examined (CLAUDE.md §👥.4b).
 *
 * It is not cosmetic: `classifySweep` reads the same record and returns `in flight` for the file it
 * names, so a crashed file classifies as somebody-else's-work FOREVER and no sweep ever picks it up.
 *
 * Two independent tests, cheapest and most decisive first:
 *
 *   BOOT   A record `startedAt` BEFORE the current boot cannot describe a live process — a process
 *          cannot predate its own kernel. This is a PROOF of staleness, not a heuristic, and it is
 *          the only one that survives PID REUSE: after a reboot, pid 74542 may well exist again as
 *          something unrelated, and probing it would report the stale sweep as alive.
 *   PID    Otherwise `kill(pid, 0)` — no signal sent, ESRCH iff no such process. EPERM means the
 *          process exists and is not ours to signal, which is alive for our purposes.
 *
 * THE RECORD NAMES TWO PROCESSES, AND THEY DIE SEPARATELY. Probing only `pid` misreports the state
 * this box was actually in at 14:24 on 2026-08-20: suite 54384 gone, sweep child 54591 STILL RUNNING
 * and reparented to `systemd --user`. Calling that "not running" invites a second sweep of the same
 * file into the same cores; calling it "running" claims a watchdog, a stall-restart and a done-marker
 * that no longer exist — nothing will ever write the completion record for that file. It is its own
 * state, ORPHANED, and it is the one worth naming: work is still being done and nobody is watching it.
 * Hence `sweeping` (is this file being worked?) is a DIFFERENT question from `live` (is the driver
 * there?), and the two callers below want different ones.
 *
 * Unparseable `startedAt` with a live pid resolves to LIVE. That direction is deliberate: wrongly
 * declaring a live sweep dead spawns a second worker pool into the same cores, which corrupts both
 * runs; wrongly declaring a dead one live only stalls, and the stall is visible in the journal age
 * printed beside it.
 */
export function suiteRecordLiveness({ rec, bootMs, pidAlive, childAlive }) {
  const R = (state, reason) => ({ state, reason, live: state === 'running', sweeping: state === 'running' || state === 'orphaned' });
  if (!rec || typeof rec !== 'object') return R('none', 'no record');
  if (!Number.isFinite(rec.pid)) return R('stale', 'record carries no pid');
  const started = Date.parse(rec.startedAt);
  if (Number.isFinite(bootMs) && Number.isFinite(started) && started < bootMs) return R('stale', 'started before the current boot — the machine has restarted since');
  if (pidAlive) return R('running', 'pid ' + rec.pid + ' is running');
  if (childAlive) return R('orphaned', 'the suite (pid ' + rec.pid + ') is gone but its sweep child (pid ' + rec.child + ') is still running');
  return R('stale', 'no process with pid ' + rec.pid);
}

const bootMs = () => Date.now() - osUptime() * 1000;
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!e && e.code === 'EPERM';
  }
};

/** Read `suite.pid` and say whether it describes a process that is actually there. */
function readSuiteRecord() {
  let rec = null;
  try {
    rec = JSON.parse(readFileSync(pidFile(), 'utf8'));
  } catch {
    return { rec: null, live: false, reason: 'no record' };
  }
  const v = suiteRecordLiveness({
    rec,
    bootMs: bootMs(),
    pidAlive: Number.isFinite(rec.pid) && pidAlive(rec.pid),
    childAlive: Number.isFinite(rec.child) && pidAlive(rec.child)
  });
  return { rec, ...v };
}

// ── formatting ─────────────────────────────────────────────────────────────────────────────────
export const mmss = (s) =>
  s >= 3600 ? Math.floor(s / 3600) + 'h' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm' : Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';

/**
 * A journal key is `line \0 op \0 before \0 after`. Rendering it is the whole of "which mutant" —
 * the line it landed on, the operator applied, and the actual source either side of the change.
 * Kept pure so the selftest can pin the format without a sweep.
 */
export function describeMutant(key, file) {
  const p = String(key).split('\u0000');
  if (p.length < 4) return { where: (file || '?') + ':?', line: 0, op: String(key).slice(0, 40), before: '', after: '' };
  const trim = (s) => String(s).trim().replace(/\s+/g, ' ').slice(0, 72);
  /* `before`/`after` are DISPLAY fields — trimmed, whitespace-collapsed and cut to 72 chars so a
     terminal line stays readable. `rawBefore`/`rawAfter` are the untouched source text.
     ⚠️ Only the RAW pair may be used as a classification key. Keying on the display text would
     match on the first 72 characters and silently conflate two different mutations of the same long
     line — the truncation-reads-as-the-whole failure, applied to the thing that decides whether a
     survivor counts as resolved. */
  return { where: (file || '?') + ':' + p[0], line: Number(p[0]) || 0, op: p[1], before: trim(p[2]), after: trim(p[3]), rawBefore: p[2], rawAfter: p[3] };
}

/**
 * The verbose per-mutant line, and the reason this tool exists in verbose form at all: a kill is
 * only informative if you can name the assertion that caught it. `ks` is what the journal has
 * recorded since it was written and no tool has ever printed.
 */
export function mutantLine(rec, file) {
  const d = describeMutant(rec.k, file);
  const mark = rec.v === 'KILLED' ? '✓ KILLED ' : rec.v === 'INVALID' ? '· INVALID' : '✗ SURVIVED';
  const body = '  ' + mark + '  ' + d.where + '  [' + d.op + ']  ' + d.before + (d.after ? '  →  ' + d.after : '');
  if (rec.v !== 'KILLED') return body;
  const ks = Array.isArray(rec.ks) ? rec.ks : [];
  if (!ks.length) return body + '\n      killed by: (the journal recorded no group — treat as unattributed)';
  /* "FIRST TO FAIL", NOT "THE KILLER" — and the distinction is not pedantic. Sweeps run with
     `--bail`, so the suite stops at the first failing group and the journal can only ever record
     one. Measured 2026-08-18 on a full hrvdex sweep: 307 of 307 killed mutants recorded exactly
     ONE group, none recorded two. So this names the group that happened to run first among those
     that fail — other groups may kill the same mutant, and reading it as "the assertion that
     catches this" over-claims. The `(+N more)` form is kept for `--no-bail` runs, where the set is
     real; under the default flags it is unreachable, which is itself worth stating rather than
     leaving as decoration that implies a set nobody ever measures. */
  const extra = ks.length > 1 ? '  (+' + (ks.length - 1) + ' more)' : '';
  const label = ks.length > 1 ? 'killed by' : 'first group to fail';
  return body + '\n      ' + label + ': "' + String(ks[0]).slice(0, 88) + '"' + extra;
}

// ── the three lanes ────────────────────────────────────────────────────────────────────────────
/*
 * THREE KINDS OF MUTANT, ONE DRIVER. They answer different questions and this repo already had a
 * tool for each; what it lacked was a way to run them under the same watchdog, resume and reporting.
 *
 *   operators  `mutate.mjs`         — change an operator (`<` → `<=`, `&&` → `||`). "Would anyone
 *                                      notice if this comparison were wrong?"
 *   pseudo     `extreme-mutate.mjs` — XMT/Descartes: empty a whole function body. A function whose
 *                                      every extreme mutant survives is PSEUDO-TESTED — executed by
 *                                      the suite, asserted by nothing. That is a different and
 *                                      blunter finding than a surviving operator.
 *   delete     `stmt-delete.mjs`    — remove one statement (PseudoSweep). Catches the statement that
 *                                      no operator mutation can reach.
 *
 * They are NOT interchangeable and their numbers must never be added together: a pseudo-tested
 * FUNCTION and a surviving operator MUTANT are different units. The driver keeps them in separate
 * lanes and labels every output with which one produced it.
 */
export function groupTag(file) {
  return basename(String(file)).replace(/\.js$/, '');
}

export const LANES = {
  operators: {
    tool: 'tools/mutate.mjs',
    label: 'operator mutants',
    unit: 'mutant',
    parsed: true,
    args: (file, jobs) => ['--file', file, '--limit', '9999', '--jobs', String(jobs), '--bail', '--json', '--quiet-stream'],
    journal: (file) => join(ROOT, '.mutate-journal', file.replace(/[/\\]/g, '_') + '.jsonl')
  },
  pseudo: {
    tool: 'tools/extreme-mutate.mjs',
    label: 'pseudo-tested functions (XMT)',
    unit: 'function',
    parsed: false,
    args: (file, jobs) => ['--file', file, '--group', groupTag(file), '--jobs', String(jobs), '--json', '--resume'],
    journal: (file) => join(ROOT, '.mutation-sweeps', 'levela-' + String(file).replace(/[^A-Za-z0-9]+/g, '-') + '.jsonl')
  },
  delete: {
    tool: 'tools/stmt-delete.mjs',
    label: 'statement deletion',
    unit: 'statement',
    parsed: false,
    args: (file, jobs) => ['--file', file, '--group', groupTag(file), '--jobs', String(jobs), '--json', '--resume'],
    journal: (file) => join(ROOT, '.mutation-sweeps', 'levelb-' + String(file).replace(/[^A-Za-z0-9]+/g, '-') + '-' + groupTag(file).replace(/[^A-Za-z0-9]+/g, '-') + '.jsonl')
  }
};

/**
 * A MONOTONIC PROGRESS NUMBER THAT WORKS FOR ANY LANE.
 *
 * The watchdog only ever asks "did completed work increase?", and it must not need to understand a
 * lane's record format to ask it — Level A and Level B journal different shapes through their own
 * `ResumeLedger`. Byte length is monotonic, advances only when a verdict is appended, and cannot be
 * faked by a process that is merely alive. For the operators lane the parsed verdict count is used
 * instead, because it is the same signal with a unit a human can read.
 *
 * ⚠️ It must never fall back to mtime. A file can be touched without growing, and a watchdog that
 * accepts "something happened to this file" as progress is the hung-vs-slow confusion again.
 */
export function progressSignal({ parsed, text, bytes }) {
  if (parsed) return readJournalProgress(text || '').done;
  return Number(bytes) || 0;
}

// ── the journal, read as progress ──────────────────────────────────────────────────────────────
/**
 * Two records per mutant: a bare `{k}` START before it runs, a verdict AFTER. So `started − done`
 * is exactly what is in flight, and a START with no verdict after a restart is the jammer.
 * This is also the ONLY honest progress signal available: `mutate.mjs`'s stdout is captured by
 * whoever spawned it, and a process at 100 % CPU proves nothing about whether it is advancing.
 */
export function readJournalProgress(text) {
  const out = { started: 0, done: 0, killed: 0, survived: 0, invalid: 0, records: [] };
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; /* a torn final line is discarded, never fatal */
    }
    const keys = Object.keys(o);
    if (keys.length === 1 && o.k !== undefined) {
      out.started++;
      continue;
    }
    if (o.v === undefined) continue;
    out.done++;
    if (o.v === 'KILLED') out.killed++;
    else if (o.v === 'INVALID') out.invalid++;
    else out.survived++;
    out.records.push(o);
  }
  out.inFlight = out.started - out.done;
  return out;
}

/**
 * STUCK, OR MERELY SLOW? The distinction the 11 h 11 m wedge turned on, and it cannot be answered
 * from CPU (the wedged probe ran at 93 %) or from elapsed time (a legitimate integrator sweep is
 * hours). It is answered by whether COMPLETED WORK is still accruing.
 *
 * Deliberately NOT wall-clock since start, and deliberately NOT output-based: `mutate.mjs` under
 * `--quiet-stream` is silent by design, so silence is not evidence. Only the journal counts.
 */
export function stallVerdict({ doneNow, donePrev, msSinceProgress, stallMs }) {
  if (doneNow > donePrev) return { stuck: false, reason: 'progressing' };
  if (msSinceProgress < stallMs) return { stuck: false, reason: 'quiet for ' + Math.round(msSinceProgress / 1000) + 's, under the ' + Math.round(stallMs / 1000) + 's limit' };
  return { stuck: true, reason: 'no mutant completed in ' + Math.round(msSinceProgress / 60000) + ' min — treating as STUCK' };
}

/** Rate and ETA from real completions. Returns nulls rather than guesses when it cannot know. */
export function project({ done, total, elapsedMs }) {
  if (!(elapsedMs > 0) || !(done > 0)) return { perMin: null, etaMs: null };
  const perMin = (done / elapsedMs) * 60000;
  const left = total && total > done ? total - done : null;
  return { perMin, etaMs: left == null ? null : (left / done) * elapsedMs };
}

// ── map ────────────────────────────────────────────────────────────────────────────────────────
function loadMap() {
  const p = resolveMapPath(ROOT);
  if (!p) return { path: null, map: null };
  try {
    return { path: p, map: JSON.parse(readFileSync(p, 'utf8')) };
  } catch {
    return { path: p, map: null };
  }
}

/** Selection is per file: report it per file, because it is decided per file. */
function mapStatusFor(file, loaded, ident) {
  if (!loaded.path) return { on: false, reason: 'no map found (looked in ' + mapCandidates(ROOT).length + ' place(s)) — run --build-map' };
  const v = verifyFor(loaded.map, file, ident);
  return { on: v.ok, reason: v.reason };
}

// ── running one file ───────────────────────────────────────────────────────────────────────────
function spawnSweep(file, resume, lane) {
  const spec = LANES[lane];
  const args = [spec.tool, ...spec.args(file, JOBS)];
  /* The operators lane takes --resume as a flag we add; the other two already request it in their
     own arg list, because their resume ledgers carry a fingerprint and refuse a stale one themselves. */
  if (resume && lane === 'operators') args.push('--resume');
  return spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
}

/** The lane's progress number, whatever its record format. */
function laneProgress(spec, jp) {
  if (spec.parsed) {
    try {
      return { n: progressSignal({ parsed: true, text: readFileSync(jp, 'utf8') }), pr: readJournalProgress(readFileSync(jp, 'utf8')) };
    } catch {
      return null;
    }
  }
  try {
    return { n: progressSignal({ parsed: false, bytes: statSync(jp).size }), pr: null };
  } catch {
    return null;
  }
}

async function runFile(file, ident, loaded, lane) {
  const spec = LANES[lane];
  const jp = spec.journal(file);
  const ms = mapStatusFor(file, loaded, ident);
  log('');
  log('── ' + file + '   [lane: ' + lane + ' — ' + spec.label + ']');
  /* Selection is an operators-lane concept: the map keys groups to LINES, and the other two lanes
     mutate whole functions or statements through their own group filters. Saying "selection ON" for
     them would claim a speedup that is not being applied. */
  if (lane !== 'operators') log('   selection: n/a for this lane');
  else log('   selection: ' + (ms.on ? 'ON — ' + ms.reason : 'OFF — ' + ms.reason + '\n              (falling back to the tag filter: slower, never wrong)'));

  let restarts = 0;
  const stalls = [];
  for (;;) {
    const resume = existsSync(jp);
    if (resume && spec.parsed) {
      const pr = readJournalProgress(readFileSync(jp, 'utf8'));
      log('   resuming: ' + pr.done + ' verdict(s) already recorded' + (pr.inFlight > 0 ? ', ' + pr.inFlight + ' will be re-tried or quarantined' : ''));
    } else if (resume) {
      log('   resuming: a ledger exists for this lane — the lane validates its own fingerprint and refuses a stale one');
    }
    /* One pid file, so a second suite silently overwrites the first's record and `--kill` can then
       only reach one of them. Warn rather than refuse: a deliberate second `--file` run is a real
       workflow, and a refusal here would be unfixable without deleting state by hand. */
    const prior = readSuiteRecord();
    if (prior.sweeping && prior.rec.pid !== process.pid)
      log('   ⚠ another suite is ALREADY RUNNING (pid ' + prior.rec.pid + ', file ' + prior.rec.file + ') — both will share this core pool, and only the newer one stays addressable by --kill');
    const child = spawnSweep(file, resume, lane);
    writeFileSync(pidFile(), JSON.stringify({ pid: process.pid, child: child.pid, file, startedAt: new Date().toISOString() }) + '\n');

    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });

    const t0 = Date.now();
    let seen = 0;
    let lastGrowth = Date.now();
    let printed = 0;
    const outcome = await new Promise((resolve) => {
      const tick = setInterval(() => {
        const lp = laneProgress(spec, jp);
        if (!lp) return; /* ledger not created yet — generation is still running */
        const pr = lp.pr;
        /* VERBOSE: every newly-recorded verdict, named, with its killer. Only the operators lane has
           a record shape this driver understands; the other two stream their own native output on
           inherited stderr, which is already per-subject and already labelled. Inventing a line for a
           format we do not parse would be a summary of something never read. */
        if (!QUIET && pr) {
          for (let i = printed; i < pr.records.length; i++) log(mutantLine(pr.records[i], file));
          printed = pr.records.length;
        }

        const v = stallVerdict({ doneNow: lp.n, donePrev: seen, msSinceProgress: Date.now() - lastGrowth, stallMs: STALL_MS });
        if (lp.n > seen) {
          seen = lp.n;
          lastGrowth = Date.now();
        }
        const pj = project({ done: pr ? pr.done : 0, total: 0, elapsedMs: Date.now() - t0 });
        if (pr && pr.done && pr.done % 50 === 0)
          log('   ♥ ' + pr.done + ' done · ' + pr.killed + ' killed · ' + (pj.perMin ? pj.perMin.toFixed(1) + '/min' : '?') + ' · elapsed ' + mmss((Date.now() - t0) / 1000));
        if (v.stuck) {
          clearInterval(tick);
          log('   ⚠ STUCK — ' + v.reason);
          try {
            child.kill('SIGTERM');
          } catch {
            /* already gone */
          }
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              /* already gone */
            }
          }, 5000);
          resolve({ stuck: true });
        }
      }, 15000);
      child.on('exit', (code) => {
        clearInterval(tick);
        resolve({ stuck: false, code });
      });
    });

    if (!outcome.stuck) {
      try {
        unlinkSync(pidFile());
      } catch {
        /* fine */
      }
      const pr = spec.parsed && existsSync(jp) ? readJournalProgress(readFileSync(jp, 'utf8')) : { done: 0, killed: 0, survived: 0, invalid: 0, records: [] };
      if (!QUIET && spec.parsed) for (let i = printed; i < pr.records.length; i++) log(mutantLine(pr.records[i], file));
      const el = (Date.now() - t0) / 1000;
      /* The completion marker: written ONLY on a clean exit, and carrying the count it saw, so the
         inventory can say "complete" as a recorded fact rather than a guess about journal shape.
         A non-zero exit leaves no marker, which reads as `unknown` — correct, since a sweep that
         died mid-run has counts nobody should present as that file's result. */
      /* ── DO NOT SUMMARISE A LANE THIS DRIVER DOES NOT PARSE ──────────────────────────────────
         The first version applied the operators-lane summary to every lane, and on a real pseudo run
         it printed "0 tested · 0 killed · 0 survived" and then declared the file VOID — while
         extreme-mutate had, on the same screen, reported its own canary PASSED, measured coverage at
         27/52 functions, and classified 38. Every one of those zeros was this driver reporting on a
         record format it never read, and the VOID came from looking for a `canary` key in a result
         shape that does not carry one. Absence of a field I understand is not absence of a result.
         So: counts and canary are reported only for the lane whose records are parsed here; the
         others have already printed their own, natively, on inherited stderr. */
      const cv = spec.parsed ? canaryVerdict(parseSweepResult(out)) : { publishable: true, canary: 'n/a', why: 'this lane reports its own result above; this driver does not parse its records' };
      if (outcome.code === 0)
        writeFileSync(
          doneMarker(file, lane),
          JSON.stringify({
            file,
            lane,
            done: pr.done,
            killed: pr.killed,
            survived: pr.survived,
            invalid: pr.invalid,
            canary: cv.canary,
            publishable: cv.publishable,
            finishedAt: new Date().toISOString()
          }) + '\n'
        );
      if (!spec.parsed) log('   → finished in ' + mmss(el) + " — see the lane's own summary above (units: " + spec.unit + 's, not comparable with other lanes)');
      else
        log(
          '   → ' +
            pr.done +
            ' tested · ' +
            pr.killed +
            ' killed · ' +
            pr.survived +
            ' survived · ' +
            pr.invalid +
            ' invalid · ' +
            mmss(el) +
            (stalls.length ? '  (auto-resumed after ' + stalls.length + ' stall(s))' : '')
        );
      if (spec.parsed) log('   canary ' + cv.canary + ' — ' + cv.why);
      if (!cv.publishable) log('   ⚠ VOID — this file measured NOTHING. Do not quote these counts; they are kept only for debugging.');
      /* An invalid mutant leaves the denominator SILENTLY, and a rate over a shrunken denominator
         looks healthy. ecgdex once ran 73 % invalid. Report it as a proportion, not just a count. */
      if (pr.invalid && pr.invalid / (pr.done + pr.invalid) > 0.1)
        log('   ⚠ ' + Math.round((100 * pr.invalid) / (pr.done + pr.invalid)) + ' % of mutants were INVALID — they left the denominator; treat the rate as provisional');
      return { file, ...pr, canary: cv.canary, publishable: cv.publishable, stalls, exit: outcome.code };
    }

    stalls.push(new Date().toISOString());
    if (restarts++ >= MAX_RESTARTS) {
      /* A watchdog that restarts forever is a different way of hanging. Say so and move on. */
      log('   ✗ GIVING UP on ' + file + ' after ' + restarts + ' restart(s) — recorded as INCOMPLETE, not as a result');
      return { file, incomplete: true, stalls, reason: 'stalled ' + restarts + ' time(s)' };
    }
    log('   ↻ auto-resuming (' + restarts + '/' + MAX_RESTARTS + ') — the jammed mutant is quarantined by --resume, so this makes progress rather than re-entering the hole');
  }
}

// ── commands ───────────────────────────────────────────────────────────────────────────────────
function cmdKill() {
  const p = pidFile();
  if (!existsSync(p)) return log('no suite is running (no ' + p + ')');
  let rec;
  try {
    rec = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return log('pid file unreadable — refusing to guess which process to kill');
  }
  /* A stale record has nothing to kill, and signalling its pids is worse than useless after a
     reboot: the numbers may have been REUSED by unrelated processes. Clear it instead — that is
     the whole of what "stop the suite" means once the suite is already gone. */
  const v = suiteRecordLiveness({
    rec,
    bootMs: bootMs(),
    pidAlive: Number.isFinite(rec.pid) && pidAlive(rec.pid),
    childAlive: Number.isFinite(rec.child) && pidAlive(rec.child)
  });
  if (v.state === 'orphaned') {
    /* The driver is already gone — signalling its pid is a no-op at best and hits a REUSED pid at
       worst. Kill the one process that is actually there. */
    log('the suite driver is gone; its sweep child is not — ' + v.reason);
    try {
      process.kill(rec.child, 'SIGTERM');
      log('SIGTERM → child pid ' + rec.child);
    } catch {
      log('child pid ' + rec.child + ' went away before we could signal it');
    }
    try {
      unlinkSync(p);
      log('cleared ' + p + ' — journal is preserved, re-run the suite to resume');
    } catch {
      /* fine */
    }
    return;
  }
  if (!v.live) {
    log('no suite is running — STALE pid file (' + v.reason + ')');
    log('  it claimed ' + rec.file + '; sending no signals (the pids may have been reused since)');
    try {
      unlinkSync(p);
      log('  cleared ' + p + ' — journal preserved, re-run the suite to resume');
    } catch {
      log('  could not remove ' + p);
    }
    return;
  }
  /* BY PID, never by pattern. `pkill -f "mutate"` matches the killer's OWN command line, which is
     the documented self-deadlock (CLAUDE.md §👥.4). A pid we recorded ourselves cannot be ambiguous. */
  for (const [label, pid] of [
    ['child', rec.child],
    ['suite', rec.pid]
  ]) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      log('SIGTERM → ' + label + ' pid ' + pid);
    } catch {
      log(label + ' pid ' + pid + ' was not running');
    }
  }
  log('journal is preserved — re-run the suite to resume from it');
}

function cmdBuildMap() {
  const dest = mapCandidates(ROOT)[0];
  mkdirSync(dirname(dest), { recursive: true });
  log('building the coverage map → ' + dest);
  log('(one c8 run per group; ~10 min. It is written STAMPED, so a later sweep can tell whether it still applies.)');
  execFileSync('node', ['tools/per-group-coverage.mjs', '--out', dest, '--jobs', String(JOBS)], { cwd: ROOT, stdio: 'inherit' });
  log('✓ map written to the git common dir — every worktree of this repo can now see it');
}

function cmdStatus() {
  const loaded = loadMap();
  const ident = buildIdentity(ROOT, FLEET);
  log('MUTATION SUITE — status');
  log('  map: ' + (loaded.path || 'NOT FOUND — run --build-map'));
  if (loaded.path) {
    for (const f of FLEET) {
      const ms = mapStatusFor(f, loaded, ident);
      log('    ' + (ms.on ? '✓' : '·') + ' ' + f.padEnd(20) + (ms.on ? 'selection ON' : ms.reason));
    }
  }
  log('  journals:');
  let any = false;
  for (const f of FLEET) {
    const jp = journalPath(f);
    if (!existsSync(jp)) continue;
    any = true;
    const pr = readJournalProgress(readFileSync(jp, 'utf8'));
    const age = Math.round((Date.now() - statSync(jp).mtimeMs) / 60000);
    log('    ' + f.padEnd(20) + pr.done + ' tested · ' + pr.killed + ' killed · ' + pr.survived + ' survived   (last write ' + age + ' min ago)');
  }
  if (!any) log('    (none — nothing has been swept in this checkout)');
  const cur = readSuiteRecord();
  if (!cur.rec) log('  running: no');
  else if (cur.state === 'running') log('  running: ' + JSON.stringify(cur.rec));
  else if (cur.state === 'orphaned') {
    log('  running: ORPHANED — ' + cur.reason);
    log('           ' + cur.rec.file + ' is still being swept, but with no watchdog, no stall-restart and');
    log('           nobody left to write its done-marker. Let it finish and re-run the suite, or --kill it.');
    log('           record: ' + JSON.stringify(cur.rec));
  } else {
    log('  running: no — STALE pid file (' + cur.reason + ')');
    /* Only claim the journal is there if it IS there. Journals are per-checkout (`ROOT/.mutate-journal`)
       while this record lives in the git COMMON dir, so from a worktree the record routinely names a
       file whose journal is in a different checkout — promising a resume that would start from zero. */
    const jp = journalPath(cur.rec.file);
    log(
      '           it claims ' +
        cur.rec.file +
        (existsSync(jp) ? '; its journal here is intact, so re-running the suite RESUMES it' : '; NO journal for it in this checkout, so a re-run here starts from zero')
    );
    log('           stale record: ' + JSON.stringify(cur.rec));
  }
}

// ── local model (ADVISORY ONLY) ────────────────────────────────────────────────────────────────
/*
 * WHAT THE LOCAL MODEL IS ALLOWED TO DO HERE, AND WHY IT IS SO NARROW.
 *
 * Calibrated on this repo 2026-08-16: asked to judge code correctness it scored 0/4 on planted
 * bugs while producing a confident false positive, and asked to COUNT anything it scored 0/3. It
 * is good at one thing — recognising that two pieces of text are the same SHAPE. So it may group
 * survivors into families, and it may not decide anything.
 *
 * A family is a labour saving, not a verdict: 1477 oxydex survivors read one at a time is a week;
 * the same survivors in families of like shape is one test per family. Every line it emits is
 * marked ADVISORY, and nothing downstream reads this output — it prints, and stops.
 */
export function clusterKeys(keys, vectors, threshold = 0.86) {
  const fams = [];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = (a) => Math.sqrt(dot(a, a)) || 1;
  for (let i = 0; i < keys.length; i++) {
    const v = vectors[i];
    if (!v) continue;
    let best = null;
    let bestSim = -1;
    for (const f of fams) {
      const sim = dot(v, f.centroid) / (norm(v) * norm(f.centroid));
      if (sim > bestSim) {
        bestSim = sim;
        best = f;
      }
    }
    if (best && bestSim >= threshold) best.members.push(keys[i]);
    else fams.push({ centroid: v, members: [keys[i]] });
  }
  return fams.map((f) => f.members).sort((a, b) => b.length - a.length);
}

async function cmdCluster(file) {
  const jp = journalPath(file);
  if (!existsSync(jp)) return log('no journal for ' + file + ' — sweep it first');
  const pr = readJournalProgress(readFileSync(jp, 'utf8'));
  const surv = pr.records.filter((r) => r.v !== 'KILLED' && r.v !== 'INVALID');
  if (!surv.length) return log('no survivors recorded for ' + file);
  log('ADVISORY — grouping ' + surv.length + ' survivor(s) by shape using a local embedding model.');
  log('This is a LABOUR SAVING, NOT A VERDICT. The model is calibrated 0/4 on code correctness here;');
  log('it is used only to say "these look alike", so you can write one test per family.');
  const texts = surv.map((r) => {
    const d = describeMutant(r.k, file);
    return d.op + ' :: ' + d.before;
  });
  const vecs = [];
  for (const t of texts) {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bge-m3', prompt: t })
      });
      const j = await res.json();
      vecs.push(Array.isArray(j.embedding) ? j.embedding : null);
    } catch {
      /* NO LOCAL MODEL ⇒ NO CLUSTERING. It must not degrade into a text heuristic that looks like
         a model result; an absent capability is reported, never simulated. */
      log('✗ local model unreachable at 127.0.0.1:11434 — no clustering produced (this is a refusal, not an empty result)');
      return;
    }
  }
  const fams = clusterKeys(
    surv.map((r) => r.k),
    vecs
  );
  log('\n' + fams.length + ' family(ies) over ' + surv.length + ' survivors — largest first:\n');
  for (const fam of fams.slice(0, 20)) {
    const d = describeMutant(fam[0], file);
    log('  ' + String(fam.length).padStart(4) + '×  [' + d.op + ']  ' + d.before);
  }
  const covered = fams.slice(0, 20).reduce((a, f) => a + f.length, 0);
  log('\n  top 20 families cover ' + covered + ' of ' + surv.length + ' survivors (' + Math.round((100 * covered) / surv.length) + '%) — ADVISORY grouping only');
}

/* Per LANE, not per file: a finished pseudo run says nothing about whether the operator sweep
   completed, and one marker standing for both would let the inventory claim a completeness it never
   observed. The inventory reads the operators marker, because those are the counts it reports. */
const doneMarker = (file, lane = 'operators') => join(stateDir(), basename(file) + '.' + lane + '.done.json');

/**
 * THE CANARY DECIDES WHETHER ANY OF THE OTHER NUMBERS MAY BE QUOTED.
 *
 * Every sweep carries a mutant KNOWN to die. If it survives, the harness was not detecting kills at
 * all, and the run's counts describe nothing — `mutate.mjs` already nulls `killed`/`rate` and sets
 * `voided: true` for exactly this reason, and `mutation-crawl.mjs` records the file as VOID rather
 * than as a low score.
 *
 * ⚠️ The first version of this driver took its counts from the JOURNAL and never read mutate's JSON
 * result, so it bypassed all of that: it would have published a kill rate produced by a harness that
 * detected nothing, and the run would have looked entirely normal. A voided sweep is not a smaller
 * result — it is NO result, and the distinction is invisible unless someone reads this field.
 */
export function canaryVerdict(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') return { publishable: false, canary: 'UNKNOWN', why: 'no machine-readable result from the sweep — nothing can be vouched for' };
  const c = resultJson.canary;
  if (c === 'FAILED' || resultJson.voided === true)
    return { publishable: false, canary: 'FAILED', why: 'the canary mutant SURVIVED — the harness was not detecting kills, so these counts measure nothing' };
  if (c === 'PASSED') return { publishable: true, canary: 'PASSED', why: 'a mutant known to die did die — the harness detects kills' };
  /* NONE / STALE / PENDING: a file that has never learned a canary. Not a failure — but not proof
     either, and the difference between "proved" and "not disproved" is the whole point of a canary. */
  return { publishable: true, canary: String(c || 'NONE'), why: 'no canary was available for this file — kills are unverified, not disproved' };
}

/** The last JSON object mutate.mjs printed on stdout, or null. */
export function parseSweepResult(stdout) {
  for (const line of String(stdout).split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t);
    } catch {
      /* not the result line */
    }
  }
  return null;
}

/**
 * COMPLETE / IN FLIGHT / UNKNOWN — recorded, never inferred.
 *
 * The journal cannot answer this. A finished sweep still ends with unverdicted START records (the
 * quarantined jammer, and end-of-run races), so "mutants in flight" is not a running-signal; using
 * it flagged 4 of 4 files partial when 1 was. So completion is WRITTEN by whoever finished the
 * sweep, and a journal produced by something else — the older crawl, another checkout — is
 * `unknown`. Unknown is not a euphemism for unfinished: it is the honest statement that nothing
 * here can vouch for it, which is different from both of the other two answers.
 */
export function classifySweep({ hasDoneMarker, markerDone, journalDone, runningFile, file }) {
  if (runningFile && runningFile === file) return 'in flight';
  if (!hasDoneMarker) return 'unknown';
  if (markerDone !== journalDone) return 'unknown';
  return 'complete';
}

function sweepState(file) {
  /* Only a VERIFIED-live record names a file that is in flight; a stale one names a file that
     crashed, and calling that 'in flight' hides it from the sweep forever. */
  const cur = readSuiteRecord();
  /* `sweeping`, not `live`: an ORPHANED child is still mutating that file, so starting a second
     sweep of it would double the work and interleave two writers into one journal. */
  const runningFile = cur.sweeping ? cur.rec.file : null;
  let marker = null;
  try {
    marker = JSON.parse(readFileSync(doneMarker(file), 'utf8'));
  } catch {
    /* no marker */
  }
  const jp = journalPath(file);
  const journalDone = existsSync(jp) ? readJournalProgress(readFileSync(jp, 'utf8')).done : 0;
  return classifySweep({ hasDoneMarker: !!marker, markerDone: marker && marker.done, journalDone, runningFile, file });
}

/*
 * ALREADY-CLASSIFIED SURVIVORS ARE NOT OUTSTANDING WORK.
 *
 * `tools/mutate-equivalence.json` records mutants that were examined and found to have NO
 * distinguishing input — they cannot be killed by any test, so no test should be written for them
 * (MUTATION-EQUIVALENCE-2026-08-04 §5/§6.1). 416 of the 3627 survivors in the first inventory were
 * already in that ledger, listed as though open: an 11 % overstatement that invites exactly the
 * wasted effort the ledger exists to prevent.
 *
 * Matched on `line + op`, not on the source text: `before` is a display field, truncated for the
 * page, so matching on it would silently miss the long lines — and a matcher that quietly matches
 * less is the failure this file keeps re-learning. Line drift is handled by refusing to guess: a
 * classification whose line no longer holds that operator simply does not match, and the survivor is
 * reported as open. Over-reporting open work is recoverable; hiding a real gap is not.
 */
/**
 * The classification key: the mutation's TEXT, not its line.
 *
 * ⚠️ KEYING ON THE LINE NUMBER IS WHAT ROTTED THE LEDGER. Lines move for reasons as small as a
 * comment, and a classification that stops matching is indistinguishable from one that never
 * existed — so 379 of 383 keys had silently stopped applying, taking real human triage effort with
 * them. Measured 2026-08-18 on the one file with a journal to check against: keyed by `(line, op)`
 * **4 of 129** classifications still matched; keyed by `(op, before, after)`, **126**.
 *
 * The fields were already in the ledger. Nothing about its format changes — only what is read.
 *
 * Exact text, NOT a truncated prefix. Cutting both sides to 100 chars scores the same 126 while
 * introducing **33 colliding journal keys** — distinct mutants whose first 100 characters agree —
 * so it buys nothing and costs the ability to tell them apart. The cost of exactness is that the 39
 * ledger entries whose `before` is exactly 100 chars were themselves written truncated and can
 * never match; that is reported by `staleClassifications` rather than hidden, which is the whole
 * invariant: a key that stops matching must SAY so.
 */
export function classificationKey(file, op, before, after) {
  return file + '\u0001' + String(op) + '\u0001' + String(before == null ? '' : before).trim() + '\u0001' + String(after == null ? '' : after).trim();
}

export function classificationIndex(ledger) {
  const idx = new Map();
  for (const [file, entries] of Object.entries(ledger || {})) {
    if (!Array.isArray(entries)) continue; // `_README` is prose
    for (const e of entries) {
      if (!e || !e.op || e.before == null) continue;
      const k = classificationKey(file, e.op, e.before, e.after);
      const cls = e.class || 'unclassified';
      const prev = idx.get(k);
      /* THE KEY IS STILL NOT GUARANTEED UNIQUE — one line can host the same operator twice (two
         `||` in one condition) and produce identical before/after text, so the ledger can hold two
         entries under one key. Where they AGREE the answer is unambiguous; where they DISAGREE, one
         of those mutants is equivalent and the other is a real gap, and nothing in the key says
         which. Marking the key ambiguous makes BOTH report as open work — over-reporting is
         recoverable, while silently inheriting "unkillable" from a neighbour hides a real gap
         permanently. */
      if (prev !== undefined && prev !== cls) idx.set(k, 'ambiguous');
      else if (prev === undefined) idx.set(k, cls);
    }
  }
  return idx;
}

export function classifySurvivor(idx, file, op, before, after) {
  const c = idx.get(classificationKey(file, op, before, after));
  return !c || c === 'ambiguous' ? null : c;
}

function loadEquivalence() {
  try {
    return classificationIndex(JSON.parse(readFileSync(join(ROOT, 'tools/mutate-equivalence.json'), 'utf8')));
  } catch {
    return new Map();
  }
}

// ── the public list ────────────────────────────────────────────────────────────────────────────
/*
 * A COMMITTED, READABLE INVENTORY — because everything this lane knows currently lives in
 * `/tmp` and in gitignored journals. `.mutate-journal/` is ignored, `.mutation-sweeps/` is
 * untracked, and `/tmp/crawl` is wiped by a reboot; so the answer to "what does this suite
 * actually know about our tests?" has never been in the repository at all. Three consequences,
 * all observed: results were re-derived from scratch after the 2026-08-14 reboot, a 193-minute
 * sweep was repeated because nothing recorded that it had been done, and no reviewer could see a
 * survivor without running an overnight job first.
 *
 * The inventory is GENERATED, never hand-maintained — a hand-kept list of thousands of mutants is
 * a list that silently goes stale, which is the failure this whole lane exists to expose. It
 * carries its own provenance and, per the standing instruction, states where the tool that
 * produced it lives and how to re-run it, so the file is self-locating for anyone who finds it
 * without context.
 */
/**
 * One markdown TABLE CELL, escaped in the right order.
 *
 * Three bugs lived in the one-liner this replaces, and only one of them was found by CodeQL:
 *  1. it escaped `|` but not `\`, so a source line containing `\|` became `\\|` — a literal
 *     backslash followed by an UNESCAPED pipe, which splits the row. DSP source is full of
 *     backslashes (`/[/\\]/`, character classes, escaped quotes), so this was not hypothetical.
 *  2. it truncated AFTER escaping, so the cut could land inside a `\|` pair and leave a trailing
 *     backslash that escapes the closing backtick.
 *  3. the OPERATOR column was not escaped at all — and operators are named `bool || → &&`. Every
 *     such row has been splitting into extra columns for the whole document.
 * Truncate first, then escape backslash, then escape pipe. Order is the whole of the fix.
 */
export function mdCell(text, max) {
  const t = max ? String(text).slice(0, max) : String(text);
  return t.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

export function renderInventory({ files, generatedAt, mapPath, staleClassifications = 0, lanes = null }) {
  const L = [];
  const tot = files.reduce((a, f) => ({ done: a.done + (f.done || 0), killed: a.killed + (f.killed || 0), survived: a.survived + (f.survived || 0) }), { done: 0, killed: 0, survived: 0 });
  L.push('<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->');
  L.push('<!-- GENERATED by tools/mutation-suite.mjs --inventory — do not hand-edit; re-run the tool. -->');
  L.push('# Mutation inventory — what the suite knows about these tests');
  L.push('');
  L.push('**Status:** REFERENCE (living — regenerated by the tool) · **last-verified:** ' + generatedAt);
  L.push('');
  L.push('## Where this comes from, and how to reproduce it');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push('| suite driver | `tools/mutation-suite.mjs` |');
  L.push('| regenerate this file | `node tools/mutation-suite.mjs --inventory` |');
  L.push('| run a sweep | `node tools/mutation-suite.mjs --file <name>-dsp.js` |');
  L.push('| stop a running sweep | `node tools/mutation-suite.mjs --kill` (by PID — never `pkill`) |');
  L.push('| live state | `node tools/mutation-suite.mjs --status` |');
  L.push('| build the speed-up map | `node tools/mutation-suite.mjs --build-map` |');
  L.push('| mutation engine | `tools/mutate.mjs` · statement deletion `tools/stmt-delete.mjs` · XMT `tools/extreme-mutate.mjs` |');
  L.push('| coverage map | ' + (mapPath ? '`' + mapPath + '`' : '_not built — sweeps run the slow path_') + ' |');
  L.push('');
  L.push('A **surviving mutant is the finding**: the code was changed and the whole suite stayed green,');
  L.push('so nothing tests that line — whatever the coverage number says. A survivor is NOT proof of a');
  L.push('bug; some are legitimately untestable. Triage is the reader’s.');
  L.push('');
  L.push('## Totals');
  L.push('');
  L.push('**Scope: the JavaScript DSPs only.** `capture-host/` is a separate lane (mutmut, ~74.6 % at last');
  L.push('audit) and none of its mutants are counted here — do not read the fleet row as a project-wide figure.');
  L.push('');
  L.push('- **open** — survivors with no recorded classification: the actual outstanding work.');
  L.push('- **classified** — survivors already proven to have no distinguishing input (`tools/mutate-equivalence.json`).');
  L.push('  They cannot be killed by any test, so writing one for them is wasted effort.');
  L.push('- **invalid** — mutants that failed to run. They leave the denominator SILENTLY, so a kill rate');
  L.push('  computed beside a large invalid count is provisional (one file once ran 73 % invalid).');
  L.push('- **state** — `complete` is recorded on a clean exit; `unknown` means nothing here can vouch for it.');
  L.push('- **stale classifications** — ledger entries that no longer match any survivor. The ledger is keyed');
  L.push('  by LINE, and lines move, so a classification silently stops applying when the file is edited.');
  L.push('  A VOID file (its canary survived) measured nothing at all and its counts must not be quoted.');
  L.push('');
  L.push('| file | tested | killed | survived | **open** | classified | invalid | kill rate | state |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---|');
  /* A PARTIAL SWEEP IS NOT A SMALL RESULT, IT IS AN UNFINISHED ONE — printing its counts in the same
     shape as a finished file invites them to be read as that file's kill RATE, which they are not.
     ⚠️ The first version inferred this from `inFlight > 0` (a START record with no verdict). That is
     NOT a running-signal and it over-flagged every file: a FINISHED ecgdex sweep still ends with one
     unverdicted START — the quarantined jammer, plus end-of-run races. It marked 4 of 4 files
     partial when exactly 1 was, which would have taught readers to ignore the marker.
     `state` is now recorded by whoever finished the sweep, never guessed from the journal's shape,
     and a journal this suite did not produce is UNKNOWN rather than assumed complete. */
  for (const f of files)
    L.push(
      '| `' +
        f.file +
        '` | ' +
        (f.done || 0) +
        ' | ' +
        (f.killed || 0) +
        ' | ' +
        (f.survived || 0) +
        ' | **' +
        (f.open == null ? f.survived || 0 : f.open) +
        '** | ' +
        (f.classified || 0) +
        ' | ' +
        (f.invalid || 0) +
        ' | ' +
        (f.done ? Math.round((100 * f.killed) / f.done) + ' %' : '—') +
        ' | ' +
        f.state +
        ' |'
    );
  const partial = files.filter((f) => f.state !== 'complete');
  const totOpen = files.reduce((a, f) => a + (f.open == null ? f.survived || 0 : f.open), 0);
  const totCls = files.reduce((a, f) => a + (f.classified || 0), 0);
  const totInv = files.reduce((a, f) => a + (f.invalid || 0), 0);
  L.push(
    '| **fleet** | **' +
      tot.done +
      '** | **' +
      tot.killed +
      '** | **' +
      tot.survived +
      '** | **' +
      totOpen +
      '** | ' +
      totCls +
      ' | ' +
      totInv +
      ' | **' +
      (tot.done ? Math.round((100 * tot.killed) / tot.done) + ' %' : '—') +
      '** | ' +
      (partial.length ? '**includes ' + partial.length + ' unconfirmed**' : 'complete') +
      ' |'
  );
  L.push('');
  /* THE LEDGER HAS ROTTED, AND NOTHING WAS WATCHING. Measured 2026-08-18: of ppgdex's 129 recorded
     classifications only 4 still land on a survivor, and 117 point at lines that hold no survivor at
     all. That is real human triage effort — someone examined those mutants and proved them unkillable
     — now unmatchable because the ledger is keyed by line number and lines move. Reporting the number
     is the minimum; the fix is to key classifications by something drift-resistant (mutate.mjs already
     computes an enclosing-function hash for exactly this reason), which is a change to the ledger
     format and belongs in its own work-unit rather than smuggled in here. */
  if (staleClassifications > 0) {
    L.push('> ⚠ **' + staleClassifications + ' recorded classification(s) no longer match any survivor.** The equivalence ledger is');
    L.push('> keyed by line number, and lines move — so triage work that was really done has silently stopped');
    L.push('> applying. Those mutants are counted as **open** here, which over-states the work rather than');
    L.push('> hiding a gap, but the classifications need re-anchoring to be worth anything again.');
    L.push('');
  }
  if (partial.length) {
    L.push('> ⚠ **' + partial.map((f) => '`' + f.file + '`').join(', ') + ' are not confirmed-complete sweeps.** A row marked');
    L.push('> `in flight` is a snapshot of a running sweep — the counts will grow and the rate will move.');
    L.push('> A row marked `unknown` came from a journal this suite did not finish itself, so its');
    L.push('> completeness cannot be asserted; it is not a claim that the file is unfinished, only that');
    L.push('> nothing here can vouch for it. Re-run `--inventory` after a sweep to resolve either.');
    L.push('> The fleet row inherits that caveat.');
    L.push('');
  }
  if (lanes) for (const line of renderLaneSections(lanes)) L.push(line);
  for (const f of files) {
    if (!f.survivors || !f.survivors.length) continue;
    L.push('## `' + f.file + '` — ' + f.survivors.length + ' survivor(s)');
    L.push('');
    L.push('| line | operator | source |');
    L.push('|---:|---|---|');
    for (const s of f.survivors) L.push('| ' + s.line + ' | `' + mdCell(s.op) + '` | `' + mdCell(s.before, 96) + '` |');
    L.push('');
  }
  return L.join('\n') + '\n';
}

// ── §4 · THE OTHER TWO LANES, REPORTED IN THEIR OWN UNITS ─────────────────────────────────────
/**
 * Parse a ResumeLedger JSONL (the persistent record `extreme-mutate` / `stmt-delete` write under
 * `--resume`). Last record per key wins — a ledger REPLAYS on resume, so an early verdict can be
 * superseded — and a torn final line (a kill mid-append) is skipped, never repaired.
 */
export function parseLaneLedger(text) {
  const done = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o && o.key != null) done.set(String(o.key), o);
  }
  const byVerdict = {};
  for (const [, r] of done) {
    const v = r.verdict == null ? '(none)' : String(r.verdict);
    byVerdict[v] = (byVerdict[v] || 0) + 1;
  }
  return { byVerdict, total: done.size };
}

/** Where each lane's ledgers may live for a file — both state dirs, shared first (§1). */
export function laneLedgerCandidates(root, file, { readdirFn = readdirSync, existsFn = existsSync } = {}) {
  const slug = String(file).replace(/[^A-Za-z0-9]+/g, '-');
  const out = { pseudo: [], del: [] };
  for (const dir of stateDirs(root)) {
    if (!existsFn(dir)) continue;
    let names = [];
    try {
      names = readdirFn(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (n === 'levela-' + slug + '.jsonl') out.pseudo.push(join(dir, n));
      /* delete-lane ledgers are per file+GROUP — all of them count, each a separate run */
      if (n.startsWith('levelb-' + slug + '-') && n.endsWith('.jsonl')) out.del.push(join(dir, n));
    }
  }
  return out;
}

/**
 * The per-lane inventory sections. ⚠️ UNITS ARE THE WHOLE POINT AND THEY NEVER SUM: the operators
 * table above counts MUTANTS, the pseudo lane classifies FUNCTIONS, the delete lane judges
 * STATEMENTS. One number across them would be meaningless, so none is computed — each section
 * carries its own unit in its own header, and a lane with no recorded run says so instead of
 * printing zeros (an absent ledger is a missing INPUT, not a clean lane).
 */
export function renderLaneSections(lanes) {
  const L = [];
  L.push('## The other two lanes — different UNITS, never summed with the mutant table above');
  L.push('');
  L.push('Pseudo (XMT/Descartes) classifies **functions**; statement deletion judges **statements**.');
  L.push('Neither is a mutant count, and no combined total exists on purpose.');
  L.push('');
  for (const [key, title, unit] of [
    ['pseudo', 'Pseudo lane (`extreme-mutate.mjs`)', 'functions'],
    ['del', 'Statement-deletion lane (`stmt-delete.mjs`)', 'statements']
  ]) {
    const lane = lanes && lanes[key];
    L.push('### ' + title + ' — unit: **' + unit + '**');
    L.push('');
    if (!lane || !lane.files || !lane.files.length) {
      L.push('_No recorded run found in either state location. This is an absent INPUT — the lane may');
      L.push('have run without `--resume` (no persistent ledger) or not at all; it is NOT a clean bill._');
      L.push('');
      continue;
    }
    L.push('| file | ' + unit + ' recorded | verdicts |');
    L.push('|---|---:|---|');
    for (const f of lane.files) {
      const verdicts = Object.entries(f.byVerdict)
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => '`' + mdCell(v) + '` ' + n)
        .join(' · ');
      L.push('| `' + f.file + '` | ' + f.total + ' | ' + verdicts + ' |');
    }
    L.push('');
    L.push('_A ledger records only what a `--resume` run wrote; a lane run without `--resume` leaves no');
    L.push('trace here. Verdicts are reported verbatim from the lane, never re-mapped._');
    L.push('');
  }
  return L;
}

function cmdInventory() {
  const loaded = loadMap();
  const eq = loadEquivalence();
  const files = [];
  for (const f of FLEET) {
    const jp = journalPath(f);
    if (!existsSync(jp)) continue;
    const pr = readJournalProgress(readFileSync(jp, 'utf8'));
    const survivors = pr.records
      .filter((r) => r.v !== 'KILLED' && r.v !== 'INVALID')
      .map((r) => {
        const d = describeMutant(r.k, f);
        return { line: d.line, op: d.op, before: d.before, cls: classifySurvivor(eq, f, d.op, d.rawBefore, d.rawAfter) };
      })
      .sort((a, b) => a.line - b.line);
    /* A survivor already proven to have NO distinguishing input is RESOLVED, not outstanding. Keeping
       it in the same count as real gaps overstated the work by 11 % and invites someone to write a
       test for a mutant this repo already proved cannot be killed. */
    const open = survivors.filter((x) => x.cls !== 'no-distinguishing-input');
    files.push({
      file: f,
      done: pr.done,
      killed: pr.killed,
      survived: pr.survived,
      invalid: pr.invalid,
      inFlight: pr.inFlight,
      state: sweepState(f),
      survivors,
      open: open.length,
      classified: survivors.length - open.length
    });
  }
  if (!files.length) {
    /* An inventory of nothing must not be written as if it were an inventory of zero survivors. */
    log('no journals in this checkout — refusing to write an inventory that would read as "nothing survives"');
    return;
  }
  const dest = join(ROOT, 'docs', 'MUTATION-INVENTORY.md');
  mkdirSync(dirname(dest), { recursive: true });
  /* Every ledger key that no survivor claimed. Counted against the keys actually indexed, so a
     duplicate (line, op) pair is not double-counted. */
  const claimed = new Set();
  for (const f of files) for (const sv of f.survivors) if (sv.cls) claimed.add(f.file + ':' + sv.line + ':' + sv.op);
  const staleClassifications = Math.max(0, eq.size - claimed.size);
  /* §4: gather the other two lanes' persistent ledgers, per file, both state dirs. */
  const lanes = { pseudo: { files: [] }, del: { files: [] } };
  for (const f of FLEET) {
    const cand = laneLedgerCandidates(ROOT, f);
    for (const [key, paths] of [
      ['pseudo', cand.pseudo],
      ['del', cand.del]
    ]) {
      let merged = '';
      for (const p of paths) {
        try {
          merged += readFileSync(p, 'utf8');
        } catch {
          /* an unreadable ledger contributes nothing; the others still count */
        }
      }
      if (!merged) continue;
      const parsed = parseLaneLedger(merged);
      if (parsed.total) lanes[key].files.push({ file: f, ...parsed });
    }
  }
  writeFileSync(dest, renderInventory({ files, generatedAt: new Date().toISOString().slice(0, 10), mapPath: loaded.path, staleClassifications, lanes }));
  log('✓ wrote ' + dest + ' — ' + files.length + ' file(s), ' + files.reduce((a, f) => a + f.survivors.length, 0) + ' survivor(s) listed');
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let fail = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  ✓ ' : '  ✕ ') + n + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
    if (!ok) fail++;
  };

  console.log('describeMutant / mutantLine — a kill you cannot attribute teaches nothing');
  const killed = { v: 'KILLED', k: '77\u0000negate: drop !\u0000if (!a.length) return 0;\u0000if (a.length) return 0;', ks: ['ECGDex accAnalyze — posture from the gravity vector, known-answer'] };
  ck('names the file and line', describeMutant(killed.k, 'ecgdex-dsp.js').where, 'ecgdex-dsp.js:77');
  ck('names the operator', describeMutant(killed.k, 'ecgdex-dsp.js').op, 'negate: drop !');
  ck('shows the source either side', [describeMutant(killed.k).before, describeMutant(killed.k).after], ['if (!a.length) return 0;', 'if (a.length) return 0;']);
  /* Under --bail (the sweep default) the journal can only hold ONE group, so a single entry is
     labelled "first group to fail" — not "killed by", which claims a completeness --bail cannot
     provide. Measured: 307 of 307 kills recorded exactly one group, none recorded two. */
  ck('a single-group kill is labelled FIRST TO FAIL, not "the killer"', /first group to fail: "ECGDex accAnalyze/.test(mutantLine(killed, 'ecgdex-dsp.js')), true);
  ck('…and a genuine multi-group set (--no-bail) still reads "killed by"', /killed by: "a"/.test(mutantLine({ ...killed, ks: ['a', 'b'] }, 'f.js')), true);
  ck('…and counts the others', /\(\+2 more\)/.test(mutantLine({ ...killed, ks: ['a', 'b', 'c'] }, 'f.js')), true);
  /* An unattributed kill must SAY it is unattributed rather than print a bare tick — otherwise the
     one case worth investigating is the one that looks cleanest. */
  ck('a kill with no recorded group says so', /no group/.test(mutantLine({ v: 'KILLED', k: '1\u0000op\u0000a\u0000b', ks: [] }, 'f.js')), true);
  ck('a SURVIVED line claims no killer', /killed by/.test(mutantLine({ v: 'SURVIVED', k: '1\u0000op\u0000a\u0000b' }, 'f.js')), false);
  ck('a malformed key degrades instead of throwing', describeMutant('junk', 'f.js').where, 'f.js:?');

  console.log('\nreadJournalProgress — two records per mutant, so in-flight is exact');
  const jl = [
    JSON.stringify({ k: 'a' }),
    JSON.stringify({ k: 'a', v: 'KILLED', ks: ['G'] }),
    JSON.stringify({ k: 'b' }),
    JSON.stringify({ k: 'b', v: 'SURVIVED' }),
    JSON.stringify({ k: 'c' }),
    '{"torn":'
  ].join('\n');
  const pr = readJournalProgress(jl);
  ck('counts verdicts, not lines', [pr.done, pr.killed, pr.survived], [2, 1, 1]);
  ck('a START with no verdict is IN FLIGHT', pr.inFlight, 1);
  ck('a torn final line is discarded, never fatal', pr.done, 2);
  ck('an empty journal is zero, not a crash', readJournalProgress('').done, 0);

  console.log('\nstallVerdict — stuck and slow look identical from outside; only the journal tells them apart');
  ck('progress means not stuck, however long it took', stallVerdict({ doneNow: 5, donePrev: 4, msSinceProgress: 9e9, stallMs: 1000 }).stuck, false);
  ck('quiet but inside the limit is not stuck', stallVerdict({ doneNow: 4, donePrev: 4, msSinceProgress: 500, stallMs: 1000 }).stuck, false);
  ck('quiet past the limit IS stuck', stallVerdict({ doneNow: 4, donePrev: 4, msSinceProgress: 1500, stallMs: 1000 }).stuck, true);
  /* The 11 h 11 m wedge ran at 93 % CPU. Busy is not progress, and this is the assertion that says so. */
  ck('…and it is decided on completions, not on elapsed time or CPU', stallVerdict({ doneNow: 0, donePrev: 0, msSinceProgress: 11 * 3600 * 1000, stallMs: 600000 }).stuck, true);

  console.log('\nproject — rate and ETA, or nulls; never a guess');
  ck('60 in 60 s is 60/min', Math.round(project({ done: 60, total: 0, elapsedMs: 60000 }).perMin), 60);
  ck('ETA needs a total', project({ done: 60, total: 0, elapsedMs: 60000 }).etaMs, null);
  ck('…and is linear when it has one', Math.round(project({ done: 50, total: 100, elapsedMs: 60000 }).etaMs / 1000), 60);
  ck('no elapsed time ⇒ no rate, rather than Infinity', project({ done: 5, total: 10, elapsedMs: 0 }).perMin, null);
  ck('no completions ⇒ no rate', project({ done: 0, total: 10, elapsedMs: 5000 }).perMin, null);

  console.log('\ncanaryVerdict — the field that decides whether any other number may be quoted');
  ck('a canary that died means kills are being detected', canaryVerdict({ canary: 'PASSED' }).publishable, true);
  /* A voided sweep is not a smaller result, it is NO result. The first version of this driver took its
     counts from the JOURNAL and never looked at this field, so it would have published a kill rate
     from a harness that detected nothing — and the run would have looked entirely normal. */
  ck('a SURVIVING canary voids the file', canaryVerdict({ canary: 'FAILED' }).publishable, false);
  ck('…and `voided` alone is enough, whatever the canary field says', canaryVerdict({ canary: 'PASSED', voided: true }).publishable, false);
  ck('no machine-readable result ⇒ nothing may be vouched for', canaryVerdict(null).publishable, false);
  /* NONE/STALE is not a failure, but it is not proof either — "not disproved" is not "proved". */
  ck('a file with no canary is publishable but says kills are UNVERIFIED', /unverified/.test(canaryVerdict({ canary: 'NONE' }).why), true);
  ck('parseSweepResult takes the LAST JSON line, past the progress stream', parseSweepResult('noise\n{"canary":"PASSED"}\ntrailing').canary, 'PASSED');
  ck('…and returns null when there is none, rather than a shape', parseSweepResult('no json here'), null);

  console.log('\nLANES — three different questions, three different units, never added together');
  ck('the three lanes exist', Object.keys(LANES), ['operators', 'pseudo', 'delete']);
  /* A pseudo-tested FUNCTION and a surviving operator MUTANT are different units; labelling each lane
     with its unit is what stops a reader summing them into a fleet number that means nothing. */
  ck('…and each declares its unit', [LANES.operators.unit, LANES.pseudo.unit, LANES.delete.unit], ['mutant', 'function', 'statement']);
  ck('only the operators lane has a record shape this driver parses', [LANES.operators.parsed, LANES.pseudo.parsed, LANES.delete.parsed], [true, false, false]);
  ck('the group tag is derived, not configured', groupTag('oxydex-dsp.js'), 'oxydex-dsp');
  ck('each lane journals somewhere different', new Set([LANES.operators.journal('a-dsp.js'), LANES.pseudo.journal('a-dsp.js'), LANES.delete.journal('a-dsp.js')]).size, 3);
  /* Byte length is monotonic and only advances when a verdict is appended. It must never fall back to
     mtime: a file can be touched without growing, and "something happened" is not progress. */
  ck('progress for an unparsed lane is its ledger length', progressSignal({ parsed: false, bytes: 4096 }), 4096);
  ck('…and zero when the ledger does not exist yet', progressSignal({ parsed: false, bytes: undefined }), 0);

  console.log('\ndiscoverFleet — a new node must not need this file edited');
  ck('finds every DSP', discoverFleet(['a-dsp.js', 'zz-dsp.js', 'README.md', 'clock.js']), ['a-dsp.js', 'zz-dsp.js']);
  /* The point: a node added tomorrow appears without anyone remembering to list it. */
  ck('…including one that did not exist when this was written', discoverFleet(['eegdex-dsp.js']).length, 1);
  ck('ignores non-DSP files', discoverFleet(['dsp.js', 'x-dsp.js.bak']).length, 0);

  console.log('\nclassificationIndex — a resolved survivor is not outstanding work, and a tie is not resolved');
  const idx = classificationIndex({
    'f.js': [{ line: 10, op: 'cmp < → <=', before: 'for (i = 0; i < n; i++)', after: 'for (i = 0; i <= n; i++)', class: 'no-distinguishing-input' }],
    _README: ['prose']
  });
  ck('prose keys are skipped', idx.size, 1);
  ck('a classified mutant is found by its TEXT', classifySurvivor(idx, 'f.js', 'cmp < → <=', 'for (i = 0; i < n; i++)', 'for (i = 0; i <= n; i++)'), 'no-distinguishing-input');
  /* THE POINT OF THE RE-ANCHOR: the ledger entry above records line 10, and nothing here supplies a
     line at all — the classification resolves purely from the text. Keyed by line, a moved line
     returned null and the classification was lost; 379 of 383 of them were, in practice. */
  ck('…but NOT when the source text itself changed', classifySurvivor(idx, 'f.js', 'cmp < → <=', 'for (i = 0; i < LIMIT; i++)', 'for (i = 0; i <= LIMIT; i++)'), null);
  ck('an unclassified one is null, not a default', classifySurvivor(idx, 'f.js', 'cmp > → >=', 'a > b', 'a >= b'), null);
  /* Whitespace is normalised on both sides, so a reindent does not invalidate a classification. */
  /* An entry with no source text cannot be keyed at all and must be DROPPED, never indexed under a
     partial key — a half-key would resolve the wrong mutants to it. Planted and confirmed surviving
     before this line existed. */
  ck('an entry with no source text is not indexed at all', classificationIndex({ 'f.js': [{ line: 10, op: 'x', class: 'real-gap' }] }).size, 0);
  ck('leading/trailing whitespace does not break the match', classifySurvivor(idx, 'f.js', 'cmp < → <=', '   for (i = 0; i < n; i++)  ', '  for (i = 0; i <= n; i++) '), 'no-distinguishing-input');
  /* (line, op) is NOT unique — one line can host the same operator twice. Where colliding entries
     DISAGREE, one is equivalent and one is a real gap and the key cannot say which; inheriting either
     answer would hide a real gap permanently, so both must report as open. */
  ck(
    'two entries that DISAGREE resolve to neither',
    classifySurvivor(
      classificationIndex({
        'f.js': [
          { line: 10, op: 'x', before: 'a', after: 'b', class: 'no-distinguishing-input' },
          { line: 22, op: 'x', before: 'a', after: 'b', class: 'real-gap' }
        ]
      }),
      'f.js',
      'x',
      'a',
      'b'
    ),
    null
  );
  ck(
    '…but two that agree are unambiguous',
    classifySurvivor(
      classificationIndex({
        'f.js': [
          { line: 10, op: 'x', before: 'a', after: 'b', class: 'real-gap' },
          { line: 22, op: 'x', before: 'a', after: 'b', class: 'real-gap' }
        ]
      }),
      'f.js',
      'x',
      'a',
      'b'
    ),
    'real-gap'
  );

  console.log('\nclassifySweep — recorded, never inferred from the journal’s shape');
  ck('the file a running suite names is IN FLIGHT', classifySweep({ runningFile: 'a.js', file: 'a.js', hasDoneMarker: true, markerDone: 5, journalDone: 5 }), 'in flight');
  ck('a marker whose count matches the journal is COMPLETE', classifySweep({ hasDoneMarker: true, markerDone: 100, journalDone: 100, file: 'a.js' }), 'complete');
  /* A journal from the older crawl, or another checkout, has no marker. That is not "unfinished" —
     it is "nothing here can vouch for it", and conflating the two is what the first version did. */
  ck('no marker ⇒ UNKNOWN, not complete and not partial', classifySweep({ hasDoneMarker: false, journalDone: 100, file: 'a.js' }), 'unknown');
  /* The EXISTENCE of the marker is what decides, not its value. Without this case the `!hasDoneMarker`
     guard is an equivalent mutant — deleting it still yields 'unknown', but only because an absent
     marker happens to carry `markerDone: undefined`, which is a caller's invariant rather than a
     property of this function. Planted and confirmed surviving before this line existed. */
  ck('…even when a count is supplied that would otherwise match', classifySweep({ hasDoneMarker: false, markerDone: 100, journalDone: 100, file: 'a.js' }), 'unknown');
  ck('a marker that disagrees with the journal ⇒ UNKNOWN', classifySweep({ hasDoneMarker: true, markerDone: 50, journalDone: 100, file: 'a.js' }), 'unknown');
  /* THE REGRESSION THIS REPLACED: a finished sweep still ends with unverdicted STARTs, so an
     inFlight-based rule called a complete file partial. Completion must not depend on that number. */
  ck('a COMPLETE file stays complete despite unverdicted STARTs in its journal', classifySweep({ hasDoneMarker: true, markerDone: 1815, journalDone: 1815, file: 'ecgdex-dsp.js' }), 'complete');
  ck('another file being swept does not make this one in-flight', classifySweep({ runningFile: 'b.js', file: 'a.js', hasDoneMarker: true, markerDone: 5, journalDone: 5 }), 'complete');

  console.log('\nsuiteRecordLiveness — a pid file is a claim; these are the two ways to check it');
  const BOOT = Date.parse('2026-08-20T18:12:00Z');
  /* The real record left behind by the 2026-08-20 reboot, verbatim. */
  const stale = { pid: 74542, child: 251629, file: 'integrator-dsp.js', startedAt: '2026-08-20T06:36:00.538Z' };
  ck('a record predating the current boot is STALE even though its pid probes ALIVE (pid reuse)', suiteRecordLiveness({ rec: stale, bootMs: BOOT, pidAlive: true }).live, false);
  ck(
    '…and the file it names is therefore NOT in flight, so a sweep can pick it up again',
    classifySweep({
      runningFile: suiteRecordLiveness({ rec: stale, bootMs: BOOT, pidAlive: true }).live ? stale.file : null,
      file: 'integrator-dsp.js',
      hasDoneMarker: false,
      journalDone: 1424
    }),
    'unknown'
  );
  const fresh = { pid: 4242, child: 4243, file: 'oxydex-dsp.js', startedAt: '2026-08-20T19:00:00.000Z' };
  ck('a post-boot record whose pid is running is LIVE', suiteRecordLiveness({ rec: fresh, bootMs: BOOT, pidAlive: true }).live, true);
  ck('a post-boot record whose pid is GONE is stale — the crash case, no reboot needed', suiteRecordLiveness({ rec: fresh, bootMs: BOOT, pidAlive: false }).live, false);
  ck('no record at all is not a running suite', suiteRecordLiveness({ rec: null, bootMs: BOOT, pidAlive: true }).live, false);
  ck('a record carrying no pid cannot vouch for anything', suiteRecordLiveness({ rec: { file: 'a.js' }, bootMs: BOOT, pidAlive: true }).live, false);
  /* The documented fail-direction: unreadable timestamp + live pid ⇒ LIVE. Declaring a live sweep
     dead spawns a second worker pool into the same cores; declaring a dead one live only stalls. */
  ck('an unparseable startedAt with a live pid resolves LIVE, never dead', suiteRecordLiveness({ rec: { pid: 4242, file: 'a.js', startedAt: 'whenever' }, bootMs: BOOT, pidAlive: true }).live, true);
  ck('the boot test states WHY, so a reader is not left guessing', suiteRecordLiveness({ rec: stale, bootMs: BOOT, pidAlive: true }).reason.includes('boot'), true);
  ck('the suite driver dying does not stop its child — that is ORPHANED, not stale', suiteRecordLiveness({ rec: fresh, bootMs: BOOT, pidAlive: false, childAlive: true }).state, 'orphaned');
  ck('…and an ORPHANED file still counts as being SWEPT, so nothing starts a second sweep of it', suiteRecordLiveness({ rec: fresh, bootMs: BOOT, pidAlive: false, childAlive: true }).sweeping, true);
  ck('…but it is NOT live: no watchdog, no stall-restart, and no done-marker will be written', suiteRecordLiveness({ rec: fresh, bootMs: BOOT, pidAlive: false, childAlive: true }).live, false);
  ck('a child alive from BEFORE the boot is impossible — the boot proof still wins', suiteRecordLiveness({ rec: stale, bootMs: BOOT, pidAlive: true, childAlive: true }).state, 'stale');

  console.log('\nparseArgv — an unknown flag must not launch a multi-hour sweep');
  ck('--help is a known flag, and asks for help', parseArgv(['--help']), { unknown: [], help: true });
  ck('-h too', parseArgv(['-h']).help, true);
  ck('a typo is UNKNOWN rather than a fleet launch', parseArgv(['--satus']), { unknown: ['--satus'], help: false });
  /* Arity, not pattern: the value of a known flag is consumed, so it is never reported as unknown. */
  ck('a flag value is not mistaken for a flag', parseArgv(['--file', 'oxydex-dsp.js', '--jobs', '22']), { unknown: [], help: false });
  ck('…including a value that itself looks like a flag', parseArgv(['--lane', '--weird']), { unknown: [], help: false });
  ck('a bare positional is refused — it reads as one file and would sweep all nine', parseArgv(['oxydex-dsp.js']), { unknown: ['oxydex-dsp.js'], help: false });
  /* No arguments IS the documented fleet launch; the guard must not break it. */
  ck('no arguments is not an error — that is the fleet sweep', parseArgv([]), { unknown: [], help: false });
  ck(
    'every declared flag parses clean at its own arity',
    Object.entries(CLI_FLAGS)
      .filter(([f, n]) => parseArgv(n ? [f, 'x'] : [f]).unknown.length > 0)
      .map(([f]) => f),
    []
  );
  /* The same trap from the other side: a flag documented in --help but missing from the table would
     be REFUSED, and the refusal would point at the very text that recommended it. */
  ck(
    'every flag the usage text names is one the parser accepts',
    (USAGE.match(/(?<![\w-])--[a-z][a-z-]*/g) || []).filter((f) => !Object.hasOwn(CLI_FLAGS, f)),
    []
  );

  /* And the direction that actually broke: the CODE reads a flag the TABLE never declared. The two
     existing checks cover declared->parses and usage->declared; neither can see a flag that is
     implemented and undocumented, which is exactly what `--crawl-dir` was — refused in production
     while `mutation-ai-probe` printed it as the recommended invocation.
     ⚠️ COMMENTS ARE STRIPPED FIRST, and that is load-bearing: the prose above this table contains
     the literal `has('--x')` as an EXAMPLE, and a scan that reads it as a real call reports a
     phantom missing flag. A checker that cries wolf gets bypassed — the same reasoning that made
     values skipped by arity rather than pattern-matched. */
  ck(
    'every flag the CODE reads is one the parser accepts',
    (() => {
      const src = readFileSync(new URL(import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const read = new Set([...src.matchAll(/(?:opt|has)\(\s*'(--[a-z0-9-]+)'/g)].map((m) => m[1]));
      return [...read].filter((f) => !Object.hasOwn(CLI_FLAGS, f)).sort();
    })(),
    []
  );

  console.log('\nmdCell — escape order is the whole of the fix');
  const BS = String.fromCharCode(92);
  ck('a pipe is escaped', mdCell('a|b'), 'a' + BS + '|b');
  /* CodeQL found this one: escaping | without first escaping BS turns "a\\|b" into a literal
     backslash followed by an UNESCAPED pipe, which splits the table row. DSP source is full of
     backslashes, so it was never hypothetical. */
  ck('a backslash is escaped FIRST, so the pipe stays escaped', mdCell('a' + BS + '|b'), 'a' + BS + BS + BS + '|b');
  /* The operator column was never escaped at all — and operators are NAMED "bool || → &&", so every
     such row had been splitting into extra columns for the whole document. */
  ck('an operator containing || is escaped', mdCell('bool || → &&'), 'bool ' + BS + '|' + BS + '| → &&');
  /* Truncating AFTER escaping can cut a two-character escape in half and leave a trailing backslash
     that escapes the closing backtick. Slice first. */
  ck('truncation happens BEFORE escaping', mdCell('aaaa|bbbb', 5), 'aaaa' + BS + '|');
  ck('plain text is untouched', mdCell('ordinary source'), 'ordinary source');

  console.log('\nrenderInventory — a partial sweep must never read as a finished one');
  const fin = [{ file: 'a.js', done: 100, killed: 40, survived: 60, inFlight: 0, state: 'complete', survivors: [] }];
  const run = [{ file: 'b.js', done: 10, killed: 5, survived: 5, inFlight: 3, state: 'in flight', survivors: [] }];
  ck('a finished file reads complete', /complete \|/.test(renderInventory({ files: fin, generatedAt: '2026-01-01', mapPath: null })), true);
  ck('a running file is flagged in the state column', /\| in flight \|/.test(renderInventory({ files: run, generatedAt: '2026-01-01', mapPath: null })), true);
  ck('…and the caveat is spelled out, not just a marker', /snapshot of a running sweep/.test(renderInventory({ files: run, generatedAt: '2026-01-01', mapPath: null })), true);
  /* `unknown` must not be silently folded in with `complete` in the fleet row — that is the whole
     point of having a third state rather than a boolean. */
  const unk = [{ file: 'c.js', done: 7, killed: 3, survived: 4, inFlight: 0, state: 'unknown', survivors: [] }];
  ck('an unknown file is caveated too, not treated as complete', /not confirmed-complete/.test(renderInventory({ files: unk, generatedAt: '2026-01-01', mapPath: null })), true);
  ck('…and the fleet row says how many are unconfirmed', /includes 1 unconfirmed/.test(renderInventory({ files: unk, generatedAt: '2026-01-01', mapPath: null })), true);
  ck('a fully complete fleet claims no caveat', /not confirmed-complete/.test(renderInventory({ files: fin, generatedAt: '2026-01-01', mapPath: null })), false);
  /* Self-locating: someone who finds this file with no context must be able to get back to the tool. */
  ck('the list says where the suite lives', /tools\/mutation-suite\.mjs/.test(renderInventory({ files: fin, generatedAt: '2026-01-01', mapPath: null })), true);
  ck('…and says when no map was used, rather than staying silent', /not built/.test(renderInventory({ files: fin, generatedAt: '2026-01-01', mapPath: null })), true);

  console.log('\nclusterKeys — a labour saving, and it must not invent structure');
  const A = [1, 0, 0];
  const B = [0, 1, 0];
  ck('identical vectors form one family', clusterKeys(['a', 'b'], [A, A]).length, 1);
  ck('orthogonal vectors do not', clusterKeys(['a', 'b'], [A, B]).length, 2);
  ck('a missing vector is dropped, not clustered blind', clusterKeys(['a', 'b'], [A, null]).flat(), ['a']);
  ck('families come back largest first', clusterKeys(['a', 'b', 'c'], [A, B, B])[0].length, 2);

  console.log('\n§4 lanes — different units, never summed, absent means ABSENT');
  const ll = parseLaneLedger('{"key":"a","verdict":"pseudo-tested"}\n{"key":"b","verdict":"tested"}\n{"key":"a","verdict":"tested"}\n{"key":"c","verd');
  ck('last record per key wins — a resumed ledger replays', ll.byVerdict.tested, 2);
  ck('…so the superseded verdict is gone', ll.byVerdict['pseudo-tested'], undefined);
  ck('…and a torn final line is skipped, not repaired', ll.total, 2);
  ck('an empty ledger parses to zero, not a throw', parseLaneLedger('').total, 0);
  const cands = laneLedgerCandidates(process.cwd(), 'ppgdex-dsp.js', {
    existsFn: () => true,
    readdirFn: (d) => (/tepna-mutation/.test(d) ? ['levela-ppgdex-dsp-js.jsonl', 'levelb-ppgdex-dsp-js-g1.jsonl', 'levelb-oxydex-dsp-js-g1.jsonl'] : ['levelb-ppgdex-dsp-js-g2.jsonl'])
  });
  ck('the pseudo ledger is found in the SHARED dir', cands.pseudo.length === 1 && /tepna-mutation/.test(cands.pseudo[0]), true);
  ck('delete-lane ledgers collect across BOTH dirs and ALL groups', cands.del.length, 2);
  ck(
    // basename, NOT the whole path. The candidates are built from `process.cwd()`, so a bare
    // /oxydex/ over the full path also matches the CWD PREFIX — and `wt-<dex>-<task>` is the
    // natural worktree name for node work here. Measured 2026-08-24: this selftest FALSE-FAILS
    // in `wt-oxydex-acq` while the primary checkout and CI pass, because every candidate path
    // contains the directory name. The leak this pins is a LEDGER leaking in, which is a fact
    // about the filename segment; the loose pattern named more than the thing it tested (§4b).
    "…and another file's ledger never leaks in",
    cands.del.some((p) => /oxydex/.test(basename(p))),
    false
  );
  const laneMd = renderLaneSections({ pseudo: { files: [{ file: 'x.js', total: 3, byVerdict: { tested: 2, 'not-covered': 1 } }] }, del: { files: [] } }).join('\n');
  ck('each lane section names its UNIT in the header', /unit: \*\*functions\*\*/.test(laneMd) && /unit: \*\*statements\*\*/.test(laneMd), true);
  ck('verdicts are reported verbatim, not re-mapped', /`not-covered` 1/.test(laneMd), true);
  ck('an empty lane REFUSES: absent input, not a clean bill', /NOT a clean bill/.test(laneMd), true);
  ck('no combined cross-lane total exists anywhere in the section', /never summed/.test(laneMd) && !/fleet total/i.test(laneMd), true);

  console.log('\nlocal-AI kill drafting — the model may pick the FIELD, never the EXPECTED VALUE');
  /* The whole safety argument is that a wrong projection cannot survive, so these assert the
     rejection paths at least as hard as the acceptance one. */
  ck('an empty reply is a REFUSAL, not an absent finding', parseDraftReply('').ok, false);
  ck('…and says so in terms a reader can act on', /empty reply/.test(parseDraftReply('   ').why), true);
  ck('a reply missing PROJECTION is rejected', parseDraftReply('PROPERTY: it counts beats').ok, false);
  ck('a reply missing PROPERTY is rejected', parseDraftReply('PROJECTION: out.n').ok, false);
  ck('an explicit REFUSE is honoured and flagged as such', parseDraftReply('PROJECTION: out.a\nPROPERTY: REFUSE').refused, true);
  ck('a well-formed reply parses', parseDraftReply('PROJECTION: out.nUsable\nPROPERTY: it counts only physiological beats'), {
    ok: true,
    projection: 'out.nUsable',
    property: 'it counts only physiological beats'
  });
  /* MODEL OUTPUT IS ABOUT TO BE EVALUATED. The allowlist is the only thing between a generated
     string and `new Function`, so each escape shape gets its own assertion rather than one blanket
     "rejects bad input" — a single case passes while the others are wide open. */
  ck('a projection calling out is rejected', safeProjection('require("fs")'), null);
  ck('…process', safeProjection('out[process.env.X]'), null);
  ck('…constructor escape', safeProjection('out.constructor'), null);
  /* ⚠ THESE TWO EXIST BECAUSE THE ALLOWLIST HAD NO TEST OF ITS OWN. Every other escape case above
     is also caught by the denylist, so deleting the charset allowlist — the PRIMARY defence, the
     denylist is only a backstop — survived a planted mutation. Both strings below carry a character
     the allowlist rejects and an identifier the denylist has never heard of, so only the allowlist
     can catch them. A guard with no assertion that fails when it is removed is not a guard. */
  ck('a statement separator is rejected — only the allowlist can see this', safeProjection('out.a; sideEffect(9)'), null);
  ck('…as is a template literal', safeProjection('out[`a`]'), null);
  ck('markdown-wrapped projection is unwrapped, then validated', parseDraftReply('PROJECTION: `out.n`\nPROPERTY: p').projection, 'out.n');
  ck('digit-leading key is normalized to bracket form', parseDraftReply('PROJECTION: out.EprPress.2s.data[0]\nPROPERTY: p').projection, 'out.EprPress["2s"].data[0]');
  ck('wrapping + digit key compose', parseDraftReply('PROJECTION: `out.a.2s`\nPROPERTY: p').projection, 'out.a["2s"]');
  ck('backtick INSIDE an expression still rejected after unwrap', parseDraftReply('PROJECTION: `out[`a`]`\nPROPERTY: p').ok, false);
  ck('unwrap does not enable calls', parseDraftReply('PROJECTION: `require("fs")`\nPROPERTY: p').ok, false);
  ck('plain identifier paths unchanged', parseDraftReply('PROJECTION: out.a.b[0]\nPROPERTY: p').projection, 'out.a.b[0]');
  const edf = JSON.stringify({ 'EprPress.2s': { data: [7, 8] }, plain: 1 });
  const edf2 = JSON.stringify({ 'EprPress.2s': { data: [9, 8] }, plain: 1 });
  ck('dotted-key rescue: resegments against the recorded object', resegmentPath('out.EprPress["2s"].data[0]', JSON.parse(edf)), 'out["EprPress.2s"].data[0]');
  ck('dotted-key rescue: bracketed pair form too', resegmentPath('out["EprPress"]["2s"].data[0]', JSON.parse(edf)), 'out["EprPress.2s"].data[0]');
  ck(
    'parse→resegment composition: the model dotted form ends applicable',
    resegmentPath(parseDraftReply('PROJECTION: out.EprPress.2s.data[0]\nPROPERTY: p').projection, JSON.parse(edf)),
    'out["EprPress.2s"].data[0]'
  );
  ck('rescue leaves resolvable paths alone', resegmentPath('out.plain', JSON.parse(edf)), 'out.plain');
  ck('rescue refuses non-path expressions', resegmentPath('out.a === 1', JSON.parse(edf)), null);
  ck('discriminates end-to-end through a dotted key', projectionDiscriminates('out.EprPress["2s"].data[0]', edf, edf2).ok, true);
  const nested = JSON.stringify({ PLD: { signals: { 'EprPress.2s': { data: [7] } } }, SA2: { signals: {} } });
  const nested2 = JSON.stringify({ PLD: { signals: { 'EprPress.2s': { data: [9] } } }, SA2: { signals: {} } });
  ck('descent rescue: omitted levels + dotted key, unique match', descendRescue('out.EprPress["2s"].data[0]', JSON.parse(nested)), 'out.PLD.signals["EprPress.2s"].data[0]');
  ck('descent rescue: ambiguity REFUSES', descendRescue('out.x', { a: { x: 1 }, b: { x: 2 } }), null);
  ck('descent rescue: truly absent refuses', descendRescue('out.nope.q', JSON.parse(nested)), null);
  ck('descent end-to-end: shortened model path discriminates', projectionDiscriminates('out.EprPress["2s"].data[0]', nested, nested2).ok, true);
  const dp = diffPaths(JSON.parse(nested), JSON.parse(nested2));
  ck('diff menu: finds the one differing path through a dotted key', dp.length === 1 && dp[0].path === '.PLD.signals["EprPress.2s"].data[0]', true);
  ck('diff menu: identical outputs yield empty', diffPaths({ a: 1 }, { a: 1 }).length, 0);
  ck('diff menu: type mismatch is a diff, not a descent', diffPaths({ a: { x: 1 } }, { a: null })[0].path, '.a');
  ck('…assignment, not comparison', safeProjection('out.a = 1'), null);
  ck('…but a comparison is fine', safeProjection('out.a === 1'), 'out.a === 1');
  ck('a projection that never reads `out` is rejected', safeProjection('1 + 1'), null);
  ck('a plain field access is allowed', safeProjection('out.tsMs'), 'out.tsMs');

  /* THE ONE CHECK THAT DECIDES: does the field actually differ between the two RECORDED outputs.
     Pure function over committed JSON — no model, no test run, no opinion. */
  ck('a discriminating projection is accepted', projectionDiscriminates('out.tsMs', '{"tsMs":null}', '{"tsMs":[]}').ok, true);
  ck('…reporting both observed values', [projectionDiscriminates('out.n', '{"n":0}', '{"n":1}').orig, projectionDiscriminates('out.n', '{"n":0}', '{"n":1}').mutant], ['0', '1']);
  ck("a NON-discriminating projection is REJECTED — this is the model's only failure mode", projectionDiscriminates('out.n', '{"n":5,"m":1}', '{"n":5,"m":2}').ok, false);
  ck('…and says why', /does NOT discriminate/.test(projectionDiscriminates('out.n', '{"n":5}', '{"n":5}').why), true);
  ck('a field absent from both sides is rejected, not silently undefined===undefined', projectionDiscriminates('out.nope', '{"n":1}', '{"n":2}').ok, false);
  ck('a projection that throws is rejected rather than crashing the run', projectionDiscriminates('out.a.b', '{"a":null}', '{"a":{"b":1}}').ok, false);
  ck('non-JSON recorded output is refused', projectionDiscriminates('out.a', 'TIMEOUT', '{"a":1}').ok, false);

  /* A timeout is not a distinguishing input: you cannot ship an assertion that real code hangs. */
  const crawlish = {
    findings: [
      {
        fn: 'f',
        callPath: 'X.f',
        mutants: [
          { status: 'KILLABLE', orig: '"TIMEOUT:2000ms — did not terminate"', mutant: 'null', input: '[]', op: 'o', before: 'b' },
          { status: 'KILLABLE', orig: '{"a":1}', mutant: '{"a":2}', input: '[]', op: 'o', before: 'b' },
          { status: 'SURVIVED', orig: '{"a":1}', mutant: '{"a":2}', input: '[]', op: 'o', before: 'b' }
        ]
      }
    ]
  };
  ck('a killable whose REAL code times out is dropped, not drafted', usableKillables(crawlish).length, 1);
  ck(
    '…and non-killable mutants are never drafted at all',
    usableKillables(crawlish).every((m) => m.status === 'KILLABLE'),
    true
  );

  /* The emitted assertion must carry the REAL code's value. If the model could reach this, the whole
     safety argument collapses, so it is pinned. */
  const drafted = renderDraft({ call: 'P.parse', input: '[""]', op: 'bool && → ||', before: 'x && y' }, 'out.tsMs', 'timestamps are null when absent', 'null');
  ck('the drafted call is built from the probe-found input', /const out = P\.parse\(""\);/.test(drafted), true);
  ck('…the expectation is the recorded REAL output', /JSON\.stringify\(out\.tsMs\), "null"\)/.test(drafted), true);
  ck('…and the draft says out loud that the property line is model-written', /model-written, needs a human read/.test(drafted), true);
  /* ⚠️ THE MODEL WRITES THIS LABEL, so it is untrusted text being emitted into source. The first
     version escaped quotes and THEN truncated, so a cut landing mid-escape left a trailing backslash
     that swallowed the closing quote — the same defect already fixed in `mdCell` in this file. The
     assertion is that the OUTPUT PARSES, not that some regex matched, because the failure is a
     syntax error rather than a wrong-looking string. */
  const parses = (txt) => {
    try {
      new Function(txt.replace(/P\.parse/g, '(() => ({ tsMs: null }))').replace(/T\.eq/g, '((a, b, c) => 0)'));
      return true;
    } catch {
      return false;
    }
  };
  const mk = (prop) => renderDraft({ call: 'P.parse', input: '[""]', op: 'o', before: 'b' }, 'out.tsMs', prop, 'null');
  ck('a label ending in a backslash still emits parseable code', parses(mk('ends with a backslash \\')), true);
  ck('…a label full of quotes too', parses(mk("it returns \"null\", not '' — the parser's rule")), true);
  ck('…and a label longer than the 110-char cut, sliced mid-escape', parses(mk('x'.repeat(108) + " \\'" + 'y'.repeat(40))), true);

  /* Two probe batteries reach the same mutant, so the same assertion arrives twice; counting it
     twice inflates the only number anyone reads. */
  const c1 = { call: 'X.f', input: '[1]' };
  ck('the same call+input+field+expectation is ONE assertion', assertionIdentity(c1, 'out.a', '0') === assertionIdentity({ ...c1 }, 'out.a', '0'), true);
  ck('…a different field is a different assertion', assertionIdentity(c1, 'out.a', '0') === assertionIdentity(c1, 'out.b', '0'), false);
  ck('…and so is a different input', assertionIdentity(c1, 'out.a', '0') === assertionIdentity({ call: 'X.f', input: '[2]' }, 'out.a', '0'), false);

  /* `all N selftests passed` is the form tools/selftest-all.mjs parses for a COUNT; a bare
     'all green' is recognised but countless, and a count is what makes a silent drop from 30
     assertions to 3 visible in CI. */
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

// ── local-AI kill drafting ─────────────────────────────────────────────────────────────────────
/**
 * DRAFT A KILLING ASSERTION FOR EVERY *KILLABLE* MUTANT, USING THE LOCAL MODEL — BUT NEVER LETTING
 * IT SAY WHAT IS CORRECT.
 *
 * The crawl's probe already did the expensive half: for 346 of the 363 killable mutants it recorded
 * a concrete `(callPath, input, orig, mutant)` — an input that provably distinguishes the real code
 * from the mutant, together with what each one returned. Writing the test is therefore not a search;
 * it is transcription. That distinction is the whole basis for using a local model here.
 *
 * ⚠️ THE MODEL IS NOT ALLOWED TO SUPPLY AN EXPECTED VALUE, EVER. `MUTATION-SUITE-FOLLOWUPS` §5b
 * recorded model-drafted assertions as a NON-GOAL, on a measured 0/4 at judging code correctness:
 * a plausible-but-wrong assertion passes, is quoted as evidence, and could never have failed — the
 * hollow gate this whole programme exists to find. That reasoning is still right, and this lane does
 * not overturn it; it routes around it. The model is asked for exactly two things:
 *
 *   PROJECTION — which field of the output to compare. MACHINE-CHECKED: `projectionDiscriminates`
 *                evaluates it against the two RECORDED outputs and requires them to differ. A wrong
 *                projection cannot survive, because the check is exact and needs no model opinion.
 *   PROPERTY   — an English sentence naming the behaviour. NOT machine-checkable; it is a label for
 *                a human, and it is why every draft lands in a review file rather than in the suite.
 *
 * The expected value is copied VERBATIM from the recorded output of the REAL code. So the model
 * cannot state a falsehood about behaviour — its only failure mode is proposing a field that does
 * not discriminate, which is caught in microseconds by a pure function over recorded JSON.
 *
 * ⚠️ WHAT THIS STILL CANNOT DO, and why nothing here is auto-committed: a projection can discriminate
 * and still pin the WRONG behaviour — asserting what the code does rather than what it should do.
 * That is `assertions-encode-shape-not-contract`, and no amount of verification detects it, because
 * the mutant dies either way. A human reads the PROPERTY line and decides. The lane's output is a
 * proposal queue, not a patch.
 *
 * ⚠️ `think: false` IS LOAD-BEARING. qwen3.6 is a reasoning model, and left to deliberate it spends
 * its whole token budget inside `<think>` and returns `response: ""` with HTTP 200 — no error, no
 * warning. Measured 2026-08-18: 0 of 3 usable at 130–202 s each with thinking on; 3 of 3 correct at
 * 20–24 s with it off. An empty reply is therefore treated as a REFUSAL to retry and report, never
 * as "the model had nothing to say" — that is `empty-result-is-not-a-negative` in a new costume.
 */
const CRAWL_DIR = opt('--crawl-dir', join(ROOT, '.mutation-crawl'));
const LOCAL_HOST = 'http://127.0.0.1:11434';

/**
 * MODEL AND CONTEXT ARE MEASURED, NOT CHOSEN. Benchmarked 2026-08-18 over a fixed 10-case sample
 * drawn across five files, scored by `projectionDiscriminates` — an objective grader, which is what
 * makes this a measurement rather than an impression:
 *
 *   model / context                        accepted   s/case   tok/s   ACCEPTED DRAFTS/min
 *   qwen3.6:35b-a3b  ctx16384  (was)         7/10      17.4     1.8          2.4
 *   qwen3.6:35b-a3b  ctx1024                 7/10      13.9     2.2          3.0
 *   qwen3.6:35b-a3b  ctx1024 vendor-sampling 7/10      11.9     2.2          3.5
 *   qwen3.6:27b      ctx1024                 7/10       1.7    31.1         24.7
 *   qwen3.8:27b      ctx1024                 8/10       1.6    35.5         30.0
 *   mistral-small    ctx1024                 8/10       1.1    40.8         43.6
 *   qwen2.5-coder:7b ctx1024                 6/10       0.4   106.7         90.0
 *   qwen3-coder:30b  ctx1024                 8/10       0.7   106.9         68.6   ← default
 *
 * ⚠️ THE FASTEST MODEL IS NOT THE DEFAULT, AND THE REASON IS THAT THE CORPUS IS FINITE. There are
 * 346 killable mutants, not an endless stream, so what matters is how many of them ever get a draft
 * — COVERAGE — not how fast drafts appear. `qwen2.5-coder:7b` posts the highest drafts/min and still
 * leaves 4 of 10 uncovered; retries do not rescue a case a model cannot do, they just spend three
 * attempts failing it. It also missed the one case with independent ground truth (`out.tsMs`, killed
 * by hand first). Ranking on the headline rate alone would have picked it.
 *
 * ⚠️ THE 29× IS A VRAM-FIT CLIFF, NOT A MODEL-QUALITY DIFFERENCE, AND THE DIRECTION IS COUNTER-
 * INTUITIVE: the BIGGEST model is the SLOWEST by an order of magnitude. This box has a 20 GB
 * Radeon RX 7900 XT; `qwen3.6:35b-a3b` is 23 GB, so ~17 % of it spills to CPU and it runs at
 * 1.8 tok/s — absurd for a 3B-active MoE, and that absurdity is the diagnostic tell. MoE is hit
 * hardest by a spill because expert weights are scattered across the bus. Every model that FITS
 * runs 31–107 tok/s regardless of family.
 *
 * `qwen3-coder:30b` is the same architecture that lost — MoE, ~3 B active — and wins by 59× on
 * tok/s purely because 18 GB fits in 20464 MiB where 23 GB does not. VERIFIED, not inferred:
 * `ollama ps` reports `100% GPU` and the card reads 18352 MiB used. If a future model lands near
 * 20 GB, check that line before believing any throughput number.
 *
 * ⚠️ SO "GIVE IT A BIGGER CONTEXT" IS THE WRONG LEVER HERE, AND WAS MEASURED AS SUCH. The prompts
 * this lane sends are 216–509 tokens (p50 253) — the whole fleet fits in 1024 with headroom.
 * Dropping 16384 → 1024 bought 20 % and moved the split only 83 % → 84 %, because it is the WEIGHTS
 * that do not fit, not the KV cache. A larger context would only take VRAM back from the weights.
 * Re-measure both numbers if the hardware changes; neither is a property of the task.
 */
const DRAFT_MODEL = opt('--model', 'qwen3-coder:30b');
const DRAFT_CTX = Number(opt('--ctx', '1024'));

/**
 * RETRY MUST CHANGE THE SAMPLING OR IT CHANGES NOTHING. At temperature 0 the model is deterministic,
 * so re-asking an identical prompt returns a byte-identical answer — a retry loop that looks like it
 * is exploring while provably re-running one draw. Attempt 1 is greedy (reproducible, and the
 * benchmark's default); every retry moves to Qwen's published sampling so it can actually land
 * somewhere else. Qwen's model card additionally warns that greedy decoding can degrade output and
 * cause endless repetition, which is a second reason not to retry into it.
 * Retries are nearly free at ~1 s a draft, and every attempt is scored by the same exact verifier,
 * so more attempts cannot lower quality — only spend time.
 */
const DRAFT_ATTEMPTS = Number(opt('--attempts', '3'));
const SAMPLING = [{ temperature: 0 }, { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 }, { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5 }];

/**
 * A projection is MODEL-SUPPLIED TEXT THAT WE ARE ABOUT TO EVALUATE, so it is charset-restricted
 * before it goes anywhere near a `Function`. This runs in dev tooling over recorded JSON rather than
 * in a bundle, but "the input came from a generative model" is precisely when an allowlist stops
 * being paranoia. Property access, indexing, literals and comparison only — no calls, no assignment.
 */
export function safeProjection(expr) {
  const s = String(expr || '').trim();
  if (!s || s.length > 200) return null;
  if (!/^[A-Za-z0-9_.[\]'"\s?!=<>&|+\-*/%()]+$/.test(s)) return null;
  if (/\b(require|import|process|global|eval|Function|constructor|__proto__|await|new)\b/.test(s)) return null;
  /* Reject ASSIGNMENT while allowing COMPARISON. The first version stripped `[!<>=]=` and then
     looked for a bare `=`, which mangles `===` into `= 1` and rejected every equality test — caught
     by the selftest below, which is why the allowed case is asserted alongside the rejected ones. */
  if (/=/.test(s.replace(/([!<>=])?={1,2}/g, (m) => (/^[!<>=]?={1,2}$/.test(m) && m !== '=' ? '' : m)))) return null;
  if (!/\bout\b/.test(s)) return null; // must actually read the return value
  return s;
}

/** Parse the model's two-line reply. Anything else — including empty — is a refusal, reported as one. */
export function parseDraftReply(text) {
  const t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  if (!t) return { ok: false, why: 'empty reply — the model returned nothing (see the think:false note above)' };
  const proj = /PROJECTION:\s*(.+)/i.exec(t);
  const prop = /PROPERTY:\s*([\s\S]+?)(?:\n\s*\n|$)/i.exec(t);
  if (prop && /^REFUSE\b/i.test(prop[1].trim())) return { ok: false, why: 'model declined — it could not name a behaviour behind the difference', refused: true };
  if (!proj || !prop) return { ok: false, why: 'reply did not carry both PROJECTION and PROPERTY lines' };
  /* NORMALIZE BEFORE VALIDATING (2026-08-27, measured on cpapdex _synthEdfSet: kept 0 of 61
     because every projection was refused). Two model habits, both fixable without widening
     the rail: (1) markdown wrapping — qwen emits PROJECTION: `out.x` and the backtick is
     (correctly) outside the charset, so the projection dies for its QUOTING, not its content;
     strip one layer of wrapping backticks/quotes only when they enclose the whole expression.
     (2) EDF-style keys that start with a digit — `out.EprPress.2s.data[0]` passes the charset
     but is a JS SyntaxError at evaluation; rewrite `.2s` → `["2s"]` for segments that begin
     with a digit. Both rewrites are syntactic sugar over the SAME allowlist — backticks inside
     an expression, calls, and assignment are rejected exactly as before (selftests pin this). */
  let raw = proj[1].trim();
  const wrap = raw.match(/^([`'"])(.+)\1$/s);
  if (wrap) raw = wrap[2].trim();
  raw = raw.replace(/\.(\d[\w-]*)(?=[.[]|\s|$)/g, '["$1"]');
  const safe = safeProjection(raw);
  if (!safe) return { ok: false, why: 'projection rejected by the charset allowlist: ' + proj[1].trim().slice(0, 80) };
  return { ok: true, projection: safe, property: prop[1].trim().replace(/\s+/g, ' ') };
}

/**
 * THE ONLY CHECK THAT MATTERS, AND IT NEEDS NO MODEL AND NO TEST RUN. Both outputs were recorded by
 * the probe, so asking "does this field actually differ" is a pure function over committed JSON —
 * exact, instant, and independent of everything the model said.
 */
/* DOTTED-KEY RESCUE (2026-08-27, second half of the _synthEdfSet lesson). EDF signal names are
   keys that CONTAIN dots ("EprPress.2s"), which dot notation cannot express — the model writes
   `out.EprPress.2s.data[0]` and any static rewrite must GUESS the segmentation. Nothing needs
   guessing: the recorded orig output is ground truth for which keys exist. For a PURE PATH
   projection only, re-segment greedily against the actual object — when a segment resolves to
   undefined but joining it with following segment(s) by '.' names a real key, merge them. Pure
   function of (path, recorded object); no model input decides anything. Non-path expressions
   (comparisons etc.) are left untouched. */
export function resegmentPath(expr, obj) {
  const m = String(expr).match(/^out((?:\.[A-Za-z_$][\w$-]*|\["[^"\\]+"\]|\['[^'\\]+'\]|\[\d+\])+)$/);
  if (!m) return null;
  const segs = [];
  const re = /\.([A-Za-z_$][\w$-]*)|\["([^"\\]+)"\]|\['([^'\\]+)'\]|\[(\d+)\]/g;
  let mm;
  while ((mm = re.exec(m[1]))) segs.push(mm[4] !== undefined ? { idx: Number(mm[4]) } : { key: mm[1] ?? mm[2] ?? mm[3] });
  let cur = obj;
  const outSegs = [];
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    if (sg.idx !== undefined) {
      if (!Array.isArray(cur)) return null;
      cur = cur[sg.idx];
      outSegs.push('[' + sg.idx + ']');
      continue;
    }
    if (cur === null || typeof cur !== 'object') return null;
    let key = sg.key;
    let consumed = 0;
    if (!(key in cur)) {
      for (let j = i + 1; j < segs.length && segs[j].key !== undefined; j++) {
        key = key + '.' + segs[j].key;
        consumed = j - i;
        if (key in cur) break;
      }
      if (!(key in cur)) return null;
    }
    i += consumed;
    cur = cur[key];
    outSegs.push(/^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '["' + key + '"]');
  }
  return 'out' + outSegs.join('');
}

/* UNIQUE-DESCENT RESCUE (third failure mode, same night): the model also OMITS intermediate
   levels — it writes `out.EprPress.2s.data[0]` where the object holds
   `out.PLD.signals["EprPress.2s"].data[0]`. Resegmentation cannot rescue a path whose first
   segment is missing from the root. So: when root resolution fails for a pure path, search the
   recorded object for anchor points where the WHOLE path resolves (with dotted-key merging), and
   rescue ONLY when exactly one location matches — two matches is ambiguity, and ambiguity
   refuses. Still a pure function of (path, recorded JSON): the model proposes a suffix; the
   ground-truth object decides where — or whether — it lives. Bounded BFS (depth 6, 20k nodes). */
export function descendRescue(expr, obj) {
  const direct = resegmentPath(expr, obj);
  if (direct) return direct;
  const m = String(expr).match(/^out((?:\.[A-Za-z_$][\w$-]*|\["[^"\\]+"\]|\['[^'\\]+'\]|\[\d+\])+)$/);
  if (!m) return null;
  const matches = [];
  const queue = [{ node: obj, prefix: '' }];
  let seen = 0;
  while (queue.length && seen < 20000 && matches.length < 2) {
    const { node, prefix } = queue.shift();
    seen++;
    if (node === null || typeof node !== 'object') continue;
    if (prefix) {
      const sub = resegmentPath('out' + m[1], node);
      if (sub) matches.push(prefix + sub.slice(3));
    }
    if (prefix.split('.').length > 6) continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 50); i++) queue.push({ node: node[i], prefix: prefix + '[' + i + ']' });
    } else {
      for (const k of Object.keys(node)) queue.push({ node: node[k], prefix: prefix + (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + k + '"]') });
    }
  }
  if (matches.length !== 1) return null; // 0 = truly absent; 2+ = ambiguous — both refuse
  return 'out' + matches[0];
}

export function projectionDiscriminates(expr, origText, mutantText) {
  let safe = safeProjection(expr);
  if (!safe) return { ok: false, why: 'unsafe projection' };
  let a, b;
  try {
    a = JSON.parse(origText);
    b = JSON.parse(mutantText);
  } catch {
    return { ok: false, why: 'recorded outputs are not both JSON — cannot compare a projection over them' };
  }
  const reseg = descendRescue(safe, a);
  if (reseg && reseg !== safe && safeProjection(reseg)) safe = reseg;
  let fn;
  try {
    fn = new Function('out', '"use strict"; return (' + safe + ');');
  } catch {
    return { ok: false, why: 'projection is not a valid expression' };
  }
  let va, vb;
  try {
    va = fn(a);
    vb = fn(b);
  } catch (e) {
    return { ok: false, why: 'projection threw when applied: ' + String(e && e.message).slice(0, 80) };
  }
  const sa = JSON.stringify(va) ?? 'undefined';
  const sb = JSON.stringify(vb) ?? 'undefined';
  if (sa === sb) return { ok: false, why: 'projection does NOT discriminate — both sides give ' + sa.slice(0, 60), orig: sa, mutant: sb };
  if (va === undefined && vb === undefined) return { ok: false, why: 'projection reads a field that exists on neither side' };
  return { ok: true, orig: sa, mutant: sb };
}

/** The assertion text. The expected value comes from the RECORDED REAL OUTPUT — never from the model. */
export function renderDraft(c, projection, property, origValue) {
  const call = c.call + '(' + String(c.input).replace(/^\[|\]$/g, '') + ')';
  return (
    '  /* mutant: ' +
    c.op +
    '  @ ' +
    c.before +
    '\n' +
    "     drafted from a probe-found distinguishing input; expected value is the REAL code's recorded\n" +
    '     output, not a model claim. PROPERTY (model-written, needs a human read):\n' +
    '     ' +
    property +
    ' */\n' +
    '  {\n' +
    '    const out = ' +
    call +
    ';\n' +
    /* ⚠️ JSON.stringify, NOT hand-quoting — AND SLICE BEFORE ESCAPING. The first version did
       `.replace(/'/g, "\\'").slice(0, 110)`, which escapes and THEN truncates, so a cut landing
       mid-escape leaves a trailing backslash that swallows the closing quote and emits a file that
       does not parse. That is the SAME defect already fixed once in `mdCell` in this very file
       (CodeQL js/incomplete-sanitization), reintroduced ten lines away — proximity is not
       protection. The model writes this string, so it is untrusted input by construction. */
    '    T.eq(' +
    JSON.stringify(property.slice(0, 110)) +
    ', JSON.stringify(' +
    projection +
    '), ' +
    JSON.stringify(origValue) +
    ');\n' +
    '  }\n'
  );
}

async function askLocal(prompt, model, attempt = 0) {
  const res = await fetch(LOCAL_HOST + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      options: { num_ctx: DRAFT_CTX, num_predict: 260, ...SAMPLING[Math.min(attempt, SAMPLING.length - 1)] }
    })
  });
  const j = await res.json();
  return j.response || '';
}

/* THE DIFF MENU (2026-08-27, from the post-rescue failure profile: 17 of 33 attempts on one
   function proposed projections that do NOT discriminate — and the prompt shows each output
   sliced to 700 chars, so on a large output the model cannot even SEE where the difference is.
   The harness holds both recorded outputs, so the set of differing paths is computable ground
   truth. Hand the model that MENU: it stops guessing WHERE the difference lives and only chooses
   which difference is meaningful, then names the property. §0 intact — the menu is a pure
   function of the two recorded outputs; the model still supplies no value. */
export function diffPaths(a, b, opts = {}) {
  const max = opts.max ?? 12;
  const maxDepth = opts.maxDepth ?? 8;
  const out = [];
  const seg = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + String(k).replace(/"/g, '') + '"]');
  const queue = [{ a, b, path: '', depth: 0 }];
  let seen = 0;
  while (queue.length && out.length < max && seen < 20000) {
    const { a: x, b: y, path, depth } = queue.shift();
    seen++;
    const tx = x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
    const ty = y === null ? 'null' : Array.isArray(y) ? 'array' : typeof y;
    if (tx !== ty) {
      out.push({ path, a: x, b: y });
      continue;
    }
    if (tx === 'object' || tx === 'array') {
      if (depth >= maxDepth) continue;
      const keys = tx === 'array' ? [...new Set([...x.keys(), ...y.keys()])].slice(0, 200) : [...new Set([...Object.keys(x), ...Object.keys(y)])];
      for (const k of keys) queue.push({ a: x[k], b: y[k], path: path + (tx === 'array' ? '[' + k + ']' : seg(k)), depth: depth + 1 });
      continue;
    }
    if (!Object.is(x, y)) out.push({ path, a: x, b: y });
  }
  return out;
}

function diffMenu(origText, mutantText) {
  let a;
  let b;
  try {
    a = JSON.parse(origText);
    b = JSON.parse(mutantText);
  } catch {
    return '';
  }
  const d = diffPaths(a, b);
  if (!d.length) return '';
  const row = (v) => String(JSON.stringify(v)).slice(0, 60);
  return (
    '\nDIFFERING FIELDS (machine-computed from the two outputs — your PROJECTION should be `out` followed by ONE of these paths, copied EXACTLY):\n' +
    d.map((x) => '  out' + x.path + '   CORRECT ' + row(x.a) + '  BUGGY ' + row(x.b)).join('\n') +
    '\n'
  );
}

function draftPrompt(c) {
  return (
    'You are helping write a regression test. Below is a real function call, what the CORRECT code returns, and what a BUGGY variant returns. Both outputs are given verbatim; do NOT invent or recompute values.\n\n' +
    'CALL:    ' +
    c.call +
    '(...' +
    c.input +
    ')\n' +
    'CORRECT: ' +
    String(c.orig).slice(0, 700) +
    '\n' +
    'BUGGY:   ' +
    String(c.mutant).slice(0, 700) +
    '\n' +
    'The bug was introduced by changing: ' +
    c.before +
    '   (operator mutation: ' +
    c.op +
    ')\n' +
    diffMenu(c.orig, c.mutant) +
    '\n' +
    'Answer with exactly two lines and nothing else:\n' +
    'PROJECTION: a JavaScript expression over a variable named `out` (the return value) that has a DIFFERENT value for CORRECT vs BUGGY. Prefer the smallest, most meaningful field. Example: out.nUsable\n' +
    'PROPERTY: one short English sentence naming the behaviour this protects, written for a reader who has not seen the bug. If you cannot name a real behaviour (the difference is an opaque constant with no meaning), write exactly: REFUSE'
  );
}

/** Pull every killable mutant that carries a usable distinguishing input out of a crawl result. */
export function usableKillables(crawl) {
  const out = [];
  let skippedTruncated = 0;
  for (const fi of (crawl && crawl.findings) || []) {
    for (const m of fi.mutants || []) {
      if (m.status !== 'KILLABLE') continue;
      const o = String(m.orig ?? ''),
        mu = String(m.mutant ?? '');
      /* A "distinguishing input" where the REAL code TIMES OUT is not a test case — you cannot ship
         an assertion that production code hangs. Dropped, and counted, rather than drafted. */
      if (/TIMEOUT/.test(o) || /TIMEOUT/.test(mu)) continue;
      if (/^"?(THREW|ERROR)/.test(o) && /^"?(THREW|ERROR)/.test(mu)) continue;
      /* A record the CRAWL flagged as bound-truncated cannot be projected honestly — refuse with
         the real reason rather than let JSON.parse manufacture a "not both JSON" mystery. */
      if (m.recordTruncated) {
        skippedTruncated++;
        continue;
      }
      out.push({ fn: fi.fn, call: fi.callPath, ...m });
    }
  }
  if (skippedTruncated) out.skippedTruncated = skippedTruncated;
  return out;
}

/** The identity of a DRAFTED ASSERTION: same call, same input, same field, same expectation. */
export function assertionIdentity(c, projection, expected) {
  return [c.call, String(c.input), String(projection).trim(), String(expected)].join(String.fromCharCode(1));
}

async function cmdDraft(file) {
  const cp = join(CRAWL_DIR, basename(file) + '.crawl.json');
  if (!existsSync(cp)) return log('no crawl result for ' + file + ' at ' + cp + ' — crawl it first (this is a refusal, not an empty result)');
  const crawl = JSON.parse(readFileSync(cp, 'utf8'));

  /* ⚠️ MERGE THE AI PROBE'S FINDINGS — this seam shipped BROKEN and untested. `mutation-ai-probe.mjs`
     converts undistinguished survivors into killables and its own output said "feed to --draft",
     while --draft read only `<file>.crawl.json` and never looked at `<file>.ai-probe.json` sitting
     beside it (or in the repo-local `.mutation-crawl/`). So an overnight probe run would have
     produced killables and exactly zero drafts, and both halves would have looked healthy alone —
     the classic seam failure: two tools, each verified, joined by a filename convention nobody ran. */
  let aiKillable = 0;
  for (const dir of [CRAWL_DIR, join(ROOT, '.mutation-crawl')]) {
    const ap = join(dir, basename(file) + '.ai-probe.json');
    if (!existsSync(ap)) continue;
    try {
      const probe = JSON.parse(readFileSync(ap, 'utf8'));
      for (const fi of probe.findings || []) {
        /* The probe emits per-mutant callPath on each mutant record; lift it to the finding shape
           usableKillables expects (callPath at the finding level). */
        for (const m of fi.mutants || []) {
          crawl.findings = crawl.findings || [];
          crawl.findings.push({ fn: m.fn || fi.fn, callPath: m.callPath || fi.callPath, mutants: [m] });
          if (m.status === 'KILLABLE') aiKillable++;
        }
      }
      break; // first hit wins; the two locations are the same artefact at different roots
    } catch {
      log('  ⚠ unreadable ai-probe result at ' + ap + ' — drafting from the crawl alone');
    }
  }

  const cases = usableKillables(crawl);
  const limit = Number(opt('--limit', '0')) || cases.length;
  const pick = cases.slice(0, limit);
  if (!pick.length) return log('no killable mutant in ' + file + ' carries a usable distinguishing input — nothing to draft');

  log('KILL DRAFTING — ' + file);
  log('  model ' + DRAFT_MODEL + ' (think:false — a reasoning reply returns EMPTY, see the header)');
  log('  ' + cases.length + ' killable mutant(s) carry a distinguishing input (' + aiKillable + ' from the AI probe); drafting ' + pick.length);
  log("  the model picks WHICH FIELD to assert on; the expected VALUE is the real code's recorded output.\n");

  const t0 = Date.now();
  const kept = [];
  const rejected = [];
  for (let i = 0; i < pick.length; i++) {
    const c = pick[i];
    const name = c.call + ' [' + c.op + '] @ ' + String(c.before).slice(0, 54);
    /* RETRY ON ANY REJECTION, NOT JUST ON AN EMPTY REPLY. The earlier version retried only the empty
       case, which left the two commonest failures — an unparseable reply and a field that does not
       discriminate — costing a draft on the first attempt. Both are recoverable, both are detected
       exactly, and at ~1 s a draft the retries are free. Each attempt uses different sampling (see
       SAMPLING) because a greedy retry is a re-run, not a second try. */
    let parsed = null;
    let disc = null;
    let lastWhy = '';
    for (let a = 0; a < DRAFT_ATTEMPTS; a++) {
      let reply = '';
      try {
        reply = await askLocal(draftPrompt(c), DRAFT_MODEL, a);
      } catch {
        log('✗ local model unreachable at ' + LOCAL_HOST + ' — stopping. No drafts are produced (a refusal, not an empty result).');
        return;
      }
      const p2 = parseDraftReply(reply);
      if (!p2.ok) {
        lastWhy = p2.why;
        if (p2.refused) break; // an explicit REFUSE is an answer; asking again is badgering it
        continue;
      }
      const d2 = projectionDiscriminates(p2.projection, c.orig, c.mutant);
      if (d2.ok) {
        parsed = p2;
        disc = d2;
        break;
      }
      lastWhy = d2.why;
    }
    if (!parsed) parsed = { ok: false, why: lastWhy || 'no attempt produced a usable draft' };
    const el = (Date.now() - t0) / 1000;
    const rate = (i + 1) / (el / 60);
    const eta = rate > 0 ? Math.round((pick.length - i - 1) / rate) : 0;
    const prog = '[' + String(i + 1).padStart(3) + '/' + pick.length + '  ' + rate.toFixed(1) + '/min  ETA ' + eta + 'm  kept ' + kept.length + ']';

    if (!parsed.ok) {
      rejected.push({ name, why: parsed.why });
      log(prog + ' ✗ ' + name);
      log('      ' + parsed.why);
      continue;
    }
    /* DEDUPE ON THE ASSERTION, NOT ON THE MUTANT. The probe reaches the same mutant from more than
       one battery, so a raw `kept` count double-counts: the first pilot reported 7 kept for 5
       distinct assertions. One assertion covering several mutants is real efficiency and is reported
       as `covers`; the same assertion counted twice is an inflated number, and this repo has paid for
       enough of those. */
    const aid = assertionIdentity(c, parsed.projection, disc.orig);
    const prev = kept.find((k) => k.aid === aid);
    if (prev) {
      prev.covers++;
      log(prog + ' ✓ ' + name + '  (same assertion as an earlier draft — covers ' + prev.covers + ' mutants, not counted twice)');
      continue;
    }
    kept.push({ aid, covers: 1, c, ...parsed, disc, text: renderDraft(c, parsed.projection, parsed.property, disc.orig) });
    log(prog + ' ✓ ' + name);
    log('      killed by ' + parsed.projection + ':  real=' + disc.orig.slice(0, 40) + '   mutant=' + disc.mutant.slice(0, 40));
    log('      "' + parsed.property.slice(0, 96) + '"');
  }

  const outPath = join(stateDir(), basename(file) + '.drafts.js');
  const header =
    '/* DRAFTED ASSERTIONS — ' +
    file +
    '\n' +
    ' * Generated by `mutation-suite.mjs --draft`. Every PROJECTION below was machine-verified to\n' +
    " * discriminate the real code from its mutant, and every expected value is the real code's\n" +
    ' * recorded output. NOTHING HERE IS VERIFIED TO ASSERT THE *INTENDED* BEHAVIOUR — a projection\n' +
    ' * can discriminate and still pin a bug in place. Read each PROPERTY line before adopting it.\n' +
    ' */\n\n';
  writeFileSync(outPath, header + kept.map((k) => k.text).join('\n'));
  const mins = (Date.now() - t0) / 60000;
  const covered = kept.reduce((a, k) => a + k.covers, 0);
  log(
    '\n  ' + kept.length + ' DISTINCT assertion(s) covering ' + covered + ' mutant(s); ' + rejected.length + ' rejected, in ' + mins.toFixed(1) + ' min (' + (pick.length / mins).toFixed(1) + '/min)'
  );
  log('  → ' + outPath);
  log('  These are PROPOSALS. Each still needs a human read for whether it pins the intended behaviour.');
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
/* Acts only when INVOKED AS A PROGRAM — importing this file to test its exports must not start a
   multi-hour sweep. `mutation-crawl.mjs` documents having learned that the hard way. */
/*
 * ── AN UNRECOGNISED FLAG MUST NOT START A MULTI-HOUR SWEEP ─────────────────────────────────────
 *
 * The dispatch below is a chain of `has('--x')` tests ending in an `else` that launches the fleet.
 * So EVERY unrecognised argument falls through to the launch — including `--help`, which is what a
 * reader types precisely because they do not yet know what the tool does. Measured 2026-08-20: a
 * peer ran `--help` and started a full fleet sweep with a 22-worker pool, and noticed only from the
 * heartbeat. A typo'd `--satus` does the same thing, silently and for hours.
 *
 * The file already holds the right precedent one level down — `--lane wibble` prints "Refusing
 * rather than running a different one" and exits 2. This is that rule applied to the argument list
 * as a whole. A bare positional is refused too: `mutation-suite.mjs oxydex-dsp.js` reads as a
 * one-file request and is in fact a whole-fleet launch.
 *
 * VALUES ARE SKIPPED BY ARITY, never pattern-matched — otherwise `--lane operators` would report
 * `operators` as an unknown argument, and a checker that cries wolf gets bypassed.
 */
export const CLI_FLAGS = {
  '--selftest': 0,
  '--kill': 0,
  '--status': 0,
  '--build-map': 0,
  '--inventory': 0,
  '--quiet': 0,
  '--help': 0,
  '-h': 0,
  '--cluster': 1,
  '--draft': 1,
  '--file': 1,
  '--jobs': 1,
  '--stall-min': 1,
  '--max-restarts': 1,
  '--lane': 1,
  // Added 2026-08-23 after all five were REFUSED in production. The table had been written from the
  // tool's DOCUMENTED flags rather than the ones it actually reads, so `--crawl-dir` — implemented at
  // CRAWL_DIR and printed as advice by mutation-ai-probe — could not be passed. The check below now
  // derives the read-set from this file so the table cannot drift from the implementation again.
  '--attempts': 1,
  '--crawl-dir': 1,
  '--ctx': 1,
  '--limit': 1,
  '--model': 1
};

export function parseArgv(args, flags = CLI_FLAGS) {
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (Object.hasOwn(flags, a)) {
      i += flags[a];
      continue;
    }
    unknown.push(a);
  }
  return { unknown, help: args.includes('--help') || args.includes('-h') };
}

const USAGE = [
  'USAGE',
  '  node tools/mutation-suite.mjs                      # sweep the fleet, resuming what it can',
  '  node tools/mutation-suite.mjs --file oxydex-dsp.js # one file (repeatable)',
  '  node tools/mutation-suite.mjs --status             # read state, run nothing',
  '  node tools/mutation-suite.mjs --kill               # stop a running suite, by PID',
  '  node tools/mutation-suite.mjs --build-map          # (re)build the coverage map, stamped',
  '  node tools/mutation-suite.mjs --inventory          # write docs/MUTATION-INVENTORY.md',
  '  node tools/mutation-suite.mjs --cluster <file>     # local-AI survivor families (ADVISORY)',
  '  node tools/mutation-suite.mjs --draft <file>       # local-AI drafts a killing assertion',
  '  node tools/mutation-suite.mjs --selftest           # known-answer, touches nothing',
  '    --jobs N           worker pool          (default: cores minus 2, min 2)',
  '    --stall-min N      watchdog patience    (default 10)',
  '    --max-restarts N   bounded auto-resume  (default 3)',
  '    --lane L           operators (default) | pseudo | delete   — they are NOT comparable',
  '    --quiet            no per-mutant lines, keep the heartbeat',
  '',
  'With NO arguments this launches a multi-hour fleet sweep. That is why an unknown argument',
  'refuses (exit 2) instead of falling through to it.'
].join('\n');

const INVOKED_DIRECTLY = (() => {
  try {
    /* realpath on BOTH sides, matching mutation-crawl.mjs: a normalise-only comparison misses the
       symlinked-invocation case, and getting this wrong means an `import` starts a multi-hour sweep. */
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (INVOKED_DIRECTLY) {
  const cli = parseArgv(argv);
  if (cli.help) {
    log(USAGE);
    process.exit(0);
  }
  if (cli.unknown.length) {
    log('unknown argument(s): ' + cli.unknown.join(' '));
    log('Refusing rather than launching a fleet sweep, which is what this tool does with no command.');
    log('`node tools/mutation-suite.mjs --help` lists what it accepts.');
    process.exit(2);
  }
  if (has('--selftest')) process.exit(selftest());
  else if (has('--kill')) cmdKill();
  else if (has('--status')) cmdStatus();
  else if (has('--build-map')) cmdBuildMap();
  else if (has('--inventory')) cmdInventory();
  else if (has('--cluster')) await cmdCluster(opt('--cluster', FLEET[0]));
  else if (has('--draft')) await cmdDraft(opt('--draft', FLEET[0]));
  else {
    mkdirSync(stateDir(), { recursive: true });
    const files = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[i + 1]);
    const targets = files.length ? files : FLEET;
    const loaded = loadMap();
    const ident = buildIdentity(ROOT, targets);
    if (!LANES[LANE]) {
      log('unknown --lane "' + LANE + '". Known lanes: ' + Object.keys(LANES).join(', ') + '. Refusing rather than running a different one.');
      process.exit(2);
    }
    log(
      'MUTATION SUITE — lane ' +
        LANE +
        ' (' +
        LANES[LANE].label +
        ') · ' +
        targets.length +
        ' file(s) · ' +
        JOBS +
        ' jobs · stall watchdog ' +
        Math.round(STALL_MS / 60000) +
        ' min · up to ' +
        MAX_RESTARTS +
        ' auto-resume(s)'
    );
    /* The roster is DISCOVERED, so print it: a discovered list that is wrong must be visible. */
    if (!files.length) log('fleet discovered from the tree: ' + targets.length + ' DSP(s) — ' + targets.map((t) => t.replace('-dsp.js', '')).join(' '));
    log('map: ' + (loaded.path || 'none — run --build-map for the 10–100× selection path'));
    log('kill it with: node tools/mutation-suite.mjs --kill   (by PID — never pkill, see CLAUDE.md §👥.4)\n');
    const results = [];
    for (const f of targets) {
      if (!existsSync(join(ROOT, f))) {
        log('skip ' + f + ' (not found)');
        continue;
      }
      results.push(await runFile(f, ident, loaded, LANE));
    }
    log('\n── suite done');
    for (const r of results)
      log(
        '   ' +
          String(r.file).padEnd(20) +
          (r.incomplete
            ? 'INCOMPLETE — ' + r.reason
            : /* Only the parsed lane has counts this driver can stand behind; for the others the lane
                 printed its own summary and repeating a zero here would contradict it. */
              (LANES[LANE].parsed ? r.killed + ' killed of ' + r.done : 'ran — see the lane\u2019s own summary above') +
              (r.stalls && r.stalls.length ? '   (' + r.stalls.length + ' stall(s) auto-resumed)' : ''))
      );
  }
}
