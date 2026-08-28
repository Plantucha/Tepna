// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// qwen-mypy-fix.mjs — the mypy burn-down FIX lane (PYTHON-TYPES-AND-FORMAT §P2, qwen half).
//
// §P1 wired mypy as an advisory gate with a recorded baseline of 189 errors that "must only go
// DOWN". This lane produces per-error PATCH PROPOSALS for the mechanical share — annotation gaps,
// Optional handling, container types — and it lands NOTHING: every proposal is human-read before it
// reaches a branch, per §0 of the qwen program.
//
// 🔴 THE RAILS LIVE IN THE VERIFIER, NOT IN THE PROMPT, AND THAT IS THE WHOLE DESIGN.
// "No `Any`, no bare `type: ignore`" told to a model is a request. The same rule as a rejecting
// predicate is a gate. The distinction matters more here than anywhere else in the program, because
// this lane's own success metric is a COUNT GOING DOWN, and there is a lazy path that drives that
// count to zero while adding nothing whatsoever:
//
//     def f(x):          →      def f(x: Any) -> Any:        # mypy: 0 errors, information: 0
//     y = g()            →      y = g()  # type: ignore      # mypy: 0 errors, information: 0
//
// A lane whose metric can be satisfied by erasing the question must not be able to reach that path,
// so `rejectProposal` refuses it structurally. Discouraging it in a prompt would leave the lane's
// precision number looking excellent while it produced nothing — the examined-nothing shape wearing
// a fix lane's clothes.
//
// ⚠️ AN EMPTY PROPOSAL IS A REJECTION, NOT A CLEAN PASS. Every rail below is a "does the added text
// contain X" test, and all of them are trivially satisfied by adding no text at all. A predicate that
// returns ok for a proposal that changes nothing would score the lane's laziest possible output as
// its safest, so emptiness is checked FIRST and by itself.
//
// The model proposes; `mypy --strict-equality` delta and the full `capture-host/check.sh` verify.
// The local model is never in the verification path — it cannot judge its own output.

import { existsSync, readFileSync } from 'node:fs';

/** Owner-directed pin (2026-08-27 A/B, n=41 paired, temp 0). `think:false` is load-bearing: a
 *  reasoning reply comes back EMPTY from this endpoint, which the idle driver's header documents. */
export const MODEL = 'qwen3.8:27b';

/** `file:line:col: error: message  [code]` — mypy's default output. Anything else is not an error
 *  line and is skipped rather than guessed at. */
export function parseMypy(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([^:\s][^:]*):(\d+):(?:(\d+):)?\s*error:\s*(.*?)(?:\s*\[([a-z-]+)\])?\s*$/);
    if (!m) continue;
    out.push({ file: m[1], line: +m[2], col: m[3] ? +m[3] : null, message: m[4], code: m[5] || null });
  }
  return out;
}

/** The error classes §P2 assigns to this lane. The Argument-type and assignment classes are the
 *  SESSION lane's — each of those is either an annotation fix or a real logic finding, and that call
 *  is exactly what the model measurably cannot make, so this lane must not be handed them. */
export const MECHANICAL_CODES = ['no-untyped-def', 'var-annotated', 'type-arg', 'no-any-return', 'annotation-unchecked'];

export function isMechanical(err) {
  return !!err && MECHANICAL_CODES.includes(err.code);
}

/* A line the proposal ADDS, i.e. present in `after` and not in `before`. Comparing added lines
   rather than the whole text is what lets the rails coexist with existing code that legitimately
   already contains `Any` — the rail is "this proposal introduces it", never "this file mentions
   it". Whitespace-normalised so a reindent is not read as an addition. */
export function addedLines(before, after) {
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const had = new Set(String(before).split('\n').map(norm));
  return String(after)
    .split('\n')
    .filter((l) => l.trim() && !had.has(norm(l)));
}

/**
 * THE RAILS. Returns `{ ok, reasons }` — `ok:false` means the proposal is auto-rejected before any
 * human reads it, and `reasons` is what the ledger records.
 *
 * `# type: ignore[code]  # a reason` is ALLOWED: §P3's flip counts a typed, reasoned ignore as zero,
 * because it documents a decision. A BARE ignore is refused — it erases the question instead of
 * answering it, and by rail it does not exist in this repo.
 */
export function rejectProposal({ before = '', after = '' } = {}) {
  const reasons = [];
  /* FIRST, and alone: every other rail is a "does the added text contain X" test, and all of them
     pass vacuously when nothing was added. */
  const added = addedLines(before, after);
  if (!String(after).trim()) reasons.push('empty proposal — a fix that adds nothing is not a fix');
  else if (!added.length) reasons.push('proposal is identical to the original (no added line)');
  else {
    /* ⚠️ COUNT THE OCCURRENCES, do not scan the added LINES — found by a planted near-miss whose
       premise turned out to be the design question. A proposal that edits a line already containing
       `Any` (adding a return type, say) produces an "added line" carrying an `Any` it did not
       introduce, and a line-level scan rejects that legitimate incremental fix. The rail is
       "this proposal INTRODUCES one", which is a delta, so it is measured as one: strictly more
       occurrences after than before. Carrying an existing `Any` forward is allowed; adding one is
       not. */
    const anyN = (t) =>
      (
        String(t)
          .replace(/#[^\n]*/g, '')
          .match(/(?<![A-Za-z0-9_])Any(?![A-Za-z0-9_])/g) || []
      ).length;
    if (anyN(after) > anyN(before)) reasons.push(`introduces \`Any\` (${anyN(before)} → ${anyN(after)}) — name the type or decline`);
    for (const l of added) {
      const ig = l.match(/#\s*type:\s*ignore(\[[a-z, -]+\])?(.*)$/);
      if (ig) {
        const hasCode = !!ig[1];
        const hasReason = /[A-Za-z]/.test(String(ig[2] || '').replace(/^\s*#/, ''));
        if (!hasCode || !hasReason) reasons.push(`bare \`type: ignore\` (needs [code] AND a reason): ${l.trim().slice(0, 70)}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** What the ledger records for a proposal. Lens `mypy-fix`, per §P2 — its acceptance rate IS the
 *  lane's precision metric, and the pre-stated band is <30 % accepted after 30 triaged ⇒ retire. */
export function ledgerEntry(err, verdict) {
  return {
    lens: 'mypy-fix',
    file: err.file,
    line: err.line,
    title: `${err.code || 'mypy'}: ${String(err.message).slice(0, 90)}`,
    detail: verdict.ok ? 'proposal awaiting human triage' : `AUTO-REJECTED — ${verdict.reasons.join('; ')}`,
    status: verdict.ok ? 'new' : 'rejected'
  };
}

/** The band, as a function rather than a paragraph. `null` until the sample exists — a rate over
 *  fewer than 30 triaged is not the measurement the brief pre-stated, and reporting one anyway is
 *  how a band gets quietly moved. */
export function laneVerdict({ triaged, accepted }) {
  if (triaged < 30) return { decided: false, reason: `${triaged}/30 triaged — the band is not evaluable yet`, rate: null };
  const rate = accepted / triaged;
  return { decided: true, rate, retire: rate < 0.3, reason: `${(rate * 100).toFixed(0)} % accepted over ${triaged} triaged` };
}

const PROMPT_RULES = `You are proposing a MINIMAL Python type-annotation patch for one mypy error in Tepna's capture-host.

Rules, enforced mechanically after you answer — a proposal breaking any of them is discarded unread:
1. NEVER use \`Any\`. If you cannot name the type, say so instead of proposing.
2. NEVER emit a bare \`# type: ignore\`. A typed, reasoned \`# type: ignore[code]  # why\` is acceptable ONLY when the error is genuinely unfixable in-file.
3. Change as little as possible: annotate, do not restructure.
4. If the error looks like a REAL BUG rather than a missing annotation, say exactly "REAL-BUG:" and describe it. Do not patch it.

Answer with ONLY the replacement lines for the cited region — no prose, no fences, no explanation.`;

export function buildPrompt(err, sourceRegion) {
  return `${PROMPT_RULES}\n\nFILE: ${err.file}:${err.line}\nMYPY: ${err.message}${err.code ? ` [${err.code}]` : ''}\n\nREGION:\n${sourceRegion}\n`;
}

// -- selftest ------------------------------------------------------------------------------------
function selftest() {
  let pass = 0;
  let fail = 0;
  const ck = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else {
      fail++;
      console.log(`  x ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    }
  };

  // -- parseMypy
  const my = parseMypy(
    [
      'capture-host/capture.py:12:5: error: Function is missing a type annotation  [no-untyped-def]',
      'capture-host/capture.py:40: error: Need type annotation for "rows"  [var-annotated]',
      'Found 2 errors in 1 file (checked 30 source files)'
    ].join('\n')
  );
  ck('mypy: two error lines parsed, the summary line ignored', my.length, 2);
  ck('mypy: the code is captured', my[0].code, 'no-untyped-def');
  ck('mypy: a col-less line still parses', my[1].line, 40);
  ck('mypy: a non-error line is skipped, not guessed', parseMypy('capture-host/x.py:1: note: something').length, 0);
  /* THE EMPTY-VS-CLEAN DISCRIMINATOR. Both yield zero errors from `parseMypy`; only one of them means
     the tree is clean. The CLI refuses the empty case outright — asserted here at the parse layer so
     the distinction is pinned even if the CLI is rewritten. */
  ck('mypy: an EMPTY feed parses to zero errors — indistinguishable from clean at this layer', parseMypy('').length, 0);
  ck('mypy: …while a genuinely clean run carries a SUCCESS line to tell them apart', /Success: no issues/.test('Success: no issues found in 41 source files'), true);

  // -- lane split
  ck('lane: an annotation gap is this lane’s', isMechanical(my[0]), true);
  ck('lane: an arg-type error is NOT (it is a real-bug judgement — the session lane’s)', isMechanical({ code: 'arg-type' }), false);
  ck('lane: an assignment error is NOT', isMechanical({ code: 'assignment' }), false);

  // -- THE RAILS
  const okFix = rejectProposal({ before: 'def f(x):', after: 'def f(x: int) -> str:' });
  ck('rail: a real annotation passes', okFix.ok, true);
  /* THE LAZY PATH — the one that makes the count drop while adding nothing. It must be
     structurally unavailable, not discouraged. */
  ck('rail: `Any` in an added annotation is REJECTED', rejectProposal({ before: 'def f(x):', after: 'def f(x: Any) -> Any:' }).ok, false);
  ck('rail: a BARE type: ignore is REJECTED', rejectProposal({ before: 'y = g()', after: 'y = g()  # type: ignore' }).ok, false);
  /* NEAR-MISSES, both directions — the rail must be sharp, not merely strict. */
  ck('rail: a typed ignore WITH a reason is ALLOWED', rejectProposal({ before: 'y = g()', after: 'y = g()  # type: ignore[arg-type]  # third-party stub is wrong, see #123' }).ok, true);
  ck('rail: a typed ignore with NO reason is rejected', rejectProposal({ before: 'y = g()', after: 'y = g()  # type: ignore[arg-type]' }).ok, false);
  ck('rail: an UNtyped ignore with a reason is still rejected', rejectProposal({ before: 'y = g()', after: 'y = g()  # type: ignore  # because' }).ok, false);
  ck('rail: `Anything` is not `Any`', rejectProposal({ before: 'x = 1', after: 'x: Anything = 1' }).ok, true);
  ck('rail: the word Any inside a COMMENT is not an annotation', rejectProposal({ before: 'x = 1', after: 'x: int = 1  # not Any, deliberately' }).ok, true);
  ck('rail: `Any` already present in the ORIGINAL is not the proposal introducing it', rejectProposal({ before: 'def f(x: Any):', after: 'def f(x: Any) -> int:' }).ok, true);
  ck('rail: …but ADDING a second `Any` to that same line is still rejected', rejectProposal({ before: 'def f(x: Any):', after: 'def f(x: Any) -> Any:' }).ok, false);
  ck('rail: REMOVING an `Any` is obviously fine', rejectProposal({ before: 'def f(x: Any):', after: 'def f(x: int) -> None:' }).ok, true);
  /* THE VACUITY GUARD. Every rail above is "does the added text contain X", and all of them pass
     when nothing was added — so the laziest possible output would score as the safest. */
  ck('VACUITY: an empty proposal is REJECTED, not clean', rejectProposal({ before: 'def f(x):', after: '' }).ok, false);
  ck('VACUITY: whitespace only is REJECTED', rejectProposal({ before: 'def f(x):', after: '   \n\t' }).ok, false);
  ck('VACUITY: a proposal identical to the original is REJECTED', rejectProposal({ before: 'def f(x):', after: 'def f(x):' }).ok, false);
  ck('VACUITY: a pure reindent adds nothing and is REJECTED', rejectProposal({ before: 'def f(x):', after: '    def f(x):' }).ok, false);
  ck('rail: the rejection says WHICH rail, not just "rejected"', /introduces `Any`/.test(rejectProposal({ before: 'def f(x):', after: 'def f(x: Any):' }).reasons[0]), true);

  // -- ledger shape
  ck('ledger: a rejection is recorded as rejected, under lens mypy-fix', ledgerEntry(my[0], { ok: false, reasons: ['introduces `Any`'] }).status, 'rejected');
  ck('ledger: …and the lens is the one the band is tracked under', ledgerEntry(my[0], { ok: true, reasons: [] }).lens, 'mypy-fix');

  /* THE BAND. A rate over fewer than 30 triaged is not the pre-stated measurement, and reporting
     one anyway is how a band gets quietly moved after the fact. */
  ck('band: undecidable below 30 triaged, and says so', laneVerdict({ triaged: 12, accepted: 11 }).decided, false);
  ck('band: …and returns no rate at all rather than a flattering one', laneVerdict({ triaged: 12, accepted: 11 }).rate, null);
  ck('band: 29 % over 30 retires the lane', laneVerdict({ triaged: 30, accepted: 8 }).retire, true);
  ck('band: 30 % exactly does NOT retire it (the band is `< 30 %`)', laneVerdict({ triaged: 30, accepted: 9 }).retire, false);

  console.log(`\nqwen-mypy-fix selftest: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// -- CLI -----------------------------------------------------------------------------------------
function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const i = argv.indexOf('--mypy-log');
  const logPath = i >= 0 ? argv[i + 1] : null;
  if (!logPath) {
    console.log('usage: node tools/qwen-mypy-fix.mjs --mypy-log <mypy-output.txt> [--limit N]');
    console.log('       node tools/qwen-mypy-fix.mjs --selftest');
    console.log('');
    console.log('Produces PATCH PROPOSALS for the mechanical mypy classes. Lands nothing: every');
    console.log('proposal is human-read, and one using `Any` or a bare `type: ignore` is rejected');
    console.log('before a human sees it. Verifier is the mypy delta + capture-host/check.sh — the');
    console.log('local model is never in the verification path.');
    return 2;
  }
  if (!existsSync(logPath)) {
    console.error(`refusing: ${logPath} does not exist. An absent log is not a clean run.`);
    return 2;
  }
  const raw = readFileSync(logPath, 'utf8');
  /* 🔴 AN EMPTY FEED IS "NEVER WRITTEN", NOT "NO ERRORS". `check.sh` creates this file by redirect,
     so it exists the instant mypy starts and stays empty if mypy dies, is killed, or the gate crashes
     before it. An empty file and a clean tree are then indistinguishable to a consumer that only
     counts error lines — and this lane would report a triumphant zero about a run that never happened.
     A genuinely clean mypy does NOT produce an empty file: it writes "Success: no issues found in N
     source files". So emptiness is a refusal, and cleanliness is a line of text. */
  if (!raw.trim()) {
    console.error(`refusing: ${logPath} is EMPTY — that is "mypy never wrote", not "no errors".`);
    console.error('A clean run writes "Success: no issues found…"; an empty file means the gate died before mypy finished.');
    return 2;
  }
  const errs = parseMypy(raw);
  const mine = errs.filter(isMechanical);
  console.log(`mypy errors: ${errs.length} · this lane's classes: ${mine.length} · session lane's: ${errs.length - mine.length}`);
  if (!errs.length) console.error('⚠  zero errors parsed — check the log format before reading this as a clean tree.');
  const lim = argv.indexOf('--limit');
  const n = lim >= 0 ? +argv[lim + 1] : mine.length;
  for (const e of mine.slice(0, n)) console.log(`  ${e.file}:${e.line}  [${e.code}]  ${e.message.slice(0, 80)}`);
  console.log('\n(proposal generation runs under the idle driver; this listing is the lane’s work queue.)');
  return 0;
}

process.exit(main(process.argv.slice(2)));
