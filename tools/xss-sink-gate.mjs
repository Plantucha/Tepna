#!/usr/bin/env node
/*
 * xss-sink-gate.mjs — regression gate for XSS sink fixes.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * #3318/#3343 fixed XSS sinks by routing all untrusted strings through the
 * canonical escaper (dex-escape.js: escapeHTML). This gate fails if a PR adds
 * a new innerHTML sink without an accompanying escape call.
 *
 * Heuristic (diff-based): an added line containing `innerHTML` has its RHS
 * analyzed. All `escapeHTML()`/`esc()` calls are stripped (their arguments
 * are safe), string literals are stripped (static), and any remaining
 * identifiers are flagged as potentially unescaped. A line like
 * `el.innerHTML = userInput + escapeHTML(safeVar)` FAILS because `userInput`
 * survives the stripping.
 *
 * LIMITS: This is still heuristic, not AST-based. It cannot track data flow
 * across lines or through function returns. It DOES credit a file-local
 * escaper alias from 2026-11-12, by reading that one declaration's own body
 * (see A LOCAL ESCAPER EARNS ITS CREDIT below); an alias it cannot verify
 * there earns nothing. Template
 * literals with interpolation are conservatively flagged (the `${...}` parts
 * are not parsed). Where safety cannot be established, the gate fails
 * conservatively. Human review is required for complex cases. Do not describe
 * it as comprehensive XSS detection.
 *
 * This is intentionally strict. If the input is statically trusted, document
 * why and add the line to the ALLOW table below. That table was prose only
 * until 2026-11-10: the header named it, no code read it, so the single way
 * past a false positive was to lower the ratchet baseline — which hides the
 * line instead of naming it. ALLOW now has teeth (see the staleness leg).
 *
 * Usage: node tools/xss-sink-gate.mjs --base <sha>
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, classify, CLS_CODE } from './js-lex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const SINK_RE = /\.innerHTML\s*(\+=|=)/;
// Matches escapeHTML(...) or esc(...) calls, including nested parens (one level).
// ReDoS-safe: the inner alternation uses single-char [^()] (not [^()]*), so the
// two branches are disjoint at every position — no ambiguous backtracking.
const ESCAPE_CALL_RE = /\b(?:escapeHTML|esc)\s*\((?:[^()]|\([^()]*\))*\)/g;
// String literals (single, double, backtick without interpolation).
const STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g;
// Identifiers that could be unescaped variables.
const IDENT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
// Known-safe identifiers (not user data).
const SAFE_IDENTS = new Set(['true', 'false', 'null', 'undefined', 'this']);

/* ── A LOCAL ESCAPER EARNS ITS CREDIT ─────────────────────────────────────────────────────────────
   `ESCAPE_CALL_RE` knows two NAMES, so a file that escapes through its own alias got no credit and a
   CORRECT fix read as a violation: job 131150408186 on #4959 named `escHtml` ITSELF as the unescaped
   identifier in `pat-feasibility.js`, where `escHtml` escapes `& < > "` (row
   2026-11-12-sink-gate-knows-two-escaper-names). A third name is not the remedy, because a name
   proves nothing about what a function does — `data-unifier-app.js` and `cpapdex-render.js` each
   declare an `esc` that leaves `"` alone, and each is credited today for being called `esc`.

   So a declaration whose NAME proposes an escaper is credited when its BODY either delegates to the
   canonical `escapeHTML` or escapes all four of `& < > "` itself. The quote is in that set because of
   the ATTRIBUTE finding (`tests/dex-tests.js` §8b-ii): `title="` + v + `"` breaks out on a bare quote
   with no angle bracket in sight, so a quote-blind escaper is not one.

   THE TWO CANONICAL NAMES KEEP THEIR NAME-BASED CREDIT, so this widens the gate and reds no tree
   nobody changed. The census in `--full-tree` is what makes the remaining name-only credit visible:
   it names every candidate declaration this rule could not verify.

   LIMITS: one declaration, one hop, one file. A delegation through a second alias, a method on an
   object, and an escaper imported from elsewhere are not followed and earn nothing. The span is
   brace-matched over `js-lex`'s classification — the ONE regex-aware lexer, never a second copy
   (`tools/js-lex.mjs` header) — and a body whose braces do not balance there is refused, not
   guessed at. */
export const MUST_ESCAPE = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;']
];
/* The name only PROPOSES a candidate; `escaperCredit` decides. A narrow proposal keeps a generic
   helper that happens to carry four replaces from laundering a sink it never escaped. */
const ESCAPER_NAME_RE = /^(?:esc|escape)[A-Za-z0-9_$]*$/;
/* A FUNCTION, not merely a name with an `=` after it. The first form took `const escal = perHour[0]
   > 0 ? … : 0` (`ecgdex-dsp.js:1897`, an escalation percentage) as a candidate and reported it as an
   unverified escaper, which is a census of nothing. The three accepted shapes are a declaration, a
   function expression, and an arrow. */
const DECL_RE = /\b(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)(?=\s*=>)))/g;
/* THE THREE ALTERNATIVES ARE DISJOINT ON THEIR FIRST CHARACTER, and that is what makes this scan
   LINEAR. The first form ended `[^/\\\n]`, which matched `[` and `]` itself, so `[]` parsed two ways
   and CodeQL `js/redos` rated it HIGH: exponential backtracking on a string that opens `.replace(/`
   and repeats `[]` (alert 303 against #4963, which merged with that alert unresolved because CodeQL
   is not a required context). A bare `]` outside a character class now ends the scan and the pattern
   earns no credit. That is the fail-closed direction and it costs this gate nothing: every character
   it must see — `&`, `<`, `>` and `"` — is either bare or inside a class. */
const REPLACE_PAT_RE = /\.replace\(\s*(\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[\]])+\/[a-z]*)/g;

/* Strings and comments blanked to spaces, OFFSETS PRESERVED, so a `{` or a `;` inside a literal
   cannot end a body and a `/[&<>"]/` cannot desynchronise the scan — the defect `js-lex`'s header
   records. A regex literal's body stays CODE there, so a brace inside one can still refuse a span,
   which is the safe direction. */
function structureOf(src) {
  const cls = classify(src);
  let out = '';
  for (let i = 0; i < src.length; i++) out += cls[i] === CLS_CODE ? src[i] : src[i] === '\n' ? '\n' : ' ';
  return out;
}

/**
 * PURE CORE #4 — the body span of a declaration starting at `from`, read off the structural copy:
 * `{ … }` brace-matched, or an expression-bodied arrow up to its `;`.
 * @returns {[number, number]|null} null when neither closes — no span, no credit.
 */
export function declSpan(struct, from) {
  const brace = struct.indexOf('{', from);
  const arrow = struct.indexOf('=>', from);
  const semi = struct.indexOf(';', from);
  const braceIsBody = brace >= 0 && (semi < 0 || brace < semi) && (arrow < 0 || arrow > brace || /^\s*$/.test(struct.slice(arrow + 2, brace)));
  if (braceIsBody) {
    let depth = 0;
    for (let i = brace; i < struct.length; i++) {
      if (struct[i] === '{') depth += 1;
      else if (struct[i] === '}') {
        depth -= 1;
        if (depth === 0) return [brace, i + 1];
      }
    }
    return null;
  }
  if (arrow >= 0 && semi > arrow) return [arrow, semi + 1];
  return null;
}

/**
 * PURE CORE #5 — does this declaration body escape what an HTML sink needs escaped?
 * @returns {{credited: boolean, reason: string}}
 */
export function escaperCredit(body) {
  if (!body) return { credited: false, reason: 'its body does not close, so nothing was read' };
  if (/\bescapeHTML\s*\(/.test(body)) return { credited: true, reason: 'delegates to the canonical escapeHTML' };
  const pats = [...body.matchAll(REPLACE_PAT_RE)].map((m) => m[1]);
  if (!pats.length) return { credited: false, reason: 'it neither delegates to escapeHTML nor replaces anything' };
  const missing = MUST_ESCAPE.filter(([ch, ent]) => !(pats.some((pat) => pat.includes(ch)) && body.includes(ent))).map(([ch]) => ch);
  return missing.length ? { credited: false, reason: `its own replace chain does not escape ${missing.join(' ')}` } : { credited: true, reason: 'escapes & < > " itself' };
}

/**
 * PURE CORE #6 — the escaper names a FILE may be credited for, and the candidates that earned nothing.
 * @returns {{credited: string[], unverified: Array<{name: string, reason: string}>}}
 */
export function localEscapers(src) {
  const text = String(src || '');
  const struct = structureOf(text);
  const bare = blankComments(text);
  const credited = [];
  const unverified = [];
  for (const m of struct.matchAll(DECL_RE)) {
    const name = m[1] || m[2];
    if (!ESCAPER_NAME_RE.test(name)) continue;
    const span = declSpan(struct, m.index + m[0].length);
    const r = escaperCredit(span ? bare.slice(span[0], span[1]) : null);
    if (r.credited) {
      if (!credited.includes(name)) credited.push(name);
    } else if (!unverified.some((u) => u.name === name)) unverified.push({ name, reason: r.reason });
  }
  return { credited, unverified: unverified.filter((u) => !credited.includes(u.name)) };
}

/* The strip pattern for ONE file: the two canonical names plus the escapers that file earned, MINUS
   every name that file shadows with a declaration which earned nothing. Same disjoint-alternation
   shape as `ESCAPE_CALL_RE`, so it stays ReDoS-safe, and the longest name is tried first.
   🔴 A SHADOWED CANONICAL NAME LOSES ITS CREDIT IN THAT FILE. Until 2026-11-12 `escapeHTML` and `esc`
   rode in unconditionally, so a file declaring a quote-blind local `esc` had every `esc(...)` call
   stripped out of its sinks by NAME while `localEscapers` reported the same name as unverified. The
   census printed the count and nothing refused it. The decision is static inside the one file the
   gate already reads, so it needs no cross-file resolution: the file declares the name, the body
   earned nothing, the credit goes. A file that imports the canonical helper declares nothing and is
   untouched. Returns `null` when no name survives, which means NOTHING may be stripped. */
function escapeCallRe(extra, shadowed) {
  const drop = new Set(shadowed || []);
  const names = [...new Set(['escapeHTML', 'esc', ...(extra || [])])].filter((n) => !drop.has(n));
  if (!names.length) return null;
  if (!drop.size && (!extra || !extra.length)) return ESCAPE_CALL_RE;
  const alt = names.sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`\\b(?:${alt})\\s*\\((?:[^()]|\\([^()]*\\))*\\)`, 'g');
}

/* The second argument of `classifySinkLine` and the return of `escapersFor` accept TWO shapes: a
   file's earned NAMES, which is what every caller passed before 2026-11-12, or the whole
   `localEscapers` result, which also carries the shadowed set. The array shape keeps working and
   earns no shadow, so an older caller reads exactly as it did. */
function escaperSets(escapers) {
  if (!escapers) return { credited: [], shadowed: [] };
  if (Array.isArray(escapers)) return { credited: escapers, shadowed: [] };
  const un = escapers.unverified || [];
  return {
    credited: escapers.credited || [],
    shadowed: un.map((u) => (typeof u === 'string' ? u : u && u.name)).filter(Boolean)
  };
}

/* ── ALLOW — statements a human read, with the reason ─────────────────────────────────────────────
   The heuristic judges ONE statement and cannot follow a value into the function that escaped it;
   its own LIMITS paragraph says so. A renderer that assembles markup in builders and writes it
   through a single helper therefore fails AT the helper, where no identifier can be escaped,
   because escaping assembled markup would escape the markup itself.

   `{ file, match, reason }`, all three required. `match` is a SUBSTRING of the trimmed statement and
   never a pattern, so an entry cannot widen to cover a line nobody read, and it is scoped to one
   file, so the same statement elsewhere is still caught. The staleness leg in --full-tree is what
   stops this table from rotting into blanket approval: an entry that matches no sink in the tree
   FAILS the gate rather than sitting there. */
export const ALLOW = [
  {
    file: 'eegdex-render.js',
    match: 'el.innerHTML = html',
    reason:
      "the file's one sink helper (setHTML). Every value its builders interpolate goes through esc() or a number formatter, and the only raw markup is MetricRegistry.badge() output via evBadge(). The two EDF-derived strings — the channel label and the physical dimension — reach HTML only through row() and kpi(), which escape them."
  },
  {
    file: 'sensor-trio-night.js',
    match: "u.innerHTML = (real && s != null ? evb(useMeas ? 'refNight' : 'hat')",
    reason:
      "the per-corner σ caption. `real`, `s` and `useMeas` only choose a branch and are never written into the markup. evb() returns MetricRegistry.badge() markup for one of two static EV keys, 'refNight' or 'hat', and the caption text, the one value that carries numbers, goes through esc()."
  },
  {
    file: 'sensor-trio-night.js',
    match: "rc.innerHTML = evb(useMeas ? 'refNight' : 'hat') + ' ' + esc(",
    reason:
      "the night-list row caption. `useMeas` only chooses a branch and is never written into the markup. evb() returns MetricRegistry.badge() markup for one of two static EV keys, 'refNight' or 'hat', and the σ triple, the one value that carries numbers, goes through esc()."
  }
];

/**
 * PURE CORE #3 — is this statement one a human exempted, in this file, with a reason?
 * @returns {{file: string, match: string, reason: string}|null}
 */
export function allowedBy(file, stmt, table) {
  const t = table || ALLOW;
  for (const a of t) if (a.file === file && a.match && a.reason && String(stmt).includes(a.match)) return a;
  return null;
}

/**
 * PURE CORE #1 — the heuristic for ONE added line. Unchanged from the original; only extracted, so a
 * selftest can plant a sink and a control without a diff.
 *
 * `escapers` is the calling FILE's earned escaper names (`localEscapers`), new and optional, so a
 * caller that passes nothing gets the two canonical names and the behaviour it had.
 *
 * @returns {{sink: boolean, unsafe: string[]}}
 */
export function classifySinkLine(line, escapers) {
  if (!SINK_RE.test(line)) return { sink: false, unsafe: [] };
  const m = line.match(/\.innerHTML\s*(?:\+=|=)\s*(.+?);?\s*$/);
  const rhs = m ? m[1] : '';
  /* escapeHTML()/esc() calls first — their ARGUMENTS are safe, so the whole call collapses. Then
     string literals, which are static. Whatever identifier survives both is untracked data. */
  const sets = escaperSets(escapers);
  const callRe = escapeCallRe(sets.credited, sets.shadowed);
  let stripped = callRe ? rhs.replace(callRe, '""') : rhs;
  stripped = stripped.replace(STRING_RE, '""');
  const unsafe = [];
  for (const im of stripped.matchAll(IDENT_RE)) if (!SAFE_IDENTS.has(im[0])) unsafe.push(im[0]);
  return { sink: true, unsafe };
}

/**
 * PURE CORE #2 — walk a unified diff, tracking the current file, and collect violations.
 *
 * `escapersFor(file)` is optional and resolves that file's escaper credit. It is a callback and not a
 * map because the resolution reads the file, which a pure core may not do. It may return the earned
 * NAMES as an array, or the whole `localEscapers` result, whose unverified set then withdraws a
 * shadowed canonical name from the strip pattern for that file.
 *
 * @returns {{violations: Array<{file,line,unsafe}>, sinksAdded: number}}
 */
export function scanDiff(lines, escapersFor) {
  const violations = [];
  const allowed = [];
  const rows = lines || [];
  let file = '';
  let sinksAdded = 0;
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    if (l.startsWith('diff --git')) {
      const m = l.match(/b\/(.+)$/);
      file = m ? m[1] : '';
      continue;
    }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    if (!SINK_RE.test(l)) continue;
    sinksAdded += 1;
    /* ⚠️ A MULTI-LINE ASSIGNMENT USED TO READ AS SAFE, SILENTLY. `el.innerHTML =` at the end of one
       line with its right-hand side on the next matched the sink, produced an EMPTY rhs, found no
       identifier in it and was recorded clean — a false negative that also counted toward
       `sinksAdded`, so the gate reported examining it. Measured 2026-10-10: `pulsedex-app.js:988` is
       exactly this shape, and it is one of the 7 open `js/xss-through-dom` CodeQL alerts — the control
       that exposed it. The statement is now assembled across up to 4 following added lines, stopping
       at the `;`, before classification. */
    let stmt = l;
    if (!/\.innerHTML\s*(?:\+=|=)\s*\S/.test(l)) {
      for (let k = 1; k <= 4 && i + k < rows.length; k++) {
        const nxt = rows[i + k];
        if (!nxt.startsWith('+') || nxt.startsWith('+++')) break;
        stmt += ` ${nxt.slice(1).trim()}`;
        if (/;\s*$/.test(nxt)) break;
      }
    }
    const r = classifySinkLine(stmt, escapersFor ? escapersFor(file) : null);
    if (!r.unsafe.length) continue;
    /* An exempt line is EXCLUDED, never silently clean: it leaves the violation list and enters a
       population the verdict prints, so an exemption nobody sees is not approval in the dark. */
    const a = allowedBy(file, stmt.trim());
    if (a) allowed.push({ file, line: stmt.trim().slice(0, 100), match: a.match, reason: a.reason });
    else violations.push({ file, line: stmt.trim().slice(0, 100), unsafe: r.unsafe });
  }
  return { violations, sinksAdded, allowed };
}

/* An ALLOW entry that matched nothing in the population just scanned. Over the WHOLE TREE that means
   the line is gone or was renamed, so the exemption now covers nothing and must leave the table. */
export function staleAllow(allowed, table) {
  const t = table || ALLOW;
  return t.filter((a) => !allowed.some((x) => x.file === a.file && x.match === a.match));
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // THE PLANTED VIOLATION — an added sink with an unescaped variable, the #3318 shape.
  const bad = classifySinkLine('+  el.innerHTML = userInput;');
  ok(bad.sink && bad.unsafe.includes('userInput'), 'a planted unescaped sink is caught and the identifier named');
  /* The mixed case the header calls out: one escaped argument does NOT launder the line. */
  const mixed = classifySinkLine('+  el.innerHTML = userInput + escapeHTML(safeVar);');
  ok(mixed.unsafe.includes('userInput') && !mixed.unsafe.includes('safeVar'), 'an escaped call does not launder an unescaped sibling');

  /* THE CONTROLS — without these the gate could flag EVERY added line and still pass the plant. */
  ok(classifySinkLine('+  el.innerHTML = escapeHTML(x);').unsafe.length === 0, 'CONTROL: a fully escaped sink is clean');
  ok(classifySinkLine("+  el.innerHTML = '<b>static</b>';").unsafe.length === 0, 'CONTROL: a string literal is static, not user data');
  ok(classifySinkLine('+  const x = userInput;').sink === false, 'CONTROL: a line with no innerHTML is not a sink at all');
  ok(
    classifySinkLine('-  el.innerHTML = userInput;').sink === true && scanDiff(['-  el.innerHTML = userInput;']).violations.length === 0,
    'CONTROL: a REMOVED sink is not an addition — the scan is diff-directional'
  );

  /* THE MULTI-LINE SINK — the shape that read as safe until the CodeQL control named the file it hid
     in. The assignment's RHS is on the following line; without assembly the rhs is empty and the line
     is recorded clean while still counting as a sink examined. */
  const split = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML =', "+    userInput + '<br>' + n + ';'"]);
  ok(split.violations.length === 1 && split.violations[0].unsafe.includes('userInput'), 'a sink whose RHS is on the NEXT line is caught');
  ok(split.sinksAdded === 1, '…and counted once, not once per assembled line');

  /* ── THE METRIC SWITCH, PLANTED ────────────────────────────────────────────────────────────────
     The case the FILE count could not see: one file, five sinks, four of them escaped. The work is
     four fifths done and the file is still listed, so a files-based baseline moves by ZERO and the
     ratchet reports no progress on a real security fix. This is not hypothetical — #3437 escaped
     sinks in two listed files and the file count stayed 42, which is why the metric changed. */
  const fiveSinks = ['diff --git a/a.js b/a.js'];
  for (let k = 0; k < 5; k++) fiveSinks.push(`+  el${k}.innerHTML = userInput${k};`);
  const allBad = scanDiff(fiveSinks);
  ok(allBad.violations.length === 5, 'five unescaped sinks in one file count as FIVE', `got ${allBad.violations.length}`);
  ok([...new Set(allBad.violations.map((v) => v.file))].length === 1, '…and as ONE file');

  const fourFixed = ['diff --git a/a.js b/a.js'];
  for (let k = 0; k < 4; k++) fourFixed.push(`+  el${k}.innerHTML = escapeHTML(userInput${k});`);
  fourFixed.push('+  el4.innerHTML = userInput4;');
  const partly = scanDiff(fourFixed);
  ok(partly.violations.length === 1, 'escaping four of the five leaves ONE unescaped sink', `got ${partly.violations.length}`);
  ok([...new Set(partly.violations.map((v) => v.file))].length === 1, '…while the FILE count is unchanged at one — the blindness, in one assertion');
  /* And the ratchet must now MOVE on that work, where before it could not. */
  ok(ratchet(partly.violations.length, { count: 5 }).status === 'SHORTFALL', 'the sink ratchet asks to be LOWERED after the four fixes');
  ok(ratchet(1, { count: 1 }).status === 'PASS', 'an unchanged sink count passes');
  ok(ratchet(2, { count: 1 }).status === 'FAIL', 'a RISEN sink count fails');
  const fileMetric = [...new Set(partly.violations.map((v) => v.file))].length;
  ok(ratchet(fileMetric, { count: 1 }).status === 'PASS', 'CONTROL · the OLD file metric reports PASS over the same four fixes — it cannot see them');

  /* The ledger entry this gate reads must carry the new unit, or the gate and its baseline disagree
     about what the number means — which is how a ratchet silently measures the wrong thing. */
  const led = readBacklog(join(ROOT, BACKLOG_LEDGER), 'xss-sink-gate', (f) => readFileSync(f, 'utf-8'));
  ok(led != null, 'the backlog ledger still has an xss-sink-gate entry');
  ok(led != null && /sink/i.test(led.unit || ''), 'the ledger UNIT names sinks, not files', JSON.stringify(led && led.unit));
  ok(led != null && led.files != null, 'the ledger keeps files as a second, non-ratcheted column', JSON.stringify(led && led.files));

  const splitSafe = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML =', '+    escapeHTML(x);']);
  ok(splitSafe.violations.length === 0, 'CONTROL: a multi-line sink that IS escaped stays clean');
  ok(scanDiff(['+  el.innerHTML =', '-  removed line']).violations.length === 0, 'CONTROL: assembly stops at a non-added line rather than reading across the hunk');

  // The walk attributes a violation to the right FILE, which is what makes the failure routable.
  const walked = scanDiff(['diff --git a/oxydex-render.js b/oxydex-render.js', '+  el.innerHTML = n.date;']);
  ok(walked.violations.length === 1 && walked.violations[0].file === 'oxydex-render.js', 'the violation names the file it is in');
  ok(walked.sinksAdded === 1, 'the population counts sinks ADDED, so a pass over zero sinks is distinguishable');
  ok(scanDiff(['+++ b/x.js', '+  el.innerHTML = userInput;']).violations.length === 1, 'the +++ header is skipped but the following line is not');

  /* ── THE SHRINK-ONLY RATCHET ──────────────────────────────────────────────────────────────────────
     Four states, and the one that matters most is the THIRD: a count that FELL must not quietly pass,
     or the baseline stays at its seeded value forever and the ratchet stops being one. */
  ok(ratchet(5, null).status === 'NOT_RUN', 'no baseline yet ⇒ NOT_RUN, never a pass over an unrecorded number');
  ok(ratchet(6, { count: 5 }).status === 'FAIL', 'a count ABOVE the baseline fails — something was merged unexamined');
  ok(ratchet(4, { count: 5 }).status === 'SHORTFALL', 'a count BELOW the baseline is a SHORTFALL asking for the baseline to be lowered');
  ok(ratchet(5, { count: 5 }).status === 'PASS', 'an unchanged count passes');
  ok(/lower the baseline/.test(ratchet(4, { count: 5 }).reason || ''), '…and says what to do about it');
  ok(ratchet(0, { count: 0 }).status === 'PASS', 'a cleared backlog passes at zero');

  /* ── THE ALLOW TABLE, PLANTED BOTH WAYS ───────────────────────────────────────────────────────
     A hatch is only as good as its controls: these legs plant an exempt line, the SAME line in
     another file, a different line in the exempt file, and an entry with no reason. Without the
     three controls the predicate could exempt everything and still pass the plant. */
  const TBL = [{ file: 'a.js', match: 'el.innerHTML = html', reason: 'a human read this one and wrote down why' }];
  ok(allowedBy('a.js', '  el.innerHTML = html;', TBL) !== null, 'an exempt statement in its own file is recognised');
  ok(allowedBy('b.js', '  el.innerHTML = html;', TBL) === null, 'CONTROL: the SAME statement in another file is NOT exempt — an entry is file-scoped');
  ok(allowedBy('a.js', '  el.innerHTML = other;', TBL) === null, 'CONTROL: a different statement in the exempt file is NOT exempt');
  ok(allowedBy('a.js', '  el.innerHTML = html;', [{ file: 'a.js', match: 'el.innerHTML = html', reason: '' }]) === null, 'an entry with NO reason exempts nothing — the reason IS the mechanism');

  const exempted = scanDiff(['diff --git a/eegdex-render.js b/eegdex-render.js', '+    el.innerHTML = html;']);
  ok(exempted.violations.length === 0 && exempted.allowed.length === 1, 'the real table exempts the real sink helper, as EXCLUDED rather than clean');
  ok(exempted.sinksAdded === 1, '…while the sink still counts as EXAMINED, so the verdict population stays honest');
  ok(scanDiff(['diff --git a/eegdex-render.js b/eegdex-render.js', '+    el.innerHTML = userInput;']).violations.length === 1, 'CONTROL: another unescaped sink in the exempt FILE is still caught');
  ok(staleAllow([], ALLOW).length === ALLOW.length, 'an ALLOW entry that matched no sink is reported stale');
  const plantedAll = ALLOW.flatMap((a) => scanDiff([`diff --git a/${a.file} b/${a.file}`, `+    ${a.match};`]).allowed);
  ok(staleAllow(plantedAll, ALLOW).length === 0, '…and one that matched is not');
  ok(
    ALLOW.every((a) => a.file && a.match && a.reason && a.reason.length > 60),
    'every real ALLOW entry carries a file, a match and a reason long enough to be one'
  );
  ok(
    ALLOW.every((a) => existsSync(join(ROOT, a.file))),
    'every real ALLOW entry names a file that still exists'
  );

  /* ── THE ALIAS, PLANTED BOTH WAYS ─────────────────────────────────────────────────────────────
     The defect: `escHtml` escapes & < > " and read as the unescaped identifier itself (#4959). These
     legs plant the alias, the quote-blind near-miss, a prose declaration, and the generic helper —
     without the four controls the credit could be handed to any name in any comment. */
  const DELEG = '{ return escapeHTML(s); }';
  const FOURCH = "{ return String(s).replace(/[&<>\"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]; }); }";
  const QUOTEBLIND = "{ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }";
  ok(escaperCredit(DELEG).credited === true, 'a one-hop delegation to escapeHTML is credited');
  ok(escaperCredit(FOURCH).credited === true, 'a body that escapes & < > " itself is credited');
  ok(escaperCredit(QUOTEBLIND).credited === false, 'CONTROL: a quote-blind escaper is NOT credited — the ATTRIBUTE sink is why');
  ok(/does not escape "/.test(escaperCredit(QUOTEBLIND).reason), '…and the refusal names the character it leaves alone');
  ok(escaperCredit('{ return s.toUpperCase(); }').credited === false, 'CONTROL: a helper that replaces nothing earns nothing');
  ok(escaperCredit(null).credited === false, 'CONTROL: a body that could not be read earns nothing — refusal is the safe direction');

  /* THE DISJOINT ALTERNATION, PINNED BY ITS CONSEQUENCES. The first form of `REPLACE_PAT_RE` let its
     last alternative match `[` and `]`, so `[]` parsed two ways and CodeQL `js/redos` rated it HIGH
     (alert 303 against #4963). Measured on `.replace(/` + `[]`×N + `!`: the old form took 0.7 ms at
     N=14, 24 ms at N=22 and 6121 ms at N=30, while this one stays under 0.06 ms across all of them.
     The bound below is 6x under that 30-repetition reading, so it separates the two forms without
     asking a test to time anything tightly. */
  const CLASSFORM = '{ const M = { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;" }; return s.replace(/[&<>"]/g, (c) => M[c]); }';
  ok(escaperCredit(CLASSFORM).credited === true, 'a ONE-class escaper is credited — the class alternative is what reads it');
  ok(escaperCredit('{ return s.replace(/]/g, "x"); }').credited === false, 'a bare "]" outside a class is not read, so the body earns nothing — fail closed');
  const ADVERSARIAL = `{ return s.replace(/${'[]'.repeat(30)}!; }`;
  const tReDoS = Date.now();
  const advCredit = escaperCredit(ADVERSARIAL).credited;
  ok(advCredit === false && Date.now() - tReDoS < 1000, 'an adversarial body is judged in bounded time — the alternatives are disjoint', `${Date.now() - tReDoS} ms`);

  const SRC_ALIAS = `function escHtml(s) ${FOURCH}\nel.innerHTML = escHtml(v);\n`;
  ok(localEscapers(SRC_ALIAS).credited.includes('escHtml'), "a file's own escHtml is read out of its declaration");
  ok(localEscapers(`function sanitize(s) ${FOURCH}`).credited.length === 0, 'CONTROL: a name that does not propose an escaper earns nothing, whatever its body does');
  ok(localEscapers(`/* function escHtml(s) ${FOURCH} */`).credited.length === 0, 'CONTROL: a declaration inside a COMMENT is prose and earns nothing');
  ok(localEscapers(`const escPath = (s) => s.replace(/x/g, "{");`).credited.length === 0, 'CONTROL: a brace inside a STRING does not open a body — the structural copy is why');
  ok(
    localEscapers(`const escArrow = (s) =>\n  String(s)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/"/g, '&quot;');`).credited.includes(
      'escArrow'
    ),
    'an expression-bodied arrow escaper is credited too'
  );
  ok(
    localEscapers(`function esc(s) ${QUOTEBLIND}`).unverified.some((u) => u.name === 'esc'),
    'a candidate that earns nothing is REPORTED, not dropped — the name-only credit it keeps is the census subject'
  );
  ok(
    localEscapers('const escal = perHour[0] > 0 ? 100 : 0;').unverified.length === 0,
    'CONTROL: a NAME with an `=` after it is not a candidate — only a function is (the ecgdex-dsp.js escalation shape)'
  );
  ok(localEscapers(readFileSync(join(ROOT, 'ecgdex-dsp.js'), 'utf-8')).unverified.length === 0, '…measured on the real file that shape came from');

  /* THE ROW, BOTH WAYS: the same line reads as a violation without the file's escaper and clean with
     it, and an unescaped sibling still survives the credited call. */
  ok(classifySinkLine('+  el.innerHTML = escHtml(v);').unsafe.includes('escHtml'), 'the row reproduced: with no earned escaper the alias ITSELF reads as unescaped');
  ok(classifySinkLine('+  el.innerHTML = escHtml(v);', ['escHtml']).unsafe.length === 0, '…and with the earned escaper the same line is clean');
  ok(classifySinkLine('+  el.innerHTML = escHtml(v) + raw;', ['escHtml']).unsafe.includes('raw'), 'CONTROL: a credited alias does not launder an unescaped sibling');
  ok(classifySinkLine('+  el.innerHTML = esc(v);').unsafe.length === 0, 'CONTROL: the two canonical names keep their name-based credit, so this is a widening only');

  /* THE SHADOWED CANONICAL NAME, BOTH WAYS. A file that declares `esc` and earns nothing for the body
     withdraws the name from its own strip pattern, so the call stops laundering. The same file shape
     with a four-character body keeps the credit, which is what makes this a refusal and not a ban. */
  const SRC_BLIND_ESC = `function esc(s) ${QUOTEBLIND}`;
  const SRC_GOOD_ESC = `function esc(s) ${FOURCH}`;
  ok(
    classifySinkLine('+  el.innerHTML = esc(v);', localEscapers(SRC_BLIND_ESC)).unsafe.includes('v'),
    'a file whose own esc earns NOTHING no longer strips its esc call — the name-only laundering is withdrawn'
  );
  ok(classifySinkLine('+  el.innerHTML = esc(v);', localEscapers(SRC_GOOD_ESC)).unsafe.length === 0, 'CONTROL: the same file with a four-character esc body keeps the credit');
  ok(classifySinkLine('+  el.innerHTML = esc(v);', { credited: [], unverified: ['esc'] }).unsafe.includes('v'), 'the unverified set is read as bare NAMES too, not only as reason objects');
  ok(
    classifySinkLine('+  el.innerHTML = escapeHTML(v);', localEscapers(`function escapeHTML(s) ${QUOTEBLIND}\nfunction esc(s) ${QUOTEBLIND}`)).unsafe.includes('v'),
    'a file that shadows BOTH canonical names leaves no name to strip, and the null pattern strips nothing'
  );
  ok(classifySinkLine('+  el.innerHTML = esc(v);', ['escHtml']).unsafe.length === 0, 'CONTROL: the ARRAY shape earns no shadow, so every caller written before 2026-11-12 reads as it did');
  const perShadow = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML = esc(v);', 'diff --git a/y.js b/y.js', '+  el.innerHTML = esc(v);'], (f) =>
    f === 'x.js' ? localEscapers(SRC_BLIND_ESC) : localEscapers(SRC_GOOD_ESC)
  );
  ok(perShadow.violations.length === 1 && perShadow.violations[0].file === 'x.js', 'the withdrawal is FILE-SCOPED, like the credit: the quote-blind declarer is caught and its neighbour is not');

  /* FILE-SCOPED, like ALLOW: the credit belongs to the file that declares the escaper. */
  const perFile = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML = escHtml(v);', 'diff --git a/y.js b/y.js', '+  el.innerHTML = escHtml(v);'], (f) => (f === 'x.js' ? ['escHtml'] : []));
  ok(perFile.violations.length === 1 && perFile.violations[0].file === 'y.js', 'the earned credit is file-scoped: the same line in a file that declares nothing is still caught');
  ok(scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML = escHtml(v);']).violations.length === 1, 'CONTROL: with no resolver at all the scan behaves exactly as before');

  /* THE REAL FILES — a rule nothing in the tree exercises is a rule nobody has read. */
  const realAlias = localEscapers(readFileSync(join(ROOT, 'pat-feasibility.js'), 'utf-8'));
  ok(realAlias.credited.includes('escHtml'), 'pat-feasibility.js earns escHtml on the real file — the row’s own subject', JSON.stringify(realAlias.credited));
  /* The census HAD a real subject in `data-unifier-app.js` and in `cpapdex-render.js`, each of which
     declared a local `esc` that escaped `& < >` and left the two quote characters alone. Both now
     delegate to the canonical `escapeHTML`, and a whole-tree run reports 0 unverified candidates, so
     no real quote-blind escaper is left to point a leg at. The SHAPE stays pinned by the synthetic
     QUOTEBLIND plant above. These two legs hold the real files to the arm the tree now uses — the
     one-hop delegation — because a rule nothing in the tree exercises is a rule nobody has read. */
  for (const f of ['data-unifier-app.js', 'cpapdex-render.js']) {
    const realDeleg = localEscapers(readFileSync(join(ROOT, f), 'utf-8'));
    ok(realDeleg.credited.includes('esc'), `${f} earns esc by BODY on the real file — the delegation arm`, JSON.stringify(realDeleg));
  }

  const line = fail.length ? `xss-sink-gate selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, sinksAdded, violations, base, fullTree, files, baseline, allowed, stale, escapers, reason }) {
  const exempt = (allowed || []).length;
  const v = Verdict.make({
    gate: 'xss-sink-gate',
    status,
    population: { checked: sinksAdded - exempt, eligible: sinksAdded, excluded: exempt },
    criterion: fullTree
      ? { name: 'the-whole-tree-backlog-of-unescaped-innerhtml-sinks-may-only-fall', threshold: baseline ? baseline.count : 0, unit: 'innerHTML sinks with an unescaped identifier', direction: 'lte' }
      : { name: 'no-added-innerhtml-sink-carries-an-unescaped-identifier', threshold: 0, unit: 'added sinks with an unescaped identifier', direction: 'eq' },
    result:
      status === 'NOT_RUN' && !fullTree
        ? null
        : {
            sinksAdded,
            violations: violations.map((v2) => ({ file: v2.file, unsafe: v2.unsafe })),
            allowed: (allowed || []).map((a) => ({ file: a.file, match: a.match, reason: a.reason })),
            ...(stale && stale.length ? { staleAllow: stale.map((a) => ({ file: a.file, match: a.match })) } : {}),
            ...(fullTree ? { mode: 'full-tree', unescapedSinks: violations.length, sinksInTree: sinksAdded, files, fileCount: files.length, baseline: baseline ? baseline.count : null } : {}),
            ...(escapers ? { escapers: { verified: escapers.verified.length, unverified: escapers.unverified } } : {})
          },
    evidence: ['tools/xss-sink-gate.mjs', 'dex-escape.js'],
    reason:
      status === 'PASS'
        ? null
        : reason || (status === 'NOT_RUN' ? `no innerHTML sink was added in ${base}..HEAD — nothing was examined` : `${violations.length} added sink(s) carry an unescaped identifier`),
    producedBy: {
      tool: 'tools/xss-sink-gate.mjs',
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`xss-sink-gate produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

/* THE EMPTY TREE. `git diff <empty>..HEAD` presents every tracked file as added, which turns this
   diff-scoped scanner into a whole-tree one WITHOUT touching its core — the same classifier, a larger
   population. That matters because code merged before a diff gate existed is never examined by it, so
   the backlog is invisible by construction rather than by neglect. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/* ⚠️ maxBuffer EXPLICITLY, and 1 MiB is why. Node's default killed the first full-tree run with
   `spawnSync ENOBUFS` on a 5.9 MiB diff — the same defect that made `verify-fixtures` report a PASSING
   suite as RED this morning. A truncated or refused capture is never a clean scan, so the buffer is
   sized for the whole tree and a genuine overflow still throws rather than returning a short read. */
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

/* THE SHRINK-ONLY BACKLOG LEDGER, shared with absence-regression. Seeded from the first measured run;
   a count ABOVE it fails, a count below it asks to be lowered. It is debt, not approval, and it may
   only fall — the same ratchet as the resolvability baseline and the untimed-group share. */
export const BACKLOG_LEDGER = 'audits/FULL-TREE-BACKLOG.json';

export function readBacklog(file, gate, readFn) {
  try {
    const d = JSON.parse(readFn(file));
    const e = d && d.gates && d.gates[gate];
    return e && typeof e.count === 'number' ? e : null;
  } catch {
    return null;
  }
}

/**
 * PURE CORE — judge a full-tree count against the ledger. Separated so the selftest can plant a rise,
 * a fall and a first run with no ledger at all.
 * @returns {{status: string, reason: (string|null)}}
 */
export function ratchet(count, baseline) {
  if (baseline == null) return { status: 'NOT_RUN', reason: `no baseline recorded for this gate yet — seed ${BACKLOG_LEDGER} with the measured count (${count}) and the paths` };
  if (count > baseline.count) return { status: 'FAIL', reason: `full-tree backlog ROSE: ${count} > baseline ${baseline.count} — new findings were merged, not inherited` };
  if (count < baseline.count)
    return { status: 'SHORTFALL', reason: `backlog FELL to ${count} from ${baseline.count} — lower the baseline in ${BACKLOG_LEDGER}; a ratchet that is not tightened stops being one` };
  return { status: 'PASS', reason: null };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  /* ⚠️ --full-tree IS NEVER A PR GATE. It scans the whole repo, so on any PR it would report the
     INHERITED backlog as that PR's findings — blocking work on code the author never touched, which is
     how a useful measurement becomes a thing people route around. It is a nightly/release reading of a
     number that may only fall. The PR gate stays diff-scoped and unchanged. */
  const fullTree = argv.includes('--full-tree');
  const baseIdx = process.argv.indexOf('--base');
  const base = fullTree ? EMPTY_TREE : baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';

  const diff = sh(`git diff ${base}..HEAD -U3 -- '*.js' '*.src.html' ':!tests/' ':!tools/'`);

  /* The earned escaper set is a property of the FILE, so it is read from the file on disk and
     memoised: a file holds about five sinks, and --full-tree reads every sink in the tree. A file the
     diff DELETED is gone from disk and earns nothing, which is the same answer as before this. */
  const escCache = new Map();
  const escapersOf = (f) => {
    if (!escCache.has(f)) {
      const abs = join(ROOT, f);
      escCache.set(f, existsSync(abs) ? localEscapers(readFileSync(abs, 'utf-8')) : { credited: [], unverified: [] });
    }
    return escCache.get(f);
  };
  const { violations, sinksAdded, allowed } = scanDiff(diff.split('\n'), (f) => escapersOf(f));

  if (fullTree) {
    const files = [...new Set(violations.map((v) => v.file))].sort();
    const baseline = readBacklog(join(ROOT, BACKLOG_LEDGER), 'xss-sink-gate', (f) => readFileSync(f, 'utf-8'));
    /* 🔴 THE RATCHET COUNTS SINKS, NOT FILES — changed 2026-10-11 after measuring that it was blind to
       the work it exists to track. A file carries ~5 sinks (314 across 42 files) and leaves the list
       only when its LAST one is escaped, so escaping four of five moves the baseline by zero.
       MEASURED, not argued: #3437 escaped sinks in `dex-profile.js` and `resp-acc-analysis-app.js`,
       both of which REMAIN in the list because they hold others — and the file count stayed at 42. A
       ratchet that cannot see a merged security fix is not a ratchet, it is a number that happens to
       be true. `files` stays as a second column: it is the better unit for "how many modules still
       need review", just not for progress. */
    /* THE STALENESS LEG, and it only works here: over the whole tree every sink is in the population,
       so an entry that matched nothing is an exemption covering no line. A stale entry FAILS — the
       same teeth the co-load tables carry, for the same reason (an unread exemption rots silently). */
    /* THE NAME-ONLY CREDIT, COUNTED AND NOW WITHDRAWN IN THE DECLARING FILE. A canonical name that a
       file shadows with a declaration earning nothing no longer strips that file's calls (see
       `escapeCallRe`), so a quote-blind local `esc` launders nothing. The count stays in the reading
       because the credit a file EARNS is still by name at the call site, and a helper reached through
       an import is resolved nowhere. Both populations read 0 on 2026-11-12, so this leg protects the
       next such file rather than a line in the tree today. */
    const filesScanned = [...new Set([...diff.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)].map((m) => m[1]))];
    const escapers = { verified: [], unverified: [] };
    for (const f of filesScanned) {
      const e = escapersOf(f);
      for (const n of e.credited) escapers.verified.push({ file: f, name: n });
      for (const u of e.unverified) escapers.unverified.push({ file: f, name: u.name, reason: u.reason });
    }
    const stale = staleAllow(allowed);
    const r = stale.length
      ? { status: 'FAIL', reason: `stale ALLOW entry (matches no sink in the tree): ${stale.map((a) => `${a.file} :: ${a.match}`).join(', ')}` }
      : ratchet(violations.length, baseline);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(verdictOf({ status: r.status, sinksAdded, violations, base, fullTree: true, files, baseline, allowed, stale, escapers, reason: r.reason }), null, 1)}\n`);
    } else {
      process.stdout.write(`xss-sink-gate --full-tree · ${sinksAdded} innerHTML sink(s) in the tree · ${violations.length} with an unescaped identifier, in ${files.length} file(s)\n`);
      for (const f of files) process.stdout.write(`    ${f}\n`);
      process.stdout.write(
        `  baseline: ${baseline ? `${baseline.count} unescaped sink(s)` : '(none yet)'}${baseline && baseline.files != null ? ` · ${baseline.files} file(s), not ratcheted` : ''} · ${allowed.length} exempt by ALLOW → ${r.status}${r.reason ? ` — ${r.reason}` : ''}\n`
      );
      process.stdout.write(
        `  escapers: ${escapers.verified.length} verified local escaper(s) credited by BODY · ${escapers.unverified.length} candidate(s) unverified, each WITHDRAWN from its own file's strip pattern\n`
      );
      for (const u of escapers.unverified) process.stdout.write(`    ${u.file}: ${u.name} — ${u.reason}\n`);
    }
    process.exit(r.status === 'FAIL' ? 1 : 0);
  }

  /* NOT_RUN WHEN NO SINK WAS ADDED. A diff that adds no innerHTML sink gives this gate nothing to
     judge, and "every added sink is escaped" over zero sinks is not evidence of anything — it is the
     examined-nothing shape, which this repo reports rather than dresses up as a pass. */
  const status = sinksAdded === 0 ? 'NOT_RUN' : violations.length ? 'FAIL' : 'PASS';

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, sinksAdded, violations, base, allowed }), null, 1)}\n`);
  } else if (status === 'FAIL') {
    process.stderr.write('✕ xss-sink-gate: new innerHTML sink(s) without escape:\n');
    for (const v of violations.slice(0, 10)) process.stderr.write(`    ${v.file}: ${v.line} [unescaped: ${v.unsafe.join(', ')}]\n`);
    process.stderr.write('\nRoute untrusted strings through dex-escape.js escapeHTML (#3318).\n');
    process.stderr.write('If the input is statically trusted, document why and add to ALLOW.\n');
  } else if (status === 'NOT_RUN') {
    process.stdout.write(`xss-sink-gate: NOT_RUN — no innerHTML sink added in ${base}..HEAD, so nothing was examined\n`);
  } else {
    process.stdout.write(`xss-sink-gate: ✓ PASS — ${sinksAdded} added sink(s) examined, ${sinksAdded - allowed.length} escaped, ${allowed.length} exempt by ALLOW\n`);
    for (const a of allowed) process.stdout.write(`    EXEMPT ${a.file}: ${a.line}\n      ${a.reason}\n`);
  }
  process.exit(status === 'FAIL' ? 1 : 0);
}

main();
