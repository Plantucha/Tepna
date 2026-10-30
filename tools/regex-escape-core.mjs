// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// regex-escape-core.mjs — THE one canonical escaper for a literal that reaches a RegExp.

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS: the tree wrote the 14-character metacharacter class out at 24 sites across
// 18 files. Three of those sites exported it with not one importer between them.

// A new site copies whichever neighbour it read, so an incomplete copy reads as the house form.
// CodeQL rated the `$`-only copy in #4134 high (`js/incomplete-sanitization`), and the copy before
// it had its order wrong (#2154).
// Row `2026-10-30-the-regex-escaper-is-copied-seven-times-and-exported-twice`.

// THE SET IS THE CONTRACT, NOT ITS SPELLING. Order inside a character class carries no meaning, so
// the spellings in the tree agreed wherever the SET agreed. `META` below is that set, and the pins
// in `killcheck.mjs` and `gate-tightness.mjs` hold the function against it character by character.

// AN UNESCAPED LITERAL IS A WRONG ANSWER BEFORE IT IS A SANITISATION BUG. An unescaped `.` matches
// any character, so a name that carries one marks unrelated symbols as found. A reviewer reads that
// as a bad measurement rather than as an escaping slip, which is why one home carries it.

// THREE SITES STAY OUT, BY DIALECT AND BY REACH:
//   · `secret-scan.mjs` escapes for a Go RE2 pattern inside a TOML literal string. The sets agree
//     today, and one shared JS escaper would hide the day they stop agreeing.
//   · `corpus-census.mjs` translates a glob, so `*` and `?` never reach its escape. That narrowing
//     is deliberate rather than a partial copy.
//   · `tests/dex-tests.js` loads in the browser suite as well as in Node, where this import cannot
//     follow it. The suite keeps its own copies, and the gate names all three.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/* Every character a RegExp reads as syntax — FOURTEEN of them, not the twelve the row counted:
   the brace pair is easy to read past, and a quantifier brace is syntax wherever a RegExp parses it. */
export const META = '.*+?^${}()|[]\\';

/** `s` as a pattern that matches `s` and nothing else. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
