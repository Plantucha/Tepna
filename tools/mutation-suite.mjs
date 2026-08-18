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
 *   node tools/mutation-suite.mjs --selftest           # known-answer, touches nothing
 *     --jobs N           worker pool          (default: cores − 2, min 2)
 *     --stall-min N      watchdog patience    (default 10)
 *     --max-restarts N   bounded auto-resume  (default 3)
 *     --quiet            no per-mutant lines, keep the heartbeat
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdentity, mapCandidates, resolveMapPath, verifyFor } from './mutation-map.mjs';

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

const log = (s) => process.stderr.write(s + '\n');
const stateDir = () => {
  const c = mapCandidates(ROOT)[0];
  return dirname(c);
};
const pidFile = () => join(stateDir(), 'suite.pid');
const journalPath = (file) => join(ROOT, '.mutate-journal', file.replace(/[/\\]/g, '_') + '.jsonl');

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
  return { where: (file || '?') + ':' + p[0], line: Number(p[0]) || 0, op: p[1], before: trim(p[2]), after: trim(p[3]) };
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
  const extra = ks.length > 1 ? '  (+' + (ks.length - 1) + ' more)' : '';
  return body + '\n      killed by: "' + String(ks[0]).slice(0, 88) + '"' + extra;
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
function spawnSweep(file, resume) {
  const args = ['tools/mutate.mjs', '--file', file, '--limit', '9999', '--jobs', String(JOBS), '--bail', '--json', '--quiet-stream'];
  if (resume) args.push('--resume');
  return spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
}

async function runFile(file, ident, loaded) {
  const jp = journalPath(file);
  const ms = mapStatusFor(file, loaded, ident);
  log('');
  log('── ' + file);
  log('   selection: ' + (ms.on ? 'ON — ' + ms.reason : 'OFF — ' + ms.reason + '\n              (falling back to the tag filter: slower, never wrong)'));

  let restarts = 0;
  const stalls = [];
  for (;;) {
    const resume = existsSync(jp);
    if (resume) {
      const pr = readJournalProgress(readFileSync(jp, 'utf8'));
      log('   resuming: ' + pr.done + ' verdict(s) already recorded' + (pr.inFlight > 0 ? ', ' + pr.inFlight + ' will be re-tried or quarantined' : ''));
    }
    const child = spawnSweep(file, resume);
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
        let pr;
        try {
          pr = readJournalProgress(readFileSync(jp, 'utf8'));
        } catch {
          return; /* journal not created yet — mutant generation is still running */
        }
        /* VERBOSE: every newly-recorded verdict, named, with its killer. */
        if (!QUIET) for (let i = printed; i < pr.records.length; i++) log(mutantLine(pr.records[i], file));
        printed = pr.records.length;

        const v = stallVerdict({ doneNow: pr.done, donePrev: seen, msSinceProgress: Date.now() - lastGrowth, stallMs: STALL_MS });
        if (pr.done > seen) {
          seen = pr.done;
          lastGrowth = Date.now();
        }
        const pj = project({ done: pr.done, total: 0, elapsedMs: Date.now() - t0 });
        if (pr.done && pr.done % 50 === 0)
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
      const pr = existsSync(jp) ? readJournalProgress(readFileSync(jp, 'utf8')) : { done: 0, killed: 0, survived: 0, invalid: 0 };
      if (!QUIET) for (let i = printed; i < pr.records.length; i++) log(mutantLine(pr.records[i], file));
      const el = (Date.now() - t0) / 1000;
      /* The completion marker: written ONLY on a clean exit, and carrying the count it saw, so the
         inventory can say "complete" as a recorded fact rather than a guess about journal shape.
         A non-zero exit leaves no marker, which reads as `unknown` — correct, since a sweep that
         died mid-run has counts nobody should present as that file's result. */
      const cv = canaryVerdict(parseSweepResult(out));
      if (outcome.code === 0)
        writeFileSync(
          doneMarker(file),
          JSON.stringify({ file, done: pr.done, killed: pr.killed, survived: pr.survived, invalid: pr.invalid, canary: cv.canary, publishable: cv.publishable, finishedAt: new Date().toISOString() }) +
            '\n'
        );
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
      log('   canary ' + cv.canary + ' — ' + cv.why);
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
  const p = pidFile();
  log('  running: ' + (existsSync(p) ? readFileSync(p, 'utf8').trim() : 'no'));
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

const doneMarker = (file) => join(stateDir(), basename(file) + '.done.json');

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
  let runningFile = null;
  try {
    runningFile = JSON.parse(readFileSync(pidFile(), 'utf8')).file;
  } catch {
    /* no suite running here */
  }
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
export function classificationIndex(ledger) {
  const idx = new Map();
  for (const [file, entries] of Object.entries(ledger || {})) {
    if (!Array.isArray(entries)) continue; // `_README` is prose
    for (const e of entries) {
      if (!e || e.line == null || !e.op) continue;
      const k = file + '\u0001' + e.line + '\u0001' + e.op;
      const cls = e.class || 'unclassified';
      const prev = idx.get(k);
      /* (line, op) IS NOT UNIQUE — one line can host the same operator twice (two `||` in one
         condition), and the ledger holds both: 419 entries collapse to 383 keys. Where colliding
         entries AGREE the answer is unambiguous; where they DISAGREE, one of those mutants is
         equivalent and the other is a real gap, and nothing in the key says which. Marking the key
         ambiguous makes BOTH report as open work — over-reporting is recoverable, while silently
         inheriting "unkillable" from a neighbour hides a real gap permanently. */
      if (prev !== undefined && prev !== cls) idx.set(k, 'ambiguous');
      else if (prev === undefined) idx.set(k, cls);
    }
  }
  return idx;
}

export function classifySurvivor(idx, file, line, op) {
  const c = idx.get(file + '\u0001' + line + '\u0001' + op);
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
export function renderInventory({ files, generatedAt, mapPath, staleClassifications = 0 }) {
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
  for (const f of files) {
    if (!f.survivors || !f.survivors.length) continue;
    L.push('## `' + f.file + '` — ' + f.survivors.length + ' survivor(s)');
    L.push('');
    L.push('| line | operator | source |');
    L.push('|---:|---|---|');
    for (const s of f.survivors) L.push('| ' + s.line + ' | `' + s.op + '` | `' + String(s.before).replace(/\|/g, '\\|').slice(0, 96) + '` |');
    L.push('');
  }
  return L.join('\n') + '\n';
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
        return { line: d.line, op: d.op, before: d.before, cls: classifySurvivor(eq, f, d.line, d.op) };
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
  writeFileSync(dest, renderInventory({ files, generatedAt: new Date().toISOString().slice(0, 10), mapPath: loaded.path, staleClassifications }));
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
  ck('a KILLED line names the killing group', /killed by: "ECGDex accAnalyze/.test(mutantLine(killed, 'ecgdex-dsp.js')), true);
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

  console.log('\ndiscoverFleet — a new node must not need this file edited');
  ck('finds every DSP', discoverFleet(['a-dsp.js', 'zz-dsp.js', 'README.md', 'clock.js']), ['a-dsp.js', 'zz-dsp.js']);
  /* The point: a node added tomorrow appears without anyone remembering to list it. */
  ck('…including one that did not exist when this was written', discoverFleet(['eegdex-dsp.js']).length, 1);
  ck('ignores non-DSP files', discoverFleet(['dsp.js', 'x-dsp.js.bak']).length, 0);

  console.log('\nclassificationIndex — a resolved survivor is not outstanding work, and a tie is not resolved');
  const idx = classificationIndex({ 'f.js': [{ line: 10, op: 'cmp < → <=', class: 'no-distinguishing-input' }], _README: ['prose'] });
  ck('prose keys are skipped', idx.size, 1);
  ck('a classified mutant is found', classifySurvivor(idx, 'f.js', 10, 'cmp < → <='), 'no-distinguishing-input');
  ck('an unclassified one is null, not a default', classifySurvivor(idx, 'f.js', 11, 'cmp < → <='), null);
  /* (line, op) is NOT unique — one line can host the same operator twice. Where colliding entries
     DISAGREE, one is equivalent and one is a real gap and the key cannot say which; inheriting either
     answer would hide a real gap permanently, so both must report as open. */
  ck(
    'two entries that DISAGREE resolve to neither',
    classifySurvivor(
      classificationIndex({
        'f.js': [
          { line: 10, op: 'x', class: 'no-distinguishing-input' },
          { line: 10, op: 'x', class: 'real-gap' }
        ]
      }),
      'f.js',
      10,
      'x'
    ),
    null
  );
  ck(
    '…but two that agree are unambiguous',
    classifySurvivor(
      classificationIndex({
        'f.js': [
          { line: 10, op: 'x', class: 'real-gap' },
          { line: 10, op: 'x', class: 'real-gap' }
        ]
      }),
      'f.js',
      10,
      'x'
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

  /* `all N selftests passed` is the form tools/selftest-all.mjs parses for a COUNT; a bare
     'all green' is recognised but countless, and a count is what makes a silent drop from 30
     assertions to 3 visible in CI. */
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
/* Acts only when INVOKED AS A PROGRAM — importing this file to test its exports must not start a
   multi-hour sweep. `mutation-crawl.mjs` documents having learned that the hard way. */
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
  if (has('--selftest')) process.exit(selftest());
  else if (has('--kill')) cmdKill();
  else if (has('--status')) cmdStatus();
  else if (has('--build-map')) cmdBuildMap();
  else if (has('--inventory')) cmdInventory();
  else if (has('--cluster')) await cmdCluster(opt('--cluster', FLEET[0]));
  else {
    mkdirSync(stateDir(), { recursive: true });
    const files = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) files.push(argv[i + 1]);
    const targets = files.length ? files : FLEET;
    const loaded = loadMap();
    const ident = buildIdentity(ROOT, targets);
    log('MUTATION SUITE — ' + targets.length + ' file(s) · ' + JOBS + ' jobs · stall watchdog ' + Math.round(STALL_MS / 60000) + ' min · up to ' + MAX_RESTARTS + ' auto-resume(s)');
    log('map: ' + (loaded.path || 'none — run --build-map for the 10–100× selection path'));
    log('kill it with: node tools/mutation-suite.mjs --kill   (by PID — never pkill, see CLAUDE.md §👥.4)\n');
    const results = [];
    for (const f of targets) {
      if (!existsSync(join(ROOT, f))) {
        log('skip ' + f + ' (not found)');
        continue;
      }
      results.push(await runFile(f, ident, loaded));
    }
    log('\n── suite done');
    for (const r of results)
      log(
        '   ' +
          String(r.file).padEnd(20) +
          (r.incomplete ? 'INCOMPLETE — ' + r.reason : r.killed + ' killed of ' + r.done + (r.stalls && r.stalls.length ? '   (' + r.stalls.length + ' stall(s) auto-resumed)' : ''))
      );
  }
}
