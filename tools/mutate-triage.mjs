#!/usr/bin/env node
/*
 * tools/mutate-triage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE TRIAGE HALF OF MUTATION TESTING — the part that turns a percentage into a work list.
 *
 * `tools/mutate.mjs` answers "what fraction of mutants does the suite kill?". That number alone does
 * not tell you what to write next, and on a 40–80 minute sweep you cannot afford to re-run to find
 * out. The Python side has had this for a while (`mutmut results` → survivor list → `mutmut apply
 * <id>` → write a test → verify by id); the JS side had the sweep and nothing else, so raising a kill
 * rate meant re-reading a truncated survivor list and hand-editing source to reproduce one.
 *
 * WHAT THIS ADDS, and why each piece exists:
 *
 *   --list        enumerate every mutant with a STABLE ID, without testing any of them. This is
 *                 mutmut's `--dry-run`: cheap, and it is what makes an id meaningful across runs.
 *
 *   --apply <id>  write exactly that mutant to disk (with a backup) and print the diff, so a survivor
 *                 can be reproduced in seconds instead of by hand-editing. `--revert` restores.
 *                 Reproduction is the step that decides whether a survivor is a real test gap or
 *                 legitimately untestable, and it was the missing one.
 *
 *   --report      group survivors from a `mutate.mjs --json` run by ENCLOSING FUNCTION, ranked by
 *                 count. A flat survivor list of 34 reads as 34 problems; grouped, it is usually
 *                 three or four functions the suite never exercises — which is one test each, not 34.
 *                 This is the piece that actually moves a kill rate toward 90 %.
 *
 * IT DOES NOT RE-IMPLEMENT THE OPERATORS. Every mutant comes from `mutate.mjs --dry-run --json`, run
 * as a subprocess. A second copy of `OPS` would drift from the first, and this repo has already been
 * bitten by exactly that (a divergent `tchSigmas` copy in the power tool). The ids and the `after`
 * text come from the one generator, so `--apply` reproduces byte-for-byte what the sweep tested.
 *
 * SAFETY. `--apply` refuses if the target is already dirty in git, writes a `.mutate-triage-backup`
 * beside the file, and `--revert` restores from it. A mutated source left on disk is how a "green"
 * run becomes a lie, so the backup is not optional and the tool says loudly what is dirty.
 *
 * USAGE
 *   node tools/mutate-triage.mjs --file clock.js --list
 *   node tools/mutate-triage.mjs --file clock.js --apply clock.js:38:4
 *   node tools/mutate-triage.mjs --revert
 *   node tools/mutate.mjs --file clock.js --json > /tmp/run.json
 *   node tools/mutate-triage.mjs --report /tmp/run.json
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_SUFFIX = '.mutate-triage-backup';

/* ── enclosing-function attribution ─────────────────────────────────────────────────────────────
   Scan BACKWARDS from the mutant's line for the nearest declaration. Deliberately syntactic and
   approximate: it groups survivors well enough to see a cluster, and a wrong attribution costs a
   mislabelled group, never a wrong verdict. Nothing downstream depends on it being exact. */
const DECL = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/,
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function/,
  /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/
];
/* `if (x) {`, `for (…) {`, `while (…) {` all match the bare `name(args) {` shape above, and without
   this the report cheerfully attributes survivors to a function called "if". Caught on the first real
   report run — the grouping was right, the label was nonsense. */
const NOT_A_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'function', 'return', 'typeof', 'await', 'with']);
export function enclosingFn(lines, lineNo) {
  for (let i = Math.min(lineNo - 1, lines.length - 1); i >= 0; i--) {
    for (const re of DECL) {
      const m = re.exec(lines[i]);
      if (m && !NOT_A_FN.has(m[1])) return m[1];
    }
  }
  return '(top level)';
}

/* Group survivors by enclosing function, ranked by count then first line. The ORDER is the product:
   it is the sequence a person should write tests in. */
export function groupSurvivors(survivors, srcText) {
  const lines = (srcText || '').split('\n');
  const by = new Map();
  for (const s of survivors) {
    const fn = enclosingFn(lines, s.line);
    if (!by.has(fn)) by.set(fn, { fn, n: 0, firstLine: s.line, ops: new Map(), items: [] });
    const g = by.get(fn);
    g.n++;
    g.firstLine = Math.min(g.firstLine, s.line);
    g.ops.set(s.op, (g.ops.get(s.op) || 0) + 1);
    g.items.push(s);
  }
  return [...by.values()].map((g) => ({ ...g, ops: [...g.ops.entries()].sort((a, b) => b[1] - a[1]) })).sort((a, b) => b.n - a.n || a.firstLine - b.firstLine);
}

/* Mutants for one file, from the ONE generator — never re-derived here. */
export function enumerate(file) {
  const out = execFileSync('node', [join(ROOT, 'tools/mutate.mjs'), '--file', file, '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  const f = (j.files || []).find((x) => x.file === file) || (j.files || [])[0];
  if (!f || f.error) throw new Error('enumerate: ' + file + ' → ' + (f ? f.error : 'no result'));
  return f.mutants || [];
}

function gitDirty(file) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const has = (k) => argv.includes(k);
  const FILE = opt('--file', null);
  const JSON_OUT = has('--json');

  if (has('--revert')) {
    let n = 0;
    for (const f of execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')) {
      const b = join(ROOT, f + BACKUP_SUFFIX);
      if (f && existsSync(b)) {
        writeFileSync(join(ROOT, f), readFileSync(b, 'utf8'));
        rmSync(b, { force: true });
        console.log('  reverted ' + f);
        n++;
      }
    }
    console.log(n ? n + ' file(s) restored from backup.' : 'nothing to revert (no ' + BACKUP_SUFFIX + ' found).');
    process.exit(0);
  }

  if (has('--report')) {
    const runPath = opt('--report', null);
    if (!runPath || !existsSync(runPath)) {
      console.error('usage: --report <mutate.mjs --json output>');
      process.exit(2);
    }
    /* `mutate.mjs --json` emits NDJSON — ONE OBJECT PER FILE, not a wrapper with a `files` array.
       The first version of this reader assumed the wrapper shape and reported "no survivors" on a run
       carrying 34 of them: a triage tool that silently finds nothing is worse than one that errors,
       because "nothing to triage" reads like good news. Accept both shapes, and refuse loudly if
       neither parses. */
    const raw = readFileSync(runPath, 'utf8');
    const files = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      let o;
      try {
        o = JSON.parse(t);
      } catch {
        continue;
      }
      if (Array.isArray(o.files)) files.push(...o.files);
      else if (Array.isArray(o.results)) files.push(...o.results);
      else if (o.file) files.push(o);
    }
    if (!files.length) {
      console.error('--report: no per-file records found in ' + runPath + ' — expected NDJSON from `mutate.mjs --json`');
      process.exit(2);
    }
    const rows = [];
    for (const f of files) {
      const surv = f.survivors || [];
      if (!surv.length) continue;
      const abs = join(ROOT, f.file);
      const src = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      rows.push({ file: f.file, killed: f.killed, tested: f.tested, groups: groupSurvivors(surv, src) });
    }
    if (JSON_OUT) {
      console.log(JSON.stringify({ files: rows }, null, 2));
      process.exit(0);
    }
    if (!rows.length) {
      console.log('No survivors in that run — nothing to triage.');
      process.exit(0);
    }
    console.log('\nSURVIVOR TRIAGE — where the suite cannot see a change, grouped by function\n');
    for (const r of rows) {
      const rate = r.tested ? ((r.killed / r.tested) * 100).toFixed(0) : '—';
      console.log(`${r.file}   killed ${r.killed}/${r.tested} = ${rate}%`);
      for (const g of r.groups) {
        console.log(`   ${String(g.n).padStart(3)} survivor(s)  ${g.fn}  (from L${g.firstLine})`);
        console.log(`        ops: ${g.ops.map(([o, c]) => o + '×' + c).join(', ')}`);
        for (const it of g.items.slice(0, 2)) console.log(`        L${it.line}  ${it.before.slice(0, 88)}`);
        if (g.items.length > 2) console.log(`        …${g.items.length - 2} more`);
      }
      const top = r.groups[0];
      if (top) {
        const share = ((top.n / r.groups.reduce((a, g) => a + g.n, 0)) * 100).toFixed(0);
        console.log(`\n   → start with ${top.fn}: ${top.n} of ${r.groups.reduce((a, g) => a + g.n, 0)} survivors (${share}%) live there.`);
      }
      console.log('');
    }
    process.exit(0);
  }

  if (!FILE) {
    console.error('usage: --file <f> --list | --file <f> --apply <id> | --revert | --report <run.json>');
    process.exit(2);
  }

  if (has('--apply')) {
    const id = opt('--apply', null);
    const abs = join(ROOT, FILE);
    if (!existsSync(abs)) {
      console.error('no such file: ' + FILE);
      process.exit(2);
    }
    if (gitDirty(FILE) && !has('--force')) {
      console.error(`refusing: ${FILE} already has uncommitted changes.\nA mutant written over real edits is unrecoverable from the backup. Commit or stash first, or pass --force.`);
      process.exit(2);
    }
    const mu = enumerate(FILE).find((m) => m.id === id);
    if (!mu) {
      console.error('no mutant with id ' + id + ' in ' + FILE + ' — run --list');
      process.exit(2);
    }
    const src = readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    const idx = mu.line - 1;
    const orig = lines[idx];
    /* `before`/`after` are TRIMMED by the generator, so splice on the trimmed body and keep the
       original indentation — writing the trimmed form would reindent the line and show up as noise
       in the diff (and in `biome ci`). */
    const lead = orig.slice(0, orig.length - orig.trimStart().length);
    lines[idx] = lead + mu.after;
    writeFileSync(abs + BACKUP_SUFFIX, src);
    writeFileSync(abs, lines.join('\n'));
    console.log(`applied ${mu.id}   [${mu.op}]  ${FILE}:${mu.line}`);
    console.log(`  -  ${orig.trim()}`);
    console.log(`  +  ${lines[idx].trim()}`);
    console.log(`\nbackup: ${FILE}${BACKUP_SUFFIX}`);
    console.log('run a scoped gate, then:  node tools/mutate-triage.mjs --revert');
    process.exit(0);
  }

  // default: --list
  const ms = enumerate(FILE);
  if (JSON_OUT) {
    console.log(JSON.stringify({ file: FILE, generated: ms.length, mutants: ms }, null, 2));
    process.exit(0);
  }
  console.log(`\n${FILE} — ${ms.length} mutant(s), none tested (enumeration only)\n`);
  const src = existsSync(join(ROOT, FILE)) ? readFileSync(join(ROOT, FILE), 'utf8') : '';
  const lines = src.split('\n');
  for (const m of ms) console.log(`  ${m.id.padEnd(24)} [${m.op.padEnd(14)}] ${enclosingFn(lines, m.line).padEnd(22)} ${m.before.slice(0, 60)}`);
  console.log(`\napply one:  node tools/mutate-triage.mjs --file ${FILE} --apply <id>`);
}
