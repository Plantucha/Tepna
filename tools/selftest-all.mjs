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
import os from 'node:os';
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

/* ✅ CLOSED 2026-08-18, RE-VERIFIED 2026-08-27 — the incident below is HISTORY, not an open hazard.
   The detector it describes is implemented, wired and exit-enforcing (`nearMiss` -> process.exit 1), and
   was demonstrated to fire on 2026-08-27 by planting a tool spelling the flag `--self-test`: it was
   named, reported unreachable, and the run exited 1.
   Stamped because the paragraph below reads in the present tense of an open problem, and twice caused
   remediation work to be assigned for something already fixed. A header that DOCUMENTS a failure is not
   evidence the failure is open — run the mechanism's own check before acting on the narrative. */

/* A tool that HAS a selftest under a name discovery does not recognise is invisible, and invisibility
   here is indistinguishable from passing. Measured 2026-08-18: three tools spelled the flag
   `--self-test` (hyphenated) and compared it with `===`; the CI loop greps for the literal
   `--selftest` and `declaresSelftest` matches only `has(…)`/`includes(…)`/`indexOf(…)`, so **44 tools
   ran and those three never did** — for two independent reasons at once. Neither the loop's
   "fewer than ten is a failure" floor nor this script's count could see it: the floor was met by the
   other 44, and a tool that is never run contributes no count to miss.
   So the near-miss is now REPORTED rather than skipped. This predicate deliberately looks for the
   selftest MACHINERY (an exported/decl `selfTest`, or the hyphenated flag) in a file that
   `declaresSelftest` rejected — presence of a test with no way to reach it. */
export function declaresNearMissSelftest(src) {
  const s = String(src || '');
  if (declaresSelftest(s)) return false;
  return /--self-test/.test(s) || /function\s+selfTest\b/.test(s);
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

/* This script is excluded from its own DISCOVERY list, which would leave its predicates ungated — the
   exact shape it exists to catch. `--selftest` therefore runs them; the CI loop finds this file by that
   same literal and runs it, so the detector is gated by the mechanism it guards. */
const TOOL_TIMEOUT_MS = 120000;

/* WHY a tool failed, not just THAT it did. `err` from execFile carries the only evidence that exists
   for a timeout (`killed`, SIGTERM) or a crash (a non-zero `code`, a stack on stderr), and it was
   discarded entirely — so every NON-assertion failure reported as a bare "FAILED" with a blank line
   under it. Ordered most-specific first: a killed process ALSO carries an exit code, so testing
   `killed` before `code` is load-bearing, and a selftest leg pins that order. */
export function whyFailed(err, timeoutMs) {
  if (!err) return null;
  if (err.killed || err.signal === 'SIGTERM') return `TIMED OUT after ${timeoutMs / 1000}s (killed, ${err.signal || 'no signal'})`;
  if (err.code != null) return `exited ${err.code}`;
  if (err.signal) return `killed by ${err.signal}`;
  return String(err.message || 'failed').split('\n')[0];
}

/* WHICH LINES to show. Assertion lines lead when the tool printed any; otherwise the TAIL of whatever
   it did say. An empty return means it said nothing at all — itself the tell for a timeout — and the
   caller prints that in words rather than as a blank line. */
export function failureLines(out) {
  const all = String(out || '').split('\n');
  const marked = all.filter((l) => l.includes('\u2717') || l.includes('FAILED'));
  if (marked.length) return marked.slice(0, 4);
  return all.filter((l) => l.trim()).slice(-6);
}

if (argv.includes('--selftest')) {
  let n = 0;
  const eq = (c, m) => {
    n++;
    if (!c) {
      console.error(`  \u2717 FAILED: ${m}`);
      process.exit(1);
    }
  };
  eq(declaresSelftest("if (argv.includes('--selftest')) {"), 'includes() form is recognised');
  eq(declaresSelftest("if (has('--selftest')) {"), 'has() form is recognised');
  eq(declaresSelftest("if (argv.indexOf('--selftest') >= 0) {"), 'indexOf() form is recognised');
  eq(!declaresSelftest(' * usage: node tools/x.mjs --selftest'), 'a usage COMMENT alone does not enrol a tool');
  eq(!declaresSelftest("if (process.argv[2] === '--self-test') {"), 'the hyphenated === form is NOT recognised (this is the bug)');
  eq(declaresNearMissSelftest("if (process.argv[2] === '--self-test') { selfTest(); }"), 'the hyphenated flag is reported as a near miss');
  eq(declaresNearMissSelftest('export function selfTest() { return 3; }'), 'selftest machinery with no reachable flag is a near miss');
  eq(!declaresNearMissSelftest("if (argv.includes('--selftest')) { selfTest(); }"), 'a correctly-enrolled tool is NOT a near miss');
  eq(!declaresNearMissSelftest('export function main() { return 0; }'), 'a tool with no selftest at all is not a near miss');
  /* THE FAILURE REPORT ITSELF (2026-09-02). This filtered a failing tool's output to lines containing
     the assertion marker or FAILED — the shape of an ASSERTION failure — and dropped `err`, so a
     timeout or a crash printed a bare "FAILED" and a BLANK line. Measured: two independent
     `dsp-review-qwen` failures printed exactly that while the tool passes standalone, so the cause
     could not be diagnosed — the runner had thrown the evidence away. Verified against a planted
     hanging tool, which now reports `TIMED OUT after 120s (killed, SIGTERM)`. */
  eq(whyFailed(null, 120000) === null, 'a successful run has no failure reason');
  eq(whyFailed({ killed: true, signal: 'SIGTERM' }, 120000).startsWith('TIMED OUT after 120s'), 'a killed process is reported as a TIMEOUT, in seconds');
  eq(whyFailed({ killed: true, signal: 'SIGTERM', code: 1 }, 120000).includes('TIMED OUT'), 'timeout wins over an exit code — a killed process also carries one');
  eq(whyFailed({ code: 7 }, 120000) === 'exited 7', 'a non-zero exit reports its code');
  eq(whyFailed({ signal: 'SIGKILL' }, 120000) === 'killed by SIGKILL', 'a signal kill (OOM) is named, not swallowed');
  eq(whyFailed({ message: 'spawn ENOENT\nstack' }, 120000) === 'spawn ENOENT', 'a spawn failure reports its first line only');
  eq(failureLines('ok\n  \u2717 parse: junk\nmore').length === 1, 'assertion lines lead when the tool printed any');
  eq(failureLines('a\nb\nc\nd\ne\nf\ng\nh').length === 6, 'otherwise the TAIL is shown, capped at 6 lines');
  eq(failureLines('').length === 0, 'no output at all returns nothing — the caller says so in words');
  eq(failureLines('  \n\n  ').length === 0, 'whitespace-only output is no output');
  /* ── the bounded pool ────────────────────────────────────────────────────────────────────────
     Two contracts, and BOTH matter. Concurrency, because the whole defect was unbounded fan-out —
     84 subprocesses on 24 cores starving a tool into its own 120 s timeout. And ORDER, because the
     reporting below indexes results by position: a pool that returns completion-ordered results
     would silently attribute every failure to the wrong tool, which is a worse bug than the one
     being fixed and would not show up as a crash. */
  {
    let live = 0;
    let peak = 0;
    const seen = await runPooled(
      [5, 4, 3, 2, 1, 0, 6, 7],
      async (v) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, v));
        live--;
        return v * 10;
      },
      3
    );
    eq(peak <= 3, `the pool never exceeds its limit (peak ${peak}, limit 3)`);
    eq(peak > 1, `…and it is actually CONCURRENT, not serialised (peak ${peak})`);
    eq(seen.join(',') === '50,40,30,20,10,0,60,70', 'results stay in INPUT order, not completion order');
  }
  console.log(`all ${n} selftests passed`);
  process.exit(0);
}

if (argv.includes('--list')) {
  console.log(files.map((f) => '  tools/' + f).join('\n'));
  process.exit(0);
}

const run = (f) =>
  new Promise((res) => {
    const t0 = Date.now();
    execFile(process.execPath, [join(TOOLS, f), '--selftest'], { cwd: ROOT, timeout: TOOL_TIMEOUT_MS, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const ms = Date.now() - t0;
      const out = String(stdout || '') + String(stderr || '');
      const m = out.match(/all (\d+) selftests passed/) || out.match(/all green/);
      /* Load is sampled AT THE KILL, not at the end: by the time the sweep finishes the spike that
         killed the tool is gone, and an average taken then would describe a different machine. */
      res({ f, ms, load: err ? os.loadavg()[0] : null, ok: !err, n: m && m[1] ? Number(m[1]) : null, readable: !!m, out, why: whyFailed(err, TOOL_TIMEOUT_MS) });
    });
  });

const nearMiss = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.mjs') && f !== 'selftest-all.mjs')
  .filter((f) => {
    try {
      return declaresNearMissSelftest(readFileSync(join(TOOLS, f), 'utf8'));
    } catch (_) {
      return false;
    }
  })
  .sort();

/* LOAD AT SWEEP START, and again at every kill (below). §3.4's surviving hypothesis is that the kills
   come from CROSS-SESSION load — several fleet sessions running full gates on one box — which is
   invisible from inside any single session. Printing the 1-minute load average is what turns that from a
   narrative into something falsifiable: a kill at LOW load refutes it outright, and a kill at high load
   with no other gate running refutes it differently. Costs one syscall. */
const load0 = os.loadavg()[0];
console.log(`  load average at sweep start: ${load0.toFixed(2)} (${os.cpus().length} cores)`);
/* 🔴 BOUNDED, NOT `Promise.all(files.map(run))` — which spawned EVERY tool at once: measured 84 node
   subprocesses on 24 cores, against a fixed 120 s per-tool timeout. A tool that needs real CPU is then
   starved by its 83 siblings and killed at the cap, so `test:tools` reds the LOCAL `npm run check` for
   reasons unrelated to the change under test. That happened three times on 2026-09-03, on three
   unrelated branches, always to `dsp-review-qwen.mjs` (it drives a local model) — which passes
   STANDALONE at load 5.53, HIGHER than the 3.95 one of the sweep runs died at. Machine load was never
   the discriminator; the sweep manufactured its own contention.
   ⚠️ CI is unaffected and that is why this never showed there: `.github/workflows/tests.yml` runs the
   same selftests in a SEQUENTIAL bash loop, one at a time. The defect lived entirely on the local gate.
   ⚠️ NOT a bigger timeout — raising 120 s hides the fan-out and the next slow tool re-finds it.
   Order is preserved (results[i] belongs to files[i]) because the reporting below indexes by position. */
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));
async function runPooled(list, worker, limit) {
  const out = new Array(list.length);
  let next = 0;
  async function pump() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await worker(list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, pump));
  return out;
}
const results = await runPooled(files, run, CONCURRENCY);
/* Wall time is printed for the tools that can actually approach the timeout, so the §3.4 account stays
   testable on every run rather than only when something dies: if a ≤0.3 s tool ever times out, the
   CPU-demand explanation is refuted, and these numbers are how anyone would notice. */
const slow = (r) => (r && r.ms >= 1000 ? `  [${(r.ms / 1000).toFixed(1)} s]` : '');
let failed = 0,
  warned = 0,
  total = 0;
for (const r of results) {
  if (!r.ok) {
    failed++;
    console.log(`  ✗ tools/${r.f}  FAILED${r.why ? '  — ' + r.why : ''}${slow(r)}${r.load != null ? `  [load ${r.load.toFixed(2)} at the kill, ${load0.toFixed(2)} at start]` : ''}`);
    /* PRINT THE EVIDENCE THAT EXISTS, not only the evidence of one failure shape. This filtered the
       tool's output to lines containing `✗` or `FAILED` — the signature of an ASSERTION failure — so a
       timeout, a crash or any non-zero exit whose output carries neither token printed a BLANK LINE and
       the run said only that something failed. Measured 2026-09-02: two independent `dsp-review-qwen`
       failures both printed exactly that blank, while the tool passes standalone (21 ok, 0 failed) —
       the cause could not be diagnosed because the runner had thrown it away. §4b's family: a report
       that shows the part matching its expectations and silently drops the rest. Assertion lines still
       lead when present; otherwise the tail of whatever the tool did say, and `(no output at all)` when
       it said nothing, which is itself the tell for a timeout. */
    const shown = failureLines(r.out);
    console.log(shown.length ? shown.map((l) => '      ' + l.trim()).join('\n') : '      (no output at all — consistent with a timeout or a kill before the tool printed)');
  } else if (!r.readable) {
    /* Exited 0 but printed nothing this script recognises. WARN, do not fail.
       The EXIT CODE is the contract a tool actually declares; "must also print a summary I can parse"
       is this script's preference, and enforcing it flagged NINE pre-existing analysis tools that are
       working correctly. A gate that lands red on day one over a formatting opinion gets switched
       off, and then the real failures it would have caught go with it — the same argument that kept a
       coverage threshold out of #1163. */
    warned++;
    console.log(`  ⚠ tools/${r.f}  green (exit 0), but no parseable summary — cannot report an assertion count${slow(r)}`);
  } else {
    total += r.n || 0;
    console.log(`  ✓ tools/${r.f}${r.n ? '  ' + r.n + ' assertions' : '  green'}${slow(r)}`);
  }
}
for (const f of nearMiss) {
  console.log(`  ✗ tools/${f}  HAS a selftest that discovery cannot reach — rename the flag to \`--selftest\` and match it with \`.includes()\``);
}
console.log(
  `\n${failed || nearMiss.length ? `✗ ${failed} tool selftest(s) FAILED${nearMiss.length ? `, ${nearMiss.length} unreachable` : ''}` : `✓ ${results.length} tools, ${total}+ assertions — all green`}${warned ? `  (${warned} green but unparseable)` : ''}`
);
process.exit(failed || nearMiss.length ? 1 : 0);
