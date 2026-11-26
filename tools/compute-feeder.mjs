#!/usr/bin/env node
/*
 * tools/compute-feeder.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * KEEP THE FREE COMPUTE FED (owner 2026-11-22: "build some program feeding qwen and shrike … when fleet
 * run out of tokens, there will be 2 days of compute always ready").
 *
 * Two consumers cost the fleet no Claude tokens: the local model (qwen through ollama) and Shrike
 * (Freebuff in its sandbox, fed through `/srv/shrike-outbox/queue/`). This tool keeps both supplied:
 *
 *   qwen    walk the lens sites at origin/main (LENSES in tools/qwen-lead-check.mjs), ask the local
 *           model one question per site, write leads, then run the mechanical lead check over them.
 *           Guards: it starts only when the card has VRAM for the model (a running GPU job keeps it out),
 *           it probes the router's 1-input embed between sites and stops when doc-search slows past 2 s,
 *           and it unloads the model at the end. A done-ledger keyed lens:file:blob skips answered work.
 *   shrike  keep two pools: `queue/` (Shrike works it now, --now-hours, default 6) and `reserve/` in the state folder (Shrike
 *           cannot see it; --reserve-hours, default 48, for when the fleet runs out of tokens). First batches of
 *           kept qwen leads to verify, then whole-file lens audits, newest-changed files first. It NEVER
 *           prompts Shrike (Freebuff counts a scripted prompt as a policy strike); Shrike's HOUSE-RULES
 *           make it take the next queue file by itself.
 *   status  pending lens work, Shrike queue hours, kept leads not yet issued.
 *   run     release the reserve when no bird posted on the board for --quiet-h (default 3), then shrike,
 *           then qwen inside --budget-min. `tools/qwen-idle-driver.sh` calls this each cycle.
 *
 * Everything it writes is a LEAD. A bird re-reads every site before any row or fix (brief §3.4).
 * State: <primary .git>/tepna-mutation/compute-feeder/ (override $COMPUTE_FEEDER_STATE).
 *
 *
 * WRITE-ROOT READING (briefs/WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md §3): every write lands OUTSIDE the
 * work tree — the state dir under the primary checkout's `.git` and the Shrike outbox — so no checkout
 * can lose a tracked artifact. The tree it reads is origin/main through git, the same from every checkout.
 *
 * USAGE
 *   node tools/compute-feeder.mjs status
 *   node tools/compute-feeder.mjs qwen   [--budget-min 20] [--lens absence] [--model qwen3.8:27b] [--dry-run]
 *   node tools/compute-feeder.mjs shrike [--now-hours 6] [--reserve-hours 48] [--dry-run]
 *   node tools/compute-feeder.mjs release [--hours H]      # move reserve tasks into Shrike's queue by hand
 *   node tools/compute-feeder.mjs run    [--budget-min 20]
 *   node tools/compute-feeder.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { gpuState } from './gpu-gate.mjs';
import { primaryGitDir } from './home-paths.mjs';
import { boundedFetch } from './net-bound.mjs';
import { checkLeads, LENSES, readLeads, repoSource } from './qwen-lead-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.COMPUTE_FEEDER_STATE || join(primaryGitDir(), 'tepna-mutation', 'compute-feeder');
const OLLAMA = process.env.QWEN_FEEDER_OLLAMA || 'http://127.0.0.1:11434';
const OUTBOX = process.env.SHRIKE_OUTBOX || '/srv/shrike-outbox';
// The reserve lives in the feeder state, outside the outbox: Shrike reads every folder it can see (2026-11-22).
const RESERVE = process.env.COMPUTE_FEEDER_RESERVE || join(STATE, 'reserve');
const CONTEXT_LINES = 12;
const EMBED_SLOW_MS = 2000;
const LEADS_PER_BATCH = 15;
const AUDIT_EST_H = 1.5;
const VERIFY_EST_H = 1;
/* Files outside this repo's lanes for Shrike to audit: Heron owns pulsedex and capture-host, so their
   output routes to Heron (shrike-freebuff-sandbox memory, owner 2026-11-16). */
const ROUTE_HERON = /^(pulsedex-|capture-host\/)/;

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const utcStamp = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
const log = (m) => console.log(`[compute-feeder ${new Date().toISOString().slice(11, 19)}Z] ${m}`);

function readJsonl(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}
const appendJsonl = (p, o) => appendFileSync(p, `${JSON.stringify(o)}\n`);

/* ── the work list: every lens site at origin/main ──────────────────────────────────────────── */

/** Pure: the matching line numbers (1-based) of one lens over one file's text. */
export function sitesIn(lens, text) {
  const out = [];
  const lines = text.split('\n');
  for (const [i, l] of lines.entries()) {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) continue;
    if (LENSES[lens].re.test(l)) out.push(i + 1);
  }
  return out;
}

export function listItems(ref = 'origin/main') {
  const tree = git(['ls-tree', '-r', ref]).split('\n').filter(Boolean);
  const items = [];
  for (const row of tree) {
    const m = row.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (!m) continue;
    for (const lens of Object.keys(LENSES)) if (LENSES[lens].files(m[2])) items.push({ lens, file: m[2], blob: m[1] });
  }
  return items;
}

const itemKey = (it) => `${it.lens}:${it.file}:${it.blob}`;

/* ── qwen ───────────────────────────────────────────────────────────────────────────────────── */

/** Pure: the prompt for one site, the target line marked with `>>`. */
export function sitePrompt(lens, file, lines, lineNo) {
  const L = LENSES[lens];
  const lo = Math.max(1, lineNo - CONTEXT_LINES);
  const hi = Math.min(lines.length, lineNo + CONTEXT_LINES);
  const ctx = [];
  for (let n = lo; n <= hi; n++) ctx.push(`${n === lineNo ? '>>' : '  '} ${String(n).padStart(5)}  ${lines[n - 1]}`);
  return [
    `Rule: ${L.rule}`,
    `Question: ${L.question}`,
    'Answer only from the code below. If you are not sure, answer false.',
    'Reply with JSON only: {"defect": true or false, "claim": "one sentence naming the value and why"}',
    '',
    `File: ${file}`,
    ...ctx
  ].join('\n');
}

/** Pure: read the model reply; anything that is not a clean boolean is no lead. */
export function parseReply(text) {
  try {
    const o = JSON.parse(String(text).trim());
    if (o && o.defect === true && typeof o.claim === 'string' && o.claim.trim()) return { defect: true, claim: o.claim.trim().slice(0, 300) };
    if (o && o.defect === false) return { defect: false };
  } catch {}
  return null;
}

async function api(path, body, ms = 600_000) {
  const r = await boundedFetch(`${OLLAMA}${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {}, { cls: 'model', ms, label: `ollama ${path}` });
  return r.json();
}

async function embedMs() {
  const t = Date.now();
  try {
    await api('/api/embed', { model: 'bge-m3', input: ['compute feeder probe'] }, 15_000);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  return Date.now() - t;
}

async function runQwen({ budgetMin, lensFilter, model, dryRun }) {
  mkdirSync(join(STATE, 'leads'), { recursive: true });
  const doneP = join(STATE, 'qwen-done.jsonl');
  const done = new Set(readJsonl(doneP).map((d) => d.key));
  const pending = listItems().filter((it) => (!lensFilter || it.lens === lensFilter) && !done.has(itemKey(it)));
  log(`qwen: ${pending.length} lens×file item(s) pending`);
  if (!pending.length || dryRun) return { leadsFile: null, sites: 0 };

  let gate;
  try {
    gate = await gpuState(model, OLLAMA);
  } catch (e) {
    log(`qwen: ollama unreachable (${e.message}); skipped`);
    return { leadsFile: null, sites: 0 };
  }
  log(`qwen: VRAM gate — ${gate.why}`);
  if (!gate.ok) return { leadsFile: null, sites: 0 };

  const mainRef = git(['rev-parse', 'origin/main']).trim();
  const leadsFile = join(STATE, 'leads', `${utcStamp()}.jsonl`);
  const deadline = Date.now() + budgetMin * 60_000;
  let sites = 0;
  let leads = 0;
  let stop = null;
  for (const it of pending) {
    const text = git(['cat-file', 'blob', it.blob]);
    const lines = text.split('\n');
    const all = sitesIn(it.lens, text);
    let complete = true;
    for (const n of all) {
      if (Date.now() > deadline) stop = 'time budget spent';
      else if (sites % 10 === 0) {
        const ms = await embedMs();
        if (ms > EMBED_SLOW_MS) stop = `the 1-input embed took ${ms} ms (> ${EMBED_SLOW_MS}); doc-search comes first`;
      }
      if (stop) {
        complete = false;
        break;
      }
      let reply = null;
      try {
        const r = await api('/api/generate', {
          model,
          prompt: sitePrompt(it.lens, it.file, lines, n),
          stream: false,
          think: false,
          format: 'json',
          keep_alive: '5m',
          options: { temperature: 0, num_ctx: 4096, num_predict: 160 }
        });
        reply = parseReply(r.response);
      } catch (e) {
        stop = `generate failed: ${e.message}`;
        complete = false;
        break;
      }
      sites++;
      if (reply?.defect) {
        leads++;
        appendJsonl(leadsFile, {
          lens: it.lens,
          ref: mainRef,
          file: it.file,
          line: n,
          quote: lines[n - 1].trim(),
          claim: reply.claim,
          check: `re-read ${it.file}:${n} at origin/main; ${LENSES[it.lens].question}`,
          model
        });
      }
    }
    if (complete) appendJsonl(doneP, { key: itemKey(it), sites: all.length, at: new Date().toISOString() });
    if (stop) break;
  }
  try {
    await api('/api/generate', { model, keep_alive: 0 }, 30_000);
  } catch {}
  log(`qwen: ${sites} site(s) asked, ${leads} raw lead(s)${stop ? `; stopped: ${stop}` : ''}; model unloaded`);
  if (!leads) return { leadsFile: null, sites };
  const raw = readLeads(leadsFile);
  const res = checkLeads(raw, repoSource());
  const keptP = leadsFile.replace(/\.jsonl$/, '.kept.jsonl');
  writeFileSync(keptP, res.kept.map((l) => JSON.stringify(l)).join('\n') + (res.kept.length ? '\n' : ''));
  log(`qwen: lead check kept ${res.kept.length} of ${raw.length}; dropped ${JSON.stringify(res.dropped)}`);
  return { leadsFile: keptP, sites };
}

/* ── shrike ─────────────────────────────────────────────────────────────────────────────────── */

/** Pure: estimated hours of one queue file (`est-hours: N` line; 1 h when absent). */
export function estHours(text) {
  const m = String(text).match(/^est-hours:\s*([\d.]+)/m);
  return m ? +m[1] : 1;
}

export function queuedHours(dir = join(OUTBOX, 'queue')) {
  if (!existsSync(dir)) return null;
  let h = 0;
  for (const f of readdirSync(dir)) if (f.endsWith('.md')) h += estHours(readFileSync(join(dir, f), 'utf8'));
  return h;
}

const RULE0 = '**Rule 0 first.** `git fetch` and `git pull` in your clone, then run the Rule 0 searches from HOUSE-RULES. Put the `Rule 0:` line first in the output file.';

/** Pure: the text of a verify-leads task. */
export function verifyTask(leads, outPath) {
  return [
    RULE0,
    '',
    'est-hours: 1',
    'source: tools/compute-feeder.mjs (local-model leads, mechanically checked)',
    '',
    '# Verify local-model leads',
    '',
    `A local model flagged the ${leads.length} sites below. Each one passed a mechanical check (the quote is at the line, the site still matches).`,
    'A model is wrong often. Decide each lead yourself from the code at current `origin/main`.',
    '',
    '1. Open the file at the line. Read the function around it.',
    '2. Write `CONFIRMED` or `REJECTED` for each lead, with a fresh `grep -n` quote of the line.',
    '3. For `CONFIRMED`, name the value that was not measured (or the clock rule it breaks) and the caller that sees it.',
    `4. Write the results to \`${outPath}\`.`,
    '',
    '| # | lens | site | quote | model claim |',
    '|---|---|---|---|---|',
    ...leads.map((l, i) => `| ${i + 1} | ${l.lens} | \`${l.file}:${l.line}\` | \`${l.quote.replace(/[|`]/g, ' ').slice(0, 120)}\` | ${l.claim.replace(/\|/g, ' ')} |`),
    ''
  ].join('\n');
}

/** Pure: the text of a whole-file lens audit task. */
export function auditTask(lens, file, blob, outPath) {
  const L = LENSES[lens];
  return [
    RULE0,
    '',
    `est-hours: ${AUDIT_EST_H}`,
    'source: tools/compute-feeder.mjs (lens audit)',
    '',
    `# ${lens.toUpperCase()} audit of \`${file}\``,
    '',
    `Audit \`${file}\` (blob \`${blob.slice(0, 9)}\` when this task was written; read the file at current \`origin/main\`).`,
    `Rule: ${L.rule}`,
    '',
    '1. Read the whole file, not only the grep hits.',
    '2. Report each defect in the HOUSE-RULES finding format, with a fresh `grep -n` quote.',
    '3. Grep `briefs/RESIDUE.md` for the file name. Mark each finding that a row already names as `KNOWN <key>`.',
    `4. Write the report to \`${outPath}\`. Write \`no defect found\` with the sites you read when there is none.`,
    ROUTE_HERON.test(file) ? '5. Post a board note to Heron (thread 8): this file is in the capture-host lane.' : '',
    ''
  ].join('\n');
}

/** Pure: the order of audit candidates — never-audited files changed since the backlog baseline first, then the oldest audit. */
export function auditOrder(items, issued, changedSince) {
  const last = new Map();
  for (const r of issued) if (r.kind === 'audit') last.set(`${r.lens}:${r.file}`, r);
  const cand = items.filter((it) => last.get(`${it.lens}:${it.file}`)?.blob !== it.blob);
  const rank = (it) => {
    const prev = last.get(`${it.lens}:${it.file}`);
    if (!prev) return changedSince.has(it.file) ? 0 : 1;
    return 2;
  };
  const at = (it) => last.get(`${it.lens}:${it.file}`)?.at || '';
  return cand.sort((a, b) => rank(a) - rank(b) || at(a).localeCompare(at(b)) || a.file.localeCompare(b.file));
}

/* Two pools (owner 2026-11-22): `queue/` is what Shrike works NOW, while the birds are awake — kept small
   (--now-hours). `reserve/` is NOT read by Shrike; it holds --reserve-hours of work for when the fleet
   runs out of tokens. `run` releases the reserve into the queue when no bird has posted on the board
   for --quiet-h hours, the fleet's out-of-tokens signature. Verify-lead batches always go to the queue:
   a lead goes stale as main moves. */
const BIRDS = ['kestrel', 'heron', 'osprey', 'magpie', 'finch', 'wren', 'crane'];

/** The newest board post by a bird, as epoch ms, or null when the board is unreadable. Read-only. */
export function lastBirdPostMs() {
  const db = join(process.env.AGENT_BOARD_DIR || join(homedir(), '.agent-board'), 'board.db');
  if (!existsSync(db)) return null;
  const py = `import sqlite3,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nr=c.execute("select max(created_at) from entries where author in (%s)"%','.join('?'*len(sys.argv[2:])),sys.argv[2:]).fetchone()\nprint(r[0] or '')`;
  try {
    const t = execFileSync('python3', ['-I', '-c', py, db, ...BIRDS], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Pure: is the fleet quiet? An unreadable board is NOT quiet (absence is not a signal). */
export function fleetQuiet(lastMs, nowMs, quietH) {
  if (lastMs == null) return false;
  return nowMs - lastMs >= quietH * 3_600_000;
}

/** Pure: which reserve files to release (name order) to bring the queue up to `wantH`. */
export function pickRelease(reserve, queueH, wantH) {
  const out = [];
  let h = queueH;
  for (const r of [...reserve].sort((x, y) => x.name.localeCompare(y.name))) {
    if (h >= wantH) break;
    out.push(r.name);
    h += r.est;
  }
  return out;
}

function poolFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, est: estHours(readFileSync(join(dir, f), 'utf8')) }));
}

function runRelease({ wantH, dryRun, why }) {
  const q = join(OUTBOX, 'queue');
  const r = RESERVE;
  const queueH = queuedHours(q);
  if (queueH == null) return 0;
  const names = pickRelease(poolFiles(r), queueH, wantH);
  // copy then unlink: a new file takes the queue folder group and ACL, and the pools can sit on two filesystems
  for (const n of names)
    if (!dryRun) {
      copyFileSync(join(r, n), join(q, n));
      unlinkSync(join(r, n));
    }
  log(`shrike: ${dryRun ? 'would release' : 'released'} ${names.length} reserve file(s) into the queue (${why})`);
  return names.length;
}

function runShrike({ nowHours, reserveHours, dryRun }) {
  const qdir = join(OUTBOX, 'queue');
  const rdir = RESERVE;
  if (!dryRun) mkdirSync(rdir, { recursive: true });
  const qHave = queuedHours(qdir);
  if (qHave == null) {
    log(`shrike: no ${qdir}; skipped`);
    return 0;
  }
  if (!dryRun) mkdirSync(rdir, { recursive: true });
  const rHave = queuedHours(rdir) ?? 0;
  const issuedP = join(STATE, 'shrike-issued.jsonl');
  mkdirSync(STATE, { recursive: true });
  const issued = readJsonl(issuedP);
  const hours = { queue: qHave, reserve: rHave };
  let wrote = 0;
  const today = new Date().toISOString().slice(0, 10);
  const write = (pool, slug, text, rec, est) => {
    const name = `800-${utcStamp()}-${String(wrote).padStart(2, '0')}-${slug}.md`;
    if (!dryRun) {
      writeFileSync(join(pool === 'queue' ? qdir : rdir, name), text);
      appendJsonl(issuedP, { ...rec, pool, task: name, at: new Date().toISOString() });
    }
    wrote++;
    hours[pool] += est;
    log(`shrike: ${dryRun ? 'would queue' : 'queued'} ${pool}/${name} (${est} h)`);
  };

  // 1 · kept leads not yet issued — always the NOW queue, a lead goes stale as main moves
  const issuedLeads = new Set(issued.filter((r) => r.kind === 'verify').flatMap((r) => r.leads || []));
  const keptDir = join(STATE, 'leads');
  const kept = existsSync(keptDir)
    ? readdirSync(keptDir)
        .filter((f) => f.endsWith('.kept.jsonl'))
        .sort()
        .flatMap((f) => readJsonl(join(keptDir, f)))
        .filter((l) => !issuedLeads.has(`${l.file}:${l.line}:${l.lens}`))
    : [];
  for (let i = 0; i < kept.length; i += LEADS_PER_BATCH) {
    const batch = kept.slice(i, i + LEADS_PER_BATCH);
    const slug = `verify-leads-${batch[0].lens}`;
    const out = `${OUTBOX}/${today}-FEEDER-${slug}-${utcStamp().slice(9, 15)}.md`;
    write('queue', slug, verifyTask(batch, out), { kind: 'verify', leads: batch.map((l) => `${l.file}:${l.line}:${l.lens}`) }, VERIFY_EST_H);
  }

  // 2 · lens audits: the reserve first (the out-of-tokens promise), then the now queue
  if (hours.reserve < reserveHours || hours.queue < nowHours) {
    let changed = new Set();
    try {
      changed = new Set(git(['log', '--since=2026-11-16', '--name-only', '--format=', 'origin/main']).split('\n').filter(Boolean));
    } catch {}
    for (const it of auditOrder(listItems(), issued, changed)) {
      const pool = hours.reserve < reserveHours ? 'reserve' : hours.queue < nowHours ? 'queue' : null;
      if (!pool) break;
      const slug = `${it.lens}-${it.file.replace(/[^a-z0-9]+/gi, '-').replace(/-js$|-py$/, '')}`;
      const out = `${OUTBOX}/${today}-FEEDER-${slug}.md`;
      write(pool, slug, auditTask(it.lens, it.file, it.blob, out), { kind: 'audit', lens: it.lens, file: it.file, blob: it.blob }, AUDIT_EST_H);
    }
  }
  log(`shrike: queue ${qHave} → ${hours.queue} h (now target ${nowHours}); reserve ${rHave} → ${hours.reserve} h (target ${reserveHours}); ${wrote} file(s) ${dryRun ? 'planned' : 'written'}`);
  return wrote;
}

/* ── status ─────────────────────────────────────────────────────────────────────────────────── */

function status() {
  const done = readJsonl(join(STATE, 'qwen-done.jsonl'));
  const doneKeys = new Set(done.map((d) => d.key));
  const items = listItems();
  const byLens = {};
  for (const it of items) {
    if (!byLens[it.lens]) byLens[it.lens] = { files: 0, pending: 0 };
    const b = byLens[it.lens];
    b.files++;
    if (!doneKeys.has(itemKey(it))) b.pending++;
  }
  const issued = readJsonl(join(STATE, 'shrike-issued.jsonl'));
  console.log(
    JSON.stringify(
      {
        state: STATE,
        qwen: { byLens, answeredItems: done.length },
        shrike: {
          queueHours: queuedHours(),
          reserveHours: queuedHours(RESERVE),
          issuedTasks: issued.length,
          lastBirdPost: lastBirdPostMs() ? new Date(lastBirdPostMs()).toISOString() : null
        }
      },
      null,
      2
    )
  );
}

/* ── selftest ───────────────────────────────────────────────────────────────────────────────── */

function selftest() {
  let ok = 0;
  let fail = 0;
  const ck = (name, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    pass ? ok++ : fail++;
    console.log(`  ${pass ? '✓' : '✕'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  ck('sitesIn finds a ?? 0 and skips a comment', sitesIn('absence', 'const a = x ?? 0;\n// b ?? 0\nconst c = 1;'), [1]);
  ck('sitesIn clock skips getUTCHours', sitesIn('clock', 'd.getUTCHours();\nd.getHours();'), [2]);
  const p = sitePrompt('absence', 'x.js', ['a', 'b', 'c ?? 0', 'd'], 3);
  ck('the prompt marks the target line', p.includes('>>     3  c ?? 0') && p.includes('       2  b'), true);
  ck('parseReply reads a lead', parseReply('{"defect":true,"claim":"hr default"}'), { defect: true, claim: 'hr default' });
  ck('parseReply reads a no', parseReply('{"defect":false}'), { defect: false });
  ck('parseReply refuses prose', parseReply('YES it is'), null);
  ck('parseReply refuses a lead with no claim', parseReply('{"defect":true}'), null);
  ck('estHours reads the header', [estHours('x\nest-hours: 2.5\n'), estHours('no header')], [2.5, 1]);
  const vt = verifyTask([{ lens: 'absence', file: 'a.js', line: 4, quote: 'x | y', claim: 'c' }], '/o.md');
  ck('a verify task starts with Rule 0 and keeps the table intact', [vt.startsWith('**Rule 0 first.**'), vt.includes('`x   y`')], [true, true]);
  ck('an audit task in Heron lane routes to Heron', auditTask('absence', 'pulsedex-dsp.js', 'abcdef0123', '/o.md').includes('Heron'), true);
  ck('an audit task outside it does not', auditTask('absence', 'oxydex-dsp.js', 'abcdef0123', '/o.md').includes('Heron'), false);
  const items = [
    { lens: 'absence', file: 'a.js', blob: 'b1' },
    { lens: 'absence', file: 'b.js', blob: 'b2' },
    { lens: 'absence', file: 'c.js', blob: 'b3' },
    { lens: 'absence', file: 'd.js', blob: 'b4' }
  ];
  const issued = [
    { kind: 'audit', lens: 'absence', file: 'c.js', blob: 'old', at: '2026-11-01' },
    { kind: 'audit', lens: 'absence', file: 'd.js', blob: 'b4', at: '2026-11-02' }
  ];
  ck(
    'audit order: changed-new, new, re-audit of a moved file; an unchanged audited file drops',
    auditOrder(items, issued, new Set(['b.js'])).map((i) => i.file),
    ['b.js', 'a.js', 'c.js']
  );
  const H = 3_600_000;
  ck('fleet quiet after 3 h of no bird post', [fleetQuiet(0, 3 * H, 3), fleetQuiet(0, 2 * H, 3)], [true, false]);
  ck('an unreadable board is not quiet', fleetQuiet(null, 99 * H, 3), false);
  const res = [
    { name: '800-b.md', est: 1.5 },
    { name: '800-a.md', est: 1.5 },
    { name: '800-c.md', est: 1.5 }
  ];
  ck('release picks in name order up to the wanted hours', pickRelease(res, 1, 4), ['800-a.md', '800-b.md']);
  ck('release picks nothing when the queue is full', pickRelease(res, 6, 4), []);
  console.log(fail === 0 ? `all ${ok} selftests passed` : `${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/* ── CLI ────────────────────────────────────────────────────────────────────────────────────── */

const SPEC = {
  valued: ['--budget-min', '--lens', '--model', '--now-hours', '--reserve-hours', '--quiet-h', '--hours'],
  boolean: ['--selftest', '--dry-run'],
  positional: true
};

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, SPEC, { tool: 'compute-feeder' });
  const val = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  if (argv.includes('--selftest')) selftest();
  const [cmd] = positionalArgs(argv, { valued: SPEC.valued });
  const lensFilter = val('--lens', null);
  if (lensFilter && !LENSES[lensFilter]) {
    console.error(`compute-feeder: unknown lens ${lensFilter} (have ${Object.keys(LENSES).join(', ')})`);
    process.exit(2);
  }
  const dryRun = argv.includes('--dry-run');
  const qopts = { budgetMin: +val('--budget-min', 20), lensFilter, model: val('--model', 'qwen3.8:27b'), dryRun };
  const sopts = { nowHours: +val('--now-hours', 6), reserveHours: +val('--reserve-hours', 48), dryRun };
  const quietH = +val('--quiet-h', 3);
  if (cmd === 'status') status();
  else if (cmd === 'qwen') await runQwen(qopts);
  else if (cmd === 'shrike') runShrike(sopts);
  else if (cmd === 'release') runRelease({ wantH: +val('--hours', Number.POSITIVE_INFINITY), dryRun, why: 'asked by hand' });
  else if (cmd === 'run') {
    const last = lastBirdPostMs();
    if (fleetQuiet(last, Date.now(), quietH)) {
      runRelease({ wantH: sopts.nowHours + 12, dryRun, why: `no bird posted for ${((Date.now() - last) / 3_600_000).toFixed(1)} h` });
    }
    runShrike(sopts);
    await runQwen(qopts);
    runShrike(sopts); // fresh kept leads go to Shrike in the same cycle
  } else {
    console.error(
      'usage: node tools/compute-feeder.mjs status|qwen|shrike|release|run [--budget-min N] [--lens L] [--model M] [--now-hours H] [--reserve-hours H] [--quiet-h H] [--hours H] [--dry-run] | --selftest'
    );
    process.exit(2);
  }
}
