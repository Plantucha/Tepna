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

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* THE PARSE RAIL. A proposal that does not parse is not a fix, and no judgement is involved — which
   is exactly the kind of rule that belongs in the verifier rather than in a prompt. It also catches a
   class the other rails cannot see: a reply that answers in PROSE ("I cannot infer the type here")
   sails past an `Any` check and a bare-ignore check, because it contains neither.

   ⚠️ A PROPOSAL IS A FRAGMENT, so a naive `ast.parse` would reject honest ones for being indented or
   for starting inside a block. Two attempts, and only a double failure is a rejection: the dedented
   text, then the same text re-indented under `if True:`. Verified against the real replies this lane
   has produced — a `def` block with an 8-space body, a bare indented statement, and a plain
   annotation all pass; a truncated call, an unbalanced bracket and a prose answer all fail.

   Python's own parser is the authority; nothing here re-implements Python syntax. */
const PARSE_PY = [
  'import ast,sys,textwrap',
  't=sys.stdin.read()',
  'd=textwrap.dedent(t)',
  'w="if True:\\n"+"\\n".join("    "+l for l in d.split("\\n"))',
  'ok=False',
  'for c in (d,w):',
  '    try:',
  '        ast.parse(c); ok=True; break',
  '    except SyntaxError: pass',
  'sys.exit(0 if ok else 1)'
].join('\n');

export function parsesAsPython(text, { run = execFileSync, py = 'python3' } = {}) {
  if (!String(text).trim()) return false; // nothing is not a program
  try {
    run(py, ['-c', PARSE_PY], { input: String(text), encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE RAILS. Returns `{ ok, reasons }` — `ok:false` means the proposal is auto-rejected before any
 * human reads it, and `reasons` is what the ledger records.
 *
 * `# type: ignore[code]  # a reason` is ALLOWED: §P3's flip counts a typed, reasoned ignore as zero,
 * because it documents a decision. A BARE ignore is refused — it erases the question instead of
 * answering it, and by rail it does not exist in this repo.
 */
export function rejectProposal({ before = '', after = '', parses } = {}) {
  const reasons = [];
  /* `parses` is supplied by the caller because the check shells out to Python and these rails are
     pure. The generator ALWAYS supplies it; it is `undefined` only in a direct call that has not run
     the check, and an unchecked proposal is not treated as a parsing one — it is simply not rejected
     on that ground, which the selftest pins in both directions. */
  if (parses === false) reasons.push('does not parse as Python — a reply that is prose, truncated, or unbalanced is not a fix');
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OLLAMA = 'http://127.0.0.1:11434';

/** Where the drafts live — machine-local, never committed. Same resolution as verify-drafts.mjs: the
 *  git COMMON dir, so a worktree resolves to the primary checkout's store instead of reporting a
 *  silent "no drafts". */
export function draftsDir(root = ROOT, { run = execFileSync } = {}) {
  try {
    const common = String(run('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' })).trim();
    return join(resolve(root, common), 'tepna-mutation');
  } catch {
    return join(root, '.git', 'tepna-mutation');
  }
}

/** THE JOURNAL KEY IS THE ERROR, NOT THE PROPOSAL — and that choice is the band's integrity.
 *  The lane retires at <30 % accepted over 30 triaged, so the DENOMINATOR must not be inflatable by
 *  cycling: if the key included the proposal text, re-asking one stubborn error would mint a fresh
 *  entry every run and drown a bad acceptance rate in re-asks. Keyed on the error, a second ask is a
 *  SKIP, and 30 triaged means 30 distinct errors answered. */
export function errorKey(err) {
  return [err.file, err.line, err.code || '', String(err.message).slice(0, 200)].join('\u0000');
}

export function loadJournal(text) {
  const byKey = new Map();
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r && typeof r.key === 'string') byKey.set(r.key, r);
    } catch {
      /* a torn last line from an interrupted cycle is not a verdict */
    }
  }
  return byKey;
}

/** The source the model is shown, and the `before` the rails compare against. Same region both ways,
 *  so "what it was asked to change" and "what it is judged against" cannot drift apart. */
export function regionOf(srcLines, line, ctx = 6) {
  const i = Math.max(0, line - 1 - ctx);
  const j = Math.min(srcLines.length, line + ctx);
  return srcLines.slice(i, j).join('\n');
}

/** A model reply that declines, per rule 4 of the prompt. A REAL BUG is NOT this lane's to patch —
 *  it routes to the session lane's findings, which is the entire reason §P2 splits the two. */
export function isRealBugReport(text) {
  return /^\s*REAL-BUG:/m.test(String(text));
}

/** Strip the fences a model adds despite being told not to. Nothing else is normalised: the rails
 *  must judge what the model actually wrote. */
export function cleanReply(text) {
  return String(text)
    .replace(/^\s*```[a-z]*\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

async function askModel(prompt) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      think: false, // load-bearing: a reasoning reply returns EMPTY from this endpoint
      stream: false,
      options: { temperature: 0, num_predict: 400 } // temp 0 — the bench that chose this model ran at 0
    })
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  return String(((await res.json()).message || {}).content || '');
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
  /* ── THE PARSE RAIL, both directions, against strings this lane has actually produced ──────────
     A proposal that does not parse is not a fix. Planted with real replies rather than invented ones:
     the `def` block below is the VERBATIM proposal for probe_verity_offline.py:79. */
  const REAL_DEF = 'def __init__(self, client: BleakClient):\n        self.client, self.q = client, asyncio.Queue[bytes]()';
  ck('parse: a real multi-line proposal with an indented body PARSES', parsesAsPython(REAL_DEF), true);
  ck('parse: a bare INDENTED fragment parses (it is a fragment, not a module)', parsesAsPython('        self.q: asyncio.Queue[bytes] = asyncio.Queue()'), true);
  ck('parse: a plain annotation parses', parsesAsPython('out: list[str] = []'), true);
  ck('parse: an unbalanced bracket does NOT', parsesAsPython('out: list[str = ['), false);
  ck('parse: a truncated call does NOT', parsesAsPython('self.client, self.q = client, asyncio.Queue[bytes]('), false);
  /* The class the other rails structurally cannot see: a PROSE answer contains no `Any` and no bare
     ignore, so every other rail passes it. */
  ck('parse: a PROSE reply does NOT — the rail the other rails cannot substitute for', parsesAsPython('I cannot infer the type here, sorry.'), false);
  ck('parse: empty is not a program', parsesAsPython('   '), false);
  ck('rail: a non-parsing proposal is REJECTED with its own reason', rejectProposal({ before: 'x = []', after: 'x: list[ = []', parses: false }).ok, false);
  ck('rail: …and the reason names parsing, not Any', /does not parse/.test(rejectProposal({ before: 'x = []', after: 'x: list[ = []', parses: false }).reasons[0]), true);
  ck('rail: parses:true does not suppress the OTHER rails', rejectProposal({ before: 'def f(x):', after: 'def f(x: Any):', parses: true }).ok, false);
  /* ⚠️ THE DISPLAY-TRUNCATION LESSON, made mechanical. Triaging the first cycle I nearly reported a
     proposal as truncated-and-invalid; it was whole, and what I had read was my own 100-char print.
     A summary is not the record. This asserts the FULL stored string parses while its display slice
     does not — the two answers differ, and only one of them is about the proposal. */
  ck('the full record parses…', parsesAsPython(REAL_DEF), true);
  ck('…while a 100-char DISPLAY SLICE of it does not — never judge the slice', parsesAsPython(REAL_DEF.slice(0, 100)), false);

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

/* THE GENERATOR. It proposes and it journals; it lands NOTHING. Every proposal is screened by
   `rejectProposal` BEFORE a human sees it, so the lazy path never reaches a reader's attention, and
   the verifier is mypy's own delta plus `capture-host/check.sh` — the model is in no verification
   path and cannot judge its own output. */
async function generate(errs, limit, showRaw) {
  const dd = draftsDir();
  const jpath = join(dd, 'mypy-fix-journal.jsonl');
  const journal = existsSync(jpath) ? loadJournal(readFileSync(jpath, 'utf8')) : new Map();
  const todo = errs.filter((e) => !journal.has(errorKey(e))).slice(0, limit);
  console.log(`journal: ${journal.size} answered - queue: ${errs.length} - asking: ${todo.length} (a re-ask is a SKIP, so 30 triaged means 30 DISTINCT errors)`);
  if (!todo.length) return 0;

  let accepted = 0;
  let rejected = 0;
  let realbug = 0;
  let shown = 0;
  for (const e of todo) {
    const abs = e.file.startsWith('capture-host/') ? join(ROOT, e.file) : join(ROOT, 'capture-host', e.file);
    if (!existsSync(abs)) {
      console.error(`  skip ${e.file}:${e.line} - not found at ${abs} (NOT journalled: nothing was asked, so it is not a triaged item)`);
      continue;
    }
    const lines = readFileSync(abs, 'utf8').split('\n');
    const before = regionOf(lines, e.line);
    let raw;
    try {
      raw = await askModel(buildPrompt(e, before));
    } catch (err) {
      console.error(`  ollama failed on ${e.file}:${e.line} - ${err.message}. NOT journalled: an unanswered error is not a rejected proposal.`);
      break; // the model is down; stop rather than burn the queue into a wall of false rejections
    }
    /* THE FIRST FEW REPLIES ARE THEMSELVES A PLANT - print them RAW before trusting the parse. A
       reader that silently mangles every reply yields a uniform rejection rate, which reads as a bad
       MODEL rather than a bad PARSER. */
    if (showRaw && shown < 3) {
      shown++;
      console.log(`\n--- RAW reply ${shown}/3 for ${e.file}:${e.line} ---\n${raw}\n--- end raw ---`);
    }
    const after = cleanReply(raw);
    let rec;
    if (isRealBugReport(after)) {
      realbug++;
      rec = { key: errorKey(e), at: new Date().toISOString(), err: e, outcome: 'REAL-BUG', text: after.slice(0, 800) };
      console.log(`  REAL-BUG routed to the session lane: ${e.file}:${e.line} - not patched here`);
    } else {
      const verdict = rejectProposal({ before, after, parses: parsesAsPython(after) });
      if (verdict.ok) accepted++;
      else rejected++;
      rec = { key: errorKey(e), at: new Date().toISOString(), err: e, outcome: verdict.ok ? 'PROPOSED' : 'AUTO-REJECTED', reasons: verdict.reasons, proposal: after.slice(0, 800) };
      console.log(`  ${verdict.ok ? '.' : 'x'} ${e.file}:${e.line} [${e.code}] ${verdict.ok ? 'proposal awaiting human triage' : verdict.reasons[0]}`);
    }
    appendFileSync(jpath, `${JSON.stringify(rec)}\n`);
  }
  const done = journal.size + accepted + rejected + realbug;
  console.log(`\nthis cycle: ${accepted} proposed - ${rejected} auto-rejected - ${realbug} real-bug routed`);
  console.log(`band: ${laneVerdict({ triaged: done, accepted }).reason}`);
  console.log('These are PROPOSALS. None is applied; a human reads each, and nothing lands without a green capture-host/check.sh.');
  console.log(`journal: ${jpath}`);
  return 0;
}

// -- CLI -----------------------------------------------------------------------------------------
async function main(argv) {
  const has = (f) => argv.includes(f);
  if (has('--selftest')) return selftest();
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
  if (has('--generate')) return generate(mine, n, has('--raw'));
  for (const e of mine.slice(0, n)) console.log(`  ${e.file}:${e.line}  [${e.code}]  ${e.message.slice(0, 80)}`);
  console.log('\n(this listing is the work queue; pass --generate to produce proposals.)');
  return 0;
}

process.exit(await main(process.argv.slice(2)));
