#!/usr/bin/env node
/*
 * tools/reanchor-equivalence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE CLASSIFICATION DECAYS BECAUSE ITS KEY CONTAINS A LINE NUMBER.
 *
 * `tools/mutate-equivalence.json` is keyed on `(line, op, before)`. `op` and `before` describe the
 * CODE; `line` describes where it happened to sit. So any edit ABOVE a recorded mutant orphans it,
 * even when the mutated line is untouched — and `mutate.mjs` then excludes it from every count as a
 * stale entry, which is right, but means the classification quietly shrinks toward nothing.
 *
 * MEASURED, and fast: #1127 changed `pulsedex-dsp.js` within hours of 19 entries landing.
 * TEN of the nineteen orphaned — and every one of the ten had an IDENTICAL `(op, before)` still
 * present in the file, at a new line. Nothing about the code had changed at all. Left alone, the
 * ledger would have lost half a file's work to a formatting-adjacent commit.
 *
 * ── WHY RE-ANCHORING IS SAFE HERE, AND EXACTLY WHEN IT IS NOT ────────────────────────────────
 * The repo has already been bitten by the general version of this. `MUTATION-AUDIT-RUNBOOK` records
 * a non-unique anchor silently relocating a mutation: `str.replace(old, new, 1)` on text occurring
 * twice mutated the WRONG function, and three mutants read as survived while the control scored a
 * function the tests never claimed to cover.
 *
 * So the ONLY re-anchor this tool performs is the unambiguous one:
 *
 *     re-anchor  ⇔  exactly ONE generated mutant in the file has the same (op, before)
 *
 * More than one match ⇒ AMBIGUOUS, left orphaned. Zero matches ⇒ the code really did change, left
 * orphaned. Neither is guessed at, because a wrong re-anchor is worse than a lost entry: it would
 * silently excuse a mutant nobody probed, which is the one failure `mutate-equivalence.json` exists
 * to make impossible.
 *
 * ⚠️ RE-ANCHORING IS NOT RE-VERIFICATION. It asserts only that the identical mutation still exists
 * somewhere in the file. If the surrounding logic changed, a `no-distinguishing-input` verdict may
 * now be wrong — and the honest guard against that is already in place: `mutate.mjs` reports REFUTED
 * the moment a mutant an entry excuses turns up KILLED. This tool moves an entry's address; it never
 * renews its claim.
 *
 * USAGE
 *   node tools/reanchor-equivalence.mjs                    # report only, writes nothing
 *   node tools/reanchor-equivalence.mjs --write
 *   node tools/reanchor-equivalence.mjs --file pulsedex-dsp.js
 *   node tools/reanchor-equivalence.mjs --selftest         # known-answer, no enumeration
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

const norm = (s) => String(s == null ? '' : s).trim();
export const codeKey = (e) => norm(e.op) + '\0' + norm(e.before);

/* The whole decision, as a pure function so it can be known-answer tested without a sweep.
   Returns one of: {action:'ok'} · {action:'reanchor', line} · {action:'ambiguous', n} ·
   {action:'gone'}. */
export function planEntry(entry, generated) {
  const k = codeKey(entry);
  const exact = generated.find((m) => m.line === entry.line && codeKey(m) === k);
  if (exact) return { action: 'ok' };
  const same = generated.filter((m) => codeKey(m) === k);
  if (same.length === 1) return { action: 'reanchor', line: same[0].line };
  if (same.length > 1) return { action: 'ambiguous', n: same.length };
  return { action: 'gone' };
}

export function planFile(entries, generated) {
  const plan = { ok: [], reanchor: [], ambiguous: [], gone: [] };
  for (const e of entries) {
    const r = planEntry(e, generated);
    plan[r.action].push(Object.assign({ entry: e }, r));
  }
  return plan;
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  const G = (line, op, before) => ({ line, op, before });
  const gen = [G(10, 'cmp > → >=', 'if (a > b) {'), G(20, 'num → 0', 'x = 5;'), G(30, 'num → 0', 'x = 5;')];

  ok('an entry still at its recorded line is left alone', planEntry(G(10, 'cmp > → >=', 'if (a > b) {'), gen).action === 'ok');
  const r = planEntry(G(99, 'cmp > → >=', 'if (a > b) {'), gen);
  ok('a MOVED entry with a unique (op, before) is re-anchored', r.action === 'reanchor' && r.line === 10, JSON.stringify(r));
  ok('…and an AMBIGUOUS one is refused, not guessed', planEntry(G(99, 'num → 0', 'x = 5;'), gen).action === 'ambiguous');
  ok('…and a vanished one is reported gone', planEntry(G(99, 'cmp < → <=', 'if (q < r) {'), gen).action === 'gone');
  ok('whitespace in `before` does not orphan an entry', planEntry(G(99, 'cmp > → >=', '   if (a > b) {  '), gen).action === 'reanchor');
  ok('the OP is part of the identity — same text, different op, is not a match', planEntry(G(99, 'bool && → ||', 'if (a > b) {'), gen).action === 'gone');
  /* The load-bearing property: an entry whose line still holds the SAME code is never moved, even
     when that code also occurs elsewhere — otherwise a duplicate line could drag a valid entry. */
  ok('an exact line+code match wins over a duplicate elsewhere', planEntry(G(20, 'num → 0', 'x = 5;'), gen).action === 'ok');

  const plan = planFile([G(10, 'cmp > → >=', 'if (a > b) {'), G(99, 'cmp > → >=', 'if (a > b) {'), G(99, 'num → 0', 'x = 5;'), G(1, 'zzz', 'nope')], gen);
  ok(
    'planFile buckets all four outcomes',
    plan.ok.length === 1 && plan.reanchor.length === 1 && plan.ambiguous.length === 1 && plan.gone.length === 1,
    JSON.stringify(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])))
  );

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const LEDGER = join(ROOT, 'tools/mutate-equivalence.json');
  const doc = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const only = opt('--file', '');
  const files = Object.keys(doc).filter((k) => !k.startsWith('_') && (!only || k === only));
  if (!files.length) {
    console.error('nothing to re-anchor' + (only ? ` — ${only} has no entries` : ''));
    process.exit(2);
  }

  let moved = 0,
    stuck = 0,
    fine = 0;
  for (const file of files) {
    /* Enumerate through a FILE, never a pipe: a big file's mutant list truncates at ~146 KB through
       a child's stdout, and a truncated enumeration would report live entries as `gone`. */
    const tmp = join(tmpdir(), `reanchor-${process.pid}.json`);
    const fd = openSync(tmp, 'w');
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/mutate.mjs'), '--file', file, '--dry-run', '--limit', '100000', '--json'], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    } catch (_) {
      closeSync(fd);
      console.error(`  ✗ ${file}: could not enumerate mutants — skipped`);
      continue;
    }
    closeSync(fd);
    const generated = JSON.parse(readFileSync(tmp, 'utf8')).files[0].mutants;
    unlinkSync(tmp);

    const plan = planFile(doc[file], generated);
    fine += plan.ok.length;
    moved += plan.reanchor.length;
    stuck += plan.ambiguous.length + plan.gone.length;
    console.log(`▸ ${file}  ${doc[file].length} entr(ies) · ${plan.ok.length} anchored · ${plan.reanchor.length} movable · ${plan.ambiguous.length} ambiguous · ${plan.gone.length} gone`);
    for (const r of plan.reanchor) console.log(`    → L${r.entry.line} becomes L${r.line}  [${r.entry.op}] ${norm(r.entry.before).slice(0, 52)}`);
    for (const r of plan.ambiguous) console.log(`    ⚠ AMBIGUOUS (${r.n} matches) L${r.entry.line} [${r.entry.op}] — left orphaned deliberately`);
    for (const r of plan.gone) console.log(`    ⊘ GONE L${r.entry.line} [${r.entry.op}] ${norm(r.entry.before).slice(0, 52)}`);
    if (has('--write')) for (const r of plan.reanchor) r.entry.line = r.line;
  }

  if (has('--write') && moved) {
    writeFileSync(LEDGER, JSON.stringify(doc, null, 2) + '\n');
    console.log(`\n✓ re-anchored ${moved} entr(ies). Anchors moved; CLAIMS UNCHANGED — a re-anchor is not a re-verification.`);
  } else if (moved) {
    console.log(`\n${moved} entr(ies) can be re-anchored. Re-run with --write.`);
  } else {
    console.log(`\nnothing to move — ${fine} anchored, ${stuck} left orphaned.`);
  }
}
