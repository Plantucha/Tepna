#!/usr/bin/env node
/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * unit-health — the dead-man's switch for the rig's systemd user timers. It names every scheduled job
 * that stopped doing its work, and posts the change to the board.
 *
 *   node tools/unit-health.mjs               # the findings, one line each
 *   node tools/unit-health.mjs --json        # one tepna.verdict/1 on stdout
 *   node tools/unit-health.mjs --post        # also post to board thread 7 when the finding set CHANGED
 *   node tools/unit-health.mjs --selftest    # the pure rules below
 *
 * ⚠️ PRIMARY DEV MACHINE ONLY. It reads `systemctl --user`, so CI and a fresh clone get NOT_RUN (exit 2),
 * never a PASS over nothing.
 *
 * WHY (owner, 2026-10-31; audit F2, decision #2441). Three jobs failed for days and nothing said so:
 *   - `bge-reindex` embedded nothing from 10-11 to 10-31. The unit exited 0, so only a job-specific
 *     check could see it; this tool does not, and says so here rather than claiming it.
 *   - `qwen-idle` failed 564 times from 10-26 09:48: `cd` into a retired worktree.
 *   - `tepna-corpus-tier` exited 3 on 10-20, and its timer stopped firing.
 *   - `disk-watch.timer` last fired on 10-18 and holds no next elapse. This tool found that one.
 * And 8 failed `run-*` benchmark scopes sat in `systemctl --user --failed` beside them, so the list that
 * should have shown the failures was noise. This tool reads only service units that a timer activates,
 * plus the timers themselves, and it counts the transient scopes apart.
 *
 * THE FOUR FINDINGS, each a reading of systemd's own state, never a guess:
 *   failed   — the service a timer activates is in the `failed` state (its last run did not succeed).
 *   stopped  — an ENABLED timer has no next elapse: it will never fire again (corpus-tier).
 *   overdue  — the timer's last trigger is older than 2× its own interval + 5 min. The interval is
 *              `next − last`, read from systemd, so a calendar timer needs no parsing here.
 *              (disk-watch on 2026-10-31: `OnUnitActiveSec` with no next elapse since 10-18.)
 *   never    — an enabled timer that has no last trigger and whose unit has been loaded for over a day.
 *
 * --post DEDUPES on the finding set, kept in `<git common dir>/tepna-mutation/unit-health.json`. A
 * job that stays failed posts once; a job that recovers posts its recovery once. Silence on the board
 * means "nothing changed", and the verdict says what is true now.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { resolveStatePath } from './mutation-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const SLACK_US = 5 * 60 * 1e6;
export const NEVER_GRACE_US = 24 * 3600 * 1e6;
const BOARD_THREAD = '7';

/** One timer row (systemctl list-timers --output=json) plus its states → zero or one finding. Pure.
 *  `t` = { unit, activates, last, next } in µs (0 or null = absent); `s` = { serviceState, enabled,
 *  loadedSinceUs }; `now` in µs. */
export function judgeTimer(t, s, now) {
  const svc = t.activates || t.unit.replace(/\.timer$/, '.service');
  if (s.serviceState === 'failed') return { unit: svc, kind: 'failed', detail: `${svc} is in the failed state` };
  if (!s.enabled) return null;
  const last = Number(t.last) || 0;
  const next = Number(t.next) || 0;
  if (!next) return { unit: t.unit, kind: 'stopped', detail: `${t.unit} is enabled and has no next elapse` };
  if (!last) {
    if (s.loadedSinceUs && now - s.loadedSinceUs > NEVER_GRACE_US) return { unit: t.unit, kind: 'never', detail: `${t.unit} has never fired` };
    return null;
  }
  const interval = next - last;
  if (interval > 0 && now - last > 2 * interval + SLACK_US) {
    return { unit: t.unit, kind: 'overdue', detail: `${t.unit} last fired ${Math.round((now - last) / 6e7)} min ago against a ${Math.round(interval / 6e7)} min interval` };
  }
  return null;
}

/** The finding set as a stable key, so --post can tell a change from a repeat. Pure. */
export const findingKey = (fs) =>
  fs
    .map((f) => `${f.kind}:${f.unit}`)
    .sort()
    .join('|');

/** What changed between two finding sets: { added, cleared }. Pure. */
export function diffFindings(prev, cur) {
  const p = new Set(prev.map((f) => `${f.kind}:${f.unit}`));
  const c = new Set(cur.map((f) => `${f.kind}:${f.unit}`));
  return { added: cur.filter((f) => !p.has(`${f.kind}:${f.unit}`)), cleared: prev.filter((f) => !c.has(`${f.kind}:${f.unit}`)) };
}

/** Findings for failed units that no LOADED timer names — a service whose timer is disabled or gone
 *  (corpus-tier on 2026-10-31: timer disabled, service failed since 10-20). Transient scopes are noise,
 *  counted apart. Pure. */
export function orphanFailures(failedUnits, findings) {
  const named = new Set(findings.map((f) => f.unit));
  return failedUnits.filter((u) => !isTransient(u) && !named.has(u)).map((u) => ({ unit: u, kind: 'failed', detail: `${u} is in the failed state, and no loaded timer activates it` }));
}

/** A failed unit that no timer activates and that is a transient scope is noise, counted apart. Pure. */
export const isTransient = (name) => /^run-[^/]+\.(scope|service)$/.test(name);

export function verdictOf({ status, findings, checked, transient, reason }) {
  const v = Verdict.make({
    gate: 'unit-health',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'timer-jobs-failed-stopped-overdue-or-never', threshold: 0, unit: 'jobs', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { findings, failedTransientScopes: transient },
    evidence: ['tools/unit-health.mjs', 'systemctl --user list-timers --all --output=json'],
    reason: reason ?? null,
    producedBy: { tool: 'tools/unit-health.mjs', commit: gitHead() },
    at: new Date().toISOString()
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`unit-health produced an invalid verdict: ${check.errors.join('; ')}`);
  return v;
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (cond, what) => {
    ran += 1;
    if (!cond) fail.push(what);
  };
  const H = 3600e6;
  const now = 1000 * H;
  const t = (last, next) => ({ unit: 'x.timer', activates: 'x.service', last, next });
  const on = { serviceState: 'inactive', enabled: true, loadedSinceUs: now - 48 * H };
  ok(judgeTimer(t(now - H / 2, now + H / 2), on, now) === null, 'an hourly timer that fired 30 min ago is healthy');
  ok(judgeTimer(t(now - H / 2, now + H / 2), { ...on, serviceState: 'failed' }, now)?.kind === 'failed', 'a failed service is a finding, whatever the timer says');
  ok(judgeTimer(t(now - H / 2, now + H / 2), { ...on, serviceState: 'failed' }, now)?.unit === 'x.service', 'a failed finding names the service, not the timer');
  ok(judgeTimer(t(now - 11 * 24 * H, 0), on, now)?.kind === 'stopped', 'an enabled timer with no next elapse is stopped (corpus-tier)');
  ok(judgeTimer(t(now - 11 * 24 * H, 0), { ...on, enabled: false }, now) === null, 'a disabled timer is not a finding');
  ok(judgeTimer(t(now - 3 * H, now - 2 * H), on, now)?.kind === 'overdue', 'a timer three intervals late is overdue');
  ok(judgeTimer(t(now - 2 * H, now + 1), on, now) === null, 'a timer inside 2 intervals + slack is not overdue');
  ok(judgeTimer(t(0, now + H), on, now)?.kind === 'never', 'a timer loaded two days ago that never fired is a finding');
  ok(judgeTimer(t(0, now + H), { ...on, loadedSinceUs: now - H }, now) === null, 'a timer loaded an hour ago gets its grace day');
  ok(judgeTimer(t(0, now + H), { ...on, loadedSinceUs: 0 }, now) === null, 'an unknown load time is no evidence of never');
  const a = [{ kind: 'failed', unit: 'a.service' }];
  const b = [
    { kind: 'failed', unit: 'a.service' },
    { kind: 'stopped', unit: 'b.timer' }
  ];
  ok(findingKey(a) === findingKey([...a]) && findingKey(a) !== findingKey(b), 'the key is stable and tells sets apart');
  ok(findingKey([b[1], b[0]]) === findingKey(b), 'the key ignores order');
  const d = diffFindings(b, a);
  ok(d.added.length === 0 && d.cleared.length === 1 && d.cleared[0].unit === 'b.timer', 'a recovery reads as cleared');
  ok(diffFindings([], a).added.length === 1, 'a new failure reads as added');
  ok(isTransient('run-p1596859-i223774905.scope') && !isTransient('qwen-idle.service') && !isTransient('tepna-run.service'), 'only run-* transients count apart');
  const orph = orphanFailures(['a.service', 'run-p1-i2.scope', 'b.service'], [{ unit: 'a.service', kind: 'failed' }]);
  ok(orph.length === 1 && orph[0].unit === 'b.service', 'a failed service no timer names is a finding, once; a transient is not');
  const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'no user systemd' });
  ok(Verdict.validate(v).ok && v.result === null, 'a NOT_RUN verdict validates and carries no result');
  const line = fail.length ? `unit-health selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* ── everything below is I/O ── */

function gitHead() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT });
  return r.status === 0 ? r.stdout.trim() : null;
}

function sysctl(args) {
  const r = spawnSync('systemctl', ['--user', '--no-pager', ...args], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/** Read systemd; null when there is no user manager to read (CI, a container, a fresh clone). */
function readSystem() {
  const timersRaw = sysctl(['list-timers', '--all', '--output=json']);
  if (timersRaw == null) return null;
  let timers;
  try {
    timers = JSON.parse(timersRaw);
  } catch {
    return null;
  }
  const failedRaw = sysctl(['list-units', '--failed', '--all', '--output=json']) ?? '[]';
  let failedUnits = [];
  try {
    failedUnits = JSON.parse(failedRaw).map((u) => u.unit);
  } catch {
    failedUnits = [];
  }
  const rows = [];
  for (const t of timers) {
    if (!t.unit) continue;
    const svc = t.activates || t.unit.replace(/\.timer$/, '.service');
    const show = sysctl(['show', t.unit, '-p', 'UnitFileState', '-p', 'InactiveExitTimestampMonotonic', '-p', 'ActiveEnterTimestamp', '--timestamp=unix']) ?? '';
    const prop = Object.fromEntries(
      show
        .split('\n')
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    );
    const since = /^@(\d+)/.exec(prop.ActiveEnterTimestamp || '');
    rows.push({
      t,
      s: {
        serviceState: failedUnits.includes(svc) ? 'failed' : 'ok',
        enabled: prop.UnitFileState === 'enabled' || prop.UnitFileState === 'static',
        loadedSinceUs: since ? Number(since[1]) * 1e6 : 0
      }
    });
  }
  return { rows, failedUnits, transient: failedUnits.filter(isTransient).length };
}

function statePath() {
  return resolveStatePath(ROOT, 'unit-health.json');
}

function post(added, cleared, findings) {
  const lines = ['Unit health (`tools/unit-health.mjs`, the 15-min timer). The finding set changed on the rig.', ''];
  if (added.length) lines.push('New:', ...added.map((f) => `- \`${f.unit}\` — ${f.kind}: ${f.detail}.`), '');
  if (cleared.length) lines.push('Cleared:', ...cleared.map((f) => `- \`${f.unit}\` — ${f.kind}.`), '');
  lines.push(`Now: ${findings.length} finding(s). Read the journal with \`journalctl --user -u <unit> -n 20\`.`);
  const bin = process.env.AGENT_BOARD_BIN || join(process.env.HOME || '', '.local/bin/agent-board');
  const r = spawnSync(bin, ['--as', 'kestrel', 'post', BOARD_THREAD, '--kind', 'finding', '-'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' });
  return r.status === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    console.log(r.line);
    for (const f of r.fail) console.log(`  ✕ ${f}`);
    process.exit(r.ok ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  const sys = readSystem();
  if (!sys) {
    const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'no systemd user manager answered `systemctl --user list-timers`' });
    if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
    else console.log('unit-health: NOT_RUN — no systemd user manager to read (CI or a fresh clone)');
    process.exit(2);
  }
  const now = Date.now() * 1000;
  const timerFindings = sys.rows.map(({ t, s }) => judgeTimer(t, s, now)).filter(Boolean);
  const findings = [...timerFindings, ...orphanFailures(sys.failedUnits, timerFindings)];
  const checked = sys.rows.length;
  const status = checked === 0 ? 'NOT_APPLICABLE' : findings.length ? 'FAIL' : 'PASS';
  const reason = checked === 0 ? 'no user timer is loaded' : findings.length ? `${findings.length} timer job(s) failed, stopped, overdue or never ran` : null;
  if (argv.includes('--post')) {
    const p = statePath();
    let prev = [];
    try {
      prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).findings || [] : [];
    } catch {
      prev = [];
    }
    if (findingKey(prev) !== findingKey(findings)) {
      const { added, cleared } = diffFindings(prev, findings);
      /* The state moves only when the post landed, so a board that is down re-posts next tick. */
      if (post(added, cleared, findings)) writeFileSync(p, `${JSON.stringify({ at: new Date().toISOString(), findings }, null, 1)}\n`);
    }
  }
  const v = verdictOf({ status, findings, checked, transient: sys.transient, reason });
  if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
  else {
    console.log(`unit-health · ${checked} timer(s) read · ${findings.length} finding(s) · ${sys.transient} failed transient scope(s) counted apart`);
    for (const f of findings) console.log(`  ✕ ${f.kind.padEnd(7)} ${f.detail}`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (isCliEntry(import.meta.url)) main();
