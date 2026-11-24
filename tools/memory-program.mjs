#!/usr/bin/env node
/*
 * memory-program.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the shared fleet memory directory (READ-ONLY) and asks the Anthropic Batch API to classify
 * each file, so that a bird can consolidate the directory from a reviewed proposal.
 * Brief: briefs/MEMORY-PROGRAM-2026-11-22-BRIEF.md.
 *
 *   node tools/memory-program.mjs pack     [--dir <memory dir>] [--limit N]
 *   node tools/memory-program.mjs submit   [--cap-usd 150] [--dry-run]
 *   node tools/memory-program.mjs poll
 *   node tools/memory-program.mjs collect
 *   node tools/memory-program.mjs refs                   # local check: do cited identifiers still exist?
 *   node tools/memory-program.mjs report                 # writes report.md beside the state
 *   node tools/memory-program.mjs spend                  # the cost ledger
 *
 * The tool NEVER writes into the memory directory. Every output goes to the state directory
 * `<git common dir>/tepna-mutation/memory-program/`, which git does not track.
 *
 * Key: ANTHROPIC_API_KEY from the environment, or `~/.config/tepna/anthropic.env` (mode 0600) —
 * the convention and the resolver of tools/gemini-review.mjs. The key is never printed; every line
 * written to disk passes `scrub`.
 *
 * Text is redacted before it leaves the rig: private and tailnet addresses, push/ping URLs, password
 * fields and long mixed tokens become placeholders. A file with an unredacted match after the pass is skipped.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

/* tools/gemini-review.mjs runs its main() on import, so its key helpers are restated here, same contract. */
const keyFileFor = (provider) => join(homedir(), '.config', 'tepna', `${provider}.env`);
export function scrub(text, secret) {
  const s = String(text ?? '');
  return secret ? s.split(secret).join('<API KEY REDACTED>') : s;
}
export function resolveKey({ keyVar, keyFile, env = {}, exists = () => false, mode = () => 0o600, read = () => '' }) {
  if (env[keyVar] && String(env[keyVar]).trim()) return { key: String(env[keyVar]).trim() };
  if (!exists(keyFile)) return { reason: `no ${keyVar} in the environment and no key file at ${keyFile}` };
  const m = mode(keyFile) & 0o777;
  if (m & 0o077) return { reason: `the key file ${keyFile} is mode ${m.toString(8)}; refusing until it is 0600` };
  const line = String(read(keyFile))
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${keyVar}=`));
  const v = line ? line.slice(keyVar.length + 1).trim() : '';
  return v ? { key: v } : { reason: `the key file ${keyFile} carries no ${keyVar} value` };
}

export const MODEL = 'claude-opus-5-5';
/* Batch prices are 50 % of the list prices for this model ($4 / $20 per MTok, cached 2026-10-06). */
export const PRICE = { inPerTok: 2 / 1e6, outPerTok: 10 / 1e6 };
export const MAX_OUT = 16000;
export const EST_OUT_TOKENS = 2500; /* pre-submit estimate per request; the ledger records the real usage */
export const CHARS_PER_TOKEN = 3.5;

const API = 'https://api.anthropic.com/v1/messages/batches';
const HEADERS = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

/* ── redaction ─────────────────────────────────────────────────────────────── */
export const REDACTIONS = [
  [/\b(?:(?:10|127)(?:\.\d{1,3}){3}|(?:192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(?:\.\d{1,3}){2})\b/g, '<private-ip>'],
  [/https?:\/\/[^\s)>\]'"`]*(?:ntfy|hc-ping|healthchecks|webhook|hooks\.)[^\s)>\]'"`]*/gi, '<private-url>'],
  [/\b(auth_pass|password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2<redacted>'],
  /* a long token; see isToken for what counts */
  [/\b[A-Za-z0-9_-]{32,}\b/g, (t) => (isToken(t) ? '<long-token>' : t)]
];
/* A secret token mixes cases and digits, or is one unbroken run with a digit and a non-hex letter.
   A kebab-case slug with a date in it is neither: the first rule cut 14 memory names and their
   [[links]] (measured on the import, 2026-11-23). A pure-hex run (a commit, a hash) stays. */
export function isToken(t) {
  if (/^[0-9a-f]+$/i.test(t)) return false;
  if (/[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t)) return true;
  return !/-/.test(t) && /\d/.test(t) && /[g-z]/i.test(t);
}
export function redact(text) {
  let out = String(text);
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}
export function stillSensitive(text) {
  return REDACTIONS.slice(0, 2).some(([re]) => new RegExp(re.source, re.flags).test(text));
}

/* ── schema of one answer ───────────────────────────────────────────────── */
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'lane', 'summary', 'claims', 'historical', 'promote'],
  properties: {
    kind: { type: 'string', enum: ['state', 'rule', 'lesson', 'incident', 'reference', 'index', 'other'] },
    lane: { type: 'string', enum: ['fleet-ops', 'git-and-queue', 'code-and-capture', 'instruments-and-inference', 'other'] },
    summary: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'identifiers', 'dated'],
        properties: {
          text: { type: 'string' },
          identifiers: { type: 'array', items: { type: 'string' } },
          dated: { type: ['string', 'null'] }
        }
      }
    },
    historical: { type: 'boolean' },
    promote: {
      type: 'object',
      additionalProperties: false,
      required: ['toSkill', 'skillHint'],
      properties: { toSkill: { type: 'boolean' }, skillHint: { type: ['string', 'null'] } }
    }
  }
};

export const SYSTEM = `You read one file from the shared memory directory of a fleet of coding agents that work on one repository.
Classify the file and extract its durable claims, so that a later step can merge duplicates, find stale lessons and move fleet-wide rules into versioned skill files.

Fields:
- kind: "state" (one agent's running status log), "rule" (a standing instruction from the owner that binds every agent), "lesson" (a learned fact about a tool, gate or measurement), "incident" (an account of one event), "reference" (a pointer to an external resource), "index" (a list of other memory files), "other".
- lane: the closest of the four lanes.
- summary: at most 40 words, plain English, what the file says, not what it is.
- claims: at most 8 durable claims, each one sentence. Put every file path, tool name, flag, function, environment variable, systemd unit or PR number the claim depends on in "identifiers", spelled exactly as in the file. "dated" is the date the file gives for the claim (YYYY-MM-DD) or null. For a state file, extract only claims that would still matter after the work it describes ended.
- historical: true if the file itself says it is superseded, historical, done or replaced.
- promote.toSkill: true only for a rule or lesson that every agent should follow on every task of its kind; skillHint names the kind of task in five words or fewer.

Placeholders such as <private-ip> or <redacted> replace removed values. Do not guess them.`;

/* ── paths ──────────────────────────────────────────────────────────────── */
export function stateDir() {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const d = join(common.startsWith('/') ? common : join(process.cwd(), common), 'tepna-mutation', 'memory-program');
  mkdirSync(d, { recursive: true });
  return d;
}
const DEFAULT_DIR = join(homedir(), '.claude', 'projects', '-home-michal-Tepna', 'memory');

/* `flag` is the literal token, so a scan of this file reads every flag it accepts. */
function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : dflt;
}
function key() {
  const keyFile = keyFileFor('anthropic');
  const r = resolveKey({
    keyVar: 'ANTHROPIC_API_KEY',
    keyFile,
    env: process.env,
    exists: existsSync,
    mode: (p) => statSync(p).mode,
    read: (p) => readFileSync(p, 'utf8')
  });
  if (!r.key) throw new Error(`no key: ${r.reason}`);
  return r.key;
}
const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/* ── pack ───────────────────────────────────────────────────────────────── */
export function cmdPack() {
  const dir = arg('--dir', DEFAULT_DIR);
  const limit = Number(arg('--limit', 0)) || Infinity;
  const done = new Set(readJsonl(join(stateDir(), 'results.jsonl')).map((r) => r.file));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
    .sort();
  const out = [];
  let skipped = 0;
  for (const f of files) {
    if (out.length >= limit) break;
    if (done.has(f)) continue;
    const text = redact(readFileSync(join(dir, f), 'utf8'));
    if (stillSensitive(text)) {
      skipped++;
      continue;
    }
    out.push({ file: f, chars: text.length, text });
  }
  writeFileSync(join(stateDir(), 'pack.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const chars = out.reduce((s, o) => s + o.chars, 0);
  console.log(`packed ${out.length} file(s), ${chars} chars, ${skipped} skipped as still sensitive, ${done.size} already answered`);
}

/* ── submit ─────────────────────────────────────────────────────────────── */
export function estimateUsd(pack) {
  const inTok = pack.reduce((s, o) => s + o.chars / CHARS_PER_TOKEN + 900, 0);
  return inTok * PRICE.inPerTok + pack.length * EST_OUT_TOKENS * PRICE.outPerTok;
}
export function spent() {
  /* A row without a cost is unknown spend, never $0: NaN makes the cap refuse (fail closed). */
  return readJsonl(join(stateDir(), 'results.jsonl')).reduce((s, r) => s + (Number.isFinite(r.usd) ? r.usd : Number.NaN), 0);
}
export async function cmdSubmit() {
  const cap = Number(arg('--cap-usd', 150));
  const pack = readJsonl(join(stateDir(), 'pack.jsonl'));
  if (!pack.length) throw new Error('nothing packed');
  const est = estimateUsd(pack);
  const already = spent();
  console.log(`requests ${pack.length} · estimate $${est.toFixed(2)} · spent $${already.toFixed(2)} · cap $${cap}`);
  if (!(already + est <= cap)) throw new Error(`refused: spent + estimate passes the cap`);
  if (process.argv.includes('--dry-run')) return;
  const requests = pack.map((o, i) => ({
    custom_id: `m${String(i).padStart(4, '0')}`,
    params: {
      model: MODEL,
      max_tokens: MAX_OUT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `File name: ${o.file}\n\n<file>\n${o.text}\n</file>` }]
    }
  }));
  const k = key();
  const res = await fetch(API, { method: 'POST', headers: HEADERS(k), body: JSON.stringify({ requests }) });
  const body = await res.text();
  if (!res.ok) throw new Error(scrub(`submit ${res.status}: ${body.slice(0, 600)}`, k));
  const batch = JSON.parse(body);
  const map = Object.fromEntries(requests.map((r, i) => [r.custom_id, pack[i].file]));
  appendFileSync(join(stateDir(), 'batches.jsonl'), JSON.stringify({ id: batch.id, at: new Date().toISOString(), n: requests.length, est, map }) + '\n');
  console.log(`submitted ${batch.id} (${requests.length} requests)`);
}

/* ── poll / collect ─────────────────────────────────────────────────────── */
const pending = () => {
  const collected = new Set(readJsonl(join(stateDir(), 'collected.jsonl')).map((c) => c.id));
  return readJsonl(join(stateDir(), 'batches.jsonl')).filter((b) => !collected.has(b.id));
};
export async function cmdPoll() {
  const k = key();
  for (const b of pending()) {
    const r = await (await fetch(`${API}/${b.id}`, { headers: HEADERS(k) })).json();
    console.log(`${b.id} ${r.processing_status} ${JSON.stringify(r.request_counts)}`);
  }
}
export async function cmdCollect() {
  const k = key();
  const sd = stateDir();
  for (const b of pending()) {
    const meta = await (await fetch(`${API}/${b.id}`, { headers: HEADERS(k) })).json();
    if (meta.processing_status !== 'ended') {
      console.log(`${b.id} still ${meta.processing_status}`);
      continue;
    }
    const lines = (await (await fetch(meta.results_url, { headers: HEADERS(k) })).text()).split('\n').filter(Boolean);
    let ok = 0;
    let bad = 0;
    let usd = 0;
    for (const line of lines) {
      const r = JSON.parse(line);
      const file = b.map[r.custom_id];
      if (r.result?.type !== 'succeeded') {
        bad++;
        appendFileSync(join(sd, 'errors.jsonl'), scrub(JSON.stringify({ file, result: r.result }), k) + '\n');
        continue;
      }
      const m = r.result.message;
      const u = m.usage || {};
      /* The API omits a cache field it did not use, so an absent cache count is a legal zero. The two
     main counts are always present; an absent one leaves the cost NaN, which the cap refuses. */
      const cost = (u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * PRICE.inPerTok + u.output_tokens * PRICE.outPerTok; // absence-ok: the API omits an unused cache count
      usd += cost;
      const text = (m.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      let answer = null;
      try {
        answer = JSON.parse(text);
      } catch {
        /* a refusal or a cut answer: kept as null and counted */
      }
      if (!answer) bad++;
      else ok++;
      appendFileSync(join(sd, 'results.jsonl'), scrub(JSON.stringify({ file, stop: m.stop_reason, usage: u, usd: cost, answer }), k) + '\n');
    }
    appendFileSync(join(sd, 'collected.jsonl'), JSON.stringify({ id: b.id, at: new Date().toISOString(), ok, bad, usd }) + '\n');
    console.log(`${b.id}: ${ok} answered, ${bad} not, $${usd.toFixed(2)}`);
  }
  console.log(`ledger total $${spent().toFixed(2)}`);
}

/* ── refs: does each cited identifier still exist on origin/main? ───────── */
export function looksCheckable(id) {
  if (/\s|<|>/.test(id)) return false; // a command line or a placeholder, not a name
  if (/^[\w.-]+\.(com|org|io|net|dev)$/i.test(id)) return false; // an outside host
  return /[/.]/.test(id) || /^[a-z][a-z0-9]*-[a-z0-9-]+$/.test(id) || /^--[a-z]/.test(id) || /^[A-Z][A-Z0-9_]{4,}$/.test(id);
}
export function cmdRefs() {
  const sd = stateDir();
  const files = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n'));
  const out = [];
  for (const r of readJsonl(join(sd, 'results.jsonl'))) {
    if (!r.answer) continue;
    for (const c of r.answer.claims) {
      for (const id of c.identifiers) {
        if (!looksCheckable(id)) continue;
        const bare = id.replace(/^`|`$/g, '').replace(/:\d+(-\d+)?$/, '');
        const mem = DEFAULT_DIR;
        let found = files.has(bare) || existsSync(join(mem, bare)) || existsSync(join(mem, `${bare}.md`));
        if (!found) {
          try {
            execFileSync('git', ['grep', '-qF', '--', bare, 'origin/main'], { stdio: 'ignore' });
            found = true;
          } catch {
            found = false;
          }
        }
        if (!found) out.push({ file: r.file, id: bare, claim: c.text });
      }
    }
  }
  writeFileSync(join(sd, 'refs-missing.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''));
  console.log(`${out.length} cited identifier(s) not found on origin/main`);
}

/* ── report ─────────────────────────────────────────────────────────────── */
export function cmdReport() {
  const sd = stateDir();
  const rs = readJsonl(join(sd, 'results.jsonl'));
  const ans = rs.filter((r) => r.answer);
  const by = (f) => {
    const m = {};
    for (const r of ans) m[f(r)] = (m[f(r)] ?? 0) + 1; // absence-ok: a tally starts at zero
    return m;
  };
  const missing = readJsonl(join(sd, 'refs-missing.jsonl'));
  const lines = [
    '# Memory program report',
    '',
    `Files answered: ${ans.length} of ${rs.length} collected. Spend: $${spent().toFixed(2)}.`,
    '',
    '## By kind',
    ...Object.entries(by((r) => r.answer.kind)).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## By lane',
    ...Object.entries(by((r) => r.answer.lane)).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `## Marked historical: ${ans.filter((r) => r.answer.historical).length}`,
    '',
    `## Promotion candidates: ${ans.filter((r) => r.answer.promote.toSkill).length}`,
    ...ans.filter((r) => r.answer.promote.toSkill).map((r) => `- ${r.file} → ${r.answer.promote.skillHint}`),
    '',
    `## Cited identifiers not on origin/main: ${missing.length}`,
    ...missing.slice(0, 200).map((m) => `- ${m.file}: \`${m.id}\``)
  ];
  writeFileSync(join(sd, 'report.md'), lines.join('\n') + '\n');
  console.log(`wrote ${join(sd, 'report.md')}`);
}

const CMDS = { pack: cmdPack, submit: cmdSubmit, poll: cmdPoll, collect: cmdCollect, refs: cmdRefs, report: cmdReport, spend: () => console.log(`$${spent().toFixed(2)}`) };
if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit(process.argv.slice(2), { valued: ['--dir', '--limit', '--cap-usd'], boolean: ['--dry-run'], positional: true }, { tool: 'memory-program.mjs' });
  const c = CMDS[process.argv[2]];
  if (!c) {
    console.error(`usage: memory-program.mjs ${Object.keys(CMDS).join('|')}`);
    process.exit(2);
  }
  Promise.resolve(c()).catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}
