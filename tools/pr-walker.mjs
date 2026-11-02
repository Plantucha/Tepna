#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * pr-walker — the landing pipeline runs ITSELF: every open PR is classified each pass and the walker
 * takes the one action its state calls for, with nobody typing a number into a queue file.
 *
 * THE FAILURE THIS ENDS (measured 2026-10-13 over the last 40 merged PRs). Kodiak merged a ready PR in
 * a median 0.2 h. The same PRs had sat a median 1.65 h — one for 13.1 h — as DRAFTS, because the old
 * walker undrafted only numbers the owner had appended to `undraft-queue.txt`, only while two or fewer
 * PRs were out of draft, one per four-minute pass. Sixteen green PRs queued while Kodiak sat idle. The
 * owner's verdict: "I want automatic system" — so every rule that needed a person is gone.
 *
 * One pass. Snapshot every open PR (draft flag, labels, merge state, checks, head SHA), read the
 * REQUIRED set from the `protect-main` ruleset, classify each PR as exactly one of
 *   held · conflict · red · cancelled · pending · stuck · unknown · green
 * and plan actions from the classification alone:
 *   ready   a green draft is marked ready while fewer than CAP (4, CLAUDE.md §👥.5) are out of draft,
 *           oldest number first
 *   rerun   a PR red on a REQUIRED check gets its failed jobs re-run ONCE per head SHA; red again is
 *           a coder's, and the walker says so instead of looping
 *   rerun-all a PR whose REQUIRED check was CANCELLED gets the whole run re-run, never `--failed`,
 *           because a cancelled run's jobs conclude `cancelled` and `--failed` would re-run nothing
 *   rebase  a conflicting PR is rebased with `tools/rebase-safe.mjs` in the walker's OWN worktree and
 *           pushed with `--force-with-lease` against the SHA it observed, ONCE per head SHA; a
 *           source-file conflict stops rebase-safe, and the walker reports "hand rebase" and moves on
 *   update  a green non-draft PR BEHIND main while Kodiak has been quiet for KODIAK_IDLE_MIN is
 *           updated (`gh pr update-branch`), one per pass — queue-doctor's rule, same reason
 *   merge   a green, current, non-draft PR Kodiak has left for KODIAK_IDLE_MIN is merged by SHA
 *   alert   stuck, red-after-rerun, hand-rebase and a required check pending over STALE_PENDING_MIN
 *           are written to the landing page the board shows and to the journal
 * SIGNED. Every action that changed a PR leaves one comment on it naming the walker, the action, the UTC
 * time and the reason (owner, 2026-11-01: "it will sign everything what it does … It will increase
 * visibility"). A failed or dry-run action signs nothing; a comment that cannot post never changes the
 * action's result, it only reads `signed: false` on the landing page.
 * A `do-not-merge` label HOLDS a PR: the walker never readies, reruns or merges it. It still REBASES a
 * held PR that CONFLICTS (once per head, owner 2026-11-02), and it UPDATES a held PR that falls BEHIND main, at once and with no idleness gate, because Kodiak never
 * updates a held PR and the owner's merge button otherwise reads "out-of-date" after every merge to
 * main (owner, 2026-10-13: "let the walker update held PRs too"). Kodiak keeps the merge; `update` and
 * `merge` on a green PR are fallbacks for the hours Kodiak is down, gated on its idleness, never a race.
 *
 * THE DECISION IS PURE. `classify()` and `plan()` take snapshots and return actions; `tests/dex-tests.js`
 * group `tools · pr-walker` pins them without `gh`, a network or a clock (the land-pr / queue-doctor
 * shape). Everything that touches GitHub or git lives in `act()` and `snapshot()`.
 *
 * Fails closed. An unreadable ruleset makes EVERY reported check required. An unreadable check list is
 * `unknown`, never green. A dirty walker worktree skips the rebase and says why.
 *
 *   node tools/pr-walker.mjs                       # one pass, act
 *   node tools/pr-walker.mjs --dry-run             # one pass, print the plan, act on nothing
 *   node tools/pr-walker.mjs --loop --interval-s 90
 *   node tools/pr-walker.mjs --print-install       # the owner's install commands (timer-owned worktree)
 *   node tools/pr-walker.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

export const CAP = 4;
export const KODIAK_IDLE_MIN = 20;
export const STALE_PENDING_MIN = 180;
export const MAX_RERUNS_PER_SHA = 1;
export const HOLD_LABEL = 'do-not-merge';
/* The `protect-main` required contexts, read 2026-10-31. A MIRROR, and a mirror lags: protection
   gained `secret-scan` and `test (py3.14)` between 2026-10-13 and 2026-10-31 while this list stood
   still, and nothing said so. Worse, the list was dead — `classify` substituted the REPORTED check
   names in the degraded path, so the one thing the old comment promised (naming a context that never
   arrived) was the one thing it could not do. Two mechanisms keep it honest now: the degraded path
   UNIONS this list with the reported checks, and `fallbackDrift` names the difference on every pass
   where the ruleset DOES read. */
export const FALLBACK_REQUIRED = [
  'biome',
  'browser-gates',
  'mutation (diff-scoped)',
  'no-network',
  'secret-scan',
  'stale-file',
  'test',
  'test (py3.12)',
  'test (py3.13)',
  'test (py3.14)',
  'typecheck'
];

/* ── pure core ─────────────────────────────────────────────────────────────────────────────────
   pr: { number, isDraft, mergeState, labels, checks:[{name,bucket,link}], readable, headSha, updatedAtMs, branch }
   required: [context] from the ruleset, [] when unreadable. fallback stands in for the ruleset ONLY
   when it is unreadable, and even then it only ADDS to the reported names. */
export function classify(pr, required, fallback = FALLBACK_REQUIRED) {
  const base = {
    number: pr.number,
    draft: !!pr.isDraft,
    headSha: pr.headSha,
    branch: pr.branch,
    updatedAtMs: pr.updatedAtMs || 0,
    behind: pr.mergeState === 'BEHIND',
    dirty: pr.mergeState === 'DIRTY',
    failed: [],
    cancelled: [],
    runIds: []
  };
  if ((pr.labels || []).includes(HOLD_LABEL)) return { ...base, state: 'held', why: `${HOLD_LABEL} label` };
  if (pr.readable === false) return { ...base, state: 'unknown', why: 'checks unreadable (API error) — not an empty list' };
  if (pr.mergeState === 'DIRTY') return { ...base, state: 'conflict', why: 'conflicts with main' };
  const checks = pr.checks || [];
  const ruleset = (required || []).length > 0;
  /* Fail closed in BOTH directions when the ruleset does not read. Every reported check counts, so
     an advisory red blocks; and the mirror adds the contexts that never arrived, which a set built
     from the report alone cannot see — an absent required check leaves no name to miss. */
  const req = ruleset ? new Set(required) : new Set([...(fallback || []), ...checks.map((c) => c.name)]);
  const isReq = (c) => req.has(c.name);
  const failed = checks.filter((c) => c.bucket === 'fail' && isReq(c));
  if (failed.length) {
    const runIds = [...new Set(failed.map((c) => runIdOf(c.link)).filter(Boolean))];
    return {
      ...base,
      state: 'red',
      failed: failed.map((c) => c.name),
      runIds,
      why: `required red: ${failed.map((c) => c.name).join(', ')}${ruleset ? '' : ' (ruleset unreadable — every check counts)'}`
    };
  }
  /* 🔴 A CANCELLED REQUIRED CHECK USED TO READ AS GREEN TO THE TOOL THAT ACTS. `gh pr checks` puts
     it in bucket `cancel`, which is neither `fail` nor `pending`, and the context DID report, so
     `unreported` below cannot see it either: every rung fell through and the PR classified `green`.
     This tool then UNDRAFTS it and merges it once Kodiak is idle, while nothing re-runs a cancelled
     run, so the required context never becomes a success and the merge waits on it forever.
     `classify` in `tools/queue-doctor.mjs` has held this rung since 2026-10-19 (#3688: `biome` and
     `typecheck` cancelled by a supersede-on-push group, seven other workflows green on the same
     head). The rung sat in the tool that only REPORTS and was absent from the one that ACTS. It
     ranks below `red`, because a red is a code question and a cancellation is a queue question. */
  const cancelled = checks.filter((c) => c.bucket === 'cancel' && isReq(c));
  if (cancelled.length) {
    return {
      ...base,
      state: 'cancelled',
      cancelled: cancelled.map((c) => c.name),
      runIds: [...new Set(cancelled.map((c) => runIdOf(c.link)).filter(Boolean))],
      why: `required cancelled: ${cancelled.map((c) => c.name).join(', ')} — terminal, so nothing re-runs them`
    };
  }
  const pending = checks.filter((c) => c.bucket === 'pending');
  const reqPending = pending.filter(isReq);
  const seen = new Set(checks.map((c) => c.name));
  const unreported = [...req].filter((n) => !seen.has(n));
  if (reqPending.length) return { ...base, state: 'pending', why: `${reqPending.length} required running` };
  if (unreported.length && pending.length) return { ...base, state: 'pending', why: `required not yet reported: ${unreported.join(', ')}` };
  if (unreported.length) return { ...base, state: 'stuck', why: `required never reported: ${unreported.join(', ')}` };
  if (pr.mergeState === 'UNKNOWN') return { ...base, state: 'unknown', why: 'GitHub still computing mergeability' };
  return { ...base, state: 'green', why: base.behind ? 'green, behind main' : 'green, current' };
}

/* The mirror's tripwire. `missing` is what protection requires and the mirror omits — the lag that
   made this row. `extra` is what the mirror still names after protection dropped it, which strands a
   degraded pass on a context that can never arrive. An unreadable ruleset judges nothing: `[]` is
   absence, not an empty required set, so it reports `readable: false` rather than eleven `extra`. */
export function fallbackDrift(required, fallback = FALLBACK_REQUIRED) {
  const live = new Set(required || []);
  const mirror = new Set(fallback || []);
  if (live.size === 0) return { readable: false, missing: [], extra: [] };
  return { readable: true, missing: [...live].filter((c) => !mirror.has(c)).sort(), extra: [...mirror].filter((c) => !live.has(c)).sort() };
}

export function runIdOf(link) {
  const m = /\/actions\/runs\/(\d+)/.exec(link || '');
  return m ? m[1] : null;
}

/* state: { reruns:{sha:n}, rebased:{sha:'pushed:<sha>'|'stopped'|'dirty'|…}, firstPending:{number:ms} }
   ctx:   { nowMs, mainMovedAtMs, cap } */
/* One rebase per head SHA; a head that already stopped once is a coder's, named by the step. */
function planRebase(r, state, actions, alerts, why) {
  const st = (state.rebased || {})[r.headSha];
  if (!st) actions.push({ op: 'rebase', number: r.number, headSha: r.headSha, branch: r.branch, why });
  else alerts.push({ number: r.number, kind: 'hand-rebase', why: `rebase ${st} on ${String(r.headSha).slice(0, 9)} — rebase by hand` });
}

export function plan(classified, state, ctx) {
  const cap = ctx.cap || CAP;
  const now = ctx.nowMs;
  const idleMs = KODIAK_IDLE_MIN * 60000;
  const actions = [];
  const alerts = [];
  const rows = [...classified].sort((a, b) => a.number - b.number);
  let nonDraft = rows.filter((r) => !r.draft).length;

  for (const r of rows) {
    if (r.state === 'held') {
      /* The one thing a hold permits: keep the branch current, so the owner's merge is one click. A
         held PR BEHIND main gets `update`. A held PR that CONFLICTS gets the same once-per-head rebase
         as an unheld one, because update-branch cannot merge a conflict (owner, 2026-11-02: "Fix
         walker. Everything is idle" — three held PRs sat DIRTY with no action). A rebase moves no
         label and merges nothing, so the hold still decides the landing. */
      if (r.behind && !actions.some((a) => a.op === 'update')) actions.push({ op: 'update', number: r.number, why: 'held, behind main — updated so the owner can merge' });
      else if (r.dirty) planRebase(r, state, actions, alerts, 'held, conflicts with main — rebase-safe once so the owner can merge');
      continue;
    }
    if (r.state === 'green' && r.draft) {
      if (nonDraft < cap) {
        actions.push({ op: 'ready', number: r.number, why: `green draft, pool ${nonDraft}/${cap}` });
        nonDraft++;
      } else alerts.push({ number: r.number, kind: 'waiting-for-slot', why: `green draft, pool ${nonDraft}/${cap}` });
      continue;
    }
    if (r.state === 'red') {
      const n = (state.reruns || {})[r.headSha] || 0;
      if (n < MAX_RERUNS_PER_SHA && r.runIds.length)
        actions.push({ op: 'rerun', number: r.number, headSha: r.headSha, runIds: r.runIds, why: `required red (${r.failed.join(', ')}), rerun ${n + 1}/${MAX_RERUNS_PER_SHA}` });
      else alerts.push({ number: r.number, kind: 'red', why: `${r.failed.join(', ')} red after ${n} rerun(s) — a coder owns it` });
      continue;
    }
    if (r.state === 'cancelled') {
      /* A FULL re-run, never `--failed`: a cancelled run's jobs conclude `cancelled`, not `failure`,
         so `gh run rerun --failed` would re-run nothing and the walker would report an action that
         changed the PR not at all. Measured 2026-11-02 over the five most recent cancelled runs in
         this repo: FOUR carried zero jobs concluding `failure` (3 cancelled · 1 cancelled + 1 success
         · 5 + 2 · 1 + 6), and only one had a single failed job beside seven cancelled ones.
         The per-head counter is shared with the red rerun above on purpose. The bound is re-runs per
         HEAD, so a cancellation followed by a red cannot spin one head twice. */
      const n = (state.reruns || {})[r.headSha] || 0;
      if (n < MAX_RERUNS_PER_SHA && r.runIds.length)
        actions.push({ op: 'rerun-all', number: r.number, headSha: r.headSha, runIds: r.runIds, why: `required cancelled (${r.cancelled.join(', ')}), full rerun ${n + 1}/${MAX_RERUNS_PER_SHA}` });
      else alerts.push({ number: r.number, kind: 'cancelled', why: `${r.cancelled.join(', ')} cancelled${r.runIds.length ? ` after ${n} rerun(s)` : ' with no run id to re-run'} — a coder owns it` });
      continue;
    }
    if (r.state === 'conflict') {
      planRebase(r, state, actions, alerts, 'conflicts with main — rebase-safe once');
      continue;
    }
    if (r.state === 'stuck') {
      alerts.push({ number: r.number, kind: 'stuck', why: r.why });
      continue;
    }
    if (r.state === 'pending') {
      const since = (state.firstPending || {})[r.number];
      if (since && now - since > STALE_PENDING_MIN * 60000) alerts.push({ number: r.number, kind: 'stale-pending', why: `required check pending ${Math.round((now - since) / 60000)} min` });
      continue;
    }
    if (r.state === 'green' && !r.draft) {
      const quietSince = Math.max(r.updatedAtMs || 0, ctx.mainMovedAtMs || 0);
      const quiet = now - quietSince > idleMs;
      if (!quiet) continue;
      const mins = Math.round((now - quietSince) / 60000);
      if (r.behind) {
        if (!actions.some((a) => a.op === 'update')) actions.push({ op: 'update', number: r.number, why: `green, behind, Kodiak quiet ${mins} min` });
      } else if (!actions.some((a) => a.op === 'merge')) actions.push({ op: 'merge', number: r.number, headSha: r.headSha, why: `green, current, Kodiak quiet ${mins} min` });
    }
  }
  return { actions, alerts, nonDraft, cap };
}

/* ── I/O ────────────────────────────────────────────────────────────────────────────────────── */
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const gh = (args, opts) => sh('gh', args, opts);

export function requiredContexts() {
  try {
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
    const rules = JSON.parse(gh(['api', `repos/${repo}/rules/branches/main`]));
    const r = rules.find((x) => x.type === 'required_status_checks');
    return (r?.parameters?.required_status_checks || []).map((c) => c.context);
  } catch {
    return [];
  }
}

export function snapshot() {
  const list = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,isDraft,mergeStateStatus,labels,headRefOid,headRefName,updatedAt,title']));
  const prs = list.map((p) => {
    let checks = [];
    let readable = true;
    try {
      checks = JSON.parse(gh(['pr', 'checks', String(p.number), '--json', 'name,bucket,link']));
    } catch (e) {
      /* non-zero exit with parseable stdout is a verdict (a red check); no stdout is an API error */
      try {
        checks = JSON.parse(String(e.stdout || ''));
      } catch {
        checks = [];
        readable = false;
      }
    }
    return {
      number: p.number,
      title: p.title,
      isDraft: p.isDraft,
      mergeState: p.mergeStateStatus,
      labels: (p.labels || []).map((l) => l.name),
      headSha: p.headRefOid,
      branch: p.headRefName,
      updatedAtMs: Date.parse(p.updatedAt),
      checks,
      readable
    };
  });
  let mainMovedAtMs = 0;
  try {
    const m = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--limit', '1', '--json', 'mergedAt']));
    mainMovedAtMs = m.length ? Date.parse(m[0].mergedAt) : 0;
  } catch {
    mainMovedAtMs = 0;
  }
  return { prs, required: requiredContexts(), mainMovedAtMs };
}

const STATE_DIR = path.join(homedir(), '.local', 'state', 'tepna', 'pr-walker');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BOARD_DIR = path.join(homedir(), '.local', 'share', 'tepna', 'board');

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { reruns: {}, rebased: {}, firstPending: {} };
  }
}
function saveState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 1));
  renameSync(tmp, STATE_FILE);
}

/* The rebase runs in a worktree the walker OWNS (`--worktree`), never in a bird's checkout. rebase-safe
   refuses a dirty tree and stops on a source conflict; both leave the branch untouched upstream.
   DETACHED, never `checkout -B <branch>`: git refuses a branch name another worktree holds (rc 128,
   "already used by worktree"), and the owning bird holds the worktree for every PR under active work.
   Measured 2026-11-02 (board #2901): #4233, #4242 and #4245 each alerted `rebase-safe stopped` when
   rebase-safe had never run. A detached HEAD needs no branch name, and the push names the ref. */
export function stepResult(step, e) {
  const line = String((e && (e.stderr || e.message)) || (typeof e === 'string' ? e : ''))
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return `stopped:${step}${line ? `: ${line.slice(0, 140)}` : ''}`;
}
function rebaseBranch(a, wt) {
  const g = (...args) => sh('git', args, { cwd: wt });
  if (!wt || !existsSync(path.join(wt, '.git'))) return 'no-worktree';
  if (g('status', '--porcelain').trim()) return 'dirty';
  if (!/^claude\//.test(a.branch || '')) return 'not-a-fleet-branch';
  let step = 'fetch';
  try {
    g('fetch', '-q', 'origin', 'main', a.branch);
    step = 'checkout';
    g('checkout', '-q', '--detach', `origin/${a.branch}`);
    if (g('rev-parse', 'HEAD').trim() !== a.headSha) return 'moved';
    step = 'rebase-safe';
    sh('node', ['tools/rebase-safe.mjs'], { cwd: wt });
    step = 'push';
    g('push', '-q', `--force-with-lease=${a.branch}:${a.headSha}`, 'origin', `HEAD:refs/heads/${a.branch}`);
    return `pushed:${g('rev-parse', 'HEAD').trim()}`;
  } catch (e) {
    try {
      g('rebase', '--abort');
    } catch {}
    return stepResult(step, e);
  } finally {
    try {
      g('checkout', '-q', '--detach', 'origin/main');
    } catch {}
  }
}

export function act(actions, state, opts) {
  const done = [];
  for (const a of actions) {
    let result = 'ok';
    try {
      if (opts.dryRun) result = 'dry-run';
      else if (a.op === 'ready') gh(['pr', 'ready', String(a.number)]);
      else if (a.op === 'rerun') {
        for (const id of a.runIds) gh(['run', 'rerun', id, '--failed']);
        state.reruns[a.headSha] = (state.reruns[a.headSha] || 0) + 1;
      } else if (a.op === 'rerun-all') {
        /* No `--failed`. A cancelled run has no failed jobs to re-run — see `plan`'s measurement. */
        for (const id of a.runIds) gh(['run', 'rerun', id]);
        state.reruns[a.headSha] = (state.reruns[a.headSha] || 0) + 1;
      } else if (a.op === 'rebase') {
        result = rebaseBranch(a, opts.worktree);
        state.rebased[a.headSha] = result;
      } else if (a.op === 'update') gh(['pr', 'update-branch', String(a.number)]);
      else if (a.op === 'merge') gh(['pr', 'merge', String(a.number), '--squash', '--match-head-commit', a.headSha]);
    } catch (e) {
      result = `failed: ${String(e.stderr || e.message || e)
        .split('\n')[0]
        .slice(0, 160)}`;
    }
    const row = { ...a, result };
    const body = opts.dryRun ? null : signature(row, opts.at || new Date().toISOString());
    if (body) {
      try {
        gh(['pr', 'comment', String(a.number), '--body', body]);
        row.signed = true;
      } catch {
        row.signed = false;
      }
    }
    done.push(row);
  }
  return done;
}

/* The signature comment, pure. `at` is an ISO instant; the walker runs on real UTC time (it is not a
   capture stamp), so the comment says UTC. Returns null for an action that changed nothing. */
const SIGN_VERB = {
  ready: 'marked this PR ready for review (undrafted)',
  rerun: 're-ran the failed required jobs',
  'rerun-all': 're-ran every job in the cancelled required run(s)',
  rebase: 'rebased this branch onto main with `tools/rebase-safe.mjs` and pushed it',
  update: 'updated this branch from main',
  merge: 'squash-merged this PR'
};
export function signature(a, at) {
  const ok = a.result === 'ok' || /^pushed:/.test(a.result || '');
  if (!ok || !SIGN_VERB[a.op]) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at || '');
  const when = m ? `${m[2]} UTC, ${m[1]}` : 'an unknown time';
  const head = a.op === 'rebase' ? ` New head \`${a.result.slice(7, 16)}\`.` : '';
  return [
    `🚶 **The fleet walker ${SIGN_VERB[a.op]}** at ${when}.${head}`,
    '',
    `Reason: ${a.why}.`,
    '',
    '<sub>`tools/pr-walker.mjs` under `tepna-pr-walker.timer` on rig-x870, about every 90 s. No person took this action. A `do-not-merge` label holds a PR from the walker.</sub>'
  ].join('\n');
}

export function landingPage(rows, planned, done, meta) {
  const L = [];
  L.push(`pr-walker pass ${meta.at} · open ${rows.length} · out of draft ${planned.nonDraft}/${planned.cap} · required set: ${meta.requiredSource}`);
  const d = meta.drift;
  if (d?.readable && (d.missing.length || d.extra.length))
    L.push(
      `DRIFT FALLBACK_REQUIRED vs the ruleset · protection also requires: ${d.missing.join(', ') || 'nothing'} · the mirror still names: ${d.extra.join(', ') || 'nothing'} — edit tools/pr-walker.mjs`
    );
  for (const r of rows) L.push(`#${r.number} ${r.draft ? 'draft' : 'ready'} ${r.state.padEnd(8)} ${r.why}`);
  L.push(`actions: ${done.length ? done.map((d) => `${d.op} #${d.number} → ${d.result}${d.signed === false ? ' (signed: false)' : ''}`).join(' · ') : 'none'}`);
  for (const al of planned.alerts) L.push(`ALERT #${al.number} ${al.kind}: ${al.why}`);
  return `${L.join('\n')}\n`;
}

export function pass(opts) {
  const snap = snapshot();
  const state = loadState();
  state.reruns ||= {};
  state.rebased ||= {};
  state.firstPending ||= {};
  const rows = snap.prs.map((p) => classify(p, snap.required));
  const now = Date.now();
  for (const r of rows) {
    if (r.state === 'pending') state.firstPending[r.number] ||= now;
    else delete state.firstPending[r.number];
  }
  const planned = plan(rows, state, { nowMs: now, mainMovedAtMs: snap.mainMovedAtMs, cap: opts.cap || CAP });
  const done = act(planned.actions, state, { ...opts, at: new Date(now).toISOString() });
  if (!opts.dryRun) saveState(state);
  const drift = fallbackDrift(snap.required);
  const page = landingPage(rows, planned, done, {
    at: new Date(now).toISOString(),
    drift,
    requiredSource: snap.required.length ? `ruleset(${snap.required.length})` : 'UNREADABLE — the mirror plus every reported check'
  });
  if (!opts.dryRun) {
    try {
      mkdirSync(BOARD_DIR, { recursive: true });
      writeFileSync(path.join(BOARD_DIR, 'landing.md'), page);
    } catch {}
  }
  if (opts.json) console.log(JSON.stringify({ at: now, rows, actions: done, alerts: planned.alerts, drift }));
  else process.stdout.write(page);
  return { rows, done, alerts: planned.alerts };
}

export function installText() {
  return [
    '# pr-walker — install on the primary development machine (owner runs this; the PR does not)',
    'systemctl --user disable --now tepna-walker.service 2>/dev/null; true   # the old queue-file walker',
    'git -C ~/Tepna worktree add ~/wt-walker-timer --detach origin/main      # the walker’s OWN checkout',
    'ln -s ~/Tepna/node_modules ~/wt-walker-timer/node_modules',
    'cp ~/Tepna/tools/systemd/tepna-pr-walker.{service,timer} ~/.config/systemd/user/',
    'systemctl --user daemon-reload && systemctl --user enable --now tepna-pr-walker.timer',
    'systemctl --user start tepna-pr-walker.service                          # one pass now',
    'journalctl --user -u tepna-pr-walker.service -n 30 --no-pager'
  ].join('\n');
}

function selftest() {
  const req = ['test', 'biome'];
  const G = [
    { name: 'test', bucket: 'pass' },
    { name: 'biome', bucket: 'pass' }
  ];
  const mk = (o) => ({ number: 1, isDraft: true, mergeState: 'CLEAN', labels: [], checks: G, readable: true, headSha: 'a'.repeat(40), updatedAtMs: 0, branch: 'claude/x', ...o });
  let ran = 0;
  const eq = (a, b, m) => {
    ran++;
    if (a !== b) throw new Error(`${m}: ${a} !== ${b}`);
  };
  eq(classify(mk({}), req).state, 'green', 'green draft');
  eq(classify(mk({ labels: [HOLD_LABEL] }), req).state, 'held', 'held');
  eq(classify(mk({ mergeState: 'DIRTY' }), req).state, 'conflict', 'conflict');
  eq(classify(mk({ checks: [{ name: 'test', bucket: 'fail', link: 'https://github.com/x/y/actions/runs/42/job/7' }, G[1]] }), req).runIds[0], '42', 'run id');
  eq(classify(mk({ checks: [{ name: 'mutation', bucket: 'fail' }, ...G] }), req).state, 'green', 'advisory red');
  eq(classify(mk({ checks: [{ name: 'mutation', bucket: 'fail' }, ...G] }), []).state, 'red', 'fail closed');
  eq(classify(mk({ checks: [G[0]] }), req).state, 'stuck', 'stuck');
  eq(classify(mk({}), []).state, 'stuck', 'degraded: the mirror names what never arrived');
  eq(classify(mk({}), [], ['test', 'biome']).state, 'green', 'degraded: a satisfied mirror');
  /* The cancelled rung. A `cancel` bucket is terminal and it DID report, so before this rung every
     test fell through and the PR read `green` — which undrafts and merges it. */
  const CN = { name: 'test', bucket: 'cancel', link: 'https://github.com/x/y/actions/runs/77/job/3' };
  eq(classify(mk({ checks: [CN, G[1]] }), req).state, 'cancelled', 'a cancelled required check is not green');
  eq(classify(mk({ checks: [CN, G[1]] }), req).runIds[0], '77', 'the cancelled run id is carried, so it can be re-run');
  eq(classify(mk({ checks: [CN, G[1]] }), req).cancelled.join(','), 'test', 'the rung names the context it blocked on');
  eq(classify(mk({ checks: [{ name: 'mutation', bucket: 'cancel' }, ...G] }), req).state, 'green', "an advisory cancellation is not the queue's business");
  eq(classify(mk({ checks: [{ name: 'mutation', bucket: 'cancel' }, ...G] }), []).state, 'cancelled', 'fail closed: an unreadable ruleset makes every cancellation count');
  eq(
    classify(
      mk({
        checks: [
          { name: 'test', bucket: 'fail' },
          { name: 'biome', bucket: 'cancel' }
        ]
      }),
      req
    ).state,
    'red',
    'a red outranks a cancellation: code question before queue question'
  );
  const cn = (o) => mk({ number: 4, isDraft: false, checks: [CN, G[1]], ...o });
  const cc = plan([classify(cn({}), req)], { reruns: {}, rebased: {} }, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
  eq(cc.actions.map((a) => `${a.op}:${a.runIds.join('')}`).join(','), 'rerun-all:77', 'a cancelled required check re-runs the WHOLE run, never --failed');
  const cc2 = plan([classify(cn({}), req)], { reruns: { ['a'.repeat(40)]: 1 }, rebased: {} }, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
  eq(cc2.actions.length, 0, 'one rerun per head, a cancellation included');
  eq(cc2.alerts[0].kind, 'cancelled', 'an exhausted head alerts instead of looping');
  eq(
    signature({ op: 'rerun-all', number: 4, result: 'ok', why: 'w' }, '2026-11-02T19:45:00Z').includes('every job in the cancelled'),
    true,
    'the signature must not claim it re-ran FAILED jobs when it re-ran the whole run'
  );
  eq(fallbackDrift(['test', 'biome'], ['test']).missing.join(','), 'biome', 'drift names the lag');
  eq(fallbackDrift([], ['test']).readable, false, 'an unreadable ruleset judges no mirror');
  eq(classify(mk({ readable: false }), req).state, 'unknown', 'unreadable');
  const p = plan(
    [classify(mk({ number: 5 }), req), classify(mk({ number: 3 }), req), ...[1, 2, 3].map((n) => classify(mk({ number: 10 + n, isDraft: false }), req))],
    { reruns: {}, rebased: {} },
    { nowMs: 0, mainMovedAtMs: 0, cap: 4 }
  );
  eq(p.actions.length, 1, 'one slot');
  eq(p.actions[0].number, 3, 'oldest first');
  const held = plan([classify(mk({ number: 7, isDraft: false, labels: [HOLD_LABEL], mergeState: 'BEHIND' }), req)], { reruns: {}, rebased: {} }, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
  eq(held.actions.map((a) => `${a.op}:${a.number}`).join(','), 'update:7', 'held behind ⇒ update at once');
  eq(plan([classify(mk({ number: 7, isDraft: false, labels: [HOLD_LABEL] }), req)], { reruns: {}, rebased: {} }, { nowMs: 0, mainMovedAtMs: 0, cap: 4 }).actions.length, 0, 'held current ⇒ nothing');
  const hd = plan([classify(mk({ number: 8, labels: [HOLD_LABEL], mergeState: 'DIRTY' }), req)], { reruns: {}, rebased: {} }, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
  eq(hd.actions.map((a) => `${a.op}:${a.number}`).join(','), 'rebase:8', 'held conflicting ⇒ one rebase');
  const hd2 = plan(
    [classify(mk({ number: 8, labels: [HOLD_LABEL], mergeState: 'DIRTY' }), req)],
    { reruns: {}, rebased: { [mk({}).headSha]: 'stopped:rebase-safe' } },
    { nowMs: 0, mainMovedAtMs: 0, cap: 4 }
  );
  eq(`${hd2.actions.length}:${hd2.alerts[0] && hd2.alerts[0].kind}`, '0:hand-rebase', 'held conflicting, stopped once ⇒ an alert, never a second try');
  const sig = signature({ op: 'ready', number: 3, result: 'ok', why: 'green draft, pool 1/4' }, '2026-11-01T11:45:09.000Z');
  eq(/^🚶 \*\*The fleet walker marked this PR ready for review \(undrafted\)\*\* at 11:45 UTC, 2026-11-01\./.test(sig), true, 'signature names the walker, the action and the time');
  eq(signature({ op: 'ready', number: 3, result: 'failed: x', why: 'w' }, '2026-11-01T11:45:09Z'), null, 'a failed action signs nothing');
  eq(signature({ op: 'rebase', number: 3, result: 'stopped', why: 'w' }, '2026-11-01T11:45:09Z'), null, 'a stopped rebase signs nothing');
  const used = { stderr: "fatal: 'claude/x-hrn' is already used by worktree at '/w'\n" };
  eq(stepResult('checkout', used), "stopped:checkout: fatal: 'claude/x-hrn' is already used by worktree at '/w'", 'a stop names the step that failed and its first stderr line');
  eq(stepResult('rebase-safe', {}), 'stopped:rebase-safe', 'a stop with no message still names its step');
  eq(signature({ op: 'rebase', number: 3, result: 'stopped:push: x', why: 'w' }, '2026-11-01T11:45:09Z'), null, 'a step-named stop signs nothing');
  const hr = plan(
    [classify(mk({ number: 9, isDraft: false, mergeState: 'DIRTY' }), req)],
    { reruns: {}, rebased: { [mk({}).headSha]: 'stopped:rebase-safe' } },
    { nowMs: 0, mainMovedAtMs: 0, cap: 4 }
  );
  eq(hr.alerts[0].why.startsWith('rebase stopped:rebase-safe on '), true, 'the hand-rebase alert names the step, never rebase-safe by default');
  console.log(`all ${ran} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  if (flag('--selftest')) selftest();
  else if (flag('--print-install')) console.log(installText());
  else {
    const opts = { dryRun: flag('--dry-run'), json: flag('--json'), worktree: val('--worktree', process.cwd()), cap: Number(val('--cap', CAP)) };
    if (flag('--loop')) {
      const iv = Number(val('--interval-s', 90)) * 1000;
      const tick = () => {
        try {
          pass(opts);
        } catch (e) {
          console.error(`pass failed: ${String(e.message || e).split('\n')[0]}`);
        }
        setTimeout(tick, iv);
      };
      tick();
    } else pass(opts);
  }
}
