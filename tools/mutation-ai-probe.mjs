// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * mutation-ai-probe.mjs — ask the local model for an input that separates a survivor from the real
 * code, then CHECK whether it does by running both.
 *
 * ┌─ WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────┐
 * │ The fleet crawl leaves 5813 survivors for which NO distinguishing input is known. They are   │
 * │ not known-equivalent — `mutation-crawl.mjs`'s own header is careful about this: a survivor    │
 * │ the generic battery could not separate is "not distinguished by the generic battery", which  │
 * │ is a different statement from "equivalent". The battery is the limit, not the mutant.        │
 * │ Measured there: where a hand-built battery replaced the generic one, the same function went  │
 * │ from 0 to 17 killable.                                                                       │
 * │                                                                                              │
 * │ Hand-building a battery per function does not scale to 5813. Proposing inputs is exactly the │
 * │ regime the local model is good at — it is a guess, and a guess is free when something else   │
 * │ checks it.                                                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * THE SAFETY ARGUMENT IS THE SAME ONE `--draft` USES, AND IT IS THE ONLY REASON A MODEL CALIBRATED
 * 0/4 ON CODE CORRECTNESS MAY BE POINTED AT THIS. The model proposes an INPUT. It never says what
 * the code should do, never supplies an expected value, and is never believed: the input is run
 * against the real module and against the mutant, and only a MEASURED difference counts. A bad
 * proposal is not a wrong answer, it is a wasted millisecond.
 *
 * ⚠️ MODEL OUTPUT IS PARSED WITH `JSON.parse`, NEVER `eval`/`Function`. `--draft` needed a charset
 * allowlist because a projection is an expression that must be evaluated; here the model's entire
 * contribution is DATA, so it is parsed as data and the code-execution question never arises. If a
 * future edit reaches for `eval` to accept richer arguments, it is trading the whole safety argument
 * for convenience — build the value from JSON instead.
 *
 * ⚠️ A DIFFERENCE IS NOT AUTOMATICALLY A KILL. Two filters, both learned the hard way:
 *   - the real code THROWING is not a distinguishing input. `--draft` shipped one such draft: it
 *     asserted `detectPeriodicity([1,2,3])` throws a TypeError, which pins a crash as the contract
 *     and emits a test that cannot even run (the throw happens before the assertion). The crash was
 *     a wrong-TYPE input from the generic battery, not an OxyDex defect.
 *   - a difference only visible through a realm artefact is not a difference in the subject.
 *     `isRealmArtefact` is reused rather than re-derived.
 *
 * Usage:
 *   node tools/mutation-ai-probe.mjs --file oxydex-dsp.js [--limit N] [--per-mutant K]
 *   node tools/mutation-ai-probe.mjs --selftest
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, writeSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { loadRealm, isRealmArtefact } from './mutation-crawl.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const log = (s) => process.stderr.write(s + '\n');
const ROOT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();

const HOST = 'http://127.0.0.1:11434';
const MODEL = opt('--model', 'qwen3-coder:30b');
const VERBOSE = !argv.includes('--quiet');

/**
 * How many distinct sampling tiers a mutant may be asked at. Tier 0 is greedy (reproducible); every
 * tier above it perturbs the sampling so a re-ask can actually land somewhere else.
 */
export const SAMPLING_TIERS = 5;

/**
 * `--retry-none` — re-probe mutants a previous run answered NONE, starting ABOVE the tier it reached.
 *
 * Without this, "run it again to find more" is false: an answered mutant is skipped, and even if it
 * were re-probed, tier 0 is deterministic and returns the same proposals. With it, each successive
 * run is a genuinely new set of draws on exactly the mutants still unexplained — the sampling ladder
 * turned into an ACROSS-RUN search rather than a within-run retry.
 *
 * A KILL is never re-probed: it is already answered, and re-asking could only replace a known
 * distinguishing input with another one.
 */
const RETRY_NONE = argv.includes('--retry-none');

/**
 * How many sampling tiers ONE RUN may spend on ONE mutant.
 *
 * ⚠️ ESCALATING THE WHOLE LADDER INSIDE A SINGLE RUN IS A 30× THROUGHPUT REGRESSION, and I shipped
 * it that way. Five tiers means up to five ~1 s model calls per mutant, and measured on ECGDex the
 * rate fell from ~40/min to 1.3/min — an ETA of 506 minutes for one file. The ladder is meant to be
 * climbed ACROSS runs, not within one: a run spends a step or two, journals the tier it reached, and
 * the next `--retry-none` pass starts above it. That keeps a single pass fast enough to be worth
 * launching AND makes repeat passes productive, which is the whole point of having tiers at all.
 */
export const TIERS_PER_RUN = Number(opt('--tiers-per-run', '2'));

/**
 * ── THE SEED POOL ────────────────────────────────────────────────────────────────────────────────
 * Every input that has ever killed anything, tried on a NEW mutant BEFORE the model is asked.
 *
 * The economics force this. Measured on OxyDex: 943 model-proposed inputs bought 2 kills — roughly a
 * second of GPU per proposal, microseconds to RUN one. So an input already known to separate some
 * mutant is thousands of times cheaper to try than to invent, and mutants cluster: the same
 * adversarial shape (an out-of-range date, an empty array, a null option bag) breaks many guards.
 *
 * ⚠️ A POOL HIT IS EXACTLY AS TRUSTWORTHY AS A MODEL HIT AND FOR THE SAME REASON — neither is
 * believed. Both are run against real and mutant and kept only on a MEASURED difference. The pool
 * changes what gets TRIED, never what counts as a kill.
 *
 * bge-m3 orders the pool by similarity between the mutated line and the line each input was found
 * on, so the most relevant handful is tried rather than all of it. That is retrieval — matching
 * shapes — which is the one regime these local models are measured reliable in. If the embedding
 * model is unreachable the pool is still tried in insertion order: degraded ranking, never a
 * degraded verdict.
 *
 * ⚠️ MEASURED CONTRIBUTION SO FAR: **0 kills of 54 newly probed mutants** (OxyDex, pool of 10, all
 * embedded and ranked). The ranking worked; the PREMISE is what is weak. Argument SHAPES differ per
 * function — an input built for `_o2DateAnchorMs` (`[[20231301000000, null]]`) cannot mean anything
 * to `parseCSV`, which wants a string — so cross-function reuse mostly cannot fire. It is retained
 * because trying 24 recorded inputs costs microseconds against ~1 s for a model call, so the
 * expected value stays positive even at a low hit rate; it is NOT retained because it was shown to
 * work. Do not quote it as a win. The version with a real prior is a SAME-FUNCTION pool (an input
 * that killed one mutant in F tried on other mutants in F, where the signature matches by
 * construction), and that has not been measured yet.
 */
export function poolFrom(journalText) {
  const seen = new Set();
  const pool = [];
  for (const [, r] of doneKeys(journalText)) {
    if (r.v !== 'KILL' || !r.hit || !r.hit.input) continue;
    if (seen.has(r.hit.input)) continue;
    seen.add(r.hit.input);
    pool.push({ input: r.hit.input, context: String(r.hit.before || '').trim(), call: r.hit.callPath });
  }
  return pool;
}

/** Cosine ranking of pool entries against a target line. Ties keep insertion order. */
export function rankPool(pool, targetVec, poolVecs) {
  if (!targetVec || !poolVecs || poolVecs.length !== pool.length) return pool.map((p, i) => ({ ...p, i }));
  const dot = (a, b) => a.reduce((s2, v, i) => s2 + v * b[i], 0);
  const norm = (a) => Math.sqrt(dot(a, a)) || 1;
  return pool.map((p, i) => ({ ...p, i, sim: poolVecs[i] ? dot(targetVec, poolVecs[i]) / (norm(targetVec) * norm(poolVecs[i])) : -1 })).sort((a, b) => b.sim - a.sim || a.i - b.i);
}

/**
 * Which verdict a PROBED mutant earns for the journal. PURE, so `--selftest` pins it with no model
 * and no sandbox. (Distinct from `verdictFor` above, which decides whether two outputs differ; this
 * decides what we RECORD about a mutant we have finished probing.)
 *
 * 🔴 THE ORDER OF THESE THREE IS THE WHOLE FUNCTION, and it was wrong. `!lastN` was tested FIRST, so
 * a mutant killed by the SEED POOL — which sets `hit` but spends no sampling tier, leaving
 * `lastN === 0` — fell into NOPROPOSAL and was journalled as unanswered. Measured 2026-08-24: the
 * pool killed 1271 mutants in one nightly run and NOT ONE was recorded as a kill; the
 * `FROM POOL — no model call` line fired 0 times. Every run rediscovered the same kills and discarded
 * them, which is why the distill output came out byte-identical to the previous day's apart from the
 * date digit, and why "probe converged" was a claim about nothing. Amnesiac, not converged.
 *
 * The tell was already in the code: the KILL record writes `tier: poolHit ? 'pool' : tier`, a branch
 * existing ONLY to describe a pool hit — which the old guard made unreachable. A dead branch naming
 * the exact case it can never see is a bug carrying its own signature.
 *
 * A KILL is a KILL however it was found. Whether a tier was spent is a question about COST, not about
 * whether the mutant died.
 */
export function journalVerdict({ lastN, hit, poolHit, tier }) {
  if (hit) return { v: 'KILL', tier: poolHit ? 'pool' : tier };
  if (!lastN) return { v: 'NOPROPOSAL', tier };
  return { v: 'NONE', tier };
}

export function startTierFor(prev) {
  if (!prev) return 0;
  /* A STALE entry was never PROBED — the mutant could not even be built, so no sampling tier was
     spent on it. Resuming it above tier 0 would skip draws it never had. */
  if (prev.v === 'STALE') return 0;
  if (prev.v === 'KILL') return SAMPLING_TIERS; // answered; nothing to search for
  return Math.min(Number(prev.tier || 0), SAMPLING_TIERS - 1);
}
const CTX = Number(opt('--ctx', '2048')); // larger than --draft's: the prompt carries function source

/**
 * Parse the model's proposed inputs. Each line is a JSON ARRAY OF ARGUMENTS.
 *
 * Anything that is not a JSON array is dropped rather than repaired — a "fixed up" proposal is a
 * proposal nobody wrote, and there is no shortage of them. Returns [] rather than throwing: an
 * unusable reply is a wasted attempt, not an error.
 */
export function parseProposedInputs(text, max = 12) {
  const out = [];
  for (const raw of String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split('\n')) {
    const line = raw.trim().replace(/^[-*\d.)\s]+/, '');
    if (!line.startsWith('[')) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue; // not valid JSON ⇒ dropped, never repaired
    }
    if (!Array.isArray(v)) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A stable, comparable string for a call result — the same shape mutation-crawl records.
 *
 * ⚠️ PASS THE REALM `ctx` WHENEVER YOU HAVE ONE. Mutation testing MANUFACTURES infinite loops —
 * deleting the body of `while (t < prev) t += 86400000;` leaves `while (cond) ;` — and a bare
 * `fn.apply` from the host has no timeout and cannot be interrupted, so ONE such mutant wedges an
 * overnight run forever, and a resume then re-attempts the same mutant and wedges again: a crash
 * loop with no exit. The realm returned by `loadRealm` is a vm context, so the call can be made
 * through `vm.runInContext` with a hard timeout — the identical pattern `mutation-crawl.mjs` uses
 * for the identical reason. The bare path is kept only for the selftest's plain-object realms.
 */
const PROBE_TIMEOUT_MS = Number(opt('--probe-timeout-ms', '2000'));
export function resultString(fn, args, ctx = null) {
  try {
    let v;
    if (ctx && vm.isContext && vm.isContext(ctx)) {
      ctx.__probeFn = fn;
      ctx.__probeArgs = args;
      try {
        v = vm.runInContext('__probeFn.apply(null, __probeArgs)', ctx, { timeout: PROBE_TIMEOUT_MS });
      } finally {
        delete ctx.__probeFn;
        delete ctx.__probeArgs;
      }
    } else {
      v = fn.apply(null, args);
    }
    if (v === undefined) return 'undefined';
    try {
      return JSON.stringify(v);
    } catch {
      return '[unserialisable ' + typeof v + ']';
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    return /Script execution timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(msg) ? 'TIMEOUT:' + PROBE_TIMEOUT_MS + 'ms — did not terminate' : 'THREW:' + msg.slice(0, 120);
  }
}

/**
 * Decide whether a proposed input actually separates the two — and whether that separation is worth
 * anything. Pure over the two result strings so it can be tested without a realm.
 */
export function verdictFor(origStr, mutStr) {
  if (origStr === mutStr) return { kill: false, why: 'identical output' };
  if (/^THREW/.test(origStr)) return { kill: false, why: 'the REAL code throws on this input — a crash is not a contract, and the assertion would not even run' };
  /* Same rule for a hang: "the real code does not terminate on this input" is not assertable, so an
     input that wedges the ORIGINAL is not a distinguishing input — it is a finding about the probe. */
  if (/^TIMEOUT/.test(origStr)) return { kill: false, why: 'the REAL code does not terminate on this input — a hang is not an assertable contract' };
  /* Both-threw needs no branch: the orig-THREW guard above already returned, so reaching this line
     means the REAL code was clean. (There was a `both threw` test here; it was dead code — orig
     throwing returns two lines earlier, so its second conjunct could never be true.) */

  /* 🔴 A CRASH OR A HANG IN THE MUTANT IS DECISIVE, AND MUST BE DECIDED BEFORE THE SIZE GUARD.
     These two lines used to sit AFTER it, so a mutant that died loudly against a large-output
     function was refused with "output too large to record honestly" — an honesty rule about whether
     a VALUE can be recorded, consumed as evidence that NO DIFFERENCE EXISTS. The two are unrelated
     claims and the guard answered the wrong one.
     Measured 2026-08-24: every canary case for cpapdex/motiondex/ppgdex/oxydex hit it, because those
     are exactly the fixture functions returning whole synthetic datasets (`_synthEdfSet`,
     `genSyntheticACC`, `detectBeats`) — >100 KB of JSON. The canary then reported "the source moved
     since the crawl", a diagnosis that was fabricated: three of those four files had ZERO commits
     since their crawl. Four files were refused all night for a reason that was not true.
     The real code returned cleanly here (both guards above passed), so there is nothing unassertable
     about the finding: the assertion is "this input must not throw", and its expected value is the
     crash, not the 100 KB. */
  if (/^THREW/.test(mutStr)) return { kill: true, why: 'the mutant throws where the real code returns — decisive, and needs no recorded value' };
  if (/^TIMEOUT/.test(mutStr)) return { kill: true, why: 'the mutant does not terminate where the real code returns' };

  /* Two large outputs that genuinely DIFFER still stop here, deliberately and unchanged: a draft
     assertion has to record an expected value, and a 100 KB expectation is not reviewable. That is a
     real limit on what can be DRAFTED, and separating it from the crash case above is the whole
     point — this branch now refuses only what it can actually justify refusing. */
  if (origStr.length > 100000) return { kill: false, why: 'output too large to record honestly' };
  return { kill: true, why: 'measured difference' };
}

const outDirFor = () => join(ROOT, '.mutation-crawl');

function promptFor(fnName, fnSrc, before, after, op) {
  return (
    'Here is a JavaScript function and a single-line change made to it (a mutation).\n\n' +
    'FUNCTION ' +
    fnName +
    ':\n' +
    String(fnSrc).slice(0, 2200) +
    '\n\n' +
    'THE MUTATION (' +
    op +
    '):\n' +
    '  original: ' +
    before +
    '\n' +
    '  mutated:  ' +
    after +
    '\n\n' +
    'Propose concrete ARGUMENTS that would make the original and the mutated version return ' +
    'DIFFERENT values. Aim at the changed line: pick values that sit exactly on the boundary it tests.\n\n' +
    'Output ONLY lines, each a JSON array of the arguments, most promising first. No prose, no ' +
    'comments, no trailing text. Example for a two-argument function:\n' +
    '[[250,300,250],null]\n' +
    '[[],{"fs":130}]\n'
  );
}

/** bge-m3 embedding. Returns null on any failure — ranking degrades, verdicts never do. */
async function embed(text) {
  try {
    const res = await fetch(HOST + '/api/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', prompt: String(text).slice(0, 600) })
    });
    const j = await res.json();
    return Array.isArray(j.embedding) ? j.embedding : null;
  } catch {
    return null;
  }
}

async function ask(prompt, attempt = 0) {
  /* One entry per SAMPLING_TIERS. Tier 0 greedy and reproducible; the rest widen progressively so
     successive tiers explore instead of redrawing the same argmax. */
  const sampling = [
    { temperature: 0 },
    { temperature: 0.6, top_p: 0.8, top_k: 20 },
    { temperature: 0.9, top_p: 0.95, top_k: 40 },
    { temperature: 1.1, top_p: 0.97, top_k: 60 },
    { temperature: 1.3, top_p: 0.99, top_k: 80 }
  ];
  const res = await fetch(HOST + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, think: false, options: { num_ctx: CTX, num_predict: 300, ...sampling[Math.min(attempt, sampling.length - 1)] } })
  });
  const j = await res.json();
  return j.response || '';
}

/**
 * Apply a mutation AT ITS RECORDED LINE.
 *
 * ⚠️ `src.replace(before, after)` IS WRONG AND SILENTLY SO — it rewrites the FIRST occurrence in the
 * file, which is very often not the mutant's. `before` is routinely a common line (`T: 1`, a guard
 * clause, a bounds check), so the wrong site gets mutated, the subject under test is untouched, and
 * every probe against it reports "none separated". Caught by the positive control, which replayed
 * inputs the crawl had PROVED distinguishing and detected only 2 of 6: two came back "identical
 * output" against a crawl record that showed a clear difference, and one mutant would not even load.
 * Nothing else would have surfaced it — a probe that mutates the wrong line looks exactly like a
 * model that cannot guess, and it is the model that would have been blamed.
 *
 * Returns null when the recorded text is not on the recorded line, rather than falling back to a
 * whole-file replace: a fallback here re-introduces the bug in the one case that needs it most.
 */
export function mutateAtLine(src, line, before, after, window = 40) {
  const lines = src.split('\n');
  const b = String(before).trim();
  if (!b) return null;
  const i0 = Number(line) - 1;

  /* Exact hit on the recorded line — the common case, and the cheapest. */
  let idx = i0 >= 0 && i0 < lines.length && lines[i0].includes(b) ? i0 : -1;

  /* ⚠️ SOURCE DRIFTS, AND REFUSING ON DRIFT THREW AWAY 72 % OF THE CORPUS. The crawl records a line
     number; the file then gains a comment or a guard above it and every recorded line is off by a
     few. Measured on OxyDex: 800 of 1110 survivors reported STALE, and the sample showed line 1026
     now holding a COMMENT ABOUT the very statement that used to be there — the code had simply moved
     down. Exact-line matching turns an ordinary edit into a dead corpus.
     So: search a WINDOW around the recorded line, nearest first. This stays safe because it is the
     opposite of the original bug — a whole-file `replace` took the first match ANYWHERE, while this
     will not look past ±window lines, and REFUSES when the window holds more than one candidate,
     since "which of these two identical lines did the crawl mean" has no answer. Narrow drift is
     recovered; ambiguity is still refused. */
  if (idx < 0) {
    const hits = [];
    for (let d = 1; d <= window; d++) {
      for (const k of [i0 - d, i0 + d]) {
        if (k >= 0 && k < lines.length && lines[k].includes(b)) hits.push(k);
      }
      if (hits.length) break; // nearest distance wins; only ties at that distance are ambiguous
    }
    if (hits.length !== 1) return null;
    idx = hits[0];
  }

  const out = lines.slice();
  out[idx] = out[idx].replace(b, String(after).trim());
  return out.join('\n');
}

/** Extract a named function's source text, best-effort. Used only to inform the model. */
export function functionSource(src, name) {
  const re = new RegExp('(?:function\\s+' + name + '\\s*\\(|(?:const|var|let)\\s+' + name + '\\s*=\\s*function\\s*\\(|' + name + '\\s*[:=]\\s*function\\s*\\()');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0;
  for (let k = i; k < src.length && k < i + 20000; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, k + 1);
    }
  }
  return src.slice(m.index, i + 2000);
}

/**
 * Map a source LINE to its enclosing top-level function name. Built once per file.
 *
 * Line-based because that is what the journal key carries. A survivor whose line falls in no known
 * function gets no call handle and is skipped as UNREACHABLE — the same verdict `mutation-crawl`
 * reaches, and deliberately not a guess.
 */
export function functionIndex(src) {
  const lines = src.split('\n');
  const spans = [];
  const re = /^\s*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\()/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];
    let depth = 0,
      started = false,
      end = i;
    for (let k = i; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') depth--;
      }
      if (started && depth <= 0) {
        end = k;
        break;
      }
    }
    spans.push({ name, from: i + 1, to: end + 1 });
  }
  /* INNERMOST WINS: nested declarations produce overlapping spans, and the enclosing one is not the
     function the mutation is in. Sorting by width and taking the narrowest match is the whole fix. */
  spans.sort((a, b) => a.to - a.from - (b.to - b.from));
  return (line) => {
    for (const s2 of spans) if (line >= s2.from && line <= s2.to) return s2.name;
    return null;
  };
}

/**
 * THE JOURNAL KEY for one probed mutant: line + operator + original text — the same triple the sweep
 * journal uses, so a mutant is identified by WHAT IT CHANGES, not by its position in a list. A
 * list-position key silently re-probes everything the moment the ordering shifts.
 */
export function probeKey(m) {
  return [m.line, m.op, String(m.before || '').trim()].join(String.fromCharCode(0));
}

/**
 * Which mutants are already answered, read from the append-only journal.
 *
 * ⚠️ THIS EXISTS BECAUSE THE FIRST VERSION WROTE ITS RESULT ONLY AT THE END. It was verbose and it
 * was killable, and killing it destroyed everything: a run stopped at 109 of 1110 lost all 109
 * probes and the 3 hits among them — which could not even be INSPECTED while it ran, because
 * nothing was on disk. "Killable" without an incremental record is not killable; it is
 * restartable-from-zero, which is the opposite of what the word promises.
 */
export function doneKeys(journalText) {
  const done = new Map();
  for (const line of String(journalText || '').split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a torn last line from a kill is EXPECTED — skipped, never repaired
    }
    if (o && o.k) done.set(o.k, o);
  }
  return done;
}

/**
 * THE CANARY — replay inputs the crawl already PROVED distinguishing, and refuse to probe at all if
 * the harness fails to detect them.
 *
 * "0 newly killable" has two causes that are indistinguishable from outside: the model guessed
 * badly, or the harness cannot detect a difference at all. This is not hypothetical — it happened
 * here. `src.replace(before, after)` mutated the FIRST occurrence in the file instead of the
 * mutant's line, and 4 of 6 proven-killable inputs came back "identical output". Every zero in that
 * run would have been read as the model failing.
 *
 * A probe run whose canary does not fire is NOT a smaller result, it is NO result — the same rule
 * `mutate.mjs` applies to its own canary, for the same reason.
 */
export function canaryFor(known, src, realm, loadFn, getFn) {
  let checked = 0,
    detected = 0;
  const misses = [];
  for (const k of known) {
    let args;
    try {
      args = JSON.parse(k.input);
    } catch {
      continue;
    }
    if (!Array.isArray(args)) continue;
    const mutSrc = mutateAtLine(src, k.line, k.before, k.after);
    if (!mutSrc) continue;
    let mut;
    try {
      mut = loadFn(mutSrc);
    } catch {
      continue;
    }
    const target = k.callPath || k.call;
    const a = getFn(realm, target),
      b = getFn(mut, target);
    if (typeof a !== 'function' || typeof b !== 'function') continue;
    checked++;
    /* The realms double as vm contexts so the calls carry the hard timeout — a canary that can be
       wedged by the very hang-mutants it exists to detect would be worse than no canary. */
    if (verdictFor(resultString(a, args, realm), resultString(b, args, mut)).kill) detected++;
    else misses.push(target);
  }
  /* checked > 0 is load-bearing: a canary that examined NOTHING must never read as green. */
  return { checked, detected, misses, ok: checked > 0 && detected > 0 };
}

/**
 * SINGLE-INSTANCE GUARD, PER FILE.
 *
 * ⚠️ TWO PROBES RAN ON THE SAME FILE AND THE SAME JOURNAL AT ONCE, for over an hour, because every
 * `pkill -f "mutation-ai-probe --file"` I issued matched NOTHING: the real command line contains
 * `mutation-ai-probe.mjs --file`, so the pattern had a `.mjs` gap in it and quietly killed zero
 * processes while reporting success. That is this repo's signature defect — a check that ran,
 * examined nothing, and read as clean — and it let a stale process running OLD code keep appending
 * to a journal I was reading numbers off.
 *
 * A pid file makes the condition impossible to reach silently rather than relying on anyone getting
 * a pattern right. `staleLock` is pure so the decision is testable without spawning anything.
 */
export function staleLock(lockText, isAlive) {
  if (!lockText) return { take: true, why: 'no lock' };
  let o;
  try {
    o = JSON.parse(lockText);
  } catch {
    return { take: true, why: 'unreadable lock — treated as stale' };
  }
  if (!o || !o.pid) return { take: true, why: 'lock has no pid' };
  if (isAlive(o.pid)) return { take: false, pid: o.pid, why: 'another probe (pid ' + o.pid + ') is already running on this file' };
  return { take: true, why: 'lock held by pid ' + o.pid + ', which is gone — stale, reclaimed' };
}

function selftest() {
  let fail = 0,
    ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  ✓ ' : '  ✕ ') + n + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
    if (!ok) fail++;
  };

  console.log('mutation-ai-probe — the model proposes DATA; nothing it says is believed');
  ck('a JSON array line is accepted', parseProposedInputs('[[1,2],null]'), [[[1, 2], null]]);
  ck('…several, in order', parseProposedInputs('[1]\n[2]\n[3]').length, 3);
  ck('…list bullets are tolerated', parseProposedInputs('- [1]\n2. [2]').length, 2);
  ck('prose is dropped, not repaired', parseProposedInputs('Here are the inputs:\n[1]'), [[1]]);
  ck('a non-array JSON value is dropped', parseProposedInputs('{"a":1}\n[1]'), [[1]]);
  ck('malformed JSON is dropped, never fixed up', parseProposedInputs('[1,\n[2]'), [[2]]);
  ck('an empty reply yields nothing rather than throwing', parseProposedInputs(''), []);
  ck('<think> blocks are stripped', parseProposedInputs('<think>[9]</think>\n[1]'), [[1]]);
  ck('the cap is honoured', parseProposedInputs('[1]\n[2]\n[3]\n[4]', 2).length, 2);
  /* ⚠️ THE WHOLE SAFETY ARGUMENT: model output is DATA, parsed as data. A line that is code and not
     JSON must be dropped by the parser, not filtered afterwards. */
  ck('an expression is not JSON, so it never reaches execution', parseProposedInputs('[process.exit(1)]'), []);
  ck('…nor does a function literal', parseProposedInputs('[function(){}]'), []);

  console.log('\nverdictFor — a difference is not automatically a kill');
  ck('a measured difference is a kill', verdictFor('{"a":1}', '{"a":2}').kill, true);
  ck('identical output is not', verdictFor('{"a":1}', '{"a":1}').kill, false);
  /* `--draft` shipped exactly one draft asserting the real code throws; it pinned a crash as the
     contract and emitted a test that could not run. Refused here at the source. */
  ck('the REAL code throwing is NOT a distinguishing input', verdictFor('THREW:boom', 'null').kill, false);
  ck('…and says why, in terms that name the defect', /crash is not a contract/.test(verdictFor('THREW:x', 'null').why), true);
  ck('only the MUTANT throwing is a legitimate kill', verdictFor('null', 'THREW:boom').kill, true);
  ck('both throwing is not', verdictFor('THREW:a', 'THREW:b').kill, false);

  /* 🔴 The regression these pin: a crash in the MUTANT is decisive, and the size guard used to eat
     it. `origStr.length > 100000` is a rule about whether a VALUE can be RECORDED; it was answering
     "is there a difference at all", which is a different question. Four files were refused for a
     whole night on a fabricated "the source moved" diagnosis because of it — three of them had zero
     commits since their crawl. */
  const BIG = 'x'.repeat(150000);
  ck('a mutant that THROWS beats the size guard', verdictFor(BIG, 'THREW:t0 is not defined').kill, true);
  ck('…and says so in terms of the crash, not the size', /throws where the real code returns/.test(verdictFor(BIG, 'THREW:x').why), true);
  ck('a mutant that HANGS beats it too', verdictFor(BIG, 'TIMEOUT').kill, true);
  /* Negative twins — the fix must not switch the size guard off. */
  ck('two large DIFFERENT outputs still refuse (no reviewable expectation)', verdictFor(BIG, BIG + 'y').kill, false);
  ck('…for the size reason, explicitly', /too large/.test(verdictFor(BIG, BIG + 'y').why), true);
  ck('a large output identical to itself is still just identical', verdictFor(BIG, BIG).why, 'identical output');
  ck('the REAL code crashing still outranks a mutant crash', verdictFor('THREW:real', 'THREW:mut').kill, false);

  console.log('\nsingle-instance guard — two probes shared one journal for an hour');
  const alive = (pid) => pid === 1234;
  ck('no lock ⇒ take it', staleLock('', alive).take, true);
  ck('a LIVE holder blocks a second run on the same file', staleLock('{"pid":1234}', alive).take, false);
  ck('…and names the pid, so the fix is obvious', staleLock('{"pid":1234}', alive).pid, 1234);
  ck('a DEAD holder is reclaimed rather than blocking forever', staleLock('{"pid":9999}', alive).take, true);
  ck('an unreadable lock is treated as stale, not as a permanent block', staleLock('{oops', alive).take, true);

  console.log('\nseed pool + bge ranking — cheaper than asking, and no weaker a verdict');
  const jk = [
    '{"k":"a","v":"KILL","hit":{"input":"[1]","before":"if (x < 3)","callPath":"A.f"}}',
    '{"k":"b","v":"KILL","hit":{"input":"[1]","before":"if (y < 3)","callPath":"A.g"}}',
    '{"k":"c","v":"NONE"}'
  ].join('\n');
  ck('the pool is built from KILLS only', poolFrom(jk).length, 1);
  ck('…deduplicated by input, since the same input kills many mutants', poolFrom(jk).filter((p) => p.input === '[1]').length, 1);
  ck('a journal with no kills yields an empty pool, not a throw', poolFrom('{"k":"a","v":"NONE"}').length, 0);
  /* bge is an ORDERING, never a verdict: with no vectors the pool is still returned in full so the
     inputs are still tried. A ranking model that is down must not silently shrink what gets tested. */
  const pl = [
    { input: '[1]', context: 'a' },
    { input: '[2]', context: 'b' }
  ];
  ck(
    'no embeddings ⇒ full pool, insertion order (degraded ranking, not a degraded run)',
    rankPool(pl, null, null).map((p) => p.input),
    ['[1]', '[2]']
  );
  ck(
    '…a length mismatch is treated the same way rather than mis-pairing vectors',
    rankPool(pl, [1, 0], [[1, 0]]).map((p) => p.input),
    ['[1]', '[2]']
  );
  ck(
    'with embeddings, the nearer context is tried first',
    rankPool(
      pl,
      [1, 0],
      [
        [0, 1],
        [1, 0]
      ]
    ).map((p) => p.input),
    ['[2]', '[1]']
  );

  console.log('\nescalation — "run it again and find more" must be TRUE, not aspirational');
  ck('a never-probed mutant starts at tier 0', startTierFor(undefined), 0);
  ck('a KILL is never re-probed', startTierFor({ v: 'KILL', tier: 1 }) >= SAMPLING_TIERS, true);
  /* The point of the whole mechanism: a second run must start ABOVE where the first gave up, or it
     redraws the same deterministic proposals and finds nothing — which is what it did. */
  ck('a NONE resumes AT the tier it reached, so the next run draws differently', startTierFor({ v: 'NONE', tier: 2 }), 2);
  ck('the ladder is climbed ACROSS runs — one run spends a bounded number of tiers', TIERS_PER_RUN < SAMPLING_TIERS, true);
  ck('a STALE restarts at tier 0 — it was never probed, so no tier was spent', startTierFor({ v: 'STALE', tier: 3 }), 0);
  ck('…and a NONE that exhausted the ladder cannot loop forever', startTierFor({ v: 'NONE', tier: 99 }), SAMPLING_TIERS - 1);
  ck('there are as many sampling tiers as the ladder claims', SAMPLING_TIERS >= 3, true);

  console.log('\njournalVerdict — a KILL is a KILL however it was found');
  /* The regression this pins: a SEED-POOL kill sets `hit` but spends no tier, so `lastN` stays 0. The
     old guard tested `!lastN` first and journalled it NOPROPOSAL — 1271 kills discarded in one run
     (2026-08-24), with the `tier:'pool'` branch left unreachable. */
  ck('a POOL hit is a KILL, not a no-proposal', journalVerdict({ lastN: 0, hit: { input: 'x' }, poolHit: true, tier: 0 }).v, 'KILL');
  ck("…and it is journalled as tier 'pool', the branch the old order made dead", journalVerdict({ lastN: 0, hit: { input: 'x' }, poolHit: true, tier: 0 }).tier, 'pool');
  ck('a TIER hit is a KILL and keeps its numeric tier', journalVerdict({ lastN: 8, hit: { input: 'x' }, poolHit: false, tier: 2 }).tier, 2);
  /* The negative twin — the fix must not overcorrect and journal phantom kills. */
  ck('no hit and no draws is still NOPROPOSAL', journalVerdict({ lastN: 0, hit: null, poolHit: false, tier: 2 }).v, 'NOPROPOSAL');
  ck('draws that separated nothing is still NONE', journalVerdict({ lastN: 8, hit: null, poolHit: false, tier: 4 }).v, 'NONE');
  ck('NONE is never reported as a kill', journalVerdict({ lastN: 8, hit: null, poolHit: false, tier: 4 }).v === 'KILL', false);

  console.log('\njournal — killable must mean "stop without losing what you did"');
  ck('a key identifies WHAT changed, not a list position', probeKey({ line: 7, op: 'o', before: ' x ' }), probeKey({ line: 7, op: 'o', before: 'x' }));
  ck('…a different line is a different mutant', probeKey({ line: 7, op: 'o', before: 'x' }) === probeKey({ line: 8, op: 'o', before: 'x' }), false);
  const jt = '{"k":"a","v":"NONE"}\n{"k":"b","v":"KILL"}\n{"k":"c","v":"NON';
  ck('answered mutants are read back', doneKeys(jt).size, 2);
  ck('…a TORN last line from a kill is skipped, not repaired', doneKeys(jt).has('c'), false);
  ck('…and the verdict survives, so a resume does not re-probe a hit', doneKeys(jt).get('b').v, 'KILL');
  ck('an empty journal is an empty map, not a throw', doneKeys('').size, 0);

  console.log('\ncanary — a run that detects nothing is NO result, not a small one');
  const cSrc = 'function f(a) {\n  if (a < 3) return 1;\n  return 2;\n}';
  const mkRealm = (t) => {
    const o = {};
    new Function('exports', t + '; exports.f = f;')(o);
    return o;
  };
  const getf = (ctx) => ctx.f;
  const proven = [{ call: 'f', line: 2, before: 'if (a < 3) return 1;', after: 'if (a <= 3) return 1;', input: '[3]' }];
  ck('a proven-killable input IS detected', canaryFor(proven, cSrc, mkRealm(cSrc), mkRealm, getf).ok, true);

  /* 🔴 FIDELITY: the canary must replay THE RECORDED MUTATION, not merely *a* mutation.
     Measured 2026-08-24 — 165 KILLABLE records fleet-wide, **0** carrying `after`, so
     `mutateAtLine(src, line, before, after)` received `undefined` and `String(undefined).trim()`
     substituted the literal identifier: `if (a > 0)` was replayed as `if (undefined)`, an
     expression-nulling mutation nobody recorded, standing in for the `cmp > → >=` that was. It
     passed as a liveness check by accident, because nulling an expression usually also kills.
     `mutation-crawl.mjs` now persists `after`; these pin that a recorded op round-trips exactly,
     and that the identifier-substitution signature is recognisable when it does not. */
  const FID = 'function f(a) {\n  if (a > 0) return 1;\n  return 0;\n}';
  ck('a recorded op is replayed EXACTLY', mutateAtLine(FID, 2, 'a > 0', 'a >= 0').includes('if (a >= 0)'), true);
  ck('…and the original text is gone', /if \(a > 0\)/.test(mutateAtLine(FID, 2, 'a > 0', 'a >= 0')), false);
  /* The signature of the defect, kept as a named observation rather than a silent behaviour: an
     absent `after` yields the literal `undefined`. When the corpus carries `after` everywhere this
     becomes unreachable in practice, and the follow-up can turn it into a refusal. */
  ck('an ABSENT after substitutes the literal identifier — the defect signature', mutateAtLine(FID, 2, 'a > 0', undefined).includes('if (undefined)'), true);
  ck('…which is NOT the recorded operator, and that is the whole point', mutateAtLine(FID, 2, 'a > 0', undefined).includes('a >= 0'), false);
  /* ⚠️ THIS ASSERTION WAS REWRITTEN, NOT DELETED, WHEN WINDOW RECOVERY LANDED. It used to pass a
     line number off by one and require NO detection — a valid test of the old exact-line matcher,
     and meaningless once drift recovery was added, because an off-by-one is now correctly RECOVERED.
     The invariant that still matters is the one the original whole-file `replace` violated: a
     mutation whose text is nowhere findable must NOT be silently applied somewhere else. */
  const absent = [{ ...proven[0], before: 'if (zzz > 99) return 7;' }];
  ck('…a mutation whose text is nowhere findable is NOT applied elsewhere, so nothing is detected', canaryFor(absent, cSrc, mkRealm(cSrc), mkRealm, getf).ok, false);
  ck('no checkable case at all is NOT ok — an empty canary must never read as green', canaryFor([], cSrc, mkRealm(cSrc), mkRealm, getf).ok, false);

  console.log('\nmutateAtLine — the bug the positive control caught');
  const dup = 'var T = 1;\nfunction f() {\n  var T = 1;\n  return T;\n}';
  /* The SAME text on two lines: a whole-file replace hits line 1, the mutant is on line 3. */
  ck('mutates the RECORDED line, not the first match', mutateAtLine(dup, 3, 'var T = 1;', 'var T = 0;').split('\n')[2], '  var T = 0;');
  ck('…leaving the earlier identical line untouched', mutateAtLine(dup, 3, 'var T = 1;', 'var T = 0;').split('\n')[0], 'var T = 1;');
  /* Drift recovery: the recorded line is off by two because a comment was inserted above it. */
  const drifted = '// a comment added later\n// and another\nvar T = 1;\nfunction g() {}';
  ck('drift is RECOVERED by searching a window, not refused', mutateAtLine(drifted, 1, 'var T = 1;', 'var T = 0;').split('\n')[2], 'var T = 0;');
  ck('…but the window is bounded — a far-away match is NOT taken', mutateAtLine(drifted, 1, 'var T = 1;', 'var T = 0;', 1), null);
  /* Two identical candidates at the same distance: "which one did the crawl mean" has no answer. */
  const ambig = 'var T = 1;\n// middle\nvar T = 1;';
  ck('an ambiguous window REFUSES rather than guessing a side', mutateAtLine(ambig, 2, 'var T = 1;', 'var T = 0;'), null);
  ck('a line that does not carry the text falls back to the WINDOW, never to a whole-file replace', mutateAtLine(dup, 2, 'var T = 1;', 'var T = 0;', 0), null);
  ck('an out-of-range line is null', mutateAtLine(dup, 99, 'var T = 1;', 'var T = 0;'), null);

  console.log('\nfunctionIndex — a survivor with no call handle is skipped, never guessed');
  const idxSrc = 'function outer(a) {\n  function inner(b) {\n    return b;\n  }\n  return a;\n}\nvar loose = 1;';
  const at = functionIndex(idxSrc);
  ck('a line inside the nested function maps to the INNERMOST', at(3), 'inner');
  ck('…a line in the outer one maps to the outer', at(5), 'outer');
  ck('…and a line in no function is null, not a nearby guess', at(7), null);

  console.log('\nfunctionSource');
  const src = 'function foo(a) {\n  if (a < 3) return null;\n  return a;\n}\nfunction bar() {}';
  ck('extracts a declaration with balanced braces', /return a;/.test(functionSource(src, 'foo')), true);
  ck('…and stops at its own end', /function bar/.test(functionSource(src, 'foo')), false);
  ck('an absent function is null, not an empty string', functionSource(src, 'nope'), null);

  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

async function main() {
  const file = opt('--file', '');
  if (!file) return log('need --file <name>-dsp.js');
  const crawlDir = opt('--crawl-dir', join(ROOT, '.mutation-crawl'));
  const cp = join(crawlDir, basename(file) + '.crawl.json');
  if (!existsSync(cp)) return log('no crawl result at ' + cp + ' — this is a refusal, not an empty result');
  const srcPath = join(ROOT, file);
  if (!existsSync(srcPath)) return log('no source at ' + srcPath);
  const src = readFileSync(srcPath, 'utf8');
  const crawl = JSON.parse(readFileSync(cp, 'utf8'));

  /* ⚠️ SURVIVORS LIVE IN THE JOURNAL, NOT THE CRAWL JSON. The crawl records a `mutants` array only
     for findings it PROBED, and only the KILLABLE entries in it — so reading survivors from
     `crawl.findings[].mutants` finds nothing at all and the tool reports "no survivor to probe" for
     a file with 379 of them. That empty result reads exactly like success, which is the failure this
     repo keeps paying for; it is why this comment names the source explicitly. */
  const jp = join(opt('--journal-dir', join(ROOT, '.mutate-journal')), basename(file) + '.jsonl');
  if (!existsSync(jp)) return log('no journal at ' + jp + ' — survivors are recorded there, not in the crawl JSON (refusal, not an empty result)');
  const fnAt = functionIndex(src);
  const callFor = new Map();
  for (const fi of crawl.findings || []) if (fi.fn && fi.callPath) callFor.set(fi.fn, fi.callPath);

  const targets = [];
  for (const line of readFileSync(jp, 'utf8').split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.v !== 'SURVIVED' || !o.k) continue;
    const [ln, op, before, after] = String(o.k).split(String.fromCharCode(0));
    if (!before || !after) continue;
    const fn = fnAt(Number(ln));
    const call = fn && callFor.get(fn);
    if (!call) continue; // no handle to call it with — UNREACHABLE, same verdict the crawl gives
    targets.push({ fn, call, line: Number(ln), op, before, after });
  }
  const limit = Number(opt('--limit', '0')) || targets.length;
  const pick = targets.slice(0, limit);
  if (!pick.length) return log('no undistinguished survivor carries enough context to probe in ' + file);

  log('AI PROBE — ' + file);
  log('  ' + targets.length + ' undistinguished survivor(s); probing ' + pick.length + ' with ' + MODEL);
  log('  the model proposes INPUTS ONLY. Every one is RUN against real and mutant; nothing is believed.\n');

  const realm = loadRealm(src);
  const path0 = (ctx, call) =>
    String(call)
      .split('.')
      .reduce((o, k) => (o == null ? o : o[k]), ctx);

  /* ── CANARY FIRST, ALWAYS ────────────────────────────────────────────────────────────────────
     A probe run that cannot detect a KNOWN kill produces zeros indistinguishable from "the model
     could not guess" — and the model takes the blame for a broken harness. That is not a risk, it
     happened here: a whole-file `replace` mutated the wrong line and 4 of 6 proven-killable inputs
     read as "identical output". So the harness proves itself against the crawl's own proven cases
     before it is allowed to probe anything, and REFUSES rather than reporting an honest-looking 0. */
  const proven = [];
  for (const fi of crawl.findings || []) {
    for (const m of fi.mutants || []) {
      if (m.status === 'KILLABLE' && m.input) proven.push({ ...m, callPath: fi.callPath });
    }
  }
  const can = canaryFor(proven.slice(0, 12), src, realm, loadRealm, path0);
  if (!can.ok) {
    log('⛔ CANARY DID NOT FIRE — ' + can.detected + ' of ' + can.checked + ' proven-killable inputs detected.');
    log('   Every "none separated" this run would produce is meaningless, so it produces none.');
    log('   Usual cause: the source moved since the crawl, so recorded lines no longer address this code.');
    if (can.misses.length) log('   missed: ' + can.misses.slice(0, 6).join(', '));
    process.exit(2);
  }
  log('  canary ✓ ' + can.detected + '/' + can.checked + ' proven-killable inputs detected — the harness can see a kill');

  /* ── RESUME: append-only journal, flushed per mutant, so a kill costs at most one probe. ── */
  const jOut = join(outDirFor(), basename(file) + '.ai-probe.jsonl');
  mkdirSync(dirname(jOut), { recursive: true });
  const done = existsSync(jOut) ? doneKeys(readFileSync(jOut, 'utf8')) : new Map();
  if (done.size) log('  resuming — ' + done.size + ' mutant(s) already answered; they are skipped');
  const lockPath = jOut + '.lock';
  const lk = staleLock(existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '', (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  if (!lk.take) {
    log('⛔ ' + lk.why + ' — refusing. Two probes appending to one journal produce numbers neither of them earned.');
    log('   Stop it first:  kill ' + lk.pid + '   (note the command line contains "mutation-ai-probe.mjs", so a pattern without .mjs matches nothing)');
    process.exit(3);
  }
  if (!/no lock/.test(lk.why)) log('  ' + lk.why);
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, file, startedAt: new Date().toISOString() }) + '\n');
  const dropLock = () => {
    try {
      if (existsSync(lockPath) && JSON.parse(readFileSync(lockPath, 'utf8')).pid === process.pid) unlinkSync(lockPath);
    } catch {
      /* releasing a lock must never be the thing that fails a run */
    }
  };
  process.on('exit', dropLock);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

  const jfd = openSync(jOut, 'a');
  const record = (k, v, extra) => writeSync(jfd, JSON.stringify({ k, v, ...(extra || {}) }) + '\n');
  log('  journal ' + jOut + '\n');

  /* ── HEARTBEAT ──────────────────────────────────────────────────────────────────────────────
     A per-mutant line is NOT a heartbeat: a wedged model call, a dead socket or a mutant spinning in
     a manufactured infinite loop produces SILENCE — and silence is precisely when someone needs to
     know whether the run is alive. This ticks on a timer independent of progress, so a stall is
     visible AS a stall, with how long the current mutant has been running, rather than as output
     that simply stops. It only speaks when a mutant has outlived one interval, so a healthy run is
     not made noisier. `unref()` so it can never hold the process open past the work. */
  let hb = { at: Date.now(), what: 'starting', i: 0 };
  const HB_MS = Number(opt('--heartbeat', '15000'));
  const beat = setInterval(() => {
    const stuckS = Math.round((Date.now() - hb.at) / 1000);
    if (stuckS * 1000 < HB_MS) return;
    log('    ♥ alive — ' + stuckS + 's on [' + hb.i + '/' + pick.length + '] ' + hb.what + (stuckS > 120 ? '   ⚠ long; the model or this mutant may be wedged' : ''));
  }, HB_MS);
  beat.unref();

  /* Seeded from this file's own journal; grows as the run finds more. */
  const POOL_TRY = Number(opt('--pool-try', '24'));
  const pool = existsSync(jOut) ? poolFrom(readFileSync(jOut, 'utf8')) : [];
  const poolVecs = [];
  if (pool.length) {
    for (const p of pool) poolVecs.push(await embed(p.context));
    const ranked = poolVecs.filter(Boolean).length;
    log('  seed pool: ' + pool.length + ' known-killing input(s), ' + (ranked ? ranked + ' embedded for bge-m3 ranking' : 'NOT embedded — bge unreachable, trying in insertion order'));
  }
  let poolKills = 0;

  const t0 = Date.now();
  const found = [];
  for (const [, r0] of done) if (r0.v === 'KILL' && r0.hit) found.push(r0.hit);
  let tried = 0,
    noProposal = 0,
    skipped = 0;

  for (let i = 0; i < pick.length; i++) {
    const t = pick[i];
    const key = probeKey(t);
    const prev = done.get(key);
    if (prev && !(RETRY_NONE && (prev.v === 'NONE' || prev.v === 'NOPROPOSAL' || prev.v === 'STALE') && Number(prev.tier || 0) < SAMPLING_TIERS)) {
      skipped++;
      continue;
    }
    const fnSrc = functionSource(src, t.fn) || t.before;
    const el = (Date.now() - t0) / 1000;
    const rate = (i + 1) / (el / 60);
    if (VERBOSE && i > 0 && i % 25 === 0) {
      const seen = i + 1 - skipped;
      log(
        '  ── ' +
          (i + 1) +
          '/' +
          pick.length +
          '  kills ' +
          found.length +
          '  inputs run ' +
          tried +
          '  no-proposal ' +
          noProposal +
          '  yield ' +
          (seen ? ((100 * found.length) / seen).toFixed(1) : '0') +
          '%  elapsed ' +
          Math.round((Date.now() - t0) / 60000) +
          'm ──'
      );
    }
    const prog =
      '[' + String(i + 1).padStart(4) + '/' + pick.length + '  ' + rate.toFixed(1) + '/min  ETA ' + Math.round((pick.length - i - 1) / Math.max(rate, 0.01)) + 'm  found ' + found.length + ']';

    /* CRASH-LOOP BELT: record the ATTEMPT before executing anything. The vm timeout stops ordinary
       infinite loops, but a mutant that OOMs or hard-crashes the process leaves no verdict — and a
       journal with no verdict would re-attempt the same mutant on every resume, forever. A dangling
       TRYING (never superseded by a real verdict) means "this mutant took the process down"; the
       resume skip treats it as answered, `--status` counts it, and an overnight loop converges past
       it instead of dying on it every pass. */
    record(key, 'TRYING');

    /* Build the mutant BEFORE asking. Every reason to skip this mutant — stale line, will not load,
       no call handle — is knowable without spending a single model call, and spending one anyway is
       how a probe run burns an hour on mutants it was never going to be able to test. */
    const mutSrc = mutateAtLine(src, t.line, t.before, t.after);
    if (!mutSrc) {
      record(key, 'STALE');
      log(prog + ' — ' + t.call + '  recorded text is not on line ' + t.line + ' (source moved) — skipped, NOT whole-file replaced');
      continue;
    }
    let mutRealm;
    try {
      mutRealm = loadRealm(mutSrc);
    } catch {
      record(key, 'NOLOAD');
      log(prog + ' — ' + t.call + '  mutant does not load');
      continue;
    }
    const fnA = path0(realm, t.call);
    const fnB = path0(mutRealm, t.call);
    if (typeof fnA !== 'function' || typeof fnB !== 'function') {
      record(key, 'UNREACHABLE');
      log(prog + ' — ' + t.call + '  not reachable as a function');
      continue;
    }
    const runInputs = (ins) => {
      for (const args of ins) {
        tried++;
        /* Realm contexts carry the vm timeout — see resultString. A model-proposed input reaching a
           mutant-manufactured infinite loop is the EXPECTED collision here, not an edge case. */
        const a = resultString(fnA, args, realm);
        const b = resultString(fnB, args, mutRealm);
        if (!verdictFor(a, b).kill) continue;
        if (isRealmArtefact && isRealmArtefact(a, b, () => true) === true) continue;
        return { input: JSON.stringify(args), orig: a.slice(0, 2000), mutant: b.slice(0, 2000) };
      }
      return null;
    };

    /* THE POOL FIRST — microseconds, and it costs the model nothing. */
    let hit = null;
    let poolHit = false;
    if (pool.length) {
      hb = { at: Date.now(), what: 'trying ' + Math.min(pool.length, POOL_TRY) + ' known-killing input(s) on ' + t.call, i: i + 1 };
      const tv = poolVecs.length ? await embed(String(t.before).trim()) : null;
      const ordered = rankPool(pool, tv, poolVecs).slice(0, POOL_TRY);
      hit = runInputs(
        ordered
          .map((p) => {
            try {
              return JSON.parse(p.input);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      );
      if (hit) {
        poolHit = true;
        poolKills++;
      }
    }

    /* ⚠️ ESCALATE UNTIL A KILL, NOT UNTIL A PARSE — this is why re-running can find more.
       The first version re-asked ONLY when zero proposals parsed, so a mutant whose 8 proposals all
       parsed and none separated got exactly ONE draw, at temperature 0. Temperature 0 is
       deterministic, so re-running the tool returned byte-identical proposals and found nothing new,
       ever. "Run it again to find more" was false BY CONSTRUCTION. That is not a tuning shortfall:
       the sampling ladder existed and was reachable only by the one failure mode that could not use
       it. Now each tier re-asks with different sampling, and a tier counts as spent only once its
       inputs have actually been RUN. The tier reached is journalled, so a later run with
       --retry-none starts ABOVE it rather than repeating the same draws. */
    let tier = startTierFor(prev);
    let lastN = 0;
    const tierStop = Math.min(SAMPLING_TIERS, tier + TIERS_PER_RUN);
    for (; tier < tierStop && !hit; tier++) {
      hb = { at: Date.now(), what: 'asking [tier ' + tier + '] about ' + t.call + ' [' + t.op + ']', i: i + 1 };
      let inputs = [];
      try {
        inputs = parseProposedInputs(await ask(promptFor(t.fn, fnSrc, t.before, t.after, t.op), tier), Number(opt('--per-mutant', '8')));
      } catch {
        log('✗ local model unreachable at ' + HOST + ' — stopping (a refusal, not an empty result)');
        break;
      }
      if (!inputs.length) continue;
      lastN += inputs.length;
      hb = { at: Date.now(), what: 'running ' + inputs.length + ' input(s) [tier ' + tier + '] against ' + t.call, i: i + 1 };
      hit = runInputs(inputs);
      if (!hit && VERBOSE) for (const a2 of inputs.slice(0, 2)) log('          tier ' + tier + ' tried ' + JSON.stringify(a2).slice(0, 86));
    }

    const jv = journalVerdict({ lastN, hit, poolHit, tier });
    if (jv.v === 'NOPROPOSAL') {
      noProposal++;
      record(key, 'NOPROPOSAL', { tier: tier });
      log(prog + ' — ' + t.call + ' [' + t.op + ']  no parseable proposal in ' + tier + ' tier(s)');
      continue;
    }
    if (jv.v === 'NONE') {
      record(key, 'NONE', { n: lastN, tier: tier });
      log(
        prog +
          ' — ' +
          t.call +
          ' [' +
          t.op +
          ']  ' +
          lastN +
          ' input(s), none separated' +
          (tier < SAMPLING_TIERS ? '  (tier ' + tier + '/' + SAMPLING_TIERS + ' — a --retry-none pass resumes above this)' : '  (ladder exhausted)')
      );
      continue;
    }
    const rec = { fn: t.fn, callPath: t.call, line: t.line, op: t.op, before: t.before, after: t.after, status: 'KILLABLE', ...hit };
    record(key, 'KILL', { hit: rec, tier: jv.tier });
    found.push(rec);
    if (!pool.some((p) => p.input === rec.input)) {
      pool.push({ input: rec.input, context: String(rec.before || '').trim(), call: rec.callPath });
      poolVecs.push(await embed(String(rec.before).trim()));
    }
    log(prog + ' ✓ ' + t.call + ' [' + t.op + ']  NOW KILLABLE  (line ' + t.line + ', ' + (poolHit ? 'FROM POOL — no model call' : 'tier ' + tier) + ')');
    log('        was: ' + String(t.before).trim().slice(0, 86));
    log('        now: ' + String(t.after).trim().slice(0, 86));
    log('        input ' + hit.input.slice(0, 70));
    log('        real=' + hit.orig.slice(0, 46) + '   mutant=' + hit.mutant.slice(0, 46));
  }

  const outDir = outDirFor();
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, basename(file) + '.ai-probe.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        file,
        generatedAt: new Date().toISOString(),
        model: MODEL,
        probed: pick.length,
        inputsRun: tried,
        noProposal,
        newlyKillable: found.length,
        findings: [{ fn: 'ai-probe', callPath: file, status: 'PROBED', battery: 'ai', mutants: found }]
      },
      null,
      1
    )
  );
  clearInterval(beat);
  const mins = (Date.now() - t0) / 60000;
  log(
    '\n  ' +
      found.length +
      ' newly KILLABLE of ' +
      pick.length +
      ' (' +
      skipped +
      ' already answered, ' +
      tried +
      ' inputs run, ' +
      noProposal +
      ' with no parseable proposal) in ' +
      mins.toFixed(1) +
      ' min'
  );
  log('  ' + poolKills + ' of those came FROM THE SEED POOL with no model call at all');
  log('  journal: ' + jOut + '  — kill this at ANY time and re-run to resume from here');
  // The exact command, not a template. As `--draft --crawl-dir <dir>` this was wrong twice over:
  // `--crawl-dir` was absent from mutation-suite's CLI_FLAGS so the whole line was refused, and
  // `--draft` takes one argument, so the flag would have been swallowed AS the filename even once
  // accepted. Printing the real values makes it copy-pasteable and makes any future drift show up
  // the first time somebody follows the advice.
  log('  → ' + outPath + '   (feed to: node tools/mutation-suite.mjs --draft ' + file + ' --crawl-dir ' + crawlDir + ')');
}

/**
 * `--status`: read the journals and report, WITHOUT touching a running probe.
 *
 * Progress must be readable from the artefact, not from the process. Asking a running job how it is
 * doing is how you end up killing it to find out — and the previous version of this tool had exactly
 * that property: its only output arrived at the end, so a run in flight was unobservable.
 */
function cmdStatus() {
  const dir = outDirFor();
  if (!existsSync(dir)) return log('no probe journals yet at ' + dir);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ai-probe.jsonl'));
  if (!files.length) return log('no probe journals yet in ' + dir);
  let tot = 0,
    kills = 0;
  log('AI PROBE STATUS');
  for (const f of files.sort()) {
    const jp = join(dir, f);
    const done = doneKeys(readFileSync(jp, 'utf8'));
    const by = {};
    for (const [, r] of done) by[r.v] = (by[r.v] || 0) + 1;
    const k = by.KILL || 0;
    tot += done.size;
    kills += k;
    const age = Math.round((Date.now() - statSync(jp).mtimeMs) / 1000);
    log(
      '  ' +
        f.replace('.ai-probe.jsonl', '').padEnd(20) +
        String(done.size).padStart(6) +
        ' answered  ' +
        String(k).padStart(4) +
        ' kills  ' +
        (done.size ? ((100 * k) / done.size).toFixed(1) : '0').padStart(5) +
        '%  last write ' +
        (age < 90 ? age + 's ago  ← ACTIVE' : age < 3600 ? Math.round(age / 60) + 'm ago' : Math.round(age / 3600) + 'h ago')
    );
    log(
      '      ' +
        Object.entries(by)
          .map(([a, b]) => a + '=' + b)
          .sort()
          .join('  ')
    );
  }
  log('  ' + '─'.repeat(60));
  log('  TOTAL ' + tot + ' answered, ' + kills + ' newly killable (' + (tot ? ((100 * kills) / tot).toFixed(1) : '0') + '%)');
  log('  A journal that is not being written is a run that is not going — check for a process before assuming it finished.');
}

const INVOKED_DIRECTLY = (() => {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url).endsWith(basename(process.argv[1]));
  } catch {
    return false;
  }
})();
if (INVOKED_DIRECTLY) {
  if (has('--selftest')) process.exit(selftest());
  else if (has('--status')) cmdStatus();
  else await main();
}
