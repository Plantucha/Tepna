#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * unit-start — everything a session needs to open a work unit, printed by ONE command.
 *
 * THE COST THIS CUTS (measured 2026-11-07 by `tools/fleet-turns.mjs`, 09:00Z onward): every bird ran
 * about ONE tool call per turn (0.97–1.02 against the target of 2) at a median context of 141k–152k
 * per turn. A turn re-reads the whole window, so the five to ten opening reads a unit makes — the
 * handoff, Rule 0, the ref, the ledger, the bird's own PRs, the board — cost five to ten windows. This
 * prints all of them in one call, so they cost one.
 *
 * It decides nothing and edits nothing. Each section that cannot read its source says `unread:` and
 * why, so an absent section is never mistaken for an empty one (CLAUDE.md §∅).
 *
 *   node tools/unit-start.mjs handoffs/<slug>.md            # the full opening read
 *   node tools/unit-start.mjs handoffs/<slug>.md --query "<q>"   # override the Rule 0 query
 *   node tools/unit-start.mjs handoffs/<slug>.md --hits 8 --no-board --no-fetch
 *   node tools/unit-start.mjs --selftest
 *
 * Sections, in order: HANDOFF (the nine fields, or the first 40 lines of a free-form note) · REF
 * (origin/main, the branch and the worktree) · RULE 0 (`tools/doc-search.mjs`, top hits compacted to
 * two lines each) · RESIDUE (OPEN rows on origin/main whose source names a path the handoff names) ·
 * PRS (open PRs on the handoff's branch suffix) · BOARD (`agent-board --as <bird> inbox`).
 * Rule 0 runs only on the primary development computer, where the bge-m3 index lives; elsewhere that
 * section reads `unread:` and the session falls back to `git grep`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';

export const FIELDS = ['state', 'unit', 'bird', 'branch', 'worktree', 'doc-search', 'stopping-point', 'next-step', 'done-when'];
export const FREEFORM_LINES = 40;

/* ── pure core ──────────────────────────────────────────────────────────────────────────────── */
export function parseHandoff(text) {
  const fields = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\*\*([a-z-]+):\*\*\s*(.*)$/.exec(line.trim());
    if (m && FIELDS.includes(m[1])) fields[m[1]] = m[2].trim();
  }
  const structured = FIELDS.every((f) => fields[f]);
  const q = /^## Open questions\s*$/m.exec(String(text || ''));
  const open = q ? String(text).slice(q.index).split('\n').slice(0, 15).join('\n').trim() : '';
  return { fields, structured, open };
}

/* The branch suffix is the only self-applied evidence of whose work a PR is (memory
   `fleet-name-mapping`), so PRs are matched on it, never on a title. */
export function branchSuffix(branch) {
  const m = /-([a-z0-9]{2,4})$/.exec(String(branch || '').trim());
  return m ? m[1] : null;
}

/* Repo paths a handoff names: backticked or bare `dir/file.ext` tokens, deduplicated, `:line` cut. */
export function pathsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/([A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+\.(?:mjs|js|py|md|html|json|sh|yml)\b/g)) {
    const p = m[0];
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/* OPEN rows whose SOURCE cell names one of the paths, by full path or by basename. */
export function rowsTouching(ledger, paths) {
  const names = new Set();
  for (const p of paths || []) {
    names.add(p);
    names.add(p.split('/').pop());
  }
  const hits = [];
  let open = 0;
  for (const line of String(ledger || '').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split(' | ');
    const key = cells[0].slice(2).trim();
    if (!/^\d{4}-\d{2}-\d{2}-/.test(key)) continue;
    const state = cells[cells.length - 1].replace(/\s*\|\s*$/, '').trim();
    if (state !== 'OPEN') continue;
    open++;
    const src = (cells[2] || '').replace(/`/g, '').trim();
    if ([...names].some((n) => n && (src === n || src.endsWith(`/${n}`) || src.split('/').pop() === n))) hits.push({ key, source: src });
  }
  return { open, hits };
}

/* doc-search prints a score line (`  0.031  path:lines · names`) then a snippet line. Keep the first
   `n` hits as two short lines each: the path to open, and enough snippet to decide whether to. */
export function compactHits(out, n = 5, width = 160) {
  const lines = String(out || '').split('\n');
  const res = [];
  for (let i = 0; i < lines.length && res.length < n; i++) {
    const m = /^\s+(\d\.\d{3})\s{2}(\S.*)$/.exec(lines[i]);
    if (!m) continue;
    const snip = (lines[i + 1] || '').trim().replace(/\s+/g, ' ').slice(0, width);
    res.push(`  ${m[1]}  ${m[2].slice(0, width)}\n        ${snip}`);
  }
  return res;
}

/* ── I/O ────────────────────────────────────────────────────────────────────────────────────── */
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts });
const why = (e) =>
  String((e && (e.stderr || e.message)) || e)
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 140) || 'no message';

function section(title, body) {
  return `\n━━ ${title} ${'━'.repeat(Math.max(3, 70 - title.length))}\n${body.trimEnd()}\n`;
}

export const ARGV_SPEC = { valued: ['--query', '--hits'], boolean: ['--no-board', '--no-fetch', '--selftest'], positional: true };

export function main(argv) {
  const flag = (n) => argv.includes(n);
  const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const file = positionalArgs(argv, { valued: ARGV_SPEC.valued })[0];
  if (!file) {
    console.error('usage: node tools/unit-start.mjs handoffs/<slug>.md [--query "<q>"] [--hits N] [--no-board] [--no-fetch]');
    return 2;
  }
  if (!existsSync(file)) {
    console.error(`unit-start: no handoff at ${file}`);
    return 2;
  }
  const text = readFileSync(file, 'utf8');
  const h = parseHandoff(text);
  const f = h.fields;
  let out = `unit-start · ${file}`;

  // HANDOFF
  out += section(
    'HANDOFF',
    h.structured
      ? `${FIELDS.map((k) => `${k.padEnd(15)} ${f[k]}`).join('\n')}${h.open ? `\n\n${h.open}` : ''}`
      : `free-form handoff (not the nine-field shape), first ${FREEFORM_LINES} lines:\n${text.split('\n').slice(0, FREEFORM_LINES).join('\n')}`
  );

  // REF
  const ref = [];
  if (!flag('--no-fetch')) {
    try {
      run('git', ['fetch', '-q', 'origin', 'main']);
    } catch (e) {
      ref.push(`unread: fetch failed — ${why(e)}`);
    }
  }
  try {
    ref.push(`origin/main ${run('git', ['rev-parse', '--short', 'origin/main']).trim()} · ${run('git', ['log', '-1', '--format=%s', 'origin/main']).trim().slice(0, 90)}`);
  } catch (e) {
    ref.push(`unread: origin/main — ${why(e)}`);
  }
  const branch = f.branch || (/claude\/[a-z0-9-]+/.exec(text) || [])[0] || '';
  if (branch) {
    for (const r of [branch, `origin/${branch}`]) {
      try {
        const lr = run('git', ['rev-list', '--left-right', '--count', `origin/main...${r}`])
          .trim()
          .split(/\s+/);
        ref.push(`${r}: ${lr[1]} ahead, ${lr[0]} behind origin/main`);
      } catch {
        ref.push(`${r}: does not exist`);
      }
    }
  } else ref.push('unread: the handoff names no branch');
  const wt = f.worktree || (/~?\.{0,2}\/?wt-[a-z0-9-]+/.exec(text) || [])[0] || '';
  if (wt) {
    const abs = wt.startsWith('~') ? path.join(homedir(), wt.slice(1)) : path.resolve(wt);
    ref.push(`worktree ${wt}: ${existsSync(abs) ? `present${existsSync(path.join(abs, 'node_modules')) ? '' : ' — node_modules ABSENT, symlink it (CLAUDE.md §👥.1)'}` : 'absent'}`);
  }
  out += section('REF', ref.join('\n'));

  // RULE 0
  const query = val('--query', f['doc-search'] || '');
  let r0;
  if (!query) r0 = 'unread: the handoff has no doc-search field — pass --query "<q>"';
  else {
    try {
      const hits = compactHits(run('node', ['tools/doc-search.mjs', query]), Number(val('--hits', 5)));
      r0 = `query: ${query}\n${hits.length ? hits.join('\n') : 'no hits printed — run doc-search by hand and read its refusal'}`;
    } catch (e) {
      r0 = `unread: doc-search did not run — ${why(e)} (primary development computer only; elsewhere use git grep)`;
    }
  }
  out += section('RULE 0', r0);

  // RESIDUE
  let res;
  try {
    const led = run('git', ['show', 'origin/main:briefs/RESIDUE.md']);
    const paths = pathsIn(text);
    const t = rowsTouching(led, paths);
    res = `${t.open} OPEN row(s) on origin/main; ${t.hits.length} name a path this handoff names (${paths.length} path(s) read)`;
    if (t.hits.length) res += `\n${t.hits.map((x) => `  ${x.key}  ${x.source}`).join('\n')}`;
  } catch (e) {
    res = `unread: origin/main:briefs/RESIDUE.md — ${why(e)}`;
  }
  out += section('RESIDUE', res);

  // PRS
  const suf = branchSuffix(branch);
  let prs;
  if (!suf) prs = 'unread: no branch suffix to match PRs on';
  else {
    try {
      const list = JSON.parse(run('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,isDraft,headRefName,mergeStateStatus,title']));
      const mine = list.filter((p) => p.headRefName.endsWith(`-${suf}`));
      prs = `${mine.length} open PR(s) on suffix -${suf} (of ${list.length} open, cap 4 out of draft)`;
      if (mine.length) prs += `\n${mine.map((p) => `  #${p.number} ${p.isDraft ? 'draft' : 'ready'} ${p.mergeStateStatus} ${p.headRefName} · ${p.title.slice(0, 70)}`).join('\n')}`;
    } catch (e) {
      prs = `unread: gh pr list — ${why(e)}`;
    }
  }
  out += section('PRS', prs);

  // BOARD
  if (!flag('--no-board')) {
    const bird = (f.bird || '').toLowerCase();
    const bin = path.join(homedir(), '.local', 'bin', 'agent-board');
    let bd;
    if (!bird) bd = 'unread: the handoff names no bird';
    else if (!existsSync(bin)) bd = `unread: ${bin} absent on this machine`;
    else {
      try {
        const ib = run(bin, ['--as', bird, 'inbox']).split('\n');
        bd = ib.slice(0, 20).join('\n') + (ib.length > 20 ? `\n… ${ib.length - 20} more line(s): agent-board --as ${bird} inbox` : '');
      } catch (e) {
        bd = `unread: agent-board — ${why(e)}`;
      }
    }
    out += section('BOARD', bd);
  }
  process.stdout.write(`${out}\n`);
  return 0;
}

function selftest() {
  let ran = 0;
  const eq = (a, b, m) => {
    ran++;
    if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  };
  const H = `${FIELDS.map((k) => `**${k}:** v-${k}`).join('\n')}\n\n## Open questions\n- one`;
  eq(parseHandoff(H).structured, true, 'nine fields read as structured');
  eq(parseHandoff(H).open.startsWith('## Open questions'), true, 'open questions carried');
  eq(parseHandoff('# a free note').structured, false, 'free-form is not structured');
  eq(branchSuffix('claude/unit-start-k9m'), 'k9m', 'suffix');
  eq(branchSuffix('main'), null, 'no suffix');
  eq(pathsIn('see `capture-host/writers.py:1198` and tools/x.mjs, writers.py').join(','), 'capture-host/writers.py,tools/x.mjs,writers.py', 'paths');
  const L = '| 2026-11-07-a | d | `capture-host/writers.py` | x | e | OPEN |\n| 2026-11-07-b | d | `tools/y.mjs` | x | e | fixed #1 |';
  eq(rowsTouching(L, ['writers.py']).hits.length, 1, 'basename match');
  eq(rowsTouching(L, ['tools/y.mjs']).hits.length, 0, 'a closed row is not listed');
  eq(rowsTouching(L, []).open, 1, 'open count');
  eq(compactHits('x\n  0.031  a.md:1-2 · n\n        snippet here\n  0.030  b.md:3\n        s2', 1).length, 1, 'hit cap');
  console.log(`all ${ran} selftests passed`);
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'unit-start' });
  if (argv.includes('--selftest')) selftest();
  else process.exitCode = main(argv);
}
