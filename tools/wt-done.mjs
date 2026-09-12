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
/* THE CALLER IS NOT A USER. `usersOfPath` excluded only its own pid, and its header claimed the
   `/proc` readlink form "cannot self-match" — true of the SCANNER and false one process up. A shell
   that has `cd`'d into the worktree to run `node tools/wt-done.mjs .` from inside it has
   `/proc/<pid>/cwd` under the target, so it is reported as a user and the removal is REFUSED on the
   invocation itself. Measured 2026-09-11: run from inside a directory, the scan returns exactly one
   user — the caller's own bash.
   Third self-match shape in this codebase, each one process further out than the last: a `pgrep -f`
   pattern matches its own argv (CLAUDE.md §4); a path grep matches its own command line; a cwd scan
   matches its own CALLER. The family is "the instrument is inside the population it measures".
   So the exclusion is the ANCESTOR CHAIN, not the pid: every process between the scanner and init is
   there BECAUSE it invoked the scan. Non-ancestors are still reported — a stray editor or a server
   left running in the tree must still refuse, and that refusal is real (it caught a forgotten
   `python3 -m http.server` of mine the same night). */
function ancestorsOf(pid, procRoot) {
  const chain = new Set();
  let cur = Number(pid);
  for (let hops = 0; hops < 64 && cur > 1; hops++) {
    chain.add(cur);
    let ppid = 0;
    try {
      const st = readFileSync(`${procRoot}/${cur}/stat`, 'utf8');
      /* field 4 is ppid, but field 2 (comm) is parenthesised and may itself contain spaces or
         parens — so parse AFTER the last ')', never by splitting the whole line. */
      ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {
      break; // the chain left the world mid-walk; stop rather than guess
    }
    if (!Number.isFinite(ppid) || ppid <= 1 || ppid === cur) break;
    cur = ppid;
  }
  return chain;
}

export function usersOfPath(dir, { procRoot = '/proc', self = process.pid } = {}) {
  let pids;
  try {
    pids = readdirSync(procRoot).filter((d) => /^\d+$/.test(d));
  } catch (e) {
    return { ok: false, why: `cannot read ${procRoot} (${e.code || e.message}) — the tree may be in use` };
  }
  const root = path.resolve(dir);
  const prefix = root + path.sep;
  const under = (t) => t === root || t.startsWith(prefix);
  const kin = ancestorsOf(self, procRoot);
  const users = [];
  for (const pid of pids) {
    if (kin.has(Number(pid))) continue; // never count the scanner OR the chain that invoked it
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

export function verdict({ prState, dirtyCount, isMain, inUse }) {
  /* Pure decision core, so the refusals are testable without a repo. `inUse` is the result of
     `usersOfPath`: omitted entirely means the caller did not scan (older callers keep working);
     `{ok:false}` means the scan FAILED, which refuses — unknown is not idle. */
  if (isMain) return { ok: false, why: 'holds main/master — never remove the primary checkout' };
  if (dirtyCount > 0) return { ok: false, why: `${dirtyCount} dirty/untracked path(s) — may be someone's only copy` };
  if (prState === null) return { ok: false, why: 'no PR found for branch — cannot prove the work landed' };
  if (prState !== 'MERGED') return { ok: false, why: `PR is ${prState}, not MERGED` };
  if (inUse && inUse.ok === false) return { ok: false, why: `cannot prove idle: ${inUse.why}` };
  if (inUse && inUse.users && inUse.users.length) {
    const who = inUse.users.map((u) => `PID ${u.pid} (${u.cmd})`).join('; ');
    return { ok: false, why: `IN USE by ${who} — removing it would destroy that run` };
  }
  return { ok: true, why: inUse ? 'PR merged + tree clean + idle' : 'PR merged + tree clean' };
}

function prStateFor(branch) {
  if (!branch) return null;
  try {
    const js = JSON.parse(run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state', '--limit', '1']));
    return js.length ? js[0].state : null;
  } catch {
    return null; // gh unavailable / offline reads as "cannot prove" → refuse, never as "merged"
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
      const pr = prStateFor(w.branch);
      const use = existsSync(w.path) ? usersOfPath(w.path) : { ok: true, users: [] };
      const v = verdict({ prState: pr, dirtyCount: Math.max(0, dirty), isMain: w.branch === 'main' || w.branch === 'master', inUse: use });
      console.log(`${v.ok ? 'REMOVABLE ' : 'keep      '} ${w.path}  [${w.branch ?? 'detached'}]  pr=${pr ?? '-'} dirty=${dirty} — ${v.why}`);
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
    const v = verdict({
      prState: prStateFor(w.branch),
      dirtyCount: dirtyCountFor(w.path),
      isMain: w.branch === 'main' || w.branch === 'master',
      inUse: usersOfPath(w.path)
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
  }
  {
    const bad = usersOfPath('/does/not/matter', { procRoot: '/no/such/proc' });
    assert(bad.ok === false, 'an unreadable /proc must report FAILURE, never an empty user list');
  }
  const wts = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/x\n\nworktree /b\nHEAD def\ndetached\n');
  assert(wts.length === 2 && wts[0].branch === 'x' && wts[1].branch === null, 'porcelain parse');
  console.log(`selftest: ${ran}/${ran} ok`);
  process.exit(0);
}
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirect && !process.argv.includes('--selftest')) process.exit(main(process.argv.slice(2)));
