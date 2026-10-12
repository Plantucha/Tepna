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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OUT_DIR = process.env.TEPNA_BOARD_DIR || path.join(homedir(), '.local', 'share', 'tepna', 'board');
const REPO = process.env.TEPNA_REPO || path.join(homedir(), 'Tepna');

/* A section is `{ ok: true, ... }` or `{ ok: false, reason }`. `reason` is the operator's sentence, not
   a stack trace: "gh not authenticated" tells them what to do, "Error: 1" does not. */
const fail = (reason) => ({ ok: false, reason: String(reason).split('\n')[0].slice(0, 160) });

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 60000, ...opts }).trim();
}

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
export function budgetBar({ spentPct, spentPctRange, reportedAt, nowMs }) {
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
    const raw = sh('node', [path.join(REPO, 'tools', 'usage-guard.mjs'), '--json', ...(sinceSpec ? ['--since', sinceSpec] : [])], { cwd: REPO });
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
        lastContextAt: s.lastContextAt
      }))
    };
  } catch (e) {
    return fail(`usage-guard --json failed: ${e.message}`);
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
    /* WALKER ORDER is the serial queue's own order: oldest non-draft first, which is the order Kodiak
       takes them. Drafts are listed after, because a draft is held on purpose. */
    const order = list
      .filter((p) => !p.draft)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
      .map((p) => p.number);
    return { ok: true, list, walkerOrder: order, openNonDraft: order.length };
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

function release() {
  const out = { ok: true };
  try {
    const tag = sh('git', ['describe', '--tags', '--abbrev=0'], { cwd: REPO });
    const when = sh('git', ['log', '-1', '--format=%cI', tag], { cwd: REPO });
    out.lastTag = tag;
    out.taggedAt = when;
    out.ageDays = +((Date.now() - Date.parse(when)) / 864e5).toFixed(1);
    out.commitsSince = +sh('git', ['rev-list', '--count', `${tag}..HEAD`], { cwd: REPO });
  } catch (e) {
    return fail(`git tag read failed: ${e.message}`);
  }
  try {
    const ch = sh('bash', ['-c', `ls ${path.join(REPO, 'changes')}/*.md 2>/dev/null | grep -vc README || true`]);
    out.pendingChangesets = Number(ch) || 0;
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
    const upd = st.match(/updated (\S+)/);
    const cur = st.match(/current:\s+(\S+)/);
    out.landCurrentStep = cur ? cur[1] : null;
    /* `stuckHours` is only meaningful while a run is UNFINISHED — a `current:` step with no `done` for
       the whole chain. A finished chain has no current step and cannot be stuck. */
    out.landStuckHours = upd && cur ? +((Date.now() - Date.parse(upd[1])) / 3.6e6).toFixed(1) : null;
  } catch (e) {
    out.land = null;
    out.landNote = `release-land --status unreadable: ${String(e.message).split('\n')[0].slice(0, 90)}`;
  }
  try {
    const t = sh('bash', ['-c', 'systemctl --user list-timers tepna-release-due.timer --all --no-pager 2>/dev/null | sed -n 2p']);
    out.dueTimer = t || null;
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
  const f = path.join(REPO, 'briefs', 'OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md');
  if (!existsSync(f)) return fail('OWNER-DECISION-QUEUE brief not found');
  try {
    const rows = readFileSync(f, 'utf-8')
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

function todaySection(name, rel, note) {
  const f = path.join(OUT_DIR, rel);
  if (!existsSync(f)) return { ok: false, reason: `${rel} not written yet — ${note}` };
  try {
    const txt = readFileSync(f, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const t = todaysEntries(txt, localYMD(new Date()));
    const text = (t.note ? `${t.note}\n\n` : '') + t.text;
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

function planPct() {
  const f = path.join(OUT_DIR, 'plan.json');
  if (!existsSync(f)) return { spentPct: null, reportedAt: null };
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8'));
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
    const raw = sh('gh', ['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'number,body,mergedAt'], { cwd: REPO });
    const list = JSON.parse(raw);
    const withStamp = list.filter((p) => /^Rule 0:/m.test(p.body || ''));
    if (!withStamp.length) return { ok: true, lastStampedPr: null, ageHours: null, note: 'no Rule 0 line in the last 10 merged PRs' };
    const newest = withStamp[0];
    return { ok: true, lastStampedPr: newest.number, mergedAt: newest.mergedAt, ageHours: +((Date.now() - Date.parse(newest.mergedAt)) / 3.6e6).toFixed(1), stampedOfLast10: withStamp.length };
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
    usage24h: u24,
    usage7d: u7,
    budget: budgetBar({ spentPct: plan.spentPct, spentPctRange: plan.spentPctRange, reportedAt: plan.reportedAt, nowMs: now }),
    planNote: plan.note || null,
    prs: pr,
    mainCi: ci,
    release: rel,
    herder: herder(),
    ownerDecisions: ownerDecisions(),
    rule0: rule0Stamp(),
    /* The streak is computed on the capture box and no rig-local source exists yet. Until the box
       publishes a summary the rig can read, the section renders a HAND-ENTERED file whose first line
       must say so with a date — a manual entry is a measurement of what a person copied, not of the
       night, and the board says which. Owner, 2026-10-11: "put placeholders in it". */
    solidNights: fileSection('solid-night', 'solid-night.md', 'the streak is computed on the capture box; until it publishes a summary, Kestrel hand-enters it here with a date'),
    evaluation: todaySection('evaluation', 'evaluation.md', 'Kestrel writes this file; the board only reads it')
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
  board.banners = banners;
  return board;
}

/** The three lines doc-search prints. Terse on purpose: a summary nobody reads is noise. */
export function summarize(b) {
  const u = b.usage24h;
  const tok = u.ok ? `${(u.fleetTokens / 1e6).toFixed(1)}M fresh/24h` : 'usage unread';
  const bud = b.budget.ok ? `plan ${b.budget.label}${b.budget.stale ? ' (STALE)' : ''}` : 'plan %: not reported';
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
const num = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const m = (n) => (typeof n === 'number' && isFinite(n) ? `${(n / 1e6).toFixed(2)}M` : '—');

function sec(title, body, bad) {
  return `<section class="${bad ? 'bad' : ''}"><h2>${esc(title)}</h2>${body}</section>`;
}
function unread(s) {
  return `<p class="unread">not read — ${esc(s.reason)}</p>`;
}

function renderUsage(u, label) {
  if (!u.ok) return unread(u);
  const rows = u.sessions
    .sort((a, b) => b.tokens - a.tokens)
    .map((s) => {
      const models =
        Object.entries(s.models || {})
          .map(([k, v]) => `${esc(k)}&nbsp;${num(v)}`)
          .join('<br>') || '—';
      return `<tr><td>${esc(s.name || '(unnamed)')}</td><td class="n">${m(s.tokens)}</td><td class="n dim">${m(s.cacheRead)}</td><td class="n">${m(s.output)}</td><td class="n dim">${num(s.messages)}</td><td class="n dim">${num(s.lastContextTokens)}</td><td class="mdl">${models}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>${esc(label)}</th><th>fresh</th><th>cache←</th><th>out</th><th>msgs</th><th>last ctx</th><th>model</th></tr></thead><tbody>${rows}
    <tr class="tot"><td>fleet</td><td class="n">${m(u.fleetTokens)}</td><td class="n dim">${m(u.fleetCacheRead)}</td><td colspan="4" class="dim">cache reads are shown beside, never summed into fresh</td></tr></tbody></table>`;
}

export function renderHtml(b) {
  const banners = b.banners.map((x) => `<div class="banner ${x.level}">${x.level === 'red' ? '🔴' : '⚠️'} ${esc(x.why)}</div>`).join('');
  const prBody = !b.prs.ok
    ? unread(b.prs)
    : `<p class="dim">walker order: ${b.prs.walkerOrder.length ? b.prs.walkerOrder.map((n) => `#${n}`).join(' → ') : '(empty)'}</p><table><thead><tr><th>PR</th><th>title</th><th>state</th><th>checks</th></tr></thead><tbody>${b.prs.list
        .map(
          (p) =>
            `<tr><td>#${p.number}${p.draft ? ' <span class="dim">draft</span>' : ''}</td><td>${esc(p.title)}</td><td>${esc(p.state)}</td><td class="dim">${esc(
              Object.entries(p.buckets)
                .map(([k, v]) => `${k}:${v}`)
                .join(' ')
            )}</td></tr>`
        )
        .join('')}</tbody></table>`;
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
    : `<table><tbody>${b.mainCi.runs.map((x) => `<tr><td>${esc(x.name)}</td><td class="${x.conclusion === 'failure' ? 'red' : ''}">${esc(x.conclusion || x.status)}</td><td class="dim">${esc(String(x.at).slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</tbody></table>`;
  const bud = b.budget.ok
    ? `<div class="bar"><div style="margin-left:${Math.max(0, Math.min(100, b.budget.lo))}%;width:${Math.max(1, Math.min(100, b.budget.hi) - Math.max(0, b.budget.lo))}%"></div></div>
       <p><b>${esc(b.budget.label)}</b>${b.budget.range ? ' <span class="dim">(a band, as reported — not collapsed to a midpoint)</span>' : ''} of the weekly pool, as last reported by the owner${b.budget.ageHours != null ? ` <span class="${b.budget.stale ? 'red' : 'dim'}">(${b.budget.ageHours} h ago${b.budget.stale ? ' — STALE' : ''})</span>` : ''}</p>
       ${b.planNote ? `<p class="dim">${esc(b.planNote)}</p>` : ''}`
    : unread(b.budget);
  const od = b.ownerDecisions;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tepna Fleet Board</title><style>
:root{--bg:#10131a;--fg:#e7e9ee;--dim:#8b93a7;--line:#242a37;--card:#161a23;--red:#ff6b6b;--amber:#f0b429;--ok:#3ddc97}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
h1{font-size:15px;margin:0;letter-spacing:.08em;text-transform:uppercase}
main{padding:14px 18px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto}
section.bad{border-color:var(--red)}h2{font-size:12px;margin:0 0 8px;color:var(--dim);letter-spacing:.09em;text-transform:uppercase}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:400;font-size:11px;text-transform:uppercase}
.n{text-align:right;font-variant-numeric:tabular-nums}.dim{color:var(--dim)}.red{color:var(--red)}.mdl{font-size:11px;color:var(--dim)}
tr.tot td{border-top:1px solid var(--line);font-weight:700}
.banner{padding:9px 14px;margin:0;border-left:4px solid}.banner.red{background:#2a1416;border-color:var(--red);color:#ffd7d7}
.banner.amber{background:#2a2310;border-color:var(--amber);color:#ffeec2}
.bar{height:9px;background:#0b0e14;border:1px solid var(--line);border-radius:5px;overflow:hidden;margin:2px 0 6px}
.bar>div{height:100%;background:linear-gradient(90deg,var(--ok),var(--amber))}
pre{white-space:pre-wrap;color:var(--dim);font-size:12px;margin:6px 0 0}
.unread{color:var(--amber);margin:4px 0}footer{padding:10px 18px;color:var(--dim);border-top:1px solid var(--line);font-size:12px}
@media(prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:#f6f7f9;--fg:#1a1d24;--dim:#5c6478;--line:#dfe3ea;--card:#fff}}
</style></head><body>
<header><h1>Tepna fleet board</h1><span class="dim">${esc(b.generatedAt)}</span><span class="dim">${esc(b.host)}</span></header>
${banners || '<div class="banner" style="border-color:var(--ok);background:#10231b;color:#cdf5e4">no red banner</div>'}
<main>
${sec('tokens · 24 h', renderUsage(b.usage24h, 'bird'), !b.usage24h.ok)}
${sec('tokens · 7 d', renderUsage(b.usage7d, 'bird'), !b.usage7d.ok)}
${sec('weekly pool', bud, b.budget.ok && b.budget.stale)}
${sec(
  'release watch',
  relBody,
  b.banners.some((x) => x.level === 'red' && /release/i.test(x.why))
)}
${sec('open PRs · walker', prBody, !b.prs.ok)}
${sec(
  'main CI',
  ciBody,
  b.banners.some((x) => x.level === 'red' && /main CI/.test(x.why))
)}
${sec('bird herder', b.herder.ok ? `<pre>${esc(b.herder.agents)}</pre>` : unread(b.herder))}
${sec('Rule 0 stamps', b.rule0.ok ? `<p>last stamped merge: ${b.rule0.lastStampedPr ? `#${b.rule0.lastStampedPr}, <b>${b.rule0.ageHours} h</b> ago` : '—'} <span class="dim">(${esc(String(b.rule0.stampedOfLast10 ?? 0))} of the last 10 merged PRs carry one)</span></p>${b.rule0.note ? `<p class="dim">${esc(b.rule0.note)}</p>` : ''}` : unread(b.rule0))}
${sec('owner decisions', od.ok ? `<p><b>${od.count}</b> open <span class="dim">(${esc(od.source || '')})</span></p><pre>${esc(od.rows.join('\n'))}</pre>` : unread(od))}
${sec('solid-night streak', b.solidNights.ok ? `<pre>${esc(b.solidNights.text)}</pre>` : unread(b.solidNights))}
${sec('Kestrel daily evaluation', b.evaluation.ok ? `<pre>${esc(b.evaluation.text)}</pre>` : unread(b.evaluation))}
</main>
<footer>Generated by <code>tools/board.mjs</code> into <code>${esc(OUT_DIR)}</code> — outside any checkout. Live data never enters the repo.
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
    evaluation: { ok: false, reason: 'e' }
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
    solidNights: { ok: true, text: 'MANUAL ENTRY (Kestrel, 2026-10-11) streak: 3', bytes: 40 },
    evaluation: { ok: false, reason: 'e' }
  });
  const solidSec = htmlManual.split('solid-night streak')[1]?.split('</section>')[0] ?? '';
  ok(/MANUAL ENTRY \(Kestrel, 2026-10-11\) streak: 3/.test(solidSec) && !/not read —/.test(solidSec), 'a hand-entered solid-night file renders its text, and that section no longer reads as absent');
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
        evaluation: { ok: false, reason: 'e' }
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
    const rows = herderRows('{"id":"x","result":{"agents":[{"name":"kestrel","agent_status":"working","pane_id":"w1:p1"},{"name":"magpie","agent_status":"idle","pane_id":"w1:p6"}]}}', 'birds');
    ok(rows.length === 2 && /^kestrel\s+working\s+w1:p1\s+birds$/.test(rows[0]), 'herder rows are name · status · pane · session from the session JSON');
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
const _entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (_entry === import.meta.url) await main();

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
