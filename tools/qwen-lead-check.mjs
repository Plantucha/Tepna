#!/usr/bin/env node
/*
 * tools/qwen-lead-check.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE MECHANICAL CHECK ON A LOCAL-MODEL LEAD (briefs/LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md §3.3).
 *
 * A lead is one JSON line written by `tools/compute-feeder.mjs qwen`:
 *   { lens, ref, file, line, quote, claim, check }
 * This tool spends no model tokens. It drops a lead when any rule fails and counts each drop by reason:
 *   1. `ref-or-file`    the ref does not resolve, or the file is absent at that ref
 *   2. `quote-mismatch` the quote is not at `line` (±3) of the file at that ref — a fabricated line number
 *   3. `stale`          no line of the CURRENT origin/main file equals the quote AND matches the lens grep
 *   4. `residue`        a RESIDUE row at origin/main already names `file:line`
 *   5. `comment`        the quoted line is a comment (`//`, `/*`, `*`, `#`), so no value flows through it
 *   6. `guarded`        an absence lead whose quoted line already tests `!= null`, `isFinite(` or `is not None`
 *   7. `judged`         Shrike's verify tables in the outbox already hold a verdict on this file and quote
 * Rules 5 to 7 came from a replay over the 293 leads Shrike judged 2026-11-22 to 2026-11-26 (Crane): they
 * drop 147 of them, and no dropped lead was a confirmed defect that was not already judged. The one guarded
 * lead Shrike confirmed was a badge lead, so rule 6 binds the absence lens only.
 * A lead that survives is a LEAD, never a finding. A bird re-reads the site and reproduces the defect
 * (brief §3.4); nothing closes on this tool's word.
 *
 * It also owns the LENSES: each lens is a deterministic grep over a file set plus ONE question. The
 * feeder imports them from here so the grep that made a lead and the grep that re-checks it are one object.
 *
 *
 * WRITE-ROOT READING (briefs/WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md §3, both arms): `--out` writes the
 * path the caller names, never a tracked artifact. The judge reads git objects (the lead's ref and
 * origin/main) with `cwd: ROOT`; those objects are the same from every checkout of this repo.
 *
 * USAGE
 *   node tools/qwen-lead-check.mjs <leads.jsonl> [--out kept.jsonl]   # one tepna.verdict/1 object on stdout
 *   node tools/qwen-lead-check.mjs --selftest
 *   node tools/qwen-lead-check.mjs --verdict-sample
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'qwen-lead-check';
const OUTBOX = process.env.SHRIKE_OUTBOX || '/srv/shrike-outbox';
const COMMENT_RE = /^(?:\/\/|\/\*|\*|#)/;
const GUARD_RE = /!==?\s*null|\bisFinite\(|\bis not None\b/;
export const LINE_SLACK = 3;

/* Each lens: which tracked files it reads, the grep that lists candidate sites, and the one question
   the model answers per site. A lens without a grep is out of scope (brief §3.1). */
export const LENSES = {
  absence: {
    files: (p) => (/^[^/]+\.js$/.test(p) && !/\.min\.js$/.test(p)) || /^capture-host\/[^/]+\.py$/.test(p),
    re: /\?\?\s*0(?![.\d])|\|\|\s*0(?![.\d])|\.get\([^()]*,\s*0\)|\bor\s+0\b|\.fill\(0\)|new\s+(?:Float(?:32|64)|U?Int(?:8|16|32))Array\(/,
    rule: 'A value that was not measured is null, never 0, a default or an in-range sentinel. 0 is legal only when it is a real measurement or a true count (for example a sum accumulator, a loop index or a count of found items).',
    question: 'Does the zero on the marked line stand in for a value that was NOT measured?'
  },
  clock: {
    files: (p) => /^[^/]+\.js$/.test(p) && !/\.min\.js$/.test(p),
    re: /new\s+Date\(\s*[^)\s]|Date\.parse\(|\.toLocale(?:Date|Time)?String\((?![^)]*timeZone)|\.get(?:Hours|Minutes|Seconds|Date|Day|Month|FullYear)\(\)/,
    rule: 'Time is floating wall-clock ms (tMs = Date.UTC of the local civil components). Never parse a string with new Date(str) or Date.parse; vendor formats go through a regex. Display reads getUTC* only, and toLocale* needs { timeZone: "UTC" }. A Date built from a numeric tMs and read with getUTC* is correct.',
    question: 'Does the marked line read or parse a wall-clock time outside these rules?'
  },
  badge: {
    files: (p) => /^[^/]+-render\.js$/.test(p),
    re: /\.toFixed\(|\.toLocaleString\(|Math\.round\(/,
    rule: 'Every number the page shows carries an evidence badge from MetricRegistry.badge() (or a .ev / .ev-corner element) on the same card, chip, row or series. A number used only for layout, a CSS value or a computation that is never displayed needs no badge.',
    question: 'Is the number on the marked line shown to the user with no evidence badge beside it?'
  }
};

/* Pure: decide one lead. `src` supplies text; every git read is injected so the selftest needs no repo. */
export function checkLead(lead, src) {
  const lens = LENSES[lead.lens];
  if (!lens || typeof lead.file !== 'string' || !Number.isInteger(lead.line) || typeof lead.quote !== 'string') return 'malformed';
  const atRef = src.fileAt(lead.ref, lead.file);
  if (atRef == null) return 'ref-or-file';
  const q = lead.quote.trim();
  const lines = atRef.split('\n');
  let near = false;
  for (let i = Math.max(0, lead.line - 1 - LINE_SLACK); i <= Math.min(lines.length - 1, lead.line - 1 + LINE_SLACK); i++) {
    if (lines[i].trim() === q) near = true;
  }
  if (!near) return 'quote-mismatch';
  if (COMMENT_RE.test(q)) return 'comment';
  if (lead.lens === 'absence' && GUARD_RE.test(q)) return 'guarded';
  const cur = src.fileAt(src.mainRef, lead.file);
  if (cur == null || !cur.split('\n').some((l) => l.trim() === q && lens.re.test(l))) return 'stale';
  if (src.residue.includes(`${lead.file}:${lead.line}`)) return 'residue';
  if (src.judged?.has(`${lead.file}\t${q}`)) return 'judged';
  return null;
}

export function checkLeads(leads, src) {
  const kept = [];
  const dropped = {};
  for (const lead of leads) {
    const why = checkLead(lead, src);
    if (why)
      dropped[why] = (dropped[why] || 0) + 1; // absence-ok: a count of dropped leads; a reason not yet seen counts from 0
    else kept.push(lead);
  }
  return { kept, dropped };
}

export function verdictFor(label, leads, { kept, dropped }, commit = '') {
  const excluded = leads.length - kept.length;
  const empty = leads.length === 0;
  return Verdict.make({
    gate: GATE,
    status: empty ? 'NOT_RUN' : 'PASS',
    population: { checked: kept.length, eligible: leads.length, excluded },
    criterion: { name: 'quote_mismatch_leads_passed', threshold: 0, unit: 'leads', direction: 'lte' },
    result: empty ? null : { kept: kept.length, dropped },
    evidence: empty ? [] : [label, 'tools/qwen-lead-check.mjs'],
    reason: empty ? 'the leads file held no lead' : null,
    producedBy: /^[0-9a-f]{7,40}$/.test(commit)
      ? { tool: 'tools/qwen-lead-check.mjs', commit }
      : { tool: 'tools/qwen-lead-check.mjs', commit: null, commitReason: 'the tool did not run in a checkout' }
  });
}

function gitText(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/* Pure: the `file<TAB>quote` keys of every row in Shrike's verify tables, the shape
   `| 3 | \`oxydex-dsp.js:9071\` | **REJECTED** | \`piFrames: s.piFrames ?? null,\` |` (pipes escaped as \\|). */
export function judgedKeys(texts) {
  const keys = new Set();
  const row = /^\|\s*\d+\s*\|\s*`([^`]+?):\d+`\s*\|\s*\*\*(?:CONFIRMED|REJECTED)[^|]*\|\s*`(.+)`[^`]*\|\s*$/;
  for (const t of texts) {
    for (const l of t.split('\n')) {
      const m = row.exec(l);
      if (m) keys.add(`${m[1]}\t${m[2].replace(/\\\|/g, '|').trim()}`);
    }
  }
  return keys;
}

/* Shrike's verify tables, read from the outbox. An absent outbox gives an empty set: rule 7 then drops nothing. */
export function outboxTexts(dir = OUTBOX) {
  try {
    return readdirSync(dir)
      .filter((f) => /FEEDER-verify-leads-.*\.md$/.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8'));
  } catch {
    return [];
  }
}

export function repoSource() {
  const cache = new Map();
  const mainRef = (gitText(['rev-parse', 'origin/main']) || '').trim();
  return {
    mainRef,
    residue: gitText(['show', 'origin/main:briefs/RESIDUE.md']) || '',
    judged: judgedKeys(outboxTexts()),
    fileAt(ref, file) {
      if (!/^[0-9a-f]{7,40}$/.test(String(ref)) || /(^|\/)\.\.(\/|$)/.test(file)) return null;
      const k = `${ref}:${file}`;
      if (!cache.has(k)) cache.set(k, gitText(['show', k]));
      return cache.get(k);
    }
  };
}

export function readLeads(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
}

function selftest() {
  let ok = 0;
  let fail = 0;
  const ck = (name, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    pass ? ok++ : fail++;
    console.log(`  ${pass ? '✓' : '✕'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const OLD = ['a', 'b', 'const hr = row.hr ?? 0;', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'const spo2 = r.s || 0;'].join('\n'); // absence-ok: selftest fixture text, the lens bait
  const CUR = OLD.replace('const spo2 = r.s || 0;', 'const spo2 = r.s ?? null;'); // absence-ok: selftest fixture text, the lens bait
  const files = { 'aaaaaaa:x-dsp.js': OLD, 'bbbbbbb:x-dsp.js': CUR };
  const src = { mainRef: 'bbbbbbb', residue: '| k | 2026 | x | y-dsp.js:3 named |', fileAt: (r, f) => files[`${r}:${f}`] ?? null };
  const base = { lens: 'absence', ref: 'aaaaaaa', file: 'x-dsp.js', claim: 'c', check: 'k' };
  ck('a true lead survives', checkLead({ ...base, line: 3, quote: 'const hr = row.hr ?? 0;' }, src), null);
  ck('a line off by 2 still matches (slack 3)', checkLead({ ...base, line: 5, quote: 'const hr = row.hr ?? 0;' }, src), null);
  ck('a fabricated line number drops', checkLead({ ...base, line: 10, quote: 'const hr = row.hr ?? 0;' }, src), 'quote-mismatch');
  ck('a quote absent from the file drops', checkLead({ ...base, line: 3, quote: 'invented();' }, src), 'quote-mismatch');
  ck('a lead on code fixed since drops as stale', checkLead({ ...base, line: 13, quote: 'const spo2 = r.s || 0;' }, src), 'stale'); // absence-ok: selftest fixture text, the lens bait
  ck('an unknown ref drops', checkLead({ ...base, ref: 'ccccccc', line: 3, quote: 'const hr = row.hr ?? 0;' }, src), 'ref-or-file');
  ck('an unknown lens is malformed', checkLead({ ...base, lens: 'vibes', line: 3, quote: 'x' }, src), 'malformed');
  const src2 = { ...src, residue: '| k | x-dsp.js:3 logged |' };
  ck('a site a residue row names drops', checkLead({ ...base, line: 3, quote: 'const hr = row.hr ?? 0;' }, src2), 'residue');
  const leads = [
    { ...base, line: 3, quote: 'const hr = row.hr ?? 0;' },
    { ...base, line: 10, quote: 'const hr = row.hr ?? 0;' },
    { ...base, line: 13, quote: 'const spo2 = r.s || 0;' } // absence-ok: selftest fixture text, the lens bait
  ];
  const r = checkLeads(leads, src);
  ck('checkLeads keeps 1 and counts drops by reason', [r.kept.length, r.dropped], [1, { 'quote-mismatch': 1, stale: 1 }]);
  const v = verdictFor('leads.jsonl', leads, r);
  ck('verdict arithmetic checked + excluded = eligible', [v.population.checked + v.population.excluded, v.population.eligible], [3, 3]);
  ck('verdict validates', Verdict.validate(v).errors, []);
  ck('a verdict with a real sha validates', Verdict.validate(verdictFor('l', leads, r, 'abc1234')).errors, []);
  ck('an empty file is NOT_RUN with a reason', [verdictFor('e', [], { kept: [], dropped: {} }).status, !!verdictFor('e', [], { kept: [], dropped: {} }).reason], ['NOT_RUN', true]);
  const OLD3 = ['// x ?? 0 here', 'const a = v != null ? v : 0;', 'const t = (n ?? 0).toFixed(1);'].join('\n'); // absence-ok: selftest fixture text, the lens bait
  const files3 = { 'aaaaaaa:z-dsp.js': OLD3, 'bbbbbbb:z-dsp.js': OLD3 };
  const src3 = { mainRef: 'bbbbbbb', residue: '', judged: judgedKeys(['| 1 | `z-dsp.js:3` | **REJECTED** | `const t = (n ?? 0).toFixed(1);` |']), fileAt: (r, f) => files3[`${r}:${f}`] ?? null }; // absence-ok: selftest fixture text, the lens bait
  const b3 = { ...base, file: 'z-dsp.js' };
  ck('a comment line drops', checkLead({ ...b3, line: 1, quote: '// x ?? 0 here' }, src3), 'comment'); // absence-ok: selftest fixture text, the lens bait
  ck('an absence lead on a != null line drops as guarded', checkLead({ ...b3, line: 2, quote: 'const a = v != null ? v : 0;' }, src3), 'guarded'); // absence-ok: selftest fixture text, the lens bait
  ck('a badge lead on a guarded line is not dropped as guarded', checkLead({ ...b3, lens: 'badge', line: 2, quote: 'const a = v != null ? v : 0;' }, src3) !== 'guarded', true); // absence-ok: selftest fixture text, the lens bait
  ck('a site Shrike already judged drops', checkLead({ ...b3, line: 3, quote: 'const t = (n ?? 0).toFixed(1);' }, src3), 'judged'); // absence-ok: selftest fixture text, the lens bait
  ck('judgedKeys unescapes a table pipe', [...judgedKeys(['| 2 | `y.js:9` | **CONFIRMED (drafted)** | `a = b \\|\\| 0;` |'])], ['y.js\ta = b || 0;']); // absence-ok: selftest fixture text, the lens bait
  ck('judgedKeys skips a row with no verdict', judgedKeys(['| 2 | `y.js:9` | open | `a` |']).size, 0);
  ck('an absent outbox gives no text', outboxTexts('/nonexistent-outbox-dir'), []);
  ck('absence grep sees ?? 0 and not ?? 0.5', [LENSES.absence.re.test('x ?? 0;'), LENSES.absence.re.test('x ?? 0.5;')], [true, false]);
  ck('clock grep skips toLocaleString with timeZone', [LENSES.clock.re.test("d.toLocaleString('en', { timeZone: 'UTC' })"), LENSES.clock.re.test('d.toLocaleString()')], [false, true]);
  console.log(fail === 0 ? `all ${ok} selftests passed` : `${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const SPEC = { valued: ['--out'], boolean: ['--selftest', '--verdict-sample'], positional: true };

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, SPEC, { tool: GATE });
  if (argv.includes('--selftest')) selftest();
  else if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictFor('<sample>', [], { kept: [], dropped: {} }), null, 2));
  } else {
    const [path] = positionalArgs(argv, { valued: SPEC.valued });
    if (!path) {
      console.error('usage: node tools/qwen-lead-check.mjs <leads.jsonl> [--out kept.jsonl]');
      process.exit(2);
    }
    const leads = readLeads(path);
    const src = repoSource();
    const res = checkLeads(leads, src);
    const oi = argv.indexOf('--out');
    if (oi >= 0) writeFileSync(argv[oi + 1], res.kept.map((l) => JSON.stringify(l)).join('\n') + (res.kept.length ? '\n' : ''));
    const commit = (gitText(['rev-parse', '--short=9', 'HEAD']) || '').trim();
    console.log(JSON.stringify(verdictFor(path, leads, res, commit)));
  }
}
