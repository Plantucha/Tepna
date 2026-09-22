#!/usr/bin/env node
/*
 * tools/verdict-adoption.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT-CONTRACT ADOPTION GATE — every producer of a verdict word, enumerated and binned,
 * as an EQUALITY (VERDICT-CONTRACT §3 / §3b step 2).
 *
 * The brief's first adopter list was a recency sample (eleven tools); enumerated, the population is
 * ~150 files across both lanes. A list written from memory is the one-of-N trap
 * (`PARTIAL-ADOPTION-DETECTION`) — so the population is COMPUTED (the grep below, on the tree), every
 * member is BINNED in a committed manifest (`tools/verdict-adoption.json`), and the gate holds the two
 * equal: a producer the grep finds that the manifest does not name is a red WITH ITS NAME, and so is a
 * manifest row for a file that no longer prints the word.
 *
 * Bins (the manifest's `bin`), each with what the gate demands of it:
 *   decides       the output is a decision someone acts on → must adopt tepna.verdict/1; `status`
 *                 is `pending` or `adopted`; an `adopted` row names how it EMITS the object
 *                 (`emits: { cmd: [...] }` printing JSON, or `emits: { file }`), and the gate RUNS or
 *                 READS it and validates under verdict.js — the object is asserted, never the prose
 *   already-json  has --json / writes a record → converge the record (same rule as decides once adopted)
 *   word-only     the word occurs in a comment, a label, a log line that decides nothing → exempt,
 *                 WITH `reason` — an exemption without a reason is a silent adoption gap
 *   test          a test file asserting on verdict words is a READER, not a producer — exempt by class
 *
 *   node tools/verdict-adoption.mjs --check          # the gate (npm run check step; exit 1 on any red)
 *   node tools/verdict-adoption.mjs --triage         # first-pass suggestions for UNBINNED files; writes nothing
 *   node tools/verdict-adoption.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools', 'verdict-adoption.json');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

export const WORDS = /\b(PASS|FAIL|VERDICT|UNDERPOWERED|SHORTFALL|CONSISTENT|INCONCLUSIVE)\b/;
export const BINS = ['decides', 'already-json', 'word-only', 'test'];
export const STATUSES = ['pending', 'adopted', 'exempt'];

/* The population, computed: every tracked file in the two lanes that prints a verdict word. `git grep`
   on the INDEX/tree so a stale checkout of a file cannot hide or invent a producer. */
export function enumerate(root) {
  let out;
  try {
    out = execFileSync('git', ['grep', '-lE', WORDS.source, '--', 'tools/*.mjs', 'capture-host/*.py'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.startsWith('tools/') || !p.slice(6).includes('/')) // tools/*.mjs non-recursive, like the two tool gates
    .sort();
}

/* Pure: judge a manifest against an enumerated population. Returns { ok, errors[], counts }. */
export function check(enumerated, manifest, validator, runner) {
  const errors = [];
  const rows = (manifest && manifest.producers) || {};
  const named = Object.keys(rows).sort();
  const enumSet = new Set(enumerated);
  const namedSet = new Set(named);
  for (const p of enumerated) if (!namedSet.has(p)) errors.push(`UNBINNED producer: ${p} prints a verdict word and is in no bin — add it to tools/verdict-adoption.json`);
  for (const p of named) if (!enumSet.has(p)) errors.push(`STALE row: ${p} is in the manifest but no longer prints a verdict word (or is untracked) — remove or re-bin it`);
  const counts = { enumerated: enumerated.length, named: named.length, decides: 0, 'already-json': 0, 'word-only': 0, test: 0, adopted: 0, pending: 0, validated: 0 };
  for (const p of named) {
    const r = rows[p] || {};
    if (!BINS.includes(r.bin)) {
      errors.push(`${p}: bin must be one of ${BINS.join('|')}, got ${JSON.stringify(r.bin)}`);
      continue;
    }
    counts[r.bin]++;
    if (r.bin === 'word-only' || r.bin === 'test') {
      if (r.bin === 'word-only' && !(typeof r.reason === 'string' && r.reason.trim())) errors.push(`${p}: word-only without a reason — an exemption without a reason is a silent adoption gap`);
      if (r.status && r.status !== 'exempt') errors.push(`${p}: ${r.bin} rows are status "exempt", got ${JSON.stringify(r.status)}`);
      continue;
    }
    if (!['pending', 'adopted'].includes(r.status)) {
      errors.push(`${p}: ${r.bin} rows carry status pending|adopted, got ${JSON.stringify(r.status)}`);
      continue;
    }
    counts[r.status]++;
    if (r.status === 'adopted') {
      if (!r.emits || (!Array.isArray(r.emits.cmd) && typeof r.emits.file !== 'string')) {
        errors.push(`${p}: adopted without \`emits\` ({cmd:[…]} printing the object, or {file}) — an adoption the gate cannot read is a claim`);
        continue;
      }
      if (!validator || !runner) continue; // the pure core; the CLI passes both
      let obj;
      try {
        obj = runner(r.emits);
      } catch (e) {
        errors.push(`${p}: emits could not be read — ${String(e.message || e).slice(0, 120)}`);
        continue;
      }
      const v = validator(obj);
      counts.validated++;
      if (!v.ok) errors.push(`${p}: the emitted object is NOT a valid tepna.verdict/1 — ${v.errors.slice(0, 3).join(' | ')}`);
    }
  }
  return { ok: errors.length === 0, errors, counts };
}

/* Read what an adopted producer emits: run its cmd (stdout must be the object, or an object with the
   verdict at the top level) or read its file. */
function runEmits(emits, root) {
  let text;
  if (Array.isArray(emits.cmd)) {
    const r = spawnSync(emits.cmd[0], emits.cmd.slice(1), { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
    if (r.error) throw r.error;
    text = r.stdout;
  } else text = fs.readFileSync(path.join(root, emits.file), 'utf8');
  const first = text.indexOf('{');
  return JSON.parse(text.slice(first));
}

/* First-pass triage: for each unbinned file, where the words occur (code vs comment lines) and a sample,
   so the human bins with evidence rather than memory. Writes nothing. */
export function triage(root, files) {
  const out = [];
  for (const p of files) {
    const src = fs.readFileSync(path.join(root, p), 'utf8').split('\n');
    let code = 0;
    let comment = 0;
    const samples = [];
    src.forEach((line, i) => {
      if (!WORDS.test(line)) return;
      const s = line.trim();
      const isComment = p.endsWith('.py') ? s.startsWith('#') : s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
      if (isComment) comment++;
      else {
        code++;
        if (samples.length < 3) samples.push(`${i + 1}: ${s.slice(0, 110)}`);
      }
    });
    const json = /--json/.test(src.join('\n'));
    const suggest = p.includes('/tests/') || /\/test_[^/]+\.py$/.test(p) ? 'test' : code === 0 ? 'word-only (comments only)' : json ? 'already-json' : 'decides?';
    out.push({ path: p, code, comment, json, suggest, samples });
  }
  return out;
}

function selftest() {
  const fails = [];
  const ok = (c, m) => (c ? null : fails.push(m));
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const good = V.make({
    gate: 'g',
    status: 'PASS',
    population: { checked: 1, eligible: 1, excluded: 0 },
    criterion: { name: 'x', threshold: 1, unit: '', direction: 'lte' },
    result: { x: 0 },
    evidence: ['a'],
    producedBy: { tool: 't', commit: 'abcdef1' }
  });
  const runner = (e) =>
    e.file === 'good.json'
      ? good
      : e.file === 'bad.json'
        ? { schema: 'tepna.verdict/1', status: 'PASSED' }
        : (() => {
            throw new Error('unreadable');
          })();
  const M = (producers) => ({ schema: 'tepna.verdict-adoption/1', producers });
  // equality both ways
  let r = check(['tools/a.mjs', 'tools/b.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /UNBINNED producer: tools\/b.mjs/.test(e)), 'an enumerated producer missing from the manifest is a red WITH ITS NAME');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', reason: 'label', status: 'exempt' }, 'tools/gone.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(!r.ok && r.errors.some((e) => /STALE row: tools\/gone.mjs/.test(e)), 'a manifest row for a non-producer is a red with its name');
  // exemptions need reasons
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'word-only', status: 'exempt' } }), V.validate, runner);
  ok(!r.ok && /without a reason/.test(r.errors[0]), 'word-only without a reason is a red');
  ok(check(['capture-host/tests/test_x.py'], M({ 'capture-host/tests/test_x.py': { bin: 'test', status: 'exempt' } }), V.validate, runner).ok, 'a test file is exempt by class, no reason needed');
  // adoption is READ, never believed
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted' } }), V.validate, runner);
  ok(!r.ok && /adopted without `emits`/.test(r.errors[0]), 'adopted without emits is a claim, red');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'good.json' } } }), V.validate, runner);
  ok(r.ok && r.counts.validated === 1 && r.counts.adopted === 1, 'adopted + a valid emitted object → green, counted as validated');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'bad.json' } } }), V.validate, runner);
  ok(!r.ok && /NOT a valid tepna.verdict\/1/.test(r.errors[0]) && /no eighth value/.test(r.errors[0]), 'adopted but the object is invalid → red naming the validator error');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'adopted', emits: { file: 'missing.json' } } }), V.validate, runner);
  ok(!r.ok && /could not be read/.test(r.errors[0]), 'adopted but unreadable → red, not silently green');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'decides', status: 'pending' } }), V.validate, runner);
  ok(r.ok && r.counts.pending === 1 && r.counts.validated === 0, 'pending is honest and green — the count says how many are still owed');
  r = check(['tools/a.mjs'], M({ 'tools/a.mjs': { bin: 'maybe' } }), V.validate, runner);
  ok(!r.ok && /bin must be one of/.test(r.errors[0]), 'an unknown bin is a red');
  ok(
    check([], M({}), V.validate, runner).ok && check([], M({}), V.validate, runner).counts.enumerated === 0,
    'an empty population against an empty manifest is trivially equal (and says enumerated 0)'
  );
  // triage helper on a synthetic file
  const tmp = fs.mkdtempSync('/tmp/verdict-adoption-');
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.writeFileSync(path.join(tmp, 'tools', 'x.mjs'), "// prints PASS in a comment\nconsole.log('VERDICT: PASS');\nconst j = argv.includes('--json');\n");
  fs.writeFileSync(path.join(tmp, 'tools', 'y.mjs'), '// only a comment says FAIL\n');
  const t = triage(tmp, ['tools/x.mjs', 'tools/y.mjs']);
  ok(t[0].code === 1 && t[0].comment === 1 && t[0].json && t[0].suggest === 'already-json' && t[1].suggest.startsWith('word-only'), 'triage separates code hits from comment hits and reads --json');
  fs.rmSync(tmp, { recursive: true, force: true });
  // the real tree: the enumeration runs and is non-empty
  const en = enumerate(ROOT);
  ok(en.length > 50 && en.every((p) => p.startsWith('tools/') || p.startsWith('capture-host/')), 'enumerate() finds the population on the real tree (' + en.length + ')');
  const N = 13;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${N}`);
    process.exit(1);
  }
  console.log(`all ${N} selftests passed`);
}

function main() {
  if (has('--selftest')) return selftest();
  const en = enumerate(ROOT);
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { schema: 'tepna.verdict-adoption/1', producers: {} };
  if (has('--triage')) {
    const unbinned = en.filter((p) => !manifest.producers[p]);
    for (const t of triage(ROOT, unbinned)) console.log(`${t.path}  code:${t.code} comment:${t.comment} json:${t.json}  → ${t.suggest}\n${t.samples.map((s) => '      ' + s).join('\n')}`);
    console.log(`\n${unbinned.length} unbinned of ${en.length} enumerated`);
    return;
  }
  const V = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const r = check(en, manifest, V.validate, (e) => runEmits(e, ROOT));
  const c = r.counts;
  console.log(
    `verdict-adoption: ${c.enumerated} producer(s) enumerated · ${c.named} binned — decides ${c.decides} · already-json ${c['already-json']} · word-only ${c['word-only']} · test ${c.test} · adopted ${c.adopted} (validated ${c.validated}) · pending ${c.pending}`
  );
  if (!r.ok) {
    console.log(r.errors.map((e) => '  ✗ ' + e).join('\n'));
    console.log(`\n✗ ${r.errors.length} red(s) — the population and the manifest are not equal, or an adoption does not hold`);
    process.exit(1);
  }
  console.log('✓ the manifest partitions the enumerated population; every adoption read and valid');
}
main();
