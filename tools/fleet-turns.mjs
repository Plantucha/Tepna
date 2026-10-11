#!/usr/bin/env node
/*
 * tools/fleet-turns.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * FLEET TURNS — how many turns each session spends, and how much each turn carries.
 *
 *     node tools/fleet-turns.mjs                  # every local session active since 04:00 local today
 *     node tools/fleet-turns.mjs --since 2026-10-12   # a day (starts 04:00 local), or an ISO instant
 *     node tools/fleet-turns.mjs --json           # one object per session, no prose
 *     node tools/fleet-turns.mjs --project <path> # the checkout whose transcripts to read (default: the main
 *                                                 # checkout of this repository, so a worktree reads the fleet's)
 *
 * WHY IT EXISTS. The fleet rule "fewer turns" (owner, 2026-10-11) is measurable or it is a wish.
 * A turn is one model call. Every call re-reads the whole context window. The window, not the
 * output, is the cost: measured 2026-10-11, the read per turn was 410k–607k tokens on about 1k of
 * output. So the lever is the number of calls, and two habits add calls for nothing:
 *   · one tool call per turn where several independent calls fit in one;
 *   · a text message between tool calls that narrates instead of acting.
 * This tool counts both, per session, from the local transcripts, so a bird can be told its own
 * number and the next day's number can be compared.
 *
 * WHAT IS MEASURED. `~/.claude/projects/<cwd-slug>/<session>.jsonl`, streamed line by line, never
 * loaded whole. One API call writes several lines that share a `requestId`; those are ONE turn.
 *   turns          distinct requestIds with a usage block
 *   tools/turn     tool_use blocks ÷ turns (higher is better batching; 0 is a prose-only session)
 *   narration      turns that carry text AND a tool call (text written between actions)
 *   compactions    lines flagged isCompactSummary
 *   ctx/turn       median of input + cache_creation + cache_read per turn (the window size)
 *   out/turn       mean output tokens per turn
 * Names come from the herder when it answers (`herdr agent list`); otherwise the id prefix.
 *
 * WHAT IT DOES NOT SAY. It prints no decision word. A target per bird is the owner's to set once
 * two days exist to compare. It cannot see a session whose transcript is elsewhere (the capture box).
 */
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const JSON_OUT = argv.includes('--json');
const sinceArg = flag('--since');

function sinceMs(a) {
  if (!a) { const d = new Date(); d.setHours(4, 0, 0, 0); if (d > Date.now()) d.setDate(d.getDate() - 1); return d.getTime(); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) { const [y, m, d] = a.split('-').map(Number); return new Date(y, m - 1, d, 4, 0, 0).getTime(); }
  const t = Date.parse(a);
  if (!Number.isFinite(t)) throw new Error(`--since: not a day or an ISO instant: ${a}`);
  return t;
}
const SINCE = sinceMs(sinceArg);
function mainCheckout() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return common.replace(/\/\.git$/, '');
  } catch { return process.cwd(); }
}
const project = flag('--project') ?? mainCheckout();
const slug = project.replace(/\//g, '-');
const dir = join(homedir(), '.claude', 'projects', slug);

function herderNames() {
  try {
    const out = execFileSync('herdr', ['agent', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    const j = JSON.parse(out);
    const m = new Map();
    for (const a of j?.result?.agents ?? []) if (a.agent_session?.value && a.name) m.set(a.agent_session.value, a.name);
    return m;
  } catch { return new Map(); }
}

async function readSession(file) {
  const turns = new Map(); // requestId → { ctx, out, tools, text }
  let compactions = 0;
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(o.timestamp ?? '');
    if (Number.isFinite(ts) && ts < SINCE) continue;
    if (o.isCompactSummary) compactions++;
    if (o.type !== 'assistant' || !o.message) continue;
    const id = o.requestId ?? o.uuid;
    const t = turns.get(id) ?? { ctx: 0, out: 0, tools: 0, text: 0, usage: false };
    const u = o.message.usage;
    if (u && !t.usage) {
      t.usage = true;
      t.ctx = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      t.out = u.output_tokens ?? 0;
    }
    for (const c of o.message.content ?? []) {
      if (c.type === 'tool_use') t.tools++;
      else if (c.type === 'text' && String(c.text ?? '').trim()) t.text++;
    }
    turns.set(id, t);
  }
  const list = [...turns.values()].filter((t) => t.usage);
  if (!list.length) return null;
  const ctx = list.map((t) => t.ctx).sort((a, b) => a - b);
  const tools = list.reduce((s, t) => s + t.tools, 0);
  const narration = list.filter((t) => t.tools > 0 && t.text > 0).length;
  return {
    turns: list.length,
    toolsPerTurn: +(tools / list.length).toFixed(2),
    narration,
    narrationShare: +(narration / list.length).toFixed(2),
    compactions,
    ctxMedian: ctx[Math.floor(ctx.length / 2)],
    ctxP90: ctx[Math.min(ctx.length - 1, Math.floor(ctx.length * 0.9))],
    outPerTurn: Math.round(list.reduce((s, t) => s + t.out, 0) / list.length),
  };
}

const names = herderNames();
const rows = [];
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { files = []; }
for (const f of files) {
  const p = join(dir, f);
  if (statSync(p).mtimeMs < SINCE) continue;
  const r = await readSession(p);
  if (!r || r.turns < 5) continue;
  const id = f.replace(/\.jsonl$/, '');
  rows.push({ session: id, name: names.get(id) ?? id.slice(0, 8), ...r });
}
rows.sort((a, b) => b.turns - a.turns);
if (JSON_OUT) { console.log(JSON.stringify({ since: new Date(SINCE).toISOString(), transcripts: dir, sessions: rows }, null, 1)); process.exit(0); }
console.log(`fleet turns since ${new Date(SINCE).toISOString()} — ${rows.length} session(s) with ≥5 turns, transcripts in ${dir}`);
if (!rows.length) { console.log('no session examined: nothing to report'); process.exit(0); }
const k = (n) => `${Math.round(n / 1000)}k`;
console.log('name       turns  tools/turn  narration  compactions  ctx/turn(med)  ctx/turn(p90)  out/turn');
for (const r of rows) console.log(`${r.name.padEnd(10)} ${String(r.turns).padStart(5)}  ${String(r.toolsPerTurn).padStart(10)}  ${String(`${r.narration} (${Math.round(r.narrationShare * 100)} %)`).padStart(9)}  ${String(r.compactions).padStart(11)}  ${k(r.ctxMedian).padStart(13)}  ${k(r.ctxP90).padStart(13)}  ${String(r.outPerTurn).padStart(8)}`);
console.log('\nread: tools/turn up and narration down is the rule "fewer turns" working. No target is set; the owner sets one from two days.');
