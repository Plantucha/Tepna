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
import { isCliEntry } from './argv-guard.mjs';

const OUT_DIR = process.env.TEPNA_BOARD_DIR || path.join(homedir(), '.local', 'share', 'tepna', 'board');
const REPO = process.env.TEPNA_REPO || path.join(homedir(), 'Tepna');
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
      [path.join(REPO, 'tools', 'usage-guard.mjs'), '--json', ...(sinceSpec ? ['--since', sinceSpec] : []), ...remotes.flatMap((h) => ['--remote', h]), ...maLogs.flatMap((d) => ['--ma-log', d])],
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
    const st = sh('node', [path.join(REPO, 'tools', 'release-land.mjs'), '--status'], { cwd: REPO });
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
export const VIGIL_VERDICTS_PY = `import json, os, glob
rows = []
for d in sorted(glob.glob("/srv/tepna/captures/2026-*/")):
    f = os.path.join(d, "SOLID-VERDICT.json")
    if os.path.isfile(f):
        try:
            s = json.load(open(f))["status"]
        except Exception:
            s = "READ_FAIL"
        rows.append(os.path.basename(d.rstrip("/")) + " " + s)
print("\\n".join(rows))
`;

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
        const [date, status] = l.split(/\s+/);
        return { date, status };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return fail('no SOLID-VERDICT.json files found on vigil');
    // Streak skips today if it's still in progress (UNKNOWN = night not finished yet).
    // A completed UNKNOWN/FAIL/NOT_APPLICABLE breaks the streak.
    const today = new Date().toISOString().slice(0, 10);
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date === today && rows[i].status === 'UNKNOWN') continue;
      if (rows[i].status === 'PASS') streak++;
      else break;
    }
    const recent = rows.slice(-15);
    const lines = recent.map((r) => `  ${r.date.slice(5)} ${r.status}`);
    const text =
      `live from vigil (read ${new Date().toISOString().slice(0, 16)}Z) \u2014 last 15 of ${rows.length} nights\n` + lines.join('\n') + `\ncurrent streak: ${streak} consecutive PASS night(s)`;
    return { ok: true, text, streak, nights: rows.length };
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
          'kp="/home/michal/.config/tepna/openrouter.env";' +
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
      { name: 'codex', path: '/home/michal/.local/bin/codex', note: 'quota exhausted until 2026-11-03' },
      { name: 'claude-code', path: '/home/michal/.nvm/versions/node/v22.23.1/bin/claude', note: 'npm global 2.1.300' }
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
   An entry starts at a `### ` heading or a `Kestrel daily evaluation — ` line; entries whose heading
   carries `today` (YYYY-MM-DD) are kept in order. With none dated today the LATEST entry is shown
   under a dated note, never silently. Pure; the file is append-only, so the slice is by heading. */
export function todaysEntries(txt, today) {
  const parts = txt.split(/^(?=### |Kestrel daily evaluation — )/m).filter((p) => p.trim());
  const dateOf = (p) => (p.match(/^(?:### |Kestrel daily evaluation — )(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
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
    const out = JSON.parse(sh(process.execPath, [bin, 'blocks', '--json', '--offline', '--since', since]));
    const blocks = (out.blocks || []).filter((b) => !b.isGap).map((b) => ({ start: Date.parse(b.startTime), end: Date.parse(b.actualEndTime || b.endTime), cost: b.costUSD }));
    return estimatePlan(blocks, readings, weekStartMs, Date.now());
  } catch (e) {
    return fail(`plan estimate failed: ${e.message}`);
  }
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
      const prev = pts.length > 1 ? pts[pts.length - 2] : null;
      const hours = prev ? (Date.parse(last.at) - Date.parse(prev.at)) / 3.6e6 : null;
      const rate = (k) => (prev && hours > 0 && typeof prev[k] === 'number' && typeof last[k] === 'number' ? +((last[k] - prev[k]) / hours).toFixed(2) : null);
      return {
        spentPct: last.all,
        spentPctRange: null,
        reportedAt: last.at,
        resets: last.resets || null,
        note: null,
        point: { all: last.all, fable: typeof last.fable === 'number' ? last.fable : null, session: typeof last.session === 'number' ? last.session : null, at: last.at, resets: last.resets || null },
        rate: { all: rate('all'), fable: rate('fable'), hours: hours == null ? null : +hours.toFixed(1) },
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
    url: 'http://100.80.204.55:8766/',
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
  board.banners = banners;
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
       ${b.planPoint ? `<p>All <b>${b.planPoint.all} %</b>${b.planPoint.fable != null ? ` · Fable <b>${b.planPoint.fable} %</b>` : ''}${b.planPoint.session != null ? ` · session ${b.planPoint.session} %` : ''} <span class="dim">at ${esc(String(b.planPoint.at).slice(11, 16))} local${b.planPoint.resets ? `, week resets ${esc(String(b.planPoint.resets).slice(0, 16).replace('T', ' '))}` : ''}</span></p>${b.planRate && b.planRate.all != null ? `<p class="dim">pace since the previous point (${b.planRate.hours} h): All ${b.planRate.all} %/h${b.planRate.fable != null ? ` · Fable ${b.planRate.fable} %/h` : ''}</p>` : ''}` : b.planNote ? `<p class="dim">${esc(b.planNote)}</p>` : ''}`
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
<header><h1>Tepna fleet board</h1><div class="meta">${esc(b.generatedAt)} &middot; ${esc(b.host)} &middot; <code>http://100.80.204.55:8766/</code></div></header>
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
${sec('Message board <span class="sub">latest post</span>', b.agentBoard.ok ? (b.agentBoard.latest ? `<div class="post-meta"><b>#${b.agentBoard.latest.id}</b><span>${esc(b.agentBoard.latest.author)}</span><span class="post-time">${esc(b.agentBoard.latest.kind)} &middot; ${fmtTime(b.agentBoard.latest.at)} (${ago(b.agentBoard.latest.at)})</span></div><div class="dim">${esc(b.agentBoard.latest.title)}</div><div class="post-body">${esc(b.agentBoard.latest.body)}</div><p class="dim">${b.agentBoard.total} entries &middot; ${b.agentBoard.threads} threads</p><p class="dim">CLI: <code>/home/michal/.local/bin/agent-board</code> &middot; DB: <code>/home/michal/.agent-board/board.db</code> &middot; web: <code>http://100.80.204.55:8765</code></p>` : '<p class="dim">The board is empty &mdash; no posts yet.</p>') : unread(b.agentBoard), !b.agentBoard.ok)}
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
