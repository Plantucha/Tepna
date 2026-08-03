#!/usr/bin/env node
/*
 * tools/js-lex.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE REGEX-AWARE JS LEXER, shared by the tools that need to tell code from prose.
 *
 * Extracted from `tools/mutate.mjs` when `tools/guarantees.mjs` needed the same distinction — mutate
 * wants the CODE (mutate only real code), guarantees wants its inverse (read only real comments).
 * It lives in its own module for a reason beyond tidiness: `mutate.mjs` runs its sweep at import,
 * so importing it to borrow one function starts a mutation run. A pure module has no such hazard.
 *
 * DO NOT COPY THIS INTO A SECOND FILE. Getting it right already cost one real defect: a regex literal
 * containing quote characters desynchronised the scanner for the rest of the file, inventing
 * comment-mutants and suppressing legitimate ones (CLOCK-MUTATION-AUDIT §4). A duplicate is free to
 * drift back into exactly that. One lexer, N callers.
 */

/* A PER-CHARACTER MASK OF WHAT IS ACTUALLY CODE.
   The first version skipped lines that *began* with a comment marker, which is not the same thing at
   all — and the first real sweep proved it. Roughly a third of the reported "survivors" were mutations
   of prose: a `<` inside a block-comment body whose continuation line starts with a letter, a trailing `// 90 min`
   after a real statement, digits inside an HTML string. Those are guaranteed survivors, they are
   pure noise, and — worse — they DEPRESS THE KILL RATE, so the headline number was wrong in the
   pessimistic direction. Coverage of prose is not a gate hole.

   So walk the file once and mark every character that is inside a line comment, a block comment, or a
   string/template literal. Mutations are only generated at unmasked positions. This is a scanner, not
   a parser: it does not know about regex literals, which are rare in these DSPs and at worst
   reintroduce a little of the noise this removes. */
/* IS A `/` HERE A REGEX, OR DIVISION?
   The classic JS lexing ambiguity, and the reason the previous scanner corrupted `clock.js`. A regex
   literal may only appear where an EXPRESSION is expected, so the preceding significant character
   decides it: after an identifier, a number, `)` or `]` a slash is division; after an operator, a
   comma, a paren, `=`, `:`, `{`, `;` — or at the start of a file — it opens a regex.
   `}` is genuinely ambiguous (end of a block → regex may follow; end of an object literal → division).
   Block is far commoner in this codebase, so `}` is treated as expression-position; the cost of being
   wrong is a little noise, never a missed mutation. */
function regexCanStart(prevSig) {
  return prevSig === '' || !/[\w$)\]]/.test(prevSig);
}

/* EXPORTED so `tools/guarantees.mjs` can find COMMENTS — the inverse of this mask — without carrying a
   second regex-aware lexer. Getting this right already cost one real defect: a regex literal containing
   quote characters desynchronised the scanner for the rest of the file, inventing comment-mutants and
   suppressing legitimate ones (CLOCK-MUTATION-AUDIT §4). A duplicate would be free to drift back into
   exactly that. One lexer, two callers. */
export function codeMask(src) {
  const m = new Uint8Array(src.length); // 1 = real code
  let i = 0;
  const N = src.length;
  let state = 0; // 0 code · 1 line-comment · 2 block-comment · 3 '…' · 4 "…" · 5 `…` · 6 /regex/
  let prevSig = ''; // last significant (non-space) code character — decides regex vs division
  let inClass = false; // inside a regex character class, where `/` is literal
  while (i < N) {
    const c = src[i],
      d = src[i + 1];
    if (state === 0) {
      if (c === '/' && d === '/') (state = 1), (i += 2);
      else if (c === '/' && d === '*') (state = 2), (i += 2);
      else if (c === '/' && regexCanStart(prevSig)) (state = 6), (m[i] = 1), i++, (inClass = false);
      else if (c === "'") (state = 3), i++;
      else if (c === '"') (state = 4), i++;
      else if (c === '`') (state = 5), i++;
      else {
        m[i] = 1;
        if (!/\s/.test(c)) prevSig = c;
        i++;
      }
    } else if (state === 6) {
      /* Inside a regex literal. `/` only terminates outside a character class, and a backslash escapes
         the next character — otherwise `/[a-z/]/` or `/\//` would end it early. The body is marked as
         CODE (it is), but crucially the scanner no longer treats the quotes inside it as string
         delimiters, which is the whole bug. */
      m[i] = 1;
      if (c === '\\') i += 2;
      else if (c === '[') (inClass = true), i++;
      else if (c === ']') (inClass = false), i++;
      else if (c === '/' && !inClass) (state = 0), (prevSig = '/'), i++;
      else i++;
    } else if (state === 1) {
      if (c === '\n') (state = 0), (m[i] = 1);
      i++;
    } else if (state === 2) {
      if (c === '*' && d === '/') (state = 0), (i += 2);
      else i++;
    } else {
      const q = state === 3 ? "'" : state === 4 ? '"' : '`';
      if (c === '\\') i += 2;
      else if (c === q) (state = 0), i++;
      else i++;
    }
  }
  return m;
}
