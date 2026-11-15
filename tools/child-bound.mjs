#!/usr/bin/env node
/*
 * tools/child-bound.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * KEEP THE REASON A BOUNDED CHILD GAVE YOU. One `boundedChild` for a synchronous child process that a
 * tool reads an answer from, so a child killed at its cap names the breach instead of arriving as an
 * empty answer.
 *
 * WHY THIS EXISTS. #5046 bounded every `fetch` under `tools/`. The sibling class is the synchronous
 * child, and the measurement says the bound is NOT the gap. Measured 2026-11-15 at `b77e17535` over
 * the 351 files in `tools/`: 152 of them make 387 `execFileSync` / `execSync` / `spawnSync` calls, 52
 * of those calls name a `timeout`, and 10 of the 52 run `node` on a repo tool. Three of those ten
 * CAUGHT the breach and then threw the reason away:
 *
 *   `board-share.mjs:208`      `catch { return null }`  over a 120 s cap on `doc-search.mjs`
 *   `dsp-review-qwen.mjs:221`  `catch { return '' }`    over a 30 s cap on `doc-search.mjs`
 *   `qwen-agent.mjs:97`        a generic `TOOL ERROR: Command failed: …` over a 60 s cap
 *
 * The first two are CLAUDE.md §∅ at the reason level. The arithmetic was already right — `board-share`
 * excludes an unreadable query from `checked` rather than counting it as zero hits — and the reader
 * still cannot tell a stalled `doc-search` from one that crashed on that query. That distinction is
 * what cost the fleet three sessions on 2026-11-14, when the embedder accepted every connection and
 * answered none of them. The third names the CLASS of the failure in place of the breach, which is the
 * `String(new Error(''))` reading again.
 *
 * 🔴 A BLANKET TIMEOUT OVER THE OTHER 335 CALLS IS NOT THE REMEDY, and this module does not ask for
 * one. A `git rev-parse` reader cannot hang the way a model call can, and CLAUDE.md §4c records that a
 * bigger cap hides a fan-out rather than fixing it. The population above is the one this file serves:
 * a call that already states a bound and reads an ANSWER back.
 *
 * ⚠️ THIS BOUNDS THE WAIT, AND IT REAPS NOTHING. I MEASURED THE POOL CASE RATHER THAN QUOTING IT.
 * `tools/mutation-crawl.mjs:745` states that `execFileSync`'s `timeout` signals the DIRECT child only,
 * so a grandchild holding the stdout pipe keeps the parent's read open and the call never returns.
 * 🔴 THAT SECOND HALF DOES NOT HOLD FOR `execFileSync` ON NODE v22.23.1. Measured 2026-11-15 against a
 * 500 ms bound:
 *
 *   a leaf child that never exits                                      returned at 503 ms
 *   a child that EXITS while its grandchild holds the inherited stdout  returned at 504 ms
 *
 * So the CALL returns in both shapes, and `boundedChild` carries a real leg for each. What survives is
 * the GRANDCHILD: it was still running after the second call returned, and I killed it by pid.
 * `mutation-crawl.mjs` reads an async `spawn` through its own streams, where an open pipe does keep the
 * reader waiting, so its process group is the right remedy THERE and this file does not reproduce it.
 * A caller whose child spawns workers gets a bounded WAIT here and no reap, so it still owes the group
 * kill. Read that file before you bound a spawner through this one.
 *
 * ONE VOCABULARY, SINGLE-SOURCED. The breach text comes from `whyFailed` in `tools/selftest-all.mjs`,
 * which already orders `killed` before `code` (a killed process also carries an exit code) and pins
 * that order with its own leg. A second spelling of "TIMED OUT after 120s" in this repo would drift
 * from that one, so this module imports it rather than restating it.
 */

import { execFileSync } from 'node:child_process';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { whyFailed } from './selftest-all.mjs';

/* A bound is REQUIRED, and it refuses rather than defaults. A default here would be this module
   quietly choosing a wait for a caller whose own code states one, and an absent bound is the defect
   the file exists to stop — so an absent, zero, negative or unparseable `ms` throws at the call. */
export function requireBoundMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`boundedChild needs a positive finite ms bound, and got ${JSON.stringify(ms)}`);
  return n;
}

/* The reason a reader gets. `label` names WHAT did not answer, because `whyFailed` names only HOW it
   ended, and a reader holding "TIMED OUT after 30s" alone cannot tell which child it was. */
export function childFailureReason(err, ms, label) {
  const how = whyFailed(err, requireBoundMs(ms));
  const who = label || 'the child';
  return how ? `${who}: ${how}` : `${who}: the call failed with no message`;
}

/* Run a synchronous child and keep both outcomes readable.
     { ok: true,  out, ms }            the child answered; `out` is its stdout
     { ok: false, out: null, reason }  the child did not answer, and `reason` names the breach
   It never throws for the child's own failure, because a caller that wanted a throw already had one.
   `impl` is injected so a selftest can run every leg without spawning a process. */
export function boundedChild(
  file,
  args = [],
  { ms, label = null, cwd = undefined, env = undefined, encoding = 'utf8', maxBuffer = 1 << 24, stdio = ['ignore', 'pipe', 'pipe'], impl = execFileSync } = {}
) {
  const bound = requireBoundMs(ms);
  const who = label || `${file} ${args[0] ?? ''}`.trim();
  const t0 = Date.now();
  try {
    const out = impl(file, args, { cwd, env, encoding, maxBuffer, stdio, timeout: bound });
    return { ok: true, out, ms: Date.now() - t0, reason: null, status: 0, killed: false, timedOut: false };
  } catch (err) {
    /* `status` and `killed` travel with the breach, because ONE CALLER CANNOT ASK THE REASON STRING.
       `git grep` exits 1 to say "no matches", which is an ANSWER and not a failure, so `qwen-agent.mjs`
       reads `status === 1 && !killed` and reports the absence. Read `killed` FIRST wherever you read
       `status`: a killed child also carries an exit code, which is why `whyFailed` orders it that way. */
    return {
      ok: false,
      out: null,
      ms: Date.now() - t0,
      reason: childFailureReason(err, bound, who),
      status: err && typeof err.status === 'number' ? err.status : null,
      killed: !!(err && (err.killed || err.signal)),
      /* `timedOut` is the only honest breach test, because the two timeout shapes disagree on both of
         the fields above: a killed child reads `killed: true` with no status, and a child that exited
         under the cap reads `killed: false` with `status: 0`. A caller asking "did it answer or did it
         run out of time" reads THIS. */
      timedOut: !!(err && (err.code === 'ETIMEDOUT' || err.killed || err.signal === 'SIGTERM'))
    };
  }
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────────
   Every leg but the last three injects its own `impl`, so almost nothing here spawns or opens a pipe.
   🔴 THE LAST THREE LEGS SPAWN A REAL CHILD ON PURPOSE. A deadline is enforced only on a path that can
   REACH it, and an injected `impl` proves nothing about that path — the one control that separates a
   reachable cap from a decorative one is an adversarial child that never answers (memory:
   `a-deadline-behind-a-blocking-read-is-decoration`). They cost about 1.2 s in total and leak nothing,
   because the planted grandchild exits on its own. */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest'], valued: [] }, { tool: 'child-bound.mjs' });

  if (!argv.includes('--selftest')) {
    console.log('usage: node tools/child-bound.mjs --selftest');
    console.log('       (a library: import { boundedChild } from "./child-bound.mjs")');
    process.exit(0);
  }

  let pass = 0;
  const fails = [];
  const ok = (what, cond) => {
    if (cond) pass++;
    else fails.push(what);
  };
  const throws = (what, fn, needle) => {
    try {
      fn();
      fails.push(what + ' (it did not throw)');
    } catch (e) {
      ok(what, String(e.message).includes(needle));
    }
  };

  /* ── the bound is required ── */
  throws('an absent bound throws', () => requireBoundMs(undefined), 'positive finite ms');
  throws('a zero bound throws', () => requireBoundMs(0), 'positive finite ms');
  throws('a negative bound throws', () => requireBoundMs(-1), 'positive finite ms');
  throws('an unparseable bound throws', () => requireBoundMs('soon'), 'positive finite ms');
  throws('an empty-string bound throws', () => requireBoundMs(''), 'positive finite ms');
  ok('a positive bound is returned as a number', requireBoundMs('250') === 250);
  throws('boundedChild refuses a call with no bound', () => boundedChild('node', [], { impl: () => 'x' }), 'positive finite ms');

  /* ── the happy path ── */
  const good = boundedChild('node', ['-e', '1'], { ms: 1000, impl: () => 'hello' });
  ok('a child that answers returns ok with its stdout', good.ok === true && good.out === 'hello');
  ok('…and carries no reason', good.reason === null);
  ok('…and reports the wall time it took', typeof good.ms === 'number' && good.ms >= 0);

  /* ── the breach ──
     Each reason leg below tests the reason for PRESENCE first. Measured 2026-11-15: without that, a
     planted control that made a breach read as an answer crashed the selftest on `null.includes`
     instead of redding a named leg, and a crash does not tell a reader WHICH expectation broke. */
  const timedOut = boundedChild('node', ['x.mjs'], {
    ms: 30000,
    label: 'the doc-search call',
    impl: () => {
      throw Object.assign(new Error('Command failed: node x.mjs'), { killed: true, signal: 'SIGTERM', status: null });
    }
  });
  ok('a killed child does NOT read as an answer', timedOut.ok === false);
  ok('…and its out is null, never an empty string', timedOut.out === null);
  ok('…and the reason names the bound in seconds', !!timedOut.reason && timedOut.reason.includes('TIMED OUT after 30s'));
  ok('…and the reason names WHICH child did not answer', !!timedOut.reason && timedOut.reason.startsWith('the doc-search call:'));

  /* 🔴 A TIMEOUT WINS OVER AN EXIT CODE, because a killed process also carries one. The order lives
     in `whyFailed`, and this leg is here so a reordering there reds a CALLER too, not only its own
     file. Measured 2026-11-15: reversing the two tests in `whyFailed` reds this leg and the one
     above it. */
  const killedWithCode = boundedChild('node', [], {
    ms: 5000,
    label: 'the suite',
    impl: () => {
      throw Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM', code: 1 });
    }
  });
  ok('a killed child that also carries an exit code reads as a TIMEOUT', !!killedWithCode.reason && killedWithCode.reason.includes('TIMED OUT'));

  const crashed = boundedChild('node', [], {
    ms: 5000,
    label: 'the lookup',
    impl: () => {
      throw Object.assign(new Error('boom'), { code: 2 });
    }
  });
  ok('a crash is a different reason from a timeout', crashed.ok === false && !!crashed.reason && !crashed.reason.includes('TIMED OUT'));
  ok('…and it still names the child', !!crashed.reason && crashed.reason.startsWith('the lookup:'));

  const sigkilled = boundedChild('node', [], {
    ms: 5000,
    label: 'the sweep',
    impl: () => {
      throw Object.assign(new Error('x'), { signal: 'SIGKILL' });
    }
  });
  ok('a SIGKILL (an OOM reap) is named rather than swallowed', !!sigkilled.reason && sigkilled.reason.includes('SIGKILL'));

  /* ── the label fallback ── */
  const unlabelled = boundedChild('node', ['doc-search.mjs'], {
    ms: 1000,
    impl: () => {
      throw Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM' });
    }
  });
  ok('an unlabelled call names the file and its first argument', !!unlabelled.reason && unlabelled.reason.startsWith('node doc-search.mjs:'));
  const noArgs = boundedChild('node', [], {
    ms: 1000,
    impl: () => {
      throw Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM' });
    }
  });
  ok('…and a call with no arguments still names something', !!noArgs.reason && noArgs.reason.startsWith('node:'));

  /* ── the bound reaches the child ── */
  let seen = null;
  boundedChild('node', ['-e', '1'], {
    ms: 4242,
    impl: (_f, _a, o) => {
      seen = o;
      return '';
    }
  });
  ok('the bound is passed to the child as its timeout', seen && seen.timeout === 4242);
  ok('…and stdin is ignored by default, so no child can block on it', seen && seen.stdio[0] === 'ignore');
  ok('…and stdout is a pipe, because the caller reads an answer', seen && seen.stdio[1] === 'pipe');

  /* ── childFailureReason alone ── */
  ok('childFailureReason names a bare error by its message', childFailureReason(new Error('nope'), 100, 'the probe') === 'the probe: nope');
  ok('…and falls back to a generic child name', childFailureReason(new Error('nope'), 100, null).startsWith('the child:'));
  throws('…and refuses an absent bound like the rest', () => childFailureReason(new Error('x'), 0, 'the probe'), 'positive finite ms');

  /* ── an empty answer is an ANSWER, never a breach ── */
  const empty = boundedChild('node', [], { ms: 1000, impl: () => '' });
  ok('a child that answers with nothing is still ok', empty.ok === true && empty.out === '' && empty.reason === null);

  /* ── REAL CHILDREN. These three spawn, because an injected `impl` cannot show that the deadline sits
     on a path control can reach. Each one is adversarial: it never gives the answer the caller wants. */
  const realLeaf = boundedChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ms: 400, label: 'a leaf that never exits' });
  ok('🔴 A REAL CHILD THAT NEVER EXITS IS CUT OFF AT THE BOUND', realLeaf.ok === false && realLeaf.timedOut === true);
  ok('…and the call returns in about the bound, not in its own time', realLeaf.ms < 5000);
  ok('…and the breach names the timeout', !!realLeaf.reason && realLeaf.reason.includes('TIMED OUT'));

  /* The 2026-09-28 pool mechanism, planted: the DIRECT child exits at once and a GRANDCHILD keeps the
     inherited stdout open, so no signal can reach the child that the bound was set on. The grandchild
     exits on its own at 1500 ms, which is why this leg leaves nothing behind to reap. */
  const POOL_PLANT =
    'const{spawn}=require("node:child_process");const g=spawn(process.execPath,["-e","setTimeout(()=>process.exit(0),1500)"],{stdio:["ignore","inherit","inherit"]});g.unref();process.exit(0);';
  const realPool = boundedChild(process.execPath, ['-e', POOL_PLANT], { ms: 400, label: 'a child whose grandchild holds stdout' });
  ok('🔴 A GRANDCHILD ON THE STDOUT PIPE DOES NOT HANG THIS CALL', realPool.ok === false && realPool.ms < 5000);
  ok('…and that breach reads as a TIMEOUT and not as an exit code', !!realPool.reason && realPool.reason.includes('TIMED OUT'), realPool.reason);
  ok('…and `timedOut` holds although the child was never signalled', realPool.timedOut === true && realPool.killed === false);

  /* The same real child, under a bound it CAN meet. A cap that reds every child proves nothing. */
  const realOk = boundedChild(process.execPath, ['-e', 'process.stdout.write("real")'], { ms: 20000, label: 'a child that answers' });
  ok('a real child that answers inside its bound is ok', realOk.ok === true && realOk.out === 'real' && realOk.timedOut === false);

  if (fails.length) {
    console.log(`✗ ${fails.length} selftest(s) FAILED:`);
    for (const f of fails) console.log('   · ' + f);
    process.exit(1);
  }
  console.log(`✓ all ${pass} selftests passed`);
}
