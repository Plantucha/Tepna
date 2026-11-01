/*
 * board.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE FLEET BOARD — one static page that answers "what is happening and what is wrong".
 *
 * 🔴 LIVE DATA NEVER ENTERS THE REPO. The repo carries this generator and its unit files; the page and
 * its JSON are written to ~/.local/share/tepna/board/, outside any checkout. Token counts, PR state and
 * the owner's plan percentage are facts about this machine and this week, not about the code.
 *
 * ∅ EVERY SECTION REPORTS ITS OWN ABSENCE. A source that cannot be read yields `{ ok: false, reason }`
 * and renders as "not read — <reason>", never as 0 and never as an empty section. A board that shows a
 * confident zero for a source that failed is worse than no board: it answers the question wrongly, and
 * the reader has no way to tell. This is the §∅ rule applied to a dashboard.
 *
 * WHAT IT IS NOT: it is not a gate, it does not decide anything, and it emits no tepna.verdict — it
 * reports what other tools decided. The one judgement it makes is which banner to raise, and those
 * rules are pure functions with planted cases (`--selftest`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPath } from './home-paths.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { slimTranscripts } from './plan-slim.mjs';

const OUT_DIR = process.env.TEPNA_BOARD_DIR || path.join(homedir(), '.local', 'share', 'tepna', 'board');
const REPO = process.env.TEPNA_REPO || path.join(homedir(), 'Tepna');
/* The tailnet address this dashboard and the board web are served on is a PRIVATE address, and a
   tracked file may not carry one (`secret-scan`'s shared-ipv4 rule, required on main since
   2026-10-28). The rig exports TEPNA_BOARD_HOST; without it both sites name the loopback, which is
   right wherever the generator and the server share a box. Found because the home-path sweep
   touched the display line and the DIFF-SCOPED scanner read it for the first time — the twin on the
   `url` field had never been examined. */
const BOARD_HOST = process.env.TEPNA_BOARD_HOST || 'localhost';
/* THE RENDERER'S OWN TREE, which is not always the checkout it reports on. `REPO` is configurable
   and need not exist (CI has no ~/Tepna), so a question about THIS FILE'S dependencies resolves
   against the file's own location. Measured 2026-10-28: the real-tree selftest leg read `REPO` and
   failed in CI with "the renderer's entry file tools/board.mjs could not be read" while passing on
   the box, because the two paths coincide there and nowhere else. */
const SELF_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The board reads the REF, never the checkout's HEAD or working files. The primary checkout stays on
   `main`, lags `origin/main` most of the time and holds other sessions' edits, so `git describe` from
   HEAD named v2.21.0 for a day after v2.22.0 was tagged (measured 2026-10-22: HEAD 61 commits behind),
   and a ledger read from the working copy is the stale read CLAUDE.md §📌 forbids. */
const MAIN_REF = 'origin/main';

/* A section is `{ ok: true, ... }` or `{ ok: false, reason }`. `reason` is the operator's sentence, not
   a stack trace: "gh not authenticated" tells them what to do, "Error: 1" does not. */
const fail = (reason) => ({ ok: false, reason: String(reason).split('\n')[0].slice(0, 160) });

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 60000, ...opts }).trim();
}
/* A tracked file as `MAIN_REF` holds it, and the names in one directory of it. */
const atRef = (rel) => sh('git', ['show', `${MAIN_REF}:${rel}`], { cwd: REPO });
const lsRef = (dir) =>
  sh('git', ['ls-tree', '--name-only', MAIN_REF, `${dir}/`], { cwd: REPO })
    .split('\n')
    .filter(Boolean);

// ── PURE: THE BANNER RULES ────────────────────────────────────────────────────────────────────────
/**
 * Release-watch banner. The owner's case, measured 2026-10-11: a release chain FAILED at `stamp` at
 * 05:09Z on a fixture wall that was already green, the due-timer then refused seven consecutive runs
 * with "a release-land run is recorded unfinished", and nobody noticed for seven hours. The silence is
 * the defect; this is what the banner exists to break.
 */
export function releaseBanner({ dueDays, dueCommits, ageDays, commitsSince, stuckHours, lastVerdict }) {
  const due = ageDays >= dueDays || commitsSince >= dueCommits;
  if (lastVerdict === 'FAIL') return { red: true, why: `the release-due unit's last verdict is FAIL` };
  /* DUE-AND-NOT-CUT for over 12 h. `stuckHours` is the age of an UNFINISHED release-land run; a cut
     that is merely due is not an alarm, and a chain that is mid-run for ten minutes is not either. */
  if (due && stuckHours != null && stuckHours > 12)
    return { red: true, why: `a release is due (${ageDays}d / ${commitsSince} commits) and a release-land run has been unfinished for ${stuckHours.toFixed(1)} h` };
  if (due) return { red: false, amber: true, why: `a release is due: ${ageDays} day(s) and ${commitsSince} commit(s) since the last tag` };
  return { red: false, why: null };
}

/** Main-CI banner: red when main's latest run on a required workflow concluded failure. */
export function ciBanner(runs) {
  if (!Array.isArray(runs) || !runs.length) return { red: false, why: null, unknown: true };
  const bad = runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'cancelled');
  if (!bad.length) return { red: false, why: null };
  return { red: true, why: `main CI: ${bad.map((b) => `${b.name} ${b.conclusion}`).join(' · ')}` };
}

/** Budget bar. `spentPct` is the OWNER'S last reported number — this machine cannot read the plan. */
export function budgetBar({ spentPct, spentPctRange, reportedAt, nowMs, resets = null }) {
  /* A READING FROM THE LAST WEEK IS NOT THIS WEEK'S. A point carries the instant its pool resets; once
     that has passed the number describes a pool that no longer exists. Measured 2026-10-17: a 99 % point
     from 10-13 20:50 stood on the board 3 h 49 min after the 16:00 reset as a "94.9 h old" STALE bar, and
     the owner read it as a live cap. The bar now reports the absence of a new-week reading instead. */
  const resetMs = resets ? Date.parse(resets) : NaN;
  if (isFinite(resetMs) && resetMs <= nowMs) {
    const last = spentPct != null ? `${spentPct} %` : Array.isArray(spentPctRange) ? `${spentPctRange.join('–')} %` : 'a reading';
    return {
      ok: false,
      weekReset: true,
      resets,
      lastPct: spentPct,
      reason: `the week reset at ${String(resets).slice(0, 16).replace('T', ' ')}; the last point (${last} at ${String(reportedAt).slice(0, 16).replace('T', ' ')}) belongs to the pool before it — type /usage and append a point to plan.json`
    };
  }
  /* 🔴 A RANGE STAYS A RANGE. The owner reports what the provider shows them, and that is often a band
     ("27–32 % at 15 h"). Collapsing it to a midpoint would publish a precision nobody measured — the
     §∅ rule at the display boundary: a figure that was not measured as a point is not drawn as one.
     The bar then spans the band instead of standing at a line. */
  if (spentPct == null && Array.isArray(spentPctRange) && spentPctRange.length === 2) {
    const [lo, hi] = spentPctRange.map(Number);
    if (isFinite(lo) && isFinite(hi)) {
      const ageH = reportedAt ? (nowMs - Date.parse(reportedAt)) / 3.6e6 : null;
      return { ok: true, lo, hi, range: true, label: `${lo}–${hi}%`, reportedAt, ageHours: ageH == null ? null : +ageH.toFixed(1), stale: ageH != null && ageH > 24 };
    }
  }
  if (spentPct == null) return { ok: false, reason: 'no owner-reported plan % yet — update plan.json (the allowance is not exposed to a program on this machine)' };
  const ageH = reportedAt ? (nowMs - Date.parse(reportedAt)) / 3.6e6 : null;
  /* AN OLD NUMBER IS NOT A CURRENT NUMBER. The board shows the age beside the figure and goes stale
     past 24 h rather than drawing a confident bar from yesterday's reading. */
  return { ok: true, spentPct, lo: spentPct, hi: spentPct, range: false, label: `${spentPct}%`, reportedAt, ageHours: ageH == null ? null : +ageH.toFixed(1), stale: ageH != null && ageH > 24 };
}

// ── COLLECTORS ────────────────────────────────────────────────────────────────────────────────────
function usage(sinceSpec) {
  try {
    /* A second host's birds (TEPNA_USAGE_REMOTES, space-separated ssh hosts) and the Managed Agents run
       logs (TEPNA_MA_LOGS, space-separated directories) join the table; each unread one is a reason. */
    const remotes = (process.env.TEPNA_USAGE_REMOTES ?? 'vigil').split(/\s+/).filter(Boolean);
    const maLogs = (process.env.TEPNA_MA_LOGS ?? path.join(homedir(), 'tepna-reviews')).split(/\s+/).filter(Boolean);
    const raw = sh(
      'node',
      /* CODE from the renderer's own tree, DATA root passed explicitly. `usage-guard.mjs` defaults its
         project to `primaryCheckout()` derived from its OWN location, so running the current copy
         without `--project` would silently re-aim it at the renderer's clone. */
      [
        path.join(SELF_REPO, 'tools', 'usage-guard.mjs'),
        '--json',
        '--project',
        REPO,
        ...(sinceSpec ? ['--since', sinceSpec] : []),
        ...remotes.flatMap((h) => ['--remote', h]),
        ...maLogs.flatMap((d) => ['--ma-log', d])
      ],
      { cwd: REPO }
    );
    const u = JSON.parse(raw).usage;
    return {
      ok: true,
      window: u.window,
      fleetTokens: u.fleetTokens,
      fleetCacheRead: u.fleetCacheRead,
      sessions: (u.sessions || []).map((s) => ({
        name: s.name,
        tokens: s.tokens,
        cacheRead: s.cacheRead,
        output: s.output,
        thinking: s.thinking,
        messages: s.messages,
        models: s.models || {},
        lastContextTokens: s.lastContextTokens,
        lastContextAt: s.lastContextAt,
        host: s.host ?? null
      })),
      remotes: u.remotes ?? [],
      managedAgents: u.managedAgents ?? { rows: [], read: [] },
      roster: rosterNames(),
      rosterHosts: rosterHosts()
    };
  } catch (e) {
    return fail(`usage-guard --json failed: ${e.message}`);
  }
}

/* The roster, from the CLAUDE.md §0 table (`| **Name** | machine | lane |`): every bird gets a row in the
   token table, and a bird with no transcript read in the window shows as unread, never as 0. */
export function parseRoster(md) {
  const sec =
    String(md)
      .split(/^### 0 · /m)[1]
      ?.split(/^- /m)[0] ?? '';
  const out = [];
  for (const m of sec.matchAll(/^\| \*\*([A-Za-z]+)\*\* \|/gm)) out.push(m[1].toLowerCase());
  return out;
}
/* Name → machine column of the same table, so an unread bird's reason names ITS host, not whichever
   remote failed. Measured 2026-10-17: one failing ssh to the box was printed as the reason on finch,
   a roaming bird no host this board reads has ever carried. */
export function parseRosterHosts(md) {
  const sec =
    String(md)
      .split(/^### 0 · /m)[1]
      ?.split(/^- /m)[0] ?? '';
  const out = {};
  for (const m of sec.matchAll(/^\| \*\*([A-Za-z]+)\*\* \| ([^|]*)\|/gm)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}
function rosterHosts() {
  try {
    return parseRosterHosts(atRef('CLAUDE.md'));
  } catch {
    return {};
  }
}
/* The reason an unread roster bird shows. Pure, so --selftest can plant a failed remote beside a
   roaming bird and a local one. A failed remote is the reason ONLY for a bird whose roster machine
   names that host; a local bird with no transcript in the window says so; a roaming bird says that no
   host this board reads carries it. */
export function unreadReason(name, u) {
  const machine = String((u.rosterHosts || {})[name] || '');
  const remotes = u.remotes || [];
  const failed = remotes.filter((r) => !r.ok).find((r) => machine.toLowerCase().includes(String(r.host).toLowerCase()));
  if (failed) return failed.reason;
  if (!machine) return 'machine not in the §0 roster table';
  if (/roaming/i.test(machine)) return `no host this board reads carries it (${machine})`;
  const read = ['this machine', ...remotes.filter((r) => r.ok).map((r) => r.host)];
  return `no transcript in the window on ${read.join(', ')}`;
}
function rosterNames() {
  try {
    return parseRoster(atRef('CLAUDE.md'));
  } catch {
    return [];
  }
}

/* The walker's queue, in order, from its persisted file. Pure parse on the text so --selftest can plant it. */
export function parseWalkerQueue(txt) {
  const seen = new Set();
  const out = [];
  for (const tok of String(txt).split(/\s+/)) {
    if (!/^\d+$/.test(tok)) continue;
    const n = Number(tok);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
function walkerQueue() {
  const f = process.env.TEPNA_WALKER_QUEUE || path.join(homedir(), '.local', 'state', 'tepna', 'walker', 'undraft-queue.txt');
  if (!existsSync(f)) return [];
  try {
    return parseWalkerQueue(
      readFileSync(f, 'utf-8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join(' ')
    );
  } catch {
    return [];
  }
}

function prs() {
  try {
    const raw = sh('gh', ['pr', 'list', '--state', 'open', '--limit', '40', '--json', 'number,title,isDraft,mergeStateStatus,statusCheckRollup,updatedAt'], { cwd: REPO });
    const list = JSON.parse(raw).map((p) => {
      const buckets = {};
      for (const c of p.statusCheckRollup || []) {
        const k = (c.conclusion || c.status || 'UNKNOWN').toLowerCase();
        buckets[k] = (buckets[k] || 0) + 1;
      }
      return { number: p.number, title: p.title.slice(0, 92), draft: p.isDraft, state: p.mergeStateStatus, buckets, updatedAt: p.updatedAt };
    });
    /* WALKER ORDER is the walker's own queue file when it exists (Kestrel's undraft walker reads it
       by whitespace; numbers no longer open are skipped). Without the file it is Kodiak's order:
       oldest non-draft first. The board printed "walker order: #3473" on 2026-10-12 while nine PRs
       sat in the queue, because it read only the undrafted ones. */
    const open = new Map(list.map((p) => [p.number, p]));
    const queued = walkerQueue().filter((n) => open.has(n));
    const nonDraft = list
      .filter((p) => !p.draft)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
      .map((p) => p.number);
    const order = queued.length ? queued : nonDraft;
    return { ok: true, list, walkerOrder: order, walkerSource: queued.length ? 'walker queue file' : 'Kodiak order of the non-drafts (no walker queue file)', openNonDraft: nonDraft.length };
  } catch (e) {
    return fail(`gh pr list failed: ${e.message}`);
  }
}

function mainCi() {
  try {
    const raw = sh('gh', ['run', 'list', '--branch', 'main', '--limit', '12', '--json', 'name,status,conclusion,createdAt'], { cwd: REPO });
    const runs = JSON.parse(raw);
    /* LATEST PER WORKFLOW, not the latest twelve: a workflow that failed once and passed since is not a
       red main, and a workflow whose last run failed is, however many greens sit above it. */
    const latest = new Map();
    for (const r of runs) if (!latest.has(r.name)) latest.set(r.name, r);
    return { ok: true, runs: [...latest.values()].map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, at: r.createdAt })) };
  } catch (e) {
    return fail(`gh run list failed: ${e.message}`);
  }
}

/* One systemctl list-timers row → "next HH:MM (in X) · last HH:MM (Y ago)". Pure; the raw row is kept
   when the shape is not the one measured on 2026-10-12. */
export function formatTimerRow(row) {
  const r = String(row || '').trim();
  if (!r) return '';
  const m = r.match(/^\w+ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} \w+\s+(.+?)\s+\w+ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} \w+\s+(.+?)\s+\S+\.timer/);
  if (!m) return r;
  const left = /left$/.test(m[3]) ? m[3] : `${m[3]} left`;
  return `next ${m[2]} (${left}) · last ${m[5]} (${m[6]})`;
}

/* Hours an UNFINISHED release-land run has sat on its step. Pure, so --selftest can plant the text.
   A finished run prints `current:   -`, and `-` is no step: it read 34.4 h stuck over a done chain. */
export function landStuckHours(statusText, nowMs) {
  const upd = String(statusText || '').match(/updated (\S+)/);
  const cur = String(statusText || '').match(/current:\s+(\S+)/);
  if (!upd || !cur || cur[1] === '-') return null;
  return +((nowMs - Date.parse(upd[1])) / 3.6e6).toFixed(1);
}

/* THE BOARD IS RENDERED BY THE CHECKOUT IT RUNS IN, AND THAT CHECKOUT LAGS (residue
   2026-10-27-the-board-renders-from-a-checkout-nobody-advances). Every card now READS `origin/main`
   after #3903, and the release card still published `v2.21.0` against a `v2.23.0` tag on 2026-10-27,
   because `tepna-board.service` runs `node tools/board.mjs` from the shared primary checkout and
   that tree sat 166 commits behind the ref. A fix that lands on the ref does not reach the runner,
   so a card can be wrong for days with every input correct. The board cannot advance the shared tree
   — CLAUDE.md §👥.2 forbids it, and other sessions work in it — so it says so instead. Pure, so
   --selftest can plant it. */
export function normaliseRel(fromRel, spec) {
  const parts = `${fromRel.slice(0, fromRel.lastIndexOf('/') + 1)}${spec}`.split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/* THE RENDERER RUNS MORE CODE THAN THE FILE IT IS NAMED AFTER. The banner below used to hash
   `tools/board.mjs` alone, so a checkout whose board.mjs matched the ref reported `stale: false`
   however stale the rest of the renderer was — the row's own evidence cell says it "stays silent for
   a checkout merely behind on commits that never touched the file". MEASURED over this repo's
   history at c2d769c2c: 24 commits have touched the renderer's executable closure and NINE of them
   never touched `tools/board.mjs`. The release card — the one the incident is about — shells out to
   `tools/release-land.mjs` from the running tree, and the usage card to `tools/usage-guard.mjs`.
   In the primary checkout on 2026-10-28, 196 behind, three of the four drifted and the one-file
   check could see only one of the three.

   So the population is derived, not typed: relative `.mjs` imports plus the `path.join(REPO,
   'tools', 'x.mjs')` call sites, followed transitively. A frozen list ages; this one cannot. It
   FAILS CLOSED, because a regex that stops matching would otherwise shrink the population silently
   and every answer would read clean. `readText` is injected, so the rule is testable without a disk.

   🔴 THE CLOSURE SPANS TWO TREES, AND ONLY ONE OF THEM IS THIS FILE'S. An `import` resolves against
   the running file's own directory, so it loads from `SELF_REPO` whatever `REPO` says. A shelled
   call resolves against whichever root its call site names, so the ROOT VARIABLE decides and the
   shape of the call does not (`shellRoots`). Today the two roots coincide and the distinction costs
   nothing. The remedy the row names — repointing the unit at a dedicated checkout — separates them,
   and a comparison that reads every file from one root would then report on code that is not
   running and stay silent about code that is. So each file carries the root it would LOAD from:
   `via[rel]` is `self`, `data`, or both when both reach it.

   🔴 AND A CALL SITE MOVED WITHOUT THE CLASSIFIER IS THE SAME DEFECT WEARING THE FIX. Both shelled
   tools now run from `SELF_REPO`, because a renderer pinned to a current tree that still executes
   the reported checkout's `release-land.mjs` is the release card the whole incident is about. Had
   the rule kept reading `data` for them, the banner would compare those two files in a tree the
   renderer no longer loads them from — silent, green, and wrong in both directions. The two moved
   together, deliberately, and the real-tree leg below pins the pairing.

   A NAME THAT RESOLVES IN NO ROOT IS THE READER'S ARTIFACT, NOT A GAP IN THE MEASUREMENT. The
   shell-call rule reads raw text, so it also matches the call-site example in the comment above and
   the fixtures in this file's own selftest: measured 2026-10-28, `tools/x.mjs` (from that comment)
   and `tools/inner-helper.mjs` (from the plant) joined the real four. Both still fail closed — they
   are REPORTED as `unresolved`, never dropped — but a reader told "I could not compare it" about a
   file that was never there learns nothing, and the two names crowd out the three that matter. */
/* WHICH TREE A SHELLED TOOL LOADS FROM IS THE ROOT VARIABLE AT ITS CALL SITE, never the shape of the
   call. `path.join(SELF_REPO, 'tools', 'x.mjs')` runs the renderer's own copy; `path.join(REPO, ...)`
   runs the reported checkout's. An UNRECOGNISED root returns BOTH, which is the fail-closed
   direction for a staleness detector: comparing a file in a tree it does not load from can only
   raise a banner that is already true of some tree, while dropping the root it DOES load from would
   report current code that is not running. A bare `'tools', 'x.mjs'` with no root — the prose
   example in the comment above — lands here too and is reported, never dropped. */
export function shellRoots(rootIdent) {
  if (rootIdent === 'SELF_REPO') return ['self'];
  if (rootIdent === 'REPO') return ['data'];
  return ['self', 'data'];
}

/* 🔴 AND THE READER MUST NOT READ ITS OWN DOCUMENTATION. The two rules above read RAW TEXT, so
   the call-site example in the comment above and the plant fixtures in the selftest below joined the
   population as `tools/x` and `tools/inner-helper` (residue
   `2026-10-28-the-board-closure-reader-matches-its-own-documentation`). Reporting them as
   `unresolved` told an operator "I could not compare it" about two files that were never there, and
   two ghosts crowded out the three members that matter.

   MEASURED on this file at 1b6dd7f38: of the six shell-pattern matches, THREE execute (the usage
   card, the release card and the selftest's own entry path) and three sit in ONE block comment; of
   the three mid-line relative imports, all three are the selftest plant. So two rules, each one a
   distinction the language already makes:
   · A COMMENT IS NOT CODE. Block comments and statement-position line comments are BLANKED —
     blanked, never deleted, so every line number and every `^` anchor still lands where it did.
   · AN IMPORT IS AN EDGE ONLY AT STATEMENT POSITION. The plant string that spells an import IS an
     import when `readText` hands it over as a file, and is DATA when it sits inside another file.
     Anchoring to `^` separates the two with no list of exceptions.

   A MID-LINE `//` example is still derived, deliberately: stripping one means telling a comment from
   a `//` inside a string, and this file carries URLs in strings. The guard against an OVER-tightened
   reader is the refusal below — a rule that stops matching takes `edges` to 0 and refuses, never
   reporting a clean empty population — plus the real-tree leg, which names every file it must still
   reach. */
export function executableText(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked.replace(/^([ \t]*)\/\/.*$/gm, '$1');
}

export function rendererClosure(entryRel, readText) {
  const via = new Map();
  const unreadable = [];
  const readOk = new Set();
  const queue = [[entryRel, 'self']];
  let edges = 0;
  while (queue.length) {
    const [rel, kind] = queue.shift();
    const kinds = via.get(rel) || new Set();
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    via.set(rel, kinds);
    let text = null;
    try {
      text = readText(rel, kind);
    } catch {
      text = null;
    }
    if (typeof text !== 'string') {
      if (!unreadable.includes(rel)) unreadable.push(rel);
      continue;
    }
    readOk.add(rel);
    const code = executableText(text);
    const imported = [...code.matchAll(/^[ \t]*import\b[^;]*?\bfrom\s+'(\.\.?\/[^']+\.mjs)'/gm)].map((m) => normaliseRel(rel, m[1]));
    const shelled = [...code.matchAll(/(?:([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*)?'tools',\s*'([A-Za-z0-9._-]+\.mjs)'/g)].map((m) => ({ rel: `tools/${m[2]}`, root: m[1] ?? null }));
    edges += imported.length + shelled.length;
    for (const d of imported) queue.push([d, kind]);
    for (const d of shelled) for (const k of shellRoots(d.root)) queue.push([d.rel, k]);
  }
  const unresolved = unreadable.filter((f) => !readOk.has(f)).sort();
  if (unreadable.includes(entryRel)) return { ok: false, reason: `the renderer's entry file ${entryRel} could not be read`, files: [], unreadable, unresolved, via: {} };
  if (edges === 0)
    return {
      ok: false,
      reason: `no dependency was found in ${entryRel} — the closure reader matched nothing, and an empty population would read as clean`,
      files: [],
      unreadable,
      unresolved,
      via: {}
    };
  const readable = [...via.keys()].filter((f) => !unreadable.includes(f)).sort();
  return { ok: true, files: readable, unreadable, unresolved, via: Object.fromEntries(readable.map((f) => [f, [...via.get(f)].sort()])) };
}

/* THE BOARD IS RENDERED BY THE CHECKOUT IT RUNS IN, AND THAT CHECKOUT LAGS (residue
   2026-10-27-the-board-renders-from-a-checkout-nobody-advances). The second argument is the drift
   over the closure above: `{ drifted, unreadable, examined }`, or a bare boolean from the days when
   one file WAS the population — a boolean therefore reports on `tools/board.mjs` and says so, rather
   than borrowing the wider sentence. A file that could not be compared is `null`, never `false`:
   "I could not look" and "they match" are opposite answers (§∅).

   `opts.separateRoots` says the renderer's code and the checkout it reports on are DIFFERENT trees,
   which is what repointing the unit does. The sentence then names which tree each drifted file came
   from, because "the running checkout is 196 behind" reads as a statement about the code when the
   two are one tree and is false about the code when they are not. Default false keeps every
   two-argument caller byte-identical. */
export function runnerVerdict(behind, drift, opts = {}) {
  const n = Number.isFinite(behind) ? behind : null;
  const split = Boolean(opts && opts.separateRoots);
  const subject = split ? 'the checkout it reports on' : 'the running checkout';
  if (n === null) return { stale: null, reason: `${subject} could not be compared with the ref` };
  const d =
    typeof drift === 'boolean'
      ? { drifted: drift ? ['tools/board.mjs'] : [], unreadable: [], examined: ['tools/board.mjs'] }
      : { drifted: [], unreadable: [], examined: [], unresolved: [], ...(drift || {}) };
  const examined = d.examined.length ? d.examined : d.drifted;
  const artifact = (d.unresolved || []).length ? `; ${d.unresolved.length} derived name(s) resolve to no file in either tree (${d.unresolved.join(', ')}), so the closure reader is over-matching` : '';
  const label = (rel) => {
    const k = split && d.via ? d.via[rel] : null;
    if (!k || !k.length) return rel;
    return `${rel} (${k.map((x) => (x === 'self' ? "the renderer's own tree" : 'the checkout it reports on')).join(' and ')})`;
  };
  if (d.drifted.length)
    return {
      stale: true,
      behind: n,
      drifted: d.drifted,
      unreadable: d.unreadable,
      reason: `this board was rendered by code that differs from ${MAIN_REF} — ${d.drifted.length} of the renderer's ${examined.length + d.unreadable.length} file(s): ${d.drifted.map(label).join(', ')}${d.unreadable.length ? `, and ${d.unreadable.length} more could not be compared (${d.unreadable.join(', ')})` : ''} — ${split ? `while ${subject} is ${n} commit(s) behind the ref` : `in a checkout ${n} commit(s) behind it`}${artifact}`
    };
  if (d.unreadable.length)
    return {
      stale: null,
      behind: n,
      drifted: [],
      unreadable: d.unreadable,
      reason: `${d.unreadable.length} of the renderer's file(s) could not be compared with ${MAIN_REF} (${d.unreadable.join(', ')}), so this board cannot say its code matches${artifact}`
    };
  const matches = examined.length === 1 ? `its ${examined[0]} matches the ref` : `all ${examined.length} file(s) of the renderer's own code match the ref`;
  if (n > 0) return { stale: false, behind: n, drifted: [], unreadable: [], reason: `${subject} is ${n} commit(s) behind ${MAIN_REF}, and ${matches}${artifact}` };
  return { stale: false, behind: 0, drifted: [], unreadable: [], reason: artifact ? artifact.slice(2) : null };
}

/* A banner that only fires on `stale === true` drops BOTH absence shapes: the uncomparable checkout
   (`stale: null`) and the section that failed outright (no `stale` at all). Both carry a reason, and
   both are exactly the state an operator must see. The all-clear is the one case that stays quiet. */
export function runnerBannerText(runner) {
  if (!runner || runner.stale === false) return null;
  return runner.reason || null;
}

/* THE QUALIFIER MUST OUTRANK WHAT IT QUALIFIES. This verdict reached the page as a
   `<div class="meta">` inside the header — 12 px, `--dim`, the same class and size as the host name
   and the URL printed beside it — while a failing CI run renders at 18 px bold inside a bordered
   `.banner` block. So the one condition that puts EVERY number below it in doubt was the quietest
   thing on the page, which is the row's own complaint: a reader cannot tell a stale renderer from a
   stale input, because both present as one wrong number beside correct ones. On 2026-10-27 the
   release card's `v2.21.0` against a `v2.23.0` tag was read as a bug in `release()`.

   Drift is MEASURED, so it is red. A renderer that could not be compared is the ABSENCE, so it is
   amber and says which files it could not read — "I could not look" and "they match" are opposite
   answers (§∅), and an absence that renders as nothing is the state an operator most needs. Pure,
   so --selftest can plant it. */
export function runnerBanner(runner) {
  const why = runnerBannerText(runner);
  if (!why) return null;
  return { level: runner && runner.stale === true ? 'red' : 'amber', why: `${why} — every card below it was produced by that code` };
}

/* A banner that qualifies the whole page reads as one more item when it sits among the items it
   qualifies, so it goes FIRST, ahead of the cards whose numbers it doubts. Pure, and it copies
   rather than splices, so the caller's list is never reordered under it. */
export function withRunnerBanner(banners, runner) {
  const rb = runnerBanner(runner);
  return rb ? [rb, ...(banners || [])] : [...(banners || [])];
}

/* EACH FILE IS COMPARED IN THE TREE IT WOULD LOAD FROM — `self` against `SELF_REPO`, `data` against
   `REPO`. With one tree this is the previous behaviour exactly. With two it is the only honest
   reading, and what each file loads from is the root its call site names, so a one-root comparison
   would invert the banner in both directions. `behind` stays a fact about `REPO`, which is the tree
   whose HEAD the operator advances — and which, after a repoint, is no longer the tree that holds
   the code. */
function runner() {
  const rootOf = (kind) => (kind === 'self' ? SELF_REPO : REPO);
  const separateRoots = path.resolve(SELF_REPO) !== path.resolve(REPO);
  try {
    const behind = +sh('git', ['rev-list', '--count', `HEAD..${MAIN_REF}`], { cwd: REPO });
    const clo = rendererClosure('tools/board.mjs', (rel, kind) => readFileSync(path.join(rootOf(kind), rel), 'utf-8'));
    if (!clo.ok) return { ok: true, ...runnerVerdict(behind, { drifted: [], unreadable: ['tools/board.mjs'], examined: [] }, { separateRoots }), closureReason: clo.reason };
    const drifted = [];
    const unreadable = clo.unreadable.filter((f) => !clo.unresolved.includes(f));
    for (const rel of clo.files) {
      for (const kind of clo.via[rel]) {
        const root = rootOf(kind);
        try {
          const here = sh('git', ['hash-object', path.join(root, rel)], { cwd: root });
          const there = sh('git', ['rev-parse', `${MAIN_REF}:${rel}`], { cwd: root });
          if (here !== there && !drifted.includes(rel)) drifted.push(rel);
        } catch {
          if (!unreadable.includes(rel)) unreadable.push(rel);
        }
      }
    }
    return {
      ok: true,
      ...runnerVerdict(behind, { drifted, unreadable, unresolved: clo.unresolved, examined: clo.files.filter((f) => !unreadable.includes(f)), via: clo.via }, { separateRoots }),
      closure: clo.files,
      unresolved: clo.unresolved,
      separateRoots
    };
  } catch (e) {
    return fail(`running-checkout read failed: ${e.message}`);
  }
}

function release() {
  const out = { ok: true };
  try {
    const tag = sh('git', ['describe', '--tags', '--abbrev=0', MAIN_REF], { cwd: REPO });
    const when = sh('git', ['log', '-1', '--format=%cI', tag], { cwd: REPO });
    out.lastTag = tag;
    out.taggedAt = when;
    out.ageDays = +((Date.now() - Date.parse(when)) / 864e5).toFixed(1);
    out.commitsSince = +sh('git', ['rev-list', '--count', `${tag}..${MAIN_REF}`], { cwd: REPO });
  } catch (e) {
    return fail(`git tag read failed: ${e.message}`);
  }
  try {
    out.pendingChangesets = lsRef('changes').filter((f) => f.endsWith('.md') && !/README/.test(f)).length;
  } catch {
    out.pendingChangesets = null;
  }
  try {
    /* `--status` reads `tmpdir()/tepna-release-land`, which is MACHINE-scoped and not under either
       tree, so the current copy reports the same run the stale one did. Measured 2026-10-28 at
       release-land.mjs:79-80 and its status(): no read resolves against that file's own root. */
    const st = sh('node', [path.join(SELF_REPO, 'tools', 'release-land.mjs'), '--status'], { cwd: REPO });
    out.land = st
      .split('\n')
      .slice(0, 6)
      .map((l) => l.trim())
      .filter(Boolean);
    const cur = st.match(/current:\s+(\S+)/);
    out.landCurrentStep = cur && cur[1] !== '-' ? cur[1] : null;
    /* `stuckHours` is only meaningful while a run is UNFINISHED — a `current:` step with no `done` for
       the whole chain. A finished chain has no current step and cannot be stuck. */
    out.landStuckHours = landStuckHours(st, Date.now());
  } catch (e) {
    out.land = null;
    /* --status exits 1 with "no release-land run recorded on this machine" when nothing has run here;
       that is a reading, not a failure to read (the board printed "Command failed: node …" for it). */
    const said = String(e.stdout || '')
      .trim()
      .split('\n')[0];
    out.landNote = /no release-land run recorded/.test(said) ? said : `release-land --status unreadable: ${String(e.message).split('\n')[0].slice(0, 90)}`;
  }
  try {
    const t = sh('bash', ['-c', 'systemctl --user list-timers tepna-release-due.timer --all --no-pager 2>/dev/null | sed -n 2p']);
    out.dueTimer = formatTimerRow(t) || null;
    const j = sh('bash', ['-c', 'journalctl --user -u tepna-release-due -n 40 --no-pager 2>/dev/null | grep -oE "\\"status\\": *\\"[A-Z_]+\\"" | tail -1']);
    const m = j.match(/"([A-Z_]+)"/);
    out.lastVerdict = m ? m[1] : null;
    if (!out.lastVerdict) out.lastVerdictNote = 'no verdict found in the unit journal — the timer may not have emitted one yet';
  } catch {
    out.dueTimer = null;
  }
  return out;
}

/* One row per agent, from every RUNNING herdr session — the birds live in a named session
   (`herdr --session birds`), and a bare `herdr agent list` under the board's timer reaches only the
   default session, which is stopped: measured 2026-10-12, the board printed "(no agents listed)"
   while four birds were working. Pure parse so --selftest can plant the JSON. */
export function herderRows(json, session) {
  let j;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  const agents = j?.result?.agents;
  if (!Array.isArray(agents)) return [];
  return agents.map((a) => `${String(a.name ?? '?').padEnd(10)} ${String(a.agent_status ?? '?').padEnd(8)} ${a.pane_id ?? ''}  ${session}`);
}

function herder() {
  try {
    const sessions = sh('bash', ['-c', 'herdr session list 2>/dev/null'])
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length >= 2 && c[1] === 'running')
      .map((c) => c[0]);
    const rows = [];
    for (const sname of sessions) {
      const out = sh('bash', ['-c', `herdr --session ${sname} agent list 2>/dev/null`]);
      rows.push(...herderRows(out, sname));
    }
    if (!rows.length && !sessions.length) {
      const out = sh('bash', ['-c', 'herdr agent list 2>/dev/null']);
      rows.push(...herderRows(out, 'default'));
    }
    return { ok: true, agents: rows.length ? rows.join('\n') : `(no agents listed — running sessions: ${sessions.join(', ') || 'none'})` };
  } catch (e) {
    return fail(`herdr agent list failed: ${e.message}`);
  }
}

/* The live queue is the LAST "OWNER DECISIONS OPEN" block of Kestrel's evaluation.md (OUT_DIR): the
   header line, then EITHER indented lines joined and split on " · " (the 2026-10-11 form) OR one
   numbered / bulleted line per item (the 2026-10-12 form — the board read a live eight-item block as
   "0 open" because the lines were not indented). The block ends at the first blank line. Pure, so
   --selftest can plant it. Returns null when the file has no such block. */
export function parseOwnerDecisions(txt) {
  const lines = txt.split('\n');
  let start = -1;
  lines.forEach((l, i) => {
    if (/^OWNER DECISIONS OPEN\b/.test(l)) start = i;
  });
  if (start < 0) return null;
  const indented = [];
  const listed = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    const m = l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (m) listed.push(m[1].trim());
    else if (/^\s+\S/.test(l)) indented.push(l.trim());
    else break;
  }
  const items = listed.length
    ? listed
    : indented
        .join(' ')
        .split(/\s+·\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
  return { header: lines[start].trim(), items };
}

/* The reader runs on vigil from stdin. It lived in vigil's /tmp until the box rebooted on 2026-10-18,
   which wiped it, and every board pass after that read "solid-night read failed". Birds may not write
   to vigil, so the script travels with each read and nothing on the box can go stale. */
/* Each row is `date status at bandEnd`, with `-` for a field the verdict does not carry. `at` and the
   band END are what decide whether a night was judged over a FINISHED night — see streakOf. The band
   lives at `result.scope.band`, a two-element epoch-seconds pair; 21 of the 59 verdicts on the box
   carry no scope at all (measured 2026-10-27), so its absence is ordinary and must travel as `-`
   rather than as a zero. */
export const VIGIL_VERDICTS_PY = `import json, os, glob
rows = []
for d in sorted(glob.glob("/srv/tepna/captures/2026-*/")):
    f = os.path.join(d, "SOLID-VERDICT.json")
    if os.path.isfile(f):
        at = "-"
        band_end = "-"
        try:
            s = json.load(open(f))
            status = s["status"]
            at = s.get("at") or "-"
            band = ((s.get("result") or {}).get("scope") or {}).get("band")
            if isinstance(band, (list, tuple)) and len(band) == 2 and isinstance(band[1], (int, float)):
                band_end = repr(float(band[1]))
        except Exception:
            status = "READ_FAIL"
        rows.append(" ".join([os.path.basename(d.rstrip("/")), status, at, band_end]))
print("\\n".join(rows))
`;

/* THE STREAK SKIPS A NIGHT NOBODY HAS FINISHED JUDGING (residue
   2026-10-27-the-streak-counts-a-night-whose-verdict-predates-its-own-band). The old loop skipped an
   in-progress night only when its folder date equalled TODAY in UTC, which is a proxy for two
   different things and matches neither. A night's own band decides when it ends: `result.scope.band`
   is `[start, end]` in epoch seconds, and the solid-night band runs 18:00 to 10:00, so night D is
   still running until D+1 10:00Z. A verdict stamped before that end describes a night that had not
   finished, however many files it saw.

   Measured 2026-10-27 on the live box, both signs inside ten minutes. At 09:06Z the card read
   `Current streak: 0` over 58 nights with 10-25 PASS, because 10-26 then read UNKNOWN and its date
   was not today, so the loop BROKE on an unfinished night. At 09:07:13Z the box re-judged 10-26 to
   PASS over 45 files while its band ran to 10:00Z, so the next render would have read 2 — now
   COUNTING an unfinished night. One rule fixes both: a night judged before its band end neither
   extends the streak nor resets it, which is the shape a declared probe night already uses.

   Two pending kinds, because they ask for different work. `in-progress` is the ordinary case, the
   band has not ended yet. `stale-verdict` means the band HAS ended and nothing re-judged the night,
   which is a box-side omission the card should name rather than absorb.

   ∅: a verdict with no `at` or no band cannot be shown to describe a finished night, so it may not
   count as a PASS. It STOPS the streak with a named reason instead of being skipped — skipping would
   join two non-adjacent nights and claim a consecutiveness nobody measured. Measured cost today:
   none. All 21 band-less verdicts on the box are UNKNOWN or NOT_APPLICABLE, so not one of them is a
   PASS this branch could have counted. Pure, so --selftest can plant it. */
export function streakOf(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const pending = [];
  let streak = 0;
  let stoppedBy = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i] || {};
    const atMs = typeof r.atMs === 'number' && Number.isFinite(r.atMs) ? r.atMs : null;
    const endMs = typeof r.bandEndMs === 'number' && Number.isFinite(r.bandEndMs) ? r.bandEndMs : null;
    if (atMs === null || endMs === null) {
      if (r.status === 'PASS') {
        stoppedBy = { date: r.date, reason: `${r.date} is PASS with no ${atMs === null ? 'verdict time' : 'band'}, so nothing shows it judged a finished night` };
        break;
      }
      stoppedBy = { date: r.date, reason: `${r.date} is ${r.status}` };
      break;
    }
    if (atMs < endMs) {
      const kind = typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs < endMs ? 'in-progress' : 'stale-verdict';
      pending.push({ date: r.date, status: r.status, kind });
      continue;
    }
    if (r.status === 'PASS') {
      streak++;
      continue;
    }
    stoppedBy = { date: r.date, reason: `${r.date} is ${r.status}` };
    break;
  }
  pending.reverse();
  return { streak, pending, stoppedBy };
}

/* The fleet message board (agent-board) is live on this machine and needs no tokens:
   its SQLite DB is readable any time. This section stays fresh even when Kestrel is
   out of tokens — it reports the last post with its date/time, plus the entry count. */
/* The solid-night streak is computed live from vigil's SOLID-VERDICT.json files.
   No hand entry, no Kestrel needed — the rig SSHes to vigil and reads the verdicts.
   Streak = consecutive PASS nights counting back from the most recent verdict. */
function solidNights() {
  try {
    const out = sh(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=no', '-F', process.env.HOME + '/.ssh/config', '-o', 'UserKnownHostsFile=/dev/null', 'vigil', 'python3', '-'],
      { input: VIGIL_VERDICTS_PY, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const rows = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [date, status, at, bandEnd] = l.split(/\s+/);
        const atMs = at && at !== '-' ? Date.parse(at) : Number.NaN;
        const endSec = bandEnd && bandEnd !== '-' ? Number(bandEnd) : Number.NaN;
        return { date, status, at: at && at !== '-' ? at : null, atMs: Number.isFinite(atMs) ? atMs : null, bandEndMs: Number.isFinite(endSec) ? endSec * 1000 : null };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return fail('no SOLID-VERDICT.json files found on vigil');
    const now = Date.now();
    const { streak, pending, stoppedBy } = streakOf(rows, now);
    const pendingBy = new Map(pending.map((p) => [p.date, p.kind]));
    const recent = rows.slice(-15);
    const lines = recent.map((r) => `  ${r.date.slice(5)} ${r.status}${pendingBy.has(r.date) ? ` [pending: ${pendingBy.get(r.date)}]` : ''}`);
    const pendLine = pending.length ? `\npending (neither extends nor resets): ${pending.map((p) => `${p.date} ${p.kind}`).join(', ')}` : '';
    const stopLine = stoppedBy ? `\nstreak stops at ${stoppedBy.reason}` : '';
    const text =
      `live from vigil (read ${new Date(now).toISOString().slice(0, 16)}Z) \u2014 last 15 of ${rows.length} nights\n` +
      lines.join('\n') +
      `\ncurrent streak: ${streak} consecutive PASS night(s)` +
      pendLine +
      stopLine;
    return { ok: true, text, streak, nights: rows.length, pending, stoppedBy };
  } catch (e) {
    return fail('vigil solid-night read failed: ' + e.message);
  }
}

/* Vigil capture daemon + disk, read live over SSH. No tokens needed. */
function vigilHealth() {
  try {
    const active = sh('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'StrictHostKeyChecking=no',
      '-F',
      process.env.HOME + '/.ssh/config',
      '-o',
      'UserKnownHostsFile=/dev/null',
      'vigil',
      'systemctl',
      'is-active',
      'tepna-capture.service'
    ]).trim();
    const disk = sh('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'StrictHostKeyChecking=no',
      '-F',
      process.env.HOME + '/.ssh/config',
      '-o',
      'UserKnownHostsFile=/dev/null',
      'vigil',
      'df',
      '-h',
      '/srv/tepna'
    ])
      .trim()
      .split('\n')
      .pop();
    const sinceTs = new Date(Date.now() - 3600e3).toISOString().slice(0, 19);
    const journal = sh('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'StrictHostKeyChecking=no',
      '-F',
      process.env.HOME + '/.ssh/config',
      '-o',
      'UserKnownHostsFile=/dev/null',
      'vigil',
      'journalctl',
      '-u',
      'tepna-capture.service',
      '--since=' + sinceTs,
      '--no-pager',
      '-n',
      '3'
    ]).trim();
    // Vigil system health (via SSH)
    const vigSys = sh('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'StrictHostKeyChecking=no',
      '-F',
      process.env.HOME + '/.ssh/config',
      '-o',
      'UserKnownHostsFile=/dev/null',
      'vigil',
      'df -h / --output=pcent,avail | tail -1; free -h | grep Mem | awk \'{print $3"/"$2}\'; uptime | grep -o "load average.*"; uptime -p 2>/dev/null || uptime'
    ])
      .trim()
      .split('\n');
    const vigHealth = { disk: (vigSys[0] || '').trim(), mem: (vigSys[1] || '').trim(), load: (vigSys[2] || '').trim(), up: (vigSys[3] || '').trim() };
    // Rig health (local, no SSH needed)
    const rigDisk = sh('df', ['-h', '/', '--output=pcent,avail']).trim().split('\n').pop().trim();
    const rigMem = sh('sh', ['-c', 'free -h | grep Mem | awk \'{print $3"/"$2}\'']).trim();
    const rigLoad = sh('sh', ['-c', 'uptime | grep -o "load average.*"']).trim();
    const rigUp = sh('sh', ['-c', 'uptime -p 2>/dev/null || uptime']).trim();
    return { ok: true, active, disk, journal: journal || '(no journal lines in the last hour)', vig: vigHealth, rig: { disk: rigDisk, mem: rigMem, load: rigLoad, up: rigUp } };
  } catch (e) {
    return fail('vigil health check failed: ' + e.message);
  }
}

/* Quota lookup: only OpenRouter exposes usage via API. Others get a static note. */
function quotaFor(provider) {
  try {
    if (provider === 'openrouter') {
      const out = sh('python3', [
        '-c',
        'import urllib.request,json;' +
          'kp=' +
          JSON.stringify(agentPath('openrouterEnv')) +
          ';' +
          'key=[l.split("=",1)[1].strip().strip(chr(34)+chr(39)) for l in open(kp) if "=" in l and not l.startswith("#")][0];' +
          'r=urllib.request.Request("https://openrouter.ai/api/v1/auth/key",' +
          'headers={"Authorization":"Bearer "+key,"User-Agent":"Tepna-fleet/1.0"});' +
          'd=json.load(urllib.request.urlopen(r,timeout=10))["data"];' +
          'print(f"{d[\"usage\"]:.4f} / {d[\"limit\"]}")'
      ]).trim();
      return '$' + out + ' spent';
    }
  } catch {
    /* fall through to static */
  }
  const notes = {
    groq: 'free tier (no usage API)',
    mistral: 'free tier (no usage API)',
    gemini: 'free tier (no quota API)',
    'qwen-board': 'local, unlimited',
    codex: 'OUT until 2026-11-03',
    anthropic: 'zero credits'
  };
  return notes[provider] || 'unknown';
}

/* API-coder wrapper health: wrappers exist + executable, key files non-empty.
   Never reads key values. Catches a dead wrapper or a revoked key file. */
function wrapperHealth() {
  try {
    const wrappers = ['qwen-board', 'groq-board', 'mistral-board', 'openrouter-board', 'gemini-board'];
    const keyFor = { 'qwen-board': null, 'groq-board': 'groq', 'mistral-board': 'mistral', 'openrouter-board': 'openrouter', 'gemini-board': 'gemini' };
    const cliCoders = [
      { name: 'codex', path: agentPath('codex'), note: 'quota exhausted until 2026-11-03' },
      { name: 'claude-code', path: agentPath('claude-code'), note: 'npm global 2.1.300' }
    ];
    const rows = [];
    for (const w of wrappers) {
      const p = path.join(homedir(), '.local', 'bin', w);
      // executable check via shell
      let okExe = false;
      try {
        sh('sh', ['-c', `test -x "${p}"`]);
        okExe = true;
      } catch {
        okExe = false;
      }
      const kf = keyFor[w];
      let key = 'local (no key)';
      if (kf) {
        const kp = path.join(homedir(), '.config', 'tepna', kf + '.env');
        try {
          const st = sh('sh', ['-c', `test -s "${kp}" && echo yes || echo no`]).trim();
          key = st === 'yes' ? 'key file present' : 'KEY FILE EMPTY/MISSING';
        } catch {
          key = 'key file unreadable';
        }
      }
      rows.push({ wrapper: w, exe: okExe, key, quota: quotaFor(keyFor[w] || w) });
    }
    for (const c of cliCoders) {
      let okExe = false;
      try {
        sh('sh', ['-c', `test -x "${c.path}"`]);
        okExe = true;
      } catch {
        okExe = false;
      }
      rows.push({ wrapper: c.name + ' (cli)', exe: okExe, key: c.note, quota: quotaFor(c.name) });
    }
    return { ok: true, rows };
  } catch (e) {
    return fail('wrapper health check failed: ' + e.message);
  }
}

/* Board activity: posts per day for the last 7 days, from the live DB. */
function boardActivity() {
  try {
    const db = path.join(homedir(), '.agent-board', 'board.db');
    if (!existsSync(db)) return fail('no agent-board DB at ~/.agent-board/board.db');
    const q = (sql) => sh('python3', ['-c', 'import sqlite3,json;db=sqlite3.connect("' + db + '");' + 'print(json.dumps(db.execute("""' + sql + '""").fetchall()))']);
    const days = JSON.parse(q('SELECT substr(created_at,1,10) AS d, COUNT(*) FROM entries ' + "WHERE created_at >= date('now','-7 days') GROUP BY d ORDER BY d"));
    const byAuthor = JSON.parse(q('SELECT author, COUNT(*) FROM entries ' + "WHERE created_at >= date('now','-7 days') GROUP BY author ORDER BY 2 DESC"));
    return { ok: true, days, byAuthor };
  } catch (e) {
    return fail('board activity unreadable: ' + e.message);
  }
}

/* Residue backlog: open rows from the living ledger. No tokens needed. */
function residueBacklog() {
  try {
    const rows = atRef('briefs/RESIDUE.md')
      .split('\n')
      .filter((l) => l.startsWith('| 202'));
    const open = rows.filter((r) => /\| OPEN/.test(r));
    const byMonth = {};
    for (const r of open) {
      const m = r.slice(2, 9);
      byMonth[m] = (byMonth[m] || 0) + 1;
    }
    return { ok: true, open: open.length, total: rows.length, byMonth };
  } catch (e) {
    return fail('residue ledger unreadable: ' + e.message);
  }
}

/* Release countdown: commits and days since the last tag. Due at 100 commits or 7 days. */
function releaseCountdown() {
  try {
    const tag = sh('git', ['describe', '--tags', '--abbrev=0', MAIN_REF], { cwd: REPO }).trim();
    const commits = parseInt(sh('git', ['rev-list', '--count', `${tag}..${MAIN_REF}`], { cwd: REPO }).trim(), 10);
    const tagDate = new Date(sh('git', ['log', '-1', '--format=%cI', tag], { cwd: REPO }).trim());
    const days = (Date.now() - tagDate.getTime()) / 864e5;
    return { ok: true, tag, commits, commitsLeft: 100 - commits, days: +days.toFixed(1), daysLeft: +(7 - days).toFixed(1) };
  } catch (e) {
    return fail('release countdown failed: ' + e.message);
  }
}

/* Open briefs: brief files whose Status is not DONE. */
function openBriefs() {
  try {
    const total = lsRef('briefs').filter((f) => f.endsWith('.md')).length;
    /* `git grep` exits 1 on no match; that is a count of 0, not a failure. */
    let hits = '';
    try {
      hits = sh('git', ['grep', '-l', '-e', 'Status.*DONE', MAIN_REF, '--', ':(glob)briefs/*.md'], { cwd: REPO });
    } catch (e) {
      if (e.status !== 1) throw e;
    }
    const doneN = hits.split('\n').filter(Boolean).length;
    return { ok: true, total, done: doneN, open: total - doneN };
  } catch (e) {
    return fail('brief count failed: ' + e.message);
  }
}

function agentBoard() {
  try {
    const db = path.join(homedir(), '.agent-board', 'board.db');
    if (!existsSync(db)) return fail('no agent-board DB at ~/.agent-board/board.db');
    const q = (sql) => sh('python3', ['-c', 'import sqlite3,json;db=sqlite3.connect("' + db + '");' + 'print(json.dumps(db.execute("""' + sql + '""").fetchall()))']);
    const latest = JSON.parse(q('SELECT e.id, t.title, e.author, e.kind, e.created_at, substr(e.body,1,200) ' + 'FROM entries e JOIN threads t ON e.thread_id=t.id ORDER BY e.id DESC LIMIT 1'));
    const total = JSON.parse(q('SELECT COUNT(*) FROM entries'))[0][0];
    const threads = JSON.parse(q('SELECT COUNT(*) FROM threads'))[0][0];
    if (!latest.length) return { ok: true, total: 0, threads, latest: null };
    const [id, title, author, kind, at, body] = latest[0];
    return { ok: true, total, threads, latest: { id, title, author, kind, at, body } };
  } catch (e) {
    return fail('agent-board DB unreadable: ' + e.message);
  }
}

function ownerDecisions() {
  const evalFile = path.join(OUT_DIR, 'evaluation.md');
  if (existsSync(evalFile)) {
    try {
      const parsed = parseOwnerDecisions(readFileSync(evalFile, 'utf-8'));
      if (parsed) {
        return {
          ok: true,
          source: 'evaluation.md (last OWNER DECISIONS OPEN block)',
          count: parsed.items.length,
          rows: parsed.items.map((r) => r.slice(0, 150))
        };
      }
    } catch (e) {
      return fail(`evaluation.md unreadable: ${e.message}`);
    }
  }
  /* Fallback: the decision-queue brief, read by its "### D<n>" headings. Never by table rows that
     contain the word "open" — on 2026-10-12 that matched a defect row, an answered row and a table
     header, and the owner read four non-decisions as the queue. */
  let text;
  try {
    text = atRef('briefs/OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md');
  } catch {
    return fail('OWNER-DECISION-QUEUE brief not found');
  }
  try {
    const rows = text
      .split('\n')
      .filter((l) => /^### .*\bD\d/.test(l) && !/RULED|ANSWERED|✅/.test(l))
      .map((l) => l.replace(/^###\s*/, '').slice(0, 150))
      .slice(0, 12);
    return { ok: true, source: 'OWNER-DECISION-QUEUE brief headings (no evaluation.md block)', count: rows.length, rows };
  } catch (e) {
    return fail(`OWNER-DECISION-QUEUE unreadable: ${e.message}`);
  }
}

function fileSection(name, rel, note) {
  const f = path.join(OUT_DIR, rel);
  if (!existsSync(f)) return { ok: false, reason: `${rel} not written yet — ${note}` };
  try {
    const txt = readFileSync(f, 'utf-8');
    return { ok: true, text: txt.slice(0, 8000), bytes: txt.length };
  } catch (e) {
    return fail(`${rel} unreadable: ${e.message}`);
  }
}

/* Today's entries only (owner, 2026-10-12: "Kestrel daily evaluation should have only today data").
   An entry starts at a `### ` heading or a `Kestrel daily evaluation — ` line, with or without a
   Markdown heading prefix of its own; entries whose heading carries `today` (YYYY-MM-DD) are kept in
   order. With none dated today the LATEST entry is shown under a dated note, never silently. Pure;
   the file is append-only, so the slice is by heading.

   ⚠️ THE PREFIX IS PART OF THE HEADING, AND A SPLITTER THAT MISSES IT SLICES NOTHING (residue
   2026-10-27-the-evaluation-parser-skips-a-heading-written-as-a-markdown-heading). The writer is
   free to write `## Kestrel daily evaluation — ` and the old pattern matched neither branch, so the
   whole file read as ONE undated part. The failure is not a blank card: `mine` goes empty, the
   fallback shows the LATEST part, and the latest part is the entire file. The note then contradicts
   itself, because `when` reads the first date in the text — measured 2026-10-27 over a two-entry
   plant: `(no entry dated 2026-10-27; showing the latest, 2026-10-27)`. Accept `#` through `######`
   before the words, and nowhere else: a bare `#{1,6} ` splitter would also cut on every subheading
   inside an entry's body. */
export function todaysEntries(txt, today) {
  const HEAD = '### |(?:#{1,6} )?Kestrel daily evaluation — ';
  const parts = txt.split(new RegExp(`^(?=${HEAD})`, 'm')).filter((p) => p.trim());
  const dateOf = (p) => (p.match(new RegExp(`^(?:${HEAD})(\\d{4}-\\d{2}-\\d{2})`)) || [])[1] || null;
  const mine = parts.filter((p) => dateOf(p) === today);
  if (mine.length) return { text: mine.join('\n'), note: null };
  const last = parts.length ? parts[parts.length - 1] : '';
  const when = (last.split('\n')[0].match(/\d{4}-\d{2}-\d{2}/) || ['undated'])[0];
  return { text: last, note: `(no entry dated ${today}; showing the latest, ${when})` };
}

/* The evaluation card shows the work; the owner decisions have their own card (owner, 2026-10-20:
   "OWNER DECISIONS OPEN should be in different card"). Each OWNER DECISIONS OPEN block is cut from the
   card's text, from its header line to the first blank line, which is where parseOwnerDecisions ends
   it too. Pure, so --selftest can plant it. */
export function withoutOwnerDecisions(txt) {
  const out = [];
  let skipping = false;
  for (const l of txt.split('\n')) {
    if (/^OWNER DECISIONS OPEN\b/.test(l)) skipping = true;
    else if (skipping && !l.trim()) skipping = false;
    if (!skipping) out.push(l);
  }
  return out.join('\n');
}

function todaySection(name, rel, note, transform = (x) => x) {
  const f = path.join(OUT_DIR, rel);
  if (!existsSync(f)) return { ok: false, reason: `${rel} not written yet — ${note}` };
  try {
    const txt = readFileSync(f, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const t = todaysEntries(txt, localYMD(new Date()));
    const text = (t.note ? `${t.note}\n\n` : '') + transform(t.text);
    return { ok: true, text: text.slice(0, 8000), bytes: txt.length, today: today };
  } catch (e) {
    return fail(`${rel} unreadable: ${e.message}`);
  }
}

/* The rig's local calendar date — the owner's "today", not UTC's (evaluation headings carry EDT). */
function localYMD(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/* THE PLAN METER, ESTIMATED BETWEEN READINGS (owner, 2026-10-20: "automate maximum"). The owner's usage
   screen is the truth, but it is read by hand a few times a day. ccusage prices this machine's session
   logs at API list rates in 5-hour blocks; that price is not a bill, but it moves with the meter. The
   estimate fits one ratio, plan % per API-equivalent dollar, through the origin over every reading of
   the current week, then applies it to the dollars spent since the week began. Measured 2026-10-20: the
   ratio held at 29-30 % per $1,000 after the first day, and the fit read 57 % against a 58 % reading.
   Pure, so --selftest can plant it. Fewer than two readings this week refuses: one point fits anything. */
export function costBetween(blocks, t0, t1) {
  let s = 0;
  for (const b of blocks) {
    if (!(b.end > b.start) || typeof b.cost !== 'number') continue;
    const lo = Math.max(b.start, t0);
    const hi = Math.min(b.end, t1);
    if (hi > lo) s += (b.cost * (hi - lo)) / (b.end - b.start);
  }
  return s;
}

export function estimatePlan(blocks, readings, weekStartMs, nowMs) {
  const pts = readings
    .map((r) => ({ t: Date.parse(r.at), all: r.all }))
    .filter((r) => Number.isFinite(r.t) && typeof r.all === 'number' && r.t > weekStartMs && r.t <= nowMs)
    .map((r) => ({ ...r, cost: costBetween(blocks, weekStartMs, r.t) }))
    .filter((r) => r.cost > 0);
  if (pts.length < 2) return { ok: false, reason: `${pts.length} plan reading(s) this week; the estimate needs 2` };
  const k = pts.reduce((a, r) => a + r.all * r.cost, 0) / pts.reduce((a, r) => a + r.cost * r.cost, 0);
  const cost = costBetween(blocks, weekStartMs, nowMs);
  const last24 = costBetween(blocks, nowMs - 864e5, nowMs);
  const elapsedH = (nowMs - weekStartMs) / 3.6e6;
  const pct = k * cost;
  const leftH = 168 - elapsedH;
  return {
    ok: true,
    pct: +pct.toFixed(1),
    perKUsd: +(k * 1000).toFixed(1),
    readings: pts.length,
    costUsd: Math.round(cost),
    last24Usd: Math.round(last24),
    pace24hPctPerH: +((k * last24) / 24).toFixed(2),
    sustainablePctPerH: leftH > 0 ? +((100 - pct) / leftH).toFixed(2) : null,
    elapsedPct: Math.round((elapsedH / 168) * 100)
  };
}

/* ccusage is found by $CCUSAGE_BIN, else in the npx cache. Absent → a named refusal, never a 0. */
function planEstimate() {
  try {
    const j = JSON.parse(readFileSync(path.join(OUT_DIR, 'plan.json'), 'utf-8'));
    const readings = Array.isArray(j.usage) ? j.usage : [];
    const last = [...readings].reverse().find((r) => r && r.resets);
    if (!last) return fail('no plan reading carries the weekly reset time');
    const weekStartMs = Date.parse(last.resets) - 7 * 864e5;
    let bin = process.env.CCUSAGE_BIN || null;
    if (!bin) {
      const npx = path.join(homedir(), '.npm', '_npx');
      for (const d of existsSync(npx) ? readdirSync(npx) : []) {
        const c = path.join(npx, d, 'node_modules', 'ccusage', 'src', 'cli.js');
        if (existsSync(c)) bin = c;
      }
    }
    if (!bin) return fail('ccusage not found (set CCUSAGE_BIN)');
    const since = new Date(weekStartMs - 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    const roots = (process.env.CLAUDE_CONFIG_DIR ? process.env.CLAUDE_CONFIG_DIR.split(',') : [path.join(homedir(), '.config', 'claude'), path.join(homedir(), '.claude')]).map((d) =>
      path.join(d.trim(), 'projects')
    );
    const slim = path.join(OUT_DIR, 'plan-slim');
    slimTranscripts(roots, slim, weekStartMs - 2 * 864e5);
    const out = JSON.parse(sh(process.execPath, [bin, 'blocks', '--json', '--offline', '--since', since], { env: { ...process.env, CLAUDE_CONFIG_DIR: slim } }));
    const blocks = (out.blocks || []).filter((b) => !b.isGap).map((b) => ({ start: Date.parse(b.startTime), end: Date.parse(b.actualEndTime || b.endTime), cost: b.costUSD }));
    return estimatePlan(blocks, readings, weekStartMs, Date.now());
  } catch (e) {
    return fail(`plan estimate failed: ${e.message}`);
  }
}

/* THE PACE RESTARTS AT THE WEEKLY RESET, AND REFUSES RATHER THAN SPANNING ONE (residue
   2026-10-27-the-plan-pace-spans-a-weekly-reset-and-reads-negative). The owner's usage percentage
   counts within one allowance week and drops to near zero when the week turns, so the last two
   readings are a pace only while they belong to the SAME week. Measured 2026-10-27 on the live
   plan.json: 10-20 read `all: 41` under `resets: 2026-10-24T16:00-04:00` and 10-26 read `all: 32`
   under `resets: 2026-10-31T16:00-04:00`, and the card published `-0.06 %/h` — a fall in spend that
   never happened. A week is identified by the `resets` stamp the owner's screen shows beside the
   percentage, so the baseline is the previous reading carrying the SAME stamp. One reading in the
   current week is not a slow week, it is an absent measurement: §∅ makes it `null` with a reason,
   never 0. Pure, so --selftest can plant it. */
export function planRate(pts) {
  const none = (reason) => ({ all: null, fable: null, hours: null, reason });
  const rows = Array.isArray(pts) ? pts.filter((p) => p && typeof p.all === 'number' && p.at) : [];
  if (rows.length < 2) return none('the plan readings hold fewer than two points, so there is no pace yet');
  const last = rows[rows.length - 1];
  if (!last.resets) return none('the latest reading names no week reset, so a pace cannot say which week it covers');
  let prev = null;
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].resets === last.resets) {
      prev = rows[i];
      break;
    }
  }
  if (!prev) return none(`the week resetting ${last.resets} holds one reading, so there is no pace within it yet`);
  const hours = (Date.parse(last.at) - Date.parse(prev.at)) / 3.6e6;
  if (!(hours > 0)) return none('the two readings of this week carry no forward time between them');
  const rate = (k) => (typeof prev[k] === 'number' && typeof last[k] === 'number' ? +((last[k] - prev[k]) / hours).toFixed(2) : null);
  return { all: rate('all'), fable: rate('fable'), hours: +hours.toFixed(1), reason: null };
}

function planPct() {
  const f = path.join(OUT_DIR, 'plan.json');
  if (!existsSync(f)) return { spentPct: null, reportedAt: null };
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8'));
    const pts = Array.isArray(j.usage) ? j.usage.filter((p) => p && typeof p.all === 'number' && p.at) : [];
    /* THE LAST USAGE POINT WINS. Kestrel appends `usage[]` points from the owner's screenshots; the
       top-level spentPct is the older single-number form and goes stale the moment a point is added
       (measured 2026-10-12: the bar read 50 % from 10:35 while a 56 % point from 12:28 sat beside it). */
    if (pts.length) {
      const last = pts[pts.length - 1];
      return {
        spentPct: last.all,
        spentPctRange: null,
        reportedAt: last.at,
        resets: last.resets || null,
        note: null,
        point: { all: last.all, fable: typeof last.fable === 'number' ? last.fable : null, session: typeof last.session === 'number' ? last.session : null, at: last.at, resets: last.resets || null },
        rate: planRate(pts),
        points: pts.slice(-4)
      };
    }
    return {
      spentPct: typeof j.spentPct === 'number' ? j.spentPct : null,
      spentPctRange: Array.isArray(j.spentPctRange) ? j.spentPctRange : null,
      reportedAt: j.reportedAt || null,
      note: j.note || null
    };
  } catch {
    return { spentPct: null, reportedAt: null };
  }
}

function rule0Stamp() {
  try {
    const raw = sh('gh', ['pr', 'list', '--state', 'merged', '--limit', '20', '--json', 'number,body,mergedAt'], { cwd: REPO });
    const list = JSON.parse(raw);
    const stamps = [];
    for (const pr of list) {
      const body = pr.body || '';
      const r0 = body.match(/^Rule 0:(.*)$/m);
      if (!r0) continue;
      const fs = body.match(/^Fleet-Session:(.*)$/m);
      stamps.push({
        pr: pr.number,
        lane: r0[1].trim().slice(0, 80),
        coder: fs ? fs[1].trim().slice(0, 40) : 'unstamped',
        mergedAt: pr.mergedAt,
        ageHours: +((Date.now() - Date.parse(pr.mergedAt)) / 3.6e6).toFixed(1)
      });
      if (stamps.length >= 5) break;
    }
    if (!stamps.length) return { ok: true, stamps: [], note: 'no Rule 0 line in the last 20 merged PRs' };
    return { ok: true, stamps };
  } catch (e) {
    return fail(`gh pr list --state merged failed: ${e.message}`);
  }
}

// ── ASSEMBLE ──────────────────────────────────────────────────────────────────────────────────────
export function collect() {
  const now = Date.now();
  const u24 = usage(null);
  const u7 = usage('7d');
  const pr = prs();
  const ci = mainCi();
  const rel = release();
  const plan = planPct();
  const board = {
    schema: 'tepna.board/1',
    generatedAt: new Date(now).toISOString(),
    host: process.env.HOSTNAME || 'rig',
    url: `http://${BOARD_HOST}:8766/`,
    usage24h: u24,
    usage7d: u7,
    budget: budgetBar({ spentPct: plan.spentPct, spentPctRange: plan.spentPctRange, reportedAt: plan.reportedAt, nowMs: now, resets: plan.resets ?? null }),
    planNote: plan.note || null,
    planPoint: plan.point || null,
    planRate: plan.rate || null,
    planEstimate: planEstimate(),
    planPoints: plan.points || null,
    prs: pr,
    mainCi: ci,
    release: rel,
    runner: runner(),
    herder: herder(),
    ownerDecisions: ownerDecisions(),
    agentBoard: agentBoard(),
    residue: residueBacklog(),
    releaseCount: releaseCountdown(),
    briefs: openBriefs(),
    vigilHealth: vigilHealth(),
    wrapperHealth: wrapperHealth(),
    boardActivity: boardActivity(),
    rule0: rule0Stamp(),
    /* The streak is computed on the capture box and no rig-local source exists yet. Until the box
       publishes a summary the rig can read, the section renders a HAND-ENTERED file whose first line
       must say so with a date — a manual entry is a measurement of what a person copied, not of the
       night, and the board says which. Owner, 2026-10-11: "put placeholders in it". */
    solidNights: solidNights(),
    evaluation: todaySection('evaluation', 'evaluation.md', 'Kestrel writes this file; the board only reads it', withoutOwnerDecisions),
    /* The PR walker (tools/pr-walker.mjs, under tepna-pr-walker.timer) writes landing.md every pass:
       one line per open PR with its state, the actions it took, and an ALERT line for every PR it can
       no longer move (red after a rerun, a hand rebase, a stuck or stale required check). */
    landing: fileSection('landing', 'landing.md', 'tools/pr-walker.mjs writes it every pass; absent until the timer is installed')
  };
  const banners = [];
  const cib = ciBanner(ci.ok ? ci.runs : null);
  if (cib.red) banners.push({ level: 'red', why: cib.why });
  if (rel.ok) {
    const rb = releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: rel.ageDays, commitsSince: rel.commitsSince, stuckHours: rel.landStuckHours, lastVerdict: rel.lastVerdict });
    if (rb.red) banners.push({ level: 'red', why: rb.why });
    else if (rb.amber) banners.push({ level: 'amber', why: rb.why });
  }
  if (board.budget.ok && board.budget.stale) banners.push({ level: 'amber', why: `the plan % is ${board.budget.ageHours} h old — re-read /usage and update plan.json` });
  if (!board.budget.ok && board.budget.weekReset) banners.push({ level: 'amber', why: board.budget.reason });
  board.banners = withRunnerBanner(banners, board.runner);
  return board;
}

/** The three lines doc-search prints. Terse on purpose: a summary nobody reads is noise. */
export function summarize(b) {
  const u = b.usage24h;
  const tok = u.ok ? `${(u.fleetTokens / 1e6).toFixed(1)}M fresh/24h` : 'usage unread';
  const bud = b.budget.ok ? `plan ${b.budget.label}${b.budget.stale ? ' (STALE)' : ''}` : b.budget.weekReset ? 'plan %: week reset, new week unread' : 'plan %: not reported';
  const pr = b.prs.ok ? `${b.prs.openNonDraft} open` : 'PRs unread';
  const rel = b.release.ok ? `v${String(b.release.lastTag).replace(/^v/, '')} +${b.release.commitsSince}c/${b.release.ageDays}d` : 'release unread';
  const red = b.banners.filter((x) => x.level === 'red');
  return [
    `board · ${tok} · ${bud} · ${pr} · ${rel}`,
    red.length
      ? `🔴 ${red
          .map((r) => r.why)
          .join(' | ')
          .slice(0, 150)}`
      : `no red banner`,
    `full board: ${path.join(OUT_DIR, 'index.html')}  (generated ${b.generatedAt})`
  ];
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* Human-readable relative time: "2h ago", "3d ago". Falls back to the raw string. */
const ago = (iso) => {
  try {
    const ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms) || ms < 0) return esc(iso);
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  } catch {
    return esc(iso);
  }
};
/* "2026-10-17T08:50:31Z" -> "Oct 17, 04:50 EDT" */
const fmtTime = (iso) => {
  try {
    const d = new Date(iso);
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mo} ${d.getDate()}, ${hh}:${mm}`;
  } catch {
    return esc(iso);
  }
};
const num = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const m = (n) => (typeof n === 'number' && isFinite(n) ? `${(n / 1e6).toFixed(2)}M` : '—');

function sec(title, body, bad) {
  return `<section><h2>${title}${bad ? ' <span class="flag red">needs attention</span>' : ''}</h2>${body}</section>`;
}
function unread(s) {
  return `<p class="unread">not read — ${esc(s.reason)}</p>`;
}

function renderUsage(u, label) {
  if (!u.ok) return unread(u);
  const named = u.sessions.filter((s) => s.name);
  const unnamed = u.sessions.filter((s) => !s.name);
  const rows = named
    .sort((a, b) => b.tokens - a.tokens)
    .map((s) => {
      /* MODEL, not a token dump: "opus-5 ×1,332" reads; "claude-opus-5 1,332" ran into the count.
         Synthetic rows (the harness's own placeholders) carry no model and are left out of the column. */
      const models =
        Object.entries(s.models || {})
          .filter(([k]) => !/^<synthetic>$/.test(k))
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${esc(k.replace(/^claude-/, ''))}&nbsp;<span class="dim">×${num(v)}</span>`)
          .join('<br>') || '—';
      return `<tr><td>${esc(s.name || '(unnamed)')}</td><td class="n">${m(s.tokens)}</td><td class="n dim">${m(s.cacheRead)}</td><td class="n">${m(s.output)}</td><td class="n dim">${num(s.messages)}</td><td class="n dim">${num(s.lastContextTokens)}</td><td class="mdl">${models}</td></tr>`;
    })
    .join('');
  const seen = new Set(named.map((s) => String(s.name).toLowerCase()));
  const missing = (u.roster || [])
    .filter((n) => !seen.has(n))
    .map(
      (n) =>
        `<tr><td>${esc(n)}</td><td class="n dim">—</td><td class="n dim">—</td><td class="n dim">—</td><td class="n dim">—</td><td class="n dim">—</td><td class="dim">not read: ${esc(unreadReason(n, u))}</td></tr>`
    )
    .join('');
  const maRows = (u.managedAgents?.rows || [])
    .map(
      (a) =>
        `<tr><td>API · managed agents</td><td class="n">${m(a.tokens)}</td><td class="n dim">${m(a.cacheRead)}</td><td class="n">${m(a.output)}</td><td class="n dim">${num(a.sessions)} runs</td><td class="n dim">${a.listCostUsd === null ? '—' : `$${a.listCostUsd.toFixed(2)}`}${a.costWithout ? ` <span class="dim">(+${num(a.costWithout)} unpriced)</span>` : ''}</td><td class="mdl">${esc(String(a.model).replace(/^claude-/, ''))}</td></tr>`
    )
    .join('');
  const maUnread = (u.managedAgents?.read || []).filter((r) => !r.ok);
  const maNote = !maRows
    ? `<tr><td class="dim">API · managed agents</td><td colspan="6" class="dim">${maUnread.length ? `not read: ${esc(maUnread.map((r) => `${r.dir} ${r.reason}`).join('; '))}` : 'no run in the window'}</td></tr>`
    : '';
  return `<div class="table-wrap"><table><thead><tr><th>${esc(label)}</th><th>fresh</th><th>cache←</th><th>out</th><th>msgs</th><th>last ctx</th><th>model</th></tr></thead><tbody>${rows}
    ${unnamed.length ? `<tr><td class="dim">+${unnamed.length} unnamed</td><td class="n dim">${m(unnamed.reduce((a, s) => a + (s.tokens || 0), 0))}</td><td class="n dim">${m(unnamed.reduce((a, s) => a + (s.cacheRead || 0), 0))}</td><td class="n dim">${m(unnamed.reduce((a, s) => a + (s.output || 0), 0))}</td><td class="n dim">${num(unnamed.reduce((a, s) => a + (s.messages || 0), 0))}</td><td colspan="2" class="dim">sessions with no bird name, summed</td></tr>` : ''}
    ${missing}
    <tr class="tot"><td>fleet</td><td class="n">${m(u.fleetTokens)}</td><td class="n dim">${m(u.fleetCacheRead)}</td><td colspan="4" class="dim">cache reads are shown beside, never summed into fresh</td></tr>
    ${maRows}${maNote}
    <tr><td colspan="7" class="dim">API rows: the provider's usage per run, list cost in the last-ctx column; billed as API credits, not summed into the fleet line</td></tr></tbody></table></div>`;
}

export function renderHtml(b) {
  const banners = b.banners.map((x) => `<div class="banner ${x.level}">${x.level === 'red' ? '🔴' : '⚠️'} ${esc(x.why)}</div>`).join('');
  const prBody = !b.prs.ok
    ? unread(b.prs)
    : `<p class="dim">walker order: ${
        b.prs.walkerOrder.length
          ? b.prs.walkerOrder
              .map((n) => {
                const p = b.prs.list.find((x) => x.number === n);
                return `#${n}${p && p.draft ? '' : '<b>·open</b>'}`;
              })
              .join(' → ')
          : '(empty)'
      } <span class="dim">(${esc(b.prs.walkerSource || '')}; ${b.prs.openNonDraft} undrafted)</span></p><div class="table-wrap"><table><thead><tr><th>PR</th><th>title</th><th>state</th><th>checks</th></tr></thead><tbody>${b.prs.list
        .map(
          (p) =>
            `<tr><td>#${p.number}${p.draft ? ' <span class="dim">draft</span>' : ''}</td><td>${esc(p.title)}</td><td>${esc(p.state)}</td><td class="dim">${esc(
              Object.entries(p.buckets)
                .map(([k, v]) => `${k}:${v}`)
                .join(' ')
            )}</td></tr>`
        )
        .join('')}</tbody></table></div>`;
  const r = b.release;
  const relBody = !r.ok
    ? unread(r)
    : `<p><b>${esc(r.lastTag)}</b> tagged ${esc(String(r.taggedAt).slice(0, 10))} · <b>${r.ageDays} d</b> ago · <b>${num(r.commitsSince)}</b> commits since · ${num(r.pendingChangesets)} pending changeset(s)
       <span class="dim">(due at 7 d or 100 commits)</span></p>
       <p>release-land: ${r.land ? `<b>${esc(r.landCurrentStep || 'idle')}</b>${r.landStuckHours != null ? ` · unfinished for <b>${r.landStuckHours} h</b>` : ''}` : esc(r.landNote || 'not read')}</p>
       ${r.land ? `<pre>${esc(r.land.join('\n'))}</pre>` : ''}
       <p class="dim">due-timer: ${esc(r.dueTimer || 'not read')}</p>
       <p>last release-due verdict: <b>${esc(r.lastVerdict || '—')}</b>${r.lastVerdictNote ? ` <span class="dim">${esc(r.lastVerdictNote)}</span>` : ''}</p>`;
  const ciBody = !b.mainCi.ok
    ? unread(b.mainCi)
    : `<div class="table-wrap"><table><tbody>${b.mainCi.runs.map((x) => `<tr><td>${esc(x.name)}</td><td class="${x.conclusion === 'failure' ? 'red' : ''}">${esc(x.conclusion || x.status)}</td><td class="dim">${esc(String(x.at).slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</tbody></table></div>`;
  const bud = b.budget.ok
    ? `<div class="bar"><div style="margin-left:${Math.max(0, Math.min(100, b.budget.lo))}%;width:${Math.max(1, Math.min(100, b.budget.hi) - Math.max(0, b.budget.lo))}%"></div></div>
       <p><b>${esc(b.budget.label)}</b>${b.budget.range ? ' <span class="dim">(a band, as reported — not collapsed to a midpoint)</span>' : ''} of the weekly pool, as last reported by the owner${b.budget.ageHours != null ? ` <span class="${b.budget.stale ? 'red' : 'dim'}">(${b.budget.ageHours} h ago${b.budget.stale ? ' — STALE' : ''})</span>` : ''}</p>
       ${b.planPoint ? `<p>All <b>${b.planPoint.all} %</b>${b.planPoint.fable != null ? ` · Fable <b>${b.planPoint.fable} %</b>` : ''}${b.planPoint.session != null ? ` · session ${b.planPoint.session} %` : ''} <span class="dim">at ${esc(String(b.planPoint.at).slice(11, 16))} local${b.planPoint.resets ? `, week resets ${esc(String(b.planPoint.resets).slice(0, 16).replace('T', ' '))}` : ''}</span></p>${b.planRate && b.planRate.all != null ? `<p class="dim">pace since the previous reading of this week (${b.planRate.hours} h): All ${b.planRate.all} %/h${b.planRate.fable != null ? ` · Fable ${b.planRate.fable} %/h` : ''}</p>` : b.planRate && b.planRate.reason ? `<p class="dim">no pace: ${esc(b.planRate.reason)}</p>` : ''}` : b.planNote ? `<p class="dim">${esc(b.planNote)}</p>` : ''}`
    : unread(b.budget);
  const pe = b.planEstimate;
  const est = !pe
    ? ''
    : pe.ok
      ? `<p>Estimated now: <b class="${pe.pace24hPctPerH > (pe.sustainablePctPerH ?? Infinity) ? 'red' : ''}">${pe.pct} %</b> <span class="dim">with ${pe.elapsedPct} % of the week gone · ccusage $${pe.costUsd} API-equivalent × ${pe.perKUsd} % per $1,000, fitted over ${pe.readings} readings</span></p><p class="dim">last 24 h: $${pe.last24Usd} = ${pe.pace24hPctPerH} %/h · sustainable to the reset: ${pe.sustainablePctPerH ?? '—'} %/h</p>`
      : `<p class="dim">Estimate: not read — ${esc(pe.reason)}</p>`;
  const od = b.ownerDecisions;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tepna Fleet Board</title><style>
:root{--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--faint:#6e7681;--line:#21262d;--red:#f85149;--amber:#d29922;--ok:#3fb950;--blue:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
header{padding:22px 0 14px;border-bottom:2px solid var(--line)}
header h1{font-size:19px;margin:0 0 4px;font-weight:700;letter-spacing:-.01em}
header .meta{color:var(--dim);font-size:12px}
/* status line: key numbers inline, no boxes */
.statusline{display:flex;gap:28px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--line);font-size:13px}
.statusline .item{display:flex;gap:8px;align-items:baseline}
.statusline .k{color:var(--dim);font-size:12px}
.statusline .v{font-weight:700;font-size:16px}
.ok{color:var(--ok)}.warn{color:var(--amber)}.bad{color:var(--red)}
/* banners */
.banner{padding:18px 20px;margin:16px 0;font-size:18px;font-weight:700;border-radius:10px;border:2px solid;text-align:center;letter-spacing:.01em}
.banner.red{background:#3d0a0a;border-color:var(--red);color:#ffd7d7}
.banner.amber{background:#3a2c00;border-color:var(--amber);color:#ffe9a8}
.banner.good{background:#0a2e1a;border-color:var(--ok);color:#b8f5d4}
/* sections: no cards, just headings and dividers */
section{padding:20px 0;border-bottom:1px solid var(--line)}
section:last-child{border-bottom:none}
/* summary cards: backlog, release, briefs stay boxed */
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:20px 0;border-bottom:1px solid var(--line)}
.mini-card{background:#161b22;border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.mini-card h3{font-size:11px;margin:0 0 8px;color:var(--faint);text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.mini-card .big{font-size:22px;font-weight:700;margin:0}
.mini-card .sub{color:var(--dim);font-size:12px;margin-top:4px}
/* status cards row */
.status-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}
.status-cards .mini-card{padding:10px 14px}
.status-cards .mini-card h3{margin-bottom:4px}
.status-cards .mini-card .big{font-size:19px}
@media(max-width:900px){.status-cards{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.status-cards{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.cards3{grid-template-columns:1fr}}
h2{font-size:12px;margin:0 0 12px;color:var(--faint);text-transform:uppercase;letter-spacing:.1em;font-weight:600}
h2 .flag{margin-left:8px;text-transform:none;letter-spacing:0}
/* key-value rows */
.kv{display:grid;grid-template-columns:180px 1fr;gap:4px 16px;font-size:13px;margin:6px 0}
.kv dt{color:var(--dim);margin:0}
.kv dd{margin:0}
.kv dd b{font-weight:600}
/* tables */
.table-wrap{overflow-x:auto;margin:8px -4px;padding:0 4px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:7px 12px 7px 0;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}
th{color:var(--dim);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--line)}
td.wrap, th.wrap{white-space:normal;min-width:200px}
.n{text-align:right;font-variant-numeric:tabular-nums}
tr.tot td{border-top:2px solid var(--line);font-weight:700;border-bottom:none}
.dim{color:var(--dim)}.red{color:var(--red)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
/* progress bar */
.bar{height:8px;background:#161b22;border-radius:4px;overflow:hidden;margin:6px 0;max-width:400px}
.bar>div{height:100%;background:linear-gradient(90deg,var(--ok),var(--amber));border-radius:4px}
/* posts */
.post{margin:12px 0;padding:12px 0;border-top:1px solid var(--line)}
.post:first-of-type{border-top:none;padding-top:0}
.post-meta{display:flex;gap:10px;align-items:baseline;margin-bottom:6px;font-size:12px}
.post-meta .who{font-weight:700;font-size:13px}
.post-meta .when{color:var(--dim)}
.post-body{font-size:13px;white-space:pre-wrap;color:var(--fg);margin:0}
pre{background:#161b22;border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--dim);overflow-x:auto;margin:8px 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#161b22;padding:2px 6px;border-radius:4px}
.unread{color:var(--amber);font-style:italic;font-size:13px}
footer{padding:20px 0;color:var(--dim);font-size:12px;border-top:2px solid var(--line);margin-top:8px}
p{margin:8px 0}
@media(prefers-color-scheme:light){:root{--bg:#ffffff;--fg:#1f2328;--dim:#59636e;--faint:#8b949e;--line:#e5e8ec}}
@media(max-width:640px){.wrap{padding:0 16px}.kv{grid-template-columns:1fr;gap:2px}.kv dt{margin-top:8px}.statusline{gap:16px}.table-wrap table{min-width:560px}}
</style></head><body>
<div class="wrap">
<header><h1>Tepna fleet board</h1><div class="meta">${esc(b.generatedAt)} &middot; ${esc(b.host)} &middot; <code>${esc(b.url)}</code></div></header>
${banners}
<div class="status-cards">
<div class="mini-card"><h3>daemon</h3><p class="big ${b.vigilHealth.ok && b.vigilHealth.active === 'active' ? 'ok' : 'bad'}">${b.vigilHealth.ok ? esc(b.vigilHealth.active) : 'unknown'}</p></div>
<div class="mini-card"><h3>streak</h3><p class="big ${b.solidNights.ok && b.solidNights.streak > 0 ? 'ok' : 'warn'}">${b.solidNights.ok ? b.solidNights.streak : '?'}</p></div>
<div class="mini-card"><h3>open PRs</h3><p class="big">${b.prs.ok ? b.prs.list.length : '?'}</p></div>
<div class="mini-card"><h3>weekly</h3><p class="big ${b.budget.ok && !b.budget.stale ? '' : 'warn'}">${b.budget.ok ? esc(b.budget.label) : '?'}</p></div>
<div class="mini-card"><h3>release</h3><p class="big">${b.releaseCount.ok ? b.releaseCount.commitsLeft + 'c/' + b.releaseCount.daysLeft + 'd' : '?'}</p></div>
</div>
<main>
<div class="cards3">
<div class="mini-card"><h3>Backlog</h3>${
    b.residue.ok
      ? `<p class="big">${b.residue.open}</p><div class="sub">open residue rows (${b.residue.total} total)</div><div class="sub">${Object.keys(b.residue.byMonth)
          .sort()
          .map((m) => `${m}: ${b.residue.byMonth[m]}`)
          .join(' &middot; ')}</div>`
      : `<p class="unread">not read</p>`
  }</div>
<div class="mini-card"><h3>Release</h3>${b.releaseCount.ok ? `<p class="big">${b.releaseCount.tag}</p><div class="sub">+${b.releaseCount.commits} commits (${b.releaseCount.commitsLeft} left)</div><div class="sub">${b.releaseCount.days}d ago <span class="${b.releaseCount.daysLeft < 0 ? 'red' : ''}">(${b.releaseCount.daysLeft}d left)</span></div>` : `<p class="unread">not read</p>`}</div>
<div class="mini-card"><h3>Briefs</h3>${b.briefs.ok ? `<p class="big">${b.briefs.open}</p><div class="sub">open (${b.briefs.done} done, ${b.briefs.total} total)</div>` : `<p class="unread">not read</p>`}</div>
</div>
${sec('Token usage <span class="sub">last 24 hours</span>', renderUsage(b.usage24h, 'bird'), !b.usage24h.ok)}
${sec('Token usage <span class="sub">last 7 days</span>', renderUsage(b.usage7d, 'bird'), !b.usage7d.ok)}
${sec('Weekly allowance', bud + est, b.budget.ok && b.budget.stale)}
${sec(
  'Release watch',
  relBody,
  b.banners.some((x) => x.level === 'red' && /release/i.test(x.why))
)}
${sec('Open pull requests', prBody, !b.prs.ok)}
${sec('PR landing status', b.landing.ok ? `<pre>${esc(b.landing.text)}</pre>` : unread(b.landing), b.landing.ok && /^ALERT /m.test(b.landing.text))}
${sec(
  'main CI',
  ciBody,
  b.banners.some((x) => x.level === 'red' && /main CI/.test(x.why))
)}
${sec('Agent sessions', b.herder.ok ? `<pre>${esc(b.herder.agents)}</pre>` : unread(b.herder))}
${sec('Rule 0 compliance', b.rule0.ok ? (b.rule0.stamps && b.rule0.stamps.length ? `<div class="table-wrap"><table><thead><tr><th>PR</th><th>coder</th><th>lane</th><th>merged</th></tr></thead><tbody>${b.rule0.stamps.map((x) => `<tr><td class="n">#${x.pr}</td><td>${esc(x.coder)}</td><td class="dim">${esc(x.lane)}</td><td class="dim">${x.ageHours} h ago</td></tr>`).join('')}</tbody></table></div>` : `<p class="dim">${esc(b.rule0.note || 'no stamps')}</p>`) : unread(b.rule0), !b.rule0.ok)}
${sec('Vigil health', b.vigilHealth.ok ? `<p>Capture daemon: <b class="${b.vigilHealth.active === 'active' ? '' : 'red'}">${esc(b.vigilHealth.active)}</b></p><p class="dim">Disk /srv/tepna: ${esc(b.vigilHealth.disk)}</p>${b.vigilHealth.vig ? `<p><b>Vigil</b> <span class="dim">disk ${esc(b.vigilHealth.vig.disk)} · mem ${esc(b.vigilHealth.vig.mem)} · ${esc(b.vigilHealth.vig.load)}</span><br><span class="dim">${esc(b.vigilHealth.vig.up)}</span></p>` : ''}<pre>${esc(b.vigilHealth.journal)}</pre>${b.vigilHealth.rig ? `<p style="margin-top:12px"><b>Rig</b> <span class="dim">disk ${esc(b.vigilHealth.rig.disk)} · mem ${esc(b.vigilHealth.rig.mem)} · ${esc(b.vigilHealth.rig.load)}</span><br><span class="dim">${esc(b.vigilHealth.rig.up)}</span></p>` : ''}` : unread(b.vigilHealth))}
${sec('API wrappers', b.wrapperHealth.ok ? `<div class="table-wrap"><table><thead><tr><th>wrapper</th><th>executable</th><th>key</th><th>quota</th></tr></thead><tbody>${b.wrapperHealth.rows.map((r) => `<tr><td>${esc(r.wrapper)}</td><td class="${r.exe ? '' : 'red'}">${r.exe ? 'yes' : 'NO'}</td><td class="${/MISSING|unreadable/.test(r.key) ? 'red' : 'dim'}">${esc(r.key)}</td><td class="${/OUT|zero/.test(r.quota) ? 'red' : 'dim'}">${esc(r.quota)}</td></tr>`).join('')}</tbody></table></div>` : unread(b.wrapperHealth))}
${sec('Board activity <span class="sub">last 7 days</span>', b.boardActivity.ok ? (b.boardActivity.days.length ? `<div class="table-wrap"><table><thead><tr><th>day</th><th class="n">posts</th></tr></thead><tbody>${b.boardActivity.days.map((d) => `<tr><td>${esc(d[0])}</td><td class="n">${d[1]}</td></tr>`).join('')}</tbody></table></div><p class="dim">by author: ${b.boardActivity.byAuthor.map((a) => `${esc(a[0])} (${a[1]})`).join(', ')}</p>` : '<p class="dim">no posts in the last 7 days</p>') : unread(b.boardActivity))}
${sec('Message board <span class="sub">latest post</span>', b.agentBoard.ok ? (b.agentBoard.latest ? `<div class="post-meta"><b>#${b.agentBoard.latest.id}</b><span>${esc(b.agentBoard.latest.author)}</span><span class="post-time">${esc(b.agentBoard.latest.kind)} &middot; ${fmtTime(b.agentBoard.latest.at)} (${ago(b.agentBoard.latest.at)})</span></div><div class="dim">${esc(b.agentBoard.latest.title)}</div><div class="post-body">${esc(b.agentBoard.latest.body)}</div><p class="dim">${b.agentBoard.total} entries &middot; ${b.agentBoard.threads} threads</p><p class="dim">CLI: <code>~/.local/bin/agent-board</code> &middot; DB: <code>~/.agent-board/board.db</code> &middot; web: <code>http://${esc(BOARD_HOST)}:8765</code></p>` : '<p class="dim">The board is empty &mdash; no posts yet.</p>') : unread(b.agentBoard), !b.agentBoard.ok)}
${sec('owner decisions', od.ok ? `<p><b>${od.count}</b> open <span class="dim">(${esc(od.source || '')})</span></p><pre>${esc(od.rows.join('\n'))}</pre>` : unread(od))}
${sec('Solid-night streak', b.solidNights.ok ? `<p>Current streak: <b>${b.solidNights.streak}</b> consecutive PASS night(s) <span class="dim">(${b.solidNights.nights} nights with verdicts)</span></p><pre>${esc(b.solidNights.text)}</pre>` : unread(b.solidNights))}
${sec('Daily evaluation', b.evaluation.ok ? `<pre>${esc(b.evaluation.text)}</pre>` : unread(b.evaluation))}
</main>
</div>
<footer><div class="wrap">Generated by <code>tools/board.mjs</code> into <code>${esc(OUT_DIR)}</code> — outside any checkout. Live data never enters the repo.
Every section reports its own absence: "not read" is a measurement, 0 would be a fabrication.</footer>
</body></html>`;
}

function runSelftest() {
  const fails = [];
  let ran = 0;
  const ok = (c, msg) => {
    ran += 1;
    if (!c) fails.push(msg);
  };
  // ── release banner: the owner's measured case is the plant ──
  const owner = releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 6, commitsSince: 118, stuckHours: 7.5, lastVerdict: null });
  ok(!owner.red && owner.amber, 'due by commits with a 7.5 h stall is AMBER, not red — the 12 h rule has not tripped yet');
  const past12 = releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 6, commitsSince: 118, stuckHours: 12.5, lastVerdict: null });
  ok(past12.red && /unfinished for 12.5 h/.test(past12.why), 'due AND unfinished past 12 h is RED and says for how long');
  ok(releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 1, commitsSince: 2, stuckHours: null, lastVerdict: 'FAIL' }).red, 'a FAIL verdict is RED on its own, even when nothing is due');
  ok(!releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 1, commitsSince: 2, stuckHours: null, lastVerdict: 'PASS' }).red, 'CONTROL · nothing due and a PASS verdict is not red');
  ok(!releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 8, commitsSince: 3, stuckHours: 0.2, lastVerdict: null }).red, 'CONTROL · a chain running for 12 minutes is not a stall');
  ok(releaseBanner({ dueDays: 7, dueCommits: 100, ageDays: 8, commitsSince: 3, stuckHours: null, lastVerdict: null }).amber, 'due by AGE alone is amber');
  // ── CI banner ──
  ok(ciBanner([{ name: 'test', conclusion: 'failure' }]).red, 'a failed required run reds main CI');
  ok(ciBanner([{ name: 'test', conclusion: 'cancelled' }]).red, 'a CANCELLED run reds too — a cancelled check reads as pend=0 elsewhere and must not read as green here');
  ok(!ciBanner([{ name: 'test', conclusion: 'success' }]).red, 'CONTROL · a green main is not red');
  ok(ciBanner([]).unknown && !ciBanner([]).red, 'NO RUNS is UNKNOWN, never green — an empty list is not evidence of health');
  ok(ciBanner(null).unknown, 'an unread run list is UNKNOWN, never green');
  // ── budget bar ──
  ok(!budgetBar({ spentPct: null, reportedAt: null, nowMs: Date.now() }).ok, 'no reported % is NOT 0 % — it reports its own absence');
  const fresh = budgetBar({ spentPct: 30, reportedAt: new Date(Date.now() - 3.6e6).toISOString(), nowMs: Date.now() });
  ok(fresh.ok && !fresh.stale && fresh.ageHours === 1, 'a 1 h old reading is fresh and carries its age');
  ok(budgetBar({ spentPct: 30, reportedAt: new Date(Date.now() - 30 * 3.6e6).toISOString(), nowMs: Date.now() }).stale, 'a 30 h old reading is STALE — an old number is not a current number');
  {
    const gone = budgetBar({ spentPct: 99, reportedAt: '2026-10-13T20:50-04:00', nowMs: Date.parse('2026-10-17T23:49Z'), resets: '2026-10-17T16:00-04:00' });
    ok(
      !gone.ok && gone.weekReset && /week reset at 2026-10-17 16:00/.test(gone.reason) && /99 %/.test(gone.reason),
      'a point whose pool has reset is NOT a current reading — it reports the reset and the absence of a new one'
    );
    const live = budgetBar({ spentPct: 99, reportedAt: '2026-10-13T20:50-04:00', nowMs: Date.parse('2026-10-14T00:00Z'), resets: '2026-10-17T16:00-04:00' });
    ok(live.ok && live.spentPct === 99, 'before the reset the same point is the reading');
    ok(budgetBar({ spentPct: 40, reportedAt: new Date().toISOString(), nowMs: Date.now(), resets: 'not a date' }).ok, 'an unparseable reset instant is ignored, never a false reset');
  }
  const band = budgetBar({ spentPct: null, spentPctRange: [27, 32], reportedAt: new Date(Date.now() - 3.6e6).toISOString(), nowMs: Date.now() });
  ok(band.ok && band.range && band.label === '27–32%' && band.lo === 27 && band.hi === 32, 'a reported BAND stays a band and is labelled as one');
  ok(!('spentPct' in band) || band.spentPct == null, 'a band does not invent a point value — no midpoint is published');
  // ── the section contract ──
  ok(fail('x').ok === false && typeof fail('x').reason === 'string', 'a failed section carries ok:false and a reason string');
  ok(!/\n/.test(fail('a\nb').reason), 'a reason is one line — a stack trace is not an operator sentence');
  const s3 = summarize({
    usage24h: { ok: false, reason: 'r' },
    budget: { ok: false, reason: 'r' },
    prs: { ok: false, reason: 'r' },
    release: { ok: false, reason: 'r' },
    banners: [],
    generatedAt: 'T'
  });
  ok(s3.length === 3, 'the summary is exactly three lines');
  ok(/usage unread/.test(s3[0]) && /not reported/.test(s3[0]), 'an all-unread board SAYS unread in its summary rather than printing zeros');
  ok(/no red banner/.test(s3[1]), 'the second line names the red banner or says there is none');
  const html = renderHtml({
    generatedAt: 'T',
    host: 'h',
    banners: [],
    usage24h: { ok: false, reason: 'u' },
    usage7d: { ok: false, reason: 'u' },
    budget: { ok: false, reason: 'b' },
    prs: { ok: false, reason: 'p' },
    mainCi: { ok: false, reason: 'c' },
    release: { ok: false, reason: 'r' },
    herder: { ok: false, reason: 'h' },
    ownerDecisions: { ok: false, reason: 'o' },
    rule0: { ok: false, reason: 'x' },
    solidNights: { ok: false, reason: 's' },
    evaluation: { ok: false, reason: 'e' },
    landing: { ok: false, reason: 'l' },
    agentBoard: { ok: false, reason: 'a' },
    residue: { ok: false, reason: 'rs' },
    releaseCount: { ok: false, reason: 'rc' },
    briefs: { ok: false, reason: 'br' },
    vigilHealth: { ok: false, reason: 'v' },
    wrapperHealth: { ok: false, reason: 'w' },
    boardActivity: { ok: false, reason: 'ab' }
  });
  ok(/not read —/.test(html) && !/>0</.test(html.replace(/width:0%/g, '')), 'an all-unread board renders "not read", never a 0');
  /* A hand-entered solid-night file renders its text (its first line names itself MANUAL with a date),
     and the section no longer reads as absent — the two states must be distinguishable on the page. */
  const htmlManual = renderHtml({
    generatedAt: 'T',
    host: 'h',
    banners: [],
    usage24h: { ok: false, reason: 'u' },
    usage7d: { ok: false, reason: 'u' },
    budget: { ok: false, reason: 'b' },
    prs: { ok: false, reason: 'p' },
    mainCi: { ok: false, reason: 'c' },
    release: { ok: false, reason: 'r' },
    herder: { ok: false, reason: 'h' },
    ownerDecisions: { ok: false, reason: 'o' },
    rule0: { ok: false, reason: 'x' },
    solidNights: { ok: true, text: 'live streak: 3', streak: 3, nights: 10 },
    evaluation: { ok: false, reason: 'e' },
    landing: { ok: false, reason: 'l' },
    agentBoard: { ok: false, reason: 'a' },
    residue: { ok: false, reason: 'rs' },
    releaseCount: { ok: false, reason: 'rc' },
    briefs: { ok: false, reason: 'br' },
    vigilHealth: { ok: false, reason: 'v' },
    wrapperHealth: { ok: false, reason: 'w' },
    boardActivity: { ok: false, reason: 'ab' }
  });
  const solidSec = htmlManual.split('Solid-night streak')[1]?.split('</section>')[0] ?? '';
  ok(
    solidSec.includes('Current streak:') && solidSec.includes('live streak: 3') && !solidSec.includes('not read'),
    'a live solid-night read renders its streak, and that section no longer reads as absent'
  );
  ok(
    /&lt;script&gt;/.test(
      renderHtml({
        generatedAt: '<script>',
        host: 'h',
        banners: [],
        usage24h: { ok: false, reason: 'u' },
        usage7d: { ok: false, reason: 'u' },
        budget: { ok: false, reason: 'b' },
        prs: { ok: false, reason: 'p' },
        mainCi: { ok: false, reason: 'c' },
        release: { ok: false, reason: 'r' },
        herder: { ok: false, reason: 'h' },
        ownerDecisions: { ok: false, reason: 'o' },
        rule0: { ok: false, reason: 'x' },
        solidNights: { ok: false, reason: 's' },
        evaluation: { ok: false, reason: 'e' },
        landing: { ok: false, reason: 'l' },
        agentBoard: { ok: false, reason: 'a' },
        residue: { ok: false, reason: 'rs' },
        releaseCount: { ok: false, reason: 'rc' },
        briefs: { ok: false, reason: 'br' },
        vigilHealth: { ok: false, reason: 'v' },
        wrapperHealth: { ok: false, reason: 'w' },
        boardActivity: { ok: false, reason: 'ab' }
      })
    ),
    'every interpolated value is escaped — the board reads PR titles and journal text'
  );
  {
    const planted = parseOwnerDecisions(
      'BUDGET\n  x\n\nOWNER DECISIONS OPEN\n  a thing · b thing (with, commas) · c thing\n\nRISKS\n  none\n\nUPDATE — later\nOWNER DECISIONS OPEN\n  only this one\n  and its second line\n\nNEXT\n'
    );
    ok(planted && planted.items.length === 1 && planted.items[0] === 'only this one and its second line', 'owner decisions come from the LAST block, its indented lines joined, items split on " · "');
    const first = parseOwnerDecisions('OWNER DECISIONS OPEN\n  a thing · b thing (with, commas) · c thing\n');
    ok(first && first.items.length === 3 && first.items[1] === 'b thing (with, commas)', 'items split on " · " only, commas stay inside an item');
    ok(parseOwnerDecisions('no block here\n| **85** | open row |\n') === null, 'a file without the block yields null, never a table row that says "open"');
  }
  {
    const numbered = parseOwnerDecisions('### tick\n- note\n\nOWNER DECISIONS OPEN\n1. deploy main\n2. heap probe (box)\n3. reload skills\n\n### later\n');
    ok(
      numbered && numbered.items.length === 3 && numbered.items[1] === 'heap probe (box)',
      'an unindented numbered list is one item per line, ended by the blank line (2026-10-12: a live 8-item block read as 0 open)'
    );
    const bulleted = parseOwnerDecisions('OWNER DECISIONS OPEN\n- a\n- b\n');
    ok(bulleted && bulleted.items.length === 2, 'a bulleted list is one item per line');
  }
  {
    const txt = '### 2026-10-11 09:00 EDT (the cadence starts 2026-10-12)\nold\n\nKestrel daily evaluation — 2026-10-12 07:41 EDT\nmorning\n\n### 2026-10-12 11:35 EDT — tick\nnoon\n';
    const t = todaysEntries(txt, '2026-10-12');
    ok(
      t.note === null && !t.text.includes('old') && t.text.includes('morning') && t.text.includes('noon'),
      'the evaluation section keeps every entry whose heading DATE is today and drops older ones, even one that mentions today in its text'
    );
    const none = todaysEntries(txt, '2026-10-13');
    ok(none.note === '(no entry dated 2026-10-13; showing the latest, 2026-10-12)' && none.text.includes('noon'), 'with no entry dated today the latest entry is shown under a dated note');
  }
  {
    const ev = 'WORKING NOW\n- heron #3750\n\nOWNER DECISIONS OPEN\n1. deploy main\n2. heap probe\n\nRISKS / DEFECTS SEEN\n1. stale mergeable\n';
    const cut = withoutOwnerDecisions(ev);
    ok(
      !cut.includes('deploy main') && !cut.includes('OWNER DECISIONS OPEN') && cut.includes('heron #3750') && cut.includes('stale mergeable'),
      'the evaluation card drops the OWNER DECISIONS OPEN block and keeps the blocks around it (owner, 2026-10-20)'
    );
    ok(parseOwnerDecisions(ev).items.length === 2, 'the owner decisions card still reads the block from the same text');
  }
  {
    const H = 3.6e6;
    const w0 = Date.parse('2026-10-17T20:00:00Z');
    const blocks = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45].map((h) => ({ start: w0 + h * H, end: w0 + (h + 5) * H, cost: 100 }));
    ok(costBetween(blocks, w0, w0 + 2.5 * H) === 50, 'cost inside one block is prorated by time');
    const at = (h) => new Date(w0 + h * H).toISOString();
    const est = estimatePlan(
      blocks,
      [
        { at: at(10), all: 6 },
        { at: at(20), all: 12 },
        { at: at(-5), all: 99 }
      ],
      w0,
      w0 + 30 * H
    );
    ok(est.ok && est.pct === 18 && est.perKUsd === 30 && est.readings === 2, 'the ratio fits through the origin over this week only: 600 $ x 30 %/k$ = 18 %');
    const one = estimatePlan(blocks, [{ at: at(10), all: 6 }], w0, w0 + 30 * H);
    ok(!one.ok && /needs 2/.test(one.reason), 'one reading this week refuses with a reason, never a number');
  }
  {
    const rows = herderRows('{"id":"x","result":{"agents":[{"name":"kestrel","agent_status":"working","pane_id":"w1:p1"},{"name":"magpie","agent_status":"idle","pane_id":"w1:p6"}]}}', 'birds');
    ok(rows.length === 2 && /^kestrel\s+working\s+w1:p1\s+birds$/.test(rows[0]), 'herder rows are name · status · pane · session from the session JSON');
    ok(
      parseWalkerQueue('# queue\n3475\n3476\n3478 3479 3480 3481 3482 3483\n').join(',') === '3475,3476,3478,3479,3480,3481,3482,3483',
      'the walker queue parses by whitespace across lines, in order'
    );
    ok(parseWalkerQueue('3478 3478 x 3479').join(',') === '3478,3479', 'a repeated or non-numeric queue token is dropped, never a throw');
    ok(
      parseRoster('## x\n| **Nope** | a | b |\n### 0 · Roster\n| session | machine | lane |\n|---|---|---|\n| **Kestrel** | rig | c |\n| **Wren** | box | m |\n- trailer\n| **Late** | x | y |\n').join(
        ','
      ) === 'kestrel,wren',
      'the roster reads only the §0 table, lower-cased, so every bird gets a token row'
    );
    {
      const md = '### 0 · Roster\n| session | machine | lane |\n|---|---|---|\n| **Kestrel** | rig-x870 | c |\n| **Finch** | roaming (bridge) | f |\n| **Wren** | vigil | m |\n- trailer\n';
      const hosts = parseRosterHosts(md);
      ok(hosts.kestrel === 'rig-x870' && hosts.finch === 'roaming (bridge)' && hosts.wren === 'vigil', 'the roster machine column is read per bird');
      const u = { rosterHosts: hosts, remotes: [{ host: 'vigil', ok: false, reason: 'vigil not read (255)' }] };
      ok(unreadReason('wren', u) === 'vigil not read (255)', 'a failed remote is the reason for the bird whose machine is that host');
      ok(/no host this board reads/.test(unreadReason('finch', u)), 'a roaming bird does NOT inherit the failed remote — it has no host this board reads');
      ok(/no transcript in the window on this machine$/.test(unreadReason('kestrel', u)), 'a local bird with nothing in the window says so, and does not name the failed remote');
      ok(/this machine, vigil$/.test(unreadReason('kestrel', { rosterHosts: hosts, remotes: [{ host: 'vigil', ok: true }] })), 'with the remote read, the local reason lists every host that was read');
      ok(/not in the §0 roster/.test(unreadReason('ghost', u)), 'a name outside the table says so');
    }
    {
      const u = {
        ok: true,
        fleetTokens: 10,
        fleetCacheRead: 5,
        sessions: [{ name: 'kestrel', tokens: 10, cacheRead: 5, output: 1, messages: 2, models: {}, lastContextTokens: 3 }],
        remotes: [{ host: 'box', ok: false, reason: 'box not read (255)' }],
        roster: ['kestrel', 'finch', 'osprey'],
        rosterHosts: { kestrel: 'rig', finch: 'box', osprey: 'rig' },
        managedAgents: { rows: [{ model: 'claude-sonnet-5-5', sessions: 2, tokens: 7, cacheRead: 9, output: 4, listCostUsd: 0.83, costWithout: 1 }], read: [] }
      };
      const h = renderUsage(u, 'bird');
      ok(/<td>finch<\/td>(<td class="n dim">—<\/td>){5}<td class="dim">not read: box not read \(255\)/.test(h), 'a roster bird on the failed host reads as unread with that reason, never as 0');
      ok(
        /<td>osprey<\/td>(<td class="n dim">—<\/td>){5}<td class="dim">not read: no transcript in the window on this machine</.test(h),
        'a local bird with nothing in the window does NOT inherit the failed remote as its reason'
      );
      ok(/API · managed agents<\/td><td class="n">/.test(h) && /\$0\.83/.test(h) && /\+1 unpriced/.test(h), 'the API row carries its list cost and counts an unpriced run');
    }
    ok(
      formatTimerRow('Mon 2026-10-12 13:03:48 EDT 43min Mon 2026-10-12 12:02:43 EDT 17min ago tepna-release-due.timer tepna-release-due.service') ===
        'next 13:03 (43min left) · last 12:02 (17min ago)',
      'a list-timers row renders as next · last'
    );
    ok(
      formatTimerRow('Mon 2026-10-12 13:03:48 EDT 1h 43min left Mon 2026-10-12 12:02:43 EDT 17min ago tepna-release-due.timer tepna-release-due.service') ===
        'next 13:03 (1h 43min left) · last 12:02 (17min ago)',
      'a two-token "left" survives'
    );
    ok(formatTimerRow('something else') === 'something else' && formatTimerRow('') === '', 'an unrecognised row is kept raw, an empty one stays empty');
    const doneRun = 'v2.22.0  started 2026-10-21T13:04:48.208Z  updated 2026-10-21T13:24:01.785Z\ndone:      plan tag release cleanup\ncurrent:   -\nremaining: -';
    ok(landStuckHours(doneRun, Date.parse('2026-10-22T23:48:00Z')) === null, 'a finished release-land run (`current:   -`) is not stuck, however old');
    const midRun = 'v2.23.0  started 2026-10-22T10:00:00Z  updated 2026-10-22T10:30:00Z\ndone:      plan\ncurrent:   merge\nremaining: tag';
    ok(landStuckHours(midRun, Date.parse('2026-10-22T12:30:00Z')) === 2, 'CONTROL · a run on its merge step for 2 h reads 2 h stuck');
    ok(landStuckHours('', Date.now()) === null, 'no status text is no stall');
    ok(herderRows('not json', 'birds').length === 0 && herderRows('{"result":{}}', 'birds').length === 0, 'unparseable or agent-less herder output yields no rows, never a throw');
    {
      /* THE SOLID-NIGHT STREAK AGAINST EACH NIGHT'S OWN BAND. A night's band runs 18:00 to 10:00, so
         night D ends at D+1 10:00Z. The plants below are the live 2026-10-27 shapes. */
      const T = (iso) => Date.parse(iso);
      const end = (d) => T(`${d}T10:00:00Z`);
      const row = (date, status, at, bandEnd) => ({ date, status, atMs: at === null ? null : T(at), bandEndMs: bandEnd === null ? null : bandEnd });
      const live = [
        row('2026-10-24', 'UNKNOWN', '2026-10-27T04:05:24Z', end('2026-10-25')),
        row('2026-10-25', 'PASS', '2026-10-27T04:36:22Z', end('2026-10-26')),
        row('2026-10-26', 'PASS', '2026-10-27T09:07:13Z', end('2026-10-27')),
        row('2026-10-27', 'UNKNOWN', '2026-10-27T09:11:33Z', end('2026-10-28'))
      ];
      const now = T('2026-10-27T09:15:00Z');
      const v = streakOf(live, now);
      ok(v.streak === 1, 'the live 2026-10-27 shape gives ONE complete PASS night, not the two the folder-date rule counted');
      ok(v.pending.length === 2 && v.pending[0]?.date === '2026-10-26' && v.pending[0]?.kind === 'in-progress', '10-26 is pending: its PASS was stamped 53 min before its band ended');
      ok(v.pending[1]?.date === '2026-10-27' && v.pending[1]?.kind === 'in-progress', "tonight's own folder is pending too, and by the same rule rather than by its date");
      ok(v.stoppedBy?.date === '2026-10-24' && /is UNKNOWN/.test(v.stoppedBy?.reason || ''), 'the streak names the night it stopped at');
      const asReported = [row('2026-10-25', 'PASS', '2026-10-27T04:36:22Z', end('2026-10-26')), row('2026-10-26', 'UNKNOWN', '2026-10-26T22:32:00Z', end('2026-10-27'))];
      ok(streakOf(asReported, now).streak === 1, 'CONTROL · the shape the order reported — 10-26 judged at 22:32Z, before its night began — reads 1, where the folder-date rule read 0');
      const stale = [row('2026-10-25', 'PASS', '2026-10-25T23:00:00Z', end('2026-10-26'))];
      ok(
        streakOf(stale, T('2026-10-27T09:00:00Z')).pending[0]?.kind === 'stale-verdict',
        'a band that has ENDED with no re-judge is pending as stale-verdict, which is a box-side omission rather than an unfinished night'
      );
      ok(streakOf(stale, T('2026-10-26T06:00:00Z')).pending[0]?.kind === 'in-progress', 'CONTROL · the same row before its band end is in-progress; only the clock separates the two kinds');
      const done = [row('2026-10-24', 'PASS', '2026-10-25T11:00:00Z', end('2026-10-25')), row('2026-10-25', 'PASS', '2026-10-26T11:00:00Z', end('2026-10-26'))];
      ok(streakOf(done, now).streak === 2 && streakOf(done, now).pending.length === 0, 'CONTROL · two nights judged AFTER their band ends count, and nothing is pending');
      const broke = [row('2026-10-24', 'PASS', '2026-10-25T11:00:00Z', end('2026-10-25')), row('2026-10-25', 'UNKNOWN', '2026-10-26T11:00:00Z', end('2026-10-26'))];
      ok(streakOf(broke, now).streak === 0, 'CONTROL · a COMPLETED UNKNOWN still breaks the streak, including on a folder dated today');
      const noBand = [row('2026-10-24', 'PASS', '2026-10-25T11:00:00Z', end('2026-10-25')), row('2026-10-25', 'PASS', '2026-10-26T11:00:00Z', null)];
      const nb = streakOf(noBand, now);
      ok(nb.streak === 0 && /no band/.test(nb.stoppedBy?.reason || ''), '∅ · a PASS carrying no band STOPS the streak and says why — skipping it would join two nights nobody measured as adjacent');
      ok(
        (streakOf([row('2026-10-25', 'PASS', null, end('2026-10-26'))], now).stoppedBy?.reason || '').includes('no verdict time'),
        '∅ · a PASS with no verdict time stops for its own reason, not the band reason'
      );
      const naNoBand = streakOf([row('2026-10-24', 'PASS', '2026-10-25T11:00:00Z', end('2026-10-25')), row('2026-10-25', 'NOT_APPLICABLE', '2026-10-26T11:00:00Z', null)], now);
      ok(
        naNoBand.streak === 0 && naNoBand.stoppedBy?.reason === '2026-10-25 is NOT_APPLICABLE',
        'a band-less NOT_APPLICABLE stops as its status, which is what all 21 band-less verdicts on the box are'
      );
      ok(streakOf([], now).streak === 0 && streakOf(null, now).pending.length === 0, 'no rows give a zero streak rather than a throw');
      ok(
        streakOf(live, undefined).pending.every((pp) => pp.kind === 'stale-verdict'),
        'with no clock the pending kind degrades to stale-verdict, and the SKIP still holds — the streak never depends on reading the clock'
      );
    }
    {
      /* THE PACE, RESTARTED AT EACH WEEKLY RESET. The cross-reset plant is the live 2026-10-27 shape. */
      const W1 = '2026-10-24T16:00-04:00';
      const W2 = '2026-10-31T16:00-04:00';
      const same = planRate([
        { at: '2026-10-26T00:00:00Z', all: 10, fable: 4, resets: W2 },
        { at: '2026-10-26T10:00:00Z', all: 30, fable: 9, resets: W2 }
      ]);
      ok(same.all === 2 && same.fable === 0.5 && same.hours === 10 && same.reason === null, 'two readings of ONE week give a pace per hour on both meters');
      const across = planRate([
        { at: '2026-10-20T20:00:00Z', all: 41, fable: 20, resets: W1 },
        { at: '2026-10-26T20:00:00Z', all: 32, fable: 11, resets: W2 }
      ]);
      ok(across.all === null && across.hours === null && /holds one reading/.test(across.reason), 'CONTROL · the live 41 → 32 pair across the 10-24 reset refuses instead of publishing -0.06 %/h');
      ok(planRate([{ at: '2026-10-26T00:00:00Z', all: 10, resets: W2 }]).reason === 'the plan readings hold fewer than two points, so there is no pace yet', 'one reading is no pace');
      ok(
        /names no week reset/.test(
          planRate([
            { at: '2026-10-26T00:00:00Z', all: 10 },
            { at: '2026-10-26T06:00:00Z', all: 12 }
          ]).reason
        ),
        'a latest reading with no resets stamp refuses: it cannot say which week it covers'
      );
      const flat = planRate([
        { at: '2026-10-26T06:00:00Z', all: 10, resets: W2 },
        { at: '2026-10-26T06:00:00Z', all: 12, resets: W2 }
      ]);
      ok(flat.all === null && /no forward time/.test(flat.reason), 'two readings at the same instant carry no pace');
      const skip = planRate([
        { at: '2026-10-26T00:00:00Z', all: 5, resets: W2 },
        { at: '2026-10-26T06:00:00Z', all: 99, resets: W1 },
        { at: '2026-10-26T12:00:00Z', all: 17, resets: W2 }
      ]);
      ok(skip.all === 1 && skip.hours === 12, 'the baseline is the previous reading of the SAME week, not the previous row');
      ok(planRate(null).reason === 'the plan readings hold fewer than two points, so there is no pace yet' && planRate([]).all === null, 'no readings refuse rather than throw');
    }
    {
      /* THE EVALUATION HEADING, WITH AND WITHOUT A MARKDOWN PREFIX. */
      const two = '## Kestrel daily evaluation — 2026-10-26 18:00 EDT\nold body\n\n## Kestrel daily evaluation — 2026-10-27 09:00 EDT\nnew body\n';
      const t = todaysEntries(two, '2026-10-27');
      ok(t.note === null && /new body/.test(t.text) && !/old body/.test(t.text), 'a `## ` heading slices to TODAY alone');
      const bare = 'Kestrel daily evaluation — 2026-10-26 18:00 EDT\nold\n\nKestrel daily evaluation — 2026-10-27 09:00 EDT\nnew\n';
      ok(todaysEntries(bare, '2026-10-27').note === null && /new/.test(todaysEntries(bare, '2026-10-27').text), 'CONTROL · the legacy heading with no prefix still slices');
      const hashes = '###### Kestrel daily evaluation — 2026-10-27 09:00 EDT\nnew\n';
      ok(todaysEntries(hashes, '2026-10-27').note === null, 'six hashes are still a heading');
      ok(todaysEntries('### 2026-10-27 · something\nbody\n', '2026-10-27').note === null, 'CONTROL · the plain `### <date>` entry form is untouched');
      const inner = '## Kestrel daily evaluation — 2026-10-27 09:00 EDT\nintro\n\n## Items\none\n';
      ok(/## Items/.test(todaysEntries(inner, '2026-10-27').text), 'a subheading inside the entry body is NOT a split point, so the entry stays whole');
      const miss = todaysEntries(two, '2026-10-28');
      ok(miss.note === '(no entry dated 2026-10-28; showing the latest, 2026-10-27)', 'with nothing dated today the note names both dates and they differ — the self-contradicting form is gone');
    }
    {
      /* THE RUNNER TRIPWIRE. A card can be wrong with every input correct, because the service runs
         the shared checkout's copy of this file (residue
         2026-10-27-the-board-renders-from-a-checkout-nobody-advances). */
      const stale = runnerVerdict(166, true);
      ok(stale.stale === true && stale.behind === 166 && /differs from origin\/main/.test(stale.reason), 'a board rendered by a differing copy, 166 commits behind, says so');
      const behindOnly = runnerVerdict(166, false);
      ok(behindOnly.stale === false && /its tools\/board\.mjs matches the ref/.test(behindOnly.reason), 'CONTROL · a behind checkout whose board.mjs matches the ref is NOT a stale renderer');
      ok(runnerVerdict(0, false).stale === false && runnerVerdict(0, false).reason === null, 'CONTROL · a current checkout raises nothing');
      ok(runnerVerdict(null, true).stale === null && /could not be compared/.test(runnerVerdict(null, true).reason), 'an uncomparable checkout is null with a reason, never false');
      ok(runnerVerdict(Number.NaN, false).stale === null, 'a non-finite count is the absence, not 0');

      /* THE CLOSURE. The banner used to hash one file and speak for the renderer; six of the 21
         commits that ever touched that closure never touched `tools/board.mjs`. */
      /* The planted REPO call site is ASSEMBLED, never written whole. A literal one in this file
         would enter the REAL closure above and read `release-land.mjs` as `data,self` — the fixture
         measuring itself, and the one leg that proves the call site moved would never go red again.
         Same reason the ghost name below is assembled. */
      const LAND = `release-land${'.mjs'}`;
      const PLANT = {
        'tools/board.mjs': `import { isCliEntry } from './argv-guard.mjs';\nconst st = sh('node', [path.join(REPO, 'tools', '${LAND}'), '--status']);\n`,
        'tools/argv-guard.mjs': "import { helper } from './inner-helper.mjs';\n",
        'tools/release-land.mjs': "import { isCliEntry } from './argv-guard.mjs';\n",
        'tools/inner-helper.mjs': 'export const helper = 1;\n'
      };
      const readPlant = (rel) => {
        if (!(rel in PLANT)) throw new Error(`no such file ${rel}`);
        return PLANT[rel];
      };
      const clo = rendererClosure('tools/board.mjs', readPlant);
      ok(clo.ok && clo.files.includes('tools/argv-guard.mjs'), 'the closure follows a relative import');
      ok(clo.ok && clo.files.includes('tools/release-land.mjs'), 'the closure follows a SHELLED-OUT tool, which no import reader would see');
      ok(clo.ok && clo.files.includes('tools/inner-helper.mjs'), 'the closure is transitive, not one level deep');
      ok(clo.ok && clo.files.length === 4 && clo.unreadable.length === 0, `the closure is exactly its four files, got ${clo.files.join(',')}`);
      ok(normaliseRel('tools/board.mjs', '../verdict.js') === 'verdict.js', 'a parent-relative spec resolves out of tools/');
      /* FAIL CLOSED. A reader that matches nothing would hand the banner an empty population, and
         every answer over an empty population reads clean. */
      ok(rendererClosure('tools/board.mjs', () => 'const x = 1;\n').ok === false, 'a file with no dependency at all is a REFUSAL, never a clean one-file closure');
      ok(
        rendererClosure('tools/board.mjs', () => {
          throw new Error('gone');
        }).ok === false,
        'an unreadable entry file refuses'
      );
      const deep = rendererClosure('tools/board.mjs', (rel) => (rel === 'tools/inner-helper.mjs' ? null : readPlant(rel)));
      ok(
        deep.ok && deep.unreadable.includes('tools/inner-helper.mjs') && !deep.files.includes('tools/inner-helper.mjs'),
        'a dependency that cannot be read is reported unreadable, not silently dropped'
      );

      /* THE DEFECT ITSELF: drift in a file that is NOT board.mjs. */
      const shelled = runnerVerdict(196, { drifted: ['tools/release-land.mjs'], unreadable: [], examined: ['tools/argv-guard.mjs', 'tools/board.mjs', 'tools/release-land.mjs'] });
      ok(shelled.stale === true && /release-land\.mjs/.test(shelled.reason), 'a stale SHELLED-OUT tool makes the renderer stale, though board.mjs matches');
      const allMatch = runnerVerdict(196, { drifted: [], unreadable: [], examined: ['tools/argv-guard.mjs', 'tools/board.mjs', 'tools/release-land.mjs'] });
      ok(allMatch.stale === false && /all 3 file\(s\)/.test(allMatch.reason), 'CONTROL · a whole closure that matches is not stale, and the sentence names the 3 it examined');
      const unread = runnerVerdict(196, { drifted: [], unreadable: ['tools/release-land.mjs'], examined: ['tools/board.mjs'] });
      ok(unread.stale === null && /could not be compared/.test(unread.reason), 'a file that could not be compared is null, never a false that claims a match');
      ok(runnerVerdict(196, true).reason.includes('tools/board.mjs'), 'the legacy boolean still reports, and reports on the one file it knew about');

      /* THE BANNER. `stale === null` and a failed section are both falsy, and the header used to
         print neither — the two states an operator most needs are the two that vanished. */
      ok(runnerBannerText({ stale: null, reason: 'could not compare' }) === 'could not compare', 'an uncomparable renderer RAISES the banner');
      ok(runnerBannerText({ ok: false, reason: 'running-checkout read failed' }) === 'running-checkout read failed', 'a failed runner section raises it too');
      ok(runnerBannerText({ stale: true, reason: 'drifted' }) === 'drifted', 'a drifted renderer raises it');
      ok(runnerBannerText({ stale: false, behind: 196, reason: 'behind but matching' }) === null, 'CONTROL · a matching renderer stays quiet, however far behind');

      /* THE PLACEMENT, NOT THE PRESENCE. The verdict was already on the page before this leg
         existed — in the header's `meta` class, beside the host name. These cases pin the LEVEL and
         the ORDER instead: what the board measured is red, what it could not read is amber, and
         either one precedes the cards it qualifies. */
      const drifted = runnerBanner({ stale: true, reason: 'the code differs', drifted: ['tools/release-land.mjs'] });
      ok(drifted.level === 'red' && /every card below it/.test(drifted.why), 'MEASURED drift is a red banner that says what it qualifies');
      ok(/the code differs/.test(drifted.why), "the banner carries the verdict's own reason, never a second sentence about it");
      ok(runnerBanner({ stale: null, reason: 'two file(s) could not be compared' }).level === 'amber', 'a renderer that could not be compared is AMBER, never silent and never a measured red');
      ok(runnerBanner({ ok: false, reason: 'running-checkout read failed: ENOENT' }).level === 'amber', 'a failed runner section reaches the page too');
      ok(runnerBanner({ stale: false, behind: 196, reason: 'behind but matching' }) === null, 'CONTROL · a matching renderer raises no banner, however far behind');

      const existing = [{ level: 'red', why: 'main CI: tests failure' }];
      const ordered = withRunnerBanner(existing, { stale: true, reason: 'the code differs' });
      ok(ordered.length === 2 && /every card below it/.test(ordered[0].why), 'the qualifier is FIRST, ahead of the banner it puts in doubt');
      ok(existing.length === 1 && existing[0].why === 'main CI: tests failure', "the caller's list is copied, not spliced");
      ok(withRunnerBanner(existing, { stale: false, reason: null }).length === 1, 'CONTROL · a current renderer adds nothing');
      ok(withRunnerBanner(null, { stale: false, reason: null }).length === 0, 'no banners and a current renderer is an empty list, not a throw');

      /* THE REAL TREE, derived rather than frozen: this repo's own board.mjs must reach both. */
      const real = rendererClosure('tools/board.mjs', (rel) => readFileSync(path.join(SELF_REPO, rel), 'utf-8'));
      ok(
        real.ok && real.files.includes('tools/argv-guard.mjs') && real.files.includes('tools/release-land.mjs'),
        `the REAL closure of this board reaches both dependencies, got ${real.ok ? real.files.join(',') : real.reason}`
      );
      ok(
        real.ok && real.via['tools/release-land.mjs'].join() === 'self',
        `the release card shells the RENDERER'S OWN release-land.mjs, so a pinned renderer stops running the reported checkout's stale copy, got ${real.ok ? real.via['tools/release-land.mjs'].join() : real.reason}`
      );
      ok(
        real.ok && real.files.includes('tools/usage-guard.mjs') && real.via['tools/usage-guard.mjs'].join() === 'self',
        `the usage card shells its own copy too — both call sites moved or neither did, got ${real.ok ? (real.via['tools/usage-guard.mjs'] || ['ABSENT']).join() : real.reason}`
      );

      /* THE CALL SITES AND THE CLASSIFIER MOVE TOGETHER OR THE BANNER LIES. A reverted call site
         with the rule intact reads `data` for a file loaded from `self`, which is silent and green.
         So assert the SOURCE, not only the derived kind. */
      const selfSrc = readFileSync(path.join(SELF_REPO, 'tools', 'board.mjs'), 'utf-8');
      for (const t of ['release-land.mjs', 'usage-guard.mjs']) {
        const pinned = new RegExp(`SELF_REPO,\\s*'tools',\\s*'${t.replace('.', '\\.')}'`).test(selfSrc);
        ok(pinned, `${t} is shelled from SELF_REPO at its call site: ${pinned ? 'pinned' : 'STILL BUILT FROM REPO'}`);
      }
      ok(
        /'--project',\s*REPO/.test(selfSrc),
        `usage-guard keeps its DATA root explicit, because its default project is derived from its own location: ${/'--project',\s*REPO/.test(selfSrc) ? 'passed' : 'ABSENT — the current copy would re-aim at the renderer clone'}`
      );

      /* THE ROOT VARIABLE DECIDES, AND AN UNKNOWN ONE FAILS CLOSED INTO BOTH. */
      ok(shellRoots('SELF_REPO').join() === 'self', "a SELF_REPO call site loads from the renderer's own tree");
      ok(shellRoots('REPO').join() === 'data', 'a REPO call site loads from the checkout the renderer reports on');
      ok(shellRoots('SOME_OTHER_ROOT').join() === 'self,data', 'an UNRECOGNISED root is compared in BOTH trees — dropping the one it loads from would report code that is not running as current');
      ok(shellRoots(null).join() === 'self,data', 'a bare call with no root takes the same fail-closed path');
      /* THE GHOSTS ARE GONE, AND THIS LEG IS WHY THE READER STAYS HONEST. It read
         `tools/inner-helper,tools/x` until 2026-10-31 and asked to be tightened and updated;
         `executableText` plus the statement-position import did that. MEASURED on this tree: the
         same 8 real files before and after the tightening, 2 unresolvable names before, 0 after. A
         non-zero count here means the reader matched its own prose again. */
      ok(real.unresolved.join() === '', `the REAL closure derives no name that is no file, so the reader no longer reads its own documentation, got ${real.unresolved.join()}`);

      /* ONE CONTROL PER HAZARD. Every ghost name is ASSEMBLED, for the reason the plant above gives:
         a literal one would enter the REAL closure and the leg above would never go red again. */
      const GHOST = `ghost${'.mjs'}`;
      const SHELLED_GHOST = `'tools', '${GHOST}'`;
      const planted = (board) => rendererClosure('tools/board.mjs', (rel) => (rel === 'tools/board.mjs' ? board : readPlant(rel)));
      const REAL_EDGE = `import { isCliEntry } from './argv-guard.mjs';\n`;
      const blockGhost = planted(`/* path.join(SELF_REPO, ${SHELLED_GHOST}) */\n${REAL_EDGE}`);
      ok(blockGhost.ok && !blockGhost.unresolved.includes(`tools/${GHOST}`), `a shell call inside a BLOCK COMMENT documents the rule, it is not an edge, got ${blockGhost.unresolved.join()}`);
      ok(blockGhost.ok && blockGhost.files.includes('tools/argv-guard.mjs'), 'CONTROL · the real import beside that comment still binds');
      const lineGhost = planted(`  // path.join(SELF_REPO, ${SHELLED_GHOST})\n${REAL_EDGE}`);
      ok(lineGhost.ok && !lineGhost.unresolved.includes(`tools/${GHOST}`), 'a shell call in a LINE comment at statement position is documentation too');
      const nested = planted(`${REAL_EDGE}const P = { 'tools/plant.mjs': "import { h } from './${GHOST}';" };\nconst st = sh('node', [path.join(SELF_REPO, 'tools', 'release-land.mjs')]);\n`);
      ok(nested.ok && !nested.unresolved.includes(`tools/${GHOST}`), `an import INSIDE a string literal is data, never an edge, got ${nested.unresolved.join()}`);
      ok(
        nested.ok && nested.files.includes('tools/argv-guard.mjs') && nested.files.includes('tools/release-land.mjs'),
        `CONTROL · the statement-position import and the executable shell call beside it both bind, got ${nested.files.join(',')}`
      );
      const urlInString = planted(`${REAL_EDGE}const u = 'https://example.invalid/x'; const st = sh('node', [path.join(SELF_REPO, 'tools', 'release-land.mjs')]);\n`);
      ok(urlInString.ok && urlInString.files.includes('tools/release-land.mjs'), 'CONTROL · a URL in a string blanks nothing, so a shell call sharing its line still binds');
      ok(planted(`/* ${REAL_EDGE}   path.join(SELF_REPO, ${SHELLED_GHOST}) */\n`).ok === false, 'a file whose only edges sit in a comment REFUSES, because an empty population reads clean');
      const kept = executableText('a /* b\nc */ d\n');
      ok(kept.split('\n').length === 3 && /d/.test(kept.split('\n')[1]) && !/b/.test(kept), 'a blanked comment keeps its line count and the code beside it, so a later line number still lands');

      /* TWO TREES. An import loads from the file's own directory; a shelled call loads from `REPO`.
         The remedy the row names separates them, so each file must be compared where it loads. */
      const kinds = [];
      const readKinds = (rel, kind) => {
        kinds.push(`${rel}:${kind}`);
        return readPlant(rel);
      };
      const two = rendererClosure('tools/board.mjs', readKinds);
      ok(two.ok && two.via['tools/board.mjs'].join() === 'self', "the entry file loads from the renderer's own tree");
      ok(two.ok && two.via['tools/release-land.mjs'].join() === 'data', 'a SHELLED tool loads from the checkout the renderer reports on, never from its own tree');
      ok(two.ok && two.via['tools/argv-guard.mjs'].join() === 'data,self', 'a file reached BOTH ways carries both roots, because it runs in both');
      ok(two.ok && two.via['tools/inner-helper.mjs'].join() === 'data,self', "a shelled tool's own imports inherit ITS root, transitively");
      ok(kinds.includes('tools/release-land.mjs:data') && kinds.includes('tools/argv-guard.mjs:self'), `the reader is TOLD the root, so the caller can read the right tree, got ${kinds.join(' ')}`);
      ok(clo.files.join() === two.files.join(), 'CONTROL · a reader that ignores the second argument gets the same file list as before');

      /* THE SENTENCE. With one tree `the running checkout` names both; with two it names neither. */
      const vias = { 'tools/release-land.mjs': ['data'], 'tools/board.mjs': ['self'] };
      const joined = runnerVerdict(196, { drifted: ['tools/release-land.mjs'], unreadable: [], examined: ['tools/board.mjs', 'tools/release-land.mjs'], via: vias });
      const apart = runnerVerdict(196, { drifted: ['tools/release-land.mjs'], unreadable: [], examined: ['tools/board.mjs', 'tools/release-land.mjs'], via: vias }, { separateRoots: true });
      ok(
        joined.reason === runnerVerdict(196, { drifted: ['tools/release-land.mjs'], unreadable: [], examined: ['tools/board.mjs', 'tools/release-land.mjs'] }).reason,
        'CONTROL · one tree reads exactly as it did before, via or no via'
      );
      ok(/in a checkout 196 commit\(s\) behind it/.test(joined.reason) && !/reports on/.test(joined.reason), 'CONTROL · the one-tree sentence is unchanged');
      ok(/the checkout it reports on/.test(apart.reason), 'with two trees the sentence names the checkout, not `the running checkout`');
      ok(/release-land\.mjs \(the checkout it reports on\)/.test(apart.reason), 'a drifted file names the TREE it drifted in, so a reader knows which one to advance');
      ok(runnerVerdict(4, false, { separateRoots: true }).reason.startsWith('the checkout it reports on is 4'), 'the behind-only sentence takes the same subject');
      ok(runnerVerdict(null, true, { separateRoots: true }).reason === 'the checkout it reports on could not be compared with the ref', 'the uncomparable sentence takes it too');
      ok(runnerVerdict(0, false, { separateRoots: true }).reason === null, 'CONTROL · two current trees still raise nothing');
      const mixed = runnerVerdict(9, { drifted: ['tools/board.mjs'], unreadable: ['tools/new-tool.mjs'], examined: ['tools/board.mjs'] });
      ok(/1 more could not be compared \(tools\/new-tool\.mjs\)/.test(mixed.reason), 'a file that drifted and a file that could not be read are BOTH named — the count alone loses the second');
      ok(mixed.unreadable.join() === 'tools/new-tool.mjs', 'the uncompared files reach the caller as data, not only as prose');

      /* A NAME THAT RESOLVES NOWHERE. The shell-call rule reads raw text, so the comment above and
         this selftest's own fixtures enter the population. They must be classified, not dropped. */
      const ghost = 'ghost.mjs';
      const ROOTS = {
        self: { 'tools/board.mjs': PLANT['tools/board.mjs'], 'tools/argv-guard.mjs': PLANT['tools/argv-guard.mjs'], 'tools/inner-helper.mjs': PLANT['tools/inner-helper.mjs'] },
        data: { 'tools/board.mjs': PLANT['tools/board.mjs'], 'tools/release-land.mjs': PLANT['tools/release-land.mjs'] }
      };
      const perRoot = rendererClosure('tools/board.mjs', (rel, kind) => {
        const t = ROOTS[kind][rel];
        if (t === undefined) throw new Error(`absent from the ${kind} tree`);
        /* The ghost name is assembled, never written whole — a literal call site in this file would
           enter the REAL closure below and the leg would then measure its own fixture. */
        return rel === 'tools/board.mjs' ? `${t}sh('node', [path.join(REPO, 'tools', '${ghost}')]);\n` : t;
      });
      ok(perRoot.unresolved.join() === 'tools/ghost.mjs', `a name absent from BOTH trees is the reader's artifact, got ${perRoot.unresolved.join()}`);
      ok(
        perRoot.unreadable.includes('tools/argv-guard.mjs') && !perRoot.unresolved.includes('tools/argv-guard.mjs'),
        'a REAL file absent from ONE tree stays a measurement gap — the renderer loads it in the tree that has it and not in the other'
      );
      const arte = runnerVerdict(3, { drifted: [], unreadable: [], examined: ['tools/board.mjs'], unresolved: ['tools/x.mjs'] });
      ok(/resolve to no file in either tree \(tools\/x\.mjs\)/.test(arte.reason), 'the artifact is REPORTED in its own clause, never folded into the uncompared count');
      ok(
        runnerVerdict(0, { drifted: [], unreadable: [], examined: ['tools/board.mjs'], unresolved: ['tools/x.mjs'] }).reason.startsWith('2 derived') === false,
        'CONTROL · an all-clear with an artifact still speaks, and the clause does not start with its own separator'
      );
      ok(runnerVerdict(0, false).reason === null, 'CONTROL · an all-clear with no artifact stays silent');
    }
  }
  console.log(fails.length ? `board selftest: ${fails.length} FAILED of ${ran}\n  ${fails.join('\n  ')}` : `all ${ran} selftests passed`);
  process.exit(fails.length ? 1 : 0);
}

/* 🔴 NO SIDE EFFECTS ON IMPORT. `doc-search.mjs` imports `summarize` from this file to print the
   board's three lines after every search, and a bare script body would have made every Rule 0 search
   REGENERATE the board — spawning `gh` calls and rewriting the page, which is precisely what that
   footer's comment promises it does not do. Caught by a smoke test: the summary printed twice with two
   different `generatedAt` stamps, one of them newer than the file being read.
   ⚠️ THE CHECK IS INLINED RATHER THAN IMPORTED FROM `doc-search.mjs`, DELIBERATELY. Reusing its
   `isEntryPoint` created a cycle — doc-search awaits this module for `summarize`, this module awaited
   doc-search for the helper — and node reported `Detected unsettled top-level await`, i.e. a deadlock,
   not a warning to ignore. Three lines duplicated beats a cycle between two tools that must each be
   runnable alone. */
if (isCliEntry(import.meta.url)) await main();

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) runSelftest();
  const b = collect();
  if (argv.includes('--summary')) {
    console.log(summarize(b).join('\n'));
    process.exit(0);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'board.json'), `${JSON.stringify(b, null, 1)}\n`);
  writeFileSync(path.join(OUT_DIR, 'index.html'), renderHtml(b));
  if (!argv.includes('--quiet')) console.log(summarize(b).join('\n'));
}
