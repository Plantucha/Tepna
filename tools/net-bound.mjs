#!/usr/bin/env node
/*
 * tools/net-bound.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * BOUND EVERY NETWORK WAIT A TOOL MAKES, so a stalled endpoint names itself instead of hanging. One
 * `boundedFetch` for every `fetch` in `tools/`, one pre-stated bound per class of endpoint, and one
 * reason text per breach.
 *
 * WHY THIS EXISTS. `tools/doc-search.mjs` documented a soft failure — an unreachable embedder degrades
 * to a token search — and both of its call sites honoured it with a `catch`. A `catch` needs a throw.
 * `fetch` rejects at once only when the endpoint REFUSES the connection, so an endpoint that ACCEPTS
 * the connection and answers nothing left the await unsettled and the tool hung. Measured 2026-11-15:
 * two runs printed nothing and ended at the operator's own 40 s and 60 s timeouts. #5045 bounded that
 * one embed. `git grep` then named the class: 15 tools under `tools/` call `fetch`, and 14 of them held
 * no bound of any kind.
 *
 * 🔴 THE SAME FILE CAN BOUND ITS SUBPROCESSES AND NOT ITS SOCKETS. `tools/update-watch.mjs` caps every
 * `execFileSync` reader it has (20 s, and 60 s for the slower lookups) and left both of its `fetch`
 * calls unbounded. So the omission is not a view about how long a wait should be. It is that a
 * subprocess has an obvious timeout argument and `fetch` does not.
 *
 * ⚠️ A DEADLINE CANNOT TELL DEAD FROM SLOW (CLAUDE.md §4c). This module bounds the WAIT. It diagnoses
 * no endpoint, it retries nothing, and a breach is reported as a breach of THIS bound rather than as a
 * statement about the far side.
 *
 * THE TWO CLASSES, pre-stated, with what each one clears:
 *
 *   `model` — 600 s. A local model call (`/api/generate`, `/api/chat`, `/api/embed`, `/api/embeddings`,
 *     `/v1/chat/completions`). On 2026-11-15 a starving ROCm backend answered one single-text embed in
 *     60 s, against 3.8 s on a healthy GPU and 1.96 s over Vulkan. A generate with a real prompt is
 *     longer than an embed, so this bound sits ten times the slowest embed this repo has recorded. It
 *     aborts no model call any measurement here describes.
 *   `api` — 30 s. A plain HTTP lookup (`/api/tags`, a registry manifest, an Elasticsearch `_search`, a
 *     Zotero page). `update-watch` already treats 20 s as normal for one such lookup and 60 s for the
 *     slowest, so 30 s sits inside the band that file's own code states.
 *
 * EVERY ONE OF THOSE NUMBERS IS THEN CAPPED TO WHAT THE HTTP CLIENT ALLOWS — 295 s, being its own
 * measured 300 s header bound less a 5 s margin. So the `model` class asks 600 s and keeps 295 s,
 * because a bound past the client's cannot fire and the caller reads the client's opaque text
 * instead of ours. The constant below carries the measurement.
 *
 * A caller that needs a different number passes `ms`, and it states its reason at the call site. The
 * environment overrides both: `DEX_NET_TIMEOUT_MS` for every class at once, `DEX_NET_MODEL_TIMEOUT_MS`
 * and `DEX_NET_API_TIMEOUT_MS` per class. `DEX_NET_CLIENT_TIMEOUT_MS` moves the cap, and a declared 0
 * removes it.
 *
 * 🔴 NEVER `AbortSignal.timeout()`. THAT HELPER'S TIMER IS UNREF'D, so it cannot fire in a realm whose
 * only pending work is the request — which is exactly a selftest against an injected fetch. Measured
 * 2026-11-15 in `doc-search.mjs`: the leg left the await unsettled, and Node printed `Detected
 * unsettled top-level await` and left. An unref'd timer still fires while a real socket holds the loop
 * open, so a live run is unaffected and a test realm is not, which is the worst shape a guard can have.
 * `boundedFetch` uses an explicit `AbortController` with a ref'd timer cleared in `finally`.
 *
 * Usage:
 *   import { boundedFetch, netTimeoutMs, netFailureReason } from './net-bound.mjs';
 *   const res = await boundedFetch(`${OLLAMA}/api/generate`, { method: 'POST', body }, { cls: 'model', label: 'ollama generate' });
 *   node tools/net-bound.mjs --selftest
 * THE WRITE READING (§3 of `WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md`). This module writes no file and
 * spawns no process. It opens a socket the caller names, and `--selftest` opens none at all: every leg
 * injects its own `fetchImpl`.
 */

import { isCliEntry } from './argv-guard.mjs';

/* The pre-stated bounds. The header states what each one clears; a change here is a change of
   criterion and belongs in that paragraph too. */
export const NET_CLASS_MS = { model: 600_000, api: 30_000 };

/* 🔴 THE HTTP CLIENT HOLDS A BOUND OF ITS OWN, AND THE `model` CLASS SITS TWICE PAST IT.
   Node's `fetch` abandons a request whose headers do not arrive within 300 s and throws
   `TypeError: fetch failed` with `cause.code = UND_ERR_HEADERS_TIMEOUT`. Measured 2026-11-22: one
   2-input embed sent with no signal of our own threw at 300.8 s with exactly that cause. So a
   600 s bound cannot fire. The client cuts the socket at 300 s, the abort below never runs, and
   the caller reads the client's opaque wrapper text instead of the reason this module exists to
   give it. Measured the same day on the 15-minute index lane: 31 of 31 ticks logged
   `EMBEDDER DOWN (fetch failed), token fallback`, and not one named a cause.
   The client ships no way to move that bound from here 🠒 `undici` is not importable in this tree 🠒
   so the only honest answer is to stop promising more than it allows. Every class bound is capped
   just below it, so OUR abort lands first and names itself.
   ONE MEASURED LIMIT ON THE CLAIM: a local server that accepts a request and never READS it did
   not start that timer at all (no throw in 12 minutes, 2026-11-22). The bound applies to a server
   that took the request and then went quiet, which is the stall this module is for. A reader whose
   client holds another bound declares it in `DEX_NET_CLIENT_TIMEOUT_MS`, and a declared 0 keeps
   every class bound whole. */
export const CLIENT_HEADERS_TIMEOUT_MS = 300_000;
/* Our abort must land FIRST, or the reason is the client's and names nothing we chose. */
export const CLIENT_BOUND_MARGIN_MS = 5_000;
const CLIENT_ENV = 'DEX_NET_CLIENT_TIMEOUT_MS';

const CLASS_ENV = { model: 'DEX_NET_MODEL_TIMEOUT_MS', api: 'DEX_NET_API_TIMEOUT_MS' };
const GLOBAL_ENV = 'DEX_NET_TIMEOUT_MS';

/* A positive finite number, or null. An env var holding `''`, `abc` or `0` must not become a bound:
   `Number('')` is 0, which would abort every request before it opened. So the reader refuses rather
   than coerces, and the next term in the precedence decides. */
function posMs(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The client's own bound, or `null` when a reader declares there is none. A declared 0 means NONE
 * here, which is why this reader cannot be `posMs`: that helper refuses a 0 so an unusable env var
 * cannot become a 0 ms bound, and here a 0 carries a meaning of its own.
 */
export function clientBoundMs(env = process.env) {
  const raw = env[CLIENT_ENV];
  if (raw == null || raw === '') return CLIENT_HEADERS_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return CLIENT_HEADERS_TIMEOUT_MS;
  return n === 0 ? null : n;
}

/** A bound the client can keep: the one asked for, or the client's own less the margin. */
export function capToClient(ms, env = process.env) {
  const client = clientBoundMs(env);
  if (client == null) return ms;
  return Math.min(ms, Math.max(1, client - CLIENT_BOUND_MARGIN_MS));
}

/**
 * The bound asked for by one call, in ms, BEFORE the client's own limit applies. Precedence,
 * highest first: `DEX_NET_TIMEOUT_MS` (every class at once), the class env var, the caller's own
 * `ms`, the class default. An unknown class is `api`, because the tighter of the two bounds is the
 * safer default for a wait nobody classified.
 */
export function netStatedMs({ cls = 'api', ms = null, env = process.env } = {}) {
  const known = Object.hasOwn(NET_CLASS_MS, cls) ? cls : 'api';
  return posMs(env[GLOBAL_ENV]) ?? posMs(env[CLASS_ENV[known]]) ?? posMs(ms) ?? NET_CLASS_MS[known];
}

/** The bound this module can KEEP: the stated one, capped to what the client allows. */
export function netTimeoutMs({ cls = 'api', ms = null, env = process.env } = {}) {
  return capToClient(netStatedMs({ cls, ms, env }), env);
}

/**
 * Names the limiter, and only when the CLIENT is the one that bound the wait. A caller that passes
 * a smaller `ms` chose that wait itself, and a note blaming the client there names the wrong
 * limiter \u2014 the borrowed reason this module forbids.
 */
export function netBoundNote({ cls = 'api', ms = null, env = process.env } = {}) {
  const stated = netStatedMs({ cls, ms, env });
  const kept = capToClient(stated, env);
  if (!(kept < stated)) return '';
  return ` (the HTTP client waits no longer, and this call asked for ${stated} ms)`;
}

/**
 * One reason text for a failed request. §∅: a named reason, never a borrowed one — a stall is not a
 * refusal, and the two send a reader to different boxes.
 */
export function netFailureReason(err, endpoint = 'the endpoint') {
  const name = err?.name || '';
  /* The message ALONE when the throw carries one, because `String(new Error(''))` reads `Error` — the
     CLASS of the failure, which names nothing a reader can act on. A thrown string has no `message`,
     so it falls through to its own text. */
  const msg = typeof err?.message === 'string' ? err.message : String(err ?? '');
  if (msg.includes('did not answer within')) return msg;
  if (name === 'TimeoutError' || name === 'AbortError') return `${endpoint} did not answer in time`;
  const code = err?.cause?.code || '';
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) return `${endpoint} refused the connection`;
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) return `${endpoint} does not resolve`;
  if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) return `${endpoint} closed the connection`;
  /* 🔴 THE WRAPPER TEXT OF A FETCH FAILURE NAMES NOTHING, AND ITS CAUSE NAMES EVERYTHING.
     `fetch` reports every failure the branches above do not cover as one opaque `fetch failed` and
     parks the real reason on `err.cause`. Measured 2026-11-22: the index lane's own banner read
     `fetch failed` for 31 of 31 ticks over 9 h 17 min, while the cause said
     `UND_ERR_HEADERS_TIMEOUT` \u2014 a bound, not an unreachable host, and the chase went to the
     backends before it came here. Falling through to `msg` names the CLASS of the failure, which
     this function's own banner rule already forbids one line below. So the code travels, and the
     cause message travels when there is no code. */
  const detail = code || (typeof err?.cause?.message === 'string' ? err.cause.message : '');
  if (detail && detail !== msg) return `${endpoint} ${msg || 'failed'} (${detail})`;
  return msg || 'the request failed with no message';
}

/**
 * `fetch` under a bound. Returns the Response. On a breach it throws one Error whose message names
 * the label, the bound and the class, so a caller's existing `catch` reports a stall as a stall.
 */
export async function boundedFetch(url, init = {}, { cls = 'api', ms = null, label = null, env = process.env, fetchImpl = fetch } = {}) {
  const timeoutMs = netTimeoutMs({ cls, ms, env });
  const note = netBoundNote({ cls, ms, env });
  const who = label || String(url).split('?')[0];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${who} did not answer within ${timeoutMs} ms (bound class ${cls})${note}`)), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ac.signal });
  } catch (e) {
    /* The BREACH decides, never the shape of what fetch threw: an abort surfaces as a DOMException on
       one runtime and as the reason itself on another, and both must read as this bound. */
    if (ac.signal.aborted) throw ac.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const IS_MAIN = (() => {
  try {
    return isCliEntry(import.meta.url);
  } catch {
    return false;
  }
})();

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, what) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${what}`);
    } else {
      fail++;
      console.log(`  ✗ ${what}`);
    }
  };

  /* ── the bound ─────────────────────────────────────────────────────────────────────────────── */
  /* 🔴 THE CLASS BOUND AND THE BOUND THAT IS KEPT ARE TWO NUMBERS. The model class asks 600 s;
     the client allows 300 s, so 295 s is what any abort here can use. A leg asserting 600 s on the
     KEPT bound asserted a number no request ever ran under. */
  ok(netStatedMs({ cls: 'model', env: {} }) === 600_000, 'the model class still ASKS for 600 s');
  ok(netTimeoutMs({ cls: 'model', env: {} }) === 295_000, '…and keeps 295 s, because the client cuts at 300 s');
  ok(netBoundNote({ cls: 'model', env: {} }).includes('asked for 600000 ms'), '…and the breach text names the client as the limiter');
  ok(netBoundNote({ cls: 'api', env: {} }) === '', 'an api call is inside the client bound, so nothing is named');
  ok(netBoundNote({ cls: 'model', ms: 20, env: {} }) === '', 'a caller that chose its own bound is never told the client did it');
  ok(capToClient(1_000_000, {}) === 295_000, 'a bound past the client comes back capped');
  ok(capToClient(1_000, {}) === 1_000, '…and one inside it comes back whole');
  ok(clientBoundMs({}) === 300_000, 'the client bound is pre-stated at the measured 300 s');
  ok(clientBoundMs({ DEX_NET_CLIENT_TIMEOUT_MS: '60000' }) === 60_000, '…a reader can declare another client');
  ok(clientBoundMs({ DEX_NET_CLIENT_TIMEOUT_MS: '0' }) === null, '…and a declared 0 means no client bound at all');
  ok(netTimeoutMs({ cls: 'model', env: { DEX_NET_CLIENT_TIMEOUT_MS: '0' } }) === 600_000, '…which keeps the class bound whole');
  ok(clientBoundMs({ DEX_NET_CLIENT_TIMEOUT_MS: 'abc' }) === 300_000, 'an unparseable declaration falls back to the measured bound');
  ok(clientBoundMs({ DEX_NET_CLIENT_TIMEOUT_MS: '-5' }) === 300_000, '…and so does a negative one');
  ok(capToClient(1, {}) === 1, 'a bound of 1 ms survives the cap, so the tightening hatches still work');
  ok(netTimeoutMs({ cls: 'api', env: {} }) === 30_000, 'the api class defaults to 30 s');
  ok(netTimeoutMs({ env: {} }) === 30_000, 'an unstated class is api, the tighter of the two');
  ok(netTimeoutMs({ cls: 'nonesuch', env: {} }) === 30_000, '…and so is an unknown class name');
  ok(netTimeoutMs({ cls: 'model', ms: 1234, env: {} }) === 1234, "a caller's own ms beats the class default");
  ok(netTimeoutMs({ cls: 'model', ms: 1234, env: { DEX_NET_MODEL_TIMEOUT_MS: '77' } }) === 77, '…and the class env var beats the caller');
  ok(netTimeoutMs({ cls: 'model', ms: 1234, env: { DEX_NET_MODEL_TIMEOUT_MS: '77', DEX_NET_TIMEOUT_MS: '9' } }) === 9, '…and the global env var beats the class one');
  ok(netTimeoutMs({ cls: 'api', env: { DEX_NET_MODEL_TIMEOUT_MS: '77' } }) === 30_000, 'the model knob does not move the api class');
  /* 🔴 `Number('')` is 0 and `Number('abc')` is NaN. A bound of 0 aborts before the socket opens, so
     an unusable env value must fall THROUGH rather than coerce. */
  ok(netTimeoutMs({ cls: 'api', env: { DEX_NET_API_TIMEOUT_MS: '' } }) === 30_000, 'an empty env var falls through, never to a 0 ms bound');
  ok(netTimeoutMs({ cls: 'api', env: { DEX_NET_API_TIMEOUT_MS: 'abc' } }) === 30_000, '…and so does an unparseable one');
  ok(netTimeoutMs({ cls: 'api', env: { DEX_NET_API_TIMEOUT_MS: '0' } }) === 30_000, '…and so does a zero');
  ok(netTimeoutMs({ cls: 'api', env: { DEX_NET_API_TIMEOUT_MS: '-5' } }) === 30_000, '…and so does a negative');

  /* ── the request ───────────────────────────────────────────────────────────────────────────── */
  await (async () => {
    /* CONTROL: a healthy injected fetch still returns its own response, and the bound passes a signal
       through without replacing the caller's init. */
    let sawSignal = false;
    let sawMethod = null;
    const healthy = (_u, o) => {
      sawSignal = typeof o.signal === 'object' && o.signal !== null;
      sawMethod = o.method;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 1 }) });
    };
    const res = await boundedFetch('http://x/api/tags', { method: 'POST' }, { fetchImpl: healthy, env: {} });
    ok((await res.json()).v === 1, 'CONTROL · a healthy request returns its own response');
    ok(sawSignal, '…and it carries a signal');
    ok(sawMethod === 'POST', "…and it keeps the caller's own init");
  })();

  await (async () => {
    /* A fetch that accepts and answers nothing, exactly the shape that hung doc-search. It honours the
       signal, which is what a real socket does. */
    const stalling = (_u, o) => new Promise((_resolve, reject) => o.signal.addEventListener('abort', () => reject(o.signal.reason)));
    let reason = null;
    try {
      await boundedFetch('http://x/api/generate', {}, { cls: 'model', ms: 20, label: 'the stalled model', env: {}, fetchImpl: stalling });
      reason = 'it returned instead of throwing';
    } catch (e) {
      reason = netFailureReason(e, 'http://x');
    }
    ok(/the stalled model did not answer within 20 ms/.test(reason), 'a stall breaches the bound and the reason names the label and the number');
    ok(/bound class model/.test(reason), '…and the class, so a reader knows which knob moves it');
    ok(!/unreachable|refused/.test(reason), '…and it never borrows the wording of a refusal');

    /* 🔴 A RUNTIME MAY NOT HAND BACK THE REASON. `fetch` surfaces an abort as a DOMException named
       AbortError on one runtime and as the signal's own reason on another, so a leg that only uses the
       second shape cannot see whether `ac.signal.reason` is read at all. Measured 2026-11-15: removing
       `if (ac.signal.aborted) throw ac.signal.reason` left every other leg here GREEN. This one
       rejects with the first shape, where the thrown value carries no bound text of its own. */
    let viaDom = null;
    const domStyle = (_u, o) =>
      new Promise((_resolve, reject) => {
        o.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    try {
      await boundedFetch('http://x/api/tags', {}, { fetchImpl: domStyle, ms: 20, label: 'the dom-style call', env: {} });
    } catch (e) {
      viaDom = netFailureReason(e, 'http://x');
    }
    ok(/the dom-style call did not answer within 20 ms/.test(viaDom), 'an abort the runtime rewrites still reports THIS bound, never its own wording');

    let viaStall = null;
    try {
      await boundedFetch('http://x/api/tags', {}, { fetchImpl: stalling, ms: 20, env: {} });
    } catch (e) {
      viaStall = netFailureReason(e, 'http://x');
    }
    ok(/did not answer within 20 ms/.test(viaStall), 'a fetch that honours the signal reports the same bound');
    ok(/http:\/\/x\/api\/tags/.test(viaStall), '…and an unlabelled call falls back to the url it asked');
  })();

  await (async () => {
    /* A throw that is NOT the bound must travel unchanged, or a real refusal would read as a stall. */
    const refusing = () => Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    let reason = null;
    try {
      await boundedFetch('http://x/api/tags', {}, { fetchImpl: refusing, env: {} });
    } catch (e) {
      reason = netFailureReason(e, 'http://x');
    }
    ok(reason === 'http://x refused the connection', 'a refusal keeps its own reason and never reads as a stall');
  })();

  /* ── the reason ────────────────────────────────────────────────────────────────────────────── */
  ok(netFailureReason(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'h') === 'h does not resolve', 'an unresolvable host says so');
  ok(netFailureReason(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }), 'h') === 'h closed the connection', 'a reset says so');
  ok(netFailureReason(Object.assign(new Error(''), { name: 'AbortError' }), 'h') === 'h did not answer in time', 'a bare abort reads as a timeout');
  ok(netFailureReason(new Error('503 from the proxy'), 'h') === '503 from the proxy', 'an unknown failure keeps its own message');
  /* 🔴 `String(new Error(''))` is `'Error'` — the CLASS, not a reason. */
  ok(netFailureReason(new Error(''), 'h') === 'the request failed with no message', 'a failure with no message says that, and never names the CLASS instead');
  ok(netFailureReason('socket hang up', 'h') === 'socket hang up', 'a thrown string keeps its own text');
  /* 🔴 THE CAUSE, which is the whole finding: the wrapper text is one word for every failure. */
  const headersTimeout = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT', message: 'Headers Timeout Error' } });
  ok(netFailureReason(headersTimeout, 'h') === 'h fetch failed (UND_ERR_HEADERS_TIMEOUT)', 'a client header timeout names its cause, never the wrapper text alone');
  ok(netFailureReason(headersTimeout, 'h') !== 'fetch failed', '…so the reason names something a reader can act on');
  ok(
    netFailureReason(Object.assign(new TypeError('fetch failed'), { cause: { message: 'socket hang up' } }), 'h') === 'h fetch failed (socket hang up)',
    'a cause with a message and no code travels on its message'
  );
  ok(
    netFailureReason(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }), 'h') === 'h fetch failed (UND_ERR_SOCKET)',
    'an unfamiliar cause code travels rather than being swallowed'
  );
  ok(netFailureReason(Object.assign(new TypeError('fetch failed'), { cause: { message: 'fetch failed' } }), 'h') === 'fetch failed', 'a cause that repeats the wrapper text adds no empty parenthesis');
  ok(netFailureReason(new TypeError('fetch failed'), 'h') === 'fetch failed', 'a failure with no cause at all keeps its own message');

  console.log(fail ? `\n✗ ${fail} failed, ${pass} passed` : `\n✓ all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}
