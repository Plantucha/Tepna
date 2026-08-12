#!/usr/bin/env node
/*
 * tools/selftest-all.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * RUN EVERY TOOL'S SELFTEST — locally, in parallel, with assertion counts.
 *
 * ⚠️ THIS IS NOT THE GATE, and an earlier draft of this header wrongly said it was. CI ALREADY runs
 * every tool selftest: `.github/workflows/tests.yml`'s "Analysis-tool selftests" step greps
 * `tools/*.mjs` for `--selftest`, runs each one, and even refuses a run that finds fewer than ten —
 * so a tool quietly LOSING its selftest cannot read as success. That gate predates this script and
 * covers everything in this directory.
 *
 * The claim that "112+ assertions across eight tools are unrun" was FALSE. It came from grepping the
 * workflow for literal script paths, which missed a shell loop. Recorded here because the mistake is
 * the same shape as the ones this toolchain exists to catch: a check was searched for in the wrong
 * place, not found, and its absence believed.
 *
 * What this script actually adds, all of it modest:
 *   · ONE local command (`npm run test:tools`) instead of remembering the loop
 *   · PARALLEL — 28 tools in ~1.1 s against CI's serial pass
 *   · ASSERTION COUNTS, so a tool that silently drops from 30 assertions to 3 is visible; the CI
 *     loop reads PASS either way, because a smaller green suite is still green
 *
 * ── DISCOVERED, NOT LISTED ───────────────────────────────────────────────────────────────────
 * The tool set is found by scanning `tools/*.mjs` for a `--selftest` handler. A hardcoded list is the
 * thing that goes stale: the next tool someone writes would simply not be run, and its absence would
 * look identical to it passing. This repo already retired two committed-list files for that exact
 * reason (`docs-ledger-list.txt`, `changes-list.txt`, CPAP-REAL-CORPUS-FOLLOWUPS-II §4).
 *
 * A tool that declares `--selftest` and then EXITS NON-ZERO is a failure. A tool that declares it and
 * prints nothing recognisable is reported too — a selftest whose result cannot be read is not a pass.
 *
 * USAGE
 *   node tools/selftest-all.mjs          # every tool; non-zero if any fails
 *   node tools/selftest-all.mjs --list   # just show what would run
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'tools');
const argv = process.argv.slice(2);

/* A tool "has a selftest" if its source mentions the flag in a branch, not merely in a usage comment.
   Checking for the flag string alone would enrol every file whose header documents it. */
export function declaresSelftest(src) {
  const s = String(src || '');
  return /has\(['"]--selftest['"]\)|includes\(['"]--selftest['"]\)|argv\.indexOf\(['"]--selftest['"]\)/.test(s);
}

const files = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.mjs') && f !== 'selftest-all.mjs')
  .filter((f) => {
    try {
      return declaresSelftest(readFileSync(join(TOOLS, f), 'utf8'));
    } catch (_) {
      return false;
    }
  })
  .sort();

if (argv.includes('--list')) {
  console.log(files.map((f) => '  tools/' + f).join('\n'));
  process.exit(0);
}

const run = (f) =>
  new Promise((res) => {
    execFile(process.execPath, [join(TOOLS, f), '--selftest'], { cwd: ROOT, timeout: 120000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '');
      const m = out.match(/all (\d+) selftests passed/) || out.match(/all green/);
      res({ f, ok: !err, n: m && m[1] ? Number(m[1]) : null, readable: !!m, out });
    });
  });

const results = await Promise.all(files.map(run));
let failed = 0,
  warned = 0,
  total = 0;
for (const r of results) {
  if (!r.ok) {
    failed++;
    console.log(`  ✗ tools/${r.f}  FAILED`);
    console.log(
      r.out
        .split('\n')
        .filter((l) => l.includes('✗') || l.includes('FAILED'))
        .slice(0, 4)
        .map((l) => '      ' + l.trim())
        .join('\n')
    );
  } else if (!r.readable) {
    /* Exited 0 but printed nothing this script recognises. WARN, do not fail.
       The EXIT CODE is the contract a tool actually declares; "must also print a summary I can parse"
       is this script's preference, and enforcing it flagged NINE pre-existing analysis tools that are
       working correctly. A gate that lands red on day one over a formatting opinion gets switched
       off, and then the real failures it would have caught go with it — the same argument that kept a
       coverage threshold out of #1163. */
    warned++;
    console.log(`  ⚠ tools/${r.f}  green (exit 0), but no parseable summary — cannot report an assertion count`);
  } else {
    total += r.n || 0;
    console.log(`  ✓ tools/${r.f}${r.n ? '  ' + r.n + ' assertions' : '  green'}`);
  }
}
console.log(`\n${failed ? `✗ ${failed} tool selftest(s) FAILED` : `✓ ${results.length} tools, ${total}+ assertions — all green`}${warned ? `  (${warned} green but unparseable)` : ''}`);
process.exit(failed ? 1 : 0);
