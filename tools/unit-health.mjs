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
 *              Not while the timer's own service RUNS: systemd arms the next elapse only when the
 *              service exits, so a running timer (`SubState=running`) holds `next: null` for the whole
 *              run. On 2026-11-10 that read `tepna-unit-health.timer` as stopped on each of its own
 *              runs, and the walker and board timers whenever a run overlapped the sample (board #5401).
 *   overdue  — the timer's last trigger is older than 2× its own interval + 5 min. The interval is
 *              `next − last`, read from systemd, so a calendar timer needs no parsing here.
 *              (disk-watch on 2026-10-31: `OnUnitActiveSec` with no next elapse since 10-18.)
 *   never    — an enabled timer that has no last trigger and whose unit has been loaded for over a day.
 *
 * THE FLEET MEMORY rides in the same set (2026-11-24). The memory repo is private and holds its own
 * `tools/health.mjs`, which judges the green pull request that nobody lands, the note that waits unsent
 * and the state head over its cap. This tool runs it when the checkout is there and adds its findings,
 * with units that start `memory:`. A rig without that checkout adds nothing. An answer that cannot be
 * read is a finding of kind `unread`, never a silent pass. The timer population does not count them.
 *
 * THE PRIMARY CHECKOUT rides in it too (2026-11-24). `tepna-sync-main.timer` fast-forwards it every 15
 * minutes and skips while a tracked path is modified; its unit counts that skip as success. From
 * 2026-11-09 to 2026-11-20 one path parked the checkout, and every timer read as healthy while the board
 * and this tool ran old code. So a checkout whose oldest missing commit is over PARKED_AFTER_MS old is
 * `parked`. The age is the commit's, never the count: one commit missing for a day is parked, thirty in
 * a burst are not. It reads the LOCAL `origin/main`, which each fetch in any worktree moves.
 *
 * PROVENANCE OF THE RUN'S OWN CODE. A timer runs this tool out of whatever checkout its unit names, so
 * a finding can predate its own fix. On 2026-11-10 the shared checkout read `tepna-unit-health.timer`
 * as stopped from code that did not carry the `SubState=running` guard beside it (board #5401, #5527).
 * Every read therefore states the commit it ran from and whether its own rules are the ref's. The note
 * rides in the printed line and in the board post, never in the dedupe key, so a tree that moves
 * re-posts nothing.
 *
 * --post DEDUPES on the finding set, kept in `<git common dir>/tepna-mutation/unit-health.json`. A
 * job that stays failed posts once; a job that recovers posts its recovery once. Silence on the board
 * means "nothing changed", and the verdict says what is true now.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { resolveStatePath } from './mutation-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const SLACK_US = 5 * 60 * 1e6;
export const NEVER_GRACE_US = 24 * 3600 * 1e6;
export const PARKED_AFTER_MS = 2 * 3600 * 1e3;
const BOARD_THREAD = '7';

/** One timer row (systemctl list-timers --output=json) plus its states → zero or one finding. Pure.
 *  `t` = { unit, activates, last, next } in µs (0 or null = absent); `s` = { serviceState, enabled,
 *  loadedSinceUs, timerSub }; `timerSub` is the timer's own SubState; `now` in µs. */
export function judgeTimer(t, s, now) {
  const svc = t.activates || t.unit.replace(/\.timer$/, '.service');
  if (s.serviceState === 'failed') return { unit: svc, kind: 'failed', detail: `${svc} is in the failed state` };
  if (!s.enabled) return null;
  const last = Number(t.last) || 0;
  const next = Number(t.next) || 0;
  if (!next && s.timerSub === 'running') return null;
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

/** The primary checkout against the local `origin/main` → zero or one finding. Pure.
 *  `c` = { path, branch, behind, oldestMissingMs, modified }; null = there is no primary checkout to judge
 *  (a bare repository). An absent count or stamp is `unread`, never a pass. */
export function judgeCheckout(c, nowMs) {
  if (c === null) return null;
  const unit = 'checkout:primary';
  if (c.behind === null) return { unit, kind: 'unread', detail: `git did not count how far ${c.path} sits behind \`origin/main\`` };
  if (c.behind === 0) return null;
  if (c.oldestMissingMs === null) return { unit, kind: 'unread', detail: `git gave no date for the oldest commit that ${c.path} misses` };
  const age = nowMs - c.oldestMissingMs;
  if (age <= PARKED_AFTER_MS) return null;
  const why = [];
  if (c.branch !== 'main') why.push(`it is on \`${c.branch ?? 'an unread branch'}\`, not \`main\``);
  if (c.modified === null) why.push('its modified paths did not answer');
  else if (c.modified.length)
    why.push(
      `uncommitted tracked path(s): ${c.modified
        .slice(0, 5)
        .map((p) => `\`${p}\``)
        .join(', ')}${c.modified.length > 5 ? ` and ${c.modified.length - 5} more` : ''}`
    );
  return {
    unit,
    kind: 'parked',
    detail: `the checkout ${c.path} sits ${c.behind} commit(s) behind \`origin/main\`, and the oldest is ${(age / 3600e3).toFixed(1)} h old; ${why.length ? why.join('; ') : 'the tree shows no cause, so read `journalctl --user -u tepna-sync-main`'}`
  };
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
/* The findings of the memory repo's `health.mjs --json`. It exits 1 when it has findings, so the exit
   code is not the verdict: the JSON is. */
export function memoryFindings(stdout, why = '') {
  try {
    const d = JSON.parse(stdout);
    if (!Array.isArray(d.findings)) throw new Error('no findings list');
    return d.findings.map(({ unit, kind, detail }) => {
      if (!unit || !kind) throw new Error('a finding without a unit or a kind');
      return { unit, kind, detail: detail || '' };
    });
  } catch (e) {
    return [{ unit: 'memory:health', kind: 'unread', detail: `the memory health check gave no readable answer (${(why || e.message).slice(0, 120)})` }];
  }
}

function readMemory() {
  const tool = process.env.TEPNA_MEMORY_HEALTH || join(process.env.HOME || '', 'Tepna-memory/tools/health.mjs');
  if (!existsSync(tool)) return [];
  const r = spawnSync(process.execPath, [tool, '--json'], { encoding: 'utf8', timeout: 60000 });
  return memoryFindings(r.stdout || '', r.error ? r.error.message : '');
}

export function orphanFailures(failedUnits, findings) {
  const named = new Set(findings.map((f) => f.unit));
  return failedUnits.filter((u) => !isTransient(u) && !named.has(u)).map((u) => ({ unit: u, kind: 'failed', detail: `${u} is in the failed state, and no loaded timer activates it` }));
}

/** A failed unit that no timer activates and that is a transient scope is noise, counted apart. Pure. */
export const isTransient = (name) => /^run-[^/]+\.(scope|service)$/.test(name);

/** The files whose TEXT can change a finding — this tool's judgment surface. `judgeTimer` and
 *  `orphanFailures` hold every rule, so the set is this one file. The three imported modules decide no
 *  finding: `verdict.js` validates the object, `argv-guard.mjs` guards the CLI entry and
 *  `mutation-map.mjs` resolves the state path. Widen this list when a rule moves out of here. */
export const JUDGMENT_SOURCES = ['tools/unit-health.mjs'];

/** This run's own code identity → { producedBy, note }. Pure.
 *  THE CRITERION IS THE FILE, NEVER THE COMMIT COUNT (`.claude/hooks/guard-stale-ledger.sh:32`): the
 *  tree a timer runs from is behind most of the time, and nearly every commit it is behind on never
 *  touches this tool. So `drifted` carries the judgment sources whose working copy differs from the
 *  local `origin/main` ref, and `behindRef` rides along as a diagnostic that decides nothing.
 *  The word is DIFFERS, not stale: a worktree holding its own edit differs too, and no comparison can
 *  tell an edit from a lag. `refReadable: false` means the comparison never happened — never a match. */
export function provenanceOf({ commit, commitReason, behind, drifted, refReadable }) {
  const sha = commit ? `\`${commit}\`` : `an unknown commit (${commitReason})`;
  const lag = behind === null ? '' : `, which this tree sits ${behind} commit(s) behind`;
  let note;
  if (!refReadable) note = `This read ran from ${sha}. The local \`origin/main\` ref did not answer, so the tool cannot say whether its own rules are the ref's.`;
  else if (drifted.length)
    note = `⚠ This read ran from ${sha}. Its own judgment source(s) differ from the local \`origin/main\` ref: ${drifted.map((f) => `\`${f}\``).join(', ')}. A finding may apply a rule the ref no longer holds, or one it does not hold yet.`;
  else note = `This read ran from ${sha}. Every judgment source matches the local \`origin/main\` ref${lag}.`;
  const producedBy = { tool: 'tools/unit-health.mjs', commit: commit ?? null, behindRef: behind ?? null, driftedSources: drifted, refReadable };
  if (producedBy.commit === null) producedBy.commitReason = commitReason;
  return { producedBy, note };
}

export function verdictOf({ status, findings, checked, transient, reason, prov }) {
  const v = Verdict.make({
    gate: 'unit-health',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'timer-jobs-failed-stopped-overdue-or-never', threshold: 0, unit: 'jobs', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { findings, failedTransientScopes: transient },
    evidence: ['tools/unit-health.mjs', 'systemctl --user list-timers --all --output=json'],
    reason: reason ?? null,
    producedBy: (prov ?? readProvenance()).producedBy,
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
  ok(judgeTimer(t(now - 60e6, null), { ...on, timerSub: 'running' }, now) === null, 'a timer whose service runs holds no next elapse and is not stopped (#5401)');
  ok(judgeTimer(t(now - 11 * 24 * H, null), { ...on, timerSub: 'dead' }, now)?.kind === 'stopped', 'a dead timer with no next elapse is stopped (qwen-idle)');
  ok(judgeTimer(t(now - 11 * 24 * H, null), { ...on, timerSub: 'elapsed' }, now)?.kind === 'stopped', 'an elapsed one-shot timer with no next elapse is stopped');
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
  const mem = memoryFindings(JSON.stringify({ findings: [{ unit: 'memory:pr-9', kind: 'open', detail: 'd', extra: 1 }], checked: 4 }));
  ok(mem.length === 1 && mem[0].unit === 'memory:pr-9' && mem[0].extra === undefined, 'a memory finding joins the set with the three shared fields');
  ok(memoryFindings('{"findings":[],"checked":4}').length === 0, 'a clean memory answer adds nothing');
  ok(
    ['', 'not json', '{}', '{"findings":[{"kind":"x"}]}'].every(
      (t) =>
        memoryFindings(t)
          .map((f) => f.kind)
          .join() === 'unread'
    ),
    'an empty, malformed or shapeless memory answer is one unread finding, never a pass'
  );
  const M = 3600e3;
  const C = (o) => ({ path: '/repo', branch: 'main', behind: 3, oldestMissingMs: 1000 * M - 3 * M, modified: ['a.js'], ...o });
  const parked = judgeCheckout(C({}), 1000 * M);
  ok(
    parked?.kind === 'parked' && parked.detail.includes('`a.js`') && parked.detail.includes('3 commit(s)'),
    'a checkout whose oldest missing commit is 3 h old is parked, and the finding names the path'
  );
  ok(judgeCheckout(C({ oldestMissingMs: 1000 * M - PARKED_AFTER_MS }), 1000 * M) === null, 'a lag of exactly the limit is not parked');
  ok(judgeCheckout(C({ oldestMissingMs: 1000 * M - PARKED_AFTER_MS - 1 }), 1000 * M)?.kind === 'parked', 'one millisecond past the limit is parked');
  ok(judgeCheckout(C({ behind: 0, oldestMissingMs: null }), 1000 * M) === null, 'a checkout at the ref is healthy');
  ok(judgeCheckout(C({ behind: 400, oldestMissingMs: 1000 * M - M }), 1000 * M) === null, 'a large burst inside the limit is not parked: the age decides, never the count');
  ok(judgeCheckout(C({ behind: null }), 1000 * M)?.kind === 'unread' && judgeCheckout(C({ oldestMissingMs: null }), 1000 * M)?.kind === 'unread', 'an unread count or date is a finding, never a pass');
  ok(judgeCheckout(null, 1000 * M) === null, 'no primary checkout is nothing to judge');
  ok(judgeCheckout(C({ branch: 'claude/x', modified: [] }), 1000 * M)?.detail.includes('claude/x'), 'a checkout on another branch names the branch');
  ok(judgeCheckout(C({ modified: [] }), 1000 * M)?.detail.includes('shows no cause'), 'a parked clean checkout says that the tree shows no cause');
  ok(judgeCheckout(C({ modified: ['1', '2', '3', '4', '5', '6', '7'] }), 1000 * M)?.detail.includes('and 2 more'), 'a long modified list is five names and a count');
  ok(judgeCheckout(C({ modified: null }), 1000 * M)?.detail.includes('did not answer'), 'an unread modified list says so');
  ok(!judgeCheckout(C({}), 1000 * M).detail.endsWith('.'), 'the detail carries no closing period, because the post adds one');
  const P = (o) => provenanceOf({ commit: 'abc1234', commitReason: null, behind: 3, drifted: [], refReadable: true, ...o });
  const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'no user systemd', prov: P({}) });
  ok(Verdict.validate(v).ok && v.result === null, 'a NOT_RUN verdict validates and carries no result');
  ok(v.producedBy.commit === 'abc1234' && v.producedBy.behindRef === 3 && v.producedBy.refReadable === true, 'the verdict states the commit the run read from, and what it compared');
  const drift = P({ drifted: ['tools/unit-health.mjs'] });
  ok(/^⚠/.test(drift.note) && drift.note.includes('tools/unit-health.mjs'), 'a judgment source that differs from the ref warns and names the file');
  ok(!/⚠/.test(P({}).note) && P({}).note.includes('Every judgment source matches'), 'a tree whose rules are the ref\u2019s carries no warning');
  ok(drift.producedBy.driftedSources.length === 1 && P({}).producedBy.driftedSources.length === 0, 'the drifted set is machine-readable beside the prose');
  const blind = P({ refReadable: false, drifted: [] });
  ok(blind.note.includes('cannot say') && !blind.note.includes('matches'), 'an unreadable ref says the comparison never happened, and never reads as a match');
  ok(P({}).note.includes('3 commit(s) behind') && !P({ behind: null }).note.includes('commit(s) behind'), 'the behind count rides along as a diagnostic, and an absent count prints nothing');
  const noSha = P({ commit: null, commitReason: 'git did not answer' });
  ok(
    noSha.producedBy.commit === null && noSha.producedBy.commitReason === 'git did not answer' && noSha.note.includes('unknown commit (git did not answer)'),
    'a null commit carries its measured reason into the verdict and the note'
  );
  ok(Verdict.validate(verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'r', prov: noSha })).ok, 'a verdict with no commit validates while the reason is there');
  let refused = false;
  try {
    verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'r', prov: P({ commit: null, commitReason: '' }) });
  } catch {
    refused = true;
  }
  ok(refused, 'a null commit with no reason is refused, so the leg above is not vacuous');
  const line = fail.length ? `unit-health selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* ── everything below is I/O ── */

function gitOut(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: ROOT, timeout: 20000 });
  return r.error || r.status !== 0 ? null : r.stdout;
}

/** Read this run's own code identity. The reason for a null commit is DERIVED from the lookup that
 *  failed, never a literal — a reason naming a cause the run cannot have had is its own defect
 *  (`tests/dex-tests.js`, row 2026-10-22-the-population-verdict-stamps-a-cause-it-never-checked). */
function readProvenance() {
  const head = gitOut(['rev-parse', '--short', 'HEAD']);
  const commit = head ? head.trim() : null;
  const commitReason = commit ? null : `\`git rev-parse --short HEAD\` did not answer in this tool's own tree`;
  const refReadable = gitOut(['rev-parse', '--verify', '--quiet', 'origin/main']) !== null;
  let behind = null;
  const drifted = [];
  if (refReadable) {
    const n = gitOut(['rev-list', '--count', 'HEAD..origin/main']);
    behind = n !== null && /^\d+$/.test(n.trim()) ? Number(n.trim()) : null;
    for (const f of JUDGMENT_SOURCES) {
      const atRef = gitOut(['show', `origin/main:${f}`]);
      let onDisk = null;
      try {
        onDisk = readFileSync(join(ROOT, f), 'utf8');
      } catch {
        onDisk = null;
      }
      if (atRef === null || onDisk === null || atRef !== onDisk) drifted.push(f);
    }
  }
  return provenanceOf({ commit, commitReason, behind, drifted, refReadable });
}

/** Read the primary checkout: the tree that holds the common git directory, whichever worktree runs this. */
function readCheckout() {
  const common = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common === null) return { path: ROOT, branch: null, behind: null, oldestMissingMs: null, modified: null };
  if (basename(common.trim()) !== '.git') return null;
  const path = dirname(common.trim());
  const at = (args) => gitOut(['-C', path, ...args]);
  const branch = at(['rev-parse', '--abbrev-ref', 'HEAD']);
  const missing = at(['log', '--format=%ct', 'HEAD..origin/main']);
  const status = at(['status', '--porcelain', '--untracked-files=no']);
  const stamps = missing === null ? null : missing.split('\n').filter(Boolean).map(Number);
  return {
    path,
    branch: branch === null ? null : branch.trim(),
    behind: stamps === null ? null : stamps.length,
    oldestMissingMs: stamps?.length && stamps.every(Number.isFinite) ? Math.min(...stamps) * 1000 : null,
    modified:
      status === null
        ? null
        : status
            .split('\n')
            .filter(Boolean)
            .map((l) => l.slice(3))
  };
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
    const show = sysctl(['show', t.unit, '-p', 'UnitFileState', '-p', 'InactiveExitTimestampMonotonic', '-p', 'ActiveEnterTimestamp', '-p', 'SubState', '--timestamp=unix']) ?? '';
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
        loadedSinceUs: since ? Number(since[1]) * 1e6 : 0,
        timerSub: prop.SubState || null
      }
    });
  }
  return { rows, failedUnits, transient: failedUnits.filter(isTransient).length };
}

function statePath() {
  return resolveStatePath(ROOT, 'unit-health.json');
}

function post(added, cleared, findings, prov) {
  const lines = ['Unit health (`tools/unit-health.mjs`, the 15-min timer). The finding set changed on the rig.', ''];
  if (added.length) lines.push('New:', ...added.map((f) => `- \`${f.unit}\` — ${f.kind}: ${f.detail}.`), '');
  if (cleared.length) lines.push('Cleared:', ...cleared.map((f) => `- \`${f.unit}\` — ${f.kind}.`), '');
  lines.push(`Now: ${findings.length} finding(s). Read the journal with \`journalctl --user -u <unit> -n 20\`.`, '', prov.note);
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
  const prov = readProvenance();
  const sys = readSystem();
  if (!sys) {
    const v = verdictOf({ status: 'NOT_RUN', findings: [], checked: 0, transient: 0, reason: 'no systemd user manager answered `systemctl --user list-timers`', prov });
    if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
    else console.log(`unit-health: NOT_RUN — no systemd user manager to read (CI or a fresh clone)\n${prov.note}`);
    process.exit(2);
  }
  const now = Date.now() * 1000;
  const timerFindings = sys.rows.map(({ t, s }) => judgeTimer(t, s, now)).filter(Boolean);
  const jobFindings = [...timerFindings, ...orphanFailures(sys.failedUnits, timerFindings)];
  const memory = readMemory();
  const checkout = judgeCheckout(readCheckout(), now / 1000);
  const findings = [...jobFindings, ...memory, ...(checkout ? [checkout] : [])];
  const checked = sys.rows.length;
  const status = checked === 0 ? 'NOT_APPLICABLE' : findings.length ? 'FAIL' : 'PASS';
  const reason =
    checked === 0
      ? 'no user timer is loaded'
      : findings.length
        ? `${jobFindings.length} timer job(s) failed, stopped, overdue or never ran, ${memory.length} fleet memory finding(s), and ${checkout ? 1 : 0} parked or unread checkout`
        : null;
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
      if (post(added, cleared, findings, prov)) writeFileSync(p, `${JSON.stringify({ at: new Date().toISOString(), findings }, null, 1)}\n`);
    }
  }
  const v = verdictOf({ status, findings, checked, transient: sys.transient, reason, prov });
  if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
  else {
    console.log(`unit-health · ${checked} timer(s) read · ${findings.length} finding(s) · ${sys.transient} failed transient scope(s) counted apart`);
    for (const f of findings) console.log(`  ✕ ${f.kind.padEnd(8)} ${f.unit.startsWith('memory:') ? `${f.unit} ` : ''}${f.detail}`);
    console.log(prov.note);
  }
  process.exit(findings.length ? 1 : 0);
}

if (isCliEntry(import.meta.url)) main();
