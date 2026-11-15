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
 * A caller that needs a different number passes `ms`, and it states its reason at the call site. The
 * environment overrides both: `DEX_NET_TIMEOUT_MS` for every class at once, `DEX_NET_MODEL_TIMEOUT_MS`
 * and `DEX_NET_API_TIMEOUT_MS` per class.
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
 * The bound for one call, in ms. Precedence, highest first: `DEX_NET_TIMEOUT_MS` (every class at
 * once), the class env var, the caller's own `ms`, the class default. An unknown class is `api`,
 * because the tighter of the two bounds is the safer default for a wait nobody classified.
 */
export function netTimeoutMs({ cls = 'api', ms = null, env = process.env } = {}) {
  const known = Object.hasOwn(NET_CLASS_MS, cls) ? cls : 'api';
  return posMs(env[GLOBAL_ENV]) ?? posMs(env[CLASS_ENV[known]]) ?? posMs(ms) ?? NET_CLASS_MS[known];
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
  return msg || 'the request failed with no message';
}

/**
 * `fetch` under a bound. Returns the Response. On a breach it throws one Error whose message names
 * the label, the bound and the class, so a caller's existing `catch` reports a stall as a stall.
 */
export async function boundedFetch(url, init = {}, { cls = 'api', ms = null, label = null, env = process.env, fetchImpl = fetch } = {}) {
  const timeoutMs = netTimeoutMs({ cls, ms, env });
  const who = label || String(url).split('?')[0];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${who} did not answer within ${timeoutMs} ms (bound class ${cls})`)), timeoutMs);
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
  ok(netTimeoutMs({ cls: 'model', env: {} }) === 600_000, 'the model class defaults to 600 s');
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

  console.log(fail ? `\n✗ ${fail} failed, ${pass} passed` : `\n✓ all ${pass} selftests passed`);
  process.exit(fail ? 1 : 0);
}
