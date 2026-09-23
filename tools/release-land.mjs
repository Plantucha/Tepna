#!/usr/bin/env node
/*
 * tools/release-land.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * THE WHOLE RELEASE, ONE COMMAND, NO OPERATOR MEMORY — stamp → build → gate → PR → merge → tag →
 * GitHub Release → cleanup. `tools/release.mjs` is the STAMP (version, changelog, ledgers); this is
 * everything after it, which used to live in a session's memory and was reconstructed by hand each
 * time.
 *
 * WHY IT EXISTS (v2.10.0, 2026-09-07). The stamp ran fine; the eleven steps after it were each done
 * by hand, and four were done wrong or late: `node tools/build.mjs` with no argument builds NOTHING
 * (it needs `--all`); the deleted changesets were staged three different ways before one passed the
 * shared-tree guard; the tag was cut but the GitHub *Release* object was not, so the repo's "Latest"
 * badge kept reading the previous version until the owner asked "did you tag it?"; and the worktree
 * was left behind. None of that is judgement — it is a checklist, and a checklist that lives in
 * memory is re-derived every release with a different error each time. So it is a program now.
 *
 *     node tools/release.mjs --full             # ← the entry point: launches THIS, detached
 *     node tools/release-land.mjs --status      # what step the running/last release is on
 *     node tools/release-land.mjs --dry-run     # plan only: version, branch, worktree; writes nothing
 *     node tools/release-land.mjs --resume      # continue the last run from its first unfinished step
 *     node tools/release-land.mjs --foreground  # run attached (CI / a terminal you will keep open)
 *
 * IT DETACHES BY DEFAULT, and the reason is measured, not stylistic. The chain is ~45–90 minutes
 * (stamp gate ~2 min · build+docs · `npm run check` 10+ min · CI + Kodiak's serial queue 10–60 min),
 * and the operator's tool loop caps a foreground command at 10 minutes. Every hand-written waiter
 * around that cap has been wrong in one of CLAUDE.md §👥.4's four ways. So the launcher forks this
 * process as its own session leader, points stdout/stderr at a log, and returns in under a second;
 * progress is a STATE FILE (`--status`), not a process to poll. Nothing is hidden: the log path and
 * the PID are printed at launch and the state file names every step, its outcome and its evidence.
 *
 * STEPS — each is idempotent-by-detection where GitHub is the store of record (a tag that already
 * points at the merge sha is skipped, an existing Release is skipped), so `--resume` after a crash
 * never double-creates and never re-stamps:
 *   plan      release.mjs --dry-run --skip-gates → the version this fold will produce
 *   worktree  a private checkout off origin/main (§👥.1); node_modules symlinked from the primary
 *   stamp     node tools/release.mjs (runs THE WALL: verify-fixtures --check; refuses on red)
 *   build     node tools/build.mjs --all  (⚠ bare build.mjs builds nothing — measured)
 *   docs      node tools/build-docs.mjs   (served copies; `verify:docs` reds until this runs)
 *   gate      npm run check — the FULL gate, on the final tree, once
 *   scan      the new CHANGELOG section is leak-scanned BEFORE it is committed (see leakScan)
 *   commit    stage by EXPLICIT PATH from `git status --porcelain`; deleted changesets via
 *             `git rm --cached`; REFUSES on any untracked path — a release produces none
 *   push      plain push of a new branch; never any --force
 *   pr        gh pr create — a 2-line body; Kodiak merges every non-draft, unlabelled PR
 *   merge     poll until MERGED; after a grace period hand the PR to land-pr.mjs (the fallback
 *             CLAUDE.md §👥.5 names) rather than assume the queue is moving
 *   tag       at the MERGE sha (never the branch tip — squash rewrites it); `-s` when a signing
 *             key is configured, `-a` otherwise; pushed with a plain `git push origin v<X>`
 *   release   gh release create v<X> --title "Tepna v<X>" --notes-file <changelog section>
 *             --verify-tag — the object GitHub's "Latest" badge reads; a tag alone is not a release
 *   cleanup   tools/wt-done.mjs on the worktree (refuses if in use — reported, not forced) and a
 *             fast-forward of the primary checkout's main when it is clean
 *
 * WHAT IT DOES NOT DO. It does not decide WHEN to release (owner ruling 2026-09-07: ≥25 pending
 * changesets or weekly). It does not touch a dirty tree, a checked-out branch ref, or a worktree it
 * did not create. It does not read the README's narrative prose — release.mjs prints which numbers
 * it could not check; those lines are echoed into the log for a human to read, and the release does
 * not wait for them (a stale sentence is a docs fix; a stale ledger is what the gate is for).
 *
 * THE PURE PARTS ARE GATE-BACKED (`--selftest`, run by CI's tool-selftest step): porcelain
 * classification, changelog-section extraction, the leak scan, tag/PR text, and the resume plan.
 * Everything that touches git/gh/the filesystem is in the step runners.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(tmpdir(), 'tepna-release-land');
const LATEST = join(STATE_DIR, 'latest.json');

/* ── pure core ────────────────────────────────────────────────────────────────────────────────── */

export const STEPS = ['plan', 'worktree', 'stamp', 'build', 'docs', 'gate', 'scan', 'commit', 'push', 'pr', 'merge', 'tag', 'release', 'cleanup'];

/* Which steps remain, given what the state file says finished. Order is STEPS' order; a step is
   never re-run once recorded done, so a crash between two steps resumes at the second. */
export function remaining(done) {
  const d = new Set(done || []);
  return STEPS.filter((s) => !d.has(s));
}

/* `git status --porcelain` → what to `git add`, what to `git rm --cached`, and what to REFUSE on.
   A release touches only tracked files: the stamp edits ledgers, the builders rewrite bundles and
   served copies, and the fold DELETES changesets. An untracked path therefore cannot be the
   release's — it is a concurrent session's, or a builder writing somewhere new — and staging it by
   accident is exactly the §👥.2 blanket-add failure this classification exists to prevent. Renames
   and conflicts are refused for the same reason: the release never produces them. */
export function classifyStatus(porcelain) {
  const out = { add: [], del: [], untracked: [], other: [] };
  for (const raw of String(porcelain || '').split('\n')) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2);
    const path = raw.slice(3).replace(/^"(.*)"$/, '$1');
    if (xy === '??') out.untracked.push(path);
    else if (/^[ MA][MA]$|^[MA] $|^ [MA]$/.test(xy)) out.add.push(path);
    else if (/^[ D]D$|^D $/.test(xy)) out.del.push(path);
    else out.other.push(raw);
  }
  return out;
}

/* The `## [X.Y.Z] — date` section of CHANGELOG.md, up to the next `## [` heading, trimmed.
   `null` when the version has no section — the caller must refuse, never publish an empty release. */
export function changelogSection(text, version) {
  const lines = String(text || '').split('\n');
  const esc = version.replace(/\./g, '\\.');
  const head = new RegExp('^## \\[' + esc + '\\]');
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const s = body.join('\n').trim();
  return s ? s : null;
}

/* GENERIC leak patterns — things that must never reach a public Release body. Deliberately generic:
   an absolute home path, a push-notification topic URL, a long opaque token inside a URL, a Windows
   user path. Anything project-specific (a device serial, a vendor name that must stay out of public
   artifacts) belongs in an EXTERNAL denylist file (`TEPNA_RELEASE_DENYLIST`, one regex per line),
   because writing the forbidden string into the repo to check for it is the leak. */
export const LEAK_PATTERNS = [
  ['absolute home path', /\/home\/[A-Za-z0-9_-]+\//],
  ['windows user path', /[A-Za-z]:\\Users\\/],
  ['ntfy topic URL', /ntfy\.sh\//i],
  ['long token in URL', /https?:\/\/\S*[A-Za-z0-9_-]{32,}/]
];

export function leakScan(text, extra = []) {
  const hits = [];
  const pats = LEAK_PATTERNS.concat(extra.map((re, i) => ['denylist #' + (i + 1), re]));
  String(text || '')
    .split('\n')
    .forEach((line, n) => {
      for (const [name, re] of pats) if (re.test(line)) hits.push({ line: n + 1, rule: name, text: line.slice(0, 120) });
    });
  return hits;
}

/* Denylist file → regexes. Blank lines and `#` comments skipped; a line that is not a valid regex is
   matched literally, so a typo tightens the scan rather than silently loosening it. */
export function parseDenylist(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    try {
      out.push(new RegExp(l, 'i'));
    } catch {
      out.push(new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return out;
}

/* `-s` only when a key is configured — a signed-tag attempt with no key fails AFTER the merge, which
   is the worst place to stop. v1.8.0 was the last signed tag; rig-x870 carries no key. */
export function tagArgs(version, signingKey) {
  return ['tag', signingKey ? '-s' : '-a', 'v' + version, '-m', 'v' + version];
}

export function commitMessage(version, session) {
  return `release: v${version}\n\nFleet-Session: ${session}`;
}

/* 1–2 lines, per the house rule for internal tooling PRs. The changelog is the long form. */
export function prBody(version, level, n, session) {
  return `Fold of ${n} changeset(s) → v${version} (${level}). Cut by tools/release-land.mjs.\n\nFleet-Session: ${session}`;
}

export function parsePlan(dryRunStdout) {
  const m = /DRY RUN: (\d+\.\d+\.\d+) → (\d+\.\d+\.\d+) \((major|minor|patch)\)/.exec(dryRunStdout || '');
  if (!m) return null;
  const consume = /Would consume: (.*)/.exec(dryRunStdout || '');
  const n = consume ? consume[1].split(',').filter((s) => s.trim()).length : 0;
  return { from: m[1], to: m[2], level: m[3], n };
}

/* Merge polling verdict from `gh pr view --json state,mergeCommit,mergeStateStatus`. */
export function mergeVerdict(view, elapsedMin, graceMin) {
  if (!view) return { action: 'wait', why: 'unreadable — an unreadable snapshot is not a closed PR' };
  if (view.state === 'MERGED') return { action: 'done', sha: view.mergeCommit && view.mergeCommit.oid };
  if (view.state === 'CLOSED') return { action: 'fail', why: 'PR closed without merging' };
  if (view.mergeStateStatus === 'DIRTY') return { action: 'fail', why: 'merge conflict — rebase by hand (§👥.2c)' };
  if (elapsedMin >= graceMin) return { action: 'land', why: `still ${view.mergeStateStatus} after ${graceMin} min — handing to land-pr` };
  return { action: 'wait', why: `${view.mergeStateStatus}; Kodiak's queue` };
}

/* ── I/O helpers ──────────────────────────────────────────────────────────────────────────────── */

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status === null ? 1 : r.status, out: r.stdout || '', err: r.stderr || '' };
}
function must(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} → exit ${r.code}\n${r.err.slice(-2000)}${r.out.slice(-2000)}`);
  return r.out;
}
function nowIso() {
  return new Date().toISOString();
}

function loadState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function saveState(st) {
  mkdirSync(STATE_DIR, { recursive: true });
  st.updated = nowIso();
  writeFileSync(st.file, JSON.stringify(st, null, 2) + '\n');
  writeFileSync(LATEST, JSON.stringify({ file: st.file }) + '\n');
}

function log(st, line) {
  const s = `[${nowIso().slice(11, 19)}] ${line}`;
  console.log(s);
  st.log.push(s);
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

/* ── steps ────────────────────────────────────────────────────────────────────────────────────── */

const RUN = {
  plan(st) {
    const r = sh('node', ['tools/release.mjs', '--dry-run', '--skip-gates'], { cwd: ROOT });
    const plan = parsePlan(r.out);
    if (!plan) throw new Error('release.mjs --dry-run did not report a version:\n' + (r.err || r.out).slice(-1500));
    Object.assign(st, plan);
    st.branch = st.branch || `claude/release-${plan.to}-${st.suffix}`;
    st.worktree = st.worktree || resolve(ROOT, '..', `wt-release-${plan.to}`);
    st.file = join(STATE_DIR, `v${plan.to}.json`);
    log(st, `plan: ${plan.from} → ${plan.to} (${plan.level}, ${plan.n} changesets) branch=${st.branch} wt=${st.worktree}`);
  },
  worktree(st) {
    must('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT });
    if (!existsSync(st.worktree)) {
      must('git', ['worktree', 'add', st.worktree, '-b', st.branch, 'origin/main'], { cwd: ROOT });
    } else {
      const b = must('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: st.worktree }).trim();
      if (b !== st.branch) throw new Error(`${st.worktree} exists on branch ${b}, not ${st.branch} — not mine, refusing`);
    }
    const nm = join(st.worktree, 'node_modules');
    if (!existsSync(nm) && existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), nm);
    log(st, `worktree ready: ${st.worktree} [${st.branch}]`);
  },
  stamp(st) {
    const r = sh('node', ['tools/release.mjs'], { cwd: st.worktree });
    st.stampOut = r.out.slice(-6000);
    if (r.code !== 0) throw new Error(`release.mjs exit ${r.code}:\n${(r.err + r.out).slice(-3000)}`);
    const v = JSON.parse(readFileSync(join(st.worktree, 'suite.manifest.json'), 'utf8')).version;
    if (v !== st.to) throw new Error(`stamped ${v}, planned ${st.to}`);
    /* README rows release.mjs could NOT check are a human's to read — echoed, never blocking. */
    const prose = r.out.split('\n').filter((l) => /README|prose|cannot|can't/i.test(l));
    for (const l of prose.slice(0, 12)) log(st, `  readme: ${l.trim()}`);
    log(st, `stamped v${v}`);
  },
  build(st) {
    must('node', ['tools/build.mjs', '--all'], { cwd: st.worktree });
    log(st, 'build.mjs --all done');
  },
  docs(st) {
    must('node', ['tools/build-docs.mjs'], { cwd: st.worktree });
    log(st, 'build-docs.mjs done');
  },
  gate(st) {
    const logFile = join(STATE_DIR, `v${st.to}-check.log`);
    const r = sh('node', ['tools/run-check.mjs'], { cwd: st.worktree });
    writeFileSync(logFile, r.out + r.err);
    if (r.code !== 0) throw new Error(`npm run check FAILED (exit ${r.code}) — log: ${logFile}\n${(r.out + r.err).slice(-2500)}`);
    log(st, `npm run check green — log: ${logFile}`);
  },
  scan(st) {
    const section = changelogSection(readFileSync(join(st.worktree, 'CHANGELOG.md'), 'utf8'), st.to);
    if (!section) throw new Error(`CHANGELOG.md carries no [${st.to}] section`);
    const hits = leakScan(section, denylist());
    if (hits.length) throw new Error('leak scan REFUSED the changelog section:\n' + hits.map((h) => `  L${h.line} ${h.rule}: ${h.text}`).join('\n'));
    st.notesFile = join(STATE_DIR, `v${st.to}-notes.md`);
    writeFileSync(st.notesFile, section + '\n');
    log(st, `changelog section clean (${section.split('\n').length} lines) → ${st.notesFile}`);
  },
  commit(st) {
    const cls = classifyStatus(must('git', ['status', '--porcelain'], { cwd: st.worktree }));
    if (cls.untracked.length || cls.other.length) {
      throw new Error(
        `refusing to stage — a release produces no untracked/renamed paths:\n${cls.untracked
          .map((p) => '  ?? ' + p)
          .concat(cls.other.map((l) => '  ' + l))
          .join('\n')}`
      );
    }
    if (!cls.add.length) throw new Error('nothing modified — the stamp did not land?');
    for (let i = 0; i < cls.add.length; i += 200) must('git', ['add', '--'].concat(cls.add.slice(i, i + 200)), { cwd: st.worktree });
    for (let i = 0; i < cls.del.length; i += 200) must('git', ['rm', '-q', '--cached', '--'].concat(cls.del.slice(i, i + 200)), { cwd: st.worktree });
    must('git', ['commit', '-q', '-m', commitMessage(st.to, st.session)], { cwd: st.worktree });
    st.commit = must('git', ['rev-parse', 'HEAD'], { cwd: st.worktree }).trim();
    log(st, `committed ${st.commit.slice(0, 8)}: +${cls.add.length} modified, −${cls.del.length} changesets`);
  },
  push(st) {
    must('git', ['push', '-q', '-u', 'origin', st.branch], { cwd: st.worktree });
    log(st, `pushed ${st.branch}`);
  },
  pr(st) {
    const existing = JSON.parse(must('gh', ['pr', 'list', '--head', st.branch, '--state', 'all', '--json', 'number,state', '--limit', '1'], { cwd: st.worktree }));
    if (existing.length) {
      st.pr = existing[0].number;
      log(st, `PR #${st.pr} already exists (${existing[0].state})`);
      return;
    }
    const url = must('gh', ['pr', 'create', '--title', `release: v${st.to}`, '--body', prBody(st.to, st.level, st.n, st.session)], { cwd: st.worktree }).trim();
    st.pr = +(/\/pull\/(\d+)/.exec(url) || [])[1];
    if (!st.pr) throw new Error('gh pr create returned no PR number: ' + url);
    log(st, `opened PR #${st.pr}`);
  },
  merge(st) {
    const t0 = Date.now();
    let landed = false;
    for (;;) {
      let view = null;
      try {
        view = JSON.parse(must('gh', ['pr', 'view', String(st.pr), '--json', 'state,mergeCommit,mergeStateStatus'], { cwd: st.worktree }));
      } catch {
        view = null;
      }
      const el = (Date.now() - t0) / 60000;
      const v = mergeVerdict(view, el, landed ? Infinity : st.graceMin);
      if (v.action === 'done') {
        st.mergeSha = v.sha;
        if (!st.mergeSha) throw new Error('merged but no merge commit reported');
        log(st, `PR #${st.pr} MERGED as ${st.mergeSha.slice(0, 8)}`);
        return;
      }
      if (v.action === 'fail') throw new Error(`PR #${st.pr}: ${v.why}`);
      if (v.action === 'land') {
        log(st, v.why);
        landed = true;
        const left = Math.max(5, Math.round(st.timeoutMin - el));
        const r = sh('node', ['tools/land-pr.mjs', String(st.pr), '--timeout-min', String(left)], { cwd: st.worktree });
        log(st, `land-pr exit ${r.code}: ${(r.out + r.err).trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`);
        continue;
      }
      if (el >= st.timeoutMin) throw new Error(`PR #${st.pr} not merged after ${st.timeoutMin} min (${v.why})`);
      log(st, `waiting: ${v.why}`);
      saveState(st);
      spawnSync('sleep', [String(st.pollSec)]);
    }
  },
  tag(st) {
    const tag = 'v' + st.to;
    must('git', ['fetch', '-q', 'origin', 'main', '--tags'], { cwd: ROOT });
    const have = sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`], { cwd: ROOT });
    if (have.code === 0) {
      if (have.out.trim() !== st.mergeSha) throw new Error(`tag ${tag} already exists at ${have.out.trim().slice(0, 8)}, not the merge sha ${st.mergeSha.slice(0, 8)} — not moving a tag`);
      log(st, `tag ${tag} already at merge sha`);
    } else {
      const key = sh('git', ['config', '--get', 'user.signingkey'], { cwd: ROOT }).out.trim();
      must('git', tagArgs(st.to, key).concat([st.mergeSha]), { cwd: ROOT });
      log(st, `tagged ${tag} (${key ? 'signed' : 'annotated, unsigned — no user.signingkey'}) at ${st.mergeSha.slice(0, 8)}`);
    }
    must('git', ['push', '-q', 'origin', tag], { cwd: ROOT });
    st.tag = tag;
    log(st, `pushed ${tag}`);
  },
  release(st) {
    const tag = 'v' + st.to;
    const exists = sh('gh', ['release', 'view', tag, '--json', 'url'], { cwd: ROOT });
    if (exists.code === 0) {
      st.release = JSON.parse(exists.out).url;
      log(st, `Release already exists: ${st.release}`);
      return;
    }
    /* Re-scan from the MERGED changelog, not the worktree copy — what main carries is what ships. */
    const section = changelogSection(must('git', ['show', `${st.mergeSha}:CHANGELOG.md`], { cwd: ROOT }), st.to);
    if (!section) throw new Error(`merged CHANGELOG.md carries no [${st.to}] section`);
    const hits = leakScan(section, denylist());
    if (hits.length) throw new Error('leak scan REFUSED the merged section:\n' + hits.map((h) => `  L${h.line} ${h.rule}: ${h.text}`).join('\n'));
    writeFileSync(st.notesFile, section + '\n');
    const url = must('gh', ['release', 'create', tag, '--title', `Tepna ${tag}`, '--notes-file', st.notesFile, '--verify-tag'], { cwd: ROOT }).trim();
    st.release = url;
    log(st, `GitHub Release created: ${url}`);
  },
  cleanup(st) {
    const r = sh('node', ['tools/wt-done.mjs', st.worktree], { cwd: ROOT });
    log(st, `wt-done: ${(r.out + r.err).trim().split('\n').pop()}`);
    /* ff the primary checkout only when it is on main with no tracked modifications. Untracked files
       are someone's and are left alone; git refuses on its own if a merge would collide with one. */
    const onMain = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).out.trim() === 'main';
    const tracked = classifyStatus(sh('git', ['status', '--porcelain'], { cwd: ROOT }).out);
    if (onMain && !tracked.add.length && !tracked.del.length && !tracked.other.length) {
      const ff = sh('git', ['merge', '-q', '--ff-only', 'origin/main'], { cwd: ROOT });
      log(st, ff.code === 0 ? 'primary checkout fast-forwarded to origin/main' : `primary checkout NOT synced: ${ff.err.trim().slice(0, 120)}`);
    } else {
      log(st, 'primary checkout left alone (not on main, or carries tracked changes)');
    }
  }
};

function denylist() {
  const f = process.env.TEPNA_RELEASE_DENYLIST;
  return f && existsSync(f) ? parseDenylist(readFileSync(f, 'utf8')) : [];
}

/* ── driver ───────────────────────────────────────────────────────────────────────────────────── */

function newState(argv) {
  const opt = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  return {
    file: null,
    started: nowIso(),
    session: opt('--session', process.env.FLEET_SESSION || 'Kestrel'),
    suffix: Math.random().toString(36).slice(2, 5),
    timeoutMin: +opt('--timeout-min', 120),
    graceMin: +opt('--grace-min', 20),
    pollSec: +opt('--interval-s', 60),
    done: [],
    failed: null,
    log: []
  };
}

function run(st) {
  for (const step of remaining(st.done)) {
    st.current = step;
    log(st, `▸ ${step}`);
    try {
      RUN[step](st);
    } catch (e) {
      st.failed = { step, why: String(e.message || e), at: nowIso() };
      log(st, `✗ FAILED at ${step}: ${st.failed.why.split('\n')[0]}`);
      if (st.file) saveState(st);
      console.error(st.failed.why);
      console.log(`RELEASE-LAND FAILED at ${step} — fix, then: node tools/release-land.mjs --resume`);
      return 1;
    }
    st.done.push(step);
    st.failed = null;
    st.current = null;
    saveState(st);
  }
  log(st, `✓ RELEASE-LAND DONE v${st.to} — PR #${st.pr} · ${st.tag} · ${st.release}`);
  saveState(st);
  return 0;
}

function status() {
  const ptr = loadState(LATEST);
  const st = ptr && loadState(ptr.file);
  if (!st) {
    console.log('no release-land run recorded on this machine');
    return 1;
  }
  const rem = remaining(st.done);
  console.log(`v${st.to}  started ${st.started}  updated ${st.updated}`);
  console.log(`done:      ${st.done.join(' ') || '-'}`);
  console.log(`current:   ${st.current || '-'}`);
  console.log(`remaining: ${rem.join(' ') || '-'}`);
  if (st.pr) console.log(`pr:        #${st.pr}${st.mergeSha ? ' merged ' + st.mergeSha.slice(0, 8) : ''}`);
  if (st.tag) console.log(`tag:       ${st.tag}`);
  if (st.release) console.log(`release:   ${st.release}`);
  if (st.failed) console.log(`FAILED at ${st.failed.step} (${st.failed.at}):\n  ${st.failed.why.split('\n').join('\n  ')}`);
  console.log('--- last log lines');
  for (const l of st.log.slice(-8)) console.log(l);
  return st.failed ? 1 : rem.length ? 2 : 0;
}

function main(argv) {
  if (argv.includes('--status')) return status();
  if (argv.includes('--dry-run')) {
    const st = newState(argv);
    try {
      RUN.plan(st);
    } catch (e) {
      console.error(String(e.message || e));
      return 1;
    }
    console.log(`DRY RUN — would run: ${STEPS.join(' → ')}`);
    console.log(`  state: ${st.file}\n  session trailer: ${st.session}\n  nothing written`);
    return 0;
  }
  let st;
  if (argv.includes('--resume')) {
    const ptr = loadState(LATEST);
    st = ptr && loadState(ptr.file);
    if (!st) {
      console.error('nothing to resume');
      return 1;
    }
    st.failed = null;
    st.log.push(`[${nowIso().slice(11, 19)}] resume from ${remaining(st.done)[0] || 'nothing'}`);
  } else {
    st = newState(argv);
  }
  return run(st);
}

/* ── selftest ─────────────────────────────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  let ran = 0;
  const ok = (c, m) => {
    ran++;
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      process.exit(1);
    }
  };
  // resume plan
  ok(remaining([]).length === STEPS.length, 'nothing done → every step remains');
  ok(remaining(['plan', 'worktree', 'stamp'])[0] === 'build', 'resume picks the first unfinished step');
  ok(remaining(STEPS).length === 0, 'all done → nothing remains');
  // porcelain classification — planted: a modified ledger, a deleted changeset, an untracked file, a rename
  const cls = classifyStatus(' M CHANGELOG.md\nM  suite.manifest.json\n D changes/2026-09-01-x.md\n?? deploy/\nR  a.js -> b.js\nMM docs/OxyDex.html\n');
  ok(cls.add.length === 3 && cls.add.includes('docs/OxyDex.html'), 'modified (worktree, index, both) → add');
  ok(cls.del.length === 1 && cls.del[0] === 'changes/2026-09-01-x.md', 'deleted changeset → rm --cached');
  ok(cls.untracked.length === 1 && cls.untracked[0] === 'deploy/', 'untracked is REFUSED, never staged');
  ok(cls.other.length === 1 && /^R /.test(cls.other[0]), 'a rename is refused — a release produces none');
  ok(classifyStatus('').add.length === 0, 'empty porcelain → nothing');
  ok(classifyStatus(' M "with space.md"').add[0] === 'with space.md', 'quoted paths are unquoted');
  // changelog section
  const cl = '# Changelog\n\n## [Unreleased]\n\n---\n\n## [2.10.0] — 2026-09-07\n\n### Added\n- thing (`X`)\n\n---\n\n## [2.9.0] — 2026-08-30\n\n### Fixed\n- old\n';
  const sec = changelogSection(cl, '2.10.0');
  ok(sec && sec.includes('- thing') && !sec.includes('- old') && !sec.includes('[2.9.0]'), 'section is exactly one version, stops at the next heading');
  ok(changelogSection(cl, '2.11.0') === null, 'an absent version is null, never an empty release');
  ok(changelogSection(cl, '2.1.0') === null, 'version match is anchored — 2.1.0 must not match 2.10.0');
  // leak scan — a planted hit for every generic rule, and a clean control
  const dirty = 'ok line\nsee /home/someone/x.txt\nhttps://ntfy.sh/topic\nhttps://x.y/abcdefghijklmnopqrstuvwxyz0123456789\nC:\\Users\\me\\f';
  const hits = leakScan(dirty);
  ok(hits.length === 4 && hits.every((h) => h.line >= 2), 'every generic rule fires exactly once on its plant, never on the clean line');
  ok(leakScan('## [2.10.0] — 2026-09-07\n- fix(capture-host): say WHY a night is unknown (#2004)').length === 0, 'a real changelog line is clean');
  ok(leakScan('mentions SECRETWORD here', parseDenylist('# comment\n\nsecretword\n')).length === 1, 'external denylist applies, case-insensitive');
  ok(parseDenylist('a(b').length === 1 && parseDenylist('a(b')[0].test('a(b'), 'an invalid regex is matched literally, not dropped');
  // tag / commit / pr text
  ok(tagArgs('2.11.0', '').join(' ') === 'tag -a v2.11.0 -m v2.11.0', 'no signing key → annotated');
  ok(tagArgs('2.11.0', 'ABC').join(' ') === 'tag -s v2.11.0 -m v2.11.0', 'signing key → signed');
  ok(/^release: v2\.11\.0\n\nFleet-Session: Kestrel$/.test(commitMessage('2.11.0', 'Kestrel')), 'commit message carries the trailer');
  ok(prBody('2.11.0', 'minor', 40, 'Kestrel').split('\n')[0].length < 120, 'PR body first line is one short line');
  // plan parse
  const plan = parsePlan('DRY RUN: 2.10.0 → 2.11.0 (minor)\n\n## [2.11.0]\n\nWould consume: a.md, b.md, c.md\n');
  ok(plan && plan.to === '2.11.0' && plan.level === 'minor' && plan.n === 3, 'plan parsed from release.mjs --dry-run');
  ok(parsePlan('No pending changesets') === null, 'no plan → null');
  // merge verdict
  ok(mergeVerdict({ state: 'MERGED', mergeCommit: { oid: 'abc' } }, 0, 20).sha === 'abc', 'merged → done with sha');
  ok(mergeVerdict({ state: 'OPEN', mergeStateStatus: 'BEHIND' }, 5, 20).action === 'wait', 'BEHIND inside grace → wait (Kodiak serialises)');
  ok(mergeVerdict({ state: 'OPEN', mergeStateStatus: 'BEHIND' }, 25, 20).action === 'land', 'stalled past grace → land-pr fallback');
  ok(mergeVerdict({ state: 'OPEN', mergeStateStatus: 'DIRTY' }, 1, 20).action === 'fail', 'conflict → fail, never update');
  ok(mergeVerdict(null, 1, 20).action === 'wait', 'unreadable → wait');
  ok(mergeVerdict({ state: 'CLOSED' }, 1, 20).action === 'fail', 'closed → fail');
  // every step has a runner, in order
  ok(
    STEPS.every((s) => typeof RUN[s] === 'function'),
    'every declared step has a runner'
  );
  console.log(`selftest: ${ran}/${ran} ok`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
