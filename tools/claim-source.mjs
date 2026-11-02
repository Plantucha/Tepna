/*
 * claim-source.mjs — resolve a sourced CLAIM marker against the artifact it names.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * TWO MECHANISMS BIND A DOC NUMBER TO CODE, AND THIS FILE DRAWS THE LINE BETWEEN THEM.
 * Row `2026-10-10-two-mechanisms-bind-a-doc-number-to-code-and-one-cannot-read-code`: the CLAIM
 * resolver in `tests/run-tests.mjs` walked a slash-separated pointer with `JSON.parse`, so a marker
 * naming a `.js` source failed as `unreadable/invalid JSON` — a refusal about the FILE FORMAT, in a
 * reason that reads like a broken artifact. `tools/docs-constants.mjs` does bind to source, but only
 * for the claims someone hand-adds to its `CHECKS` list. #3389 was asked for a marker sourced from
 * `clock.js` and could not have one: the only way to satisfy it was to publish the constant into a
 * JSON, creating a SECOND source of truth for a number that already lives in code.
 *
 * THE DECISION (Osprey, §7, 2026-11-02): a CLAIM may name a CODE source, and `docs-constants` stays.
 * They answer different questions, so neither is redundant:
 *
 *   | the doc side                                  | the mechanism |
 *   |-----------------------------------------------|---------------|
 *   | can carry a marker (`CLAIM n = v FROM f#p`)   | CLAIM, this resolver — one generic reader, any number of claims |
 *   | a number inside prose that carries no marker  | `docs-constants.mjs` CHECKS — a doc regex paired with a code regex |
 *
 * ONE NUMBER GETS ONE MECHANISM. `pinnedByDocsConstants` reads the identifiers out of the `CHECKS`
 * list so a code-sourced CLAIM on a number `CHECKS` already pins can RED instead of being decided by
 * whichever gate a session happened to reach for.
 *
 * A GATE THAT CANNOT READ ITS SOURCE MUST NOT CERTIFY THE CLAIM. Every way this resolver goes blind
 * returns a named `reason` and no value, because an unresolved claim reds in the suite while a quiet
 * `null` would read as agreement (CLAUDE.md §4b).
 */

import { codeMask } from './js-lex.mjs';

/* The CLAIM grammar's own number: an optional sign, digits, an optional decimal part. Exponent and hex
   forms are REFUSED rather than truncated — `5e3` would otherwise read as 5, which is the silent
   truncation the integer assertion in the suite exists to stop, one indirection further down. */
const NUM = String.raw`-?\d+(?:\.\d+)?`;

/** @param {string} file a repo-relative path from a CLAIM marker */
export function sourceKind(file) {
  const f = String(file || '').toLowerCase();
  if (f.endsWith('.json')) return 'json';
  if (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')) return 'code';
  return null;
}

/* The source with every comment AND string character blanked to a space, offsets preserved: the one
   projection that answers "does this file BIND the identifier in real code". `js-lex` is the single
   home for that distinction — never re-spell its scanner here. */
function codeOnly(src) {
  const s = String(src);
  const m = codeMask(s);
  let out = '';
  for (let i = 0; i < s.length; i++) out += m[i] ? s[i] : s[i] === '\n' ? '\n' : ' ';
  return out;
}

/**
 * Read one numeric binding out of a JS source. `const`, `let`, `var`, an `export const`, a continued
 * declarator list and a plain assignment all read the same way, because the binding keyword is not
 * what makes the number true — the identifier is.
 *
 * @param {string} src the file text
 * @param {string} ident the identifier a CLAIM pointer named
 * @returns {{ value: number|null, reason: string|null, at: number }}
 */
export function readCodeConstant(src, ident) {
  const id = String(ident || '');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) return { value: null, reason: 'the pointer `' + id + '` is not a JS identifier — a code source takes a bare identifier, not a path', at: 0 };
  const code = codeOnly(src);
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bind = new RegExp('(?<![\\w$.])' + esc + '\\s*=(?!=)\\s*(' + NUM + ')(?![\\w.$])', 'g');
  const hits = [...code.matchAll(bind)];
  if (hits.length === 1) return { value: Number(hits[0][1]), reason: null, at: 1 };
  if (hits.length > 1) return { value: null, reason: 'the identifier `' + id + '` is bound to a number ' + hits.length + ' times, so the claim names no single value', at: hits.length };
  const mentioned = new RegExp('(?<![\\w$.])' + esc + '(?![\\w$])').test(code);
  if (mentioned)
    return { value: null, reason: 'the identifier `' + id + '` is in the code but is bound to no plain numeric literal (an expression, a call, an exponent or a hex form all read this way)', at: 0 };
  return { value: null, reason: 'the identifier `' + id + '` is bound nowhere in the code of that file', at: 0 };
}

/** Walk a slash-separated pointer through parsed JSON. The original CLAIM behaviour, unchanged. */
export function readJsonPointer(text, pointer) {
  let cur;
  try {
    cur = JSON.parse(text);
  } catch (e) {
    return { value: null, reason: 'unreadable/invalid JSON: ' + String((e && e.message) || e).slice(0, 80) };
  }
  for (const seg of String(pointer).split('/')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return { value: null, reason: 'pointer did not resolve: #' + pointer };
    cur = cur[seg];
  }
  if (typeof cur !== 'number') return { value: null, reason: 'pointer resolved to ' + typeof cur + ', not a number' };
  return { value: cur, reason: null };
}

/**
 * PURE CORE — resolve one marker against a supplied reader. No fs, so a selftest can plant a drifted
 * constant, a commented-out binding and an absent file without touching the repository.
 *
 * @param {{file: string, pointer: string}} marker
 * @param {(file: string) => (string|null)} readFn the file text, or null when absent or unreadable
 * @returns {{ actual: number|null, reason: string|null, kind: string|null }}
 */
export function resolveSourcedClaim(marker, readFn) {
  const file = String((marker && marker.file) || '');
  const pointer = String((marker && marker.pointer) || '');
  const kind = sourceKind(file);
  if (!kind) {
    return {
      actual: null,
      kind: null,
      reason: 'a CLAIM reads a `.json` pointer or a `.js`/`.mjs` identifier, and `' + file + '` is neither — a number inside prose belongs to `tools/docs-constants.mjs` instead'
    };
  }
  const text = readFn(file);
  if (text == null) return { actual: null, kind, reason: 'source file not found: ' + file };
  const got = kind === 'json' ? readJsonPointer(text, pointer) : readCodeConstant(text, pointer);
  return { actual: got.value, kind, reason: got.reason };
}

/**
 * The overlap detector. A `CHECKS` entry pins one number by pairing a doc regex with a code regex, and
 * the identifier it reads is spelled inside that regex's source — so the entries name their own
 * territory and a CLAIM can be held off it.
 *
 * @param {Array<{name?: string, codeFile?: string, codeRegex?: RegExp}>} checks the CHECKS list
 * @returns {Array<{file: string, ident: string, check: string}>}
 */
export function docsConstantsPins(checks) {
  const out = [];
  for (const c of checks || []) {
    const file = String((c && c.codeFile) || '');
    const src = c && c.codeRegex ? String(c.codeRegex.source) : '';
    if (!file || !src) continue;
    for (const m of src.matchAll(/([A-Za-z_$][A-Za-z0-9_$]{2,})\\s\*=/g)) out.push({ file, ident: m[1], check: String((c && c.name) || 'unnamed') });
  }
  return out;
}

/**
 * Is this code-sourced marker pinned by `docs-constants` too? One number, one mechanism.
 *
 * @returns {{ pinned: boolean, by: string|null }}
 */
export function pinnedByDocsConstants(checks, file, ident) {
  for (const p of docsConstantsPins(checks)) {
    if (p.file === String(file) && p.ident === String(ident)) return { pinned: true, by: p.check };
  }
  return { pinned: false, by: null };
}
