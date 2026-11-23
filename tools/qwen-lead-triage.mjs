#!/usr/bin/env node
/*
 * tools/qwen-lead-triage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * FIRST-PASS TRIAGE OF THE LOCAL MODEL'S LEADS THROUGH THE ANTHROPIC BATCH API
 * (owner 2026-11-23: "Use API coder to triage Qwen work"; brief LOCAL-QWEN-SWEEPS-2026-11-22 §3.4–3.6).
 *
 * The compute feeder writes leads that pass the mechanical check to
 * `<git common dir>/tepna-mutation/compute-feeder/leads/*.kept.jsonl`. No bird had triaged one of
 * them: 312 kept leads and no `triage.jsonl` on 2026-11-23. This tool sends each lead, with the code
 * around its site at origin/main, to the API model and asks the lens question again.
 *
 *   node tools/qwen-lead-triage.mjs pack     [--limit N]      # dedupe, re-check at origin/main, build requests
 *   node tools/qwen-lead-triage.mjs submit   [--cap-usd 150] [--dry-run]
 *   node tools/qwen-lead-triage.mjs poll
 *   node tools/qwen-lead-triage.mjs collect                  # writes the lens ledgers
 *   node tools/qwen-lead-triage.mjs report                   # per-lens counts against the §3.5 band
 *   node tools/qwen-lead-triage.mjs --selftest
 *
 * WHAT THE OUTPUT IS. Every ledger line carries `triagedBy: "api:<model>"`. It is a first pass, not a
 * bird's triage: a bird re-reads the site before any residue row or fix (brief §3.4), and a bird
 * spot-checks a sample before a lens keep, narrow or retire decision. An `unsure` answer goes to
 * `api-unsure.jsonl`, never into the ledger, so the ledger keeps the brief's three-word vocabulary.
 *
 * COST. One spend cap covers this tool AND tools/memory-program.mjs, because both spend one key
 * (owner 2026-11-22: $200 that expires 2026-12-01). `submit` refuses when the two ledgers plus the
 * estimate pass the cap. The key is never printed; every line written to disk passes `scrub`.
 * The code it sends is this public repository's own source at origin/main.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { CHARS_PER_TOKEN, MODEL, PRICE, resolveKey, scrub, spent as memorySpent, stateDir as memoryStateDir } from './memory-program.mjs';
import { checkLeads, LENSES, readLeads, repoSource } from './qwen-lead-check.mjs';

export const CONTEXT_LINES = 60; /* lines each side of the site; an absence verdict needs the caller's guard */
export const MAX_OUT = 8000;
export const EST_OUT_TOKENS = 1500; /* pre-submit estimate per request; the ledger records the real usage */
const API = 'https://api.anthropic.com/v1/messages/batches';
const HEADERS = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason', 'fix'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'rejected', 'unsure'] },
    reason: { type: 'string' },
    fix: { type: ['string', 'null'] }
  }
};

export const SYSTEM = `You check one lead that a small local model wrote about one line of a JavaScript or Python file in a physiological-signal analysis repository.
The lead names a lens, the house rule for that lens, and one question about the marked line. You get the code around the line, as it stands now.

Answer the lens question for the marked line only:
- "confirmed": the marked line breaks the rule, and you can say which value or path shows it.
- "rejected": the line obeys the rule. Typical cases: the zero is a true count, a sum accumulator, an index, a real measured value, a length, or a layout number; the date is built from a numeric floating time and read with getUTC*; the number is not shown to the user or a badge sits on the same card.
- "unsure": the answer depends on code you cannot see (for example a caller in another file). Say what you would need.

reason: at most 60 words, plain English, naming the variable and the path. Do not repeat the lead's claim back.
fix: for "confirmed" only, one sentence on the smallest repair that keeps absence visible (null plus a named reason or count); else null.
Judge the code, not the lead. The local model is often wrong.`;

/* ── paths ──────────────────────────────────────────────────────────────── */
const mutationDir = () => join(memoryStateDir(), '..');
export const leadsDir = () => join(mutationDir(), 'compute-feeder', 'leads');
export const ledgerPath = (lens) => join(mutationDir(), 'qwen-sweeps', lens, 'triage.jsonl');
function stateDir() {
  const d = join(mutationDir(), 'qwen-lead-triage');
  mkdirSync(d, { recursive: true });
  return d;
}
const readJsonl = (p) => (existsSync(p) ? readLeads(p) : []);
function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : dflt;
}
function key() {
  const r = resolveKey({
    keyVar: 'ANTHROPIC_API_KEY',
    keyFile: join(homedir(), '.config', 'tepna', 'anthropic.env'),
    env: process.env,
    exists: existsSync,
    mode: (p) => statSync(p).mode,
    read: (p) => readFileSync(p, 'utf8')
  });
  if (!r.key) throw new Error(`no key: ${r.reason}`);
  return r.key;
}

/* ── pure helpers (selftested) ──────────────────────────────────────────── */
export const leadKey = (l) => `${l.lens}|${l.file}|${String(l.quote).trim()}`;

/* The first lead per key wins; a key already in a ledger is skipped. */
export function dedupe(leads, seen = new Set()) {
  const out = [];
  const keys = new Set(seen);
  for (const l of leads) {
    const k = leadKey(l);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(l);
  }
  return out;
}

/* The line in `text` whose trim equals the quote, nearest to the lead's line; null when none. */
export function locate(text, quote, near) {
  const q = String(quote).trim();
  let best = null;
  text.split('\n').forEach((l, i) => {
    if (l.trim() === q && (best == null || Math.abs(i + 1 - near) < Math.abs(best - near))) best = i + 1;
  });
  return best;
}

/* Numbered lines around `line` (1-based), the marked line prefixed with ">>". */
export function excerpt(text, line, span = CONTEXT_LINES) {
  const lines = text.split('\n');
  const lo = Math.max(1, line - span);
  const hi = Math.min(lines.length, line + span);
  const out = [];
  for (let n = lo; n <= hi; n++) out.push(`${n === line ? '>>' : '  '}${String(n).padStart(6)}  ${lines[n - 1]}`);
  return out.join('\n');
}

export function userMessage(lead, curLine, code) {
  const lens = LENSES[lead.lens];
  return `Lens: ${lead.lens}
Rule: ${lens.rule}
Question: ${lens.question}
File: ${lead.file} (origin/main), marked line ${curLine}
Local model's claim: ${lead.claim}

<code>
${code}
</code>`;
}

export function estimateUsd(pack) {
  const inTok = pack.reduce((s, o) => s + o.chars / CHARS_PER_TOKEN + 500, 0);
  return inTok * PRICE.inPerTok + pack.length * EST_OUT_TOKENS * PRICE.outPerTok;
}

/* The ledger line for one answer, or null when the answer is not a ledger verdict. */
export function ledgerLine(entry, answer, meta) {
  if (!answer || !['confirmed', 'rejected'].includes(answer.verdict)) return null;
  return {
    lens: entry.lens,
    file: entry.file,
    line: entry.line,
    quote: entry.quote,
    ref: entry.ref,
    verdict: answer.verdict,
    reason: answer.reason,
    fix: answer.fix ?? null,
    triagedBy: `api:${meta.model}`,
    batch: meta.batch,
    at: meta.at
  };
}

/* Per-lens counts. A lens under 30 triaged leads reports no rate: the §3.5 band needs 30. */
export function tally(lines) {
  const by = {};
  for (const l of lines) {
    if (!by[l.lens]) by[l.lens] = { confirmed: 0, rejected: 0, duplicate: 0 }; // absence-ok: counters of answers seen
    const t = by[l.lens];
    if (l.verdict in t) t[l.verdict]++;
  }
  for (const t of Object.values(by)) {
    t.triaged = t.confirmed + t.rejected + t.duplicate;
    t.confirmedRate = t.triaged >= 30 ? t.confirmed / t.triaged : null;
  }
  return by;
}

/* ── commands ───────────────────────────────────────────────────────────── */
function allLedgerLines() {
  return Object.keys(LENSES).flatMap((lens) => readJsonl(ledgerPath(lens)));
}
function spentHere() {
  /* A row without a cost is unknown spend, never $0: NaN makes the cap refuse (fail closed). */
  return readJsonl(join(stateDir(), 'results.jsonl')).reduce((s, r) => s + (Number.isFinite(r.usd) ? r.usd : Number.NaN), 0);
}

export function cmdPack() {
  const dir = leadsDir();
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.kept.jsonl')) : [];
  const raw = files.flatMap((n) => readLeads(join(dir, n)));
  const seen = new Set([...allLedgerLines(), ...readJsonl(join(stateDir(), 'api-unsure.jsonl'))].map(leadKey));
  const uniq = dedupe(raw, seen);
  const src = repoSource();
  const { kept, dropped } = checkLeads(uniq, src);
  const limit = Number(arg('--limit', 0));
  const pack = [];
  for (const lead of limit > 0 ? kept.slice(0, limit) : kept) {
    const cur = src.fileAt(src.mainRef, lead.file);
    const at = cur == null ? null : locate(cur, lead.quote, lead.line);
    if (at == null) {
      dropped['not-located'] = (dropped['not-located'] || 0) + 1; // absence-ok: a count of dropped leads
      continue;
    }
    const text = userMessage(lead, at, excerpt(cur, at));
    pack.push({ lead: { ...lead, line: at, ref: src.mainRef }, text, chars: text.length + SYSTEM.length });
  }
  writeFileSync(join(stateDir(), 'pack.jsonl'), pack.map((o) => JSON.stringify(o)).join('\n') + (pack.length ? '\n' : ''));
  console.log(`kept-lead files ${files.length} · leads ${raw.length} · unique and untriaged ${uniq.length} · packed ${pack.length}`);
  console.log(`dropped before packing: ${JSON.stringify(dropped)}`);
  console.log(`estimate $${estimateUsd(pack).toFixed(2)} at ${MODEL}`);
}

export async function cmdSubmit() {
  const cap = Number(arg('--cap-usd', 150));
  const pack = readJsonl(join(stateDir(), 'pack.jsonl'));
  if (!pack.length) throw new Error('nothing packed');
  const est = estimateUsd(pack);
  const already = spentHere() + memorySpent();
  console.log(`requests ${pack.length} · estimate $${est.toFixed(2)} · spent on this key $${already.toFixed(2)} · cap $${cap}`);
  if (!(already + est <= cap)) throw new Error('refused: spent + estimate passes the cap');
  if (process.argv.includes('--dry-run')) return;
  const requests = pack.map((o, i) => ({
    custom_id: `t${String(i).padStart(4, '0')}`,
    params: {
      model: MODEL,
      max_tokens: MAX_OUT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: o.text }]
    }
  }));
  const k = key();
  const res = await fetch(API, { method: 'POST', headers: HEADERS(k), body: JSON.stringify({ requests }) });
  const body = await res.text();
  if (!res.ok) throw new Error(scrub(`submit ${res.status}: ${body.slice(0, 600)}`, k));
  const batch = JSON.parse(body);
  const map = Object.fromEntries(requests.map((r, i) => [r.custom_id, pack[i].lead]));
  appendFileSync(join(stateDir(), 'batches.jsonl'), JSON.stringify({ id: batch.id, at: new Date().toISOString(), n: requests.length, est, map }) + '\n');
  console.log(`submitted ${batch.id} (${requests.length} requests)`);
}

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
    const n = { confirmed: 0, rejected: 0, unsure: 0, failed: 0 };
    let usd = 0;
    const at = new Date().toISOString();
    for (const line of lines) {
      const r = JSON.parse(line);
      const lead = b.map[r.custom_id];
      if (r.result?.type !== 'succeeded') {
        n.failed++;
        appendFileSync(join(sd, 'errors.jsonl'), scrub(JSON.stringify({ lead, result: r.result }), k) + '\n');
        continue;
      }
      const m = r.result.message;
      const u = m.usage || {};
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
        /* a refusal or a cut answer: counted as failed, kept in results */
      }
      appendFileSync(join(sd, 'results.jsonl'), scrub(JSON.stringify({ lead, stop: m.stop_reason, usage: u, usd: cost, answer }), k) + '\n');
      if (!answer) {
        n.failed++;
        continue;
      }
      const row = ledgerLine(lead, answer, { model: MODEL, batch: b.id, at });
      if (row) {
        mkdirSync(join(ledgerPath(lead.lens), '..'), { recursive: true });
        appendFileSync(ledgerPath(lead.lens), scrub(JSON.stringify(row), k) + '\n');
        n[row.verdict]++;
      } else {
        appendFileSync(join(sd, 'api-unsure.jsonl'), scrub(JSON.stringify({ ...lead, reason: answer.reason, batch: b.id, at }), k) + '\n');
        n.unsure++;
      }
    }
    appendFileSync(join(sd, 'collected.jsonl'), JSON.stringify({ id: b.id, at, ...n, usd }) + '\n');
    console.log(`${b.id}: ${JSON.stringify(n)} · $${usd.toFixed(2)}`);
  }
  console.log(`this tool's ledger total $${spentHere().toFixed(2)}`);
}

export function cmdReport() {
  const by = tally(allLedgerLines());
  const unsure = readJsonl(join(stateDir(), 'api-unsure.jsonl')).length;
  const usd = spentHere();
  for (const [lens, t] of Object.entries(by)) {
    const rate = t.confirmedRate == null ? `no rate (under 30 triaged)` : `${(100 * t.confirmedRate).toFixed(0)} % confirmed (band: keep at 30 % or more)`;
    console.log(`${lens.padEnd(8)} triaged ${String(t.triaged).padStart(4)} · confirmed ${t.confirmed} · rejected ${t.rejected} · ${rate}`);
  }
  const conf = Object.values(by).reduce((s, t) => s + t.confirmed, 0);
  console.log(`unsure, held for a bird: ${unsure} · API spend $${usd.toFixed(2)}${conf ? ` · $${(usd / conf).toFixed(3)} per confirmed lead` : ''}`);
  console.log('Every line is an API first pass (triagedBy api:*). A bird re-reads a site before any row or fix.');
}

function selftest() {
  let ok = 0;
  let fail = 0;
  const ck = (name, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    pass ? ok++ : fail++;
    console.log(`  ${pass ? '✓' : '✕'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const a = { lens: 'absence', file: 'x.js', line: 3, quote: ' const v = r.v || 0; ' }; // absence-ok: selftest fixture text
  ck('dedupe keeps the first lead per lens, file and trimmed quote', dedupe([a, { ...a, line: 9, quote: 'const v = r.v || 0;' }]).length, 1); // absence-ok: selftest fixture text
  ck('dedupe skips a key a ledger already holds', dedupe([a], new Set([leadKey(a)])).length, 0);
  const text = ['a', 'const v = r.v || 0;', 'b', 'c', 'd', 'const v = r.v || 0;', 'e'].join('\n'); // absence-ok: selftest fixture text
  ck('locate picks the matching line nearest the lead', locate(text, 'const v = r.v || 0;', 5), 6); // absence-ok: selftest fixture text
  ck('locate answers null when the quote is gone', locate(text, 'nothing here', 2), null);
  const ex = excerpt(text, 2, 1).split('\n');
  ck('excerpt spans the window and marks the line', [ex.length, ex[1].startsWith('>>'), ex[0].startsWith('  ')], [3, true, true]);
  ck('excerpt clamps at the file start', excerpt(text, 1, 3).split('\n').length, 4);
  const meta = { model: 'm', batch: 'b', at: 't' };
  ck('an unsure answer makes no ledger line', ledgerLine(a, { verdict: 'unsure', reason: 'r', fix: null }, meta), null);
  ck('a null answer makes no ledger line', ledgerLine(a, null, meta), null);
  ck('a confirmed answer names the API as the triager', ledgerLine(a, { verdict: 'confirmed', reason: 'r', fix: 'f' }, meta).triagedBy, 'api:m');
  const rows = Array.from({ length: 30 }, (_, i) => ({ lens: 'clock', verdict: i < 9 ? 'confirmed' : 'rejected' }));
  ck('30 triaged leads give a rate', tally(rows).clock.confirmedRate, 0.3);
  ck('29 triaged leads give no rate', tally(rows.slice(1)).clock.confirmedRate, null);
  ck('the estimate grows with the pack', estimateUsd([{ chars: 3500 }]) < estimateUsd([{ chars: 3500 }, { chars: 3500 }]), true);
  ck(
    'every lens has a rule and a question for the message',
    Object.values(LENSES).every((l) => l.rule && l.question),
    true
  );
  console.log(fail === 0 ? `all ${ok} selftests passed` : `${ok} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

const SPEC = { valued: ['--limit', '--cap-usd'], boolean: ['--selftest', '--dry-run'], positional: true };

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, SPEC, { tool: 'qwen-lead-triage' });
  if (argv.includes('--selftest')) selftest();
  const cmd = argv.find((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a));
  const run = { pack: cmdPack, submit: cmdSubmit, poll: cmdPoll, collect: cmdCollect, report: cmdReport }[cmd];
  if (!run) {
    console.error('usage: node tools/qwen-lead-triage.mjs pack|submit|poll|collect|report [--limit N] [--cap-usd N] [--dry-run] | --selftest');
    process.exit(2);
  }
  Promise.resolve(run()).catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}
