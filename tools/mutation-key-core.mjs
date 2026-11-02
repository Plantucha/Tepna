/*
 * tools/mutation-key-core.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * ONE HOME for reading a mutmut key against today's source.
 * Residue: 2026-11-01-the-absence-reader-has-two-homes-and-one-cannot-tell-edited-from-gone
 *
 * `tools/mutation-draft-py.mjs` has asked "does the recorded line still exist" since the drafting
 * program began, and #4214 taught `tools/mutation-survivors.mjs` to ask it again in its own words so
 * the ledger could retire an orphaned entry. Two homes for one question is the defect the suite group
 * "the regex escaper has one home in the tools tree" exists to catch, and here the second copy also
 * lost a distinction the first one had measured.
 *
 * 🔴 EDITED IS NOT GONE, AND THEY OWE DIFFERENT REMEDIES. The baseline pins a line's TEXT, so a line
 * that merely GREW no longer matches while its code is still there. Measured 2026-10-31 over the 30
 * open rows, and still true of the 27: `_span_reason = None` survives inside
 * `_span_reason = None if span else "under the minimum judgeable span"` at `capture-host/nightqc.py`.
 * A deleted line wants the entry retired. An edited line wants a re-recorded mutant id, because the
 * mutant that produced the key cannot be produced again — and telling the operator "the entry is
 * live" is the one answer that fits neither.
 */

/** `[start, end)` over the source lines of a top-level `def <fn>(`. `null` when it is not there. */
export function functionSpan(lines, fn) {
  const start = lines.findIndex((l) => l.startsWith('def ' + fn + '('));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('def ') || lines[i].startsWith('class ')) {
      end = i;
      break;
    }
  }
  return [start, end];
}

/** The mutmut key `- <before> | + <after>` split into its two halves. `null` when it is not a key. */
export function splitKey(key) {
  const s = String(key || '');
  const at = s.indexOf(' | + ');
  if (!s.startsWith('- ') || at < 0) return null;
  return { before: s.slice(2, at), after: s.slice(at + 5) };
}

/** Every line index inside `[start,end)` whose text equals `before`, compared without indentation. */
export function locate(lines, span, before) {
  const want = String(before).trim();
  if (!span || !want) return [];
  const out = [];
  for (let i = span[0]; i < span[1]; i++) if (lines[i].trim() === want) out.push(i);
  return out;
}

/**
 * Why a recorded line does not match: `'edited'` or `'gone'`.
 *
 * The baseline pins the line's TEXT, so `locate` compares whole trimmed lines and misses a line that
 * merely GREW. Reporting that as deleted code would be a false claim about the repo, and the two
 * states owe different remedies — an edited line wants a re-recorded mutant id, a deleted one wants
 * the row withdrawn.
 */
export function whyAbsent(lines, span, before) {
  const want = String(before).trim();
  if (!span || !want) return 'gone';
  for (let i = span[0]; i < span[1]; i++) if (lines[i].includes(want)) return 'edited';
  return 'gone';
}

/**
 * The state of one recorded line inside one named top-level function, as six named answers:
 *
 *   `present`       — the line is there, at `at` (line indices, 0-based)
 *   `edited`        — its text survives inside a LONGER line, so the mutant id needs re-recording;
 *                     `at` and `text` carry the containing line, which is what a re-record reads
 *   `gone`          — no line in the function carries the text at all
 *   `no-function`   — the module no longer defines a top-level `def <fname>(`
 *   `indented-only` — `fname` appears only indented (a method or a closure), which this does not read
 *   `no-line`       — the key's original half is empty, so it names no line at all
 *
 * ∅ Each non-`present` answer carries its own `reason`. A caller that collapses these into one
 * boolean loses the remedy with the distinction, which is how #4214 came to report an edited line as
 * a live entry.
 *
 * A hit at column 0 is NOT inside the body: `functionSpan` ends at the next `def`/`class`, so a
 * module-level statement with identical text sits inside the span. `present` requires indentation.
 */
export function recordedLineState(src, fname, before) {
  const want = String(before || '').trim();
  /* ∅ FAIL CLOSED: an empty original half names no line, which is NOT the same as a line that is
     gone. `no-line` stays out of RETIRABLE_STATES so an unreadable key can never retire an entry. */
  if (!want) return { state: 'no-line', reason: 'the key records an empty original line, so it names no line to look for' };
  const lines = String(src).split('\n');
  const span = functionSpan(lines, String(fname || ''));
  if (!span) {
    const indented = lines.some((l) => /^\s+def\s/.test(l) && l.includes('def ' + fname + '('));
    return indented
      ? { state: 'indented-only', reason: `\`${fname}\` appears only indented, and this reads top-level bodies only` }
      : { state: 'no-function', reason: `no top-level \`def ${fname}(\` is defined any more` };
  }
  const at = locate(lines, span, want).filter((i) => /^\s/.test(lines[i]));
  if (at.length) return { state: 'present', at, reason: null };
  if (whyAbsent(lines, span, want) !== 'edited') return { state: 'gone', reason: `no line in \`${fname}\` carries the recorded text` };
  /* THE CONTAINING LINE TRAVELS WITH THE STATE. Re-recording the mutant id reads today's text, and a
     caller told only `edited` has to find that line again by hand — which is the same losing-the-remedy
     shape the six states exist to prevent. `text` is the line the recorded half now lives inside. */
  const grew = [];
  for (let i = span[0]; i < span[1]; i++) if (lines[i].includes(want)) grew.push(i);
  return {
    state: 'edited',
    at: grew,
    text: lines[grew[0]].trim(),
    reason: `the recorded line survives inside a longer line in \`${fname}\`, so the mutant id needs re-recording rather than a retirement`
  };
}

/** The states that mean no invocation can produce the recorded mutant again. */
export const RETIRABLE_STATES = ['gone', 'no-function'];

/* ── THE MUTATED LINE'S SHAPE ──────────────────────────────────────────────────────────────────────
   Residue: 2026-11-01-the-drafted-population-is-mostly-not-initialisers-at-all

   🔴 A MODEL AIMED AT A POPULATION THAT DOES NOT EXIST READS AS A CRITERION THAT IS TOO STRONG.
   The drafting program asks a fixture to make a mutated INITIALISER observable in a published field.
   Measured over the 27 open python survivors (#4229's census): 17 mutate an argument inside a call, so
   no assigned name exists for a fixture to observe at all. A drafted fixture over one of those
   discriminates nothing, and `0 of 1 kept` reads as a model failure rather than as the wrong
   population.

   The reader lives HERE, beside `recordedLineState`, because two tools asked the same question of one
   line and a second copy is how they come to disagree — the defect this file's header already names.
*/

export function parseAssignment(line) {
  const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(:[^=]+)?=(?!=)\s*(.+?)\s*$/.exec(String(line));
  if (!m) return null;
  return { indent: m[1], name: m[2], annotation: (m[3] || '').trim() || null, value: m[4] };
}

const PY_KEYWORDS = new Set(['and', 'or', 'not', 'if', 'else', 'elif', 'while', 'return', 'in', 'is', 'for', 'yield', 'assert', 'lambda', 'del', 'raise', 'with', 'await', 'from', 'import']);

/** What shape a line IS, when it is not a plain assignment — so the census names it. */
export function lineShape(before, after) {
  const asgB = parseAssignment(before);
  const asgA = parseAssignment(after);
  const b = asgB ? asgB.value : String(before);
  const a = asgA ? asgA.value : String(after);
  const pair = `${b}\n${a}`;
  if (/^\s*(if|elif|while|assert)\b/.test(b)) return 'condition';
  if (/^\s*(return|yield)\b/.test(b)) return 'return-expression';
  /* A KEYWORD BEFORE A PAREN IS NOT A CALL. `is not None and (earliest + off) - prev < GAP` read as
     `call`, because `and (` matches "identifier, then an open paren" — so a boolean sub-expression
     was reported under the one shape name that means "the callee's contract decides it". Measured on
     an open survivor of `nightqc.summarize`. */
  const callish = [...String(b).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].some((m) => !PY_KEYWORDS.has(m[1]));
  if (callish) return 'call';
  if (/\b(and|or|not)\b/.test(pair)) return 'boolean-expression';
  if (/(<=|>=|==|!=|<|>)/.test(pair)) return 'comparison';
  if (/^\s*(for|with|try|except|else|elif)\b/.test(b)) return 'statement';
  return 'expression';
}

/** The published field a line names by its own dict key, or `null`.
 *
 * `"session_end": (round(_cur_end) if … else None)` publishes `session_end` directly: there is no
 * assigned NAME, and a fixture can still read the value back out of the summary. Measured over the
 * open python survivors — 1 of the 3 keys that assign no name is one of these. */
export function publishedFieldOnLine(line) {
  const m = /^\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/.exec(String(line));
  return m ? m[1] : null;
}

/** Does the drafting program's model apply to this mutant, and what would a fixture READ?
 *
 * 🔴 MEASURED 2026-11-02 over the 26 open python survivors, and it corrects the row that asked for
 * this: `not-an-initialiser` in #4229's census counts TWO populations with opposite remedies.
 *
 * | population | n | a fixture can read |
 * |---|---|---|
 * | a name assigned a literal | 9 | the name |
 * | a name assigned an EXPRESSION whose argument or operator moved | 14 | the name, once the call's result differs |
 * | a line publishing its own dict key | 1 | that field |
 * | a condition or a bare sub-expression | 2 | nothing — no name, no field |
 *
 * The census calls the middle 14 `not-an-initialiser` because its TRUTH model cannot decide an
 * expression, which is the right answer to "is this provably equivalent" and the wrong one to "can a
 * fixture observe it". Only the last two rows have nothing to observe, and only they are refused. */
export function draftableShape(before, after) {
  const b = parseAssignment(before);
  const a = parseAssignment(after);
  const shape = lineShape(before, after);
  if (b && a && b.name === a.name) return { draftable: true, shape: 'initialiser', observe: b.name, reason: null };
  if (b && a) {
    return {
      draftable: false,
      shape,
      observe: null,
      reason: `the two halves assign different names (\`${b.name}\` and \`${a.name}\`), so the key names no single thing to observe`
    };
  }
  const field = publishedFieldOnLine(before);
  if (field) return { draftable: true, shape: 'dict-entry', observe: field, reason: null };
  return {
    draftable: false,
    shape,
    observe: null,
    reason: `the mutated line is a ${shape}: it assigns no name and publishes no field, so nothing a fixture reads carries the mutated value`
  };
}
