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
/* THE WALKER'S OUTPUT IS A CLASS PER CHARACTER, and the two masks below are views of it. It was one
   function returning `code | not-code`, which answers mutate's question and `guarantees`' question but
   not "is this character inside a COMMENT" — a string and a comment are both 0. A caller that needs
   that third answer either reads the mask wrong (every path literal in a test file becomes prose) or
   writes a second scanner, which is the one thing this file's header forbids. So the walker classifies
   and the masks project. `codeMask` is byte-identical to the version that shipped before this split —
   asserted over every `tools/*.mjs` and root `*.js` in the suite, because a drift here silently moves
   the mutation program's population of sites. */
export const CLS_CODE = 0; // real code — a regex literal's body counts, as it always has
export const CLS_COMMENT = 1; // a line or block comment, its delimiters included
/* A string or template literal, its quotes included — AND the character an escape consumes inside a
   regex literal. The single-mask version excluded that one character from code (it skipped two
   positions and marked only the backslash), so `mutate.mjs`'s site population is pinned to the
   exclusion; a projection that "corrected" it would add mutation sites inside regex escapes. The
   class is where the three-value vocabulary can put it; the control in the suite is what holds it. */
export const CLS_STRING = 2;

export function classify(src) {
  const cls = new Uint8Array(src.length); // 0 = CLS_CODE by construction
  let i = 0;
  const N = src.length;
  let state = 0; // 0 code · 1 line-comment · 2 block-comment · 3 '…' · 4 "…" · 5 `…` · 6 /regex/
  let prevSig = ''; // last significant (non-space) code character — decides regex vs division
  let inClass = false; // inside a regex character class, where `/` is literal
  while (i < N) {
    const c = src[i],
      d = src[i + 1];
    if (state === 0) {
      if (c === '/' && d === '/') (state = 1), (cls[i] = CLS_COMMENT), (cls[i + 1] = CLS_COMMENT), (i += 2);
      else if (c === '/' && d === '*') (state = 2), (cls[i] = CLS_COMMENT), (cls[i + 1] = CLS_COMMENT), (i += 2);
      else if (c === '/' && regexCanStart(prevSig)) (state = 6), i++, (inClass = false);
      else if (c === "'") (state = 3), (cls[i] = CLS_STRING), i++;
      else if (c === '"') (state = 4), (cls[i] = CLS_STRING), i++;
      else if (c === '`') (state = 5), (cls[i] = CLS_STRING), i++;
      else {
        if (!/\s/.test(c)) prevSig = c;
        i++;
      }
    } else if (state === 6) {
      /* Inside a regex literal. `/` only terminates outside a character class, and a backslash escapes
         the next character — otherwise `/[a-z/]/` or `/\//` would end it early. The body is CODE (it is),
         but crucially the scanner no longer treats the quotes inside it as string delimiters, which is
         the whole bug. */
      if (c === '\\') (cls[i + 1] = CLS_STRING), (i += 2);
      else if (c === '[') (inClass = true), i++;
      else if (c === ']') (inClass = false), i++;
      else if (c === '/' && !inClass) (state = 0), (prevSig = '/'), i++;
      else i++;
    } else if (state === 1) {
      /* The terminating newline is CODE, exactly as the single-mask version had it: a line comment ends
         at the newline and the newline belongs to the line. */
      if (c === '\n') state = 0;
      else cls[i] = CLS_COMMENT;
      i++;
    } else if (state === 2) {
      cls[i] = CLS_COMMENT;
      if (c === '*' && d === '/') (state = 0), (cls[i + 1] = CLS_COMMENT), (i += 2);
      else i++;
    } else {
      const q = state === 3 ? "'" : state === 4 ? '"' : '`';
      cls[i] = CLS_STRING;
      if (c === '\\') (cls[i + 1] = CLS_STRING), (i += 2);
      else if (c === q) (state = 0), i++;
      else i++;
    }
  }
  return cls;
}

/* 1 = real code. The mask `mutate.mjs` generates sites at and `guarantees.mjs` inverts. */
export function codeMask(src) {
  const cls = classify(src);
  const m = new Uint8Array(src.length);
  for (let i = 0; i < cls.length; i++) m[i] = cls[i] === CLS_CODE ? 1 : 0;
  return m;
}

/* 1 = inside a comment. A STRING IS NOT A COMMENT — the distinction `codeMask` cannot express, and the
   reason this projection exists: `verdict-adoption.mjs` asks whether a test file names a tool outside
   its prose, and a test names a tool in a path literal or an import specifier, which are strings. */
export function commentMask(src) {
  const cls = classify(src);
  const m = new Uint8Array(src.length);
  for (let i = 0; i < cls.length; i++) m[i] = cls[i] === CLS_COMMENT ? 1 : 0;
  return m;
}

/* The source with every comment character blanked to a space, offsets preserved. A search over this
   text answers "does the file SAY this outside its prose". */
export function blankComments(src) {
  const m = commentMask(src);
  let out = '';
  for (let i = 0; i < src.length; i++) out += m[i] ? (src[i] === '\n' ? '\n' : ' ') : src[i];
  return out;
}
