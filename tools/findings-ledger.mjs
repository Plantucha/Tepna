/*
  findings-ledger.mjs — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0

  THE FINDINGS LEDGER — C1 of the qwen engineering program (QWEN-ENGINEERING-PROGRAM
  2026-08-27 §4). Every model worker writes findings ONLY through this; the coordinator
  triages ONLY through this. It exists because the program's charter (§16/§17) makes
  precision a first-class quantity: a lens whose findings are not tracked cannot be
  measured, and a lens that cannot be measured does not run.

  DESIGN
  - Event-sourced JSONL, append-only: {at, event:'new'|'seen'|'status', id, ...}. The
    current state of a finding is the fold of its events; nothing is ever rewritten.
  - Dedup key (charter §16: root cause + file + invariant): sha256(lens \0 file \0
    normalized claim) — the claim is normalized by lowercasing and stripping digits so a
    line-number or count drift does not defeat deduplication. A re-reported finding
    becomes a 'seen' event on the existing id, never a second row.
  - Status lifecycle (charter §16 verbatim): new → confirmed | rejected | duplicate |
    fixed | regression. Only triage (the CLI, i.e. a human/coordinator) writes 'status'
    events; workers can only add 'new'/'seen'.
  - Precision per lens = confirmed / (confirmed + rejected) over triaged findings. The
    pre-stated bands live in the program brief (§2.5): <30 % after 30 triaged ⇒ narrow or
    retire; ≥60 % over ≥20 ⇒ the lens may earn Level 2. This tool only reports the
    numbers; it decides nothing (the same §0 rule the workers live under).

  Usage:
    node tools/findings-ledger.mjs add            # one finding as JSON on stdin
    node tools/findings-ledger.mjs status <id> <confirmed|rejected|duplicate|fixed|regression> [note...]
    node tools/findings-ledger.mjs stats          # per-lens counts + precision
    node tools/findings-ledger.mjs report         # markdown report (nightly §19 surface)
    node tools/findings-ledger.mjs open           # untriaged findings, oldest first
    node tools/findings-ledger.mjs --selftest
  Programmatic: import { addFinding, setStatus, loadState, stats } — workers use addFinding.
*/
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const STATUSES = ['new', 'confirmed', 'rejected', 'duplicate', 'fixed', 'regression'];

function ledgerDir() {
  if (process.env.FINDINGS_DIR) {
    mkdirSync(process.env.FINDINGS_DIR, { recursive: true });
    return process.env.FINDINGS_DIR;
  }
  for (const c of [join(ROOT, '.git'), '/home/michal/Tepna/.git']) {
    // In a WORKTREE `.git` is a FILE (gitdir pointer): existsSync says true, mkdir under it says
    // ENOTDIR, and the caller's fail-soft catch turned that into review findings silently never
    // reaching the ledger (measured 2026-08-27: 3 review journals full, ledger rows 0). Require a
    // real directory so worktrees fall through to the primary checkout's shared state.
    if (existsSync(c) && statSync(c).isDirectory()) {
      const d = join(c, 'tepna-mutation', 'findings');
      mkdirSync(d, { recursive: true });
      return d;
    }
  }
  const d = join(ROOT, '.findings');
  mkdirSync(d, { recursive: true });
  return d;
}
const ledgerPath = () => join(ledgerDir(), 'ledger.jsonl');

/* Dedup identity: lens + file + normalized claim. Digits and line refs stripped so the
   same defect re-found at a drifted line number folds into one finding. */
export function findingId(f) {
  const norm = String(f.claim || '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256')
    .update(`${f.lens || f.category || ''}\0${f.file || ''}\0${f.invariant || ''}\0${norm}`)
    .digest('hex')
    .slice(0, 12);
}

export function loadState(path = ledgerPath()) {
  const state = new Map();
  if (!existsSync(path)) return state;
  for (const l of readFileSync(path, 'utf8').split('\n')) {
    if (!l) continue;
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e.event === 'new') state.set(e.id, { ...e.finding, id: e.id, status: 'new', seen: 1, firstAt: e.at, lastAt: e.at });
    else if (e.event === 'seen' && state.has(e.id)) {
      const s = state.get(e.id);
      s.seen++;
      s.lastAt = e.at;
    } else if (e.event === 'status' && state.has(e.id)) {
      const s = state.get(e.id);
      s.status = e.status;
      if (e.note) s.note = e.note;
      s.triagedAt = e.at;
    }
  }
  return state;
}

/* Worker entry point. Returns {id, isNew}. A finding re-reported while already fixed is
   re-opened as a REGRESSION candidate — that is a signal, not a duplicate. */
export function addFinding(f, path = ledgerPath()) {
  const id = findingId(f);
  const state = loadState(path);
  const at = new Date().toISOString();
  if (!state.has(id)) {
    appendFileSync(path, `${JSON.stringify({ at, event: 'new', id, finding: f })}\n`);
    return { id, isNew: true };
  }
  const cur = state.get(id);
  appendFileSync(path, `${JSON.stringify({ at, event: 'seen', id })}\n`);
  if (cur.status === 'fixed') appendFileSync(path, `${JSON.stringify({ at, event: 'status', id, status: 'regression', note: 're-reported after fixed' })}\n`);
  return { id, isNew: false };
}

export function setStatus(id, status, note, path = ledgerPath()) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join('|')}`);
  const state = loadState(path);
  if (!state.has(id)) throw new Error(`unknown finding id ${id}`);
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), event: 'status', id, status, note: note || undefined })}\n`);
}

export function stats(path = ledgerPath()) {
  const byLens = {};
  for (const f of loadState(path).values()) {
    const lens = f.lens || f.category || '(none)';
    const b = (byLens[lens] ??= { total: 0, new: 0, confirmed: 0, rejected: 0, duplicate: 0, fixed: 0, regression: 0 });
    b.total++;
    b[f.status] = (b[f.status] || 0) + 1;
  }
  for (const b of Object.values(byLens)) {
    const triaged = b.confirmed + b.rejected;
    b.triaged = triaged;
    b.precision = triaged ? +(b.confirmed / triaged).toFixed(2) : null; // null, not 0: untriaged is UNMEASURED, not bad
  }
  return byLens;
}

export function report(path = ledgerPath()) {
  const state = [...loadState(path).values()];
  const st = stats(path);
  const open = state.filter((f) => f.status === 'new').sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  const conf = { high: 0, medium: 1, low: 2 };
  let md = `# Findings ledger report\n\n⚠️ Every finding is a MODEL PROPOSAL until its status says otherwise. Precision is per-lens\nconfirmed/(confirmed+rejected); null means UNMEASURED (nothing triaged yet), which is not 0.\n\n## Per-lens precision\n\n| lens | total | untriaged | confirmed | rejected | precision |\n|---|---|---|---|---|---|\n`;
  for (const [lens, b] of Object.entries(st)) md += `| ${lens} | ${b.total} | ${b.new} | ${b.confirmed} | ${b.rejected} | ${b.precision === null ? '—' : b.precision} |\n`;
  md += `\n## Open findings (${open.length}, oldest first)\n\n| id | conf | lens | file:line | claim |\n|---|---|---|---|---|\n`;
  for (const f of open.sort((a, b) => (conf[a.confidence] ?? 3) - (conf[b.confidence] ?? 3)))
    md += `| ${f.id} | ${f.confidence || '?'} | ${f.lens || f.category || ''} | ${f.file || ''}:${f.line || ''} | ${String(f.claim || '').replace(/\|/g, '/')} |\n`;
  md += `\nSpeculative = confidence low AND untriaged. Triage: \`node tools/findings-ledger.mjs status <id> <verdict> [note]\`\n`;
  writeFileSync(join(dirname(path), 'FINDINGS-REPORT.md'), md);
  return { open: open.length, lenses: Object.keys(st).length, md };
}

function selftest() {
  let ok = 0;
  let fail = 0;
  const ck = (name, cond) => {
    if (cond) ok++;
    else {
      fail++;
      console.error(`✗ ${name}`);
    }
  };
  const tmp = join(process.env.TMPDIR || '/tmp', `fl-selftest-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const p = join(tmp, 'ledger.jsonl');
  const f1 = { lens: 'resource-leak', file: 'a.py', claim: 'socket opened at line 42 never closed', confidence: 'high' };
  const f1b = { lens: 'resource-leak', file: 'a.py', claim: 'Socket opened at line 57 never closed', confidence: 'medium' };
  const f2 = { lens: 'silent-stop', file: 'a.py', claim: 'poller exits loop on None', confidence: 'high' };
  const r1 = addFinding(f1, p);
  ck('first add is new', r1.isNew);
  const r1b = addFinding(f1b, p);
  ck('digit-drifted re-report dedups', r1b.id === r1.id && !r1b.isNew);
  const r2 = addFinding(f2, p);
  ck('different lens/claim is distinct', r2.id !== r1.id && r2.isNew);
  ck('seen counted', loadState(p).get(r1.id).seen === 2);
  setStatus(r1.id, 'confirmed', 'verified in source', p);
  setStatus(r2.id, 'rejected', 'guard exists two lines up', p);
  const st = stats(p);
  ck('precision computed', st['resource-leak'].precision === 1 && st['silent-stop'].precision === 0);
  ck('untriaged precision is null not 0', (addFinding({ lens: 'x', file: 'b', claim: 'c' }, p), stats(p).x.precision === null));
  setStatus(r1.id, 'fixed', '', p);
  const r1c = addFinding(f1, p);
  ck('re-report after fixed → regression', !r1c.isNew && loadState(p).get(r1.id).status === 'regression');
  let threw = false;
  try {
    setStatus(r1.id, 'nonsense', '', p);
  } catch {
    threw = true;
  }
  ck('bad status refused', threw);
  threw = false;
  try {
    setStatus('ffffffffffff', 'confirmed', '', p);
  } catch {
    threw = true;
  }
  ck('unknown id refused', threw);
  const rep = report(p);
  ck('report writes and counts open', rep.open === 1 && existsSync(join(tmp, 'FINDINGS-REPORT.md')));
  ck('id stable across processes', findingId(f1) === findingId({ ...f1 }));
  console.log(`selftest: ${ok} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--selftest') return selftest();
  if (cmd === 'add') {
    const f = JSON.parse(readFileSync(0, 'utf8'));
    const r = addFinding(f);
    console.log(JSON.stringify(r));
    return;
  }
  if (cmd === 'status') {
    const [id, status, ...note] = rest;
    setStatus(id, status, note.join(' '));
    console.log(`${id} → ${status}`);
    return;
  }
  if (cmd === 'stats') {
    console.log(JSON.stringify(stats(), null, 1));
    return;
  }
  if (cmd === 'report') {
    const r = report();
    console.log(`${r.open} open finding(s) across ${r.lenses} lens(es) → FINDINGS-REPORT.md`);
    return;
  }
  if (cmd === 'open') {
    for (const f of [...loadState().values()].filter((x) => x.status === 'new')) console.log(`${f.id}  ${f.lens || ''}  ${f.file || ''}:${f.line || ''}  ${f.claim || ''}`);
    return;
  }
  console.error('usage: findings-ledger.mjs add|status|stats|report|open|--selftest');
  process.exit(2);
}
if (fileURLToPath(import.meta.url) === process.argv[1] || (process.argv[1] && process.argv[1].endsWith('findings-ledger.mjs'))) main();
