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
