#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * release-due — cut the release AUTOMATICALLY when it is due, and NAME the distance when it is not.
 *
 * THE RULE (owner, 2026-09-23, verbatim: "It should be automatic, Make it bite" · "Probably 1 week or
 * 100 commits. Whatever comes first"): a release is DUE when EITHER
 *
 *     days since the last release tag  >= RELEASE_MAX_DAYS    (7)
 *     commits on origin/main since it  >= RELEASE_MAX_COMMITS (100)
 *
 * and when it is due this tool launches `node tools/release.mjs --full` — the one-command unattended
 * chain (stamp → build → docs → gate → PR → merge → tag → GitHub Release → cleanup, detached in
 * tools/release-land.mjs). It replaces the previous cadence ("≥25 pending changesets or weekly"),
 * which was a rule someone had to remember: measured at the moment this was written, the last release
 * (v2.13.0, 2026-09-21) was 172 commits and 140 changesets behind origin/main and nothing had fired.
 * A cadence that depends on a session noticing is the "passive mechanism waiting on an event that
 * never arrives" shape queue-doctor exists for, one layer up.
 *
 * WHY A TIMER AND NOT A REMINDER. Same reason as queue-doctor: the failure happens when nobody is
 * running anything. `tools/systemd/tepna-release-due.{service,timer}` runs this hourly from a
 * checkout the timer owns and fast-forwards itself; the tool's own decision is a PURE function
 * (`decide`) so the thresholds are pinned by a selftest without git, a clock or a network.
 *
 * WHAT IT DOES NOT DO. It never bypasses the wall: `release.mjs` still runs the suite, the manifest
 * gate and `verify-fixtures --check` before stamping, and refuses (exit 3) on a red tree — that
 * refusal lands in release-land's state file, which `--status` shows. It never launches a second
 * chain while one is recorded as unfinished (`hold`), and it never guesses an unreadable input: no
 * tag, no fetch, no count ⇒ `refuse`, exit 2 — a timer that cannot read the distance must not
 * report "not due".
 *
 *   node tools/release-due.mjs             # decide, and LAUNCH the release chain when due
 *   node tools/release-due.mjs --report    # decide only; exit 1 when due (nothing launched)
 *   node tools/release-due.mjs --json      # …plus ONE tepna.verdict/1 object on stdout
 *   node tools/release-due.mjs --selftest
 *   node tools/release-due.mjs --verdict-sample   # ONE verdict from a planted snapshot, no git (the adoption gate reads this)
 *
 * Exit codes: 0 not due / launched · 1 due but not launched (`--report`, or `hold`) · 2 refused.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export const RELEASE_MAX_DAYS = 7;
export const RELEASE_MAX_COMMITS = 100;
const DAY_MS = 86400000;

/* The PURE decision. `snap` = { now, lastReleaseAt, commitsSince, running }:
 *   now / lastReleaseAt  ISO strings or epoch ms; lastReleaseAt null ⇒ unreadable
 *   commitsSince         integer, null ⇒ unreadable
 *   running              true when release-land records an UNFINISHED run (in progress or crashed)
 * Returns { action, due, why, distance } with action ∈ release · wait · hold · refuse.
 * `due` is decided BEFORE `running` is consulted, so a held release still reads as due. */
export function decide(snap) {
  const s = snap || {};
  const nowMs = toMs(s.now);
  const lastMs = toMs(s.lastReleaseAt);
  const commits = Number.isInteger(s.commitsSince) && s.commitsSince >= 0 ? s.commitsSince : null;
  if (nowMs === null || lastMs === null || commits === null) {
    return { action: 'refuse', due: null, why: 'distance unreadable: ' + describeMissing(nowMs, lastMs, commits), distance: null };
  }
  const days = (nowMs - lastMs) / DAY_MS;
  const byDays = days >= RELEASE_MAX_DAYS;
  const byCommits = commits >= RELEASE_MAX_COMMITS;
  const distance = {
    days: round2(days),
    commits,
    daysLeft: round2(Math.max(0, RELEASE_MAX_DAYS - days)),
    commitsLeft: Math.max(0, RELEASE_MAX_COMMITS - commits)
  };
  if (!byDays && !byCommits) {
    return { action: 'wait', due: false, why: `not due: ${distance.days} d of ${RELEASE_MAX_DAYS}, ${commits} of ${RELEASE_MAX_COMMITS} commits`, distance };
  }
  const trigger = byDays && byCommits ? 'days and commits' : byDays ? 'days' : 'commits';
  if (s.running) {
    return { action: 'hold', due: true, why: `due by ${trigger}, but a release-land run is recorded unfinished — not launching a second chain`, distance };
  }
  return { action: 'release', due: true, why: `due by ${trigger}: ${distance.days} d, ${commits} commits since the last release`, distance };
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}
function describeMissing(nowMs, lastMs, commits) {
  const m = [];
  if (nowMs === null) m.push('now');
  if (lastMs === null) m.push('last release tag date');
  if (commits === null) m.push('commit count');
  return m.join(', ');
}

/* ── the inputs, read from git; every failure is null, never a default ─────────────────────────── */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
export function snapshot() {
  const fetched = git(['fetch', '-q', 'origin', 'main', '--tags']) !== null;
  const tags = git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short) %(creatordate:iso-strict)', 'refs/tags/v*']);
  const first = tags ? tags.split('\n').find((l) => /^v\d+\.\d+\.\d+ /.test(l)) : null;
  const tag = first ? first.split(' ')[0] : null;
  const lastReleaseAt = first ? first.split(' ').slice(1).join(' ') : null;
  const count = tag ? git(['rev-list', '--count', tag + '..origin/main']) : null;
  const commitsSince = count !== null && /^\d+\s*$/.test(count) ? +count : null;
  return { fetched, tag, lastReleaseAt, commitsSince, now: new Date().toISOString(), running: releaseLandUnfinished() };
}
/* release-land's state file, via its own --status: exit 0 = last run complete or none recorded,
   2 = steps remain (in progress or crashed), 1 = failed. Both non-zero states hold — a crashed run is
   the operator's to `--resume`, not this timer's to overwrite. */
function releaseLandUnfinished() {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'release-land.mjs'), '--status'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 1 && /no release-land run recorded/.test(r.stdout || '')) return false;
  return r.status !== 0;
}

function launch() {
  const dir = join(tmpdir(), 'tepna-release-land');
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, 'due-launch-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'release.mjs'), '--full'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return { pid: child.pid, log: logFile };
}

/* ONE tepna.verdict/1 per run. PASS = not due, or due and the chain was launched; FAIL = due and NOT
   launched (`--report`, or `hold`) — a report that reads green about an overdue release is the
   failure being abolished; UNKNOWN = the distance could not be read (result null, reason says what).
   The criterion is stated on the days axis with the commits bound in its name; `result` carries the
   measured position on BOTH axes, so a reader can re-derive the verdict from the record alone. */
function verdictFor(d, snap, launched, report, commit) {
  const V = require(join(ROOT, 'verdict.js'));
  const status = d.action === 'refuse' ? 'UNKNOWN' : d.action === 'wait' || launched ? 'PASS' : 'FAIL';
  const pass = status === 'PASS';
  return V.make({
    gate: 'release-due',
    status,
    population: { checked: d.action === 'refuse' ? 0 : 1, eligible: 1, excluded: d.action === 'refuse' ? 1 : 0 },
    criterion: {
      name: `release distance — due at ${RELEASE_MAX_DAYS} d since the last tag OR ${RELEASE_MAX_COMMITS} commits on main since it, whichever first; a due release is launched`,
      direction: 'lte',
      threshold: RELEASE_MAX_DAYS,
      unit: 'd'
    },
    result: d.distance ? { ...d.distance, tag: snap.tag, action: d.action, launched: !!launched, mode: report ? 'report' : 'act' } : null,
    reason: pass ? null : d.why,
    evidence: [snap.tag ? `tag ${snap.tag} @ ${snap.lastReleaseAt}` : 'no v* tag readable', `origin/main fetched: ${snap.fetched}`, 'tools/release-land.mjs --status'],
    producedBy: commit ? { tool: 'tools/release-due.mjs', commit } : { tool: 'tools/release-due.mjs', commit: null, commitReason: 'HEAD unreadable in this checkout' }
  });
}
function headSha() {
  const s = git(['rev-parse', 'HEAD']);
  return s && /^[0-9a-f]{7,40}\s*$/.test(s) ? s.trim() : null;
}

function main(argv) {
  const REPORT = argv.includes('--report');
  const JSON_OUT = argv.includes('--json');
  const snap = snapshot();
  const d = decide(snap);
  let launched = null;
  if (d.action === 'release' && !REPORT) launched = launch();
  const out = JSON_OUT ? console.error : console.log;
  out(`release-due: ${d.action.toUpperCase()} — ${d.why}` + (snap.tag ? ` (last: ${snap.tag} @ ${snap.lastReleaseAt})` : ''));
  if (launched) out(`  launched release.mjs --full, pid ${launched.pid}\n  log:    ${launched.log}\n  status: node tools/release-land.mjs --status`);
  if (JSON_OUT) console.log(JSON.stringify(verdictFor(d, snap, launched, REPORT, headSha())));
  if (d.action === 'refuse') return 2;
  if (d.action === 'wait') return 0;
  return launched ? 0 : 1;
}

/* ── selftest: the pure decision, pinned ─────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  let ran = 0;
  const ok = (c, m) => {
    ran++;
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      process.exit(1);
    }
  };
  const T0 = '2026-09-21T18:24:14Z';
  const at = (days) => new Date(Date.parse(T0) + days * DAY_MS).toISOString();
  const D = (days, commits, running) => decide({ now: at(days), lastReleaseAt: T0, commitsSince: commits, running: !!running });
  ok(D(2, 40).action === 'wait', 'inside both bounds → wait');
  ok(D(2, 40).distance.daysLeft === 5 && D(2, 40).distance.commitsLeft === 60, 'wait names the distance left on BOTH axes');
  ok(D(7, 3).action === 'release' && /by days/.test(D(7, 3).why), 'exactly 7 days → due by days (>=, "1 week")');
  ok(D(6.99, 3).action === 'wait', '6.99 days is not a week');
  ok(D(0.5, 100).action === 'release' && /by commits/.test(D(0.5, 100).why), 'exactly 100 commits → due by commits (>=)');
  ok(D(0.5, 99).action === 'wait', '99 commits is not 100');
  ok(/days and commits/.test(D(9, 172).why), 'both exceeded → both named (the state this tool was written in)');
  ok(D(9, 172, true).action === 'hold' && D(9, 172, true).due === true, 'an unfinished release-land run HOLDS, and the release still reads as due');
  ok(D(2, 40, true).action === 'wait', 'running with nothing due is just wait');
  ok(decide({ now: at(1), lastReleaseAt: null, commitsSince: 5 }).action === 'refuse', 'no tag date → refuse, never "not due"');
  ok(decide({ now: at(1), lastReleaseAt: T0, commitsSince: null }).action === 'refuse', 'no commit count → refuse');
  ok(decide({ now: at(1), lastReleaseAt: T0, commitsSince: -1 }).action === 'refuse', 'a negative count is unreadable, not zero');
  ok(decide({ now: 'garbage', lastReleaseAt: T0, commitsSince: 5 }).action === 'refuse', 'an unparseable clock refuses');
  ok(decide(null).action === 'refuse', 'no snapshot at all refuses');
  ok(decide({ now: Date.parse(at(8)), lastReleaseAt: Date.parse(T0), commitsSince: 0 }).action === 'release', 'epoch-ms inputs are accepted');
  // the verdict shape validates under the contract, in every action
  const V = require(join(ROOT, 'verdict.js'));
  for (const [snap, launched] of [
    [{ now: at(2), lastReleaseAt: T0, commitsSince: 40, tag: 'v2.13.0', fetched: true }, null],
    [
      { now: at(9), lastReleaseAt: T0, commitsSince: 172, tag: 'v2.13.0', fetched: true },
      { pid: 1, log: 'x' }
    ],
    [{ now: at(9), lastReleaseAt: T0, commitsSince: 172, tag: 'v2.13.0', fetched: true, running: true }, null],
    [{ now: at(1), lastReleaseAt: null, commitsSince: null, tag: null, fetched: false }, null]
  ]) {
    const v = verdictFor(decide(snap), snap, launched, false, 'abcdef1');
    const chk = V.validate(v);
    ok(chk.ok, 'verdict validates for ' + decide(snap).action + ': ' + (chk.errors || []).join('; '));
  }
  ok(
    verdictFor(decide({ now: at(9), lastReleaseAt: T0, commitsSince: 172 }), { tag: 'v', fetched: true }, null, true, 'abcdef1').status === 'FAIL',
    'due and NOT launched is FAIL — a report that reads green about an overdue release is the failure being abolished'
  );
  ok(verdictFor(decide({ now: at(2), lastReleaseAt: T0, commitsSince: 1 }), { tag: 'v', fetched: true }, null, false, 'abcdef1').status === 'PASS', 'not due is PASS');
  ok(verdictFor(decide({ now: at(2), lastReleaseAt: null, commitsSince: 1 }), { tag: null, fetched: false }, null, false, 'abcdef1').status === 'UNKNOWN', 'refuse is UNKNOWN with result null');
  console.log(`all ${ran} selftests passed`);
  process.exit(0);
}

/* The adoption gate (tools/verdict-adoption.mjs) runs this to READ the object without a repository,
   a clock or a network: the planted snapshot is the state this tool was written in — due by commits,
   not launched — so the sample is the FAIL shape, the one the gate must be able to see. */
if (process.argv.includes('--verdict-sample')) {
  const snap = { now: '2026-09-23T12:00:00Z', lastReleaseAt: '2026-09-21T18:24:14Z', commitsSince: 172, tag: 'v2.13.0', fetched: true, running: false };
  console.log(JSON.stringify(verdictFor(decide(snap), snap, null, true, 'abcdef1234567')));
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !process.argv.includes('--selftest')) {
  process.exit(main(process.argv.slice(2)));
}
