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
 *   held · conflict · red · pending · stuck · unknown · green
 * and plan actions from the classification alone:
 *   ready   a green draft is marked ready while fewer than CAP (4, CLAUDE.md §👥.5) are out of draft,
 *           oldest number first
 *   rerun   a PR red on a REQUIRED check gets its failed jobs re-run ONCE per head SHA; red again is
 *           a coder's, and the walker says so instead of looping
 *   rebase  a conflicting PR is rebased with `tools/rebase-safe.mjs` in the walker's OWN worktree and
 *           pushed with `--force-with-lease` against the SHA it observed, ONCE per head SHA; a
 *           source-file conflict stops rebase-safe, and the walker reports "hand rebase" and moves on
 *   update  a green non-draft PR BEHIND main while Kodiak has been quiet for KODIAK_IDLE_MIN is
 *           updated (`gh pr update-branch`), one per pass — queue-doctor's rule, same reason
 *   merge   a green, current, non-draft PR Kodiak has left for KODIAK_IDLE_MIN is merged by SHA
 *   alert   stuck, red-after-rerun, hand-rebase and a required check pending over STALE_PENDING_MIN
 *           are written to the landing page the board shows and to the journal
 * A `do-not-merge` label HOLDS a PR: the walker never readies, reruns, rebases or merges it. It still
 * UPDATES a held PR that falls BEHIND main, at once and with no idleness gate, because Kodiak never
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
  const base = { number: pr.number, draft: !!pr.isDraft, headSha: pr.headSha, branch: pr.branch, updatedAtMs: pr.updatedAtMs || 0, behind: pr.mergeState === 'BEHIND', failed: [], runIds: [] };
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
         held PR that CONFLICTS is not BEHIND (update-branch cannot merge it) and stays untouched. */
      if (r.behind && !actions.some((a) => a.op === 'update')) actions.push({ op: 'update', number: r.number, why: 'held, behind main — updated so the owner can merge' });
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
    if (r.state === 'conflict') {
      const st = (state.rebased || {})[r.headSha];
      if (!st) actions.push({ op: 'rebase', number: r.number, headSha: r.headSha, branch: r.branch, why: 'conflicts with main — rebase-safe once' });
      else alerts.push({ number: r.number, kind: 'hand-rebase', why: `rebase-safe ${st} on ${String(r.headSha).slice(0, 9)} — rebase by hand` });
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
   refuses a dirty tree and stops on a source conflict; both leave the branch untouched upstream. */
function rebaseBranch(a, wt) {
  const g = (...args) => sh('git', args, { cwd: wt });
  if (!wt || !existsSync(path.join(wt, '.git'))) return 'no-worktree';
  if (g('status', '--porcelain').trim()) return 'dirty';
  if (!/^claude\//.test(a.branch || '')) return 'not-a-fleet-branch';
  try {
    g('fetch', '-q', 'origin', 'main', a.branch);
    g('checkout', '-q', '-B', a.branch, `origin/${a.branch}`);
    if (g('rev-parse', 'HEAD').trim() !== a.headSha) return 'moved';
    sh('node', ['tools/rebase-safe.mjs'], { cwd: wt });
    g('push', '-q', `--force-with-lease=${a.branch}:${a.headSha}`, 'origin', a.branch);
    return `pushed:${g('rev-parse', 'HEAD').trim()}`;
  } catch {
    try {
      g('rebase', '--abort');
    } catch {}
    return 'stopped';
  } finally {
    try {
      g('checkout', '-q', '--detach', 'origin/main');
      g('branch', '-q', '-D', a.branch);
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
    done.push({ ...a, result });
  }
  return done;
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
  L.push(`actions: ${done.length ? done.map((d) => `${d.op} #${d.number} → ${d.result}`).join(' · ') : 'none'}`);
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
  const done = act(planned.actions, state, opts);
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
