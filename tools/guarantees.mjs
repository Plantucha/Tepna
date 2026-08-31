#!/usr/bin/env node
/*
 * tools/guarantees.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * GUARANTEE CENSUS — find the promises the comments make, and ask which of them nothing checks.
 *
 * This repo writes its invariants into prose: "never fabricate on miss", "the bound is a REFUSAL,
 * not a clamp", "a refusal is a RESULT". Those sentences are load-bearing — they are what a reader
 * relies on and what a reviewer checks a change against — and nothing has ever enumerated them.
 *
 * `CPAP-AUTOHARVEST-FOLLOWUPS` ran this by hand over `capture-host/*.py` and turned "grep the daemon"
 * into 124 named sites. `CPAP-AUTOHARVEST-FOLLOWUPS-II` §3 records which half of that method is worth
 * keeping, and this tool is that half.
 *
 * ── THE HALF THAT IS **NOT** REUSED, deliberately ────────────────────────────────────────────────
 * The Python sweep then cross-referenced each guarantee's NAME against the test tree. It reported the
 * daemon 121/124 clean and was blind to both real gaps, because *named in a test* and *gated by a
 * test* are different properties — and in the other direction it would have condemned five guarantees
 * that are gated perfectly well TRANSITIVELY, through helpers that never mention them. A name match is
 * evidence of neither.
 *
 * So this tool does not grep the tests. It cross-references against SURVIVING MUTANTS, which is the
 * only signal that answers the question directly: a survivor is a line the suite cannot see change.
 * A surviving mutant sitting under a documented promise is a promise nothing checks — and that is a
 * far sharper prioritiser than raw survival count, because it separates "untested line" from
 * "untested line we have told the reader is guaranteed".
 *
 * USAGE
 *   node tools/guarantees.mjs --file clock.js [--file X …]     # census one or more files
 *   node tools/guarantees.mjs --spine                          # the JS spine (clock + DSPs)
 *   node tools/guarantees.mjs --spine --json                   # machine-readable
 *   node tools/guarantees.mjs --file clock.js --survivors s.json
 *        # cross-reference an NDJSON/JSON emitted by `mutate.mjs --json`; reports which surviving
 *        # mutants fall inside a guarantee's comment block, i.e. the UNGATED PROMISES.
 *
 * SCOPE: comments only, and only real ones — the mask comes from `js-lex.mjs`, the ONE regex-aware lexer, so
 * a `/…/` containing quotes cannot desynchronise it and a keyword inside a string literal is not a
 * guarantee. JS only; the Python side was already swept by hand.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codeMask } from './js-lex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const optAll = (f) => argv.reduce((a, v, i) => (argv[i - 1] === f ? a.concat(v) : a), []);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = has('--json');

/* The vocabulary, taken verbatim from the Python sweep so the two censuses are comparable. These are
   the words this codebase uses when it is making a promise rather than describing mechanics. */
const GUARANTEE_RE = /\b(never|always|must not|must never|must|cannot|guarantees?|refuses?|refusal|invariant|is an ALERT|not a silent)\b/i;

/* The JS spine: the modules whose comments carry contracts other modules inherit. */
const SPINE = [
  'clock.js',
  'integrator-dsp.js',
  'oxydex-dsp.js',
  'ecgdex-dsp.js',
  'ppgdex-dsp.js',
  'pulsedex-dsp.js',
  'hrvdex-dsp.js',
  'glucodex-dsp.js',
  'cpapdex-dsp.js',
  'motiondex-dsp.js',
  'dex-export.js',
  'metric-registry.js'
];

/* Comment RUNS, not lines. A guarantee is usually a sentence spread over a wrapped block comment, so
   the unit that matters is the contiguous commented region: it gives the promise a line RANGE, which
   is what a mutant line can then be tested against. */
function commentRuns(src) {
  const mask = codeMask(src); // 1 = code, 0 = comment/string
  const runs = [];
  let start = -1;
  // Line index for every offset, computed once.
  const lineOf = new Int32Array(src.length);
  let ln = 1;
  for (let i = 0; i < src.length; i++) {
    lineOf[i] = ln;
    if (src.charCodeAt(i) === 10) ln++;
  }
  for (let i = 0; i < src.length; i++) {
    const isComment = mask[i] === 0;
    if (isComment && start < 0) start = i;
    else if (!isComment && start >= 0) {
      runs.push({ a: start, b: i, from: lineOf[start], to: lineOf[i - 1] });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ a: start, b: src.length, from: lineOf[start], to: lineOf[src.length - 1] });
  return runs.map((r) => ({ ...r, text: src.slice(r.a, r.b) }));
}

/* A run counts once even if it makes several promises — the unit is the promise SITE. The quoted
   sentence is the first matching one, so a reader can judge it without opening the file. */
function guaranteesIn(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return null;
  const src = readFileSync(p, 'utf8');
  const out = [];
  for (const run of commentRuns(src)) {
    // Strings are masked too; only keep runs that actually look like comments.
    if (!/^\s*(\/\/|\/\*|\*)/.test(run.text)) continue;
    const flat = run.text
      .replace(/^[\s*/]+|[\s*/]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!GUARANTEE_RE.test(flat)) continue;
    const sentence = (flat.split(/(?<=[.!?])\s+/).find((s) => GUARANTEE_RE.test(s)) || flat).slice(0, 160);
    out.push({ file, from: run.from, to: run.to, sentence });
  }
  return out;
}

/* Survivors from `mutate.mjs --json` (NDJSON, one object per file). A survivor is attributed to a
   guarantee when its line falls inside the comment run OR within `NEAR` lines after it — a promise
   documents the code that FOLLOWS it, and that code is where the mutant lands. */
const NEAR = 25;
function loadSurvivors(path) {
  const raw = readFileSync(path, 'utf8').trim();
  const byFile = new Map();
  /* 🔴 WHOLE-FILE JSON FIRST, THEN NDJSON — and REFUSE on an empty result.
     This read NDJSON only: split on newlines, `JSON.parse` each, `catch { continue }`. Handed a
     pretty-printed `.sweep.json` — which is what `tools/mutation-crawl.mjs` writes to
     `.mutation-crawl/<file>.sweep.json`, i.e. the survivor data this repo actually has on disk —
     EVERY line throws, every throw is swallowed, and the map comes back EMPTY. The caller then does
     `survivors.get(f) || []`, finds no hits, and prints "0 with a SURVIVING mutant".
     A total parse failure, rendered as a clean all-clear, by the tool whose entire job is finding
     promises that nothing checks. Measured on cpapdex-dsp.js: reported 0, actual 3 — three guards
     whose trailing comments say "never fabricate", "never a raw", "never guessed into a night",
     each carrying an unkilled mutant on the guard line itself. */
  const whole = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  const records = whole ? (Array.isArray(whole) ? whole : [whole]) : [];
  for (const d of records) {
    if (d && d.file && Array.isArray(d.survivors)) byFile.set(d.file, d.survivors);
  }
  if (!byFile.size) {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d && d.file && Array.isArray(d.survivors)) byFile.set(d.file, d.survivors);
    }
  }
  /* An empty map is never a legitimate answer here. The caller cannot tell "this file has no
     survivors" from "nothing parsed", and only one of those is a result — `empty-result-is-not-a-
     negative`, applied to the input rather than the output. Refuse rather than report a clean sweep
     over nothing. */
  if (!byFile.size) {
    console.error(
      '  ⚠ REFUSING: --survivors parsed 0 records from ' +
        path +
        '\n' +
        '    Neither whole-file JSON nor NDJSON yielded an object with { file, survivors[] }.\n' +
        '    Reporting "0 ungated" from this would be a clean all-clear over data that never loaded.'
    );
    process.exit(2);
  }
  return byFile;
}

const files = optAll('--file').concat(has('--spine') ? SPINE : []);
if (!files.length) {
  console.error('nothing to census — pass --file <path> or --spine');
  process.exit(2);
}
const survPath = opt('--survivors', null);
const survivors = survPath && existsSync(survPath) ? loadSurvivors(survPath) : null;

const report = [];
for (const f of files) {
  const g = guaranteesIn(f);
  if (g == null) {
    if (!AS_JSON) console.error('  ⚠ not found: ' + f);
    continue;
  }
  const surv = survivors ? survivors.get(f) || [] : null;
  const rows = g.map((site) => {
    const hits = surv ? surv.filter((s) => s.line >= site.from && s.line <= site.to + NEAR) : null;
    return { ...site, ungated: hits ? hits.length : null, mutants: hits ? hits.map((h) => h.line + ' ' + h.op) : null };
  });
  report.push({ file: f, guarantees: g.length, ungated: surv ? rows.filter((r) => r.ungated > 0).length : null, sites: rows });
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  let total = 0,
    totalUngated = 0;
  for (const r of report) {
    total += r.guarantees;
    if (r.ungated != null) totalUngated += r.ungated;
    console.log('\n' + r.file + '  —  ' + r.guarantees + ' guarantee site(s)' + (r.ungated != null ? ', ' + r.ungated + ' with a SURVIVING mutant' : ''));
    for (const s of r.sites) {
      if (survivors && !s.ungated) continue; // with survivor data, show only the ungated ones
      console.log('  L' + s.from + '-' + s.to + (s.ungated ? '  ⚠ ' + s.ungated + ' survivor(s): ' + s.mutants.join(' · ') : ''));
      console.log('      ' + s.sentence);
    }
  }
  console.log('\n── ' + report.length + ' file(s), ' + total + ' guarantee site(s)' + (survivors ? ', ' + totalUngated + ' carrying a surviving mutant' : '') + ' ──');
  if (survivors) console.log('   A survivor under a documented promise is a promise nothing checks.');
}
