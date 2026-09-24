#!/usr/bin/env node
/*
 * tools/doc-search-audit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════
 * WHO IS USING THE SEMANTIC SEARCH — the per-session query stamps, counted (rule 0's audit).
 *
 * `tools/doc-search.mjs` appends `<ISO>\t<query>` to `<git-common-dir>/tepna-mutation/
 * doc-search-sessions/<session_id>` on every search that ran. `guard-doc-search.sh` reads those
 * stamps to gate edits, commits and rulings; this tool reads them to ANSWER the owner's question
 * ("is everyone using bge?") from the record rather than from self-reports — measured 2026-09-24:
 * the coordinator answered "yes" from memory and the stamps said 1 query in 10 h.
 *
 * Output: one row per session — name (from ~/.config/herdr-birds.conf when present, else the id
 * prefix), total, queries in the window, last query time. `--since <hours>` (default 24),
 * `--json` for a plain object. Read-only; never writes a stamp itself. Prints no verdict word:
 * the reader decides what a count means.
 *
 * Primary dev machine only, like the search: on a box with no stamp dir it prints that and exits 0.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const SINCE_H = Number(flag('--since', '24'));
const JSON_OUT = args.includes('--json');

function commonDir() {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return out.startsWith('/') ? out : join(process.cwd(), out);
  } catch {
    return null;
  }
}

/** Session id → bird name, from the herdr roster if this box has one. Absent ⇒ ids stay ids. */
function roster() {
  const p = join(homedir(), '.config', 'herdr-birds.conf');
  const map = new Map();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([a-z]+)=([0-9a-f-]{8,})/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

export function summarise(dir, names, sinceMs, now = Date.now()) {
  const rows = [];
  for (const id of readdirSync(dir)) {
    const p = join(dir, id);
    if (!statSync(p).isFile()) continue;
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const times = lines.map((l) => Date.parse(l.split('\t')[0])).filter((t) => Number.isFinite(t));
    const inWindow = times.filter((t) => now - t <= sinceMs).length;
    const last = times.length ? new Date(Math.max(...times)).toISOString().slice(0, 16) + 'Z' : null;
    const name = [...names.entries()].find(([full]) => full.startsWith(id) || id.startsWith(full))?.[1] ?? id.slice(0, 8);
    rows.push({ session: id, name, total: lines.length, inWindow, last });
  }
  rows.sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''));
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const common = commonDir();
  const dir = common ? join(common, 'tepna-mutation', 'doc-search-sessions') : null;
  if (!dir || !existsSync(dir)) {
    console.log('doc-search-audit: no stamp directory here (not the primary dev machine, or no search has ever run)');
    process.exit(0);
  }
  const rows = summarise(dir, roster(), SINCE_H * 3600 * 1000);
  if (JSON_OUT) {
    console.log(JSON.stringify({ sinceHours: SINCE_H, sessions: rows }, null, 2));
  } else {
    console.log(`doc-search queries per session — last ${SINCE_H} h vs total (stamp dir: ${dir})`);
    for (const r of rows) console.log(`  ${r.name.padEnd(10)} window=${String(r.inWindow).padStart(3)}  total=${String(r.total).padStart(4)}  last=${r.last ?? '—'}`);
    const silent = rows.filter((r) => r.inWindow === 0).map((r) => r.name);
    if (silent.length) console.log(`  sessions with no query in the window: ${silent.join(', ')}`);
  }
}
