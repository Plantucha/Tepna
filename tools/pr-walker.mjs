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
 *           are written to the landing page the board shows and, ONCE per (PR, kind, head), to the
 *           journal — a pass that changed nothing prints one line (`journalText`)
 *   close   a merged PR whose body carries `Residue-fixed: <key>` for a row that reads `OPEN` on
 *           main gets a RESIDUE-only draft PR writing `fixed #<that PR>` in the state cell, one
 *           walker closure PR in flight at a time (`planClosures`, `closeRowsText`)
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
 *   node tools/pr-walker.mjs --clean-worktree    # restore the generated paths a rebase rebuilt here
 *   node tools/pr-walker.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isCliEntry } from './argv-guard.mjs';
import { classify as classifyPath, generatedSet } from './rebase-safe.mjs';

export const CAP = 4;
/* How many of the newest merges the closure pass reads. A `Residue-fixed:` line a body gains AFTER
   its merge is honoured only while that PR stays inside this window — the span of the 30 newest merges
   read between 8.1 h and 8.6 h across 2026-11-09, so the life of a late line is hours, not days.
   `tools/residue-promises.mjs` imports this constant and reports every declaration that has left the
   window with its row still OPEN, so the two cannot drift. */
export const MERGED_WINDOW = 30;
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
  /* The newest `MERGED_WINDOW` merges carry the `Residue-fixed:` declarations; null (never []) when
     unreadable, so a failed read plans no closure instead of reading as "nothing merged". */
  let merged = null;
  try {
    const m = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--limit', String(MERGED_WINDOW), '--json', 'number,body,mergedAt']));
    mainMovedAtMs = m.length ? Math.max(...m.map((x) => Date.parse(x.mergedAt) || 0)) : 0;
    merged = m.map((x) => ({ number: x.number, body: x.body || '' }));
  } catch {
    mainMovedAtMs = 0;
  }
  return { prs, required: requiredContexts(), mainMovedAtMs, merged };
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
/* ── THE WALKER'S OWN CHECKOUT MUST END EVERY PASS CLEAN ───────────────────────────────────────
   Measured 2026-11-05 (board #3656, #3659): `rebase-safe` REBUILDS the generated trees, so rebasing
   a branch that moves an inlined source leaves the rebuilt bundle dirty here. The old `finally` ran
   its detach inside a bare `catch {}`, so that failure was invisible, and the unit's own
   `ExecStartPre` detach then exited 1 on every later pass. 26 passes died in 36 minutes, no green
   draft was readied fleet-wide, and the pass that would have cleaned the tree was the pass that
   could not start.

   THE GENERATED SET IS ASKED FOR, NEVER GUESSED — `rebase-safe.generatedSet()` reads it from the
   builders that own it and returns null when any of them cannot answer. A null set, an untracked
   path, or any dirty path outside the set is somebody's work, so this REFUSES and names it rather
   than discarding it (CLAUDE.md §👥.2). A refusal leaves the walker down and says which path did
   it, which is the safe side of that trade.

   🔴 ONE READER OF THE WORD GENERATED, AND IT IS `rebase-safe.classify()`. Measured 2026-11-10:
   `generatedSet()` enumerates the bundles, the orchestrators, the analysis tools and the docs paths
   each builder names, and it holds NOTHING under `provenance/`, where `classify()` answers
   `generated` by a whole-prefix rule. So the rebase rebuilt `provenance/Integrator.json`, the
   membership test here read it as somebody's work, and 108 passes refused in one day while no green
   draft was readied fleet-wide. A set and a classifier are two readings of one word, and the
   classifier is the one the rebase itself used. It fails closed on a null set and on any path that
   traverses, which is what this test needs. */
export function cleanWorktree(g, generated) {
  const rows = String(g('status', '--porcelain') || '')
    .split('\n')
    .filter((l) => l.trim());
  if (!rows.length) return 'clean';
  if (!generated) return 'refused: the generated set is unreadable, so every dirty path reads as source';
  const unquote = (p) => (/^".*"$/.test(p) ? p.slice(1, -1) : p);
  const parsed = rows.map((l) => ({ code: l.slice(0, 2), path: unquote(l.slice(3).split(' -> ').pop().trim()) }));
  // An untracked or renamed path is not restorable by `git checkout --`, so it never counts as generated.
  const restorable = (r) => !r.code.includes('?') && !r.code.includes('R') && classifyPath(r.path, generated) === 'generated';
  const other = parsed.filter((r) => !restorable(r));
  if (other.length) {
    const named = other
      .slice(0, 4)
      .map((r) => r.path)
      .join(', ');
    return `refused: ${other.length} dirty path(s) outside the generated set: ${named}`;
  }
  g('checkout', '--', ...parsed.map((r) => r.path));
  const left = String(g('status', '--porcelain') || '')
    .split('\n')
    .filter((l) => l.trim());
  if (left.length) return `still-dirty: ${left.length} path(s) survived the restore`;
  return `restored: ${parsed.length} generated path(s)`;
}

/* The message is the bird's own PR history, so it says what moved and why. */
const REBUILD_COMMIT_MSG =
  'build: rebuild the generated trees this rebase auto-resolved\n\n' +
  'rebase-safe resolved every conflicting generated path to the base, then rebuilt each\n' +
  'one from source. The rebuild is no part of the rebased commits, so this commit carries\n' +
  'it and the pushed branch holds no base-resolved artifact.\n';

/* ── THE REBUILD MUST RIDE THE PUSH ────────────────────────────────────────────────────────────
   Measured 2026-11-04 (#4369): `rebase-safe` resolves a conflict in a GENERATED path to the base,
   rebuilds every generated tree from source, and then PRINTS a `git commit --amend` line. It commits
   nothing. The pass pushed the rebase without the rebuild, so `OverDex.html` reached the branch
   carrying the base bytes while the four other carriers of the same source read the change. The
   bird's own PR then reds `build:check` for a resolution the bird never made.

   The partition is cleanWorktree's: `generatedSet()` names the rebuilt paths, and a dirty path
   outside that set is somebody's work. An untracked path IS committed here, because a rebuild adds a
   generated file and nothing restores one — which is why cleanWorktree refuses the same shape. A
   rename still refuses: no rebuild renames. A refusal returns before the push, so the branch stays
   as the bird left it. */
export function commitRebuild(g, generated) {
  const dirty = () =>
    String(g('status', '--porcelain') || '')
      .split('\n')
      .filter((l) => l.trim());
  const rows = dirty();
  if (!rows.length) return 'nothing-to-commit';
  if (!generated) return 'refused: the generated set is unreadable, so every rebuilt path reads as source';
  const unquote = (q) => (/^".*"$/.test(q) ? q.slice(1, -1) : q);
  const parsed = rows.map((l) => ({ code: l.slice(0, 2), path: unquote(l.slice(3).split(' -> ').pop().trim()) }));
  const other = parsed.filter((r) => r.code.includes('R') || classifyPath(r.path, generated) !== 'generated');
  if (other.length) {
    const named = other
      .slice(0, 4)
      .map((r) => r.path)
      .join(', ');
    return `refused: ${other.length} rebuilt path(s) outside the generated set: ${named}`;
  }
  g('add', '--', ...parsed.map((r) => r.path));
  g('commit', '-m', REBUILD_COMMIT_MSG);
  const left = dirty();
  if (left.length) return `still-dirty: ${left.length} path(s) survived the commit`;
  return `committed: ${parsed.length} generated path(s)`;
}

function rebaseBranch(a, wt) {
  const g = (...args) => sh('git', args, { cwd: wt });
  if (!wt || !existsSync(path.join(wt, '.git'))) return 'no-worktree';
  if (g('status', '--porcelain').trim()) {
    const pre = cleanWorktree(g, generatedSet());
    console.error(`pr-walker: this checkout was dirty before the pass — ${pre}`);
    if (!/^(clean|restored)/.test(pre)) return `dirty: ${pre}`;
  }
  if (!/^claude\//.test(a.branch || '')) return 'not-a-fleet-branch';
  let step = 'fetch';
  try {
    g('fetch', '-q', 'origin', 'main', a.branch);
    step = 'checkout';
    g('checkout', '-q', '--detach', `origin/${a.branch}`);
    if (g('rev-parse', 'HEAD').trim() !== a.headSha) return 'moved';
    step = 'rebase-safe';
    sh('node', ['tools/rebase-safe.mjs'], { cwd: wt });
    step = 'rebuild-commit';
    const rb = commitRebuild(g, generatedSet());
    console.error(`pr-walker: the rebuild this rebase owed — ${rb}`);
    if (!/^(nothing-to-commit|committed)/.test(rb)) return `stopped:rebuild-commit: ${rb}`;
    step = 'push';
    g('push', '-q', `--force-with-lease=${a.branch}:${a.headSha}`, 'origin', `HEAD:refs/heads/${a.branch}`);
    return `pushed:${g('rev-parse', 'HEAD').trim()}`;
  } catch (e) {
    try {
      g('rebase', '--abort');
    } catch {}
    return stepResult(step, e);
  } finally {
    /* REPORT, NEVER SWALLOW. Both halves below used to sit inside one bare `catch {}`. */
    let post = 'unexamined';
    try {
      post = cleanWorktree(g, generatedSet());
    } catch (e) {
      post = stepResult('clean', e);
    }
    if (!/^clean/.test(post)) console.error(`pr-walker: this checkout after the pass — ${post}`);
    try {
      g('checkout', '-q', '--detach', 'origin/main');
    } catch (e) {
      console.error(`pr-walker: the detach to origin/main failed — ${stepResult('detach', e)}`);
    }
  }
}

/* The closure PR is built in the walker's OWN checkout, detached at origin/main, and the checkout is
   detached back to origin/main afterwards whatever happened — the rebase step's discipline. */
export function closureCommitMessage(changed, close) {
  const by = new Map(close.map((c) => [c.key, c.number]));
  return [
    `Close ${changed.length} residue row(s) that merged PRs declared fixed`,
    '',
    ...changed.map((k) => `- ${k}: fixed #${by.get(k)}`),
    '',
    'Fleet-Session: pr-walker (unattended, tools/pr-walker.mjs)'
  ].join('\n');
}
function closeResidue(close, wt, nowMs) {
  const g = (...args) => sh('git', args, { cwd: wt });
  if (!wt || !existsSync(path.join(wt, '.git'))) return { result: 'no-worktree', changed: [] };
  if (g('status', '--porcelain').trim()) return { result: 'dirty: the walker checkout was not clean', changed: [] };
  const branch = `${CLOSE_BRANCH_PREFIX}${close[0].number}-${nowMs.toString(36).slice(-5)}`;
  let step = 'fetch';
  try {
    g('fetch', '-q', 'origin', 'main');
    step = 'checkout';
    g('checkout', '-q', '--detach', 'origin/main');
    const file = path.join(wt, 'briefs', 'RESIDUE.md');
    const r = closeRowsText(readFileSync(file, 'utf8'), close);
    if (r.refused) return { result: `refused: ${r.refused}`, changed: [] };
    if (!r.changed.length) return { result: 'nothing-to-close', changed: [] };
    writeFileSync(file, r.text);
    step = 'commit';
    g('add', '--', 'briefs/RESIDUE.md');
    g('commit', '-q', '-m', closureCommitMessage(r.changed, close));
    step = 'push';
    g('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    step = 'pr';
    const title = `Close ${r.changed.length} residue row(s) that merged PRs declared fixed`;
    const url = gh(['pr', 'create', '--draft', '--base', 'main', '--head', branch, '--title', title, '--body', closureBody(r.changed, close)]).trim();
    return { result: `opened:${url.split('/').pop()}`, changed: r.changed };
  } catch (e) {
    return { result: stepResult(step, e), changed: [] };
  } finally {
    try {
      g('checkout', '-q', '--', 'briefs/RESIDUE.md');
    } catch {}
    try {
      g('checkout', '-q', '--detach', 'origin/main');
    } catch (e) {
      console.error(`pr-walker: the detach to origin/main failed — ${stepResult('detach', e)}`);
    }
  }
}

export function act(actions, state, opts) {
  const done = [];
  /* `opts.gh` stands in for the GitHub CLI in the selftest only. */
  const run = opts.gh || gh;
  for (const a of actions) {
    let result = 'ok';
    try {
      if (opts.dryRun) result = 'dry-run';
      else if (a.op === 'ready') run(['pr', 'ready', String(a.number)]);
      else if (a.op === 'rerun') {
        /* 🔴 COUNT THE ATTEMPT BEFORE THE CALL. The counter used to follow the call, so a throw
           ("run … cannot be rerun") skipped it and the next pass retried the same head again —
           measured 2026-11-07: #4550 four failed re-runs on one head, one every pass. */
        state.reruns[a.headSha] = (state.reruns[a.headSha] || 0) + 1;
        for (const id of a.runIds) run(['run', 'rerun', id, '--failed']);
      } else if (a.op === 'rerun-all') {
        /* No `--failed`. A cancelled run has no failed jobs to re-run — see `plan`'s measurement.
           The attempt counts before the call, as in `rerun` above. */
        state.reruns[a.headSha] = (state.reruns[a.headSha] || 0) + 1;
        for (const id of a.runIds) run(['run', 'rerun', id]);
      } else if (a.op === 'rebase') {
        result = rebaseBranch(a, opts.worktree);
        state.rebased[a.headSha] = result;
      } else if (a.op === 'update') run(['pr', 'update-branch', String(a.number)]);
      else if (a.op === 'merge') run(['pr', 'merge', String(a.number), '--squash', '--match-head-commit', a.headSha]);
    } catch (e) {
      result = `failed: ${String(e.stderr || e.message || e)
        .split('\n')[0]
        .slice(0, 160)}`;
    }
    const row = { ...a, result };
    const body = opts.dryRun ? null : signature(row, opts.at || new Date().toISOString());
    if (body) {
      try {
        run(['pr', 'comment', String(a.number), '--body', body]);
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

/* ── THE JOURNAL SAYS EACH THING ONCE ──────────────────────────────────────────────────────────
   Measured 2026-11-07 over 6 h of `journalctl --user -u tepna-pr-walker.service`: 221 passes wrote
   1878 lines, and the same alert for #4503 stood in 29 of them, #4526 in 22. Every bird that reads
   the journal to learn what the walker did pays for every repeat. `landing.md` keeps the FULL page,
   because it is a state view the board renders. The journal is a change log, so it gets:
     - an alert line only the first time its (PR, kind, head) is seen, then a count of standing ones;
     - one short line for a pass whose page body, after that collapse, equals the previous pass. */
export function alertKey(al, rows) {
  const r = (rows || []).find((x) => x.number === al.number);
  return `${al.number}|${al.kind}|${(r && r.headSha) || ''}`;
}
export function freshAlerts(alerts, rows, seen) {
  const open = new Set((rows || []).map((r) => r.number));
  const next = {};
  for (const [k, v] of Object.entries(seen || {})) if (open.has(Number.parseInt(k, 10))) next[k] = v;
  const fresh = [];
  for (const al of alerts || []) {
    const k = alertKey(al, rows);
    if (!(k in next)) fresh.push(al);
    next[k] = true;
  }
  return { fresh, seen: next };
}
export function journalText(page, fresh, prevBody) {
  const keep = new Set((fresh || []).map((al) => `ALERT #${al.number} ${al.kind}: ${al.why}`));
  const lines = String(page || '')
    .split('\n')
    .filter((l) => l !== '');
  const head = lines[0] || '';
  const standing = lines.filter((l) => l.startsWith('ALERT ') && !keep.has(l)).length;
  const body = lines.slice(1).filter((l) => !l.startsWith('ALERT ') || keep.has(l));
  if (standing) body.push(`(${standing} standing alert(s) unchanged — full list in landing.md)`);
  const bodyText = body.join('\n');
  const at = (/^pr-walker pass (\S+)/.exec(head) || [])[1] || '?';
  if (prevBody != null && bodyText === prevBody) return { text: `pr-walker pass ${at} · unchanged\n`, body: bodyText };
  return { text: `${[head, ...body].join('\n')}\n`, body: bodyText };
}

/* ── A MERGED FIX CLOSES ITS OWN RESIDUE ROW ───────────────────────────────────────────────────
   Measured 2026-11-07: two of the five newest commits on main (#4528, #4524) were a bird's whole
   work unit spent editing one state cell after its fix merged. The fix PR now DECLARES the row on a
   `Residue-fixed: <key>` line in its body, and after the merge the walker opens the RESIDUE-only PR
   that writes `fixed #<that PR>`. Only the declaration counts — a key the body merely mentions closes
   nothing — and only a row that reads exactly `OPEN` on main is edited. Nothing else moves. */
export const RESIDUE_FIXED_RE = /^Residue-fixed:\s*(.+)$/gm;
export const RESIDUE_KEY_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/;
export const CLOSE_BRANCH_PREFIX = 'claude/residue-close-walker-';
export function parseResidueFixed(body) {
  const keys = [];
  for (const m of String(body || '').matchAll(RESIDUE_FIXED_RE))
    for (const k of m[1].split(/[\s,]+/).map((s) => s.replace(/`/g, '').trim())) if (RESIDUE_KEY_RE.test(k) && !keys.includes(k)) keys.push(k);
  return keys;
}
export function residueStates(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split(' | ');
    const key = cells[0].slice(2).trim();
    if (!RESIDUE_KEY_RE.test(key)) continue;
    out.set(key, cells[cells.length - 1].replace(/\s*\|\s*$/, '').trim());
  }
  return out;
}
/* The one outcome that used to be permanent AND silent. A `Residue-fixed:` line can land before the
   row does, because the fix PR and the RESIDUE-only PR that appends the row are separate PRs. The
   absent row then earned `note:no such row on main`, and only a `failed:` outcome ever retried, so
   the row stayed OPEN for good (residue `2026-11-08-a-walker-closure-note-is-permanent-and-then-silent`).
   An absent row is `absent:…@<ms>` now and comes back every `retryMin`; the legacy note heals on
   first pass. A row that reads anything but OPEN is terminal, and stays a one-time `note:`. */
const NOTE_NO_ROW = 'note:no such row on main';
/* merged: [{ number, body }]; done: { key: 'pr:<n>' | 'failed:…@<ms>' | 'absent:…@<ms>' | 'note:<why>' }.
   Returns the rows to close, a note for each declared key that cannot close (said once, never looped
   on), and every key whose row is absent this pass, which the caller re-stamps so it comes back. */
export function planClosures(merged, residueText, done, nowMs, retryMin = 60) {
  const states = residueStates(residueText);
  const close = [];
  const notes = [];
  const absent = [];
  for (const pr of merged || []) {
    for (const key of parseResidueFixed(pr.body)) {
      const d = (done || {})[key];
      if (d && !/^(failed|absent):/.test(d) && d !== NOTE_NO_ROW) continue;
      if (d && nowMs - Number(d.split('@').pop()) < retryMin * 60000) continue;
      const st = states.get(key);
      if (st === undefined) {
        if (!d) notes.push({ key, number: pr.number, why: 'no such row on main' });
        if (!absent.some((a) => a.key === key)) absent.push({ key, number: pr.number });
      } else if (st !== 'OPEN') notes.push({ key, number: pr.number, why: `row already reads ${st}` });
      else if (!close.some((c) => c.key === key)) close.push({ key, number: pr.number });
    }
  }
  return { close, notes, absent };
}
/* Edit ONLY the state cell of each named row, and refuse if any other byte would move. */
export function closeRowsText(text, close) {
  const want = new Map((close || []).map((c) => [c.key, c.number]));
  const changed = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('| ')) continue;
    const key = line.slice(2).split(' | ')[0].trim();
    if (!want.has(key) || !/ \| OPEN \|$/.test(line)) continue;
    lines[i] = line.replace(/ \| OPEN \|$/, ` | fixed #${want.get(key)} |`);
    changed.push(key);
  }
  const out = lines.join('\n');
  const before = String(text).split('\n');
  const moved = lines.filter((l, i) => l !== before[i]).length;
  if (moved !== changed.length) return { text, changed: [], refused: `${moved} line(s) moved for ${changed.length} closure(s)` };
  return { text: out, changed, refused: null };
}
export function closureBody(changed, close) {
  const by = new Map(close.map((c) => [c.key, c.number]));
  return [
    `Rule 0: no search — the walker closes rows that merged PRs declared on a \`Residue-fixed:\` line → ${[...new Set(changed.map((k) => `#${by.get(k)}`))].join(' · ')}`,
    '',
    '## What this PR does',
    '',
    'This PR edits only the state cell of each row below in `briefs/RESIDUE.md`. Each merged PR named its row on a `Residue-fixed:` line, and the row read `OPEN` on main.',
    '',
    '| row | state |',
    '|---|---|',
    ...changed.map((k) => `| \`${k}\` | \`fixed #${by.get(k)}\` |`),
    '',
    'The fix PR is the evidence for each row. Revert this PR if a fix did not discharge its row.',
    '',
    'Fleet-Session: pr-walker (unattended, tools/pr-walker.mjs)'
  ].join('\n');
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
  /* Residue closures: plan from the merged bodies against main's ledger, act only when no walker
     closure PR is already open (one RESIDUE-only closure PR in flight). */
  state.closed ||= {};
  const resLines = [];
  let led = null;
  try {
    led = sh('git', ['show', 'origin/main:briefs/RESIDUE.md'], { cwd: opts.worktree });
  } catch {
    led = null;
  }
  if (snap.merged && led) {
    const pc = planClosures(snap.merged, led, state.closed, now);
    for (const n of pc.notes) {
      resLines.push(`RESIDUE #${n.number} declared ${n.key}: ${n.why} — nothing closed`);
      if (!opts.dryRun) state.closed[n.key] = `note:${n.why}`;
    }
    /* An absent row is not a verdict: re-stamp the clock so the next pass looks again. This runs
       after the notes, so a first sight writes `absent:` and not the permanent `note:`. */
    for (const a of pc.absent || []) {
      if (!opts.dryRun) state.closed[a.key] = `absent:no such row on main@${now}`;
    }
    if (pc.close.length) {
      const inFlight = snap.prs.find((p) => (p.branch || '').startsWith(CLOSE_BRANCH_PREFIX));
      if (inFlight) resLines.push(`RESIDUE ${pc.close.length} closure(s) wait: walker closure PR #${inFlight.number} is open`);
      else if (opts.dryRun) resLines.push(`RESIDUE would close: ${pc.close.map((c) => `${c.key} → fixed #${c.number}`).join(' · ')}`);
      else {
        const cr = closeResidue(pc.close, opts.worktree, now);
        const ok = /^opened:/.test(cr.result);
        for (const c of pc.close) state.closed[c.key] = ok && cr.changed.includes(c.key) ? `pr:${cr.result.slice(7)}` : `failed:${cr.result}@${now}`;
        resLines.push(`RESIDUE closure ${pc.close.map((c) => c.key).join(', ')} → ${cr.result}`);
      }
    }
  } else resLines.push(`RESIDUE closures not planned: ${!snap.merged ? 'merged PRs unreadable' : 'main ledger unreadable'}`);
  const page =
    landingPage(rows, planned, done, {
      at: new Date(now).toISOString(),
      drift,
      requiredSource: snap.required.length ? `ruleset(${snap.required.length})` : 'UNREADABLE — the mirror plus every reported check'
    }) + resLines.map((l) => `${l}\n`).join('');
  const fa = freshAlerts(planned.alerts, rows, state.alertSeen);
  const jt = journalText(page, fa.fresh, state.journalBody);
  if (!opts.dryRun) {
    state.alertSeen = fa.seen;
    state.journalBody = jt.body;
    saveState(state);
    try {
      mkdirSync(BOARD_DIR, { recursive: true });
      writeFileSync(path.join(BOARD_DIR, 'landing.md'), page);
    } catch {}
  }
  if (opts.json) console.log(JSON.stringify({ at: now, rows, actions: done, alerts: planned.alerts, drift, residue: resLines }));
  else process.stdout.write(opts.dryRun ? page : jt.text);
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
  /* ── cleanWorktree: what it restores, and what it refuses to touch ── */
  const fakeGit = (before, after) => {
    const calls = [];
    let cur = before;
    const g = (...args) => {
      calls.push(args.join(' '));
      if (args[0] === 'status') return cur.join('\n');
      if (args[0] === 'checkout' || args[0] === 'commit') {
        cur = after || [];
        return '';
      }
      return '';
    };
    g.calls = calls;
    return g;
  };
  const GEN = new Set(['PAT Feasibility.html', 'OxyDex.html', 'docs/TOOLS-INDEX.md']);
  const g1 = fakeGit([]);
  eq(cleanWorktree(g1, GEN), 'clean', 'an undirtied checkout needs no restore');
  eq(
    g1.calls.some((c) => c.startsWith('checkout')),
    false,
    'a clean checkout is never checked out'
  );
  const g2 = fakeGit([' M "PAT Feasibility.html"', ' M OxyDex.html']);
  eq(cleanWorktree(g2, GEN), 'restored: 2 generated path(s)', 'two dirty generated paths are restored');
  eq(g2.calls.includes('checkout -- PAT Feasibility.html OxyDex.html'), true, 'the restore is quoted out and passed by path');
  const g3 = fakeGit([' M ecgdex-dsp.js']);
  eq(cleanWorktree(g3, GEN), 'refused: 1 dirty path(s) outside the generated set: ecgdex-dsp.js', 'a dirty source file is refused by name');
  eq(
    g3.calls.some((c) => c.startsWith('checkout')),
    false,
    'a refusal discards nothing'
  );
  const g4 = fakeGit([' M OxyDex.html', ' M tests/dex-tests.js']);
  eq(/^refused: 1 /.test(cleanWorktree(g4, GEN)), true, 'one source path among generated ones refuses the whole set');
  eq(
    g4.calls.some((c) => c.startsWith('checkout')),
    false,
    'a mixed tree is not partly restored'
  );
  const g5 = fakeGit(['?? OxyDex.html']);
  eq(/^refused: /.test(cleanWorktree(g5, GEN)), true, 'an untracked path is refused — a restore cannot restore it');
  const g6 = fakeGit([' M OxyDex.html']);
  eq(cleanWorktree(g6, null), 'refused: the generated set is unreadable, so every dirty path reads as source', 'an unreadable builder list fails closed');
  eq(
    g6.calls.some((c) => c.startsWith('checkout')),
    false,
    'a fail-closed set discards nothing'
  );
  const g7 = fakeGit([' M OxyDex.html'], [' M OxyDex.html']);
  eq(cleanWorktree(g7, GEN), 'still-dirty: 1 path(s) survived the restore', 'a restore that changed nothing says so rather than reading clean');
  const g8 = fakeGit(['R  old.html -> "PAT Feasibility.html"']);
  eq(/^refused: /.test(cleanWorktree(g8, GEN)), true, 'a rename into a generated path is refused, not restored');
  /* 🔴 THE MEASURED WEDGE, 2026-11-10. A rebase rebuilds `provenance/<App>.json`, and no builder
     list names a path under `provenance/`, so exact membership read the fragment as somebody's work
     and refused. `rebase-safe.classify()` answers it `generated` by prefix, and it is the reader the
     rebase itself used. 108 passes refused in one day over the three paths of this first case. */
  const WEDGE = new Set([...GEN, 'Integrator.html', 'docs/Integrator.html']);
  const g9 = fakeGit([' M Integrator.html', ' M docs/Integrator.html', ' M provenance/Integrator.json']);
  eq(cleanWorktree(g9, WEDGE), 'restored: 3 generated path(s)', 'the three paths that wedged the walker are restored');
  const g10 = fakeGit([' M provenance/Integrator.json']);
  eq(cleanWorktree(g10, GEN), 'restored: 1 generated path(s)', 'a provenance fragment is generated by prefix');
  eq(GEN.has('provenance/Integrator.json'), false, 'and no builder list holds that path, so membership alone refuses it');
  const g11 = fakeGit([' M provenance/../oxydex-dsp.js']);
  eq(/^refused: /.test(cleanWorktree(g11, GEN)), true, 'a path that traverses out of provenance/ is source, so it is still refused');
  /* ── commitRebuild: the rebuild rides the push, or nothing is pushed ── */
  const c1 = fakeGit([]);
  eq(commitRebuild(c1, GEN), 'nothing-to-commit', 'a rebase that moved no artifact commits nothing');
  eq(
    c1.calls.some((c) => c.startsWith('commit')),
    false,
    'a clean tree is never committed'
  );
  const c2 = fakeGit([' M "PAT Feasibility.html"', ' M OxyDex.html']);
  eq(commitRebuild(c2, GEN), 'committed: 2 generated path(s)', 'two rebuilt bundles ride the push');
  eq(c2.calls.includes('add -- PAT Feasibility.html OxyDex.html'), true, 'the add is quoted out and passed by path');
  eq(
    c2.calls.some((c) => c.startsWith('commit -m build: rebuild')),
    true,
    'the commit names itself as the rebuild'
  );
  const c3 = fakeGit(['?? docs/TOOLS-INDEX.md']);
  eq(commitRebuild(c3, GEN), 'committed: 1 generated path(s)', 'an untracked generated path is committed — a rebuild adds one');
  const c4 = fakeGit([' M ecgdex-dsp.js']);
  eq(commitRebuild(c4, GEN), 'refused: 1 rebuilt path(s) outside the generated set: ecgdex-dsp.js', 'a dirty source file is refused by name');
  const cProv = fakeGit(['?? provenance/MotionDex.json']);
  eq(commitRebuild(cProv, GEN), 'committed: 1 generated path(s)', 'an untracked provenance fragment rides the push — a rebuild writes one');
  eq(
    c4.calls.some((c) => c.startsWith('commit')),
    false,
    'a refusal commits nothing'
  );
  const c5 = fakeGit([' M OxyDex.html', ' M tests/dex-tests.js']);
  eq(/^refused: 1 /.test(commitRebuild(c5, GEN)), true, 'one source path among rebuilt ones refuses the whole set');
  const c6 = fakeGit([' M OxyDex.html']);
  eq(commitRebuild(c6, null), 'refused: the generated set is unreadable, so every rebuilt path reads as source', 'an unreadable builder list fails closed');
  const c7 = fakeGit(['R  old.html -> "PAT Feasibility.html"']);
  eq(/^refused: /.test(commitRebuild(c7, GEN)), true, 'a rename into a generated path is refused — no rebuild renames');
  const c8 = fakeGit([' M OxyDex.html'], [' M OxyDex.html']);
  eq(commitRebuild(c8, GEN), 'still-dirty: 1 path(s) survived the commit', 'a commit that left the path dirty says so rather than reading committed');
  {
    /* A re-run that THROWS still spends the head's one re-run, so the next pass alerts, not retries. */
    const sha = 'f'.repeat(40);
    const red = classify(mk({ isDraft: false, headSha: sha, checks: [{ name: 'test', bucket: 'fail', link: 'https://github.com/x/y/actions/runs/42/job/7' }, G[1]] }), req);
    const st = { reruns: {}, rebased: {} };
    const calls = [];
    const throwing = (args) => {
      calls.push(args.join(' '));
      throw new Error('run 42 cannot be rerun');
    };
    const first = plan([red], st, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
    eq(first.actions.map((a) => a.op).join(','), 'rerun', 'red head plans one rerun');
    const done = act(first.actions, st, { gh: throwing, at: '2026-11-07T00:00:00Z' });
    eq(/^failed: run 42 cannot be rerun/.test(done[0].result), true, 'the throw is reported as failed');
    eq(st.reruns[sha], 1, 'a failed rerun still counts against the head');
    eq(calls.length, 1, 'no signature comment for a failed rerun');
    const second = plan([red], st, { nowMs: 0, mainMovedAtMs: 0, cap: 4 });
    eq(second.actions.length, 0, 'second pass on the same head plans no rerun');
    eq(second.alerts.map((a) => a.kind).join(','), 'red', 'second pass hands the red to a coder');
  }
  console.log(`all ${ran} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  if (flag('--selftest')) selftest();
  else if (flag('--print-install')) console.log(installText());
  else if (flag('--clean-worktree')) {
    /* The unit's own pre-step calls this, so one dirty generated file can never again stop the pass
       that would have cleaned it. A refusal exits 1 and names the path it would not discard. */
    const wt = val('--worktree', process.cwd());
    const g = (...args) => sh('git', args, { cwd: wt });
    const r = cleanWorktree(g, generatedSet());
    console.log(`clean-worktree: ${r}`);
    if (!/^(clean|restored)/.test(r)) process.exit(1);
  } else {
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
