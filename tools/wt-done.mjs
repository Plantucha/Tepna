/*
 * wt-done.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLOSE THE WORKTREE LOOP. `git worktree add` is cheap and correct, and the REMOVAL is the half that
 * gets skipped — the PR merging feels like the end of the work-unit, and it is not. Measured
 * 2026-08-18: 329 worktrees registered, 0 prunable (every registration had a live directory), ~288
 * siblings at the volume root ≈ 55–60 GB on a drive at 90 %. Every one of them is that gap, accumulated.
 *
 * The tool verifies the two facts a removal must rest on, FROM THE AUTHORITATIVE SOURCES, then removes:
 *   1. the branch's PR is MERGED — read from GitHub via `gh`, never from memory or `git branch --merged`
 *      (squash-merge strands the branch: after `gh pr merge` the branch never appears merged to git —
 *      see the 12-commits-stranded incident). No PR, or PR still open ⇒ REFUSE — except `--pushed`
 *      (2026-09-26): a PR-less branch whose every local commit is contained in a freshly fetched
 *      origin/<branch> may go, because the branch is the copy — or whose HEAD is contained in origin/main
 *      (no commits of its own: nothing to land); a CLOSED-unmerged PR with the same containment proof
 *      may go too (the branch on origin is the copy; the branch itself is never deleted). OPEN stays.
 *   2. the tree is CLEAN — `git status --porcelain` empty. Dirty ⇒ REFUSE and say what is dirty;
 *      per CLAUDE.md §👥.2 those files may be someone's only copy.
 *   3. the tree is IDLE — no process has its cwd inside it and none holds a file open there.
 *      MERGED + CLEAN DOES NOT MEAN IDLE, and that gap was nearly paid for: on 2026-09-07 a sweep of
 *      ten merged, clean trees included one where a peer had said 40 minutes earlier that a ~16-minute
 *      gate was running. It had finished, so nothing was lost — but every guard the tool had read
 *      green, and removing a tree out from under a live run destroys the run silently.
 * Removal is `git worktree remove` WITHOUT --force, so git's own guard stays the last line: if git
 * refuses after both checks passed, something raced us — stop, do not escalate to --force.
 *
 * Usage:
 *   node tools/wt-done.mjs --list            # read-only: every worktree, branch, PR state, dirty count
 *   node tools/wt-done.mjs <path> [...]      # verify + remove each named worktree
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';

/* ONE spec, read twice: the guard refuses an undeclared flag with it, and `positionalArgs`
   skips each valued flag's VALUE with it, so a flag written before the positional cannot be
   mistaken for the positional (residue `2026-10-21-a-dash-test-picker-takes-a-valued-flags-value`). */
const ARGV_SPEC = { valued: ['--pr'], boolean: ['--list', '--pushed', '--landed', '--selftest'], positional: true };

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/* THE TOOL KNOWS WHERE IT LIVES (row 2026-10-12-wt-done-resolves-the-repo-from-the-shell-cwd). The two
   repo-level git calls (`worktree list`, `worktree remove`) used to read the SHELL's cwd, so an
   invocation by absolute path from outside any repository died in a node stack trace. They now name the
   repository this file belongs to with `-C`; every per-tree call already did, through the tree's path. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseWorktrees(porcelain) {
  /* `git worktree list --porcelain` → [{path, branch}] — branch null for detached/bare. */
  const out = [];
  let cur = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice(9), branch: null };
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* WHO IS USING THIS TREE — by `/proc` inspection, NEVER by matching a command line.

   ⚠️ A COMMAND-LINE GREP CANNOT ANSWER THIS QUESTION. The scanner's own argv contains the path it is
   scanning, so it always matches itself: measured 2026-09-07, `pgrep -af <path>` exited 0 with its
   only hit being the scanning shell. CLAUDE.md §4 documents that self-match as a waiter that hangs
   forever; wired as a GUARD the same defect inverts — it refuses on nothing — so the fail-safe
   direction depends entirely on which way the check is pointed, and neither direction is correct.
   `/proc/<pid>/cwd` and `/proc/<pid>/fd/*` are readlinks to real kernel state and cannot self-match.

   Returns `{ ok:true, users:[{pid, cmd}] }`, or `{ ok:false, why }` when the scan could not be made —
   which is UNKNOWN, not idle. An absence of evidence spent as evidence of absence is the shape that
   makes a missing tool read as a passing gate. */
/* THE INVOCATION IS NOT A USER. `self` alone is not enough: the scanner's own CALLER — a shell that
   `cd`'d into the worktree to run this tool from inside it — has `/proc/<pid>/cwd` under the target and
   was reported as a user, so the removal was refused by the act of asking. Measured 2026-09-11 running
   the scanner with cwd = the target: it correctly skipped itself and flagged BOTH its parent shell and
   a SIBLING in the same pipeline (`… | tail -3`), which is one process wider than the residue row
   described.
   So the exclusion is the scanner's ANCESTOR CHAIN plus its PROCESS GROUP: a parent is the invocation
   by definition, and a same-pgid sibling is the same shell job. Both are "this command", not a tenant.
   ⚠️ It is deliberately NOT "same session" or "same user" — a peer session working in the tree has its
   own pgid and its own ancestry, and must still refuse. Narrow the exemption to the invocation or it
   stops being a guard. */
function invocationPids(procRoot, self) {
  const skip = new Set([self]);
  const statOf = (pid) => {
    try {
      return readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    } catch {
      return null;
    }
  };
  /* `comm` can contain spaces and parentheses, so ppid/pgid are read AFTER the final ')' — parsing
     from the left breaks on a process named `(tail -3)`. */
  const fields = (raw) => (raw ? raw.slice(raw.lastIndexOf(')') + 2).split(' ') : null);
  const own = fields(statOf(self));
  const ownPgid = own ? own[2] : null;
  // ancestors: walk ppid to init, bounded so a cycle cannot hang the scan
  let cur = self;
  for (let hop = 0; hop < 64; hop++) {
    const f = fields(statOf(cur));
    if (!f) break;
    const ppid = Number(f[1]);
    if (!ppid || ppid === cur || skip.has(ppid)) break;
    skip.add(ppid);
    cur = ppid;
  }
  return { skip, ownPgid, fields, statOf };
}

export function usersOfPath(dir, { procRoot = '/proc', self = process.pid } = {}) {
  const { skip, ownPgid, fields, statOf } = invocationPids(procRoot, self);
  let pids;
  try {
    pids = readdirSync(procRoot).filter((d) => /^\d+$/.test(d));
  } catch (e) {
    return { ok: false, why: `cannot read ${procRoot} (${e.code || e.message}) — the tree may be in use` };
  }
  const root = path.resolve(dir);
  const prefix = root + path.sep;
  const under = (t) => t === root || t.startsWith(prefix);
  const users = [];
  for (const pid of pids) {
    if (skip.has(Number(pid))) continue; // the scanner or one of its ancestors — the invocation
    if (ownPgid !== null) {
      const f = fields(statOf(pid));
      if (f && f[2] === ownPgid) continue; // same shell job (a pipeline sibling), not a tenant
    }
    let hit = false;
    try {
      hit = under(readlinkSync(`${procRoot}/${pid}/cwd`));
    } catch {
      continue; // process exited mid-scan, or is another user's
    }
    if (!hit) {
      try {
        for (const fd of readdirSync(`${procRoot}/${pid}/fd`)) {
          let tgt;
          try {
            tgt = readlinkSync(`${procRoot}/${pid}/fd/${fd}`);
          } catch {
            continue;
          }
          if (under(tgt)) {
            hit = true;
            break;
          }
        }
      } catch {
        /* fd dir unreadable — cwd was already checked, which is the load-bearing half */
      }
    }
    if (hit) users.push({ pid: Number(pid), cmd: cmdlineOf(pid, procRoot) });
  }
  return { ok: true, users };
}

function cmdlineOf(pid, procRoot = '/proc') {
  /* The refusal must NAME the process. "Tree in use" sends the next session hunting; "in use by PID
     12345 running check.sh" ends the question in one line. */
  try {
    const raw = readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    return raw ? raw.slice(0, 120) : '(no cmdline)';
  } catch {
    return '(unreadable)';
  }
}

export function verdict({ prState, dirtyCount, isMain, inUse, unlanded, pushed, landless, landedElsewhere }) {
  /* Pure decision core, so the refusals are testable without a repo. `inUse` is the result of
     `usersOfPath`: omitted entirely means the caller did not scan (older callers keep working);
     `{ok:false}` means the scan FAILED, which refuses — unknown is not idle. */
  if (isMain) return { ok: false, why: 'holds main/master — never remove the primary checkout' };
  if (dirtyCount > 0) return { ok: false, why: `${dirtyCount} dirty/untracked path(s) — may be someone's only copy` };
  /* --pushed (2026-09-26): a tree whose branch has NO PR but whose every local commit is CONTAINED in
     origin/<branch> loses nothing on removal — the branch is the copy. This is the state measurement
     trees and WIP branches sit in (three of Heron's, ~1.5 GB, refused for want of a PR). `pushed` is
     the result of that containment check, computed by the caller only when the flag is given; it
     applies ONLY when there is no PR — an OPEN PR's tree stays (its fixes may still be made here),
     and a MERGED PR keeps the stricter post-merge scan below. Absent flag ⇒ unchanged refusal. */
  /* A CLOSED (not merged) PR is the same proof one step on: the branch carried the work to origin and
     the PR was declined, so the TREE is not the only copy — remove it, never the branch (dropping an
     abandoned branch is the owner's call). OPEN stays out: its fixes may still be made here. */
  if ((prState === null || prState === 'CLOSED') && pushed) {
    if (pushed.ok === false) return { ok: false, why: `no PR, and cannot prove the branch is on origin: ${pushed.why}` };
    if (pushed.ok === true) {
      if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
      if (inUse && inUse.users && inUse.users.length) {
        const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
        return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
      }
      return { ok: true, why: `${prState === 'CLOSED' ? 'PR closed unmerged' : 'no PR'}; every commit is on ${pushed.remote} + tree clean` + (inUse ? ' + idle' : '') };
    }
  }
  /* ── A TREE THAT HOLDS NOTHING NEEDS NO FLAG (2026-09-28) ────────────────────────────────────────
     `landless` is `pushedFor`'s answer computed REGARDLESS of --pushed — the same one decision path, not
     a twin. Only its `empty` kind is honoured here: 0 commits of its own means a removal cannot be the
     last copy of anything, so there is no judgement to opt into. `contained` stays behind the flag,
     because trading a tree for a copy on origin IS a judgement.
     ⚠️ WHY THIS EXISTS, and it is a naming defect rather than a missing capability: `pushedFor` has
     handled the empty case since 2026-09-26 (Heron, wt-qcstall-hrn) — but the flag is named for the
     WEAKER of its two cases, and the refusal below used to hint `--pushed` at every PR-less tree. On
     2026-09-28 that hint sent a session and its coordinator to remove an empty worktree BY HAND, five
     commands and an escalation, because the branch had never been pushed so the hint read as "not your
     case". The capability was complete and its description was wrong. A hint that excludes the case it
     solves is worse than no hint, so the refusal now NAMES WHAT IT MEASURED and offers the flag only to
     a tree the flag can actually help. */
  if (prState === null && landless && landless.ok === true && landless.kind === 'empty') {
    if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
    if (inUse && inUse.users && inUse.users.length) {
      const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
      return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
    }
    return {
      ok: true,
      why: `no PR and nothing to land — 0 commits ahead of origin/main, tree clean, ${landless.remoteRef ? 'branch on origin' : 'no branch on origin'}` + (inUse ? ' + idle' : '')
    };
  }
  /* ── THE WORK IS ON MAIN UNDER ANOTHER NAME (--landed) ───────────────────────────────────────
     Opt-in, like --pushed, and for the same reason: trading a tree for a copy elsewhere is a
     judgement. This clause is the PR-LESS case — `--pr` already covers a renamed branch whose new
     name is a prefix of the old, and an OPEN PR's tree stays whatever the flag says, because its
     fixes may still be made here. What is left is the case all three refuse: a branch rebuilt under
     an unrelated name. The same proof is read once more further down, for a MERGED PR whose
     post-merge commit count would otherwise refuse. */
  if (prState === null && landedElsewhere) {
    if (landedElsewhere.ok === false) return { ok: false, why: `no PR for this branch, and ${landedElsewhere.why}` };
    if (landedElsewhere.ok === true) {
      if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
      if (inUse && inUse.users && inUse.users.length) {
        const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
        return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
      }
      return { ok: true, why: `no PR for this branch; ${landedElsewhere.why} + tree clean` + (inUse ? ' + idle' : '') };
    }
  }
  if (prState === null) {
    /* NAME THE STATE THAT WAS MEASURED. "cannot prove the work landed" alone does not say what work, and
       the flag hint is only true for a branch that IS on origin. */
    const st = landless && typeof landless.commitsAhead === 'number' ? ` (${landless.commitsAhead} commit(s) ahead of origin/main; branch ${landless.remoteRef ? 'is' : 'is not'} on origin)` : '';
    /* OFFER A FLAG ONLY TO A TREE IT CAN HELP — the 2026-09-28 lesson, applied to the second flag:
       `--landed` is useless for a branch with nothing of its own and is the only answer for one whose
       commits exist nowhere on origin under this name. */
    const hint = landless && landless.remoteRef ? ' — a pushed, PR-less branch: --pushed' : landless && landless.commitsAhead > 0 ? ' — work landed under another branch name: --landed' : '';
    return { ok: false, why: `no PR found for branch — cannot prove the work landed${st}${hint}` };
  }
  if (prState !== 'MERGED') return { ok: false, why: `PR is ${prState}, not MERGED` };
  /* MERGED answers "did a PR from this branch merge", NOT "is every commit on this branch landed",
     and under squash nothing in the graph distinguishes them (row 2026-09-22-wt-done-merged-is-not-landed).
     `unlanded` supplies the missing question. Omitted ⇒ older callers unchanged. */
  if (unlanded && unlanded.ok === false) return { ok: false, why: `cannot prove every commit landed: ${unlanded.why}` };
  /* ── A DATE IS NOT THE CONTENT QUESTION (row 2026-10-12-wt-done-tests-the-date-not-the-content) ──
     The scan above counts commits STAMPED after the merge, and that count refused four reclaimable
     trees of mine on 2026-10-12 — two of them over commits that change zero files (`cd5df27e`,
     `8956b879`, both CI re-triggers). No flag overrode it: `--pr` answers which PR to read and
     `--pushed` answers a PR-less branch, so the only remaining move was removing the tree by hand.
     `--landed` now answers it with the content, and it is a DIFFERENT instrument from the content
     residual this file's own comment records as discarded: the residual asks whether the branch's
     touched paths still differ from main, which a moving base makes non-empty 18 times in 20; the
     identifier proof asks whether every identifier the branch ADDED is on main, and a moving base
     cannot take an added identifier away. The count stays in the message — it is what prompted the
     question — but it no longer decides, and without the flag nothing changes. */
  if (unlanded && unlanded.count > 0) {
    if (!landedElsewhere)
      return {
        ok: false,
        why: `${unlanded.count} commit(s) dated after the PR merged — work continued here and did not land; open a PR for them or move them to a branch before removing — or prove the content landed: --landed`
      };
    if (landedElsewhere.ok !== true) return { ok: false, why: `${unlanded.count} commit(s) dated after the PR merged, and ${landedElsewhere.why}` };
  }
  if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
  if (inUse && inUse.users && inUse.users.length) {
    const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
    return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
  }
  const dated = unlanded && unlanded.count > 0 ? ` + ${unlanded.count} commit(s) dated after it, ${landedElsewhere.why}` : unlanded ? ' + every commit landed' : '';
  return { ok: true, why: (inUse ? 'PR merged + tree clean + idle' : 'PR merged + tree clean') + dated };
}

/* A RETRIED BRANCH CARRIES ITS PREDECESSOR'S NAME AS A PREFIX, and that is what makes `--pr` PROOF
   rather than an override (row 2026-09-23-wt-done-cannot-be-told-the-pr-landed). Measured case:
   `claude/p3-w2-gap-counters-hrn-v2` holds the work of PR #2627, merged as
   `claude/p3-w2-gap-counters-hrn` — the tool looks PRs up by branch name, finds none, and refuses
   with `no PR found for branch`, which `--force` deliberately does not override.
   `--pr` does not weaken any check: the PR must still be MERGED, the tree still clean and idle, and
   the post-merge commit scan still runs against THAT PR's merge time. All the flag supplies is which
   PR to read, and this relation is what stops an unrelated number being accepted.
   MIN_RELATED_CHARS exists because every branch here begins `claude/` (7 chars): without a floor the
   shared stem alone could satisfy a prefix test on a short enough name. */
const MIN_RELATED_CHARS = 12;
export function namesRelated(branch, prHead) {
  if (!branch || !prHead) return false;
  const [shortName, longName] = branch.length <= prHead.length ? [branch, prHead] : [prHead, branch];
  if (shortName.length < MIN_RELATED_CHARS) return false;
  return longName.startsWith(shortName);
}

function prByNumber(num) {
  try {
    const js = JSON.parse(run('gh', ['pr', 'view', String(num), '--json', 'state,mergedAt,headRefName']));
    return { state: js.state ?? null, mergedAt: js.mergedAt || null, headRefName: js.headRefName ?? null };
  } catch {
    return { state: null, mergedAt: null, headRefName: null };
  }
}

function prFor(branch) {
  if (!branch) return { state: null, mergedAt: null };
  try {
    const js = JSON.parse(run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state,mergedAt', '--limit', '1']));
    return js.length ? { state: js[0].state, mergedAt: js[0].mergedAt || null } : { state: null, mergedAt: null };
  } catch {
    return { state: null, mergedAt: null }; // gh unavailable / offline reads as "cannot prove" → refuse, never as "merged"
  }
}

/* COMMITS DATED AFTER THE MERGE, which is the one signal that survived measurement. Two cheaper
   candidates were measured on the 20 merged worktrees present on this box, 2026-09-23, and BOTH
   were discarded — recorded here so they are not re-attempted:
     · PR headRefOid ancestry — the oid is ABSENT from this object store in 8 of 12 merged cases
       (Kodiak's base-update commits are never fetched), so refusing on "cannot prove" would block
       two thirds of legitimate reclaims.
     · content residual on the branch's touched paths — 18 of 20 merged branches show a non-empty
       residual, because `main` moves on those same paths after the merge. It cannot tell unlanded
       work from a moving base.
   Commit date is local, needs no remote object, and read 0 on all 20 (no false positives); the
   `--since` mechanism itself was positive-controlled at 91 commits over a one-day window, so the
   zeros are a measurement rather than a broken query. Its residual blind spot is a commit made
   BEFORE the merge yet left out of the PR — the tool catches NONE of these today, so this is
   strictly an improvement, never a proof. */
function unlandedFor(wtPath, mergedAt) {
  if (!mergedAt) return { ok: false, why: 'no merge timestamp from gh' };
  try {
    const n = Number(run('git', ['-C', wtPath, 'rev-list', '--count', '--since', mergedAt, 'HEAD']).trim());
    if (!Number.isFinite(n)) return { ok: false, why: 'rev-list returned no count' };
    return { ok: true, count: n };
  } catch {
    return { ok: false, why: 'rev-list failed' };
  }
}

/* --pushed proof: every local commit of the worktree's branch is contained in origin/<branch>, read
   from a FRESH fetch of that one branch (never from a stale remote-tracking ref). Detached ⇒ cannot
   prove; a fetch failure ⇒ cannot prove; the tip not an ancestor ⇒ commits exist only here. */
function pushedFor(wtPath, branch) {
  /* Strongest case first (Heron, 2026-09-26, wt-qcstall-hrn): a branch with NO commits of its own —
     HEAD contained in a freshly fetched origin/main — has nothing to land and nothing to prove; the
     tree was a measurement bench. Checked before the branch fetch so it holds for a branch that was
     never pushed and even for a detached HEAD sitting on main. */
  /* THE TWO CASES ARE NOT THE SAME TRADE, so they are labelled. `empty` LOSES NOTHING — there are no
     commits, so there is nothing a removal could be the last copy of. `contained` trades a tree for a
     copy on origin, which is a judgement and stays opt-in behind --pushed. The caller reads `kind`; it
     is the reason the no-flag path can be a caller of this function rather than a twin of it.
     `remoteRef` and `commitsAhead` are published for the REFUSAL TEXT: a refusal that names the state
     it measured is what was missing (see the header note on the flag's name). */
  let remoteRef = false;
  if (branch) {
    try {
      remoteRef = run('git', ['ls-remote', '--heads', 'origin', branch]).trim().length > 0;
    } catch {
      remoteRef = false;
    }
  }
  /* MEASURE FIRST, DECIDE AFTER — and measure on EVERY path, because the refusal quotes these numbers.
     A first cut computed `commitsAhead` only inside the success branch, so the commonest refusal (a
     local branch with commits, never pushed) printed no state at all: exactly the uninformative message
     this change exists to remove, reintroduced one level down. Caught by running it, not by reading it. */
  let commitsAhead = null;
  try {
    run('git', ['-C', wtPath, 'fetch', '-q', 'origin', 'main']);
    commitsAhead = Number(run('git', ['-C', wtPath, 'rev-list', '--count', 'refs/remotes/origin/main..HEAD']).trim());
    if (!Number.isFinite(commitsAhead)) commitsAhead = null;
  } catch {
    commitsAhead = null; // cannot reach origin/main — the refusal says so rather than guessing 0
  }
  if (commitsAhead === 0) return { ok: true, kind: 'empty', remote: 'origin/main (no commits of its own)', commitsAhead, remoteRef };
  if (!branch) return { ok: false, why: 'detached HEAD not on origin/main — no branch to compare with origin', remoteRef, commitsAhead };
  try {
    run('git', ['-C', wtPath, 'fetch', '-q', 'origin', branch]);
  } catch (e) {
    return { ok: false, why: `fetch origin ${branch} failed (${String(e.message || e).split('\n')[0]}) — the branch is not on origin`, remoteRef, commitsAhead };
  }
  try {
    run('git', ['-C', wtPath, 'merge-base', '--is-ancestor', 'HEAD', `refs/remotes/origin/${branch}`]);
  } catch {
    return { ok: false, why: `local HEAD is not contained in origin/${branch} — commits exist only in this tree`, remoteRef, commitsAhead };
  }
  return { ok: true, kind: 'contained', remote: `origin/${branch}`, remoteRef, commitsAhead };
}
/* ── A BRANCH NAME IS NOT THE WORK (row 2026-09-28-wt-done-cannot-retire-a-worktree-whose-branch-was-rebuilt)
   Measured: `wt-ringwit-hrn` held `claude/ring-stall-witness-hrn`, abandoned before being pushed and
   rebuilt as `claude/ring-stall-witness2-hrn`, which landed as #3168. The tool refused three ways and
   every answer was RIGHT — "no PR found for branch", "the branch is not on origin", "#3168 merged as
   '…witness2-hrn', which is not a rename of '…witness-hrn'". None of them can express "this work is on
   main under another name", so the tree stayed on a volume at 89 % until someone removed it by hand.
   ⚠️ BYTE-IDENTITY OF THE TOUCHED FILES IS TOO STRICT, measured on that very case: 2 of its 3 files
   differ because what landed is a LATER revision of the same work (post-format, post-survivor-drain)
   and only the changeset matched byte-for-byte. The checkable property is weaker and still sufficient:
   every IDENTIFIER the branch's commits added is present on the base. */
const MIN_LANDED_IDS = 3;
/**
 * Identifier-shaped tokens a unified diff ADDS. Not words: a token must be ≥6 chars and carry an
 * underscore or an inner capital, which is what separates `witness_judges` and `RING_WITNESS_TOL_S`
 * from the English in a comment. Prose tokens would make the check either vacuous (nothing to find) or
 * unsatisfiable (a comment word absent from main), and both failures read as a verdict.
 */
export function addedIdentifiers(diffText) {
  const ids = new Set();
  for (const line of String(diffText || '').split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const m of line.slice(1).matchAll(/[A-Za-z_][A-Za-z0-9_]{5,}/g)) {
      const tok = m[0];
      if (!/_/.test(tok) && !/[a-z][A-Z]/.test(tok) && !/^[A-Z0-9_]+$/.test(tok)) continue;
      ids.add(tok);
    }
  }
  return [...ids].sort();
}
/**
 * Pure decision over a presence predicate, so it is testable without a repo.
 * ⚠️ A FLOOR, because "no identifiers added" must not read as "all of them landed" — that is §4b's
 * success reported about something never examined, in a tool that then DELETES a directory.
 */
export function landedByIdentifiers(ids, isOnBase, { base = 'origin/main', min = MIN_LANDED_IDS } = {}) {
  if (!Array.isArray(ids)) return { ok: false, why: 'no diff to read — cannot tell what this branch added' };
  if (ids.length < min) return { ok: false, why: `only ${ids.length} identifier(s) added by this branch — too few to prove the work landed (floor ${min})`, checked: ids.length };
  const absent = [];
  for (const id of ids) {
    let present;
    try {
      present = isOnBase(id) === true;
    } catch (e) {
      return { ok: false, why: `cannot search ${base} for ${id}: ${String((e && e.message) || e).split('\n')[0]}`, checked: ids.length };
    }
    if (!present) absent.push(id);
  }
  if (absent.length)
    return {
      ok: false,
      why: `${absent.length} of ${ids.length} identifier(s) this branch added are NOT on ${base}: ${absent.slice(0, 4).join(' ')}${absent.length > 4 ? ' …' : ''}`,
      checked: ids.length,
      absent
    };
  return { ok: true, why: `all ${ids.length} identifier(s) this branch added are present on ${base}`, checked: ids.length, absent: [] };
}
/* The impure half: the diff against the base, then one `git grep` per identifier over the base TREE
   (never the working tree, which is the thing being retired). */
function landedElsewhereFor(wtPath, base = 'origin/main') {
  try {
    run('git', ['-C', wtPath, 'fetch', '-q', 'origin', 'main']);
  } catch {
    return { ok: false, why: `cannot reach ${base} — no base to compare this branch's work with` };
  }
  let diff;
  try {
    diff = run('git', ['-C', wtPath, 'diff', '-U0', `refs/remotes/origin/main...HEAD`]);
  } catch (e) {
    return { ok: false, why: `diff against ${base} failed (${String(e.message || e).split('\n')[0]})` };
  }
  return landedByIdentifiers(
    addedIdentifiers(diff),
    (id) => {
      try {
        run('git', ['-C', wtPath, 'grep', '-q', '-F', '-e', id, 'refs/remotes/origin/main']);
        return true;
      } catch {
        return false; // git grep exits 1 for "no match" — absent, not an error
      }
    },
    { base }
  );
}
function dirtyCountFor(wtPath) {
  return run('git', ['-C', wtPath, 'status', '--porcelain']).split('\n').filter(Boolean).length;
}

function main(argv) {
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'wt-done' });
  let wts;
  try {
    wts = parseWorktrees(run('git', ['-C', REPO_ROOT, 'worktree', 'list', '--porcelain']));
  } catch (e) {
    /* Name the reason rather than print a stack: a refusal is a sentence. */
    console.error(
      `✕ cannot list worktrees of ${REPO_ROOT}: ${
        String((e && e.stderr) || (e && e.message) || e)
          .trim()
          .split('\n')[0]
      }`
    );
    return 2;
  }
  if (argv.includes('--list')) {
    console.log(`DENOMINATOR: ${wts.length} worktree(s) registered`);
    for (const w of wts) {
      const dirty = existsSync(w.path) ? dirtyCountFor(w.path) : -1;
      const pr = prFor(w.branch);
      const use = existsSync(w.path) ? usersOfPath(w.path) : { ok: true, users: [] };
      const unl = existsSync(w.path) && pr.state === 'MERGED' ? unlandedFor(w.path, pr.mergedAt) : undefined;
      const v = verdict({ prState: pr.state, dirtyCount: Math.max(0, dirty), isMain: w.branch === 'main' || w.branch === 'master', inUse: use, unlanded: unl });
      console.log(`${v.ok ? 'REMOVABLE ' : 'keep      '} ${w.path}  [${w.branch ?? 'detached'}]  pr=${pr.state ?? '-'} dirty=${dirty} — ${v.why}`);
    }
    return 0;
  }
  const prFlagAt = argv.indexOf('--pr');
  const prArg = prFlagAt >= 0 ? argv[prFlagAt + 1] : null;
  if (prFlagAt >= 0 && !/^[0-9]+$/.test(prArg ?? '')) {
    console.error('usage: --pr <number>');
    return 2;
  }
  const pushedFlag = argv.includes('--pushed');
  const landedFlag = argv.includes('--landed');
  const targets = positionalArgs(argv, ARGV_SPEC);
  if (prArg && targets.length !== 1) {
    console.error(`✕ --pr names ONE PR, so it applies to ONE worktree (got ${targets.length})`);
    return 2;
  }
  if (!targets.length) {
    console.error('usage: node tools/wt-done.mjs --list | [--pushed] [--landed] [--pr <n>] <worktree-path> [...]');
    return 2;
  }
  let fail = 0;
  for (const t of targets) {
    const abs = path.resolve(t);
    const w = wts.find((x) => path.resolve(x.path) === abs);
    if (!w) {
      console.error(`✕ ${t}: not a registered worktree`);
      fail++;
      continue;
    }
    let pr;
    if (prArg) {
      const named = prByNumber(prArg);
      if (!namesRelated(w.branch, named.headRefName)) {
        console.error(`✕ REFUSE ${t}: PR #${prArg} merged as '${named.headRefName ?? '(unknown)'}', which is not a rename of '${w.branch}' — supply the PR that carries THIS branch's work`);
        fail++;
        continue;
      }
      console.log(`  proof: PR #${prArg} is ${named.state} as '${named.headRefName}' (this branch is a rename of it)`);
      pr = named;
    } else {
      pr = prFor(w.branch);
    }
    /* Computed ONCE for both roles below, and only where it can apply: a PR-less or CLOSED-PR tree. */
    const land = pr.state === null || pr.state === 'CLOSED' ? pushedFor(w.path, w.branch) : undefined;
    const v = verdict({
      prState: pr.state,
      dirtyCount: dirtyCountFor(w.path),
      isMain: w.branch === 'main' || w.branch === 'master',
      inUse: usersOfPath(w.path),
      unlanded: pr.state === 'MERGED' ? unlandedFor(w.path, pr.mergedAt) : undefined,
      /* ONE computation, two roles: `landless` decides the empty case with no flag, `pushed` carries the
         opt-in containment case. Same function, so the two can never disagree about what it measured. */
      pushed: pushedFlag ? land : undefined,
      landless: land,
      /* Computed only when asked and only where it can apply, because it costs a fetch plus one
         `git grep` per identifier against the base tree. */
      landedElsewhere: landedFlag ? landedElsewhereFor(w.path) : undefined
    });
    if (!v.ok) {
      console.error(`✕ REFUSE ${t}: ${v.why}`);
      fail++;
      continue;
    }
    run('git', ['-C', REPO_ROOT, 'worktree', 'remove', abs]); // no --force, deliberately
    console.log(`✓ removed ${t} (${v.why})`);
  }
  return fail ? 1 : 0;
}

/* self-test: node tools/wt-done.mjs --selftest (pure core only — no repo, no gh) */
if (process.argv.includes('--selftest')) {
  /* COUNTED, not narrated. This line read `selftest: 6/6 ok` as a hardcoded string while the file
     carried fourteen assertions — the same defect as an advisory row that prints its baseline
     instead of its measurement: a summary that cannot be wrong is not a summary. */
  let ran = 0;
  const assert = (c, m) => {
    ran++;
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      process.exit(1);
    }
  };
  assert(!verdict({ prState: 'MERGED', dirtyCount: 1, isMain: false }).ok, 'dirty must refuse even when merged');
  assert(!verdict({ prState: 'OPEN', dirtyCount: 0, isMain: false }).ok, 'open PR must refuse');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false }).ok, 'no PR must refuse');
  assert(!verdict({ prState: 'MERGED', dirtyCount: 0, isMain: true }).ok, 'main checkout must refuse');
  assert(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false }).ok, 'merged+clean must pass');
  // --pushed: a PR-less branch whose commits are all on origin may go; nothing weaker
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false }).ok, 'no PR without --pushed still refuses');
  assert(verdict({ prState: null, dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).ok, 'no PR + pushed + clean passes');
  assert(!verdict({ prState: null, dirtyCount: 1, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).ok, 'pushed never overrides dirty');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false, pushed: { ok: false, why: 'not contained' } }).ok, 'pushed proof failed ⇒ refuse');
  assert(!verdict({ prState: 'OPEN', dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).ok, 'an OPEN PR is not a pushed-only branch — stays');
  assert(verdict({ prState: 'CLOSED', dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).ok, 'a CLOSED PR whose commits are on origin may go (the tree is not the only copy)');
  assert(!verdict({ prState: 'CLOSED', dirtyCount: 0, isMain: false }).ok, 'a CLOSED PR without --pushed still refuses');

  /* ── THE EMPTY TREE NEEDS NO FLAG, and the refusal names what it measured (2026-09-28) ───────────
     `landless` is pushedFor's answer computed regardless of --pushed; only its `empty` kind is honoured
     without the flag, because an empty tree cannot be the last copy of anything. The wording legs are
     here because the wording is the defect this fixes: the old refusal hinted `--pushed` at every
     PR-less tree, including ones the flag cannot help, and that hint cost a manual removal. */
  const EMPTY = { ok: true, kind: 'empty', commitsAhead: 0, remoteRef: false };
  const CONTAINED = { ok: true, kind: 'contained', remote: 'origin/x', commitsAhead: 3, remoteRef: true };
  assert(verdict({ prState: null, dirtyCount: 0, isMain: false, landless: EMPTY }).ok, 'an EMPTY tree passes with no flag');
  assert(!verdict({ prState: null, dirtyCount: 1, isMain: false, landless: EMPTY }).ok, 'empty never overrides dirty');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false, landless: CONTAINED }).ok, 'a CONTAINED tree still needs --pushed — trading a tree for a remote copy stays a judgement');
  assert(verdict({ prState: null, dirtyCount: 0, isMain: false, landless: CONTAINED, pushed: CONTAINED }).ok, '…and passes when the flag is given');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false, landless: EMPTY, inUse: { ok: true, users: [{ pid: 7, cmd: 'node x' }] } }).ok, 'an empty tree IN USE still refuses');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false, landless: { ok: false, why: 'fetch failed' } }).ok, 'an unprovable landless state refuses');
  /* THE WORDING, asserted because it is the thing that was wrong. */
  const wContained = verdict({ prState: null, dirtyCount: 0, isMain: false, landless: CONTAINED }).why;
  assert(/3 commit\(s\) ahead of origin\/main/.test(wContained), 'the refusal names the commit count it measured');
  assert(/branch is on origin/.test(wContained), '…and whether the branch is on origin');
  assert(/--pushed/.test(wContained), '…and offers the flag to a tree the flag can help');
  const wLocal = verdict({ prState: null, dirtyCount: 0, isMain: false, landless: { ok: false, why: 'not contained', commitsAhead: 2, remoteRef: false } }).why;
  assert(/branch is not on origin/.test(wLocal), 'a never-pushed branch is described as such');
  assert(!/--pushed/.test(wLocal), '…and is NOT offered a flag that cannot help it — the hint that cost a manual removal');
  assert(/0 commits ahead of origin\/main/.test(verdict({ prState: null, dirtyCount: 0, isMain: false, landless: EMPTY }).why), 'the success prints the measurements it acted on');
  assert(!verdict({ prState: 'CLOSED', dirtyCount: 0, isMain: false, pushed: { ok: false, why: 'not contained' } }).ok, 'a CLOSED PR with commits only here refuses');
  assert(/closed unmerged/.test(verdict({ prState: 'CLOSED', dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).why), 'the pass says the PR was closed, not merged');
  assert(!verdict({ prState: null, dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' }, inUse: { ok: true, users: [{ pid: 7, cmd: 'x' }] } }).ok, 'pushed never overrides in-use');
  assert(/origin\/x/.test(verdict({ prState: null, dirtyCount: 0, isMain: false, pushed: { ok: true, remote: 'origin/x' } }).why), 'the pass names the remote it verified');
  /* ── the IDLE leg ─────────────────────────────────────────────────────────────────────────────
     A tree can be merged AND clean AND have a gate running in it; that combination is what this
     check exists for, so it is asserted directly rather than implied by the others. */
  assert(!verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: true, users: [{ pid: 4242, cmd: 'bash ./check.sh' }] } }).ok, 'merged + clean + IN USE must refuse');
  assert(
    /PID 4242 \(bash \.\/check\.sh\)/.test(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: true, users: [{ pid: 4242, cmd: 'bash ./check.sh' }] } }).why),
    'the refusal must NAME the pid and its command line, not just say "in use"'
  );
  assert(!verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: false, why: 'cannot read /proc' } }).ok, 'an INCONCLUSIVE scan must refuse — unknown is not idle');
  assert(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: true, users: [] } }).ok, 'merged + clean + proven idle must pass');
  assert(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false }).why === 'PR merged + tree clean', 'a caller that does not scan keeps the old verdict text, so older callers are unchanged');
  /* The scanner must not count ITSELF. This process's cwd is inside the repo, so scanning the repo
     root would self-match if `self` were not excluded — the §4 defect this function exists to avoid. */
  {
    const here = usersOfPath(process.cwd());
    assert(here.ok, 'scanning a real path must succeed on this platform');
    assert(!here.users.some((u) => u.pid === process.pid), 'the scanner must never report itself');
    /* REGRESSION (residue `2026-09-08-wt-done-idle-check-counts-its-caller`). Excluding `self` alone
       left the scanner's CALLER — and, measured, any SIBLING in the same pipeline — reported as users
       whenever the tool was run from inside the tree, so asking the question refused the answer. The
       scan runs with cwd = the directory being scanned, which is exactly that case: every process this
       may now legitimately find is an outside tenant, and the INVOCATION must contribute none. */
    const ppid = (() => {
      try {
        const raw = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
        return Number(raw.slice(raw.lastIndexOf(')') + 2).split(' ')[1]);
      } catch {
        return null;
      }
    })();
    if (ppid) assert(!here.users.some((u) => u.pid === ppid), 'the scanner must never report its own CALLER');
  }
  {
    const bad = usersOfPath('/does/not/matter', { procRoot: '/no/such/proc' });
    assert(bad.ok === false, 'an unreadable /proc must report FAILURE, never an empty user list');
  }
  const wts = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/x\n\nworktree /b\nHEAD def\ndetached\n');
  assert(wts.length === 2 && wts[0].branch === 'x' && wts[1].branch === null, 'porcelain parse');
  /* ── the UNLANDED leg (row 2026-09-22-wt-done-merged-is-not-landed) ───────────────────────────
     MERGED + clean + idle was the whole verdict, and it is satisfied by a branch whose PR merged
     and which then kept committing. Asserted directly, including the back-compat case: a caller
     that does not scan must get byte-identical text to before, or every older call site changes
     meaning silently. */
  assert(
    !verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: true, users: [] }, unlanded: { ok: true, count: 2 } }).ok,
    'merged + clean + idle but 2 commits after the merge must REFUSE'
  );
  assert(
    /2 commit\(s\) dated after the PR merged/.test(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, unlanded: { ok: true, count: 2 } }).why),
    'the refusal NAMES how many commits did not land'
  );
  assert(
    !verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, unlanded: { ok: false, why: 'no merge timestamp from gh' } }).ok,
    'an INCONCLUSIVE landed-scan must refuse — unknown is not landed'
  );
  assert(
    verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, inUse: { ok: true, users: [] }, unlanded: { ok: true, count: 0 } }).ok,
    'merged + clean + idle + nothing after the merge must pass'
  );
  assert(
    verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false, unlanded: { ok: true, count: 0 } }).why === 'PR merged + tree clean + every commit landed',
    'a scanning caller says so in the verdict text'
  );
  assert(verdict({ prState: 'MERGED', dirtyCount: 0, isMain: false }).why === 'PR merged + tree clean', 'a caller that does NOT scan for unlanded commits keeps the old text byte-for-byte');
  assert(!verdict({ prState: 'MERGED', dirtyCount: 1, isMain: false, unlanded: { ok: true, count: 0 } }).ok, 'dirty still outranks a clean landed-scan');
  /* ── the RETRY-RENAME relation (row 2026-09-23-wt-done-cannot-be-told-the-pr-landed) ──────────
     `--pr` is proof, not an override, and this relation is the part that makes it so. The measured
     case is asserted by name, and the floor is asserted against the shared `claude/` stem that every
     branch here carries. */
  assert(namesRelated('claude/p3-w2-gap-counters-hrn-v2', 'claude/p3-w2-gap-counters-hrn'), 'a -v2 retry IS related to the name its PR merged under');
  assert(namesRelated('claude/p3-w2-gap-counters-hrn', 'claude/p3-w2-gap-counters-hrn'), 'an identical name is related to itself');
  assert(
    !namesRelated('claude/render-sweep-mg', 'claude/absence-survey-mg'),
    'two unrelated branches are NOT related'
  ); /* test names deliberately avoid the substring `/`+`wt-`: the tool-hygiene gate reads a
        quoted string containing it as a hardcoded checkout root, and a fake branch name in a
        selftest is indistinguishable from one. Caught by that gate, not by review. */
  assert(!namesRelated('claude/', 'claude/anything'), 'the shared claude/ stem alone is below the floor');
  assert(!namesRelated('claude/x', 'claude/xy'), 'a short prefix below the floor is NOT related');
  assert(!namesRelated('claude/some-branch-name', null), 'an unreadable PR head is NOT related');
  assert(!namesRelated(null, 'claude/some-branch-name'), 'a detached worktree is NOT related');
  console.log(`selftest: ${ran}/${ran} ok`);
  process.exit(0);
}
const isDirect = isCliEntry(import.meta.url);
if (isDirect && !process.argv.includes('--selftest')) process.exit(main(process.argv.slice(2)));
