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
 *      see the 12-commits-stranded incident). No PR, or PR still open ⇒ REFUSE.
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

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

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

export function verdict({ prState, dirtyCount, isMain, inUse, unlanded }) {
  /* Pure decision core, so the refusals are testable without a repo. `inUse` is the result of
     `usersOfPath`: omitted entirely means the caller did not scan (older callers keep working);
     `{ok:false}` means the scan FAILED, which refuses — unknown is not idle. */
  if (isMain) return { ok: false, why: 'holds main/master — never remove the primary checkout' };
  if (dirtyCount > 0) return { ok: false, why: `${dirtyCount} dirty/untracked path(s) — may be someone's only copy` };
  if (prState === null) return { ok: false, why: 'no PR found for branch — cannot prove the work landed' };
  if (prState !== 'MERGED') return { ok: false, why: `PR is ${prState}, not MERGED` };
  /* MERGED answers "did a PR from this branch merge", NOT "is every commit on this branch landed",
     and under squash nothing in the graph distinguishes them (row 2026-09-22-wt-done-merged-is-not-landed).
     `unlanded` supplies the missing question. Omitted ⇒ older callers unchanged. */
  if (unlanded && unlanded.ok === false) return { ok: false, why: `cannot prove every commit landed: ${unlanded.why}` };
  if (unlanded && unlanded.count > 0)
    return {
      ok: false,
      why: `${unlanded.count} commit(s) dated after the PR merged — work continued here and did not land; open a PR for them or move them to a branch before removing`
    };
  if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
  if (inUse && inUse.users && inUse.users.length) {
    const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
    return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
  }
  return { ok: true, why: (inUse ? 'PR merged + tree clean + idle' : 'PR merged + tree clean') + (unlanded ? ' + every commit landed' : '') };
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

function dirtyCountFor(wtPath) {
  return run('git', ['-C', wtPath, 'status', '--porcelain']).split('\n').filter(Boolean).length;
}

function main(argv) {
  const wts = parseWorktrees(run('git', ['worktree', 'list', '--porcelain']));
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
  const targets = argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node tools/wt-done.mjs --list | <worktree-path> [...]');
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
    const pr = prFor(w.branch);
    const v = verdict({
      prState: pr.state,
      dirtyCount: dirtyCountFor(w.path),
      isMain: w.branch === 'main' || w.branch === 'master',
      inUse: usersOfPath(w.path),
      unlanded: pr.state === 'MERGED' ? unlandedFor(w.path, pr.mergedAt) : undefined
    });
    if (!v.ok) {
      console.error(`✕ REFUSE ${t}: ${v.why}`);
      fail++;
      continue;
    }
    run('git', ['worktree', 'remove', abs]); // no --force, deliberately
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
  console.log(`selftest: ${ran}/${ran} ok`);
  process.exit(0);
}
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirect && !process.argv.includes('--selftest')) process.exit(main(process.argv.slice(2)));
